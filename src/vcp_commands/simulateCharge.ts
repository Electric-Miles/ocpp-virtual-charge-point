import * as uuid from "uuid";
import { VCP } from "../vcp";
import { transactionManager } from "../v16/transactionManager";
import { sleep, generateRandomDelay } from "../utils";
import { VendorConfig } from "../vendorConfig";

/**
 * Simulates a charging session for multiple connectors
 * @param vcp VCP instance
 * @param duration Duration in minutes
 * @param countOfSessions Number of charging sessions to simulate
 * @param randomDelay Whether to apply random delays between sessions
 */
export async function simulateCharge(
  vcp: VCP,
  duration: number,
  countOfSessions: number,
  randomDelay: boolean = false,
) {
  configureRandomDelay(vcp, randomDelay);

  const validConnectors = vcp.connectorIDs.filter((connector) => connector !== 0);

  const chargePromises = validConnectors.map(connector => 
    simulateConnectorCharge(vcp, connector, duration, countOfSessions, randomDelay)
  );

  await Promise.all(chargePromises);
}

/**
 * Configures random delay settings for the VCP
 */
function configureRandomDelay(vcp: VCP, randomDelay: boolean) {
  const randomDelayMaxSeconds = randomDelay ? "600" : "0";
  const randomDelayConfigKey = VendorConfig.getVendorRandomDelayConfigKey(vcp.vendor);

  if (randomDelayConfigKey) {
    vcp.updateVendorConfiguration(randomDelayConfigKey, randomDelayMaxSeconds);
  }
  
  return randomDelayMaxSeconds;
}

/**
 * Simulates charging sessions for a specific connector
 */
async function simulateConnectorCharge(
  vcp: VCP, 
  connector: number, 
  duration: number, 
  countOfSessions: number, 
  randomDelay: boolean
) {
  console.log(`Starting test charge for connector: ${connector}`);

  await sleep(500);

  for (let i = 1; i <= countOfSessions; i++) {
    console.log(`charge session count: ${i}`);
    
    await runChargeSession(vcp, connector, duration, randomDelay);
  }
}

/**
 * Runs a single charging session
 */
async function runChargeSession(vcp: VCP, connector: number, duration: number, randomDelay: boolean) {
  // Start transaction
  await startTransaction(vcp, connector, randomDelay);
  
  // Send charging status notification
  await sleep(1000);

  await sendStatusNotification(vcp, connector, "Charging");
  
  // Simulate charging duration
  console.log("vcp charging..." + duration + " minutes");
  await sleep(duration * 60000);
  
  // Stop transaction
  await stopTransaction(vcp, connector);
  
  // Send finishing status
  await sleep(500);
  await sendStatusNotification(vcp, connector, "Finishing");
}

/**
 * Starts a transaction with optional random delay
 */
async function startTransaction(vcp: VCP, connector: number, randomDelay: boolean) {
  const randomDelayMaxSeconds = randomDelay ? "600" : "0";
  
  if (!randomDelay && randomDelayMaxSeconds === "0") {    
    await sleep(500);

    await sendStartTransaction(vcp, connector);
  } else {
    const randomDelayNumber = generateRandomDelay(parseInt(randomDelayMaxSeconds));
    
    await sendStartTransaction(vcp, connector);
    
    const randomDelayStatusNotificationPayload = 
      VendorConfig.getVendorRandomDelayStatusNotificationPayload(vcp.vendor, randomDelayNumber);

    if (randomDelayStatusNotificationPayload) {
      await vcp.sendAndWait({
        action: "StatusNotification",
        messageId: uuid.v4(),
        payload: {
          connectorId: connector,
          errorCode: "NoError",
          ...randomDelayStatusNotificationPayload,
        },
      });
    }

    console.log(`random delay of ${randomDelayNumber}s applied (max configured: ${randomDelayMaxSeconds}s)...`);
    
    await sleep(randomDelayNumber * 1000);
  }
}

/**
 * Sends a start transaction request
 */
async function sendStartTransaction(vcp: VCP, connector: number) {
  return vcp.sendAndWait({
    action: "StartTransaction",
    messageId: uuid.v4(),
    payload: {
      connectorId: connector,
      idTag: "freevenIdTag", // -> for P&C
      meterStart: parseInt(process.env["INITIAL_METER_READINGS"] ?? "0"),
      timestamp: new Date(),
    },
  });
}

/**
 * Sends a status notification
 */
async function sendStatusNotification(vcp: VCP, connector: number, status: string) {
  return vcp.sendAndWait({
    action: "StatusNotification",
    messageId: uuid.v4(),
    payload: {
      connectorId: connector,
      errorCode: "NoError",
      status,
    },
  });
}

/**
 * Stops an active transaction
 */
async function stopTransaction(vcp: VCP, connector: number) {
  const transId = transactionManager.getTransactionIdByVcp(vcp, connector);
  
  console.log(`transactionId for stopNotif : ${transId}`);

  return vcp.sendAndWait({
    action: "StopTransaction",
    messageId: uuid.v4(),
    payload: {
      transactionId: transId,
      timestamp: new Date(),
      meterStop: 2000,
    },
  }).then(() => console.log("StopTransaction is sent..."));
}
