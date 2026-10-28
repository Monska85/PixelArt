// SPDX-License-Identifier: GPL-3.0-or-later

import { Suspense, lazy, useRef, useState, type ReactNode } from "react";
import {
  setSettings,
  type BoardClient,
  type Entry,
  type PlayStatus,
  type Settings,
  type SettingsChanges,
} from "../../protocol";
import { Alert, AlertDescription } from "../components/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Select } from "../components/select";
import { Slider } from "../components/slider";
import { Field } from "../common/Field";
import { ListUnreadable } from "../common/ListUnreadable";
import { LoadingNote } from "../common/LoadingNote";
import { toShownError, type ShownError } from "../errors";
import { ActiveMissingNote, type MissingContext } from "./MissingAnimations";

// What to play and the time settings of a firmware that knows schedules, loaded when such a board connects.
const PlaySettings = lazy(() => import("./PlaySettings").then((m) => ({ default: m.PlaySettings })));

/**
 * The settings whose change makes the board choose what to play again, as docs/protocol/protocol-v1.md says in
 * "Playback while commands run" (What the board plays): keep the two in step. `playlist` changes it too, but the app
 * sends it only to a firmware without What to play, which reports no `status.play`.
 */
const CHOICE_SETTINGS = ["play", "playlists", "timezone"] as const satisfies ReadonlyArray<keyof SettingsChanges>;

interface Props {
  client: BoardClient;
  settings: Settings;
  /** The stored playlists by ID with their names, or null while they are not known: the active one is then not called missing. */
  playlists: ReadonlyMap<string, string | null> | null;
  /** The stored schedules, or null while they are not known. */
  schedules: Entry[] | null;
  /** `status.play`, or null while it is not known or on a firmware without it. */
  play: PlayStatus | null;
  /**
   * The board has What to play (a firmware that knows schedules and reports `play`), in place of the Active playlist
   * menu: `active` is then `status.play.playing`.
   */
  whatToPlay: boolean;
  /** The playlist the board plays: `playlist` without What to play, else `status.play.playing`. */
  active: string | null;
  /** The animations the active playlist names that the board lacks; empty when none or not known. */
  missing: string[];
  missingContext: MissingContext;
  disabled: boolean;
  onSettings: (settings: Settings) => void;
  /** A change of what to play or of the time zone: the board chooses again, and the status says what. */
  onPlayChanged: () => void;
  onError: (error: ShownError) => void;
}

export function SettingsPanel({
  client,
  settings,
  playlists,
  schedules,
  play,
  whatToPlay,
  active,
  missing,
  missingContext,
  disabled,
  onSettings,
  onPlayChanged,
  onError,
}: Props) {
  // The slider shows what the user is dragging; the view shows what the board answered.
  const [dragging, setDragging] = useState<number | null>(null);
  const sending = useRef(false);
  // True from the first change of the slider until its release, so a reply cannot move it under the user's hand.
  // Only a pointer holds the slider: a key press changes and commits at once, and Radix reports the commit first.
  const holding = useRef(false);
  const pointerDown = useRef(false);
  // A brightness released while a request is in flight: only the latest one is sent, after it.
  const queued = useRef<number | null>(null);
  const value = dragging ?? settings.brightness;
  const stored = playlists === null || playlists.has(settings.playlist);

  async function change(changes: SettingsChanges, context: string): Promise<void> {
    sending.current = true;
    try {
      onSettings(await setSettings(client, changes));
      if (CHOICE_SETTINGS.some((key) => key in changes)) onPlayChanged();
    } catch (error) {
      onError(toShownError(context, error));
    }
    sending.current = false;
    const next = queued.current;
    queued.current = null;
    if (next !== null) await change({ brightness: next }, "Changing the brightness");
    else if (!holding.current) setDragging(null);
  }

  const commit = (brightness: number): void => {
    holding.current = false;
    if (sending.current) {
      queued.current = brightness;
      return;
    }
    if (brightness !== settings.brightness) void change({ brightness }, "Changing the brightness");
    else setDragging(null);
  };

  return (
    <SettingsCard>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium leading-none">Brightness</span>
          <output htmlFor="brightness" data-testid="brightness-value" className="text-sm tabular-nums">
            {value}
          </output>
        </div>
        <Slider
          id="brightness"
          aria-label="Brightness"
          aria-describedby="brightness-hint"
          min={0}
          max={255}
          step={1}
          value={[value]}
          disabled={disabled}
          onPointerDown={() => {
            pointerDown.current = true;
          }}
          onPointerUp={() => {
            pointerDown.current = false;
          }}
          onPointerCancel={() => {
            pointerDown.current = false;
          }}
          onValueChange={([next]) => {
            holding.current = pointerDown.current;
            setDragging(next ?? 0);
          }}
          onValueCommit={([next]) => commit(next ?? 0)}
        />
        <p id="brightness-hint" className="text-xs text-muted-foreground">
          From 0 to 255. An animation can lower this with its own brightness, never raise it.
        </p>
      </div>
      {whatToPlay ? (
        <Suspense fallback={<LoadingNote>Reading what the board plays...</LoadingNote>}>
          <PlaySettings
            client={client}
            settings={settings}
            playlists={playlists}
            schedules={schedules}
            play={play}
            disabled={disabled}
            change={change}
          />
        </Suspense>
      ) : (
        <ActivePlaylist
          settings={settings}
          playlists={playlists}
          stored={stored}
          disabled={disabled}
          onChange={(playlist) => void change({ playlist }, "Changing the active playlist")}
        />
      )}
      {!whatToPlay && !stored && (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            The playlist <code>{settings.playlist}</code> is not stored, so the board plays every animation.
          </AlertDescription>
        </Alert>
      )}
      {active !== null && (whatToPlay || stored) && missing.length > 0 && (
        <ActiveMissingNote playlist={active} missing={missing} context={missingContext} />
      )}
    </SettingsCard>
  );
}

/** The menu of a firmware older than schedules: the one playlist the board plays. */
function ActivePlaylist({
  settings,
  playlists,
  stored,
  disabled,
  onChange,
}: {
  settings: Settings;
  playlists: ReadonlyMap<string, string | null> | null;
  stored: boolean;
  disabled: boolean;
  onChange: (playlist: string) => void;
}) {
  return (
    <Field label="Active playlist">
      {(control) => (
        <Select {...control} value={settings.playlist} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {playlists === null && <option value={settings.playlist}>{settings.playlist}</option>}
          {!stored && <option value={settings.playlist}>{settings.playlist} (missing)</option>}
          {[...(playlists ?? [])].map(([id, name]) => (
            <option key={id} value={id}>
              {id}
              {name ? `: ${name}` : ""}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <Card aria-labelledby="settings-title">
      <CardHeader>
        <CardTitle id="settings-title">Settings</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The Settings card when the read failed: Retry reads the settings only. */
export function SettingsUnreadable({ disabled, onRetry }: { disabled: boolean; onRetry: () => void }) {
  return (
    <SettingsCard>
      <ListUnreadable disabled={disabled} message="Could not read the board's settings." onRetry={onRetry} />
    </SettingsCard>
  );
}
