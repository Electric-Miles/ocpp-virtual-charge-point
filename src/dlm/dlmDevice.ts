import WebSocket from "ws";

import { logger } from "../logger";
import { call } from "../messageFactory";
import { OcppCall } from "../ocppMessage";
import { validateOcppRequest } from "../jsonSchemaValidator";
import { OcppVersion, toProtocolVersion } from "../ocppVersion";
import { ocppOutbox } from "../ocppOutbox";
import { DlmReading } from "./deviceType";
import { resolveDlmDeviceType } from "./registry";

const DEFAULT_VOLTAGE_V = 245;
const DEFAULT_PHASES = 3;
const HEARTBEAT_INTERVAL_MS = 300_000;

// Defaults below mirror what a real Charge-M8 Libra was observed doing (device
// 202504110050, 2026-09-09) — but that is one unit on one site, and each of
// these is plausibly a function of how the site is wired and configured rather
// than of the hardware, so they are all overridable. See docs/DLM.md.

// The observed device had a voltage reference on L1 only, while all three CT
// clamps carried current — so it reported V and W for L1 and current for all
// three phases. A fully sensed 3-phase install would report all three.
const DEFAULT_VOLTAGE_SENSE_PHASES = 1;

// Small per-channel offsets the observed unit reported on the phases it had no
// voltage reference for (L2 sat at a constant -30 W, L3 at a clean 0).
const DEFAULT_UNMEASURED_PHASE_OFFSETS_W: [number, number, number] = [0, -30, 0];

// The observed site ran a sustained imbalance rather than an even split: per-phase
// current relative to the mean phase averaged 1.027 / 1.106 / 0.867 (L2 was the
// worst phase in 194 of 250 samples, L1 in the other 56). These are shares of the
// total load, so they must sum to the number of live phases.
const DEFAULT_PHASE_BALANCE: [number, number, number] = [1.027, 1.106, 0.867];

// Reported resolution per channel, established as the GCD over all 250 samples.
// Current resolution plausibly tracks the configured CT ratio.
const DEFAULT_QUANTISATION = { powerW: 30, currentA: 0.3, voltageV: 0.1 };

// The observed unit never populated its import register — 45 min at ~5 kW
// should have accrued ~3.7 kWh and it stayed at 0. Whether that is firmware or
// configuration is not decidable from the sample.
const DEFAULT_REPORT_ENERGY_REGISTER = false;

const quantise = (value: number, step: number) =>
  step > 0 ? Math.round(value / step) * step : value;

export interface DlmDeviceOptions {
  endpoint: string;
  deviceId: string;
  deviceTypeId: string;
  nonChargerLoadWatts: number;
  includeChargerLoad: boolean;
  voltagePerPhase?: number;
  phases?: number;
  basicAuthPassword?: string;
  /** Overrides the device type's default reporting interval. */
  reportIntervalMs?: number;
  /** Phases with a voltage reference wired; the rest report 0 V and 0 W. */
  voltageSensePhases?: number;
  /** Per-phase load shares, relative to an even split. `[1,1,1]` balances the site. */
  phaseBalance?: [number, number, number];
  /** Per-phase power offsets reported on phases without a voltage reference. */
  unmeasuredPhaseOffsetsW?: [number, number, number];
  /** Reported resolution per channel; 0 disables quantising that channel. */
  quantisation?: { powerW?: number; currentA?: number; voltageV?: number };
  /** Whether to report accrued Wh in the energy register, or a flat 0. */
  reportEnergyRegister?: boolean;
  // returns the current total charger load (watts) across the process, so the
  // reported site load can reflect live EV demand and close the DLM loop
  loadProvider?: () => number;
}

/**
 * Emulates a DLM/load-balancer device: connects to the CSMS as an OCPP 1.6
 * client and pushes periodic site-meter readings so the platform's DLM
 * calculation runs and emits TxProfiles. The wire format is delegated to a
 * pluggable DlmDeviceType (see registry.ts), so this runtime is vendor-agnostic.
 */
export class DlmDevice {
  private ws?: WebSocket;
  private reportTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private energyWh = 0;
  private lastAccrualAt = Date.now();
  private lastReading?: DlmReading;
  public nonChargerLoadWatts: number;
  public connected = false;

  constructor(public options: DlmDeviceOptions) {
    this.nonChargerLoadWatts = options.nonChargerLoadWatts;
  }

  private get deviceType() {
    return resolveDlmDeviceType(this.options.deviceTypeId);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.options.endpoint}/${this.options.deviceId}`;
      const protocol = toProtocolVersion(OcppVersion.OCPP_1_6);
      this.ws = new WebSocket(url, [protocol], {
        rejectUnauthorized: false,
        auth: this.options.basicAuthPassword
          ? `${this.options.deviceId}:${this.options.basicAuthPassword}`
          : undefined,
        followRedirects: true,
      });

      this.ws.on("open", () => {
        this.connected = true;
        logger.info(`DLM device connected: ${this.options.deviceId}`);
        this.onOpen();
        resolve();
      });
      this.ws.on("message", (message: string) => this.onMessage(message));
      this.ws.on("close", () => {
        this.connected = false;
      });
      this.ws.on("error", (error: Error) => {
        logger.error(`DLM device WS error (${this.options.deviceId}): ${error.message}`);
        reject(error);
      });
    });
  }

  private onOpen() {
    const type = this.deviceType;
    this.send(
      call("BootNotification", {
        chargePointVendor: "Charge-M8",
        chargePointModel: type.label,
        chargePointSerialNumber: this.options.deviceId,
        firmwareVersion: "1.0.0",
      }),
    );

    this.heartbeatTimer = setInterval(() => {
      try {
        this.send(call("Heartbeat"));
      } catch (e) {
        // socket not open; skip
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.reportTimer = setInterval(() => {
      try {
        this.sendReading();
      } catch (e) {
        // socket not open; skip
      }
    }, this.options.reportIntervalMs ?? type.defaultReportIntervalMs);

    // send an initial reading immediately
    try {
      this.sendReading();
    } catch (e) {
      // ignore
    }
  }

  private onMessage(message: string) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const [type, ...rest] = data;
    if (type === 3) {
      // CallResult to one of our outbound calls; clear it from the outbox
      const [messageId] = rest;
      ocppOutbox.get(messageId);
    } else if (type === 2) {
      // The CSMS shouldn't drive a meter device much; log and ignore.
      const [, action] = rest;
      logger.info(`DLM device ${this.options.deviceId} received ${action} (ignored)`);
    }
  }

  private buildReading(): DlmReading {
    const voltage = this.options.voltagePerPhase ?? DEFAULT_VOLTAGE_V;
    const phases = this.options.phases ?? DEFAULT_PHASES;

    const chargerLoad =
      this.options.includeChargerLoad && this.options.loadProvider
        ? this.options.loadProvider()
        : 0;
    const totalPowerW = Math.max(0, this.nonChargerLoadWatts + chargerLoad);

    const now = Date.now();
    this.energyWh += totalPowerW * ((now - this.lastAccrualAt) / 3600000);
    this.lastAccrualAt = now;

    const balance = this.options.phaseBalance ?? DEFAULT_PHASE_BALANCE;
    // Renormalise over the live phases so the total site load is preserved
    // whatever the imbalance, and whether the site is 1- or 3-phase.
    const balanceSum = balance
      .slice(0, phases)
      .reduce((a, b) => a + Math.max(0, b), 0);

    const sensePhases =
      this.options.voltageSensePhases ?? DEFAULT_VOLTAGE_SENSE_PHASES;
    const offsets =
      this.options.unmeasuredPhaseOffsetsW ??
      DEFAULT_UNMEASURED_PHASE_OFFSETS_W;
    const steps = { ...DEFAULT_QUANTISATION, ...this.options.quantisation };

    const powerArr: [number, number, number] = [0, 0, 0];
    const currentArr: [number, number, number] = [0, 0, 0];
    const voltageArr: [number, number, number] = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const live = i < phases && balanceSum > 0;
      const phaseW = live ? (totalPowerW * Math.max(0, balance[i])) / balanceSum : 0;
      // A phase is only measured in volts/watts where a voltage reference is
      // wired; current comes off its own CT clamp regardless.
      const sensed = i < sensePhases;
      currentArr[i] = live ? quantise(phaseW / voltage, steps.currentA) : 0;
      voltageArr[i] = sensed ? quantise(voltage, steps.voltageV) : 0;
      powerArr[i] = sensed && live ? quantise(phaseW, steps.powerW) : offsets[i];
    }

    return {
      deviceId: this.options.deviceId,
      timestamp: new Date(),
      voltage: voltageArr,
      currentImport: currentArr,
      power: powerArr,
      energyWh:
        (this.options.reportEnergyRegister ?? DEFAULT_REPORT_ENERGY_REGISTER)
          ? this.energyWh
          : 0,
      totalPowerW,
    };
  }

  private sendReading() {
    const reading = this.buildReading();
    this.lastReading = reading;
    this.send(this.deviceType.buildReadingCall(reading));
  }

  send(ocppCall: OcppCall<any>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("DLM device websocket is not open");
    }
    ocppOutbox.enqueue(ocppCall);
    const jsonMessage = JSON.stringify([
      2,
      ocppCall.messageId,
      ocppCall.action,
      ocppCall.payload,
    ]);
    validateOcppRequest(
      OcppVersion.OCPP_1_6,
      ocppCall.action,
      JSON.parse(JSON.stringify(ocppCall.payload)),
    );
    if (ocppCall.action !== "Heartbeat") {
      logger.info(`➡️  DLM ${this.options.deviceId} ${ocppCall.action} ${jsonMessage}`);
    }
    this.ws.send(jsonMessage);
  }

  /** Adjust the reported non-charger site load live and push a reading immediately. */
  updateNonChargerLoad(watts: number) {
    this.nonChargerLoadWatts = watts;
    try {
      this.sendReading();
    } catch (e) {
      // socket not open; skip
    }
  }

  getStatus() {
    return {
      deviceId: this.options.deviceId,
      deviceTypeId: this.options.deviceTypeId,
      endpoint: this.options.endpoint,
      connected: this.connected,
      nonChargerLoadWatts: this.nonChargerLoadWatts,
      includeChargerLoad: this.options.includeChargerLoad,
      lastReading: this.lastReading
        ? {
            timestamp: this.lastReading.timestamp,
            totalPowerW: Math.round(this.lastReading.totalPowerW),
            currentImport: this.lastReading.currentImport.map(
              (a) => Math.round(a * 100) / 100,
            ),
            energyWh: Math.round(this.energyWh),
            worstPhaseAmps:
              Math.round(Math.max(...this.lastReading.currentImport) * 100) / 100,
          }
        : null,
    };
  }

  stop() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = undefined;
    }
    this.connected = false;
  }
}
