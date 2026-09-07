import { OcppCall } from "../ocppMessage";

/**
 * A single site-meter reading produced by an emulated DLM/load-balancer device,
 * in unscaled SI-ish units (volts, amps, watts, Wh). Each DlmDeviceType decides
 * how to encode/scale these into its own vendor-specific OCPP message.
 */
export interface DlmReading {
  deviceId: string;
  timestamp: Date;
  voltage: [number, number, number]; // volts, per phase L1/L2/L3
  currentImport: [number, number, number]; // amps, per phase
  power: [number, number, number]; // watts, per phase
  energyWh: number; // cumulative import register (Wh)
  totalPowerW: number; // total active power across phases (watts)
}

/**
 * Strategy for a specific DLM/load-balancer device. Adding support for a new DLM
 * product = implementing this interface and registering it (see registry.ts) —
 * no changes to the DlmDevice runtime or the control routes.
 */
export interface DlmDeviceType {
  id: string;
  /** Manufacturer, used to group models in the UI (e.g. "Charge-M8"). */
  brand: string;
  /** Model name shown in the UI (e.g. "Charge-M8-Libra-DLB"). */
  label: string;
  defaultReportIntervalMs: number;
  /** Build the OCPP call that carries a reading to the CSMS (vendor-specific). */
  buildReadingCall(reading: DlmReading): OcppCall;
}
