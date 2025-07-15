import { VendorConfig } from "./vendorConfig";

export const NOOP = () => {};

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const sleep = (delay: number) =>
  new Promise((resolve) => setTimeout(resolve, delay));

export const getVendor = (model: string) => {
  return VendorConfig.getVendorFromModel(model);
};

export const getFirmware = (model: string) => {
  return VendorConfig.getFirmwareFromModel(model);
};
