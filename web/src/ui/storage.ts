import { DEFAULT_SIMULATOR_URL } from "../protocol/websocket";

const KEY = "pixelart.simulator";

// Browser storage can be missing or blocked: it is a convenience, never a requirement.
export function loadSimulatorAddress(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_SIMULATOR_URL;
  } catch {
    return DEFAULT_SIMULATOR_URL;
  }
}

export function saveSimulatorAddress(address: string): void {
  try {
    localStorage.setItem(KEY, address);
  } catch {
    // Not remembered.
  }
}
