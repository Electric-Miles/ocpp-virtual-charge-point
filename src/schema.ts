import { OcppVersion } from "./ocppVersion";

export const StartVcpValidationSchema = {
  type: "object",
  required: [
    "endpoint",
    "ocppVersion",
    "startChance",
    "testCharge",
    "duration",
    "sendBootStatus",
  ],
  properties: {
    endpoint: { type: "string" },
    chargePointId: { type: "string" },
    idPrefix: { type: "string" },
    count: { type: "integer" },
    startChance: { type: "number" },
    testCharge: { type: "boolean" },
    sendBootStatus: { type: "boolean" },
    duration: { type: "number" },
    randomDelay: { type: "boolean" },
    connectors: { type: "number" },
    numberOfPhases: { type: "number" },
    ocppVersion: { type: "string" },
  },
};

export interface StartVcpRequestSchema {
  endpoint: string;
  chargePointId?: string;
  count?: number;
  startChance: number;
  testCharge: boolean;
  sendBootStatus: boolean;
  duration: number;
  randomDelay: boolean;
  connectors: number;
  power: number;
  numberOfPhases?: number;
  ocppVersion: OcppVersion;
  model: string;
  sendMeterValues: boolean;
  mixedMeterValues: boolean;
  continueMeterValueFromPreviousTransaction: boolean;
  sendStopTransactionThenStatusNotification: boolean;
}

export enum StatusNotification {
  Available = "Available",
  Charging = "Charging",
  Faulted = "Faulted",
  Finishing = "Finishing",
  Preparing = "Preparing",
  Reserved = "Reserved",
  SuspendedEV = "SuspendedEV",
  SuspendedEVSE = "SuspendedEVSE",
}

export enum AdminAction {
  Authorize = "Authorize",
  DataTransfer = "DataTransfer",
  SecurityEventNotification = "SecurityEventNotification",
  StatusNotification = "StatusNotification",
  MeterValues = "MeterValues",
  StartTransaction = "StartTransaction",
  StopTransaction = "StopTransaction",
}

export interface ChangeVcpStatusRequestSchema {
  chargePointId: string;
  action: AdminAction;
  payload: object;
}

export const ChangeVcpStatusValidationSchema = {
  type: "object",
  required: ["chargePointId", "action", "payload"],
  properties: {
    chargePointId: { type: "string" },
    action: { type: "string" },
    payload: { type: "object" },
  },
};

export interface StopVcpRequestSchema {
  vcpId?: string;
  isPrefix?: boolean;
}

export const StopVcpValidationSchema = {
  type: "object",
  properties: {
    vcpId: { type: "string" },
    vcpIdPrefix: { type: "string" },
  },
};

export const StatusValidationSchema = {
  type: "object",
  properties: {
    verbose: { type: "boolean" },
  },
};

export interface StatusRequestSchema {
  verbose: boolean;
}

export const ConnectorStatusValidationSchema = {
  type: "object",
  required: ["chargePointId"],
  properties: {
    chargePointId: { type: "string" },
    connectorId: { type: "integer" },
  },
};

export interface ConnectorStatusRequestSchema {
  chargePointId: string;
  connectorId?: number;
}

export const SetChargingProfileValidationSchema = {
  type: "object",
  required: ["chargePointId"],
  properties: {
    chargePointId: { type: "string" },
    connectorId: { type: "integer" },
    limit: { type: "number" },
    unit: { type: "string" },
    purpose: { type: "string" },
    stackLevel: { type: "integer" },
    numberPhases: { type: "integer" },
    duration: { type: "integer" },
    clear: { type: "boolean" },
  },
};

export interface SetChargingProfileRequestSchema {
  chargePointId: string;
  connectorId?: number;
  limit?: number;
  unit?: "A" | "W";
  purpose?: string;
  stackLevel?: number;
  numberPhases?: number;
  duration?: number;
  clear?: boolean;
}

export const StartDlmValidationSchema = {
  type: "object",
  required: ["endpoint", "deviceTypeId", "deviceId"],
  properties: {
    endpoint: { type: "string" },
    deviceTypeId: { type: "string" },
    deviceId: { type: "string" },
    baselineLoadWatts: { type: "number" },
    includeChargerLoad: { type: "boolean" },
    voltagePerPhase: { type: "number" },
    phases: { type: "number" },
    reportIntervalMs: { type: "number" },
    voltageSensePhases: { type: "number" },
    phaseBalance: {
      type: "array",
      items: { type: "number" },
      minItems: 3,
      maxItems: 3,
    },
    unmeasuredPhaseOffsetsW: {
      type: "array",
      items: { type: "number" },
      minItems: 3,
      maxItems: 3,
    },
    quantisation: {
      type: "object",
      properties: {
        powerW: { type: "number" },
        currentA: { type: "number" },
        voltageV: { type: "number" },
      },
    },
    reportEnergyRegister: { type: "boolean" },
  },
};

export interface StartDlmRequestSchema {
  endpoint: string;
  deviceTypeId: string;
  deviceId: string;
  baselineLoadWatts?: number;
  includeChargerLoad?: boolean;
  voltagePerPhase?: number;
  phases?: number;
  reportIntervalMs?: number;
  voltageSensePhases?: number;
  phaseBalance?: [number, number, number];
  unmeasuredPhaseOffsetsW?: [number, number, number];
  quantisation?: { powerW?: number; currentA?: number; voltageV?: number };
  reportEnergyRegister?: boolean;
}

export const UpdateDlmValidationSchema = {
  type: "object",
  required: ["deviceId"],
  properties: {
    deviceId: { type: "string" },
    baselineLoadWatts: { type: "number" },
  },
};

export interface UpdateDlmRequestSchema {
  deviceId: string;
  baselineLoadWatts?: number;
}

export const StopDlmValidationSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
  },
};

export interface StopDlmRequestSchema {
  deviceId?: string;
}

export const LoginValidationSchema = {
  type: "object",
  required: ["email", "password"],
  properties: {
    email: { type: "string" },
    password: { type: "string" },
  },
};

export interface LoginRequestSchema {
  email: string;
  password: string;
}
