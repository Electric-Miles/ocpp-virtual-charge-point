import * as uuid from "uuid";
import { VCP } from "../vcp";
import { sleep } from "../utils";

export async function bootVCP(vcp: VCP, sleepTime: number = 500) {
    console.log("loading VCP...");
    console.log("Connector IDs:", vcp.connectorIDs);

    //await sleep(500);
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
      //await sleep(sleepTime);
      await vcp.sendAndWait({
        messageId: uuid.v4(),
        action: "StatusNotification",
        payload: {
          connectorId: connectorId,
          errorCode: "NoError",
          status: "Preparing",
        },
      });
    }
    console.log("VCP successfully loaded...");
}
