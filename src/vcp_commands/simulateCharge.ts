import * as uuid from "uuid";
import { VCP } from "../vcp";
import { transactionManager } from "../v16/transactionManager";
import { sleep, generateRandomDelay } from "../utils";

export async function simulateCharge(
  vcp: VCP,
  duration: number,
  countOfSessions: number,
  randomDelay: boolean = false,
) {
  // Check if random delay is enabled and get max delay from vendor-specific configuration
  const randomDelayMaxSeconds = vcp.getVendorRandomDelayMax();
  const randomDelayEnabled = randomDelayMaxSeconds > 0;

  const validConnectors = vcp.connectorIDs.filter(
    (connector) => connector !== 0,
  );

  const chargePromises = validConnectors.map(async (connector) => {
    console.log(`Starting test charge for connector: ${connector}`);

    await sleep(500);

    for (let i = 1; i <= countOfSessions; i++) {
      console.log(`charge session count: ${i}`);

      // Apply random delay based on VCP configuration
      if (!randomDelayEnabled) {
        await sleep(500);
      } else {
        // TODO: send statusNotification
        const randomDelayMs = generateRandomDelay(randomDelayMaxSeconds * 1000);

        console.log(
          `random delay of ${randomDelayMs}ms applied (max configured: ${randomDelayMaxSeconds}s)...`,
        );

        await sleep(randomDelayMs);
      }

      // initiate P&C charge session
      await vcp.sendAndWait({
        action: "StartTransaction",
        messageId: uuid.v4(),
        payload: {
          connectorId: connector,
          idTag: "freevenIdTag", // -> for P&C
          meterStart: parseInt(process.env["INITIAL_METER_READINGS"] ?? "0"),
          timestamp: new Date(),
        },
      });
      // send charging statusNotification
      await sleep(1000);
      await vcp.sendAndWait({
        action: "StatusNotification",
        messageId: uuid.v4(),
        payload: {
          connectorId: connector,
          errorCode: "NoError",
          status: "Charging",
        },
      });
      console.log("vcp charging..." + duration + " minutes");
      // send stopNotification after set duration
      // duration input is in minutes
      await sleep(duration * 60000);

      // gets transId by VCP instance
      let transId = transactionManager.getTransactionIdByVcp(vcp, connector);
      console.log(`transactionId for stopNotif : ${transId}`);

      await vcp.sendAndWait({
        action: "StopTransaction",
        messageId: uuid.v4(),
        payload: {
          transactionId: transId,
          timestamp: new Date(),
          meterStop: 2000,
        },
      });
      console.log("StopTransaction is sent...");
      await sleep(500);
      await vcp.sendAndWait({
        action: "StatusNotification",
        messageId: uuid.v4(),
        payload: {
          connectorId: connector,
          errorCode: "NoError",
          status: "Finishing",
        },
      });
    }
  });
  await Promise.all(chargePromises);
}
