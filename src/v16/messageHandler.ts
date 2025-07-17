import { call as callFactory, callError, callResult } from "../messageFactory";
import { OcppCall, OcppCallError, OcppCallResult } from "../ocppMessage";
import {
  CallHandler,
  CallResultHandler,
  OcppMessageHandler,
} from "../ocppMessageHandler";
import { delay, NOOP } from "../utils";
import { VCP } from "../vcp";
import { transactionManager } from "./transactionManager";
import {
  GetConfigurationReq,
  RemoteStartTransactionReq,
  RemoteStopTransactionReq,
  TriggerMessageReq,
} from "./types";

const callHandlers: { [key: string]: CallHandler } = {
  ClearCache: (vcp: VCP, call: OcppCall<any>) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  ChangeConfiguration: (vcp: VCP, call: OcppCall<any>) => {
    const success = vcp.updateVendorConfiguration(call.payload.key, call.payload.value);
    
    if (success) {
      vcp.respond(callResult(call, { status: "Accepted" }));
    } else {
      vcp.respond(callResult(call, { status: "Rejected" }));
    }
  },
  GetConfiguration: (vcp: VCP, call: OcppCall<GetConfigurationReq>) => {
    const jsonResp = vcp.getVendorConfiguration(call.payload.key);

    vcp.respond(callResult(call, JSON.parse(jsonResp)));
  },
  Reset: async (vcp: VCP, call: OcppCall) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
    await delay(3000);
    vcp.close();
  },
  SetChargingProfile: (vcp: VCP, call: OcppCall) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  ClearChargingProfile: (vcp: VCP, call: OcppCall) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  RemoteStartTransaction: (
    vcp: VCP,
    call: OcppCall<RemoteStartTransactionReq>,
  ) => {
    if (!call.payload.connectorId) {
      vcp.respond(callResult(call, { status: "Rejected" }));
      return;
    }
    vcp.respond(callResult(call, { status: "Accepted" }));
    vcp.send(
      callFactory("StartTransaction", {
        connectorId: call.payload.connectorId,
        idTag: call.payload.idTag,
        meterStart: transactionManager.getStartTransactionStartMeterValue(
          vcp,
          call.payload.connectorId,
        ),
        timestamp: new Date(),
      }),
    );
    vcp.send(
      callFactory("StatusNotification", {
        connectorId: call.payload.connectorId,
        errorCode: "NoError",
        status: "Charging",
      }),
    );
  },
  RemoteStopTransaction: (
    vcp: VCP,
    call: OcppCall<RemoteStopTransactionReq>,
  ) => {
    const transactionId = call.payload.transactionId;
    const transaction = transactionManager.transactions.get(
      transactionId.toString(),
    );
    if (!transaction) {
      vcp.respond(callResult(call, { status: "Rejected" }));
      return;
    }
    vcp.respond(callResult(call, { status: "Accepted" }));
    vcp.send(
      callFactory("StopTransaction", {
        transactionId: transactionId,
        meterStop: Math.floor(transactionManager.getMeterValue(transactionId)),
        timestamp: new Date(),
      }),
    );
    vcp.send(
      callFactory("StatusNotification", {
        connectorId: transaction.connectorId,
        errorCode: "NoError",
        status: "Finishing",
      }),
    );
  },
  ReserveNow: (vcp: VCP, call: OcppCall<any>) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  CancelReservation: (vcp: VCP, call: OcppCall<any>) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  UnlockConnector: (vcp: VCP, call: OcppCall<any>) => {
    vcp.respond(callResult(call, { status: "Unlocked" }));
  },
  TriggerMessage: (vcp: VCP, call: OcppCall<TriggerMessageReq>) => {
    if (call.payload.requestedMessage === "StatusNotification") {
      vcp.respond(callResult(call, { status: "Accepted" }));
    } else {
      vcp.respond(callResult(call, { status: "NotImplemented" }));
    }
  },
  ChangeAvailability: (vcp: VCP, call: OcppCall<any>) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  DataTransfer: (vcp: VCP, call: OcppCall<any>) => {
    vcp.respond(callResult(call, { status: "Accepted" }));
  },
  GetDiagnostics: async (vcp: VCP, call: OcppCall) => {
    vcp.respond(callResult(call, { fileName: "file.tar.gz" }));

    // Send DiagnosticsStatusNotification with "Uploading" status
    vcp.send(
      callFactory("DiagnosticsStatusNotification", { status: "Uploading" }),
    );

    // Wait 5 seconds before sending the next notification
    await delay(5000);

    // Send DiagnosticsStatusNotification with "Uploaded" status
    vcp.send(
      callFactory("DiagnosticsStatusNotification", { status: "Uploaded" }),
    );
  },
};

const callResultHandlers: { [key: string]: CallResultHandler } = {
  BootNotification: (
    vcp: VCP,
    _call: OcppCall<any>,
    _result: OcppCallResult<any>,
  ) => {
    vcp.configureHeartbeat(300_000);
  },
  MeterValues: NOOP,
  Heartbeat: NOOP,
  StatusNotification: NOOP,
  StartTransaction: (
    vcp: VCP,
    call: OcppCall<any>,
    result: OcppCallResult<any>,
  ) => {
    transactionManager.startTransaction(
      vcp,
      result.payload.transactionId,
      call.payload.connectorId,
    );
  },
  StopTransaction: (
    _vcp: VCP,
    call: OcppCall<any>,
    _result: OcppCallResult<any>,
  ) => {
    transactionManager.stopTransaction(call.payload.transactionId);
  },
  SecurityEventNotification: (
    _vcp: VCP,
    call: OcppCall<any>,
    _result: OcppCallResult<any>,
  ) => {},
  Authorize: NOOP,
  DataTransfer: NOOP,
  DiagnosticsStatusNotification: NOOP,
};

export const messageHandlerV16: OcppMessageHandler = {
  handleCall: function (vcp: VCP, call: OcppCall<any>): void {
    const handler = callHandlers[call.action];
    if (!handler) {
      throw new Error(`Call handler not implemented for ${call.action}`);
    }
    handler(vcp, call);
  },
  handleCallResult: function (
    vcp: VCP,
    call: OcppCall<any>,
    result: OcppCallResult<any>,
  ): void {
    const handler = callResultHandlers[result.action];
    if (!handler) {
      throw new Error(
        `CallResult handler not implemented for ${result.action}`,
      );
    }
    handler(vcp, call, result);
  },
  handleCallError: function (vcp: VCP, error: OcppCallError<any>): void {
    // NOOP
  },
};
