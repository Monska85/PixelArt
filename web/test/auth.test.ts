// SPDX-License-Identifier: GPL-3.0-or-later

import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BoardClient, BoardError, isToken, loginHmac, type Login } from "../src/protocol";
import { FakeBoard } from "./fakeBoard";

const TOKEN = "k3j9x0q7w2m5z8a1";
const NONCE = "000102030405060708090a0b0c0d0e0f";
// Worked out with Python's hmac module and checked against node:crypto below, outside the code under test.
const ANSWER = "8a2422fe7ca97df26f5b82ca480c6f0362cb0e3eb9ebc9e8c0dd7467c28ffe23";

describe("the login answer", () => {
  it("is the HMAC-SHA256 of the nonce text under the token text", async () => {
    expect(await loginHmac(TOKEN, NONCE)).toBe(ANSWER);
    expect(createHmac("sha256", TOKEN).update(NONCE).digest("hex")).toBe(ANSWER);
  });

  it("is 64 lowercase hexadecimal digits", async () => {
    expect(await loginHmac("a1z8m5w2q7x0j9k3", "ffeeddccbbaa99887766554433221100")).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([TOKEN, "0123456789abcdef", "abcdefghijklmnop"])("accepts the token %s", (token) => {
    expect(isToken(token)).toBe(true);
  });

  it.each([
    "",
    "short",
    "k3j9x0q7w2m5z8a",
    "k3j9x0q7w2m5z8a12",
    "K3J9X0Q7W2M5Z8A1",
    "k3j9x0q7w2m5z8a!",
    " k3j9x0q7w2m5z8a",
  ])("refuses the token %j", (token) => {
    expect(isToken(token)).toBe(false);
  });
});

/** A board with network login on: everything but info and the login is unauthorized until `auth` carries the right HMAC. */
function boardWithLogin(): FakeBoard {
  const board = new FakeBoard();
  let nonce: string | null = null;
  let loggedIn = false;
  board.override = (request) => {
    if (request.cmd === "info") return undefined;
    if (request.cmd === "auth_challenge") {
      nonce = NONCE;
      return { ok: true, nonce };
    }
    if (request.cmd === "auth") {
      const right = nonce !== null && request.hmac === createHmac("sha256", TOKEN).update(nonce).digest("hex");
      nonce = null;
      loggedIn = right;
      return right ? { ok: true } : { ok: false, error: "unauthorized", message: "the login failed" };
    }
    return loggedIn ? undefined : { ok: false, error: "unauthorized", message: "log in first" };
  };
  return board;
}

function login(token: string | null) {
  const asked = vi.fn(async () => token);
  const refused = vi.fn();
  const provider: Login = { getToken: asked, refused };
  return Object.assign(provider, { asked, refused });
}

describe("a client that logs in", () => {
  it("answers unauthorized with a login and then repeats the request", async () => {
    const board = boardWithLogin();
    const client = new BoardClient(board, { firstSeq: 10 });
    const provider = login(TOKEN);
    client.login = provider;
    await client.handshake();
    expect((await client.command("settings_get")).settings).toEqual({ brightness: 100, playlist: "default" });
    expect(board.requests.map((r) => r.cmd)).toEqual([
      "info",
      "settings_get",
      "auth_challenge",
      "auth",
      "settings_get",
    ]);
    expect(board.requests[3]?.hmac).toBe(ANSWER);
    expect(provider.refused).not.toHaveBeenCalled();
  });

  it("never puts the token on the link", async () => {
    const board = boardWithLogin();
    const client = new BoardClient(board);
    client.login = login(TOKEN);
    await client.handshake();
    await client.command("settings_get");
    expect(JSON.stringify(board.requests)).not.toContain(TOKEN);
  });

  it("logs in once, not before every request", async () => {
    const board = boardWithLogin();
    const client = new BoardClient(board);
    const provider = login(TOKEN);
    client.login = provider;
    await client.command("settings_get");
    await client.command("settings_get");
    expect(provider.asked).toHaveBeenCalledTimes(1);
    expect(board.requests.filter((r) => r.cmd === "auth")).toHaveLength(1);
  });

  it("tells the provider when the board refuses the token, and throws the board's answer", async () => {
    const board = boardWithLogin();
    const client = new BoardClient(board);
    const provider = login("a1z8m5w2q7x0j9k3");
    client.login = provider;
    await expect(client.command("settings_get")).rejects.toMatchObject({ code: "unauthorized" });
    expect(provider.refused).toHaveBeenCalledTimes(1);
    expect(board.requests.filter((r) => r.cmd === "auth")).toHaveLength(1);
  });

  it("keeps the token when auth fails for another reason than a wrong token", async () => {
    const board = boardWithLogin();
    const inner = board.override;
    board.override = (request) =>
      request.cmd === "auth" ? { ok: false, error: "busy", message: "try again" } : inner(request);
    const client = new BoardClient(board);
    const provider = login(TOKEN);
    client.login = provider;
    await expect(client.command("settings_get")).rejects.toMatchObject({ code: "busy" });
    expect(provider.refused).not.toHaveBeenCalled();
  });

  it("throws unauthorized when the user gives no token", async () => {
    const board = boardWithLogin();
    const client = new BoardClient(board);
    client.login = login(null);
    const failure = await client.command("settings_get").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BoardError);
    expect(failure).toMatchObject({ code: "unauthorized" });
    expect(board.requests.map((r) => r.cmd)).toEqual(["settings_get"]);
  });

  it("does not log in again when the request is still unauthorized afterwards", async () => {
    const board = new FakeBoard();
    board.override = (request) => {
      if (request.cmd === "auth_challenge") return { ok: true, nonce: NONCE };
      if (request.cmd === "auth") return { ok: true };
      return request.cmd === "info" ? undefined : { ok: false, error: "unauthorized", message: "no" };
    };
    const client = new BoardClient(board);
    const provider = login(TOKEN);
    client.login = provider;
    const reply = await client.request("settings_get");
    expect(reply.error).toBe("unauthorized");
    expect(provider.asked).toHaveBeenCalledTimes(1);
  });

  it("returns unauthorized as it is on a connection that has no login", async () => {
    const board = boardWithLogin();
    const client = new BoardClient(board);
    expect((await client.request("settings_get")).error).toBe("unauthorized");
    expect(board.requests.map((r) => r.cmd)).toEqual(["settings_get"]);
  });

  it("refuses a challenge without a valid nonce", async () => {
    const board = new FakeBoard();
    board.override = (request) =>
      request.cmd === "auth_challenge"
        ? { ok: true, nonce: "NOT-A-NONCE" }
        : request.cmd === "info"
          ? undefined
          : { ok: false, error: "unauthorized", message: "no" };
    const client = new BoardClient(board);
    client.login = login(TOKEN);
    await expect(client.command("settings_get")).rejects.toMatchObject({ code: "protocol" });
  });
});
