import { call } from "../messageFactory";
import { VCP } from "../vcp";

const METER_VALUES_INTERVAL_SEC = 30;

interface TransactionState {
  transactionId: number;
  meterValue: number;
  socValue: number;
  startedAt: Date;
  connectorId: number;
  lastMeterValue: number;
  meterValuesTimer?: NodeJS.Timeout;
  power: number;
}

export class TransactionManager {
  private static transactionCount = 0;

  transactions: Map<string, TransactionState> = new Map();
  vcpTransactionMap: Map<string, number> = new Map();
  startTransaction(
    vcp: VCP,
    transactionId: number,
    connectorId: number
  ) {
    const meterValuesTimer = setInterval(() => {
      vcp.send(
        call("MeterValues", {
          connectorId: connectorId,
          transactionId: transactionId,
          meterValue: [
            {
              timestamp: new Date(),
              sampledValue: [
                {
                  value: (this.getMeterValue(transactionId)).toString(),
                  measurand: "Energy.Active.Import.Register",
                  unit: "Wh"
                },
                {
                  value: "28.67",
                  measurand: "Current.Import",
                  unit: "A"
                },
                // exposes bug in adapter that could not parse Celcius
                //{value:"8.0",context:"Sample.Periodic",format:"Raw",measurand:"Temperature",unit:"Celcius"},
                {
                  value: (this.getSoCValue(transactionId)).toString(),
                  context: "Sample.Periodic",
                  measurand: "SoC",
                  unit: "Percent"
                },
                {
                  measurand: "Voltage",
                  unit: "V",
                  phase: "L1",
                  value: "247",
                  context: "Sample.Periodic",
                  location: "Outlet"
                }
              ],
            },
          ],
        })
      );
    }, METER_VALUES_INTERVAL_SEC * 1000);
    // console.log(parseInt(process.env["INITIAL_METER_READINGS"] ?? '0'));
    this.transactions.set(transactionId.toString(), {
      transactionId: transactionId,
      meterValue: this.getStartTransactionStartMeterValue(vcp, connectorId),
      startedAt: new Date(),
      connectorId: connectorId,
      lastMeterValue: 0,
      meterValuesTimer: meterValuesTimer,
      socValue: 10,
      power: vcp.power,
    });
    // set vcp mapping for transactions
    this.vcpTransactionMap.set(vcp.vcpOptions.chargePointId+connectorId, transactionId);

    console.log(`connectorID: ${connectorId}, transactionID: ${transactionId}`)
    // for (const [key, value] of this.transactions.entries()) {
    //   console.log(`Key: ${key}`);
    //   console.log('Value:');
    //   console.log(value);
    // }
    TransactionManager.transactionCount++;
    console.log(`connectorID: ${connectorId}, transaction counts: ${TransactionManager.transactionCount}`)

  return transactionId;
  }

  stopTransaction(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString())
    //  || this.transactions.entries().next().value;
    if (transaction && transaction.meterValuesTimer) {
      console.log(`Clearing interval for transaction ${transactionId}`);
      clearInterval(transaction.meterValuesTimer);
    }
    //this.transactions.delete(transactionId.toString());
  }

  getMeterValue(transactionId: number) {
    const transaction = this.transactions.get(transactionId.toString());
    if (!transaction) {
      return 0;
    }

    // calculate energy output from charger since start of session
    // charger output in watts
    const chargerPower = transaction.power * 1000;
    // time in ms since start of session
    const timeMs = (new Date().getTime() - transaction.startedAt.getTime());
    // time in hours
    const time = timeMs / 3600000;
    // calc wh energy from start of session
    const energy = Math.floor(transaction.meterValue + (chargerPower * time));

    console.log(`getMeterValue energy: ${energy}`)
    console.log(`getMeterValue charger power: ${ transaction.power}`)
    transaction.lastMeterValue = energy;
    return energy;
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
    return this.vcpTransactionMap.get(vcp.vcpOptions.chargePointId+connectorId);
  }

  getStartTransactionStartMeterValue(vcp: VCP, connectorId: number = 1): number {
    // use previous transaction meter value if exists
    const transactionId = this.getTransactionIdByVcp(vcp, connectorId);
    if (transactionId) {
      const transaction = this.transactions.get(transactionId.toString());
      if (transaction) {
        return transaction.lastMeterValue;
      }
    }
    return parseInt(process.env["INITIAL_METER_READINGS"] ?? '0');
  }
}

export const transactionManager = new TransactionManager();
