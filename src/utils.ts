export const NOOP = () => {};
export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
export const sleep = (delay: number) => new Promise((resolve) => setTimeout(resolve, delay));
export const getVendor = (model: string) => {
    if (model.includes("EVA")) {
        return "ATESS";
    } else if (model.includes("EVC")) {
        return "Vestel";
    } else if (model.includes("KC-P")) {
        return "Keba";
    } else {
        return "Unknown";
    }
}
export const getFirmware = (model: string) => {
    if (model.includes("EVA")) {
        return "EVA-07S_SE-V4.2.9-20220610";
    } else if (model.includes("EVC")) {
        return "v4.28.0-1.5.154.0-v8.0.8";
    } else {
        return "1.0.0";
    }
}