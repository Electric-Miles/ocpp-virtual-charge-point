import WebSocket, { WebSocketServer } from "ws";
import util from "util";

import { logger } from "./logger";
import { call } from "./messageFactory";
import { OcppCall, OcppCallError, OcppCallResult } from "./ocppMessage";
import {
  OcppMessageHandler,
  resolveMessageHandler,
} from "./ocppMessageHandler";
import { ocppOutbox } from "./ocppOutbox";
import { OcppVersion, toProtocolVersion } from "./ocppVersion";
import {
  validateOcppRequest,
  validateOcppResponse,
} from "./jsonSchemaValidator";
import {getFirmware, getVendor, sleep} from "./utils";
import {transactionManager} from "./v16/transactionManager";

interface VCPOptions {
  ocppVersion: OcppVersion;
  endpoint: string;
  chargePointId: string;
  basicAuthPassword?: string;
  adminWsPort?: number;
  isTwinGun?: boolean; // if VCP is twingun, based on cli param
  connectorIds?: number[];
  model: string;
}

export class VCP {
  private ws?: WebSocket;
  private adminWs?: WebSocketServer;
  private messageHandler: OcppMessageHandler;
  public isFinishing: boolean = false;
  public isWaiting: boolean = false;
  public lastAction: string = "";
  public isTwinGun: boolean = false;
  public connectorIDs: number[];
  public status: string;
  public model: string;
  public vendor: string;
  public version: string;

  constructor(public vcpOptions: VCPOptions) {
    this.messageHandler = resolveMessageHandler(vcpOptions.ocppVersion);

    this.vcpOptions.isTwinGun = this.vcpOptions.isTwinGun ?? false;
    this.isTwinGun = this.vcpOptions.isTwinGun ?? false;
    this.connectorIDs =
      this.vcpOptions.connectorIds ?? this.initializeConnectorIDs();
    this.status = "Available";
    this.model = this.vcpOptions.model ??  "EVC01";
    this.vendor = getVendor(this.model);
    this.version = getFirmware(this.model);

    if (vcpOptions.adminWsPort) {
      this.adminWs = new WebSocketServer({
        port: vcpOptions.adminWsPort,
      });
      this.adminWs.on("connection", (_ws) => {
        _ws.on("message", (data: string) => {
          this.send(JSON.parse(data));
        });
      });
      this.adminWs.on("error", (error) => {
        logger.error("Admin WebSocketServer Error: " + error);
      });
    }
  }

  async connect(): Promise<void> {
    logger.info(`Connecting... | ${util.inspect(this.vcpOptions)}`);
    this.isFinishing = false;
    return new Promise((resolve) => {
      const websocketUrl = `${this.vcpOptions.endpoint}/${this.vcpOptions.chargePointId}`;
      const protocol = toProtocolVersion(this.vcpOptions.ocppVersion);
      this.ws = new WebSocket(websocketUrl, [protocol], {
        rejectUnauthorized: false,
        auth: this.vcpOptions.basicAuthPassword
          ? `${this.vcpOptions.chargePointId}:${this.vcpOptions.basicAuthPassword}`
          : undefined,
        followRedirects: true,
      });

      this.ws.on("open", () => resolve());
      this.ws.on("message", (message: string) => this._onMessage(message));
      this.ws.on("ping", () => {
        //logger.info("Received PING");
      });
      this.ws.on("pong", () => {
        logger.info("Received PONG");
      });
      this.ws.on("close", (code: number, reason: string) =>
        this._onClose(code, reason),
      );
    });
  }

  send(ocppCall: OcppCall<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    ocppOutbox.enqueue(ocppCall);
    const jsonMessage = JSON.stringify([
      2,
      ocppCall.messageId,
      ocppCall.action,
      ocppCall.payload,
    ]);

    if (ocppCall.action !== "Heartbeat") {
      logger.info(
        `➡️  Sending ${this.vcpOptions.chargePointId} ${ocppCall.action} ${jsonMessage}`,
      );
    }
    validateOcppRequest(
      this.vcpOptions.ocppVersion,
      ocppCall.action,
      JSON.parse(JSON.stringify(ocppCall.payload)),
    );
    this.lastAction = ocppCall.action;

    if (ocppCall.action === "StatusNotification") {
      this.status = ocppCall.payload.status;
    }

    this.ws.send(jsonMessage);
  }

  async sendAndWait(ocppCall: OcppCall<any>) {
    if (this.isWaiting) {
      // try again after 1 second
      await sleep(1000);
      await this.sendAndWait(ocppCall);
    } else {
      this.isWaiting = true;
      this.send(ocppCall);
    }
  }

  respond(result: OcppCallResult<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    const jsonMessage = JSON.stringify([3, result.messageId, result.payload]);
    logger.info(`➡️  Responding ${jsonMessage}`);
    validateOcppResponse(
      this.vcpOptions.ocppVersion,
      result.action,
      JSON.parse(JSON.stringify(result.payload)),
    );
    this.ws.send(jsonMessage);
  }

  respondError(error: OcppCallError<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    const jsonMessage = JSON.stringify([
      4,
      error.messageId,
      error.errorCode,
      error.errorDescription,
      error.errorDetails,
    ]);
    logger.info(`Responding with ➡️  ${jsonMessage}`);
    this.ws.send(jsonMessage);
  }

  configureHeartbeat(interval: number) {
    setInterval(() => {
      this.send(call("Heartbeat"));
    }, interval);
  }

  close() {
    if (!this.ws) {
      throw new Error(
        "Trying to close a Websocket that was not opened. Call connect() first",
      );
    }
    this.isFinishing = true;
    this.ws.close();
    this.adminWs?.close();
    delete this.ws;
    delete this.adminWs;
    process.exit(1);
  }

  // sets array of connectorIDs
  private initializeConnectorIDs(): number[] {
    if (this.isTwinGun) {
      return [0, 1, 2];
    }
    return [1];
  }

  private _onMessage(message: string) {
    this.isWaiting = false;
    if (this.lastAction !== "Heartbeat") {
      logger.info(`⬅️  Receive ${this.vcpOptions.chargePointId} ${message}`);
    } else {
      this.lastAction = "";
    }
    const data = JSON.parse(message);
    const [type, ...rest] = data;
    if (type === 2) {
      const [messageId, action, payload] = rest;
      validateOcppRequest(this.vcpOptions.ocppVersion, action, payload);
      this.messageHandler.handleCall(this, { messageId, action, payload });
    } else if (type === 3) {
      const [messageId, payload] = rest;
      const enqueuedCall = ocppOutbox.get(messageId);
      if (!enqueuedCall) {
        throw new Error(
          `Received CallResult for unknown messageId=${messageId}`,
        );
      }
      validateOcppResponse(
        this.vcpOptions.ocppVersion,
        enqueuedCall.action,
        payload,
      );
      this.messageHandler.handleCallResult(this, enqueuedCall, {
        messageId,
        payload,
        action: enqueuedCall.action,
      });
    } else if (type === 4) {
      const [messageId, errorCode, errorDescription, errorDetails] = rest;
      this.messageHandler.handleCallError(this, {
        messageId,
        errorCode,
        errorDescription,
        errorDetails,
      });
    } else {
      throw new Error(`Unrecognized message type ${type}`);
    }
  }

  private _onClose(code: number, reason: string) {
    if (this.isFinishing) {
      return;
    }
    logger.info(`Connection closed. code=${code}, reason=${reason}`);
    process.exit();
  }

  disconnect() {
    if (!this.ws) {
      throw new Error(
        "Trying to close a Websocket that was not opened. Call connect() first",
      );
    }

    for (const connector of this.connectorIDs) {
      let transactionId = transactionManager.getTransactionIdByVcp(this, connector);
      if (transactionId) {
        transactionManager.stopTransaction(transactionId);
      }
    }
    this.isFinishing = true;
    this.ws.close();
  }

  /**
   * Get vendor-specific configuration based on vendor, model and key parameters
   * @param keys Array of configuration keys to filter by
   * @returns JSON string with the appropriate configuration
   */
  getVendorConfiguration(keys: string[] = []): string {
    let jsonResp = '{"configurationKey": []}';
    
    if (this.vendor === 'ATESS') {
      if (keys.length > 0) {
        return this.getAtessHiddenConfiguration();
      } else {
        return this.getAtessPublicConfiguration();
      }
    } else if (this.model === 'EVC03' && keys.length === 0) {
      return this.getEVC03Configuration();
    } else if (this.vendor === 'Vestel' && keys.length === 0) {
      return this.getVestelConfiguration();
    }
    
    return jsonResp;
  }

  /**
   * Get configuration for ATESS vendor with specific keys
   * @returns JSON string with hidden ATESS keys
   */
  getAtessHiddenConfiguration(): string {
    return '{"configurationKey":[{"key":"G_LowPowerReserveEnable","value":"Disable","readonly":false},{"key":"UnlockConnectorOnEVSideDisconnect","value":"true","readonly":false},{"key":"G_PeriodTime","value":"time1=11:00-16:00&amp;time2=16:01-10:59","readonly":false},{"key":"G_OffPeakEnable","value":"Disable","readonly":false},{"key":"G_OffPeakCurr","value":"","readonly":false},{"key":"G_ChargerNetMac","value":"50:88:C1:3A:23:13","readonly":false},{"key":"AuthorizationCacheEnabled","value":"false","readonly":false},{"key":"AuthorizeRemoteTxRequests","value":"false","readonly":true},{"key":"ConnectionTimeOut","value":"90","readonly":false},{"key":"LocalAuthListEnabled","value":"false","readonly":false},{"key":"LocalAuthorizeOffline","value":"false","readonly":false},{"key":"LocalPreAuthorize","value":"false","readonly":false},{"key":"StopTransactionOnInvalidId","value":"true","readonly":false}]}';
  }

  /**
   * Get configuration for ATESS vendor with no specific keys
   * @returns JSON string with public ATESS keys
   */
  getAtessPublicConfiguration(): string {
    return '{"configurationKey":[{"key":"G_ChargerID","value":"IOG0B21174","readonly":false},{"key":"G_ChargerRate","value":"1.00","readonly":false},{"key":"G_ChargerLanguage","value":"English","readonly":false},{"key":"G_MaxCurrent","value":"32.00","readonly":false},{"key":"G_ChargerMode","value":"1","readonly":false},{"key":"G_CardPin","value":"242007","readonly":false},{"key":"G_Authentication","value":"12354678","readonly":false},{"key":"G_ChargerNetIP","value":"192.168.1.5","readonly":false},{"key":"G_MaxTemperature","value":"85","readonly":false},{"key":"G_ExternalLimitPower","value":"45","readonly":false},{"key":"G_ExternalLimitPowerEnable","value":"0","readonly":false},{"key":"G_ExternalSamplingCurWring","value":"0","readonly":false},{"key":"G_SolarMode","value":"0","readonly":false},{"key":"G_SolarLimitPower","value":"1.76","readonly":false},{"key":"G_PeakValleyEnable","value":"1","readonly":false},{"key":"G_AutoChargeTime","value":"00:00-00:00","readonly":false},{"key":"G_RCDProtection","value":"6","readonly":false},{"key":"G_PowerMeterAddr","value":"1","readonly":false},{"key":"G_PowerMeterType","value":"Acrel DDS1352","readonly":false},{"key":"G_TimeZone","value":"UTC+00:00","readonly":false},{"key":"G_ServerURL","value":"ws://ocpp.electricmiles.io/","readonly":false},{"key":"G_RandDelayChargeTime","value":"600","readonly":false},{"key":"HeartbeatInterval","value":"300","readonly":false},{"key":"MeterValueSampleInterval","value":"60","readonly":false},{"key":"WebSocketPingInterval","value":"30","readonly":false},{"key":"ConnectionTimeOut","value":"90","readonly":false},{"key":"LocalAuthorizeOffline","value":"false","readonly":false},{"key":"AuthorizationCacheEnabled","value":"false","readonly":false},{"key":"LocalPreAuthorize","value":"false","readonly":false},{"key":"LocalAuthListEnabled","value":"false","readonly":false},{"key":"AuthorizeRemoteTxRequests","value":"false","readonly":false}]}';
  }

  /**
   * Get configuration for Vestel EVC03 DC model
   * @returns JSON string with Vestel EVC03 DC configuration
   */
  getEVC03Configuration(): string {
    return '{"configurationKey":[{"readonly":false,"key":"AllowOfflineTxForUnknownId"},{"readonly":false,"value":"false","key":"AuthorizationCacheEnabled"},{"readonly":false,"value":"false","key":"AuthorizeRemoteTxRequests"},{"readonly":false,"value":"0","key":"BlinkRepeat"},{"readonly":false,"value":"0","key":"ClockAlignedDataInterval"},{"readonly":false,"value":"60","key":"ConnectionTimeOut"},{"readonly":true,"value":"2147483647","key":"GetConfigurationMaxKeys"},{"readonly":false,"value":"300","key":"HeartbeatInterval"},{"readonly":false,"value":"0","key":"LightIntensity"},{"readonly":false,"value":"0","key":"LocalAuthorizeOffline"},{"readonly":false,"value":"false","key":"LocalPreAuthorize"},{"readonly":false,"value":"0","key":"MaxEnergyOnInvalidId"},{"readonly":false,"value":"","key":"MeterValuesAlignedData"},{"readonly":true,"value":"2147483647","key":"MeterValuesAlignedDataMaxLength"},{"readonly":false,"value":"","key":"MeterValuesSampledData"},{"readonly":true,"value":"2147483647","key":"MeterValuesSampledDataMaxLength"},{"readonly":false,"value":"0","key":"MeterValueSampleInterval"},{"readonly":false,"value":"0","key":"MinimumStatusDuration"},{"readonly":true,"value":"2","key":"NumberOfConnectors"},{"readonly":false,"value":"3","key":"ResetRetries"},{"readonly":false,"value":"","key":"ConnectorPhaseRotation"},{"readonly":true,"value":"2147483647","key":"ConnectorPhaseRotationMaxLength"},{"readonly":false,"value":"true","key":"StopTransactionOnEVSideDisconnect"},{"readonly":false,"value":"","key":"StopTransactionOnInvalidId"},{"readonly":false,"value":"","key":"StopTxnAlignedData"},{"readonly":true,"value":"2147483647","key":"StopTxnAlignedDataMaxLength"},{"readonly":false,"value":"","key":"StopTxnSampledData"},{"readonly":true,"value":"2147483647","key":"StopTxnSampledDataMaxLength"},{"readonly":true,"value":"Core,LocalAuthListManagement,FirmwareManagement,Reservation,RemoteTrigger","key":"SupportedFeatureProfiles"},{"readonly":true,"value":"6","key":"SupportedFeatureProfilesMaxLength"},{"readonly":false,"value":"3","key":"TransactionMessageAttempts"},{"readonly":false,"value":"20","key":"TransactionMessageRetryInterval"},{"readonly":false,"value":"true","key":"UnlockConnectorOnEVSideDisconnect"},{"readonly":false,"value":"60","key":"WebSocketPingInterval"},{"readonly":false,"value":"true","key":"LocalAuthListEnabled"},{"readonly":true,"value":"2147483647","key":"LocalAuthListMaxLength"},{"readonly":true,"value":"2147483647","key":"SendLocalListMaxLength"},{"readonly":true,"value":"false","key":"ReserveConnectorZeroSupported"},{"readonly":true,"value":"2147483647","key":"ChargeProfileMaxStackLevel"},{"readonly":true,"value":"Current,Power","key":"ChargingScheduleAllowedChargingRateUnit"},{"readonly":true,"value":"2147483647","key":"ChargingScheduleMaxPeriods"},{"readonly":true,"value":"false","key":"ConnectorSwitch3to1PhaseSupported"},{"readonly":true,"value":"2147483647","key":"MaxChargingProfilesInstalled"},{"readonly":true,"value":"false","key":"AdditionalRootCertificateCheck"},{"readonly":true,"value":"2147483647","key":"CertificateSignedMaxChainSize"},{"readonly":true,"value":"2147483647","key":"CertificateStoreMaxLength"},{"readonly":false,"value":"Vestel","key":"CpoName"},{"readonly":false,"value":"0","key":"SecurityProfile"}]}';
  }

  /**
   * Get configuration for standard Vestel model
   * @returns JSON string with Vestel configuration
   */
  getVestelConfiguration(): string {
    return '{ "configurationKey": [ { "key": "AllowOfflineTxForUnknownId", "readonly": false, "value": "FALSE" }, { "key": "AuthorizationCacheEnabled", "readonly": false, "value": "TRUE" }, { "key": "AuthorizeRemoteTxRequests", "readonly": false, "value": "TRUE" }, { "key": "AuthorizationKey", "readonly": false, "value": "" }, { "key": "BlinkRepeat", "readonly": false, "value": "0" }, { "key": "BootNotificationAfterConnectionLoss", "readonly": false, "value": "TRUE" }, { "key": "ChargeProfileMaxStackLevel", "readonly": true, "value": "100" }, { "key": "ChargingScheduleAllowedChargingRateUnit", "readonly": true, "value": "Current" }, { "key": "ChargingScheduleMaxPeriods", "readonly": true, "value": "100" }, { "key": "ClockAlignedDataInterval", "readonly": false, "value": "0" }, { "key": "MaxPowerChargeComplete", "readonly": false, "value": "0" }, { "key": "MaxTimeChargeComplete", "readonly": false, "value": "0" }, { "key": "ConnectionTimeOut", "readonly": false, "value": "30" }, { "key": "ConnectorPhaseRotation", "readonly": false, "value": "0" }, { "key": "ConnectorPhaseRotationMaxLength", "readonly": false, "value": "0" }, { "key": "ConnectionURL", "readonly": false, "value": "wss://ocpp.test.electricmiles.io/7001270324000303" }, { "key": "DisplayLanguage", "readonly": false, "value": "en" }, { "key": "SupportedDisplayLanguages", "readonly": true, "value": "en/tr/fr/de/it/ro/es/fi/cz/da/he/hu/nl/no/pl/sk/sv/" }]}';
  }
}
