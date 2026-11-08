// SPDX-License-Identifier: GPL-3.0-or-later

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { powerReset, type BoardClient, type PowerStatus } from "../../protocol";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { toast } from "../components/toast";
import { ReasonTooltip } from "../components/tooltip";
import { toShownError, type ShownError } from "../errors";
import { readmeSection } from "../privacy";
import {
  POWER_ADVICE_ANCHOR,
  POWER_DIMMING_TEXT,
  POWER_FLOOR_TEXT,
  POWER_ON_TITLE,
  POWER_RESET_CONFIRM,
  POWER_RESET_EXPLANATION,
  POWER_RESET_TITLE,
  restartSentence,
  scaleSentence,
} from "./power";
import type { BoardStatusPoll } from "./useBoardStatus";

interface Props {
  client: BoardClient;
  /** The power object of the status, with the limit on: the card is rendered only while there is one. */
  power: PowerStatus;
  /** The shared status, read again after a reset. */
  poll: BoardStatusPoll;
  /** The connection is lost, or an upload runs: nothing is changed meanwhile. */
  disabled: boolean;
  onError: (error: ShownError) => void;
}

/** The Power card of the Board view: shown only while the board's power protection limits its animations. */
export function PowerCard({ client, power, poll, disabled, onError }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function reset(): Promise<void> {
    setConfirming(false);
    setResetting(true);
    try {
      await powerReset(client);
      toast({ title: "Power protection is off" });
    } catch (error) {
      onError(toShownError("Turning power protection off", error));
    }
    // Busy until the status is read again; a status without the limit unmounts the card.
    await poll.refreshAndWait();
    // Intended: when the card has unmounted, this state update is ignored and harmless.
    setResetting(false);
  }

  return (
    <Card aria-labelledby="power-title">
      <CardHeader>
        <CardTitle id="power-title">Power</CardTitle>
      </CardHeader>
      <CardContent>
        <Alert variant="warning" data-testid="power-protection">
          <AlertDescription className="text-foreground">
            <strong>{POWER_ON_TITLE}</strong> {restartSentence(power.brownouts)} {POWER_DIMMING_TEXT}{" "}
            {scaleSentence(power.scale)}
            {power.atFloor && (
              <>
                {" "}
                {POWER_FLOOR_TEXT} See the{" "}
                <a
                  className="underline underline-offset-2"
                  href={readmeSection(POWER_ADVICE_ANCHOR)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  power supply advice
                </a>
                .
              </>
            )}
          </AlertDescription>
        </Alert>
        <p className="text-xs text-muted-foreground">{POWER_RESET_EXPLANATION}</p>
        <div className="flex flex-wrap gap-2">
          <ReasonTooltip reason={disabled ? "The connection is lost, or an upload runs." : ""} focusable={disabled}>
            <Button variant="outline" disabled={disabled || resetting} onClick={() => setConfirming(true)}>
              {resetting && <Loader2 className="animate-spin-slow" aria-hidden="true" />}I changed the power hardware
            </Button>
          </ReasonTooltip>
        </div>
      </CardContent>
      {confirming && (
        <ConfirmDialog
          title={POWER_RESET_TITLE}
          confirmLabel="Turn off"
          confirmDisabled={disabled}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void reset()}
        >
          <p>{POWER_RESET_CONFIRM}</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
