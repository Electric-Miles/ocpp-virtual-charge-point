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
    // make meterValue not a neat round number
    let meterValue = transaction.meterValue + ((new Date().getTime() - transaction.startedAt.getTime()) / 100);
    meterValue *= 1.24;
    meterValue = Math.round(meterValue);
    console.log(`getMeterValue meterValue: ${meterValue}`)
    transaction.lastMeterValue = meterValue;
    return meterValue;
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
