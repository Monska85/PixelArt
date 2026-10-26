// SPDX-License-Identifier: GPL-3.0-or-later

import { Copy, Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { getSettings, regenerateToken, setSettings, type BoardClient, type Settings } from "../../protocol";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Button } from "../components/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Label } from "../components/label";
import { Switch } from "../components/switch";
import { toast } from "../components/toast";
import { toShownError, type ShownError } from "../errors";
import { TOKEN_CARD_NOTE } from "../privacy";

interface Props {
  client: BoardClient;
  /** The settings, or null while they are not known. */
  settings: Settings | null;
  /** The connection is lost, or an upload runs: nothing is changed meanwhile. */
  disabled: boolean;
  onSettings: (settings: Settings) => void;
  onError: (error: ShownError) => void;
}

const OFF_WARNING = "When this is off, anyone on your network can change this board's animations and settings.";
const ON_NOTE =
  "WiFi clients log in with the token. The token never crosses the network, but the traffic is not encrypted: someone who can watch your network sees what you send.";
const HIDDEN = "•".repeat(16);

/**
 * The Network access card of the Board view: the network login switch, and the token, which only a USB connection
 * receives: the board leaves it out over WiFi.
 */
export function NetworkAccessCard({ client, settings, disabled, onSettings, onError }: Props) {
  const [changing, setChanging] = useState(false);
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // A firmware without the network login has nothing to show.
  if (!settings || settings.network_login === undefined) return null;

  const login = settings.network_login;
  const token = settings.token;

  async function change(on: boolean): Promise<void> {
    setChanging(true);
    try {
      onSettings(await setSettings(client, { network_login: on }));
      // Over WiFi the board now asks this connection to log in: the next request does it, now rather than later.
      if (on) await getSettings(client).catch(() => undefined);
    } catch (error) {
      onError(toShownError("Changing the network login", error));
    }
    setChanging(false);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(token ?? "");
      toast({ title: "The token is copied" });
    } catch {
      toast({ title: "The token could not be copied", description: "Show it and copy it by hand.", tone: "info" });
    }
  }

  async function regenerate(): Promise<void> {
    setConfirming(false);
    setRegenerating(true);
    try {
      const fresh = await regenerateToken(client);
      setShown(false);
      onSettings({ ...(settings as Settings), token: fresh });
      toast({ title: "A new token is made", description: "WiFi clients have to log in again." });
    } catch (error) {
      onError(toShownError("Making a new token", error));
    }
    setRegenerating(false);
  }

  return (
    <Card aria-labelledby="network-access-title">
      <CardHeader>
        <CardTitle id="network-access-title">Network access</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Switch
              id="network-login"
              aria-label="Network login"
              checked={login}
              disabled={disabled || changing}
              onCheckedChange={(on) => void change(on)}
            />
            <Label htmlFor="network-login" aria-hidden="true">
              Network login
            </Label>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="network-login-note">
            {login ? ON_NOTE : OFF_WARNING}
          </p>
        </div>
        {token === undefined ? (
          <p className="text-sm text-muted-foreground" data-testid="token-usb-only">
            The token is shown over a USB connection only. Connect the board with its cable to read it.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Token</p>
            <p className="text-xs text-muted-foreground" data-testid="token-privacy">
              {TOKEN_CARD_NOTE}
            </p>
            <p className="break-all font-mono text-sm" data-testid="token-value">
              {shown ? token : HIDDEN}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={disabled} onClick={() => setShown((value) => !value)}>
                {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                {shown ? "Hide" : "Show"}
              </Button>
              <Button variant="outline" size="sm" disabled={disabled} onClick={() => void copy()}>
                <Copy aria-hidden="true" />
                Copy
              </Button>
              <Button
                variant="destructive-outline"
                size="sm"
                disabled={disabled || regenerating}
                onClick={() => setConfirming(true)}
              >
                <KeyRound aria-hidden="true" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      {confirming && (
        <ConfirmDialog
          title="Make a new token?"
          confirmLabel="Make a new token"
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={() => void regenerate()}
        >
          <p>
            The old token stops working. WiFi clients have to log in again: the board closes the WiFi connection now,
            and every browser that remembers the old token has to be given the new one.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
