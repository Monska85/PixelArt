// SPDX-License-Identifier: GPL-3.0-or-later

// What ESP Web Tools and Web Serial need a real board for, drawn in the page: a closing install dialog, and a serial
// port whose bytes go to the simulator's WebSocket, so the app's own connection and queue run against the simulator.

import type { Page } from "@playwright/test";

export interface PortLog {
  /** Calls of `open()`, failed ones included. */
  opens: number;
  /** Times the app asked the browser for a port: after a first install it must not. */
  pickerRequests: number;
}

interface FakePortOptions {
  /** The simulator's WebSocket address the port is wired to, or null for a board that never answers. */
  board: string | null;
  /** Calls of `open()` that fail first, as a port does while the board restarts. */
  failOpens?: number;
  /** `requestPort()` returns the port, as when the user picks it in Connect board, not a dismissed picker. */
  pick?: boolean;
  /**
   * What a port without a board does with the lines written to it: nothing, or a line that is not the protocol, like
   * the log of an old sketch.
   */
  answer?: "none" | "garbage";
}

type Fake = { log: PortLog; port: unknown; errors: string[] };

/**
 * Replaces `navigator.serial` with a port wired as `options` says, and with Chrome's rules: `open()` fails while the
 * port is open, and `close()` fails while a stream is locked. Call before the page loads.
 */
export async function fakeSerial(page: Page, options: FakePortOptions): Promise<void> {
  await page.addInitScript(({ board, failOpens = 0, pick = false, answer = "none" }: FakePortOptions) => {
    const log = { opens: 0, pickerRequests: 0 };
    const errors: string[] = [];
    let socket: WebSocket | null = null;
    let source: ReadableStreamDefaultController<Uint8Array> | null = null;
    let isOpen = false;
    let failures = failOpens;
    const port = {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      async open(): Promise<void> {
        log.opens++;
        if (failures > 0) {
          failures--;
          errors.push("NetworkError");
          throw new DOMException("Failed to open serial port.", "NetworkError");
        }
        if (isOpen) {
          errors.push("InvalidStateError");
          throw new DOMException("The port is already open.", "InvalidStateError");
        }
        if (board)
          socket = await new Promise<WebSocket>((resolve, reject) => {
            const opened = new WebSocket(board);
            opened.onopen = () => resolve(opened);
            opened.onerror = () => reject(new DOMException("The board is not there.", "NetworkError"));
          });
        isOpen = true;
        port.readable = new ReadableStream<Uint8Array>({ start: (controller) => void (source = controller) });
        port.writable = new WritableStream<Uint8Array>({
          write: (chunk) => {
            for (const line of new TextDecoder().decode(chunk).split("\n")) if (line) socket?.send(line);
            if (!board && answer === "garbage")
              try {
                source?.enqueue(new TextEncoder().encode("boot: old sketch, no command protocol\n"));
              } catch {
                // Cancelled by the app's own close already.
              }
          },
        });
        if (socket) socket.onmessage = (event) => source?.enqueue(new TextEncoder().encode(`${event.data}\n`));
      },
      async close(): Promise<void> {
        if (port.readable?.locked || port.writable?.locked) throw new TypeError("Cannot close a locked stream");
        isOpen = false;
        socket?.close(1000);
        socket = null;
        try {
          source?.close();
        } catch {
          // Cancelled by the app's own close already.
        }
        port.readable = null;
        port.writable = null;
      },
      async setSignals(): Promise<void> {},
    };
    (window as unknown as { fakeSerial: Fake }).fakeSerial = { log, port, errors };
    Object.defineProperty(navigator, "serial", {
      configurable: true,
      value: {
        requestPort: async () => {
          log.pickerRequests++;
          if (pick) return port;
          throw new DOMException("no port in the test", "AbortError");
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  }, options);
}

export const portLog = (page: Page): Promise<PortLog> =>
  page.evaluate(() => ({ ...(window as unknown as { fakeSerial: Fake }).fakeSerial.log }));

/** The names of the errors the port's `open()` threw, in order. */
export const openErrors = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...(window as unknown as { fakeSerial: Fake }).fakeSerial.errors]);

/**
 * Draws the closing of an ESP Web Tools dialog as ESP Web Tools does it: an `ewt-install-dialog` that holds the port,
 * the manifest of the button and the state of its installation, fires `closed` (bubbling, composed), and goes.
 * `state` null is a dialog that never started installing. Resolves after the app has had its turn.
 */
export async function closeInstallDialog(
  page: Page,
  { state, manifest = "./firmware/install.json" }: { state: string | null; manifest?: string },
): Promise<void> {
  await page.evaluate(
    async ({ state, manifest }) => {
      const dialog = document.createElement("ewt-install-dialog");
      Object.assign(dialog, {
        port: (window as unknown as { fakeSerial: Fake }).fakeSerial.port,
        manifestPath: manifest,
        _installState: state === null ? undefined : { state },
      });
      document.body.appendChild(dialog);
      dialog.dispatchEvent(new CustomEvent("closed", { bubbles: true, composed: true }));
      dialog.remove();
      // The listener runs at once; this gives what it starts the time to show.
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
    { state, manifest },
  );
}
