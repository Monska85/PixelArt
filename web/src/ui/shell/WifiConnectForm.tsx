// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { WIFI_BROWSER_NOTE } from "../../protocol/websocket";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { Field } from "../common/Field";
import { session, useSession } from "../session";
import { readStored, WIFI_KEY, writeStored } from "../storage";

/** Chromium browsers have `navigator.userAgentData`; Firefox and Safari, which are expected to refuse the connection, do not. */
export const WIFI_SUPPORTED = (): boolean => "userAgentData" in navigator;

/** The address of a board on the network and the button that connects to it, with what the browsers do about it. */
export function WifiConnectForm({ onDone }: { onDone?: () => void }) {
  const { state, via } = useSession();
  // The address of the last connection, or the one the last USB connection read from the board.
  const [address, setAddress] = useState(() => readStored(WIFI_KEY) ?? "");
  const connecting = state === "connecting";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void session.connectWifi(address).finally(onDone);
      }}
    >
      {!WIFI_SUPPORTED() && (
        <Alert variant="info">
          <AlertDescription className="text-foreground" data-testid="wifi-browser-note">
            {WIFI_BROWSER_NOTE}
          </AlertDescription>
        </Alert>
      )}
      <Field
        label="Board address"
        hint="The board's name (pixelart-XXXX.local) or its IP address, as the WiFi card shows them over USB. The first time, Chrome asks to allow access to devices on the local network."
      >
        {(control) => (
          <Input
            {...control}
            value={address}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            placeholder="pixelart-XXXX.local"
            className="font-mono"
            onChange={(e) => {
              setAddress(e.target.value);
              writeStored(WIFI_KEY, e.target.value);
            }}
          />
        )}
      </Field>
      <div>
        <Button
          type="submit"
          variant="outline"
          disabled={connecting || address.trim() === ""}
          loading={connecting && via === "wifi"}
        >
          Connect over WiFi
        </Button>
      </div>
    </form>
  );
}
