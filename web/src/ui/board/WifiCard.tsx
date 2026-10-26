// SPDX-License-Identifier: GPL-3.0-or-later

import { Wifi, WifiOff } from "lucide-react";
import { useState } from "react";
import { forgetWifi, setSettings, type BoardClient, type ImprovLink, type Settings } from "../../protocol";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Field } from "../common/Field";
import { Alert, AlertDescription } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Select } from "../components/select";
import { toast } from "../components/toast";
import { ReasonTooltip } from "../components/tooltip";
import { toShownError, type ShownError } from "../errors";
import { WifiSetupDialog } from "./WifiSetupDialog";
import { LOWEST_POWER, POWER_AUTO, POWER_LEGEND, POWER_OPTIONS, WIFI_STATE_TEXT, describeSignal } from "./wifi";
import type { BoardStatusPoll } from "./useBoardStatus";

interface Props {
  client: BoardClient;
  /** The board's status, read once for the view. */
  poll: BoardStatusPoll;
  /** The settings, or null while they are not known: the transmit power menu waits for them. */
  settings: Settings | null;
  /** Improv, on a USB connection. Without it, Set up WiFi and Forget network are disabled. */
  improv: ImprovLink | null;
  /** The app is connected over WiFi: Set up WiFi and Forget network need USB and are not shown. */
  overWifi: boolean;
  /** The connection is lost, or an upload runs: nothing is read or changed meanwhile. */
  disabled: boolean;
  /** The setup dialog opens or closes: the status is not read while it owns the serial port. */
  onSetupChange: (open: boolean) => void;
  onSettings: (settings: Settings) => void;
  onError: (error: ShownError) => void;
}

const USB_ONLY = "Setting up WiFi needs a USB connection.";

/** The WiFi card of the Board view: state, address and signal, Set up WiFi, Forget network and the transmit power. */
export function WifiCard({
  client,
  poll,
  settings,
  improv,
  overWifi,
  disabled,
  onSetupChange,
  onSettings,
  onError,
}: Props) {
  const [setup, setSetupState] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [changingPower, setChangingPower] = useState(false);
  const { status, unsupported, failed, refresh } = poll;
  const setSetup = (open: boolean): void => {
    setSetupState(open);
    onSetupChange(open);
  };
  if (unsupported) return null;

  const wifi = status?.wifi ?? null;
  const configured = wifi !== null && wifi.state !== "not_configured";
  const usbReason = improv ? null : USB_ONLY;

  async function forget(): Promise<void> {
    setForgetting(false);
    try {
      await forgetWifi(client);
      toast({ title: "The WiFi network is forgotten" });
    } catch (error) {
      onError(toShownError("Forgetting the WiFi network", error));
    }
    refresh();
  }

  async function changePower(power: string): Promise<void> {
    setChangingPower(true);
    try {
      onSettings(await setSettings(client, { wifi_power: power }));
    } catch (error) {
      onError(toShownError("Changing the transmit power", error));
    }
    setChangingPower(false);
    refresh();
  }

  return (
    <Card aria-labelledby="wifi-title">
      <CardHeader>
        <CardTitle id="wifi-title">WiFi</CardTitle>
      </CardHeader>
      <CardContent>
        {failed && (
          <Alert variant="warning">
            <AlertDescription className="text-foreground">Could not read the WiFi state.</AlertDescription>
            <Button variant="outline" size="sm" className="self-start" disabled={disabled} onClick={refresh}>
              Retry
            </Button>
          </Alert>
        )}
        {wifi && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="wifi-state">
            <dt className="text-muted-foreground">State</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge
                className="min-w-0 items-start whitespace-normal rounded-xl"
                variant={
                  wifi.state === "connected" ? "success" : wifi.state === "not_configured" ? "default" : "warning"
                }
              >
                {wifi.state === "connected" ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
                {WIFI_STATE_TEXT[wifi.state]}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">Network</dt>
            <dd className="min-w-0 break-all [unicode-bidi:isolate]" data-testid="wifi-network">
              {wifi.ssid ?? "none"}
            </dd>
            <dt className="text-muted-foreground">Address</dt>
            <dd className="font-mono">{wifi.ip ?? "none"}</dd>
            <dt className="text-muted-foreground">Hostname</dt>
            <dd className="min-w-0 break-all font-mono">{wifi.hostname ? `${wifi.hostname}.local` : "unknown"}</dd>
            <dt className="text-muted-foreground">Signal</dt>
            <dd>{wifi.rssi === null ? "none" : describeSignal(wifi.rssi)}</dd>
          </dl>
        )}
        {overWifi ? (
          <p className="text-xs text-muted-foreground" data-testid="wifi-usb-note">
            Set up WiFi and Forget network need a USB connection.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <ReasonTooltip reason={usbReason ?? ""} focusable={usbReason !== null}>
              <Button disabled={disabled || !improv} onClick={() => setSetup(true)}>
                <Wifi aria-hidden="true" />
                Set up WiFi
              </Button>
            </ReasonTooltip>
            <ReasonTooltip reason={usbReason ?? "No network is set up."} focusable={usbReason !== null || !configured}>
              <Button
                variant="outline"
                disabled={disabled || !improv || !configured}
                onClick={() => setForgetting(true)}
              >
                Forget network
              </Button>
            </ReasonTooltip>
          </div>
        )}
        {settings && (
          <>
            <Field label="Transmit power">
              {(control) => (
                <Select
                  {...control}
                  value={settings.wifi_power ?? POWER_AUTO}
                  disabled={disabled || changingPower}
                  onChange={(e) => void changePower(e.target.value)}
                >
                  {POWER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {wifi?.powerReduced && (
              <Alert variant="warning" data-testid="power-reduced">
                <AlertDescription className="text-foreground">
                  The board could not connect at this power, so it lowered the power to {LOWEST_POWER} dBm by itself
                  until it restarts.
                </AlertDescription>
              </Alert>
            )}
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground" data-testid="power-legend">
              {POWER_LEGEND.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
      {setup && improv && (
        <WifiSetupDialog
          link={improv}
          onClose={() => setSetup(false)}
          onConnected={() => {
            setSetup(false);
            toast({ title: "The board joined the WiFi network" });
            refresh();
          }}
        />
      )}
      {forgetting && (
        <ConfirmDialog
          title="Forget the WiFi network?"
          confirmLabel="Forget"
          destructive
          onCancel={() => setForgetting(false)}
          onConfirm={() => void forget()}
        >
          <p>
            The board disconnects and erases the network name and password it stored. It plays its animations as before
            and can be set up again over USB.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
