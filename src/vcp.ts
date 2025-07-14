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
  private atessHiddenConfig: Record<string, any> = {};
  private atessPublicConfig: Record<string, any> = {};
  private evc03Config: Record<string, any> = {};
  private vestelConfig: Record<string, any> = {};
  private kebaConfig: Record<string, any> = {};
  private glEviqConfig: Record<string, any> = {};

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

    // Initialize configuration objects from the default JSON responses
    this.initializeVendorConfigurations();
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
   * Initialize vendor configuration objects from the default JSON responses
   */
  private initializeVendorConfigurations(): void {
    // Parse ATESS hidden configuration
    const atessHiddenJson = JSON.parse(this.getAtessHiddenConfiguration());

    atessHiddenJson.configurationKey.forEach((config: any) => {
      this.atessHiddenConfig[config.key] = {
        value: config.value,
        readonly: config.readonly
      };
    });
    
    // Parse ATESS public configuration
    const atessPublicJson = JSON.parse(this.getAtessPublicConfiguration());

    atessPublicJson.configurationKey.forEach((config: any) => {
      this.atessPublicConfig[config.key] = {
        value: config.value,
        readonly: config.readonly
      };
    });
    
    // Parse EVC03 configuration
    const evc03Json = JSON.parse(this.getEVC03Configuration());

    evc03Json.configurationKey.forEach((config: any) => {
      this.evc03Config[config.key] = {
        value: config.value,
        readonly: config.readonly
      };
    });
    
    // Parse Vestel configuration
    const vestelJson = JSON.parse(this.getVestelConfiguration());
    
    vestelJson.configurationKey.forEach((config: any) => {
      this.vestelConfig[config.key] = {
        value: config.value,
        readonly: config.readonly
      };
    });
    
    // Parse Keba configuration
    const kebaJson = JSON.parse(this.getKebaConfiguration());

    kebaJson.configurationKey.forEach((config: any) => {
      this.kebaConfig[config.key] = {
        value: config.value,
        readonly: config.readonly
      };
    });
    
    // Parse GL_EVIQ configuration
    const glEviqJson = JSON.parse(this.getGlEviqConfiguration());

    glEviqJson.configurationKey.forEach((config: any) => {
      this.glEviqConfig[config.key] = {
        value: config.value,
        readonly: config.readonly
      };
    });
  }

  /**
   * Get vendor-specific configuration based on vendor, model and key parameters
   * @param keys Array of configuration keys to filter by
   * @returns JSON string with the appropriate configuration
   */
  public getVendorConfiguration(keys: string[] = []): string {
    if (this.vendor === 'ATESS') {
      if (keys.length > 0) {
        return this.getAtessHiddenConfiguration();
      } else {
        return this.getAtessPublicConfiguration();
      }
    } else if (this.model === 'EVC03' && keys.length === 0) {
      // vestel EVC03 DC
      // crashed adapter due to null value, fixed in adapter 1.16.0 release
      // adapter error: "String.toLowerCase()\" because the return value of \"io.solidstudio.emobility.ocpp.model_1_6.common.KeyValue.getValue()\" is null\
      return this.getEVC03Configuration();
    } else if (this.vendor === 'Vestel' && keys.length === 0) {
      return this.getVestelConfiguration();
    } else if (this.vendor === "Keba" && keys.length === 0) {
      return this.getKebaConfiguration();
    } else if (this.vendor === "GL_EVIQ" && keys.length === 0) {
      return this.getGlEviqConfiguration();
    }
    
    return '{"configurationKey": []}';
  }

  /**
   * Get configuration for ATESS vendor with specific keys
   * @returns JSON string with hidden ATESS keys
   */
  public getAtessHiddenConfiguration(): string {
    // Convert stored configuration to JSON response format
    const configKeys = Object.keys(this.atessHiddenConfig);

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return '{"configurationKey":[{"key":"G_LowPowerReserveEnable","value":"Disable","readonly":false},{"key":"UnlockConnectorOnEVSideDisconnect","value":"true","readonly":false},{"key":"G_PeriodTime","value":"time1=11:00-16:00&amp;time2=16:01-10:59","readonly":false},{"key":"G_OffPeakEnable","value":"Disable","readonly":false},{"key":"G_OffPeakCurr","value":"","readonly":false},{"key":"G_ChargerNetMac","value":"50:88:C1:3A:23:13","readonly":false},{"key":"AuthorizationCacheEnabled","value":"false","readonly":false},{"key":"AuthorizeRemoteTxRequests","value":"false","readonly":true},{"key":"ConnectionTimeOut","value":"90","readonly":false},{"key":"LocalAuthListEnabled","value":"false","readonly":false},{"key":"LocalAuthorizeOffline","value":"false","readonly":false},{"key":"LocalPreAuthorize","value":"false","readonly":false},{"key":"StopTransactionOnInvalidId","value":"true","readonly":false}]}';
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.atessHiddenConfig[key].value,
      readonly: this.atessHiddenConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for ATESS vendor with no specific keys
   * @returns JSON string with public ATESS keys
   */
  public getAtessPublicConfiguration(): string {
    // Convert stored configuration to JSON response format
    const configKeys = Object.keys(this.atessPublicConfig);

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return '{"configurationKey":[{"key":"G_ChargerID","value":"IOG0B21174","readonly":false},{"key":"G_ChargerRate","value":"1.00","readonly":false},{"key":"G_ChargerLanguage","value":"English","readonly":false},{"key":"G_MaxCurrent","value":"32.00","readonly":false},{"key":"G_ChargerMode","value":"1","readonly":false},{"key":"G_CardPin","value":"242007","readonly":false},{"key":"G_Authentication","value":"12354678","readonly":false},{"key":"G_ChargerNetIP","value":"192.168.1.5","readonly":false},{"key":"G_MaxTemperature","value":"85","readonly":false},{"key":"G_ExternalLimitPower","value":"45","readonly":false},{"key":"G_ExternalLimitPowerEnable","value":"0","readonly":false},{"key":"G_ExternalSamplingCurWring","value":"0","readonly":false},{"key":"G_SolarMode","value":"0","readonly":false},{"key":"G_SolarLimitPower","value":"1.76","readonly":false},{"key":"G_PeakValleyEnable","value":"1","readonly":false},{"key":"G_AutoChargeTime","value":"00:00-00:00","readonly":false},{"key":"G_RCDProtection","value":"6","readonly":false},{"key":"G_PowerMeterAddr","value":"1","readonly":false},{"key":"G_PowerMeterType","value":"Acrel DDS1352","readonly":false},{"key":"G_TimeZone","value":"UTC+00:00","readonly":false},{"key":"G_ServerURL","value":"ws://ocpp.electricmiles.io/","readonly":false},{"key":"G_RandDelayChargeTime","value":"600","readonly":false},{"key":"HeartbeatInterval","value":"300","readonly":false},{"key":"MeterValueSampleInterval","value":"60","readonly":false},{"key":"WebSocketPingInterval","value":"30","readonly":false},{"key":"ConnectionTimeOut","value":"90","readonly":false},{"key":"LocalAuthorizeOffline","value":"false","readonly":false},{"key":"AuthorizationCacheEnabled","value":"false","readonly":false},{"key":"LocalPreAuthorize","value":"false","readonly":false},{"key":"LocalAuthListEnabled","value":"false","readonly":false},{"key":"AuthorizeRemoteTxRequests","value":"false","readonly":false}]}';
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.atessPublicConfig[key].value,
      readonly: this.atessPublicConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for Vestel EVC03 DC model
   * @returns JSON string with Vestel EVC03 DC configuration
   */
  public getEVC03Configuration(): string {
    // Convert stored configuration to JSON response format
    const configKeys = Object.keys(this.evc03Config);

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return '{"configurationKey":[{"readonly":false,"key":"AllowOfflineTxForUnknownId"},{"readonly":false,"value":"false","key":"AuthorizationCacheEnabled"},{"readonly":false,"value":"false","key":"AuthorizeRemoteTxRequests"},{"readonly":false,"value":"0","key":"BlinkRepeat"},{"readonly":false,"value":"0","key":"ClockAlignedDataInterval"},{"readonly":false,"value":"60","key":"ConnectionTimeOut"},{"readonly":true,"value":"2147483647","key":"GetConfigurationMaxKeys"},{"readonly":false,"value":"300","key":"HeartbeatInterval"},{"readonly":false,"value":"0","key":"LightIntensity"},{"readonly":false,"value":"0","key":"LocalAuthorizeOffline"},{"readonly":false,"value":"false","key":"LocalPreAuthorize"},{"readonly":false,"value":"0","key":"MaxEnergyOnInvalidId"},{"readonly":false,"value":"","key":"MeterValuesAlignedData"},{"readonly":true,"value":"2147483647","key":"MeterValuesAlignedDataMaxLength"},{"readonly":false,"value":"","key":"MeterValuesSampledData"},{"readonly":true,"value":"2147483647","key":"MeterValuesSampledDataMaxLength"},{"readonly":false,"value":"0","key":"MeterValueSampleInterval"},{"readonly":false,"value":"0","key":"MinimumStatusDuration"},{"readonly":true,"value":"2","key":"NumberOfConnectors"},{"readonly":false,"value":"3","key":"ResetRetries"},{"readonly":false,"value":"","key":"ConnectorPhaseRotation"},{"readonly":true,"value":"2147483647","key":"ConnectorPhaseRotationMaxLength"},{"readonly":false,"value":"true","key":"StopTransactionOnEVSideDisconnect"},{"readonly":false,"value":"","key":"StopTransactionOnInvalidId"},{"readonly":false,"value":"","key":"StopTxnAlignedData"},{"readonly":true,"value":"2147483647","key":"StopTxnAlignedDataMaxLength"},{"readonly":false,"value":"","key":"StopTxnSampledData"},{"readonly":true,"value":"2147483647","key":"StopTxnSampledDataMaxLength"},{"readonly":true,"value":"Core,LocalAuthListManagement,FirmwareManagement,Reservation,RemoteTrigger","key":"SupportedFeatureProfiles"},{"readonly":true,"value":"6","key":"SupportedFeatureProfilesMaxLength"},{"readonly":false,"value":"3","key":"TransactionMessageAttempts"},{"readonly":false,"value":"20","key":"TransactionMessageRetryInterval"},{"readonly":false,"value":"true","key":"UnlockConnectorOnEVSideDisconnect"},{"readonly":false,"value":"60","key":"WebSocketPingInterval"},{"readonly":false,"value":"true","key":"LocalAuthListEnabled"},{"readonly":true,"value":"2147483647","key":"LocalAuthListMaxLength"},{"readonly":true,"value":"2147483647","key":"SendLocalListMaxLength"},{"readonly":true,"value":"false","key":"ReserveConnectorZeroSupported"},{"readonly":true,"value":"2147483647","key":"ChargeProfileMaxStackLevel"},{"readonly":true,"value":"Current,Power","key":"ChargingScheduleAllowedChargingRateUnit"},{"readonly":true,"value":"2147483647","key":"ChargingScheduleMaxPeriods"},{"readonly":true,"value":"false","key":"ConnectorSwitch3to1PhaseSupported"},{"readonly":true,"value":"2147483647","key":"MaxChargingProfilesInstalled"},{"readonly":true,"value":"false","key":"AdditionalRootCertificateCheck"},{"readonly":true,"value":"2147483647","key":"CertificateSignedMaxChainSize"},{"readonly":true,"value":"2147483647","key":"CertificateStoreMaxLength"},{"readonly":false,"value":"Vestel","key":"CpoName"},{"readonly":false,"value":"0","key":"SecurityProfile"},{"readonly":false,"value":"160","key":"VEC_failSafeModePowerLimit"},{"readonly":false,"value":"false","key":"VEC_continueChargingAfterPowerLoss"},{"readonly":false,"value":"false","key":"VEC_failSafeModePowerLimitationEnable"},{"readonly":false,"value":"120","key":"VEC_chargePointMaxPower"},{"readonly":false,"value":"false","key":"VEC_proximitySensor"},{"readonly":false,"value":"0","key":"VEC_proximityDetectionValue"},{"readonly":false,"value":"Time based","key":"VEC_outdoorLighting"},{"readonly":false,"value":"[]","key":"VEC_outdoorLightingTimeSettings"},{"readonly":false,"value":"SetOnThreshold 20","key":"VEC_outdoorLightingThreshold"},{"readonly":false,"value":"5","key":"VEC_lowTempThreshold"},{"readonly":false,"value":"12","key":"VEC_hysteresis"},{"readonly":false,"value":"prepaidIdTag","key":"VEC_prepaidIdTag"},{"readonly":false,"value":"0.0","key":"VEC_averagePowerPricePerMinute_CHADEMO"},{"readonly":false,"value":"0.0","key":"VEC_energyUnitPricePerKWh_SCHUKO"},{"readonly":false,"value":"10","key":"VEC_maxProvision_CHADEMO"},{"readonly":false,"value":"0.0","key":"VEC_maxProvision_AC_43"},{"readonly":false,"value":"10","key":"VEC_maxProvision_AC_22"},{"readonly":false,"value":"0.0","key":"VEC_fixedPrice_AC_22"},{"readonly":false,"value":"0.0","key":"VEC_fixedPrice_AC_43"},{"readonly":false,"value":"10","key":"VEC_maxProvision_CCS"},{"readonly":false,"value":"0.0","key":"VEC_fixedPrice_CHADEMO"},{"readonly":false,"value":"0.0","key":"VEC_energyUnitPricePerKWh_CHADEMO"},{"readonly":false,"value":"0.0","key":"VEC_averagePowerPricePerMinute_CCS"},{"readonly":false,"value":"0.0","key":"VEC_parkingUnitPricePerMinute_CHADEMO"},{"readonly":false,"value":"0.0","key":"VEC_fixedPrice_CCS"},{"readonly":false,"value":"0.0","key":"VEC_averagePowerPricePerMinute_SCHUKO"},{"readonly":false,"value":"0.0","key":"VEC_energyUnitPricePerKWh_AC_43"},{"readonly":false,"value":"0.0","key":"VEC_parkingUnitPricePerMinute_SCHUKO"},{"readonly":false,"value":"0.0","key":"VEC_parkingUnitPricePerMinute_CCS"},{"readonly":false,"value":"0.0","key":"VEC_energyUnitPricePerKWh_AC_22"},{"readonly":false,"value":"0.0","key":"VEC_parkingUnitPricePerMinute_AC_22"},{"readonly":false,"value":"0.0","key":"VEC_parkingUnitPricePerMinute_AC_43"},{"readonly":false,"value":"0.0","key":"VEC_fixedPrice_SCHUKO"},{"readonly":false,"value":"0.0","key":"VEC_averagePowerPricePerMinute_AC_22"},{"readonly":false,"value":"0.0","key":"VEC_averagePowerPricePerMinute_AC_43"},{"readonly":false,"value":"10","key":"VEC_maxProvision_SCHUKO"},{"readonly":false,"value":"0.0","key":"VEC_energyUnitPricePerKWh_CCS"},{"readonly":false,"value":"Auto","key":"VEC_webUIConnectionInterface"},{"readonly":false,"value":"Auto","key":"VEC_hmiConnectionInterface"},{"readonly":false,"value":"true","key":"VEC_stopChargingWithoutCard"},{"readonly":false,"value":"10","key":"VEC_ocppWebsocketReconnectTimeout"},{"readonly":false,"value":"fixedIdTag","key":"VEC_fixedIdTag"},{"readonly":false,"value":"-1","key":"VEC_fixedTransactionIdForDropped"},{"readonly":false,"value":"ws://ocpp.electricmiles.io/","key":"VEC_ocppServerURL"},{"readonly":false,"value":"","key":"VEC_whiteListedIdTags"},{"readonly":false,"value":"0","key":"VEC_transactionalMessageDropBehavior"},{"readonly":false,"value":"false","key":"VEC_allowRandomIdToStopTransactionWhenOffline"},{"readonly":false,"value":"true","key":"VEC_remainingTimePostDataTransferMessage"},{"readonly":false,"value":"5","key":"VEC_operationMode"},{"readonly":false,"value":"false","key":"VEC_sendDataTransferMeterConfigurationForNonEichre"},{"readonly":false,"value":"1.6","key":"VEC_ocppVersion"},{"readonly":false,"value":"true","key":"VEC_autoChargeSupport"},{"readonly":false,"value":"10","key":"VEC_maximumDiagnosticsLogTime"},{"readonly":false,"value":"7001350225000001","key":"VEC_ocppChargePointID"},{"readonly":false,"value":"false","key":"VEC_bootNotificationAfterConnectionLoss"},{"readonly":false,"value":"5000","key":"VEC_ocppOutgoingRequestTimeout"},{"readonly":false,"value":"","key":"VEC_autoChargeMACIdPrefix"},{"readonly":false,"value":"false","key":"VEC_sendTotalPowerValue"},{"readonly":false,"value":"4605","key":"VEC_cellularPin"},{"readonly":false,"value":"10","key":"VEC_cellularPriority"},{"readonly":false,"value":"true","key":"VEC_cellularEnable"},{"readonly":false,"value":"0","key":"VEC_preferredCellularMode"},{"readonly":false,"value":"eapn1.net","key":"VEC_cellularAPN"},{"readonly":false,"value":"Electric","key":"VEC_cellularUsername"},{"readonly":false,"value":"true","key":"VEC_alternativePaymentMethod"},{"readonly":false,"value":"false","key":"VEC_vpnEnable"},{"readonly":false,"value":"5.5.5.5","key":"VEC_vpnHostIP"},{"readonly":false,"value":"certificate","key":"VEC_vpnCertificate"},{"readonly":false,"value":"vestel","key":"VEC_vpnName"},{"readonly":false,"value":"Static","key":"VEC_backlightDimmingMode"},{"readonly":false,"value":"{\\"MediumThreshold\\":20,\\"HighThreshold\\":100}","key":"VEC_backlightSensorBasedThreshold"},{"readonly":false,"value":"Medium","key":"VEC_backlightStaticDimmingLevel"},{"readonly":false,"value":"true","key":"VEC_reducedBrightnessInInactiveMode"},{"readonly":false,"value":"20","key":"VEC_minBrightnessValue"},{"readonly":false,"value":"[]","key":"VEC_backlightTimeBasedTimeSettings"},{"readonly":false,"value":"","key":"VEC_ethernetDefaultGateway"},{"readonly":false,"value":"","key":"VEC_ethernetSecondaryDNS"},{"readonly":false,"value":"255.255.255.0","key":"VEC_ethernetNetmask"},{"readonly":false,"value":"1000","key":"VEC_ethernetPriority"},{"readonly":false,"value":"","key":"VEC_ethernetPrimaryDNS"},{"readonly":false,"value":"false","key":"VEC_ethernetEnableDHCP"},{"readonly":false,"value":"192.168.0.10","key":"VEC_ethernetIP"},{"readonly":false,"value":"true","key":"VEC_rightLogo"},{"readonly":false,"value":"true","key":"VEC_leftLogo"},{"readonly":false,"value":"100","key":"VEC_wifiPriority"},{"readonly":false,"value":"4.4.4.4","key":"VEC_wifiPrimaryDNS"},{"readonly":false,"value":"192.168.1.2","key":"VEC_wifiIP"},{"readonly":false,"value":"192.168.1.1","key":"VEC_wifiDefaultGateway"},{"readonly":false,"value":"","key":"VEC_wifiSSID"},{"readonly":false,"value":"","key":"VEC_wifiSecurity"},{"readonly":false,"value":"true","key":"VEC_wifiEnableDHCP"},{"readonly":false,"value":"255.255.255.0","key":"VEC_wifiNetmask"},{"readonly":false,"value":"8.8.8.8","key":"VEC_wifiSecondaryDNS"},{"readonly":false,"value":"true","key":"VEC_wifiEnabled"},{"readonly":false,"value":"19","key":"VEC_maximumCurrent"},{"readonly":false,"value":"false","key":"VEC_rebootIfUnableToConnect"},{"readonly":false,"value":"false","key":"VEC_noStartChargeIfDoorOpened"},{"readonly":false,"value":"false","key":"VEC_waitForCompleteTransactionBeforeSoftReset"},{"readonly":false,"value":"0","key":"VEC_defaultLanguage"},{"readonly":false,"value":"163X63","key":"VEC_displayLogoDimension"},{"readonly":false,"value":"","key":"VEC_excludedLanguages"},{"readonly":false,"value":"","key":"VEC_customerServiceNumber"},{"readonly":false,"value":"false","key":"VEC_showCpIdOnHmi"},{"readonly":false,"value":"tr","key":"VEC_timeZone"},{"readonly":false,"value":"2","key":"VEC_standbyLedStatus"},{"readonly":false,"value":",","key":"VEC_qrCodeDelimiter"},{"readonly":false,"value":"30","key":"VEC_tiltThreshold"}]}';
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.evc03Config[key].value,
      readonly: this.evc03Config[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard Vestel model
   * @returns JSON string with Vestel configuration
   */
  public getVestelConfiguration(): string {
    // Convert stored configuration to JSON response format
    const configKeys = Object.keys(this.vestelConfig);

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return '{ "configurationKey": [ { "key": "AllowOfflineTxForUnknownId", "readonly": false, "value": "FALSE" }, { "key": "AuthorizationCacheEnabled", "readonly": false, "value": "TRUE" }, { "key": "AuthorizeRemoteTxRequests", "readonly": false, "value": "TRUE" }, { "key": "AuthorizationKey", "readonly": false, "value": "" }, { "key": "BlinkRepeat", "readonly": false, "value": "0" }, { "key": "BootNotificationAfterConnectionLoss", "readonly": false, "value": "TRUE" }, { "key": "ChargeProfileMaxStackLevel", "readonly": true, "value": "100" }, { "key": "ChargingScheduleAllowedChargingRateUnit", "readonly": true, "value": "Current" }, { "key": "ChargingScheduleMaxPeriods", "readonly": true, "value": "100" }, { "key": "ClockAlignedDataInterval", "readonly": false, "value": "0" }, { "key": "MaxPowerChargeComplete", "readonly": false, "value": "0" }, { "key": "MaxTimeChargeComplete", "readonly": false, "value": "0" }, { "key": "ConnectionTimeOut", "readonly": false, "value": "30" }, { "key": "ConnectorPhaseRotation", "readonly": false, "value": "0" }, { "key": "ConnectorPhaseRotationMaxLength", "readonly": false, "value": "0" }, { "key": "ConnectionURL", "readonly": false, "value": "wss://ocpp.test.electricmiles.io/7001270324000303" }, { "key": "DisplayLanguage", "readonly": false, "value": "en" }, { "key": "SupportedDisplayLanguages", "readonly": true, "value": "en/tr/fr/de/it/ro/es/fi/cz/da/he/hu/nl/no/pl/sk/sv/" }, { "key": "ConnectorSwitch3to1PhaseSupported", "readonly": true, "value": "FALSE" }, { "key": "GetConfigurationMaxKeys", "readonly": true, "value": "60" }, { "key": "HeartbeatInterval", "readonly": false, "value": "300" }, { "key": "LightIntensity", "readonly": false, "value": "3" }, { "key": "LocalAuthListEnabled", "readonly": false, "value": "TRUE" }, { "key": "LocalAuthListMaxLength", "readonly": true, "value": "10000" }, { "key": "LocalAuthorizeOffline", "readonly": false, "value": "TRUE" }, { "key": "LocalPreAuthorize", "readonly": false, "value": "TRUE" }, { "key": "MaxChargingProfilesInstalled", "readonly": true, "value": "5" }, { "key": "MaxEnergyOnInvalidId", "readonly": false, "value": "0" }, { "key": "MeterValuesAlignedData", "readonly": false, "value": "Energy.Active.Import.Register" }, { "key": "MeterValuesAlignedDataMaxLength", "readonly": false, "value": "100" }, { "key": "MeterValuesSampledData", "readonly": false, "value": "Current.Import,Energy.Active.Import.Register,Voltage" }, { "key": "MeterValuesSampledDataMaxLength", "readonly": true, "value": "4" }, { "key": "MeterValueSampleInterval", "readonly": false, "value": "60" }, { "key": "MinimumStatusDuration", "readonly": false, "value": "0" }, { "key": "NumberOfConnectors", "readonly": true, "value": "1" }, { "key": "ReserveConnectorZeroSupported", "readonly": true, "value": "TRUE" }, { "key": "ResetRetries", "readonly": false, "value": "3" }, { "key": "SendLocalListMaxLength", "readonly": true, "value": "10000" }, { "key": "StopTransactionOnEVSideDisconnect", "readonly": false, "value": "TRUE" }, { "key": "StopTransactionOnInvalidId", "readonly": false, "value": "FALSE" }, { "key": "StopTxnAlignedData", "readonly": false, "value": "Energy.Active.Import.Register" }, { "key": "StopTxnAlignedDataMaxLength", "readonly": true, "value": "0" }, { "key": "StopTxnSampledData", "readonly": false, "value": "Energy.Active.Import.Register" }, { "key": "StopTxnSampledDataMaxLength", "readonly": true, "value": "0" }, { "key": "SupportedFeatureProfiles", "readonly": true, "value": "Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger" }, { "key": "SupportedFeatureProfilesMaxLength", "readonly": true, "value": "120" }, { "key": "TransactionMessageAttempts", "readonly": false, "value": "3" }, { "key": "TransactionMessageRetryInterval", "readonly": false, "value": "20" }, { "key": "UnlockConnectorOnEVSideDisconnect", "readonly": false, "value": "TRUE" }, { "key": "WebSocketPingInterval", "readonly": false, "value": "10" }, { "key": "FreeModeActive", "readonly": false, "value": "FALSE" }, { "key": "FreeModeRFID", "readonly": false, "value": "VestelFreeMode" }, { "key": "ContinueChargingAfterPowerLoss", "readonly": false, "value": "True" }, { "key": "SendTotalPowerValue", "readonly": false, "value": "FALSE" }, { "key": "LockableCable", "readonly": false, "value": "False" }, { "key": "UnbalancedLoadDetection", "readonly": false, "value": "False" }, { "key": "DisplayBacklightLevel", "readonly": false, "value": "mid" }, { "key": "DisplayBacklightLevelOptions", "readonly": true, "value": "veryLow,low,mid,high,timeBased,userInteraction" }, { "key": "DisplayBacklightSunrise", "readonly": false, "value": "07:00" }, { "key": "DisplayBacklightSunset", "readonly": false, "value": "19:00" }, { "key": "LedDimmingLevel", "readonly": false, "value": "mid" }, { "key": "LedDimmingLevelOptions", "readonly": true, "value": "veryLow,low,mid,high,timeBased" }, { "key": "LedDimmingSunrise", "readonly": false, "value": "07:00" }, { "key": "LedDimmingSunset", "readonly": false, "value": "19:00" }, { "key": "StandbyLed", "readonly": false, "value": "False" }, { "key": "RfidEndianness", "readonly": false, "value": "big-endian" }, { "key": "Location", "readonly": false, "value": "indoor" }, { "key": "PowerOptimizer", "readonly": false, "value": "0" }, { "key": "LoadSheddingMinimumCurrent", "readonly": false, "value": "8" }, { "key": "UnbalancedLoadDetectionMaxCurrent", "readonly": false, "value": "20" }, { "key": "CurrentLimiterValue", "readonly": false, "value": "32" }, { "key": "CurrentLimiterPhase", "readonly": false, "value": "onePhase" }, { "key": "DailyReboot", "readonly": false, "value": "TRUE" }, { "key": "publicKey", "readonly": true, "value": "" }, { "key": "RandomisedDelayMaxSeconds", "readonly": false, "value": "600" }, { "key": "OffPeakCharging", "readonly": false, "value": "False" }, { "key": "OffPeakChargingWeekend", "readonly": false, "value": "False" }, { "key": "OffPeakChargingTimeSlots", "readonly": false, "value": "11:00-16:00,16:00-11:00" }, { "key": "ContinueAfterOffPeakHour", "readonly": false, "value": "False" }, { "key": "ForcedCharging", "readonly": false, "value": "" }, { "key": "CurrentSessionRandomDelay", "readonly": true, "value": "0" }, { "key": "timeZone", "readonly": false, "value": "Europe/London" }, { "key": "apnInfo", "readonly": false, "value": ",," }, { "key": "UKSmartChargingEnabled", "readonly": false, "value": "FALSE" }, { "key": "installationErrorEnable", "readonly": false, "value": "TRUE" }, { "key": "randomisedDelayAtOffPeakEnd", "readonly": false, "value": "False" }, { "key": "RandomizedDelayMax", "readonly": false, "value": "600" }, { "key": "SendDataTransferMeterConfigurationForNonEichrecht", "readonly": false, "value": "FALSE" }, { "key": "NewTransactionAfterPowerLoss", "readonly": false, "value": "FALSE" }, { "key": "DailyRebootTime", "readonly": false, "value": "03:00" }, { "key": "DailyRebootType", "readonly": false, "value": "SOFT" }, { "key": "LEDTimeoutEnable", "readonly": false, "value": "" }, { "key": "Operator", "readonly": true, "value": "" }, { "key": "ConnectionType", "readonly": true, "value": "" }, { "key": "SignalStrength", "readonly": true, "value": "" }, { "key": "Rsrp", "readonly": true, "value": "" }, { "key": "Rsrq", "readonly": true, "value": "" }, { "key": "Sinr", "readonly": true, "value": "" }, { "key": "FirewallSettings", "readonly": false, "value": "" }, { "key": "WifiStrength", "readonly": true, "value": "-46dBm" }, { "key": "WifiLevel", "readonly": true, "value": "4" }, { "key": "WifiFreq", "readonly": true, "value": "5G" }, { "key": "FollowTheSunEnabled", "readonly": false, "value": "Disable" }, { "key": "FollowTheSunMode", "readonly": false, "value": "SunOnly" }, { "key": "FollowTheSunAutoPhaseSwitching", "readonly": false, "value": "Enable" } ] }';
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.vestelConfig[key].value,
      readonly: this.vestelConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard Keba model
   * @returns JSON string with Vestel configuration
   */
  public getKebaConfiguration(): string {
    // Convert stored configuration to JSON response format
    const configKeys = Object.keys(this.kebaConfig);

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return '{"configurationKey":[{"key":"PVEnable","readonly":false,"value":"false"},{"key":"PVMinShare","readonly":false,"value":"0"},{"key":"PVPreChargeTime","readonly":false,"value":"0"},{"key":"PVIgnoreX1","readonly":false,"value":"false"},{"key":"PVThresholdImport","readonly":false,"value":"400000"},{"key":"PVThresholdExport","readonly":false,"value":"400000"},{"key":"PVDelay","readonly":false,"value":"300"},{"key":"MaxAvailableCurrent","readonly":false,"value":"100000"},{"key":"MaxDurationChargingPause","readonly":false,"value":"900"},{"key":"NominalVoltage","readonly":false,"value":"230"},{"key":"MaximumAsymmetricLoadCurrent","readonly":false,"value":"0"},{"key":"AsymmNetworkEnabled","readonly":false,"value":"false"},{"key":"AsymmNetworkCheckerTaskInitialDelay","readonly":false,"value":"15"},{"key":"AsymmNetworkCheckerTaskRetryInterval","readonly":false,"value":"10"},{"key":"PowerControlThreshold","readonly":false,"value":"1000"},{"key":"TimeSynchronizationTolerance","readonly":false,"value":"30"},{"key":"PwmMinCurrentDefault","readonly":false,"value":"6000"},{"key":"ChargeProfileMaxStackLevel","readonly":true,"value":"32"},{"key":"ChargingScheduleAllowedChargingRateUnit","readonly":true,"value":"Current"},{"key":"ChargingScheduleMaxPeriods","readonly":true,"value":"32"},{"key":"MaxChargingProfilesInstalled","readonly":true,"value":"64"},{"key":"DelayAfterInitialCalculation","readonly":true,"value":"30"},{"key":"ConnectionTimeOut","readonly":false,"value":"60"},{"key":"UpdateFirmwareChecksumCheckActivated","readonly":false,"value":"false"},{"key":"ClockAlignedDataInterval","readonly":false,"value":"900"},{"key":"HostConnectorExternalMeterInterval","readonly":false,"value":"180"},{"key":"HostConnectorClockAlignedDelayPerc","readonly":false,"value":"0"},{"key":"MeasurementUpdateEvtInterval","readonly":false,"value":"30"},{"key":"MeterValueSampleInterval","readonly":false,"value":"60"},{"key":"HostConnectorMeterValueSendInterval","readonly":false,"value":"60"},{"key":"MeterValuesExternalData","readonly":false,"value":"Energy.Active.Import.Register, Energy.Active.Export.Register"},{"key":"HostConnectorSendStateChangeMeterValues","readonly":false,"value":"false"},{"key":"MeasurementUpdateEvtCurrentThreshold","readonly":false,"value":"1000"},{"key":"AuthorizationEnabled","readonly":false,"value":"false"},{"key":"AuthorizationModeOnline","readonly":false,"value":"FirstLocal"},{"key":"AuthorizationModeOffline","readonly":false,"value":"OfflineLocalAuthorization"},{"key":"LocalPreAuthorize","readonly":false,"value":"true"},{"key":"LocalAuthorizeOffline","readonly":false,"value":"true"},{"key":"AllowOfflineTxForUnknownId","readonly":false,"value":"false"},{"key":"LocalAuthListEnabled","readonly":true,"value":"true"},{"key":"LocalAuthListMaxLength","readonly":true,"value":"1024"},{"key":"SendLocalListMaxLength","readonly":true,"value":"1024"},{"key":"ResumeSessionAfterPowerCut","readonly":false,"value":"true"},{"key":"Price","readonly":false,"value":"0.0"},{"key":"PreauthorizedAmount","readonly":false,"value":"0.0"},{"key":"DirectPaymentLegalText","readonly":false,"value":""},{"key":"DirectPaymentAllowedFilenames","readonly":true,"value":"qrcode.png,qrcode.gif,standby.mp4,standby.jpg,standby.gif,standby.png,startscreen.png,startscreen.gif,startscreen.jpg,startscreen.mp4,whitelabel.zip"},{"key":"DirectPaymentMaxFileSize","readonly":true,"value":"10"},{"key":"DirectPaymentTariffModel","readonly":false,"value":"PerEnergyConsumed"},{"key":"DirectPaymentStartFee","readonly":false,"value":"0.0"},{"key":"ChargepointLocation","readonly":false,"value":""},{"key":"PaymentTerminalPwd","readonly":false,"value":"****"},{"key":"DirectPaymentContactPhone","readonly":false,"value":"08001234456"},{"key":"DirectPaymentContactEmail","readonly":false,"value":"support@keba.com"},{"key":"DirectPaymentNameOnReceipt","readonly":false,"value":"KEBA AG"},{"key":"DirectPaymentBlockingFee","readonly":false,"value":"0.0"},{"key":"DirectPaymentBlockingFeeTime","readonly":false,"value":"0.0"},{"key":"DirectPaymentBlockingFeeTimeUnit","readonly":false,"value":"min"},{"key":"DirectPaymentBlockingFeeRunningTime","readonly":false,"value":"0.0"},{"key":"DirectPaymentBlockingFeeRunningTimeTimeUnit","readonly":false,"value":"min"},{"key":"ExternalMeterSendInterval","readonly":false,"value":"5"},{"key":"MaxDaysOfLogs","readonly":false,"value":"90"},{"key":"LogLevelDebug","readonly":false,"value":"false"},{"key":"LogLevelDebugTime","readonly":false,"value":"3"},{"key":"ConnectorPhaseRotation","readonly":false,"value":"1.Rxx"},{"key":"PermanentlyLocked","readonly":false,"value":"1.false"},{"key":"ExternalMeterHomegridProviders","readonly":false,"value":"ABB | M4M,TQ-Systems | EM420 compatible,Siemens | 7KT1260,KOSTAL | KSEM,KeContact E10,Carlo Gavazzi | EM 24,Fronius Smart Meter TS 65A via Symo GEN24,Gossen Metrawatt | EMX228X/EM238X,Herholdt | ECSEM113,Janitza | ECSEM114MID,ABB | B23312-100,Janitza | B23312-10J,Leviton | S3500,Siemens | 7KM2200"},{"key":"HostConnectorType","readonly":true,"value":"OCPP_16_JSON"},{"key":"HeartBeatInterval","readonly":false,"value":"600"},{"key":"HeartbeatNoOfRetries","readonly":false,"value":"15"},{"key":"HostConnectorRetryInterval","readonly":false,"value":"60"},{"key":"TransactionMessageAttempts","readonly":false,"value":"720"},{"key":"TransactionMessageRetryInterval","readonly":false,"value":"60"},{"key":"HostConnectorDurationMessageStorage","readonly":false,"value":"43200"},{"key":"HostConnectorSendMeterValuesImmediately","readonly":false,"value":"true"},{"key":"HostConnectorSendClockAlignedExternalMeter","readonly":false,"value":"false"},{"key":"TimeDateSyncMethod","readonly":false,"value":"Automatic"},{"key":"HostConnectorTimezone","readonly":false,"value":"Etc/UTC"},{"key":"TimeZone","readonly":false,"value":"Europe/Vienna"},{"key":"HostConnectorUseCentralTime","readonly":false,"value":"true"},{"key":"HostConnectorReconnectInterval","readonly":false,"value":"30"},{"key":"SetSecureIncomingConnection","readonly":false,"value":"false"},{"key":"SetSecureOutgoingConnection","readonly":false,"value":"false"},{"key":"DisableCertificateValidation","readonly":false,"value":"false"},{"key":"DisableHostnameVerification","readonly":false,"value":"false"},{"key":"TruststorePath","readonly":true,"value":""},{"key":"TruststorePassword","readonly":true,"value":"cs/cHLtx/03xpQblnJcZgQ=="},{"key":"ChargeBoxIdentity","readonly":false,"value":"27017327"},{"key":"CentralSystemAddress","readonly":false,"value":"ocpp.test.electricmiles.io"},{"key":"CentralSystemPort","readonly":false,"value":"80"},{"key":"CentralSystemPath","readonly":false,"value":""},{"key":"HostConnectorCentralSystemAuthorizationMethod","readonly":false,"value":"None"},{"key":"HostConnectorCentralSystemUserId","readonly":false,"value":""},{"key":"HostConnectorCentralSystemPassword","readonly":false,"value":""},{"key":"HostConnectorCentralSystemConnectTimeout","readonly":false,"value":"60"},{"key":"HostConnectorCentralSystemReadTimeout","readonly":false,"value":"60"},{"key":"ChargepointAddress","readonly":false,"value":"localhost"},{"key":"ChargepointPort","readonly":false,"value":"12801"},{"key":"HostConnectorChargepointPreferredInterface","readonly":false,"value":"eth0"},{"key":"HostConnectorChargepointServiceAuthorizationMethod","readonly":false,"value":"None"},{"key":"HostConnectorChargepointServiceUserId","readonly":false,"value":""},{"key":"HostConnectorChargepointServicePassword","readonly":false,"value":""},{"key":"OcppChargepointServiceInitRetryPeriodInSeconds","readonly":false,"value":"30"},{"key":"StopTransactionOnInvalidId","readonly":false,"value":"true"},{"key":"DefaultTokenID","readonly":false,"value":"predefinedTokenId"},{"key":"WebSocketPingInterval","readonly":false,"value":"0"},{"key":"AuthorizationKey","readonly":false,"value":"DummyAuthorizationKey"},{"key":"AmountConnectors","readonly":false,"value":"1"},{"key":"NumberOfConnectors","readonly":false,"value":"1"},{"key":"ExternalMeterHomegridConfigured","readonly":false,"value":"false"},{"key":"ExternalMeterHomegridIpAddress","readonly":false,"value":""},{"key":"ExternalMeterHomegridPort","readonly":false,"value":""},{"key":"ExternalMeterHomegridProvider","readonly":false,"value":""},{"key":"ExternalMeterHomegridUnit","readonly":false,"value":""},{"key":"ExternalMeterHomegridImax1","readonly":false,"value":""},{"key":"ExternalMeterHomegridImax2","readonly":false,"value":""},{"key":"ExternalMeterHomegridImax3","readonly":false,"value":""},{"key":"ExternalMeterHomegridPmax","readonly":false,"value":""},{"key":"ExternalMeterHomegridComLost","readonly":false,"value":""},{"key":"ExternalMeterHomegridDurationForIncrease","readonly":false,"value":"300"},{"key":"ExternalMeterHomegridDurationForDecrease","readonly":false,"value":"10"},{"key":"ExternalMeterHomegridLMGMTEnabled","readonly":false,"value":"true"},{"key":"ChargePointModel","readonly":true,"value":"KC-P30-GS2400U2-M0A"},{"key":"ChargePointSerialNumber","readonly":true,"value":"27017327"},{"key":"FirmwareVersion","readonly":true,"value":"1.18.0"},{"key":"RemoteServiceInterface","readonly":false,"value":"true"},{"key":"GsmSimPin","readonly":false,"value":""},{"key":"GsmApn","readonly":false,"value":"a1.net"},{"key":"GsmApnUsername","readonly":false,"value":"ppp@A1plus.at"},{"key":"GsmApnPassword","readonly":false,"value":"ppp"},{"key":"GsmClientEnabled","readonly":false,"value":"false"},{"key":"AuthorizeRemoteTxRequests","readonly":true,"value":"false"},{"key":"GetConfigurationMaxKeys","readonly":true,"value":"200"},{"key":"SupportedFeatureProfiles","readonly":true,"value":"Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger"},{"key":"StopTxnAlignedData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"StopTxnSampledData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"MeterValuesAlignedData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"MeterValuesSampledData","readonly":false,"value":"Energy.Active.Import.Register"},{"key":"UnlockConnectorOnEVSideDisconnect","readonly":true,"value":"true"},{"key":"StopTransactionOnEVSideDisconnect","readonly":true,"value":"true"},{"key":"ResetRetries","readonly":true,"value":"0"},{"key":"ConnectorSwitch3to1PhaseSupported","readonly":false,"value":"false"},{"key":"ConnectorSwitchPhaseSource","readonly":false,"value":"NONE"},{"key":"ReserveConnectorZeroSupported","readonly":true,"value":"false"},{"key":"KeystorePassword","readonly":true,"value":"hsaaNnRAnGgdZBAki/b5pQ=="},{"key":"CertificateStoreMaxLength","readonly":true,"value":"10000"},{"key":"AdditionalRootCertificateCheck","readonly":false,"value":"false"},{"key":"SupportedFileTransferProtocols","readonly":true,"value":"FTP,HTTP,HTTPS"},{"key":"GetCertificateHashAlgorithm","readonly":false,"value":"SHA256"},{"key":"DaysUntilChargepointCertificateExpiration","readonly":false,"value":"30"},{"key":"CpoName","readonly":false,"value":"Keba"},{"key":"SecurityProfile","readonly":false,"value":"0"},{"key":"SecurityProfileFallback","readonly":false,"value":"0"},{"key":"SecurityProfileFallbackPeriod","readonly":false,"value":"180"},{"key":"MemoryCheckerThresholdPct","readonly":true,"value":"90"},{"key":"BatchedEventPauseResetAfter","readonly":true,"value":"30"},{"key":"PortalHost","readonly":false,"value":""},{"key":"PortalPort","readonly":false,"value":""},{"key":"PortalPath","readonly":false,"value":""},{"key":"PortalChargeBoxIdentity","readonly":false,"value":"27017327"},{"key":"enc.PortalBasicAuthenticationPassword","readonly":false,"value":"7EOpRa5669/xpQblnJcZgQ=="},{"key":"PortalWebSocketPingInterval","readonly":false,"value":"240"},{"key":"enc.PortalEnrollmentToken","readonly":false,"value":""},{"key":"PortalUpdateEndpoint","readonly":false,"value":"https://emobility-portal-backend.keba.com/update/api/v1"},{"key":"PortalUpdateCheckFrequencyDays","readonly":false,"value":"1"},{"key":"DisplayTextLanguage","readonly":false,"value":"en"},{"key":"DisplayTextCard","readonly":false,"value":"\'en\',\'$      Swipe card\',0,5,5"},{"key":"DisplayTextPlug","readonly":false,"value":"\'en\',\'Insert plug\',0,5,5"},{"key":"DisplayTextCheckingCard","readonly":false,"value":"\'en\',\'...\',0,0,0"},{"key":"DisplayTextCardExpired","readonly":false,"value":"\'en\',\'EXPIRED card\',1,3,0"},{"key":"DisplayTextCardBlocked","readonly":false,"value":"\'en\',\'BLOCKED card\',1,3,0"},{"key":"DisplayTextCardInvalid","readonly":false,"value":"\'en\',\'INVALID card\',1,3,0"},{"key":"DisplayTextCardOk","readonly":false,"value":"\'en\',\'ACCEPTED card\',1,3,0"},{"key":"DisplayTextCharging","readonly":false,"value":"\'en\',\'Charging...\',1,10,0"},{"key":"DisplayTextPVBoostCharging","readonly":false,"value":"\'en\',\'Boost charge\',1,10,0"},{"key":"DisplayTextPVCharging","readonly":false,"value":"\'en\',\'PV charging\',1,10,0"},{"key":"DisplayTextChargingSuspended","readonly":false,"value":"\'en\',\'Charging suspended\',1,10,0"},{"key":"DisplayTextChargingStopped","readonly":false,"value":"\'en\',\'Charging stopped\',5,10,0"},{"key":"DisplayTextReservedId","readonly":false,"value":"\'en\',\'Reserved ID {0}\',0,5,5"},{"key":"DisplayTextWrongReservation","readonly":false,"value":"\'en\',\'Wrong reservation\',1,3,0"},{"key":"RandomProfileDelayEnabled","readonly":false,"value":"true"},{"key":"RandomProfileMaxDelay","readonly":false,"value":"600"},{"key":"FtpUseMlstCommand","readonly":false,"value":"true"},{"key":"FtpsUseEndpointChecking","readonly":false,"value":"true"},{"key":"SftpUseStrictHostChecking","readonly":false,"value":"false"},{"key":"RestApiEnabled","readonly":false,"value":"true"},{"key":"PortalConfigNotificationEnabled","readonly":false,"value":"false"},{"key":"PortalConfigNotificationFrequency","readonly":false,"value":"30"},{"key":"HostConnectorProxyServerAddress","readonly":false,"value":""},{"key":"HostConnectorProxyServerPort","readonly":false,"value":""},{"key":"HostConnectorProxyUsername","readonly":false,"value":""},{"key":"HostConnectorProxyPassword","readonly":false,"value":""},{"key":"HostConnectorProxyServerConfigEnabled","readonly":false,"value":"false"},{"key":"Connect2ConnectorSerial1","readonly":false,"value":"27017327"},{"key":"FailsafeCurrentSerial1","readonly":false,"value":"32000"},{"key":"ModelSerial1","readonly":true,"value":"KC-P30-GS2400U2-M0A"},{"key":"MaxCurrentSerial1","readonly":true,"value":"10000"},{"key":"AliasSerial1","readonly":false,"value":""}],"unknownKey":[]}';
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.kebaConfig[key].value,
      readonly: this.kebaConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard GL_EVIQ model
   * @returns JSON string with Vestel configuration
   */
  public getGlEviqConfiguration(): string {
    // Convert stored configuration to JSON response format
    const configKeys = Object.keys(this.glEviqConfig);

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return '{"configurationKey":[{"key":"AllowOfflineTxForUnknownId","readonly":false,"value":"false"},{"key":"AuthorizationCacheEnabled","readonly":false,"value":"false"},{"key":"AuthorizeRemoteTxRequests","readonly":false,"value":"false"},{"key":"ClockAlignedDataInterval","readonly":false,"value":"0"},{"key":"ConnectionTimeOut","readonly":false,"value":"0"},{"key":"ConnectorPhaseRotation","readonly":false,"value":"Unknown"},{"key":"ConnectorPhaseRotationMaxLength","readonly":true,"value":"3"},{"key":"GetConfigurationMaxKeys","readonly":true,"value":"50"},{"key":"HeartbeatInterval","readonly":false,"value":"300"},{"key":"LightIntensity","readonly":false,"value":"100"},{"key":"LocalAuthorizeOffline","readonly":false,"value":"false"},{"key":"LocalPreAuthorize","readonly":false,"value":"false"},{"key":"MaxEnergyOnInvalidId","readonly":false,"value":"7"},{"key":"MeterValuesAlignedData","readonly":false,"value":"Current.Export, Current.Import, Current.Offered, Energy.Active.Export.Register, Energy.Active.Import.Register, Frequency, Power.Active.Export, Power.Active.Import, Power.Factor, Power.Offered, RPM, SoC, Temperature, Voltage"},{"key":"MeterValuesAlignedDataMaxLength","readonly":true,"value":"20"},{"key":"MeterValuesSampledData","readonly":false,"value":"Current.Export, Current.Import, Current.Offered, Energy.Active.Export.Register, Energy.Active.Import.Register, Frequency, Power.Active.Export, Power.Active.Import, Power.Factor, Power.Offered, RPM, SoC, Temperature, Voltage"},{"key":"MeterValuesSampledDataMaxLength","readonly":true,"value":"22"},{"key":"MeterValueSampleInterval","readonly":false,"value":"60"},{"key":"MinimumStatusDuration","readonly":false,"value":"0"},{"key":"NumberOfConnectors","readonly":true,"value":"1"},{"key":"ResetRetries","readonly":false,"value":"0"},{"key":"StopTransactionOnEVSideDisconnect","readonly":true,"value":"true"},{"key":"StopTransactionOnInvalidId","readonly":false,"value":"true"},{"key":"StopTxnAlignedData","readonly":false,"value":""},{"key":"StopTxnAlignedDataMaxLength","readonly":true,"value":"20"},{"key":"StopTxnSampledData","readonly":false,"value":""},{"key":"StopTxnSampledDataMaxLength","readonly":true,"value":"20"},{"key":"SupportedFeatureProfiles","readonly":true,"value":"Core, FirmwareManagement, LocalAuthListManagement, Reservation, SmartCharging, RemoteTrigger"},{"key":"SupportedFeatureProfilesMaxLength","readonly":true,"value":"6"},{"key":"TransactionMessageAttempts","readonly":false,"value":"0"},{"key":"TransactionMessageRetryInterval","readonly":false,"value":"15"},{"key":"UnlockConnectorOnEVSideDisconnect","readonly":false,"value":"true"},{"key":"WebSocketPingInterval","readonly":false,"value":"900"},{"key":"SupportedFileTransferProtocols","readonly":true,"value":"HTTP, HTTPS"},{"key":"LocalAuthListEnabled","readonly":false,"value":"false"},{"key":"LocalAuthListMaxLength","readonly":true,"value":"100"},{"key":"SendLocalListMaxLength","readonly":true,"value":"10"},{"key":"ReserveConnectorZeroSupported","readonly":true,"value":"true"},{"key":"ChargeProfileMaxStackLevel","readonly":true,"value":"0"},{"key":"ChargingScheduleAllowedChargingRateUnit","readonly":true,"value":"Power"},{"key":"ChargingScheduleMaxPeriods","readonly":true,"value":"12"},{"key":"ConnectorSwitch3to1PhaseSupported","readonly":false,"value":"false"},{"key":"MaxChargingProfilesInstalled","readonly":true,"value":"1"},{"key":"ConnexionUrl","readonly":false,"value":"ws://ocpp.electricmiles.io/"},{"key":"ChargePointIdentifier","readonly":false,"value":"GLF6501A24K00089"},{"key":"MaxPermissibleVoltage","readonly":false,"value":"275"},{"key":"MinPermissibleVoltage","readonly":false,"value":"175"},{"key":"MaxPermissibleLoadCurrents","readonly":false,"value":"-1"},{"key":"MaxPermissibleOutCurrents","readonly":false,"value":"-1"},{"key":"MaxPermissibleTemperature","readonly":false,"value":"-1"},{"key":"SolarModel","readonly":true,"value":"Model1"},{"key":"LimitingSolarChargeCurrent","readonly":true,"value":"-1"},{"key":"ChargingScheduleAllowedChargingCurrent","readonly":false,"value":"64"},{"key":"G_RandDelayChargeTime","readonly":false,"value":"60"},{"key":"FreeChargeMode","readonly":false,"value":"false"},{"key":"FreeChargeModeIdTag","readonly":false,"value":"FFFFFFFF"},{"key":"G_ChargerMode","readonly":false,"value":"2"},{"key":"G_MaxCurrent","readonly":false,"value":"32"},{"key":"G_SolarMode","readonly":false,"value":"0"},{"key":"G_OffPeakEnable","readonly":false,"value":"0"},{"key":"G_OffPeakCurr","readonly":false,"value":"0"},{"key":"G_LowPowerReserveEnable","readonly":false,"value":"0"},{"key":"G_SolarLimitPower","readonly":false,"value":"0.000000"},{"key":"G_PeriodTime","readonly":false,"value":"08:00-12:00;16:00-22:00;"}],"unknownKey":[]}';
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.glEviqConfig[key].value,
      readonly: this.glEviqConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Update vendor-specific configuration based on vendor, model and key
   * @param key Configuration key to update
   * @param value New value for the configuration
   * @returns boolean indicating success or failure
   */
  public updateVendorConfiguration(key: string, value: string): boolean {
    if (this.vendor === 'ATESS') {
      // Check if key exists in ATESS hidden config
      if (this.atessHiddenConfig[key]) {
        if (this.atessHiddenConfig[key].readonly) {
          return false; // Cannot update readonly config
        }

        this.atessHiddenConfig[key].value = value;
        
        return true;
      }
      
      // Check if key exists in ATESS public config
      if (this.atessPublicConfig[key]) {
        if (this.atessPublicConfig[key].readonly) {
          return false; // Cannot update readonly config
        }

        this.atessPublicConfig[key].value = value;

        return true;
      }
    } else if (this.model === 'EVC03') {
      // Check if key exists in EVC03 config
      if (this.evc03Config[key]) {
        if (this.evc03Config[key].readonly) {
          return false; // Cannot update readonly config
        }

        this.evc03Config[key].value = value;

        return true;
      }
    } else if (this.vendor === 'Vestel') {
      // Check if key exists in Vestel config
      if (this.vestelConfig[key]) {
        if (this.vestelConfig[key].readonly) {
          return false; // Cannot update readonly config
        }

        this.vestelConfig[key].value = value;

        return true;
      }
    } else if (this.vendor === 'Keba') {
      // Check if key exists in Keba config
      if (this.kebaConfig[key]) {
        if (this.kebaConfig[key].readonly) {
          return false; // Cannot update readonly config
        }

        this.kebaConfig[key].value = value;

        return true;
      }
    } else if (this.vendor === 'GL_EQIQ') {
      // Check if key exists in GL_EVIQ config
      if (this.glEviqConfig[key]) {
        if (this.glEviqConfig[key].readonly) {
          return false; // Cannot update readonly config
        }

        this.glEviqConfig[key].value = value;

        return true;
      }
    }
    
    return false; // Key not found or vendor not supported
  }
}
