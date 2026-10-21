// What the board stores: listing, download, upload, delete, settings
// (docs/protocol/protocol-v1.md#commands) with the recovery of tools/pixelart.py.

import {
  BoardError,
  errorFromReply,
  type BoardClient,
  type Kind,
  type Reply,
  type WireDiagnostic,
  parseDiagnostics,
} from "./client";

export interface Entry {
  id: string;
  size: number;
  sha256: string | null;
  name: string | null;
  version: number | null;
}

export interface Settings {
  brightness: number;
  playlist: string;
}

/** The settings of a board that was never set up, and after `delete_all` with `settings`. */
export const DEFAULT_SETTINGS: Readonly<Settings> = { brightness: 100, playlist: "default" };

const TRIES = 5;
const UPLOAD_ATTEMPTS = 2;
const FILE_LIMITS: Record<Kind, number> = { animation: 64 * 1024, playlist: 16 * 1024 };

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Standard base64 with padding; anything else is an error. */
export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    throw new BoardError("protocol", "the board sent invalid base64");
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function parseEntry(value: unknown): Entry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== "string" || !isCount(e.size)) return null;
  return {
    id: e.id,
    size: e.size,
    sha256: typeof e.sha256 === "string" ? e.sha256 : null,
    name: typeof e.name === "string" && e.name !== "" ? e.name : null,
    version: isCount(e.version) ? e.version : null,
  };
}

/** More entries than any board can store: a hostile board with ever-larger ids would page forever. */
export const MAX_LISTED_ENTRIES = 4096;

/** Every stored file of one kind, page by page. */
export async function listFiles(client: BoardClient, kind: Kind): Promise<Entry[]> {
  const out: Entry[] = [];
  let after: string | null = null;
  for (;;) {
    const reply: Reply = await client.command("list", after === null ? { kind } : { kind, after });
    const entries = (Array.isArray(reply.entries) ? reply.entries : [])
      .map(parseEntry)
      .filter((e): e is Entry => e !== null);
    out.push(...entries);
    if (out.length > MAX_LISTED_ENTRIES)
      throw new BoardError("protocol", `the board lists more than ${MAX_LISTED_ENTRIES} ${kind} files`);
    const last = entries[entries.length - 1];
    if (reply.more !== true || !last) return out;
    if (after !== null && last.id <= after)
      throw new BoardError("protocol", `the board repeats a page of the ${kind} list`);
    after = last.id;
  }
}

class Changed extends BoardError {
  constructor(message: string) {
    super("changed", message);
  }
}

async function downloadOnce(client: BoardClient, kind: Kind, id: string, known?: Entry): Promise<Uint8Array> {
  const entry = known ?? (await listFiles(client, kind)).find((e) => e.id === id);
  if (!entry) throw new BoardError("not_found", `no ${kind} '${id}' on the board`);
  const limit = Math.min(client.info?.limits[kind] ?? FILE_LIMITS[kind], FILE_LIMITS[kind]);
  if (entry.size > limit)
    throw new BoardError(
      "protocol",
      `the board reports ${entry.size} bytes for ${kind} '${id}', above the limit of ${limit}`,
    );
  const data = new Uint8Array(entry.size);
  let have = 0;
  for (;;) {
    const reply = await client.command("get", { kind, id, offset: have, length: client.chunkSize });
    const part = fromBase64(typeof reply.data === "string" ? reply.data : "");
    if (have + part.length > entry.size) throw new Changed("the file changed while it was read");
    if (reply.size !== entry.size) throw new Changed("the file changed while it was read");
    data.set(part, have);
    have += part.length;
    if (have === entry.size) break;
    if (part.length === 0) throw new BoardError("protocol", "the board returned no data before the end of the file");
  }
  if (entry.sha256 === null || (await sha256Hex(data)) !== entry.sha256)
    throw new Changed("the downloaded file does not match its SHA-256");
  return data;
}

/**
 * The bytes of a stored file, checked against the SHA-256 that `list` reports. A changed file is read once more.
 * `known` is the entry of a list read a moment ago: it saves listing the kind again, and a mismatch (the file changed
 * since) is followed by a fresh list.
 */
export async function downloadFile(client: BoardClient, kind: Kind, id: string, known?: Entry): Promise<Uint8Array> {
  try {
    return await downloadOnce(client, kind, id, known);
  } catch (error) {
    if (!(error instanceof Changed)) throw error;
  }
  try {
    return await downloadOnce(client, kind, id);
  } catch (error) {
    if (error instanceof Changed) throw new BoardError("changed", `${error.message}: try again`);
    throw error;
  }
}

export async function deleteFile(client: BoardClient, kind: Kind, id: string): Promise<void> {
  await client.command("delete", { kind, id });
}

export interface DeleteAllResult {
  playlists: number;
  animations: number;
  /** The settings after the reset, when the settings were reset. */
  settings?: Settings;
}

/** Removing many files takes the board a while: the same wait as for `put_end`. */
export const DELETE_ALL_TIMEOUT_MS = 10_000;

/**
 * Removes every playlist and animation and, with `resetSettings`, then puts the settings back to their defaults. A
 * failure reply throws: `unknown_command` on a firmware without `delete_all`, `bad_request` on one that does not know
 * `settings` (nothing is removed then), `storage_error` when a file or the settings could not be changed.
 */
export async function deleteAll(client: BoardClient, { resetSettings = false } = {}): Promise<DeleteAllResult> {
  const reply = await client.command("delete_all", resetSettings ? { settings: true } : {}, DELETE_ALL_TIMEOUT_MS);
  if (!isCount(reply.playlists) || !isCount(reply.animations))
    throw new BoardError("protocol", "the board sent invalid counts for delete_all");
  const removed = { playlists: reply.playlists, animations: reply.animations };
  if (!resetSettings) return removed;
  if (typeof reply.settings !== "object" || reply.settings === null)
    throw new BoardError("protocol", "the board sent no settings after resetting them");
  return { ...removed, settings: parseSettings(reply) };
}

function parseSettings(reply: Reply): Settings {
  const s =
    typeof reply.settings === "object" && reply.settings !== null ? (reply.settings as Record<string, unknown>) : {};
  return {
    brightness: isCount(s.brightness) ? s.brightness : 0,
    playlist: typeof s.playlist === "string" ? s.playlist : "",
  };
}

export async function getSettings(client: BoardClient): Promise<Settings> {
  return parseSettings(await client.command("settings_get"));
}

export async function setSettings(client: BoardClient, changes: Partial<Settings>): Promise<Settings> {
  return parseSettings(await client.command("settings_set", changes));
}

export class UploadCancelled extends Error {
  constructor() {
    super("upload cancelled");
  }
}

/** The board lost the upload: no_upload, or it restarted. */
class UploadGone extends BoardError {
  constructor(message: string) {
    super("no_upload", message);
  }
}

export interface UploadOptions {
  signal?: AbortSignal;
  /** Bytes acknowledged by the board so far. */
  onProgress?: (done: number, total: number) => void;
}

async function bootChanged(client: BoardClient): Promise<boolean> {
  const before = client.info?.bootId ?? null;
  try {
    const reply = await client.command("info");
    const now = typeof reply.boot_id === "number" ? reply.boot_id : null;
    const changed = before !== null && now !== before;
    // Later checks compare against the boot that is running now.
    if (changed && client.info) {
      client.info.bootId = now;
      client.onRestart?.();
    }
    return changed;
  } catch {
    return false;
  }
}

function fail(reply: Reply): never {
  if (reply.error === "no_upload") throw new UploadGone(errorFromReply(reply).message);
  throw errorFromReply(reply);
}

async function uploadOnce(
  client: BoardClient,
  kind: Kind,
  id: string,
  data: Uint8Array,
  options: UploadOptions,
): Promise<WireDiagnostic[]> {
  await client.command("put_begin", { kind, id, size: data.length, sha256: await sha256Hex(data) });
  let offset = 0;
  let resumes = 0;
  options.onProgress?.(0, data.length);
  while (offset < data.length) {
    if (options.signal?.aborted) throw new UploadCancelled();
    const chunk = data.subarray(offset, offset + client.chunkSize);
    const reply = await client.request("put_chunk", { offset, data: toBase64(chunk) });
    if (reply.ok === true) {
      offset = typeof reply.received === "number" && reply.received > offset ? reply.received : offset + chunk.length;
      options.onProgress?.(Math.min(offset, data.length), data.length);
    } else if (
      reply.error === "bad_offset" &&
      resumes < TRIES &&
      isCount(reply.expected) &&
      reply.expected <= data.length
    ) {
      resumes++;
      offset = reply.expected;
    } else {
      if (reply.error !== "no_upload" && (await bootChanged(client))) throw new UploadGone("the board restarted");
      fail(reply);
    }
  }
  if (options.signal?.aborted) throw new UploadCancelled();
  const reply = await client.request("put_end", {}, client.putEndTimeout);
  if (reply.ok !== true) {
    if (reply.error !== "no_upload" && reply.error !== "invalid_file" && (await bootChanged(client)))
      throw new UploadGone("the board restarted");
    fail(reply);
  }
  return parseDiagnostics(reply.warnings);
}

export async function abortUpload(client: BoardClient): Promise<void> {
  try {
    await client.request("put_abort");
  } catch {
    // Nothing more to do: the board drops the upload after 10 seconds.
  }
}

/**
 * put_begin, put_chunk..., put_end. Returns the warnings of the board's validation.
 * When the board lost the upload it starts again from put_begin, once. Any other
 * failure, and a cancel, send put_abort. Throws UploadCancelled when cancelled.
 */
export async function uploadFile(
  client: BoardClient,
  kind: Kind,
  id: string,
  data: Uint8Array,
  options: UploadOptions = {},
): Promise<WireDiagnostic[]> {
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await uploadOnce(client, kind, id, data, options);
    } catch (error) {
      if (error instanceof UploadGone && attempt + 1 < UPLOAD_ATTEMPTS) continue;
      // A lost link cannot take put_abort: the caller sends it after reconnecting.
      if (!(error instanceof BoardError && (error.code === "connection_lost" || error.code === "no_reply")))
        await abortUpload(client);
      throw error;
    }
  }
  throw new BoardError("upload_failed", "the upload failed");
}
