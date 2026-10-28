// SPDX-License-Identifier: GPL-3.0-or-later

import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { KINDS } from "../fileLists";
import { session, useSession } from "../session";
import {
  BoardError,
  DEFAULT_SETTINGS,
  deleteAll,
  listFiles,
  supportsPlayFile,
  supportsSchedules,
  type BoardClient,
} from "../../protocol";
import { Button } from "../components/button";
import { Checkbox } from "../components/checkbox";
import { Label } from "../components/label";
import { toast } from "../components/toast";
import { ReasonTooltip } from "../components/tooltip";
import { downloadHeld, useHeldId } from "../editor/holding";
import { toShownError, type ShownError } from "../errors";
import { withUploadLock } from "../upload";
import { ConfirmDialog } from "./ConfirmDialog";
import { CodeChip, ErrorAlert, ShownErrorAlert } from "./ErrorAlert";
import { FirmwareLink } from "./BlockedNote";
import { plural } from "../format";

interface Counts {
  animations: number;
  playlists: number;
  /** 0 on a board that knows no schedules. */
  schedules: number;
  /** 0 on a board that knows no play file. */
  play: number;
  /** The IDs of the stored animations, to tell whether the editor's only copy is among them. */
  animationIds: string[];
}

type Notice =
  | { type: "old" }
  | { type: "old-reset"; settingsOnly: boolean }
  | { type: "storage"; message: string; resetSettings: boolean }
  | { type: "error"; error: ShownError };

/** What a reset of the settings does, in words: every setting, the WiFi network and the token. */
export const RESET_TEXT = `Every setting goes back to its default (brightness ${DEFAULT_SETTINGS.brightness}, active playlist ${DEFAULT_SETTINGS.playlist}, updates, transmit power, network login and the rest), the WiFi network is forgotten and a new token is made.`;

/** The same, in the past tense, for the message that follows the reset. */
const RESET_DONE = "Every setting is back to its default, the WiFi network is forgotten and a new token is made.";

/**
 * The "Also reset the settings" box. Over WiFi it is off, with a tooltip that says why: the box and its label are
 * wrapped so the tooltip works on a disabled control.
 */
export function ResetBox({
  id,
  checked,
  overWifi,
  onChange,
  labelClassName = "text-foreground",
}: {
  id: string;
  checked: boolean;
  overWifi: boolean;
  onChange: (checked: boolean) => void;
  labelClassName?: string;
}) {
  const box = (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={overWifi}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id} className={`leading-normal ${labelClassName}`}>
        Also reset the settings
      </Label>
    </div>
  );
  return overWifi ? (
    <ReasonTooltip reason={RESET_NEEDS_USB} testId="reset-needs-usb" className="w-fit">
      {box}
    </ReasonTooltip>
  ) : (
    box
  );
}

/** Why the reset box is off over WiFi: the reset forgets the WiFi network and makes a new token. */
export const RESET_NEEDS_USB = "Resetting the settings needs a USB connection.";

/** Every text that depends on whether the settings are reset too, in one place. */
const WORDING = {
  keep: {
    what: "This cannot be undone. The firmware and the settings stay.",
    confirm: "",
    progress: "Deleting every animation, playlist and schedule",
    done: (removed: string) => (removed ? `Deleted ${removed}` : "The board had no files to delete"),
    doneDetail: undefined,
    again: "",
  },
  reset: {
    what: `This cannot be undone. The firmware stays. ${RESET_TEXT}`,
    confirm: " and reset the settings",
    progress: "Deleting every animation, playlist and schedule and resetting the settings",
    done: (removed: string) => (removed ? `Deleted ${removed} and reset the settings` : "Reset the settings"),
    doneDetail: RESET_DONE,
    again: " and resets the settings",
  },
} as const;

const wording = (reset: boolean) => WORDING[reset ? "reset" : "keep"];

/** "30 animations and 1 playlist", "30 animations, 1 playlist and 1 play file", with the kinds that have none left out. */
function describe(animations: number, playlists: number, schedules = 0, play = 0): string {
  const parts = [
    animations > 0 && plural(animations, "animation"),
    playlists > 0 && plural(playlists, "playlist"),
    schedules > 0 && plural(schedules, "schedule"),
    play > 0 && plural(play, "play file"),
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

interface StartOptions {
  resetSettings?: boolean;
}

interface Options {
  client: BoardClient | null;
  /** The board's files changed: read them again. */
  onDone: () => void;
  /** Set where the view itself is the Firmware view, so the old-firmware message does not send the user to it. */
  onFirmwareView?: boolean;
}

/**
 * Delete everything with the protocol's `delete_all`: one dialog naming what will go (the same in the Board and the
 * Firmware view), the upload lock held while it runs, and the answers a board can give: done, a firmware that does
 * not know the command, or a storage error that running it again can finish.
 */
export function useDeleteEverything({ client, onDone, onFirmwareView = false }: Options): {
  /** Opens the dialog; `resetSettings` checks its "Also reset the settings" box (the Reset card's own checkbox). */
  start: (options?: StartOptions) => void;
  /** True while the files are counted. */
  checking: boolean;
  /** Render once, in the view. */
  dialogs: ReactNode;
  /** The answer that needs the user's attention, or nothing. */
  notice: ReactNode;
} {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [checking, setChecking] = useState(false);
  const [resetSettings, setResetSettings] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const held = useHeldId();
  // The reset forgets the WiFi network and makes a new token, which the board allows over USB only.
  const overWifi = useSession().via === "wifi";

  async function run(reset: boolean): Promise<void> {
    if (!client) return;
    setCounts(null);
    setNotice(null);
    try {
      const removed = await withUploadLock(
        {
          label: wording(reset).progress,
          done: 0,
          total: 0,
          indeterminate: true,
          cancellable: false,
        },
        () => deleteAll(client, { resetSettings: reset }),
      );
      const text = wording(reset);
      toast({
        title: text.done(describe(removed.animations, removed.playlists, removed.schedules ?? 0, removed.play ?? 0)),
        description: text.doneDetail,
      });
    } catch (error) {
      if (error instanceof BoardError && error.code === "unknown_command") setNotice({ type: "old" });
      // A firmware that knows delete_all but not its `settings` field refuses the request and removes nothing.
      else if (reset && error instanceof BoardError && error.code === "bad_request")
        setNotice({ type: "old-reset", settingsOnly: total === 0 });
      else if (error instanceof BoardError && error.code === "storage_error")
        setNotice({ type: "storage", message: error.message, resetSettings: reset });
      else setNotice({ type: "error", error: toShownError("Delete everything", error) });
    }
    // Files may be gone even after a failure: the lists are read again either way.
    void session.refreshFiles(KINDS);
    onDone();
  }

  async function start({ resetSettings: presetReset = false }: StartOptions): Promise<void> {
    if (!client || checking) return;
    setNotice(null);
    setChecking(true);
    try {
      const animations = await listFiles(client, "animation");
      const playlists = await listFiles(client, "playlist");
      // A firmware older than schedules answers invalid_kind: it stores none.
      const schedules = supportsSchedules(client.info) ? await listFiles(client, "schedule") : [];
      const play = supportsPlayFile(client.info) ? await listFiles(client, "play") : [];
      const empty = animations.length + playlists.length + schedules.length + play.length === 0;
      // With nothing to delete, only a settings reset is left to confirm.
      if (empty && (!presetReset || overWifi)) {
        toast({
          title: "The board has no animations, playlists or schedules",
          description: onFirmwareView
            ? "Check Also reset the settings to put the settings back to their defaults."
            : undefined,
          tone: "info",
        });
        return;
      }
      setResetSettings(presetReset && !overWifi);
      setCounts({
        animations: animations.length,
        playlists: playlists.length,
        schedules: schedules.length,
        play: play.length,
        animationIds: animations.map((e) => e.id),
      });
    } catch (error) {
      setNotice({ type: "error", error: toShownError("Reading the board", error) });
    } finally {
      setChecking(false);
    }
  }

  const total = counts ? counts.animations + counts.playlists + counts.schedules + counts.play : 0;
  const holdsOnlyCopy = counts !== null && held !== null && counts.animationIds.includes(held);

  // A board without files reaches the dialog only to reset its settings: the dialog then asks for that alone.
  const settingsOnly = counts !== null && total === 0;
  let dialogs: ReactNode = null;
  if (settingsOnly) {
    dialogs = (
      <ConfirmDialog
        title="Reset the settings of this board?"
        confirmLabel="Reset the settings"
        destructive
        onCancel={() => setCounts(null)}
        onConfirm={() => void run(true)}
      >
        <p data-testid="delete-all-what">The board has no animations, playlists or schedules. {RESET_TEXT}</p>
      </ConfirmDialog>
    );
  } else if (counts) {
    dialogs = (
      <ConfirmDialog
        title={`Delete all ${describe(counts.animations, counts.playlists, counts.schedules, counts.play)} from this board?`}
        confirmLabel={`Delete ${plural(total, "file")}${wording(resetSettings).confirm}`}
        destructive
        onCancel={() => setCounts(null)}
        onConfirm={() => void run(resetSettings)}
        extraAction={
          holdsOnlyCopy && (
            <Button variant="outline" onClick={() => downloadHeld()}>
              Download YAML first
            </Button>
          )
        }
      >
        <p data-testid="delete-all-what">{wording(resetSettings).what}</p>
        <ResetBox
          id="delete-all-reset-settings"
          checked={resetSettings}
          overWifi={overWifi}
          onChange={setResetSettings}
        />
        {holdsOnlyCopy && (
          <p data-testid="only-copy">The editor holds this animation and it has no other saved copy.</p>
        )}
      </ConfirmDialog>
    );
  }

  let shown: ReactNode = null;
  if (notice?.type === "old" || notice?.type === "old-reset") {
    const old =
      notice.type === "old"
        ? {
            title: "The firmware of this board cannot delete everything",
            testId: "delete-all-old",
            text: "This firmware does not know the command. Update the firmware, then try again.",
          }
        : {
            title: "The firmware of this board cannot reset the settings",
            testId: "delete-all-old-reset",
            text: notice.settingsOnly
              ? "Nothing was changed. This firmware cannot reset the settings: update the firmware."
              : "Nothing was deleted. This firmware can delete everything but cannot reset the settings at the same time. Update the firmware, or delete everything without resetting the settings.",
          };
    shown = (
      <ErrorAlert title={old.title} variant="warning" onDismiss={() => setNotice(null)} testId={old.testId}>
        <p>
          {old.text}
          {!onFirmwareView && <FirmwareLink />}
        </p>
      </ErrorAlert>
    );
  } else if (notice?.type === "storage")
    shown = (
      <ErrorAlert
        title="Delete everything stopped"
        onDismiss={() => setNotice(null)}
        testId="delete-all-storage"
        actions={
          <Button variant="outline" size="sm" onClick={() => void run(notice.resetSettings)}>
            <Trash2 aria-hidden="true" />
            Run it again
          </Button>
        }
      >
        <p>
          <CodeChip>storage_error</CodeChip> {notice.message} Files removed before the failure stay removed. Running it
          again removes the rest
          {wording(notice.resetSettings).again}.
        </p>
      </ErrorAlert>
    );
  else if (notice?.type === "error") shown = <ShownErrorAlert error={notice.error} onDismiss={() => setNotice(null)} />;

  return { start: (options = {}) => void start(options), checking, dialogs, notice: shown };
}
