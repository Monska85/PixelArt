// SPDX-License-Identifier: GPL-3.0-or-later

import type { BoardClient, Settings } from "../../protocol";
import type { ShownError } from "../errors";
import { session } from "../session";
import type { BoardStatusPoll } from "./useBoardStatus";
import { NetworkAccessCard } from "./NetworkAccessCard";
import { PowerCard } from "./PowerCard";
import { shownPower } from "./power";
import { UpdatesCard } from "./UpdatesCard";
import { WifiCard } from "./WifiCard";

interface Props {
  client: BoardClient;
  poll: BoardStatusPoll;
  settings: Settings | null;
  overWifi: boolean;
  /** The connection is lost: nothing is read or changed meanwhile. */
  lost: boolean;
  uploadRunning: boolean;
  onSetupChange: (open: boolean) => void;
  onSettings: (settings: Settings) => void;
  onError: (error: ShownError) => void;
}

/**
 * The cards of the power protection, the WiFi, the updates and the network access, which show only once a board is
 * connected. The Board view loads this module then, so the first load of the app does not carry them.
 */
export function NetworkCards({
  client,
  poll,
  settings,
  overWifi,
  lost,
  uploadRunning,
  onSetupChange,
  onSettings,
  onError,
}: Props) {
  const disabled = lost || uploadRunning;
  const power = shownPower(poll.status?.power ?? null);
  return (
    <>
      {power && <PowerCard client={client} power={power} poll={poll} disabled={disabled} onError={onError} />}
      <WifiCard
        client={client}
        poll={poll}
        settings={settings}
        improv={session.improv()}
        overWifi={overWifi}
        disabled={disabled}
        onSetupChange={onSetupChange}
        onSettings={onSettings}
        onError={onError}
      />
      <UpdatesCard
        client={client}
        poll={poll}
        settings={settings}
        disabled={disabled}
        onSettings={onSettings}
        onError={onError}
      />
      <NetworkAccessCard
        client={client}
        settings={settings}
        disabled={disabled}
        onSettings={onSettings}
        onError={onError}
      />
    </>
  );
}
