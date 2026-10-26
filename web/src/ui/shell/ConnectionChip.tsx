// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { BoardInfo } from "../../protocol";
import { Button } from "../components/button";
import { cn } from "../components/cn";
import { Popover, PopoverContent, PopoverTrigger } from "../components/popover";
import { TruncatedText } from "../common/TruncatedText";
import { formatSize } from "../format";
import { session, useSession, type ConnectionState } from "../session";
import { ConnectBoardButton } from "./ConnectBoardButton";
import { SimulatorForm } from "./SimulatorForm";
import { WifiConnectForm } from "./WifiConnectForm";

const LABELS: Record<ConnectionState, string> = {
  disconnected: "Not connected",
  connecting: "Connecting",
  connected: "Connected",
  lost: "Lost",
};

const DOT: Record<ConnectionState, string> = {
  disconnected: "bg-muted-foreground",
  connecting: "bg-warning animate-pulse",
  connected: "bg-success",
  lost: "bg-destructive",
};

const boardName = (info: BoardInfo): string => info.board || "unknown board";

/** The state of the connection as a dot and a word (never color alone), and when connected the board and its firmware. */
export function ConnectionChip() {
  const { state, info } = useSession();
  const [open, setOpen] = useState(false);
  const close = (): void => setOpen(false);
  const known = state === "connected" || state === "lost" ? info : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 max-sm:flex-1 max-sm:justify-start">
          <span className={cn("size-2.5 shrink-0 rounded-full", DOT[state])} aria-hidden="true" />
          <span data-testid="connection-state">{LABELS[state]}</span>
          {known && (
            <span className="min-w-0 truncate font-normal text-muted-foreground max-sm:hidden">
              {boardName(known)} {known.firmware}
            </span>
          )}
          <ChevronDown className="ml-auto" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-4">
        <p className="sr-only" role="status">
          Connection: {LABELS[state]}
        </p>
        {known ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Board</dt>
            <dd className="min-w-0" data-testid="info-board">
              <TruncatedText>{boardName(known)}</TruncatedText>
            </dd>
            <dt className="text-muted-foreground">Firmware</dt>
            <dd className="min-w-0" data-testid="info-firmware">
              <TruncatedText>{known.firmware || "unknown"}</TruncatedText>
            </dd>
            {known.storage && (
              <>
                <dt className="text-muted-foreground">Storage</dt>
                <dd data-testid="info-storage">
                  {formatSize(known.storage.used)} of {formatSize(known.storage.total)}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">No board is connected.</p>
        )}
        {state === "lost" && <Button onClick={() => void session.reconnect().finally(close)}>Reconnect</Button>}
        {(state === "connected" || state === "lost") && (
          <Button
            variant="outline"
            onClick={() => {
              void session.disconnect();
              close();
            }}
          >
            Disconnect
          </Button>
        )}
        {(state === "disconnected" || state === "connecting") && (
          <>
            <ConnectBoardButton onDone={close}>Connect board</ConnectBoardButton>
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm font-medium">Connect over WiFi</p>
              <WifiConnectForm onDone={close} />
            </div>
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <p className="text-sm font-medium">Use the simulator</p>
              <SimulatorForm onDone={close} />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
