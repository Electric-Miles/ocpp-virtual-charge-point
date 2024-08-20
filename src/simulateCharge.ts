import * as uuid from "uuid";
import { VCP } from "./vcp";
import {transactionManager} from "./v16/transactionManager";


const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

export async function simulateCharge(vcp: VCP, startChance: number, duration: number,randomStart: boolean = false) {
  if (!randomStart) {
    await sleep(startChance)
  }
  else {
    const randomStart = Math.floor(Math.random() * startChance) * 500;
    await sleep(randomStart);
  }
  // initiate P&C charge session
  await vcp.sendAndWait({
    action: "StartTransaction",
    messageId: uuid.v4(),
    payload: {
      connectorId: 1,
      idTag: 'freevenIdTag', // -> for P&C
      meterStart: parseInt(process.env["INITIAL_METER_READINGS"] ?? "0"),
      timestamp: new Date(),
    },
  });
  // send charging statusNotification
  await sleep(500)
  await vcp.sendAndWait({
    action: "StatusNotification",
    messageId: uuid.v4(),
    payload: {
      connectorId: 1,
      errorCode: "NoError",
      status: "Charging",
    },
  });
  // console.log(`trans Id: ${transactionId}`)
  console.log("vcp charging...")
  // send stopNotification after set duration
  await sleep(duration);
  await vcp.sendAndWait({
    action: "StopTransaction",
    messageId: uuid.v4(),
    payload: {
      transactionId: transactionManager.transactions.keys().next().value,
      timestamp: new Date(),
      meterStop: 2000,
    },
  });
  console.log("StopTransaction is sent...")
  await sleep(500);
  await vcp.sendAndWait({
    action: "StatusNotification",
    messageId: uuid.v4(),
    payload: {
      connectorId: 1,
      errorCode: "NoError",
      status: "Finishing",
    },
  });
}
