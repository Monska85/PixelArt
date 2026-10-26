// SPDX-License-Identifier: GPL-3.0-or-later

// What the WiFi card says: words for the connection states, the signal quality and the transmit powers
// (docs/board/wifi-and-updates-v1.md#transmit-power, docs/web/web-app-v1.md#wifi).

import type { WifiState } from "../../protocol";

export const WIFI_STATE_TEXT: Record<WifiState, string> = {
  not_configured: "No network set up",
  connecting: "Connecting",
  connected: "Connected",
  network_not_found: "Network not found",
  wrong_password: "Wrong password",
  no_address: "Joined the network but got no address: the network may block new devices",
  disconnected: "Disconnected, trying again",
};

export type SignalQuality = "excellent" | "good" | "fair" | "weak";

/** -50 dBm or more is excellent, down to -67 good, down to -75 fair, below that weak. */
export function signalQuality(rssi: number): SignalQuality {
  if (rssi >= -50) return "excellent";
  if (rssi >= -67) return "good";
  if (rssi >= -75) return "fair";
  return "weak";
}

/** "-58 dBm, good". */
export const describeSignal = (rssi: number): string => `${rssi} dBm, ${signalQuality(rssi)}`;

export const POWER_AUTO = "auto";
export const LOWEST_POWER = "8.5";

/** The values of the `wifi_power` setting, with the label of the menu. */
export const POWER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: POWER_AUTO, label: "Auto (recommended)" },
  ...["8.5", "11", "13", "15", "17", "18.5", "19.5"].map((value) => ({ value, label: `${value} dBm` })),
];

/** The legend shown next to the setting. */
export const POWER_LEGEND: readonly string[] = [
  "Auto is recommended. It starts at full power and lowers it by itself when the board cannot connect.",
  "Lower values give less range and draw less current. They help boards with a weak antenna, such as some ESP32-C3 SuperMini boards.",
  "If the board does not connect or keeps dropping the connection, choose 8.5 dBm.",
  "If the connection is stable but the signal is weak (below -75 dBm), try a higher value.",
  "Signal: -50 dBm or more is excellent, -50 to -67 dBm good, -67 to -75 dBm fair, below -75 dBm weak.",
];
