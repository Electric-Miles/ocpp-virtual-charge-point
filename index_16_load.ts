import * as uuid from "uuid";
require("dotenv").config();

import { OcppVersion } from "./src/ocppVersion";
import { VCP } from "./src/vcp";
import { simulateCharge } from "./src/simulateCharge";

// start command:
// WS_URL=ws://192.168.1.116:9000 npx ts-node index_16_load.ts
// WS_URL=ws://192.168.1.116:9000 CP_PREFIX=VCP_ COUNT=5 npx ts-node index_16_load.ts

// load test charge sessions with random start times command:
// ws://ocpp.test.electricmiles.io CP_ID=DAN_VCP START_CHANCE=500 TEST_CHARGE=true COUNT=3 RANDOM_START=true npx ts-node index_16_load.ts

const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay))

const idPrefix: string = process.env["CP_PREFIX"] ?? "VCP_";
const count: number = Number(process.env["COUNT"] ?? 5000);
// x ms between each VCP starting up
const vcpTimeGap: number = 500;
const startChance: number = Number(process.env["START_CHANCE"] ?? 500);
const testCharge: boolean = process.env["TEST_CHARGE"] === "true" ?? false;
const duration: number = Number(process.env["CHARGE_LENGTH"] ?? 500);
const randomStart: boolean = process.env["RANDOM_START"] == "true" ?? false;

for (let i = 1; i <= count; i++) {
  const vcp = new VCP({
    endpoint: process.env["WS_URL"] ?? "ws://localhost:3000",
    chargePointId: idPrefix + i,
    ocppVersion: OcppVersion.OCPP_1_6,
  });

  (async () => {
    // start each VCP a second apart
    await sleep(i * vcpTimeGap)
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
    // ensure backend has registered the new charger - then send status notification
    await sleep(500)
    await vcp.sendAndWait({
      messageId: uuid.v4(),
      action: "StatusNotification",
      payload: {
        connectorId: 1,
        errorCode: "NoError",
        status: "Preparing",
      },
    });
    // if TEST_CHARGE=true set in cli, start test charge
    console.log(`Test charge set: ${testCharge}`);
    if (testCharge) {
      simulateCharge(vcp, startChance, duration, randomStart);
    }
  })();
}

