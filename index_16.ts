import * as uuid from "uuid";
require("dotenv").config();

import { OcppVersion } from "./src/ocppVersion";
import { VCP } from "./src/vcp";
import { simulateCharge } from "./src/simulateCharge";

const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

const startChance: number = Number(process.env["START_CHANCE"] ?? 500);
const testCharge: boolean = process.env["TEST_CHARGE"] === "true" ?? false;

const vcp = new VCP({
  endpoint: process.env["WS_URL"] ?? "ws://localhost:3000",
  chargePointId: process.env["CP_ID"] ?? "123456",
  ocppVersion: OcppVersion.OCPP_1_6,
  basicAuthPassword: process.env["PASSWORD"] ?? undefined,
  adminWsPort: parseInt(process.env["ADMIN_PORT"] ?? "9999"),
});

(async () => {
  await vcp.connect();
  await vcp.sendAndWait({
    messageId: uuid.v4(),
    action: "BootNotification",
    payload: {
      chargePointVendor: "ATESS",
      chargePointModel: "EVA-07S-SE",
      chargePointSerialNumber: "EM_VCP_TEST",
      firmwareVersion: "V501.030.04",
    },
  });
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
  // if TEST_CHARGE=true set in cli, start test charge
  console.log(`Test charge set: ${testCharge}`);
  if (testCharge) {
    simulateCharge(vcp, startChance, 200);
  }
})();
