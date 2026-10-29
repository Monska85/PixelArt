// SPDX-License-Identifier: GPL-3.0-or-later

import { describe, expect, it, vi } from "vitest";
import { FETCH_TIMEOUT_MS, contentVersionOf, loadManifest, parseManifest, readCapped } from "../src/release/manifest";
import { downloadPublished, libraryState } from "../src/release/library";
import { sha256Hex } from "../src/protocol";
import type { Entry } from "../src/protocol";

const SHA = "a".repeat(64);
const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id.toUpperCase(),
  version: 2,
  file: `animations/${id}.json`,
  size: 100,
  sha256: SHA,
  ...extra,
});
const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    format: "pixelart-manifest/1",
    version: "1.2.0",
    released: "2026-11-02",
    firmware: [],
    animations: [entry("star")],
    playlists: [{ id: "default", name: "Default", file: "playlists/default.json", size: 50, sha256: SHA }],
    ...extra,
  });

describe("parseManifest", () => {
  it("reads a valid manifest", () => {
    expect(parseManifest(manifest())).toEqual({
      version: "1.2.0",
      contentVersion: null,
      hasFirmware: false,
      animations: [{ id: "star", name: "STAR", version: 2, size: 100, sha256: SHA }],
      playlists: [{ id: "default", name: "Default", version: null, size: 50, sha256: SHA }],
      schedules: [],
      play: [],
    });
  });

  it("ignores the optional field source, as every field it does not know", () => {
    expect(parseManifest(manifest({ source: "https://github.com/Owner/Fork/tree/v1.2.0" }))).toEqual(
      parseManifest(manifest()),
    );
  });

  it("treats anything that is not a pixelart-manifest/1 as nothing published", () => {
    expect(parseManifest("")).toBeNull();
    expect(parseManifest("<html>")).toBeNull();
    expect(parseManifest("[]")).toBeNull();
    expect(parseManifest("null")).toBeNull();
    expect(parseManifest(manifest({ format: "pixelart-manifest/2" }))).toBeNull();
    expect(parseManifest(manifest({ format: undefined }))).toBeNull();
    expect(parseManifest(manifest({ version: 1 }))).toBeNull();
  });

  it("drops entries that are not safe to fetch", () => {
    const bad = [
      entry("Bad Id"),
      entry("../x"),
      entry("a", { file: "animations/other.json" }),
      entry("b", { file: "https://example.com/b.json" }),
      entry("c", { file: "../animations/c.json" }),
      entry("d", { size: 0 }),
      entry("e", { size: 64 * 1024 + 1 }),
      entry("f", { size: 1.5 }),
      entry("g", { sha256: "XYZ" }),
      entry("h", { sha256: SHA.toUpperCase() }),
      "text",
      null,
      entry("star"),
      entry("star"),
    ];
    const parsed = parseManifest(manifest({ animations: bad }));
    expect(parsed?.animations.map((a) => a.id)).toEqual(["star"]);
  });

  it("keeps a manifest whose lists are missing as an empty library", () => {
    expect(parseManifest(manifest({ animations: undefined, playlists: "x" }))).toMatchObject({
      animations: [],
      playlists: [],
    });
  });

  it("reads the content version, and none when it is absent, not a string or longer than 64 characters", () => {
    expect(parseManifest(manifest({ content_version: "1.4.0" }))?.contentVersion).toBe("1.4.0");
    expect(parseManifest(manifest())?.contentVersion).toBeNull();
    expect(parseManifest(manifest({ content_version: 4 }))?.contentVersion).toBeNull();
    expect(parseManifest(manifest({ content_version: "1".repeat(64) }))?.contentVersion).toBe("1".repeat(64));
    expect(parseManifest(manifest({ content_version: "1".repeat(65) }))?.contentVersion).toBeNull();
    expect(contentVersionOf(parseManifest(manifest({ content_version: "1.4.0" }))!)).toBe("1.4.0");
    expect(contentVersionOf(parseManifest(manifest())!)).toBe("1.2.0");
  });

  it("has firmware only when the firmware list is not empty", () => {
    const file = {
      board: "esp32c3",
      chip: "ESP32-C3",
      part: "app",
      offset: 65536,
      file: "x.bin",
      size: 1,
      sha256: SHA,
    };
    expect(parseManifest(manifest({ firmware: [file] }))?.hasFirmware).toBe(true);
    expect(parseManifest(manifest({ firmware: [] }))?.hasFirmware).toBe(false);
    expect(parseManifest(manifest({ firmware: undefined }))?.hasFirmware).toBe(false);
    expect(parseManifest(manifest({ firmware: "x" }))?.hasFirmware).toBe(false);
  });

  it("treats names and versions of the wrong type as absent", () => {
    const parsed = parseManifest(manifest({ animations: [entry("star", { name: 5, version: "2" })] }));
    expect(parsed?.animations[0]).toMatchObject({ name: null, version: null });
  });
});

describe("loadManifest", () => {
  const respond = (body: string, init?: ResponseInit) => (async () => new Response(body, init)) as typeof fetch;

  it("asks the server whether its copy is current", async () => {
    let seen: { url: string; cache?: RequestCache } | undefined;
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url, cache: init?.cache };
      return new Response(manifest());
    }) as unknown as typeof fetch;
    expect(await loadManifest(fake)).not.toBeNull();
    expect(seen).toEqual({ url: "./manifest.json", cache: "no-cache" });
  });

  it("returns null for a missing, failing or invalid manifest", async () => {
    expect(await loadManifest(respond("", { status: 404 }))).toBeNull();
    expect(await loadManifest(respond("not json"))).toBeNull();
    expect(await loadManifest((async () => Promise.reject(new TypeError("network"))) as typeof fetch)).toBeNull();
  });

  it("refuses a manifest above 1 MiB", async () => {
    expect(await loadManifest(respond(" ".repeat(1024 * 1024 + 1) + manifest()))).toBeNull();
  });

  it("ends a request that never answers and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = loadManifest(((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    }) as typeof fetch);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    expect(await pending).toBeNull();
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
  });
});

describe("readCapped", () => {
  it("returns the body up to the limit and null above it", async () => {
    expect(await readCapped(new Response("abcd"), 4)).toEqual(new TextEncoder().encode("abcd"));
    expect(await readCapped(new Response("abcde"), 4)).toBeNull();
  });

  it("cancels a body rejected by its declared length", async () => {
    const cancel = vi.fn(async () => undefined);
    const response = {
      headers: new Headers({ "content-length": "100" }),
      body: { cancel },
    } as unknown as Response;
    expect(await readCapped(response, 4)).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects a response without a stream without reading its whole body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(100));
    const response = {
      headers: new Headers(),
      body: null,
      arrayBuffer,
    } as unknown as Response;
    expect(await readCapped(response, 4)).toBeNull();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe("libraryState", () => {
  const published = { id: "star", name: "Star", version: 1, size: 1, sha256: SHA };
  const stored = (id: string, sha256: string | null): Entry => ({ id, size: 1, sha256, name: null, version: null });

  it("is unknown without a board", () => {
    expect(libraryState(published, null)).toBe("unknown");
  });
  it("is missing when the board has no file with the ID", () => {
    expect(libraryState(published, [])).toBe("missing");
    expect(libraryState(published, [stored("moon", SHA)])).toBe("missing");
  });
  it("is same for the published SHA-256, whatever its case", () => {
    expect(libraryState(published, [stored("star", SHA)])).toBe("same");
    expect(libraryState(published, [stored("star", SHA.toUpperCase())])).toBe("same");
  });
  it("is different for another or unknown SHA-256", () => {
    expect(libraryState(published, [stored("star", "b".repeat(64))])).toBe("different");
    expect(libraryState(published, [stored("star", null)])).toBe("different");
  });
});

describe("downloadPublished", () => {
  const body = new TextEncoder().encode('{"format":"pixelart/1"}');
  const make = async (override: Partial<{ size: number; sha256: string }> = {}) => ({
    id: "star",
    name: null,
    version: null,
    size: body.length,
    sha256: await sha256Hex(body),
    ...override,
  });
  const serve = (bytes: Uint8Array, status = 200) => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      return new Response(bytes as BufferSource, { status });
    }) as unknown as typeof fetch;
    return { fake, urls };
  };

  it("returns bytes that match the manifest, fetched from the layout's address", async () => {
    const { fake, urls } = serve(body);
    expect(await downloadPublished("animation", await make(), fake)).toEqual(body);
    expect(urls).toEqual(["./animations/star.json"]);
    const playlist = serve(body);
    await downloadPublished("playlist", await make(), playlist.fake);
    expect(playlist.urls).toEqual(["./playlists/star.json"]);
  });

  it("rejects a wrong size, a wrong SHA-256 and a failed request", async () => {
    await expect(
      downloadPublished("animation", await make({ size: body.length + 1 }), serve(body).fake),
    ).rejects.toThrow(/size/);
    await expect(
      downloadPublished("animation", await make({ size: body.length - 1 }), serve(body).fake),
    ).rejects.toThrow(/size/);
    await expect(downloadPublished("animation", await make({ sha256: SHA }), serve(body).fake)).rejects.toThrow(
      /SHA-256/,
    );
    await expect(downloadPublished("animation", await make(), serve(body, 404).fake)).rejects.toThrow(
      /Cannot download/,
    );
  });

  it("ends a download whose body stalls after the headers", async () => {
    vi.useFakeTimers();
    const pending = downloadPublished("animation", await make(), ((_url: string, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener("abort", () =>
                controller.error(new DOMException("Aborted", "AbortError")),
              );
            },
          }),
        ),
      )) as typeof fetch).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    const result = await pending;
    expect(result).toBeInstanceOf(Error);
    if (result instanceof Error) expect(result.message).toContain("timed out");
    vi.useRealTimers();
  });
});
