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
import { getFirmware, getVendor, sleep } from "./utils";
import { transactionManager } from "./v16/transactionManager";
import { VendorConfig } from "./vendorConfig";
import {bootVCP} from "./vcp_commands/bootVcp";

interface VCPOptions {
  ocppVersion: OcppVersion;
  endpoint: string;
  chargePointId: string;
  basicAuthPassword?: string;
  adminWsPort?: number;
  isTwinGun?: boolean; // if VCP is twingun, based on cli param
  connectorIds?: number[];
  model: string;
  power: number;
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
  public lastCloseReason: string|null = null;
  public power: number;
  private heartbeatInterval ?:NodeJS.Timeout | string | number | undefined;
  private vendorConfig: Record<string, any> = {};

  constructor(public vcpOptions: VCPOptions) {
    this.messageHandler = resolveMessageHandler(vcpOptions.ocppVersion);

    this.vcpOptions.isTwinGun = this.vcpOptions.isTwinGun ?? false;
    this.isTwinGun = this.vcpOptions.isTwinGun ?? false;
    this.connectorIDs =
      this.vcpOptions.connectorIds ?? this.initializeConnectorIDs();
    this.status = "Unavailable";
    this.model = this.vcpOptions.model ?? VendorConfig.MODELS.EVC01;
    this.power = this.vcpOptions.power ?? 7;
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

    // Initialize configuration object for the current vendor/model
    this.vendorConfig = VendorConfig.initializeConfiguration(
      this.vendor,
      this.model,
    );
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
      this.ws.on("error", (error: Error) => {
        logger.error(`WebSocket error: ${error.message}`);
        this._onClose(1000, `WebSocket error: ${error.message}`);
      });
    });
  }

  send(ocppCall: OcppCall<any>) {
    if (!this.ws) {
      throw new Error("Websocket not initialized. Call connect() first");
    }
    // Prevent sending when the socket isn't ready yet
    if (this.ws.readyState !== WebSocket.OPEN) {
      // Avoid triggering ws internal error by sending while CONNECTING/CLOSING
      // Let caller decide retry policy; Heartbeat sender will skip automatically
      throw new Error(
        `WebSocket is not open: readyState ${this.ws.readyState} (expected OPEN)`,
      );
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

    return jsonMessage;
  }

  async sendAndWait(ocppCall: OcppCall<any>) {
    // Wait until any previous request has been answered
    while (this.isWaiting) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Send current request and mark as waiting
    this.isWaiting = true;
    this.send(ocppCall);

    // Block until a message is received and processed
    // _onMessage will set this.isWaiting = false when any message arrives
    while (this.isWaiting) {
      await new Promise(resolve => setImmediate(resolve));
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
    this.heartbeatInterval = setInterval(() => {
      // Only send Heartbeat when WS is ready
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        // Skip this tick if not open yet/anymore
        return;
      }
      try {
        this.send(call("Heartbeat"));
      } catch (e) {
        // Silently skip if cannot send due to transient state
      }
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
    const reasonMessage = reason || "No reason provided";
    // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent/code
    // 1000 = Normal Closure
    logger.info(`Connection closed. ${this.vcpOptions.chargePointId} code=${code}, reason=${reasonMessage}`);

    // record reason (returned in Get Status) and try to reconnect
    this.lastCloseReason = `${code}=${reasonMessage}`;

    this.status = 'Offline';

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  disconnect() {
    if (!this.ws) {
      throw new Error(
        "Trying to close a Websocket that was not opened. Call connect() first",
      );
    }

    for (const connector of this.connectorIDs) {
      let transactionId = transactionManager.getTransactionIdByVcp(
        this,
        connector,
      );
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
  public getVendorConfiguration(keys: string[] = []): string {
    // If specific keys are requested, return only those keys
    if (keys.length > 0) {
      return this.getSpecificConfigurationKeys(keys);
    }

    // If no specific keys requested, return full configuration based on vendor/model
    if (this.vendor === VendorConfig.VENDORS.ATESS) {
      return this.getAtessPublicConfiguration();
    } else if (this.model === VendorConfig.MODELS.EVC03) {
      // vestel EVC03 DC
      // crashed adapter due to null value, fixed in adapter 1.16.0 release
      // adapter error: "String.toLowerCase()\" because the return value of \"io.solidstudio.emobility.ocpp.model_1_6.common.KeyValue.getValue()\" is null\
      return this.getEVC03Configuration();
    } else if (this.vendor === VendorConfig.VENDORS.VESTEL) {
      return this.getVestelConfiguration();
    } else if (this.vendor === VendorConfig.VENDORS.KEBA) {
      return this.getKebaConfiguration();
    } else if (this.vendor === VendorConfig.VENDORS.GL_EVIQ) {
      return this.getGlEviqConfiguration();
    } else if (this.vendor === VendorConfig.VENDORS.EN_PLUS) {
      return this.getEnPlusConfiguration();
    }

    return '{"configurationKey": []}';
  }

  /**
   * Get specific configuration keys from vendor configuration
   * @param keys Array of configuration keys to retrieve
   * @returns JSON string with only the requested configuration keys
   */
  private getSpecificConfigurationKeys(keys: string[]): string {
    const configArray: Array<{
      key: string;
      value: string;
      readonly: boolean;
    }> = [];

    keys.forEach((key) => {
      if (this.vendorConfig[key]) {
        configArray.push({
          key,
          value: this.vendorConfig[key].value,
          readonly: this.vendorConfig[key].readonly,
        });
      }
    });

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for ATESS vendor with private keys
   * @returns JSON string with hidden ATESS keys
   */
  private getAtessPrivateConfiguration(): string {
    // Filter configuration keys for ATESS hidden configuration
    const configKeys = Object.keys(this.vendorConfig).filter((key) =>
      VendorConfig.isAtessPrivateKey(key),
    );

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return VendorConfig.getAtessPrivateConfiguration();
    }

    const configArray = configKeys.map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
    }));

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for ATESS vendor with no specific keys
   * @returns JSON string with public ATESS keys
   */
  public getAtessPublicConfiguration(): string {
    // Filter configuration keys for ATESS public configuration
    const configKeys = Object.keys(this.vendorConfig).filter((key) =>
      VendorConfig.isAtessPublicKey(key),
    );

    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return VendorConfig.getAtessPublicConfiguration();
    }

    const configArray = configKeys.map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
    }));

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for Vestel EVC03 DC model
   * @returns JSON string with Vestel EVC03 DC configuration
   */
  public getEVC03Configuration(): string {
    // If this is not an EVC03 model or configuration is not initialized
    if (
      this.model !== VendorConfig.MODELS.EVC03 ||
      Object.keys(this.vendorConfig).length === 0
    ) {
      // Return default configuration
      return VendorConfig.getEVC03Configuration();
    }

    const configArray = Object.keys(this.vendorConfig).map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
    }));

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard Vestel model
   * @returns JSON string with Vestel configuration
   */
  public getVestelConfiguration(): string {
    // If this is not a Vestel vendor or configuration is not initialized
    if (
      this.vendor !== VendorConfig.VENDORS.VESTEL ||
      Object.keys(this.vendorConfig).length === 0
    ) {
      // Return default configuration
      return VendorConfig.getVestelConfiguration();
    }

    const configArray = Object.keys(this.vendorConfig).map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
    }));

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard Keba model
   * @returns JSON string with Vestel configuration
   */
  public getKebaConfiguration(): string {
    // If this is not a Keba vendor or configuration is not initialized
    if (
      this.vendor !== VendorConfig.VENDORS.KEBA ||
      Object.keys(this.vendorConfig).length === 0
    ) {
      // Return default configuration
      return VendorConfig.getKebaConfiguration();
    }

    const configArray = Object.keys(this.vendorConfig).map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
    }));

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard GL_EVIQ model
   * @returns JSON string with Vestel configuration
   */
  public getGlEviqConfiguration(): string {
    // If this is not a GL_EVIQ vendor or configuration is not initialized
    if (
      this.vendor !== VendorConfig.VENDORS.GL_EVIQ ||
      Object.keys(this.vendorConfig).length === 0
    ) {
      // Return default configuration
      return VendorConfig.getGlEviqConfiguration();
    }

    const configArray = Object.keys(this.vendorConfig).map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
    }));

    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard EN_PLUS model
   * @returns JSON string with EN_PLUS configuration
   */
  public getEnPlusConfiguration(): string {
    // If this is not a EN_PLUS vendor or configuration is not initialized
    if (
      this.vendor !== VendorConfig.VENDORS.EN_PLUS ||
      Object.keys(this.vendorConfig).length === 0
    ) {
      // Return default configuration
      return VendorConfig.getEnPlus22kWConfiguration();
    }

    const configArray = Object.keys(this.vendorConfig).map((key) => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly,
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
    // Check if key exists in the configuration
    if (this.vendorConfig[key]) {
      if (this.vendorConfig[key].readonly) {
        return false; // Cannot update readonly config
      }

      this.vendorConfig[key].value = value;

      return true;
    }

    return false; // Key not found
  }

  /**
   * Get a configuration value from vendor configuration
   * @param key Configuration key to retrieve
   * @returns string value of the configuration key or undefined if not found
   */
  public getConfigurationValue(key: string): string | undefined {
    if (this.vendorConfig[key]) {
      return this.vendorConfig[key].value;
    }

    return undefined;
  }

  /**
   * Get the vendor-specific random delay maximum value
   * @returns Maximum delay in seconds for the current vendor, or 0 if not supported
   */
  public getVendorRandomDelayMax(): number {
    const randomDelayConfigKey = VendorConfig.getVendorRandomDelayConfigKey(
      this.vendor,
    );

    if (!randomDelayConfigKey) {
      return 0; // Vendor doesn't support random delay
    }

    // Try to get the actual configured value from vendor configuration
    const configuredValue = this.getConfigurationValue(randomDelayConfigKey);

    if (configuredValue === undefined) {
      return 0; // Vendor doesn't support random delay
    }

    return parseInt(configuredValue);
  }
}
