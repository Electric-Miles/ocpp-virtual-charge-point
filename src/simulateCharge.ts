import * as uuid from "uuid";
import { VCP } from "./vcp";
import {transactionManager} from "./v16/transactionManager";


const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

const randomIdTag = (): string => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;

    for (let i = 0; i < 10; i++) {
        const randomIndex = Math.floor(Math.random() * charactersLength);
        result += characters[randomIndex];
    }

    return result;
};

export async function simulateCharge(vcp: VCP, startChance: number, duration: number) {
  let idTag = randomIdTag()
  await sleep(startChance);

  // initiate P&C charge session
  await vcp.sendAndWait({
    action: "StartTransaction",
    messageId: uuid.v4(),
    payload: {
      connectorId: 1,
      // idTag: idTag, 
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
