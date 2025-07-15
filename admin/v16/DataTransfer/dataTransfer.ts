import * as uuid from "uuid";
import { sendAdminCommand } from "../../admin";
import { VendorConfig } from "../../../src/vendorConfig";

sendAdminCommand({
  action: "DataTransfer",
  messageId: uuid.v4(),
  payload: {
    vendorId: VendorConfig.VENDORS.ATESS,
    messageId: "rcdvalue",
    data: "B.C",
  },
});
