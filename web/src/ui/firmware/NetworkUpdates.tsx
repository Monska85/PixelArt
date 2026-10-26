// SPDX-License-Identifier: GPL-3.0-or-later

import type { BoardClient } from "../../protocol";
import { Progress } from "../components/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card";
import { describeFirmware, describeInstall, describeState, lastCheckText } from "../board/updates";
import { useBoardStatus } from "../board/useBoardStatus";
import { isUpdateRunning } from "../../protocol";

interface Props {
  client: BoardClient;
  restarts: number;
  // An upload, a queue or Delete everything runs: the status is not read while it shares the link.
  paused: boolean;
}

/**
 * The board's own update state next to the USB install: what it found, what it is doing, and how its last installation
 * ended. The installation over WiFi is started from the Updates card of the Board view. Nothing is shown for a firmware
 * that has no updates.
 */
export function NetworkUpdates({ client, restarts, paused }: Props) {
  const { status, unsupported, failed } = useBoardStatus(client, restarts, paused);
  if (unsupported) return null;
  const update = status?.update ?? null;
  return (
    <Card aria-labelledby="firmware-network">
      <CardHeader>
        <CardTitle id="firmware-network">Updates over WiFi</CardTitle>
        <CardDescription>
          A board on WiFi can install a new firmware by itself, and goes back to the previous one if the new one does
          not start. This is its own state; the buttons above install over USB. Install over WiFi from the{" "}
          <a href="#board" className="font-medium text-primary underline underline-offset-4">
            Updates card
          </a>{" "}
          of the Board view.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {update === null ? (
          <p className="text-sm text-muted-foreground" data-testid="network-update-state">
            {failed ? "Could not read the update state of the board." : "Reading the update state of the board."}
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="network-updates">
            <dt className="text-muted-foreground">WiFi</dt>
            <dd data-testid="network-update-wifi">
              {status?.wifi.state === "connected" ? "Connected" : "Not connected: the board cannot update itself"}
            </dd>
            <dt className="text-muted-foreground">Now</dt>
            <dd data-testid="network-update-state">{describeState(update)}</dd>
            <dt className="text-muted-foreground">Last check</dt>
            <dd>{lastCheckText(update)}</dd>
            <dt className="text-muted-foreground">Firmware found</dt>
            <dd data-testid="network-update-firmware">{describeFirmware(update)}</dd>
            {update.lastInstall && (
              <>
                <dt className="text-muted-foreground">Last install</dt>
                <dd data-testid="network-update-install">{describeInstall(update.lastInstall)}</dd>
              </>
            )}
          </dl>
        )}
        {update !== null && isUpdateRunning(update) && update.state === "installing" && (
          <Progress aria-label="Firmware installation progress" value={update.progress} className="max-w-sm" />
        )}
      </CardContent>
    </Card>
  );
}
