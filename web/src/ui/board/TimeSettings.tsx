// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import { DEFAULT_NTP_SERVER, DEFAULT_TIME_SYNC_HOURS, type Settings, type SettingsChanges } from "../../protocol";
import { Field } from "../common/Field";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { Select } from "../components/select";
import { TIME_SERVER_NOTE } from "../privacy";
import { MAX_SYNC_HOURS, MIN_SYNC_HOURS, ntpServerProblem, parseSyncHours } from "./play";
import { browserTimeZone, knownTimeZones, posixTimeZone, zoneOfSetting } from "./timezones";
import { usePendingSend } from "./usePendingSend";

interface Props {
  /** The settings of a firmware that knows schedules: `time_sync_hours` and `ntp_server` are there. */
  settings: Settings;
  disabled: boolean;
  change: (changes: SettingsChanges, context: string) => Promise<void>;
}

/**
 * The time zone, the time sync interval and the time server of a firmware that knows schedules. The time zone is the
 * one control for the board's `timezone`: the schedule and the install window both read it.
 */
export function TimeSettings({ settings, disabled, change }: Props) {
  const { pending, send } = usePendingSend(change);
  const [hoursDraft, setHoursDraft] = useState<string | null>(null);
  const [serverDraft, setServerDraft] = useState<string | null>(null);
  const busy = disabled || pending;

  const browser = browserTimeZone();
  const browserPosix = browser ? posixTimeZone(browser) : null;
  const zone = zoneOfSetting(settings.timezone, browser);
  // The browser's zone first, then every zone of the table by name.
  const zones = [...new Set([...(browserPosix !== null ? [browser as string] : []), ...knownTimeZones().sort()])];
  const chooseZone = (next: string): void => {
    const posix = posixTimeZone(next);
    if (posix !== null && posix !== settings.timezone) void send({ timezone: posix }, "Changing the time zone");
  };
  let zoneHint: string;
  if (browserPosix === null)
    zoneHint = `The app does not know the rules of this browser's time zone${browser ? ` (${browser})` : ""}: choose a zone with the same rules.`;
  else if (browserPosix !== settings.timezone)
    zoneHint = `This browser is in ${browser}, and the board uses another time zone.`;
  else zoneHint = "The board reads its date for the schedule, and its install window, in this time zone.";

  const hours = settings.time_sync_hours ?? DEFAULT_TIME_SYNC_HOURS;
  const hoursText = hoursDraft ?? String(hours);
  const hoursProblem =
    hoursDraft !== null && parseSyncHours(hoursDraft) === null
      ? `A whole number of hours from ${MIN_SYNC_HOURS} to ${MAX_SYNC_HOURS}.`
      : null;
  function commitHours(): void {
    const value = hoursDraft === null ? null : parseSyncHours(hoursDraft);
    if (value === null) return;
    setHoursDraft(null);
    if (value !== hours) void send({ time_sync_hours: value }, "Changing the time sync interval");
  }

  const server = settings.ntp_server ?? DEFAULT_NTP_SERVER;
  const serverText = serverDraft ?? server;
  const serverProblem = serverDraft !== null ? ntpServerProblem(serverDraft) : null;
  const serverChanged = serverDraft !== null && serverDraft !== server;

  return (
    <fieldset className="flex min-w-0 flex-col gap-4" data-testid="time-settings">
      <legend className="mb-1.5 text-sm font-medium leading-none">Time</legend>
      <div className="flex flex-col gap-1.5">
        <Field label="Time zone" hint={zoneHint}>
          {(control) => (
            <Select {...control} value={zone ?? ""} disabled={busy} onChange={(e) => chooseZone(e.target.value)}>
              {zone === null && (
                <option value="" disabled>
                  {settings.timezone ?? "UTC0"} (set on the board)
                </option>
              )}
              {zones.map((name) => (
                <option key={name} value={name}>
                  {name === browser ? `${name} (this browser)` : name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {browserPosix !== null && browserPosix !== settings.timezone && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={() => chooseZone(browser as string)}
          >
            Use {browser}
          </Button>
        )}
      </div>
      <Field
        label="Time sync every (hours)"
        hint={`From ${MIN_SYNC_HOURS} to ${MAX_SYNC_HOURS}. The board asks for the time only while it needs it.`}
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
      <div className="flex min-w-0 flex-col gap-1.5">
        <Field label="Time server" hint="A host name or an IPv4 address." error={serverProblem}>
          {(control) => (
            <Input
              {...control}
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              value={serverText}
              disabled={busy}
              onChange={(e) => setServerDraft(e.target.value)}
            />
          )}
        </Field>
        <p className="text-xs text-muted-foreground" data-testid="time-server-note">
          {TIME_SERVER_NOTE}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !serverChanged || serverProblem !== null}
            onClick={() => {
              const next = serverDraft;
              setServerDraft(null);
              if (next !== null) void send({ ntp_server: next }, "Changing the time server");
            }}
          >
            Save server
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || (server === DEFAULT_NTP_SERVER && serverDraft === null)}
            onClick={() => {
              setServerDraft(null);
              if (server !== DEFAULT_NTP_SERVER)
                void send({ ntp_server: DEFAULT_NTP_SERVER }, "Resetting the time server");
            }}
          >
            Reset to {DEFAULT_NTP_SERVER}
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
