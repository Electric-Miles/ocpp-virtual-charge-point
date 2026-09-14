import * as uuid from "uuid";
import { VCP } from "../vcp";
import { sleep } from "../utils";

export async function bootVCP(vcp: VCP) {
    console.log("Loading VCP Connector IDs:", vcp.connectorIDs);
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
}
