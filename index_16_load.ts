import * as uuid from "uuid";
require("dotenv").config();

import { OcppVersion } from "./src/ocppVersion";
import { VCP } from "./src/vcp";
import { simulateCharge } from "./src/simulateCharge";

// start command:
// WS_URL=ws://192.168.1.116:9000 npx ts-node index_16_load.ts
// WS_URL=ws://192.168.1.116:9000 CP_PREFIX=VCP_ COUNT=5 npx ts-node index_16_load.ts

// load test charge sessions with random start times command:
// ws://ocpp.test.electricmiles.io CP_ID=VCP_ START_CHANCE=100 TEST_CHARGE=true COUNT=5000 RANDOM_START=true npx ts-node index_16_load.ts

const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));
const idPrefix: string = process.env["CP_PREFIX"] ?? "VCP_";
const count: number = Number(process.env["COUNT"] ?? 5000);
// x ms between each VCP starting up
const vcpTimeGap: number = 500;
const startChance: number = Number(process.env["START_CHANCE"] ?? 100);
const testCharge: boolean = process.env["TEST_CHARGE"] === "true" ?? false;
const duration: number = Number(process.env["DURATION"] ?? 60000);
const randomDelay: boolean = process.env["RANDOM_DELAY"] == "true" ?? false;

async function run() {
  const vcpList: VCP[] = [];
  const tasks: Promise<void>[] = []; // Array to hold promises
  
  for (let i = 1; i <= count; i++) {
    const vcp = new VCP({
      endpoint: process.env["WS_URL"] ?? "ws://localhost:3000",
      chargePointId: idPrefix + i,
      ocppVersion: OcppVersion.OCPP_1_6,
    });
  
    vcpList.push(vcp);

    const task = (async () => {
      // Start each VCP a second apart
      await sleep(i * vcpTimeGap);
      await vcp.connect();
      await vcp.sendAndWait({
        messageId: uuid.v4(),
        action: "BootNotification",
        payload: {
          chargePointVendor: "ATESS",
          chargePointModel: "EVA-07S-SE",
          chargePointSerialNumber: "S001",
          firmwareVersion: "1.0.0",
        },
      });
      // Ensure backend has registered the new charger - then send status notification
      await sleep(500);
      await vcp.sendAndWait({
        messageId: uuid.v4(),
        action: "StatusNotification",
        payload: {
          connectorId: 1,
          errorCode: "NoError",
          status: "Preparing",
        },
      });
    })();
    tasks.push(task);
  }

  // Wait for all VCPs to be connected and initialized
  await Promise.all(tasks);
  console.log(`${vcpList.length} VCPs loaded...`)

  // After all VCPs have been initialized, start the simulateCharge function concurrently for each VCP
  if (testCharge) {
    const chargeTasks = vcpList.map(vcp => {
      // VCP performs simulateCharge based on startChance 
      const randomChance = Math.floor(Math.random() * 100);
      console.log(`randomChance: ${randomChance}`)
      if (randomChance <= startChance) {

        simulateCharge(vcp, duration, randomDelay);
      }
      else {
        return Promise.resolve();
      }
  });
    await Promise.all(chargeTasks);
  }
}

run().catch(console.error);