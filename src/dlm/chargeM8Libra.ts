import { call } from "../messageFactory";
import { DlmDeviceType, DlmReading } from "./deviceType";

// Wire format confirmed against a real Charge-M8 Libra (device 202504110050,
// 250 readings in the 2026-09-09 CSMS logs). Only the encoding lives here —
// the reading is already shaped and quantised by DlmDevice, since how a site is
// wired and configured varies per install (see docs/DLM.md).
//
// Voltage (mV) and Current.Import (mA) are scaled x1000; Power and
// Power.Active.Import are plain watts. Power[0] / (V1 x I1) implies a power
// factor of 0.956-0.994 across the whole sample, which pins the watts as
// unscaled; a x1000 Power field would imply a power factor of ~982.
const SCALE = 1000;
const scale = (n: number) => Math.round(n * SCALE);

export const chargeM8Libra: DlmDeviceType = {
  id: "Charge-M8-Libra-DLB",
  brand: "Charge-M8",
  label: "Charge-M8-Libra-DLB",
  // Observed gaps: 10 s x64, 11 s x171, 12 s x8, 13 s x5, 15 s x1 (mean 10.8).
  defaultReportIntervalMs: 5000,
  buildReadingCall(reading: DlmReading) {
    const power = reading.power.map((w) => Math.round(w));
    const data = {
      DeviceId: reading.deviceId,
      // The device stamps whole seconds; no sample carried milliseconds.
      Ts: reading.timestamp.toISOString().replace(/\.\d{3}Z$/, "Z"),
      "Energy.Active.Import.Register": Math.round(reading.energyWh),
      // Sums the Power array rather than the true site load, so an unsensed
      // phase is missing from the total exactly as it is on the real device.
      "Power.Active.Import": power.reduce((a, b) => a + b, 0),
      Power: power,
      Voltage: reading.voltage.map(scale),
      "Current.Import": reading.currentImport.map(scale),
    };
    return call("DataTransfer", {
      vendorId: "Charge-M8",
      messageId: "MeterValues",
      // DataTransfer.json allows data to be a string; the platform parses it back
      data: JSON.stringify(data),
    });
  },
};
