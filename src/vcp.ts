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
import { VendorConfig } from "./vendorConfig";

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
  private vendorConfig: Record<string, any> = {};

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

    // Initialize configuration object for the current vendor/model
    this.vendorConfig = VendorConfig.initializeConfiguration(this.vendor, this.model);
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
  public getVendorConfiguration(keys: string[] = []): string {
    if (this.vendor === 'ATESS') {
      if (keys.length > 0) {
        return this.getAtessPrivateConfiguration();
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
  private getAtessPrivateConfiguration(): string {
    // Filter configuration keys for ATESS hidden configuration
    const configKeys = Object.keys(this.vendorConfig).filter(key => VendorConfig.isAtessPrivateKey(key));
    
    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return VendorConfig.getAtessPrivateConfiguration();
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for ATESS vendor with no specific keys
   * @returns JSON string with public ATESS keys
   */
  public getAtessPublicConfiguration(): string {
    // Filter configuration keys for ATESS public configuration
    const configKeys = Object.keys(this.vendorConfig).filter(key => VendorConfig.isAtessPublicKey(key));
    
    if (configKeys.length === 0) {
      // Return default configuration if not initialized yet
      return VendorConfig.getAtessPublicConfiguration();
    }
    
    const configArray = configKeys.map(key => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for Vestel EVC03 DC model
   * @returns JSON string with Vestel EVC03 DC configuration
   */
  public getEVC03Configuration(): string {
    // If this is not an EVC03 model or configuration is not initialized
    if (this.model !== 'EVC03' || Object.keys(this.vendorConfig).length === 0) {
      // Return default configuration
      return VendorConfig.getEVC03Configuration();
    }
    
    const configArray = Object.keys(this.vendorConfig).map(key => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard Vestel model
   * @returns JSON string with Vestel configuration
   */
  public getVestelConfiguration(): string {
    // If this is not a Vestel vendor or configuration is not initialized
    if (this.vendor !== 'Vestel' || Object.keys(this.vendorConfig).length === 0) {
      // Return default configuration
      return VendorConfig.getVestelConfiguration();
    }
    
    const configArray = Object.keys(this.vendorConfig).map(key => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard Keba model
   * @returns JSON string with Vestel configuration
   */
  public getKebaConfiguration(): string {
    // If this is not a Keba vendor or configuration is not initialized
    if (this.vendor !== 'Keba' || Object.keys(this.vendorConfig).length === 0) {
      // Return default configuration
      return VendorConfig.getKebaConfiguration();
    }
    
    const configArray = Object.keys(this.vendorConfig).map(key => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly
    }));
    
    return JSON.stringify({ configurationKey: configArray });
  }

  /**
   * Get configuration for standard GL_EVIQ model
   * @returns JSON string with Vestel configuration
   */
  public getGlEviqConfiguration(): string {
    // If this is not a GL_EVIQ vendor or configuration is not initialized
    if (this.vendor !== 'GL_EVIQ' || Object.keys(this.vendorConfig).length === 0) {
      // Return default configuration
      return VendorConfig.getGlEviqConfiguration();
    }
    
    const configArray = Object.keys(this.vendorConfig).map(key => ({
      key,
      value: this.vendorConfig[key].value,
      readonly: this.vendorConfig[key].readonly
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
}
