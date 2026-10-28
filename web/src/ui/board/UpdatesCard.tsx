// SPDX-License-Identifier: GPL-3.0-or-later

import { RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  checkForUpdates,
  installUpdate,
  isUpdateRunning,
  setSettings,
  supportsSchedules,
  type BoardClient,
  type Settings,
  type SettingsChanges,
} from "../../protocol";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Field } from "../common/Field";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Input } from "../components/input";
import { Label } from "../components/label";
import { Progress } from "../components/progress";
import { Select } from "../components/select";
import { Switch } from "../components/switch";
import { ReasonTooltip } from "../components/tooltip";
import { toShownError, type ShownError } from "../errors";
import { browserTimeZone, posixTimeZone, zoneOfSetting } from "./timezones";
import {
  ANIMATION_NOTE,
  DEFAULT_ANIMATION_SOURCE,
  MAX_CHECK_HOURS,
  MIN_CHECK_HOURS,
  UPDATE_MODES,
  animationSourceProblem,
  describeFirmware,
  describeInstall,
  describeResult,
  describeState,
  describeWindow,
  disabledReason,
  firmwareConfirmation,
  firmwareSkipped,
  lastCheckText,
  minutesToTime,
  parseCheckHours,
  timeToMinutes,
  type UpdateAction,
} from "./updates";
import type { BoardStatusPoll } from "./useBoardStatus";

interface Props {
  client: BoardClient;
  /** The board's status, read once for the view. */
  poll: BoardStatusPoll;
  /** The settings, or null while they are not known. The card needs the ones of a firmware with updates. */
  settings: Settings | null;
  /** The connection is lost, or an upload runs: nothing is read or changed meanwhile. */
  disabled: boolean;
  onSettings: (settings: Settings) => void;
  onError: (error: ShownError) => void;
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words" data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

function SwitchRow({
  id,
  label,
  checked,
  disabled,
  onChange,
  note,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Switch id={id} aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
        <Label htmlFor={id} aria-hidden="true">
          {label}
        </Label>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** The Updates card of the Board view: the update settings, what the board found, and Check now and Install. */
export function UpdatesCard({ client, poll, settings, disabled, onSettings, onError }: Props) {
  const [changing, setChanging] = useState(false);
  const [acting, setActing] = useState(false);
  const [hoursDraft, setHoursDraft] = useState<string | null>(null);
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);
  const [confirmFirmware, setConfirmFirmware] = useState(false);
  const { status, unsupported, failed, refresh } = poll;
  // A firmware without the update settings has no updates to manage.
  if (unsupported || !settings || settings.update_mode === undefined) return null;

  const mode = settings.update_mode;
  const firmwareOn = settings.update_firmware ?? true;
  const animationsOn = settings.update_animations ?? true;
  const hours = settings.check_hours ?? 6;
  const start = settings.install_start ?? 0;
  const end = settings.install_end ?? 0;
  const source = settings.animation_source ?? DEFAULT_ANIMATION_SOURCE;
  const update = status?.update ?? null;
  const running = update !== null && isUpdateRunning(update);
  const off = mode === "off" || (!firmwareOn && !animationsOn);
  const busy = disabled || changing || acting;

  const zone = browserTimeZone();
  const posix = zone ? posixTimeZone(zone) : null;
  // A firmware that knows schedules has its own Time zone setting in the Settings card, the one control for it.
  const zoneInSettings = supportsSchedules(client.info);

  async function change(changes: SettingsChanges, context: string): Promise<void> {
    setChanging(true);
    try {
      onSettings(await setSettings(client, changes));
    } catch (error) {
      onError(toShownError(context, error));
    }
    setChanging(false);
    refresh();
  }

  async function act(run: () => Promise<void>, context: string): Promise<void> {
    setActing(true);
    try {
      await run();
    } catch (error) {
      onError(toShownError(context, error));
    }
    setActing(false);
    refresh();
  }

  const hoursText = hoursDraft ?? String(hours);
  const hoursProblem =
    hoursDraft !== null && parseCheckHours(hoursDraft) === null
      ? `A whole number of hours from ${MIN_CHECK_HOURS} to ${MAX_CHECK_HOURS}.`
      : null;
  function commitHours(): void {
    const value = hoursDraft === null ? null : parseCheckHours(hoursDraft);
    if (value === null) return;
    setHoursDraft(null);
    if (value !== hours) void change({ check_hours: value }, "Changing the check interval");
  }

  function changeWindow(next: { install_start?: number; install_end?: number }): void {
    const changes: SettingsChanges = { ...next };
    // The window is read in the board's time zone: send the browser's along with it when the board has another, unless
    // the Settings card has the zone.
    if (!zoneInSettings && posix !== null && posix !== settings?.timezone) changes.timezone = posix;
    void change(changes, "Changing the install window");
  }

  const sourceText = sourceDraft ?? source;
  const sourceProblem = sourceDraft !== null ? animationSourceProblem(sourceDraft) : null;
  const sourceChanged = sourceDraft !== null && sourceDraft !== source;

  // The card disabled as a whole says nothing more.
  const connected = status === null || status.wifi.state === "connected";
  const reason = (action: UpdateAction, actionOff: boolean, found: boolean): string =>
    disabled ? "" : disabledReason(action, { off: actionOff, running, found, connected });
  const checkReason = reason("check", off, true);
  const installReason = reason("animations", !animationsOn || mode === "off", update !== null && update.files > 0);
  const firmwareReason = reason("firmware", !firmwareOn || mode === "off", update !== null && update.firmware !== null);
  const skipped = update !== null && firmwareSkipped(update);
  const confirmation =
    update !== null && update.firmware !== null
      ? firmwareConfirmation(client.info?.firmware, update.firmware, skipped)
      : null;

  return (
    <Card aria-labelledby="updates-title">
      <CardHeader>
        <CardTitle id="updates-title">Updates</CardTitle>
      </CardHeader>
      <CardContent>
        {failed && (
          <Alert variant="warning">
            <AlertDescription className="text-foreground">Could not read the update state.</AlertDescription>
            <Button variant="outline" size="sm" className="self-start" disabled={disabled} onClick={refresh}>
              Retry
            </Button>
          </Alert>
        )}
        <Field label="Mode">
          {(control) => (
            <Select
              {...control}
              value={mode}
              disabled={busy}
              onChange={(e) => void change({ update_mode: e.target.value }, "Changing the update mode")}
            >
              {UPDATE_MODES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground" data-testid="update-modes">
          {UPDATE_MODES.map((option) => (
            <li key={option.value}>
              <strong className="font-medium text-foreground">{option.label}:</strong> {option.text}
            </li>
          ))}
        </ul>
        <SwitchRow
          id="update-firmware"
          label="Firmware updates"
          checked={firmwareOn}
          disabled={busy}
          onChange={(checked) => void change({ update_firmware: checked }, "Changing the firmware updates")}
        />
        <SwitchRow
          id="update-animations"
          label="Animation updates"
          checked={animationsOn}
          disabled={busy}
          onChange={(checked) => void change({ update_animations: checked }, "Changing the animation updates")}
          note={ANIMATION_NOTE}
        />
        <Field
          label="Check every (hours)"
          hint={`From ${MIN_CHECK_HOURS} to ${MAX_CHECK_HOURS}. The board adds a random delay of up to 10 minutes.`}
          error={hoursProblem}
        >
          {(control) => (
            <Input
              {...control}
              type="text"
              inputMode="numeric"
              className="w-28"
              value={hoursText}
              disabled={busy}
              onChange={(e) => setHoursDraft(e.target.value)}
              onBlur={commitHours}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitHours();
              }}
            />
          )}
        </Field>
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium leading-none">Install window</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  className="w-32"
                  value={minutesToTime(start)}
                  disabled={busy}
                  onChange={(e) => {
                    const minutes = timeToMinutes(e.target.value);
                    if (minutes !== null && minutes !== start) changeWindow({ install_start: minutes });
                  }}
                />
              )}
            </Field>
            <Field label="To">
              {(control) => (
                <Input
                  {...control}
                  type="time"
                  className="w-32"
                  value={minutesToTime(end)}
                  disabled={busy}
                  onChange={(e) => {
                    const minutes = timeToMinutes(e.target.value);
                    if (minutes !== null && minutes !== end) changeWindow({ install_end: minutes });
                  }}
                />
              )}
            </Field>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="install-window">
            Install window: {describeWindow(start, end)}.
            {start === end ? " Choose two different times to narrow it." : ""} Automatic mode installs only inside the
            window; Install does not wait for it.
          </p>
          <p className="text-xs text-muted-foreground" data-testid="time-zone">
            {zoneInSettings
              ? `Time zone: ${zoneOfSetting(settings.timezone, zone) ?? settings.timezone ?? "UTC0"}, set under Time in the Settings card.`
              : posix === null
                ? `The app does not know the rules of your time zone${zone ? ` (${zone})` : ""}. The board uses ${settings.timezone ?? "UTC0"}.`
                : posix === settings.timezone
                  ? `Time zone: ${zone}, the one of this browser.`
                  : `Time zone: ${zone}. The board uses ${settings.timezone ?? "UTC0"} until you change the window.`}
          </p>
        </fieldset>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Field
            label="Animation source"
            hint="The address of the manifest the animations and playlists come from."
            error={sourceProblem}
          >
            {(control) => (
              <Input
                {...control}
                type="url"
                value={sourceText}
                disabled={busy}
                onChange={(e) => setSourceDraft(e.target.value)}
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !sourceChanged || sourceProblem !== null}
              onClick={() => {
                const next = sourceDraft;
                setSourceDraft(null);
                if (next !== null) void change({ animation_source: next }, "Changing the animation source");
              }}
            >
              Save source
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || (source === DEFAULT_ANIMATION_SOURCE && sourceDraft === null)}
              onClick={() => {
                setSourceDraft(null);
                if (source !== DEFAULT_ANIMATION_SOURCE)
                  void change({ animation_source: DEFAULT_ANIMATION_SOURCE }, "Resetting the animation source");
              }}
            >
              Reset to default
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-2" data-testid="update-status">
          <h4 className="text-sm font-medium">Status</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <Row label="Firmware">{client.info?.firmware ?? "unknown"}</Row>
            <Row label="Now" testId="update-state">
              {update ? describeState(update) : "Reading the state"}
            </Row>
            {update && (
              <>
                <Row label="Last check" testId="update-last-check">
                  {lastCheckText(update)}
                  {update.lastResult !== null && `: ${describeResult(update.lastResult, update.lastDetail)}`}
                </Row>
                <Row label="Available" testId="update-available">
                  {describeFirmware(update)}
                  {"; "}
                  {update.files === 0
                    ? "animations and playlists are up to date"
                    : `${update.files} animation or playlist ${update.files === 1 ? "change" : "changes"} to install`}
                </Row>
                {update.failedFiles > 0 && (
                  <Row label="Failed">
                    {update.failedFiles} {update.failedFiles === 1 ? "file" : "files"} in the last update
                  </Row>
                )}
                {update.lastInstall && <Row label="Last install">{describeInstall(update.lastInstall)}</Row>}
              </>
            )}
          </dl>
          {update?.state === "installing" && (
            <Alert variant="info" data-testid="firmware-installing">
              <AlertDescription className="text-foreground">
                The board is installing the firmware: the matrix shows a progress bar, and the board restarts when it is
                done. This app can lose the connection for a moment; connect again if it does.
              </AlertDescription>
            </Alert>
          )}
          {running && update && (
            <Progress
              aria-label="Update progress"
              value={update.state === "checking" ? null : update.progress}
              className="max-w-sm"
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ReasonTooltip reason={checkReason} focusable={checkReason !== ""}>
            <Button
              variant="outline"
              disabled={busy || checkReason !== ""}
              loading={update?.state === "checking"}
              onClick={() => void act(() => checkForUpdates(client), "Checking for updates")}
            >
              <RefreshCw aria-hidden="true" />
              Check now
            </Button>
          </ReasonTooltip>
          <ReasonTooltip reason={installReason} focusable={installReason !== ""}>
            <Button
              disabled={busy || installReason !== ""}
              onClick={() => void act(() => installUpdate(client, "animations"), "Installing animations")}
            >
              Install animations
            </Button>
          </ReasonTooltip>
          <ReasonTooltip reason={firmwareReason} focusable={firmwareReason !== ""}>
            <Button variant="outline" disabled={busy || firmwareReason !== ""} onClick={() => setConfirmFirmware(true)}>
              Install firmware
            </Button>
          </ReasonTooltip>
        </div>
      </CardContent>
      {confirmFirmware && confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          confirmLabel={confirmation.action}
          onCancel={() => setConfirmFirmware(false)}
          onConfirm={() => {
            setConfirmFirmware(false);
            void act(() => installUpdate(client, "firmware", skipped), "Installing firmware");
          }}
        >
          <p data-testid="firmware-confirmation">{confirmation.text}</p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
