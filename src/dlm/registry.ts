import { DlmDeviceType } from "./deviceType";
import { chargeM8Libra } from "./chargeM8Libra";

// Registry of supported DLM/load-balancer device types. To add a vendor, import
// its DlmDeviceType implementation and add it here — nothing else changes.
const registry: Record<string, DlmDeviceType> = {
  [chargeM8Libra.id]: chargeM8Libra,
};

export function resolveDlmDeviceType(id: string): DlmDeviceType {
  const type = registry[id];
  if (!type) {
    throw new Error(`Unknown DLM device type: ${id}`);
  }
  return type;
}

export function listDlmDeviceTypes(): {
  id: string;
  brand: string;
  label: string;
}[] {
  return Object.values(registry).map((t) => ({
    id: t.id,
    brand: t.brand,
    label: t.label,
  }));
}
