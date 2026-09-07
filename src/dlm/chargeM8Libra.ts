import { call } from "../messageFactory";
import { DlmDeviceType, DlmReading } from "./deviceType";

// The Charge-M8 Libra reports voltage/current/power scaled x1000 in its
// DataTransfer payload (e.g. 245500 = 245.5 V), while the energy register is
// raw Wh. Keeping the scaling here means other DLM device types can differ.
const SCALE = 1000;
const scale = (n: number) => Math.round(n * SCALE);

export const chargeM8Libra: DlmDeviceType = {
  id: "Charge-M8-Libra-DLB",
  brand: "Charge-M8",
  label: "Charge-M8-Libra-DLB",
  defaultReportIntervalMs: 5000,
  buildReadingCall(reading: DlmReading) {
    const data = {
      DeviceId: reading.deviceId,
      Ts: reading.timestamp.toISOString(),
      "Energy.Active.Import.Register": Math.round(reading.energyWh),
      "Power.Active.Import": scale(reading.totalPowerW),
      Power: reading.power.map(scale),
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
