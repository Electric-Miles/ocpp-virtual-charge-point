import { call } from "../messageFactory";
import { VCP } from "../vcp";
import { EffectiveLimit, resolveEffectiveLimit } from "./chargingProfiles";

const METER_VALUES_INTERVAL_SEC = 30;
// Legacy hardcoded values kept for backward compatibility when no charging
// profile (DLM limit) is active.
const LEGACY_CURRENT_A = "28.67";
const VOLTAGE_V = "247";

interface TransactionState {
  transactionId: number;
  meterValue: number;
  socValue: number;
  startedAt: Date;
  connectorId: number;
  lastMeterValue: number;
  meterValuesTimer?: NodeJS.Timeout;
  power: number;
  vcp: VCP;
  // running energy accumulator (Wh) and the last time it was advanced
  energyWh: number;
  lastAccrualAt: number;
  // true while the DLM limit has forced the connector to 0 A (SuspendedEVSE)
  suspended: boolean;
  active: boolean;
}

export class TransactionManager {
  private static transactionCount = 0;

  transactions: Map<string, TransactionState> = new Map();
  vcpTransactionMap: Map<string, number> = new Map();

  startTransaction(vcp: VCP, transactionId: number, connectorId: number) {
    // read the starting meter value before remapping the vcp->transaction entry
    const startMeter = this.getStartTransactionStartMeterValue(vcp, connectorId);
    const now = new Date();

    const state: TransactionState = {
      transactionId: transactionId,
      meterValue: startMeter,
      startedAt: now,
      connectorId: connectorId,
      lastMeterValue: startMeter,
      socValue: 10,
      power: vcp.power,
      vcp: vcp,
      energyWh: startMeter,
      lastAccrualAt: now.getTime(),
      suspended: false,
      active: true,
    };

    this.transactions.set(transactionId.toString(), state);
    this.vcpTransactionMap.set(
      vcp.vcpOptions.chargePointId + connectorId,
      transactionId,
    );

    if (vcp.sendMeterValues) {
      state.meterValuesTimer = setInterval(() => {
        try {
          this.emitMeterValues(vcp, state);
        } catch (e) {
          // websocket may not be open; skip this tick
        }
      }, METER_VALUES_INTERVAL_SEC * 1000);
    }

    console.log(`connectorID: ${connectorId}, transactionID: ${transactionId}`);
    TransactionManager.transactionCount++;
    console.log(
      `connectorID: ${connectorId}, transaction counts: ${TransactionManager.transactionCount}`,
    );

    return transactionId;
  }

  stopTransaction(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString());
    if (transaction) {
      if (transaction.meterValuesTimer) {
        console.log(`Clearing interval for transaction ${transactionId}`);
        clearInterval(transaction.meterValuesTimer);
        transaction.meterValuesTimer = undefined;
      }
      transaction.active = false;
    }
  }

  /**
   * Build and send a single MeterValues message for a transaction, driving
   * Current.Import and energy accrual from the currently-effective DLM limit and
   * emitting SuspendedEVSE/Charging status transitions when the limit hits 0 A.
   */
  private emitMeterValues(vcp: VCP, transaction: TransactionState) {
    const now = new Date();
    const eff = resolveEffectiveLimit(vcp, transaction.connectorId, now, {
      transactionId: transaction.transactionId,
      transactionStartedAt: transaction.startedAt,
    });

    this.applySuspendState(vcp, transaction, eff);

    let meterValue;
    if (vcp.mixedMeterValues) {
      // sometimes send meter values without energy - ie Easee chargers
      if (Math.random() < 0.3) {
        meterValue = [
          {
            timestamp: now,
            sampledValue: [
              ...this.currentImportSamples(eff),
              {
                value: this.getSoCValue(transaction.transactionId).toString(),
                context: "Sample.Periodic",
                measurand: "SoC",
                unit: "Percent",
              },
              {
                measurand: "Voltage",
                unit: "V",
                phase: "L1",
                value: VOLTAGE_V,
                context: "Sample.Periodic",
                location: "Outlet",
              },
            ],
          },
        ];
      } else {
        meterValue = [
          {
            timestamp: now,
            sampledValue: [
              {
                value: this.getMeterValue(transaction.transactionId).toString(),
                measurand: "Energy.Active.Import.Register",
                unit: "Wh",
              },
            ],
          },
        ];
      }
    } else {
      meterValue = [
        {
          timestamp: now,
          sampledValue: [
            {
              value: this.getMeterValue(transaction.transactionId).toString(),
              measurand: "Energy.Active.Import.Register",
              unit: "Wh",
            },
            ...this.currentImportSamples(eff),
            {
              value: this.getSoCValue(transaction.transactionId).toString(),
              context: "Sample.Periodic",
              measurand: "SoC",
              unit: "Percent",
            },
            {
              measurand: "Voltage",
              unit: "V",
              phase: "L1",
              value: VOLTAGE_V,
              context: "Sample.Periodic",
              location: "Outlet",
            },
          ],
        },
      ];
    }

    vcp.send(
      call("MeterValues", {
        connectorId: transaction.connectorId,
        transactionId: transaction.transactionId,
        meterValue: meterValue,
      }),
    );
  }

  /**
   * Build the Current.Import sampled value(s). With no active limit, preserve the
   * exact legacy single, unphased 28.67 A sample. Under a DLM limit, report the
   * limited current per phase (L1 for single-phase, L1/L2/L3 for three-phase).
   */
  private currentImportSamples(eff: EffectiveLimit): Array<Record<string, any>> {
    if (eff.unlimited) {
      return [
        { value: LEGACY_CURRENT_A, measurand: "Current.Import", unit: "A" },
      ];
    }
    const perPhase = eff.limitAmps.toFixed(2);
    if (eff.numberPhases >= 3) {
      return [
        { value: perPhase, measurand: "Current.Import", unit: "A", phase: "L1" },
        { value: perPhase, measurand: "Current.Import", unit: "A", phase: "L2" },
        { value: perPhase, measurand: "Current.Import", unit: "A", phase: "L3" },
      ];
    }
    return [
      { value: perPhase, measurand: "Current.Import", unit: "A", phase: "L1" },
    ];
  }

  /**
   * When the effective limit forces 0 A, a real charger reports SuspendedEVSE;
   * when the limit returns above 0, it resumes Charging. Edge-triggered so we
   * only send a StatusNotification on an actual transition.
   */
  private applySuspendState(
    vcp: VCP,
    transaction: TransactionState,
    eff: EffectiveLimit,
  ) {
    const shouldSuspend = !eff.unlimited && eff.limitAmps <= 0;
    if (shouldSuspend && !transaction.suspended) {
      transaction.suspended = true;
      vcp.send(
        call("StatusNotification", {
          connectorId: transaction.connectorId,
          errorCode: "NoError",
          status: "SuspendedEVSE",
        }),
      );
    } else if (!shouldSuspend && transaction.suspended) {
      transaction.suspended = false;
      vcp.send(
        call("StatusNotification", {
          connectorId: transaction.connectorId,
          errorCode: "NoError",
          status: "Charging",
        }),
      );
    }
  }

  /**
   * Emit MeterValues immediately (outside the periodic timer) for the active
   * transaction(s) of a VCP. Used after SetChargingProfile/ClearChargingProfile
   * so a limit change is observable without waiting up to 30s. A connectorId of 0
   * (or undefined) re-evaluates every connector, since a ChargePointMaxProfile on
   * connector 0 affects them all.
   */
  sendMeterValuesNow(vcp: VCP, connectorId?: number) {
    if (!vcp.sendMeterValues) {
      return;
    }
    for (const transaction of this.transactions.values()) {
      if (transaction.vcp !== vcp || !transaction.active) {
        continue;
      }
      if (
        connectorId !== undefined &&
        connectorId !== 0 &&
        transaction.connectorId !== connectorId
      ) {
        continue;
      }
      try {
        this.emitMeterValues(vcp, transaction);
      } catch (e) {
        // websocket may not be open; ignore
      }
    }
  }

  getMeterValue(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString());
    if (!transaction) {
      return 0;
    }

    // Advance the energy accumulator incrementally using the power currently
    // permitted by the effective DLM limit (falls back to the charger's rated
    // power when no limit applies). Incremental accrual keeps energy correct
    // across mid-session limit changes and equals the legacy closed-form result
    // (meterValue + power*hoursElapsed) when the limit is unlimited.
    const now = Date.now();
    const eff = resolveEffectiveLimit(
      transaction.vcp,
      transaction.connectorId,
      new Date(now),
      {
        transactionId: transaction.transactionId,
        transactionStartedAt: transaction.startedAt,
      },
    );
    const powerW = eff.unlimited ? transaction.power * 1000 : eff.limitWatts;

    transaction.energyWh +=
      powerW * ((now - transaction.lastAccrualAt) / 3600000);
    transaction.lastAccrualAt = now;
    transaction.lastMeterValue = Math.floor(transaction.energyWh);

    console.log(`getMeterValue energy: ${transaction.lastMeterValue}`);
    console.log(`getMeterValue power (W): ${powerW}`);
    return transaction.lastMeterValue;
  }

  getSoCValue(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString());
    if (!transaction) {
      return 10;
    }

    transaction.socValue++;
    if (transaction.socValue > 100) {
      transaction.socValue = 100;
    }

    return transaction.socValue;
  }

  getTransactionIdByVcp(vcp: VCP, connectorId: number = 1): number | undefined {
    return this.vcpTransactionMap.get(vcp.vcpOptions.chargePointId + connectorId);
  }

  getStartTransactionStartMeterValue(vcp: VCP, connectorId: number = 1): number {
    // store vcp.metervalue as the current meter value
    if (!vcp.continueMeterValueFromPreviousTransaction) {
      return 0;
    }
    // use previous transaction meter value if exists
    const transactionId = this.getTransactionIdByVcp(vcp, connectorId);
    if (transactionId) {
      const transaction = this.transactions.get(transactionId.toString());
      if (transaction) {
        return transaction.lastMeterValue;
      }
    }
    return parseInt(process.env["INITIAL_METER_READINGS"] ?? "0");
  }
}

export const transactionManager = new TransactionManager();
