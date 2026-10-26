// SPDX-License-Identifier: GPL-3.0-or-later

// Improv Wi-Fi Serial, version 1 (https://www.improv-wifi.com/serial/): WiFi setup over the board's USB serial
// port, next to the command protocol (docs/board/wifi-and-updates-v1.md#setup-with-improv).
//
// A frame is `IMPROV`, the version, a type, the length of the data, the data, and a checksum: the sum of every
// earlier byte of the frame, modulo 256. The board's frames arrive mixed with protocol and log lines, so the line
// splitter finds them (see lines.ts) and hands them to ImprovClient through the transport's ImprovLink.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const IMPROV_MAGIC = encoder.encode("IMPROV");
export const IMPROV_VERSION = 1;
/** `IMPROV` and the version byte: what the line splitter looks for. */
export const IMPROV_HEADER = Uint8Array.from([...IMPROV_MAGIC, IMPROV_VERSION]);
export const MAX_FRAME_DATA = 255;

export const FrameType = { CurrentState: 0x01, ErrorState: 0x02, RpcCommand: 0x03, RpcResult: 0x04 } as const;

const STATE_PROVISIONED = 0x04;

const Command = { WifiSettings: 0x01, ScanNetworks: 0x04 } as const;

export interface ImprovFrame {
  type: number;
  data: Uint8Array;
}

/** The sum of the bytes, modulo 256. */
export function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (const byte of bytes) sum = (sum + byte) & 0xff;
  return sum;
}

/** A whole frame for the board. */
export function buildFrame(type: number, data: Uint8Array): Uint8Array {
  if (data.length > MAX_FRAME_DATA) throw new ImprovError("invalid_rpc", "An Improv frame holds at most 255 bytes.");
  const frame = new Uint8Array(IMPROV_HEADER.length + 2 + data.length + 1);
  frame.set(IMPROV_HEADER);
  frame[IMPROV_HEADER.length] = type;
  frame[IMPROV_HEADER.length + 1] = data.length;
  frame.set(data, IMPROV_HEADER.length + 2);
  frame[frame.length - 1] = checksum(frame.subarray(0, frame.length - 1));
  return frame;
}

function rpc(command: number, args: Uint8Array): Uint8Array {
  const data = new Uint8Array(2 + args.length);
  data[0] = command;
  data[1] = args.length;
  data.set(args, 2);
  return buildFrame(FrameType.RpcCommand, data);
}

export const MAX_SSID_BYTES = 32;
export const MAX_PASSWORD_BYTES = 64;

/** The frame that sends a network name and password. Throws ImprovError when the board would refuse them. */
export function wifiSettingsFrame(ssid: string, password: string): Uint8Array {
  const name = encoder.encode(ssid);
  const secret = encoder.encode(password);
  if (name.length < 1 || name.length > MAX_SSID_BYTES)
    throw new ImprovError("invalid_rpc", "A network name is 1 to 32 bytes long.");
  if (secret.length > MAX_PASSWORD_BYTES) throw new ImprovError("invalid_rpc", "A password is at most 64 bytes long.");
  if (ssid.includes("\0") || password.includes("\0"))
    throw new ImprovError("invalid_rpc", "A network name and a password cannot hold a NUL character.");
  const args = new Uint8Array(2 + name.length + secret.length);
  args[0] = name.length;
  args.set(name, 1);
  args[1 + name.length] = secret.length;
  args.set(secret, 2 + name.length);
  secret.fill(0);
  return rpc(Command.WifiSettings, args);
}

export function scanFrame(): Uint8Array {
  return rpc(Command.ScanNetworks, new Uint8Array(0));
}

export type ImprovErrorCode = "invalid_rpc" | "unknown_rpc" | "unable_to_connect" | "unknown" | "timeout" | "busy";

export class ImprovError extends Error {
  constructor(
    readonly code: ImprovErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImprovError";
  }
}

const ERROR_TEXT: Record<number, [ImprovErrorCode, string]> = {
  1: ["invalid_rpc", "The board did not understand the WiFi request."],
  2: ["unknown_rpc", "The board does not know this WiFi command."],
  3: [
    "unable_to_connect",
    "The board could not connect. Check the name and the password, and that the network is on 2.4 GHz. The board keeps the network and tries again.",
  ],
};

function errorOf(code: number): ImprovError {
  const [name, message] = ERROR_TEXT[code] ?? ["unknown", "The board reported a WiFi error."];
  return new ImprovError(name, message);
}

/** The strings of an RPC result: its command and every length-prefixed text after the two header bytes. */
export function parseResult(data: Uint8Array): { command: number; strings: string[] } | null {
  if (data.length < 2 || data[1] !== data.length - 2) return null;
  const strings: string[] = [];
  for (let at = 2; at < data.length;) {
    const size = data[at++] as number;
    if (at + size > data.length) return null;
    strings.push(decoder.decode(data.subarray(at, at + size)));
    at += size;
  }
  return { command: data[0] as number, strings };
}

/** The link to the board's Improv frames: the serial transport, in the browser. */
export interface ImprovLink {
  send(frame: Uint8Array): Promise<void>;
  /** Called with every frame the board sends. */
  onFrame: ((frame: ImprovFrame) => void) | null;
}

export interface WifiNetwork {
  ssid: string;
  /** Signal strength in dBm. */
  rssi: number;
  secure: boolean;
}

interface Timeouts {
  scanMs: number;
  provisionMs: number;
}

/** The board answers a connection after 30 seconds, and a scan after about 15. */
const DEFAULT_TIMEOUTS: Timeouts = { scanMs: 20_000, provisionMs: 40_000 };

/** Improv requests, one at a time. */
export class ImprovClient {
  private busy = false;

  constructor(
    private readonly link: ImprovLink,
    private readonly timeouts: Timeouts = DEFAULT_TIMEOUTS,
  ) {}

  /** The networks the board sees, strongest first. */
  async scan(): Promise<WifiNetwork[]> {
    const found: WifiNetwork[] = [];
    await this.run(scanFrame(), this.timeouts.scanMs, (frame) => {
      if (frame.type !== FrameType.RpcResult) return false;
      const result = parseResult(frame.data);
      if (!result || result.command !== Command.ScanNetworks) return false;
      if (result.strings.length === 0) return true; // the empty result ends the list
      const [ssid, rssi, secure] = result.strings;
      const dbm = Number.parseInt(rssi ?? "", 10);
      if (ssid && Number.isFinite(dbm) && !found.some((n) => n.ssid === ssid))
        found.push({ ssid, rssi: dbm, secure: secure === "YES" });
      return false;
    });
    return found.sort((a, b) => b.rssi - a.rssi);
  }

  /** Sends the network and resolves once the board is connected and has an address. */
  async provision(ssid: string, password: string): Promise<void> {
    await this.run(
      wifiSettingsFrame(ssid, password),
      this.timeouts.provisionMs,
      (frame) => frame.type === FrameType.CurrentState && frame.data[0] === STATE_PROVISIONED,
    );
  }

  /** Sends a frame and feeds the board's frames to `done` until it returns true; an error frame rejects. */
  private run(frame: Uint8Array, timeoutMs: number, done: (frame: ImprovFrame) => boolean): Promise<void> {
    if (this.busy) return Promise.reject(new ImprovError("busy", "Another WiFi request is running."));
    this.busy = true;
    const previous = this.link.onFrame;
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: ImprovError): void => {
        clearTimeout(timer);
        this.link.onFrame = previous;
        this.busy = false;
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new ImprovError("timeout", "The board did not answer in time.")),
        timeoutMs,
      );
      this.link.onFrame = (received) => {
        if (received.type === FrameType.ErrorState && received.data[0]) finish(errorOf(received.data[0]));
        else if (done(received)) finish();
      };
      this.link
        .send(frame)
        .catch((error: unknown) =>
          finish(new ImprovError("unknown", error instanceof Error ? error.message : "The frame could not be sent.")),
        );
    });
  }
}
