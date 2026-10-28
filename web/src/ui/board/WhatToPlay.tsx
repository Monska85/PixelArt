// SPDX-License-Identifier: GPL-3.0-or-later

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MAX_SCHEDULE_PLAYLISTS, nextScheduleChange, scheduleWinner, type PlayMode, type Schedule } from "../../engine";
import type { BoardClient, Entry, PlayStatus, Settings, SettingsChanges } from "../../protocol";
import { Field } from "../common/Field";
import { Alert, AlertDescription } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { cn } from "../components/cn";
import { IconButton } from "../components/icon-button";
import { Select } from "../components/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";
import { ReasonTooltip } from "../components/tooltip";
import { useManifest } from "../useManifest";
import { describeEnd, describePlay, entryLabel, formatDate, listToSend, playlistList } from "./play";
import { browserTimeZone, localDateIn, zoneOfSetting } from "./timezones";
import { useReorder } from "./useReorder";
import { useScheduleSource } from "./useScheduleSource";

export interface WhatToPlayProps {
  client: BoardClient;
  /** The settings of a firmware that knows schedules: `play` and `playlists` are there. */
  settings: Settings;
  /** The stored playlists by ID with their names, or null while they are not known. */
  playlists: ReadonlyMap<string, string | null> | null;
  /** The stored schedules, or null while they are not known. */
  schedules: Entry[] | null;
  /** `status.play`, or null while it is not known. */
  play: PlayStatus | null;
  disabled: boolean;
  /** Sends a change; the caller shows the board's answer or the error. */
  change: (changes: SettingsChanges, context: string) => Promise<void>;
}

const MODES: ReadonlyArray<{ value: PlayMode; label: string; text: string }> = [
  {
    value: "auto",
    label: "Automatic",
    text: "The schedule chooses the playlists for each season, and the fallback for the rest of the year.",
  },
  { value: "playlists", label: "My playlists", text: "Your playlists, each one played in full, in turn." },
];

/**
 * "What to play" on a firmware that knows schedules: Automatic (the schedule `default`) or My playlists (the
 * `playlists` setting). Each change is sent at once, and only what changes: `play` for the choice, `playlists` for
 * the list, which is kept while Automatic plays.
 */
export function WhatToPlay({ client, settings, playlists, schedules, play, disabled, change }: WhatToPlayProps) {
  const [pending, setPending] = useState(false);
  // The choice being sent shows as chosen until the board answers; its answer then decides.
  const [choosing, setChoosing] = useState<PlayMode | null>(null);
  const group = useId();
  const mode = settings.play ?? "auto";
  const busy = disabled || pending;

  async function send(changes: SettingsChanges, context: string): Promise<void> {
    setPending(true);
    try {
      await change(changes, context);
    } finally {
      setPending(false);
    }
  }

  const choice = (value: PlayMode, body: ReactNode) => {
    const option = MODES.find((m) => m.value === value)!;
    const checked = (choosing ?? mode) === value;
    return (
      <section
        aria-labelledby={`${group}-${value}`}
        data-testid={`play-${value}`}
        className={cn(
          "flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3",
          checked && "border-primary ring-1 ring-primary",
        )}
      >
        <label className="flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed">
          <input
            type="radio"
            name={group}
            value={value}
            checked={checked}
            disabled={busy}
            className="mt-0.5 size-4 shrink-0 accent-primary"
            onChange={() => {
              setChoosing(value);
              void send({ play: value }, `Choosing ${option.label}`).finally(() => setChoosing(null));
            }}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span id={`${group}-${value}`} className="text-sm font-medium leading-none">
              {option.label}
            </span>
            <span className="text-xs text-muted-foreground">{option.text}</span>
          </span>
        </label>
        {body}
      </section>
    );
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid="what-to-play">
      <legend className="mb-1.5 text-sm font-medium leading-none">What to play</legend>
      {choice(
        "auto",
        <Automatic client={client} settings={settings} schedules={schedules} play={mode === "auto" ? play : null} />,
      )}
      {choice(
        "playlists",
        <MyPlaylists
          list={settings.playlists ?? [settings.playlist]}
          playlists={playlists}
          automatic={mode === "auto"}
          busy={busy}
          send={send}
        />,
      )}
    </fieldset>
  );
}

function Automatic({
  client,
  settings,
  schedules,
  play,
}: {
  client: BoardClient;
  settings: Settings;
  schedules: Entry[] | null;
  /** `status.play` while Automatic is chosen. */
  play: PlayStatus | null;
}) {
  const library = useManifest();
  const source = useScheduleSource(client, schedules, library);
  const [open, setOpen] = useState(false);
  const viewId = useId();
  // The board reads its local date in its own time zone: the app does the same.
  const today = localDateIn(zoneOfSetting(settings.timezone, browserTimeZone()));
  const schedule = source.status === "board" || source.status === "site" ? source.schedule : null;
  const onBoard = source.status === "board" ? source.schedule : null;
  const todayEntry = schedule ? scheduleWinner(schedule, today) : -1;

  let now: string | null = null;
  if (play) now = describePlay(play, onBoard);
  else if (onBoard) {
    const list = todayEntry >= 0 ? onBoard.entries[todayEntry]!.playlists : onBoard.fallback;
    now = `${todayEntry >= 0 ? entryLabel(onBoard.entries[todayEntry], todayEntry) : "The fallback"} plays today: ${playlistList(list)}.`;
  }
  const next = onBoard ? nextScheduleChange(onBoard, today) : null;

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm sm:pl-7" data-testid="automatic">
      {source.status === "loading" && <p className="text-muted-foreground">Reading the schedule...</p>}
      {source.status === "board" && source.schedule === null && (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            The schedule default on the board is not valid, so Automatic plays the playlist default.
          </AlertDescription>
        </Alert>
      )}
      {(source.status === "none" || source.status === "site") && (
        <p className="text-muted-foreground" data-testid="no-schedule">
          This board stores no schedule, so Automatic plays the playlist default.
          {source.status === "site" &&
            " The site publishes the schedule below, which comes with the animations and playlists."}
        </p>
      )}
      {now && (
        <p data-testid="play-now">
          <span className="font-medium">Now:</span> {now}
        </p>
      )}
      {onBoard && (
        <p data-testid="play-next">
          <span className="font-medium">Next change:</span>{" "}
          {next
            ? `${formatDate(next.date)}, ${next.entry === null ? "the fallback" : entryLabel(onBoard.entries[next.entry], next.entry)}: ${playlistList(next.playlists)}.`
            : "none in the next 12 months."}
        </p>
      )}
      {schedule && (
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            aria-expanded={open}
            aria-controls={viewId}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Hide the schedule" : "Show the schedule"}
          </Button>
          {open && (
            <ScheduleView id={viewId} schedule={schedule} published={source.status === "site"} today={todayEntry} />
          )}
        </div>
      )}
    </div>
  );
}

/** The schedule, read only: its entries in file order and the fallback, with the entry that wins today marked. */
function ScheduleView({
  id,
  schedule,
  published,
  today,
}: {
  id: string;
  schedule: Schedule;
  published: boolean;
  /** The entry that wins today, or -1. */
  today: number;
}) {
  const title = `${schedule.name ?? "Schedule default"}, ${published ? "published by the site" : "stored on this board"}`;
  return (
    <div id={id} className="min-w-0 overflow-hidden rounded-lg border border-border" data-testid="schedule-view">
      <Table className="table-fixed" aria-label={title}>
        <caption className="px-3 py-2 text-left text-xs text-muted-foreground">{title}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Entry</TableHead>
            <TableHead>Days</TableHead>
            <TableHead>Playlists</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {schedule.entries.map((entry, index) => (
            <TableRow key={index}>
              <TableCell className="break-words px-3 py-2">
                <span className="mr-2">{entryLabel(entry, index)}</span>
                {index === today && <Badge variant="success">Today</Badge>}
              </TableCell>
              <TableCell className="break-words px-3 py-2">
                {describeEnd(entry.from)} to {describeEnd(entry.to)}
              </TableCell>
              <TableCell className="break-words px-3 py-2 font-mono text-xs">{entry.playlists.join(", ")}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell className="break-words px-3 py-2">
              <span className="mr-2">Fallback</span>
              {today < 0 && <Badge variant="success">Today</Badge>}
            </TableCell>
            <TableCell className="break-words px-3 py-2">Every other day, and while the date is not known</TableCell>
            <TableCell className="break-words px-3 py-2 font-mono text-xs">{schedule.fallback.join(", ")}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

type RowButton = "up" | "down" | "remove";

function MyPlaylists({
  list,
  playlists,
  automatic,
  busy,
  send,
}: {
  /** The `playlists` setting. */
  list: string[];
  playlists: ReadonlyMap<string, string | null> | null;
  automatic: boolean;
  busy: boolean;
  send: (changes: SettingsChanges, context: string) => Promise<void>;
}) {
  // The order while the user moves an item; null when it is the board's.
  const [draft, setDraft] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [adding, setAdding] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const order = draft ?? list;
  const stored = new Set(playlists?.keys() ?? []);
  const known = playlists !== null;
  const missing = known ? order.filter((id) => !stored.has(id)) : [];
  const unused = [...stored].filter((id) => !order.includes(id));
  const pick = unused.includes(adding) ? adding : (unused[0] ?? "");

  const name = (id: string): string => {
    const named = playlists?.get(id);
    return named ? `${id}: ${named}` : id;
  };
  const move = (from: number, to: number): void =>
    setDraft((current) => {
      const next = [...(current ?? list)];
      const [item] = next.splice(from, 1);
      if (item !== undefined) next.splice(to, 0, item);
      return next;
    });
  const reorder = useReorder({ list: listRef, keys: order, move, name: (id) => id, announce: setAnnouncement });

  async function apply(next: string[], context: string): Promise<void> {
    const sent = listToSend(next, stored);
    if (sent && sent.join(",") !== list.join(",")) await send({ playlists: sent }, context);
  }

  // A move goes to the board when it ends: at once for the Up and Down buttons, at the drop for a drag. A drag
  // cancelled back to its place sends nothing. The board's answer replaces the draft, or the old order comes back.
  useEffect(() => {
    if (draft === null || reorder.moving !== null) return;
    const next = draft;
    void apply(next, "Reordering your playlists").finally(() => setDraft(null));
    // `apply` is made again on every render and reads only the props of this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, reorder.moving]);

  // The buttons are disabled while the board answers, which takes their focus: the button a keyboard user expects
  // gets it back once the answer is shown.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const key = focusAfter.current;
    if (busy || draft !== null || key === null) return;
    focusAfter.current = null;
    requestAnimationFrame(() => buttons.current.get(key)?.focus());
  }, [busy, draft, list]);
  const button = (id: string, role: RowButton) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(`${id}:${role}`, element);
    else buttons.current.delete(`${id}:${role}`);
  };
  const moveWithButton = (id: string, index: number, by: -1 | 1): void => {
    reorder.moveBy(id, by);
    // At the top or the bottom the button that moved the item is disabled: its other move button takes focus.
    const to = index + by;
    const atEdge = to === 0 || to === order.length - 1;
    focusAfter.current = `${id}:${(by === -1) !== atEdge ? "up" : "down"}`;
  };
  const remove = (id: string, index: number): void => {
    const rest = order.filter((other) => other !== id);
    setAnnouncement(`${id} removed.`);
    const after = rest[index] ?? rest[index - 1];
    focusAfter.current = after ? `${after}:remove` : null;
    void apply(rest, `Removing ${id} from your playlists`);
  };

  // The board takes only stored playlists: with one it lacks in the list, a change leaves that one out.
  const editReason = !known
    ? "Reading the playlists on the board."
    : listToSend(order, stored) === null
      ? "Add a stored playlist first: the board takes only playlists it stores."
      : "";
  const removeReason = (id: string): string => {
    if (order.length === 1) return "The list keeps at least one playlist.";
    if (!known) return "Reading the playlists on the board.";
    return listToSend(
      order.filter((other) => other !== id),
      stored,
    ) === null
      ? "The list keeps at least one stored playlist."
      : "";
  };
  const addReason = !known
    ? "Reading the playlists on the board."
    : order.length >= MAX_SCHEDULE_PLAYLISTS
      ? `The list holds at most ${MAX_SCHEDULE_PLAYLISTS} playlists.`
      : unused.length === 0
        ? "Every stored playlist is in the list."
        : "";

  return (
    <div className="flex min-w-0 flex-col gap-3 sm:pl-7" data-testid="my-playlists">
      {automatic && (
        <p className="text-xs text-muted-foreground">
          Automatic is on. This list is kept for when you choose My playlists, and you can change it meanwhile.
        </p>
      )}
      <p className="sr-only" aria-live="polite" data-testid="my-playlists-status">
        {announcement}
      </p>
      <ol
        ref={listRef}
        aria-label="My playlists, in the order they play"
        className={cn("flex flex-col gap-2", reorder.moving !== null && "select-none")}
      >
        {order.map((id, index) => {
          const absent = known && !stored.has(id);
          const reason = busy ? "" : editReason;
          const label = `${id}, playlist ${index + 1}`;
          return (
            <li
              key={id}
              data-testid={`my-playlist-${index + 1}`}
              className={cn(
                "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card p-2",
                reorder.moving === id && "relative z-10 border-primary shadow-md ring-2 ring-primary",
              )}
            >
              {/* A pointer drags the handle; the keyboard moves items with the Up and Down buttons. */}
              <span
                aria-hidden="true"
                title="Drag to reorder"
                data-testid={`my-playlist-handle-${index + 1}`}
                className={cn(
                  "flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground",
                  busy || reason
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-grab hover:bg-accent active:cursor-grabbing",
                )}
                {...(busy || reason ? {} : reorder.handleProps(id))}
              >
                <GripVertical className="size-4" />
              </span>
              <span className="w-5 text-sm tabular-nums text-muted-foreground" aria-hidden="true">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 basis-32 break-words text-sm">{name(id)}</span>
              {absent && (
                <Badge variant="warning" data-testid={`my-playlist-missing-${id}`}>
                  <TriangleAlert aria-hidden="true" />
                  Not stored
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-1">
                <IconButton
                  label={`Up ${label}`}
                  tooltip={reason || "Move up"}
                  icon={ArrowUp}
                  disabled={busy || index === 0 || reason !== ""}
                  ref={button(id, "up")}
                  onClick={() => moveWithButton(id, index, -1)}
                />
                <IconButton
                  label={`Down ${label}`}
                  tooltip={reason || "Move down"}
                  icon={ArrowDown}
                  disabled={busy || index === order.length - 1 || reason !== ""}
                  ref={button(id, "down")}
                  onClick={() => moveWithButton(id, index, 1)}
                />
                <IconButton
                  label={`Remove ${label}`}
                  tooltip={removeReason(id) || "Remove"}
                  icon={Trash2}
                  className="text-destructive"
                  disabled={busy || removeReason(id) !== ""}
                  ref={button(id, "remove")}
                  onClick={() => remove(id, index)}
                />
              </div>
            </li>
          );
        })}
      </ol>
      {missing.length > 0 && (
        <Alert variant="warning" data-testid="my-playlists-missing">
          <AlertDescription className="text-foreground">
            {missing.length === 1 ? "The playlist " : "The playlists "}
            {missing.map((id, i) => (
              <span key={id}>
                {i > 0 && (i === missing.length - 1 ? " and " : ", ")}
                <code>{id}</code>
              </span>
            ))}{" "}
            {missing.length === 1 ? "is" : "are"} not stored, so the board skips {missing.length === 1 ? "it" : "them"}.
            A change to the list leaves out what the board does not store.
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Add a playlist" className="min-w-48 flex-1">
          {(control) => (
            <Select
              {...control}
              value={pick}
              disabled={busy || addReason !== ""}
              onChange={(e) => setAdding(e.target.value)}
            >
              {unused.length === 0 && <option value="">No other stored playlist</option>}
              {unused.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ReasonTooltip reason={busy ? "" : addReason} focusable={!busy && addReason !== ""}>
          <Button
            variant="outline"
            disabled={busy || addReason !== "" || pick === ""}
            onClick={() => {
              setAnnouncement(`${pick} added.`);
              void apply([...order, pick], `Adding ${pick} to your playlists`);
            }}
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
        </ReasonTooltip>
      </div>
    </div>
  );
}
