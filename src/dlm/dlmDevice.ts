import WebSocket from "ws";

import { logger } from "../logger";
import { call } from "../messageFactory";
import { OcppCall } from "../ocppMessage";
import { validateOcppRequest } from "../jsonSchemaValidator";
import { OcppVersion, toProtocolVersion } from "../ocppVersion";
import { ocppOutbox } from "../ocppOutbox";
import { DlmReading } from "./deviceType";
import { resolveDlmDeviceType } from "./registry";

const DEFAULT_VOLTAGE_V = 245;
const DEFAULT_PHASES = 3;
const HEARTBEAT_INTERVAL_MS = 300_000;

export interface DlmDeviceOptions {
  endpoint: string;
  deviceId: string;
  deviceTypeId: string;
  baselineLoadWatts: number;
  includeChargerLoad: boolean;
  voltagePerPhase?: number;
  phases?: number;
  basicAuthPassword?: string;
  // returns the current total charger load (watts) across the process, so the
  // reported site load can reflect live EV demand and close the DLM loop
  loadProvider?: () => number;
}

/**
 * Emulates a DLM/load-balancer device: connects to the CSMS as an OCPP 1.6
 * client and pushes periodic site-meter readings so the platform's DLM
 * calculation runs and emits TxProfiles. The wire format is delegated to a
 * pluggable DlmDeviceType (see registry.ts), so this runtime is vendor-agnostic.
 */
export class DlmDevice {
  private ws?: WebSocket;
  private reportTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private energyWh = 0;
  private lastAccrualAt = Date.now();
  private lastReading?: DlmReading;
  public baselineLoadWatts: number;
  public connected = false;

  constructor(public options: DlmDeviceOptions) {
    this.baselineLoadWatts = options.baselineLoadWatts;
  }

  private get deviceType() {
    return resolveDlmDeviceType(this.options.deviceTypeId);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.options.endpoint}/${this.options.deviceId}`;
      const protocol = toProtocolVersion(OcppVersion.OCPP_1_6);
      this.ws = new WebSocket(url, [protocol], {
        rejectUnauthorized: false,
        auth: this.options.basicAuthPassword
          ? `${this.options.deviceId}:${this.options.basicAuthPassword}`
          : undefined,
        followRedirects: true,
      });

      this.ws.on("open", () => {
        this.connected = true;
        logger.info(`DLM device connected: ${this.options.deviceId}`);
        this.onOpen();
        resolve();
      });
      this.ws.on("message", (message: string) => this.onMessage(message));
      this.ws.on("close", () => {
        this.connected = false;
      });
      this.ws.on("error", (error: Error) => {
        logger.error(`DLM device WS error (${this.options.deviceId}): ${error.message}`);
        reject(error);
      });
    });
  }

  private onOpen() {
    const type = this.deviceType;
    this.send(
      call("BootNotification", {
        chargePointVendor: "Charge-M8",
        chargePointModel: type.label,
        chargePointSerialNumber: this.options.deviceId,
        firmwareVersion: "1.0.0",
      }),
    );

    this.heartbeatTimer = setInterval(() => {
      try {
        this.send(call("Heartbeat"));
      } catch (e) {
        // socket not open; skip
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.reportTimer = setInterval(() => {
      try {
        this.sendReading();
      } catch (e) {
        // socket not open; skip
      }
    }, type.defaultReportIntervalMs);

    // send an initial reading immediately
    try {
      this.sendReading();
    } catch (e) {
      // ignore
    }
  }

  private onMessage(message: string) {
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    const [type, ...rest] = data;
    if (type === 3) {
      // CallResult to one of our outbound calls; clear it from the outbox
      const [messageId] = rest;
      ocppOutbox.get(messageId);
    } else if (type === 2) {
      // The CSMS shouldn't drive a meter device much; log and ignore.
      const [, action] = rest;
      logger.info(`DLM device ${this.options.deviceId} received ${action} (ignored)`);
    }
  }

  private buildReading(): DlmReading {
    const voltage = this.options.voltagePerPhase ?? DEFAULT_VOLTAGE_V;
    const phases = this.options.phases ?? DEFAULT_PHASES;

    const chargerLoad =
      this.options.includeChargerLoad && this.options.loadProvider
        ? this.options.loadProvider()
        : 0;
    const totalPowerW = Math.max(0, this.baselineLoadWatts + chargerLoad);

    const now = Date.now();
    this.energyWh += totalPowerW * ((now - this.lastAccrualAt) / 3600000);
    this.lastAccrualAt = now;

    const perPhaseW = totalPowerW / phases;
    const perPhaseA = perPhaseW / voltage;

    const powerArr: [number, number, number] = [0, 0, 0];
    const currentArr: [number, number, number] = [0, 0, 0];
    const voltageArr: [number, number, number] = [voltage, voltage, voltage];
    for (let i = 0; i < 3; i++) {
      if (i < phases) {
        powerArr[i] = perPhaseW;
        currentArr[i] = perPhaseA;
      }
    }

    return {
      deviceId: this.options.deviceId,
      timestamp: new Date(),
      voltage: voltageArr,
      currentImport: currentArr,
      power: powerArr,
      energyWh: this.energyWh,
      totalPowerW,
    };
  }

  private sendReading() {
    const reading = this.buildReading();
    this.lastReading = reading;
    this.send(this.deviceType.buildReadingCall(reading));
  }

  send(ocppCall: OcppCall<any>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("DLM device websocket is not open");
    }
    ocppOutbox.enqueue(ocppCall);
    const jsonMessage = JSON.stringify([
      2,
      ocppCall.messageId,
      ocppCall.action,
      ocppCall.payload,
    ]);
    validateOcppRequest(
      OcppVersion.OCPP_1_6,
      ocppCall.action,
      JSON.parse(JSON.stringify(ocppCall.payload)),
    );
    if (ocppCall.action !== "Heartbeat") {
      logger.info(`➡️  DLM ${this.options.deviceId} ${ocppCall.action} ${jsonMessage}`);
    }
    this.ws.send(jsonMessage);
  }

  /** Adjust the reported baseline site load live and push a reading immediately. */
  updateBaseline(watts: number) {
    this.baselineLoadWatts = watts;
    try {
      this.sendReading();
    } catch (e) {
      // socket not open; skip
    }
  }

  getStatus() {
    return {
      deviceId: this.options.deviceId,
      deviceTypeId: this.options.deviceTypeId,
      endpoint: this.options.endpoint,
      connected: this.connected,
      baselineLoadWatts: this.baselineLoadWatts,
      includeChargerLoad: this.options.includeChargerLoad,
      lastReading: this.lastReading
        ? {
            timestamp: this.lastReading.timestamp,
            totalPowerW: Math.round(this.lastReading.totalPowerW),
            currentImport: this.lastReading.currentImport.map(
              (a) => Math.round(a * 100) / 100,
            ),
            energyWh: Math.round(this.lastReading.energyWh),
          }
        : null,
    };
  }

  stop() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = undefined;
    }
    this.connected = false;
  }
}
