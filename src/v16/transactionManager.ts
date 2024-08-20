import { call } from "../messageFactory";
import { VCP } from "../vcp";

const METER_VALUES_INTERVAL_SEC = 60;

interface TransactionState {
  transactionId: number;
  meterValue: number;
  startedAt: Date;
  connectorId: number;
  meterValuesTimer?: NodeJS.Timer;
}

export class TransactionManager {
  transactions: Map<string, TransactionState> = new Map();
  startTransaction(
    vcp: VCP,
    transactionId: number,
    connectorId: number
  ) {
    console.log(`transactionID: ${transactionId}`);
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
                  value: (this.getMeterValue(transactionId) / 1000).toString(),
                  measurand: "Energy.Active.Import.Register",
                  unit: "kWh",
                },
              ],
            },
          ],
        })
      );
    }, METER_VALUES_INTERVAL_SEC * 1000);
    // console.log(parseInt(process.env["INITIAL_METER_READINGS"] ?? '0'));
    this.transactions.set(transactionId.toString(), {
      transactionId: transactionId,
      meterValue: parseInt(process.env["INITIAL_METER_READINGS"] ?? '0'),
      startedAt: new Date(),
      connectorId: connectorId,
      meterValuesTimer: meterValuesTimer,
    });
    console.log(`transactionID: ${transactionId}`)
  return transactionId;
  }

  stopTransaction(transactionId: number | string) {
    const transaction = this.transactions.get(transactionId.toString()) || this.transactions.entries().next().value;
    if (transaction && transaction.meterValuesTimer) {
      console.log(`Clearing interval for transaction ${transactionId}`);
      clearInterval(transaction.meterValuesTimer);
    }
    this.transactions.delete(transactionId.toString());
  }

  getMeterValue(transactionId: number | string) {
    const transaction = this.transactions.get(transactionId.toString());
    if (!transaction) {
      return 0;
    }
    console.log(`transaction: ${transaction}`)
    return transaction.meterValue + (new Date().getTime() - transaction.startedAt.getTime()) / 100;
  }
}

export const transactionManager = new TransactionManager();
