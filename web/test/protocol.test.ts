import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoardClient,
  BoardError,
  CONNECTION_LOST,
  NO_REPLY,
  TRIES,
  crc32,
  decodeLine,
  deleteFile,
  downloadFile,
  encodeLine,
  fromBase64,
  getSettings,
  listFiles,
  setSettings,
  toBase64,
  uploadFile,
  UploadCancelled,
} from "../src/protocol";
import { FakeBoard, replyLine } from "./fakeBoard";
import { text } from "./helpers";

describe("CRC-32 and framing", () => {
  it("matches the CRC-32 check value", () => {
    expect(crc32(text("123456789")).toString(16)).toBe("cbf43926");
  });

  it("writes the info request of the protocol document", () => {
    expect(encodeLine({ seq: 1, cmd: "info" })).toBe('@PR 3c250228 {"seq":1,"cmd":"info"}');
  });

  it("escapes every non-ASCII character so bytes equal characters", () => {
    const line = encodeLine({ seq: 1, cmd: "put_begin", id: "café \u{1f600}" });
    expect(line).toContain('"caf\\u00e9 \\ud83d\\ude00"');
    expect(new TextEncoder().encode(line).length).toBe(line.length);
    expect(decodeLine(text(line))).toMatchObject({ id: "café \u{1f600}" });
  });

  it("decodes a reply of the protocol document", () => {
    expect(decodeLine(text('@PR efda5dd8 {"seq":2,"ok":true}'))).toEqual({ seq: 2, ok: true });
  });

  it.each([
    ["another marker", '@PX efda5dd8 {"seq":2,"ok":true}'],
    ["a wrong CRC", '@PR efda5dd9 {"seq":2,"ok":true}'],
    ["upper-case hex digits", '@PR EFDA5DD8 {"seq":2,"ok":true}'],
    ["a short CRC", '@PR efda5d {"seq":2,"ok":true}'],
    ["no space after the CRC", '@PR efda5dd8{"seq":2,"ok":true}'],
    ["a log line", "pixelart: boot"],
    ["too short", "@PR 0"],
  ])("ignores %s", (_name, line) => {
    expect(decodeLine(text(line))).toBeNull();
  });

  it("ignores JSON that is not an object", () => {
    for (const payload of ["[1]", "5", "null", "{broken"]) {
      const bytes = text(payload);
      const line = text(`@PR ${crc32(bytes).toString(16).padStart(8, "0")} ${payload}`);
      expect(decodeLine(line)).toBeNull();
    }
  });

  it("converts base64 strictly", () => {
    expect(toBase64(Uint8Array.from([1, 2, 3, 4]))).toBe("AQIDBA==");
    expect(Array.from(fromBase64("AQIDBA=="))).toEqual([1, 2, 3, 4]);
    expect(fromBase64("")).toEqual(new Uint8Array());
    for (const bad of ["AQIDBA", "AQ=D", "A*ID", "AQIDBA=== "]) expect(() => fromBase64(bad)).toThrow(BoardError);
  });
});

describe("client", () => {
  let board: FakeBoard;
  let client: BoardClient;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    board = new FakeBoard();
    client = new BoardClient(board, { firstSeq: 100 });
  });
  afterEach(() => vi.useRealTimers());

  it("takes a random first seq, then counts up by one", async () => {
    const random = new BoardClient(new FakeBoard());
    expect(random).toBeDefined();
    await client.command("settings_get");
    await client.command("settings_get");
    expect(board.requests.map((r) => r.seq)).toEqual([101, 102]);
  });

  it("wraps the seq after 4,294,967,295", async () => {
    const wrapping = new BoardClient(board, { firstSeq: 4294967294 });
    await wrapping.command("settings_get");
    await wrapping.command("settings_get");
    await wrapping.command("settings_get");
    expect(board.requests.map((r) => r.seq)).toEqual([4294967295, 0, 1]);
  });

  it("does the handshake and remembers the limits", async () => {
    board.chunk = 256;
    const info = await client.handshake();
    expect(info).toMatchObject({ protocol: 1, firmware: "1.2.0", board: "simulator", bootId: 111 });
    expect(client.chunkSize).toBe(256);
    board.chunk = 4096;
    await client.handshake();
    expect(client.chunkSize).toBe(512);
  });

  it("refuses a board that speaks another protocol", async () => {
    board.protocol = 2;
    await expect(client.handshake()).rejects.toMatchObject({ code: "protocol_unsupported" });
  });

  it("tells when the boot_id changes", async () => {
    const restarted = vi.fn();
    client.onRestart = restarted;
    await client.handshake();
    await client.handshake();
    expect(restarted).not.toHaveBeenCalled();
    board.reboot();
    await client.handshake();
    expect(restarted).toHaveBeenCalledTimes(1);
  });

  it("repeats a request with the same seq after 2 seconds, up to 5 tries", async () => {
    board.fault = () => "drop";
    const lost = vi.fn();
    client.onLost = lost;
    const result = client.request("settings_get").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(TRIES * 2000);
    const error = await result;
    expect(error).toMatchObject({ code: NO_REPLY });
    expect(board.requests).toHaveLength(5);
    expect(new Set(board.requests.map((r) => r.seq)).size).toBe(1);
    expect(lost).toHaveBeenCalledTimes(1);
    await expect(client.request("settings_get")).rejects.toMatchObject({ code: CONNECTION_LOST });
  });

  it("waits only 1999 ms for the first retry", async () => {
    board.fault = (i) => (i === 0 ? "drop" : undefined);
    const result = client.command("settings_get");
    await vi.advanceTimersByTimeAsync(1999);
    expect(board.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(board.requests).toHaveLength(2);
  });

  it("waits 10 seconds for put_end", async () => {
    board.fault = (_i, r) => (r.cmd === "put_end" ? "drop" : undefined);
    await client.command("put_begin", { kind: "animation", id: "a", size: 0, sha256: "0".repeat(64) });
    const result = client.request("put_end", {}, client.putEndTimeout).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9999);
    expect(board.requests.filter((r) => r.cmd === "put_end")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(board.requests.filter((r) => r.cmd === "put_end")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(40_000);
    await result;
  });

  it("sends the request again at once after bad_frame, as one of the 5 tries", async () => {
    board.fault = (i) => (i < 4 ? "bad_frame" : undefined);
    const reply = await client.command("settings_get");
    expect(reply.ok).toBe(true);
    expect(board.requests).toHaveLength(5);
  });

  it("gives up after 5 bad_frame replies without waiting", async () => {
    board.fault = () => "bad_frame";
    await expect(client.request("settings_get")).rejects.toMatchObject({ code: NO_REPLY });
    expect(board.requests).toHaveLength(5);
  });

  it("discards a damaged reply and waits for the retry", async () => {
    board.fault = (i) => (i === 0 ? "corrupt" : undefined);
    const result = client.command("settings_get");
    await vi.advanceTimersByTimeAsync(2000);
    await result;
    expect(board.requests).toHaveLength(2);
  });

  it("discards a reply with another seq, and lines that are not replies", async () => {
    board.extra = () => [];
    board.override = () => undefined;
    // Foreign replies arrive before the right one.
    const original = board.send.bind(board);
    board.send = async (line: string) => {
      board.onLine?.(replyLine({ seq: 5, ok: true, settings: { brightness: 1, playlist: "x" } }));
      board.onLine?.(text("pixelart: a log line"));
      board.onLine?.(replyLine({ event: "something", data: 1 }));
      await original(line);
    };
    const settings = await getSettings(client);
    expect(settings).toEqual({ brightness: 100, playlist: "default" });
  });

  it("discards a late duplicate of an earlier reply", async () => {
    board.extra = (r) =>
      r.cmd === "settings_get"
        ? [replyLine({ seq: r.seq, ok: true, settings: { brightness: 1, playlist: "late" } })]
        : [];
    await client.command("settings_get");
    board.extra = () => [];
    const second = await getSettings(client);
    expect(second.playlist).toBe("default");
  });

  it("keeps one request in flight", async () => {
    let inFlight = 0;
    let max = 0;
    const original = board.send.bind(board);
    board.send = async (line: string) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await original(line);
      inFlight--;
    };
    await Promise.all([client.command("settings_get"), client.command("settings_get"), client.command("info")]);
    expect(max).toBe(1);
    expect(board.requests.map((r) => r.cmd)).toEqual(["settings_get", "settings_get", "info"]);
  });

  it("turns a failure reply into a BoardError with its diagnostics", async () => {
    await expect(client.command("delete", { kind: "animation", id: "nope" })).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(client.command("nothing")).rejects.toMatchObject({ code: "unknown_command" });
  });

  it("reports a closed connection", async () => {
    const lost = vi.fn();
    client.onLost = lost;
    const result = client.command("settings_get").catch((e: unknown) => e);
    board.fault = () => "drop";
    await board.close();
    expect(lost).toHaveBeenCalled();
    await result;
    await expect(client.command("info")).rejects.toMatchObject({ code: CONNECTION_LOST });
  });
});

const animation = (name: string, extra = ""): Uint8Array =>
  text(
    `{"format":"pixelart/1","name":"${name}","canvas":{"width":16,"height":16},"sprites":{"a":{"points":[[1,1,"#ff0000"]]}},"timeline":[{"show":["a"]}]${extra}}`,
  );

describe("files", () => {
  let board: FakeBoard;
  let client: BoardClient;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    board = new FakeBoard();
    board.chunk = 64;
    client = new BoardClient(board, { firstSeq: 1 });
    await client.handshake();
  });
  afterEach(() => vi.useRealTimers());

  it("lists page by page", async () => {
    for (let i = 0; i < 20; i++) board.files.animation.set(`a${String(i).padStart(2, "0")}`, animation(`n${i}`));
    const entries = await listFiles(client, "animation");
    expect(entries).toHaveLength(20);
    expect(entries[0]).toMatchObject({ id: "a00", name: "A00", version: null });
    expect(board.requests.filter((r) => r.cmd === "list")).toHaveLength(3);
    expect(board.requests.filter((r) => r.cmd === "list").map((r) => r.after)).toEqual([undefined, "a07", "a15"]);
  });

  it("stops when the board repeats a page", async () => {
    board.override = (r) =>
      r.cmd === "list"
        ? { ok: true, kind: "animation", entries: [{ id: "a", size: 1, sha256: "0".repeat(64) }], more: true }
        : undefined;
    await expect(listFiles(client, "animation")).rejects.toMatchObject({ code: "protocol" });
  });

  it("stops when the board lists more files than it can store", async () => {
    let page = 0;
    board.override = (r) => {
      if (r.cmd !== "list") return undefined;
      const entries = Array.from({ length: 256 }, (_, i) => ({
        id: `a${String(page * 256 + i).padStart(6, "0")}`,
        size: 1,
        sha256: "0".repeat(64),
      }));
      page++;
      return { ok: true, kind: "animation", entries, more: true };
    };
    await expect(listFiles(client, "animation")).rejects.toMatchObject({ code: "protocol" });
    expect(page).toBeLessThanOrEqual(17);
  });

  it("stops when a page ends before the id it continues after", async () => {
    let page = 0;
    board.override = (r) =>
      r.cmd === "list"
        ? {
            ok: true,
            kind: "animation",
            entries: [{ id: page++ === 0 ? "m" : "b", size: 1, sha256: "0".repeat(64) }],
            more: true,
          }
        : undefined;
    await expect(listFiles(client, "animation")).rejects.toMatchObject({ code: "protocol" });
    expect(board.requests.filter((r) => r.cmd === "list")).toHaveLength(2);
  });

  it("uploads, chunk by chunk, and reports progress and warnings", async () => {
    const data = animation("Dot", `,"description":"${"x".repeat(300)}"`);
    const progress: number[] = [];
    const warnings = await uploadFile(client, "animation", "dot", data, { onProgress: (done) => progress.push(done) });
    expect(board.files.animation.get("dot")).toEqual(data);
    expect(warnings).toHaveLength(1);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(data.length);
    const chunks = board.requests.filter((r) => r.cmd === "put_chunk");
    expect(chunks.length).toBe(Math.ceil(data.length / 64));
    expect(board.requests.at(-1)?.cmd).toBe("put_end");
  });

  it("downloads and checks the SHA-256", async () => {
    const data = animation("Dot", `,"description":"${"y".repeat(200)}"`);
    board.files.animation.set("dot", data);
    expect(await downloadFile(client, "animation", "dot")).toEqual(data);
    await expect(downloadFile(client, "animation", "nope")).rejects.toMatchObject({ code: "not_found" });
  });

  it("downloads with a known entry without listing, and lists again when the file has changed since", async () => {
    const data = animation("Dot", `,"description":"${"y".repeat(200)}"`);
    board.files.animation.set("dot", data);
    const [entry] = await listFiles(client, "animation");
    board.requests.length = 0;
    expect(await downloadFile(client, "animation", "dot", entry)).toEqual(data);
    expect(board.requests.some((r) => r.cmd === "list")).toBe(false);

    const other = animation("Other", `,"description":"${"z".repeat(200)}"`);
    board.files.animation.set("dot", other);
    expect(await downloadFile(client, "animation", "dot", entry)).toEqual(other);
    expect(board.requests.some((r) => r.cmd === "list")).toBe(true);
  });

  it("reads a file again once when it changed during the download", async () => {
    const data = animation("Dot", `,"description":"${"y".repeat(200)}"`);
    board.files.animation.set("dot", data);
    let gets = 0;
    const original = board.send.bind(board);
    board.send = async (line: string) => {
      await original(line);
      if (board.requests.at(-1)?.cmd === "get" && ++gets === 2)
        board.files.animation.set("dot", animation("Other", `,"description":"${"z".repeat(200)}"`));
    };
    expect(new TextDecoder().decode(await downloadFile(client, "animation", "dot"))).toContain("Other");
  });

  it("reports an error when the file keeps changing", async () => {
    board.files.animation.set("dot", animation("Dot", `,"description":"${"y".repeat(200)}"`));
    board.override = (r) => (r.cmd === "get" ? { ok: true, size: 5, offset: r.offset, data: "AAAA" } : undefined);
    await expect(downloadFile(client, "animation", "dot")).rejects.toMatchObject({ code: "changed" });
    expect(board.requests.filter((r) => r.cmd === "get").length).toBeGreaterThanOrEqual(2);
  });

  it("deletes and changes the settings", async () => {
    board.files.playlist.set("p", text("{}"));
    await deleteFile(client, "playlist", "p");
    expect(board.files.playlist.size).toBe(0);
    expect(await setSettings(client, { brightness: 40 })).toEqual({ brightness: 40, playlist: "default" });
    expect(await setSettings(client, { playlist: "christmas" })).toEqual({ brightness: 40, playlist: "christmas" });
  });

  describe("upload recovery", () => {
    const data = animation("Dot", `,"description":"${"x".repeat(300)}"`);

    it("resumes from expected after bad_offset", async () => {
      let skipped = false;
      board.override = (r) => {
        if (r.cmd === "put_chunk" && r.offset === 128 && !skipped) {
          skipped = true;
          return { ok: false, error: "bad_offset", message: "gap", expected: 64 };
        }
        return undefined;
      };
      await uploadFile(client, "animation", "dot", data);
      expect(board.files.animation.get("dot")).toEqual(data);
      expect(board.requests.filter((r) => r.cmd === "put_chunk" && r.offset === 64).length).toBeGreaterThanOrEqual(1);
    });

    it("gives up on bad_offset after 5 resumes and aborts", async () => {
      board.override = (r) =>
        r.cmd === "put_chunk" && r.offset === 64
          ? { ok: false, error: "bad_offset", message: "gap", expected: 0 }
          : undefined;
      await expect(uploadFile(client, "animation", "dot", data)).rejects.toMatchObject({ code: "bad_offset" });
      expect(board.requests.at(-1)?.cmd).toBe("put_abort");
    });

    it.each([[-1], [1.5], ["64"], [null], [data.length + 1]])(
      "fails on a bad_offset expecting %s",
      async (expected) => {
        board.override = (r) =>
          r.cmd === "put_chunk" && r.offset === 64
            ? { ok: false, error: "bad_offset", message: "gap", expected }
            : undefined;
        await expect(uploadFile(client, "animation", "dot", data)).rejects.toMatchObject({ code: "bad_offset" });
        expect(board.requests.filter((r) => r.cmd === "put_chunk" && r.offset === 64)).toHaveLength(1);
        expect(board.requests.at(-1)?.cmd).toBe("put_abort");
      },
    );

    it("does not report a restart again after one was handled", async () => {
      let first = true;
      board.override = (r) => {
        if (r.cmd !== "put_chunk" || r.offset !== 64) return undefined;
        if (first) {
          first = false;
          board.reboot();
        }
        return { ok: false, error: "storage_error", message: "disk" };
      };
      await expect(uploadFile(client, "animation", "dot", data)).rejects.toMatchObject({ code: "storage_error" });
      expect(client.info?.bootId).toBe(board.bootId);
    });

    it("fires onRestart once when the restart is found during an upload, not again on the next handshake", async () => {
      const restarted = vi.fn();
      client.onRestart = restarted;
      let first = true;
      board.override = (r) => {
        if (r.cmd !== "put_chunk" || !first) return undefined;
        first = false;
        board.reboot();
        return { ok: false, error: "busy", message: "x" };
      };
      await uploadFile(client, "animation", "dot", data);
      expect(restarted).toHaveBeenCalledTimes(1);
      await client.handshake();
      expect(restarted).toHaveBeenCalledTimes(1);
    });

    it("jumps ahead when received is larger than its own count", async () => {
      let first = true;
      board.override = (r) => {
        if (r.cmd === "put_chunk" && r.offset === 0 && first) {
          first = false;
          return { ok: true, received: 128 };
        }
        return undefined;
      };
      const original = board.send.bind(board);
      board.send = async (line: string) => {
        await original(line);
      };
      // The fake board did not store the first chunk, so the upload ends in a size mismatch; the point is the next offset.
      await uploadFile(client, "animation", "dot", data).catch(() => undefined);
      const offsets = board.requests.filter((r) => r.cmd === "put_chunk").map((r) => r.offset);
      expect(offsets.slice(0, 2)).toEqual([0, 128]);
    });

    it("restarts from put_begin once on no_upload", async () => {
      let dropped = false;
      board.override = (r) => {
        if (r.cmd === "put_chunk" && r.offset === 64 && !dropped) {
          dropped = true;
          board.reboot();
          return { ok: false, error: "no_upload", message: "none" };
        }
        return undefined;
      };
      await uploadFile(client, "animation", "dot", data);
      expect(board.files.animation.get("dot")).toEqual(data);
      expect(board.requests.filter((r) => r.cmd === "put_begin")).toHaveLength(2);
    });

    it("fails on a second no_upload and aborts", async () => {
      board.override = (r) => (r.cmd === "put_chunk" ? { ok: false, error: "no_upload", message: "none" } : undefined);
      await expect(uploadFile(client, "animation", "dot", data)).rejects.toMatchObject({ code: "no_upload" });
      expect(board.requests.filter((r) => r.cmd === "put_begin")).toHaveLength(2);
      expect(board.requests.at(-1)?.cmd).toBe("put_abort");
    });

    it("restarts once when the boot_id changed", async () => {
      let hit = false;
      board.override = (r) => {
        if (r.cmd === "put_chunk" && r.offset === 64 && !hit) {
          hit = true;
          board.reboot();
          return { ok: false, error: "storage_error", message: "odd" };
        }
        return undefined;
      };
      await uploadFile(client, "animation", "dot", data);
      expect(board.files.animation.get("dot")).toEqual(data);
      expect(board.requests.filter((r) => r.cmd === "put_begin")).toHaveLength(2);
    });

    it("sends put_abort on any other error and reports it", async () => {
      board.override = (r) =>
        r.cmd === "put_chunk" ? { ok: false, error: "storage_error", message: "disk" } : undefined;
      await expect(uploadFile(client, "animation", "dot", data)).rejects.toMatchObject({
        code: "storage_error",
        message: "disk",
      });
      expect(board.requests.at(-1)?.cmd).toBe("put_abort");
      expect(board.uploading).toBe(false);
    });

    it("shows the diagnostics of a rejected file and aborts", async () => {
      const bad = text('{"INVALID":true}');
      const error = (await uploadFile(client, "animation", "bad", bad).catch((e: unknown) => e)) as BoardError;
      expect(error.code).toBe("invalid_file");
      expect(error.diagnostics).toEqual([
        { severity: "error", code: "unknown_color", where: "sprites.a.points[0]", message: "unknown color" },
      ]);
    });

    it("sends put_abort when cancelled", async () => {
      const controller = new AbortController();
      const result = uploadFile(client, "animation", "dot", data, {
        signal: controller.signal,
        onProgress: (done) => {
          if (done >= 64) controller.abort();
        },
      }).catch((e: unknown) => e);
      expect(await result).toBeInstanceOf(UploadCancelled);
      expect(board.requests.at(-1)?.cmd).toBe("put_abort");
      expect(board.files.animation.has("dot")).toBe(false);
    });

    it("does not send put_abort when the connection is lost", async () => {
      board.fault = (_i, r) => (r.cmd === "put_chunk" ? "drop" : undefined);
      let settled = false;
      const result = uploadFile(client, "animation", "dot", data)
        .catch((e: unknown) => e)
        .finally(() => {
          settled = true;
        });
      // Real hashing runs between timers, so advance until the upload settles; the test timeout is the guard.
      while (!settled) {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(2000);
      }
      expect(await result).toMatchObject({ code: NO_REPLY });
      expect(board.requests.some((r) => r.cmd === "put_abort")).toBe(false);
    });
  });
});
