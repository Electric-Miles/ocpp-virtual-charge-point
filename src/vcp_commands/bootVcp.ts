import * as uuid from "uuid";
import { VCP } from "../vcp";
import { sleep } from "../utils";

export async function bootVCP(vcp: VCP, sleepTime: number = 500) {
    console.log("loading VCP...");
    console.log("Connector IDs:", vcp.connectorIDs);

    await sleep(500);
    await vcp.sendAndWait({
      messageId: uuid.v4(),
      action: "BootNotification",
      payload: {
        chargePointVendor: vcp.vendor,
        chargePointModel: vcp.model,
        chargePointSerialNumber: "S001",
        firmwareVersion: vcp.version,
      },
    });
    for (let connectorId of vcp.connectorIDs) {
      console.log(
        `Attempting to send StatusNotification for connectorId: ${connectorId}`,
      );
      await sleep(sleepTime);
      try {
        await Promise.race([
          vcp.sendAndWait({
            messageId: uuid.v4(),
            action: "StatusNotification",
            payload: {
              connectorId: connectorId,
              errorCode: "NoError",
              status: "Preparing",
            },
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("sendAndWait timeout")), 5000),
          ),
        ]);
      } catch (error) {
        console.error(
          `Error or timeout sending StatusNotification for connectorId: ${connectorId}`,
          error,
        );
      }
    }
    console.log("VCP successfully loaded...");
}
