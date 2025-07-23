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

/**
 * Generate a random number between 1 and maxMs (inclusive of 1, exclusive of maxMs)
 * @param maxMs Maximum delay in milliseconds
 * @returns Random number between 1 and maxMs (minimum 1ms delay)
 */
export const generateRandomDelay = (maxMs: number): number => {
  if (maxMs <= 1) {
    return 1;
  }

  return Math.floor(Math.random() * (maxMs - 1)) + 1;
};
