// SPDX-License-Identifier: GPL-3.0-or-later

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import { nextScheduleChange, scheduleWinner, type PlayMode, type Schedule } from "../../engine";
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
import {
  addReason,
  describeEnd,
  describePlay,
  describeToday,
  editReason,
  entryLabel,
  formatDate,
  listToSend,
  playlistList,
  removeReason,
} from "./play";
import { browserTimeZone, localDateIn, zoneOfSetting } from "./timezones";
import { useFocusAfter } from "./useFocusAfter";
import { usePendingSend } from "./usePendingSend";
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
  const { pending, send } = usePendingSend(change);
  // The choice being sent shows as chosen until the board answers; its answer then decides.
  const [choosing, setChoosing] = useState<PlayMode | null>(null);
  const group = useId();
  const mode = settings.play ?? "auto";
  const busy = disabled || pending;

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
  else if (onBoard) now = describeToday(onBoard, todayEntry);
  // The status polls render this often: the next change is worked out again only for a new schedule or day.
  const { year, month, day } = today;
  const next = useMemo(
    () => (onBoard ? nextScheduleChange(onBoard, { year, month, day }) : null),
    [onBoard, year, month, day],
  );

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
  const order = draft ?? list;
  const stored = new Set(playlists?.keys() ?? []);
  const known = playlists !== null;
  const storedIfKnown = known ? stored : null;
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
  const sendDraft = useEffectEvent((next: string[]) => {
    void apply(next, "Reordering your playlists").finally(() => setDraft(null));
  });
  useEffect(() => {
    if (draft === null || reorder.moving !== null) return;
    sendDraft(draft);
  }, [draft, reorder.moving]);

  const focus = useFocusAfter(!busy && draft === null, list);
  const button = (id: string, role: RowButton) => focus.ref(`${id}:${role}`);
  const moveWithButton = (id: string, index: number, by: -1 | 1): void => {
    reorder.moveBy(id, by);
    // The button that moved the item keeps the focus, unless the item reached the top or the bottom: that button is
    // then disabled, and the other move button takes the focus.
    const same: RowButton = by === -1 ? "up" : "down";
    const opposite: RowButton = by === -1 ? "down" : "up";
    const to = index + by;
    const reachedEdge = to === 0 || to === order.length - 1;
    const role = reachedEdge ? opposite : same;
    focus.focusLater(`${id}:${role}`);
  };
  const remove = (id: string, index: number): void => {
    const rest = order.filter((other) => other !== id);
    setAnnouncement(`${id} removed.`);
    const after = rest[index] ?? rest[index - 1];
    focus.focusLater(after ? `${after}:remove` : null);
    void apply(rest, `Removing ${id} from your playlists`);
  };

  const cannotEdit = editReason(order, storedIfKnown);
  const cannotAdd = addReason(order, storedIfKnown);

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
        {order.map((id, index) => (
          <PlaylistRow
            key={id}
            id={id}
            index={index}
            count={order.length}
            name={name(id)}
            absent={known && !stored.has(id)}
            busy={busy}
            cannotEdit={cannotEdit}
            cannotRemove={removeReason(order, id, storedIfKnown)}
            moving={reorder.moving === id}
            handle={reorder.handleProps(id)}
            button={(role) => button(id, role)}
            onMove={(by) => moveWithButton(id, index, by)}
            onRemove={() => remove(id, index)}
          />
        ))}
      </ol>
      {missing.length > 0 && <MissingAlert missing={missing} />}
      <AddPlaylist
        unused={unused}
        pick={pick}
        name={name}
        busy={busy}
        cannotAdd={cannotAdd}
        onPick={setAdding}
        onAdd={() => {
          setAnnouncement(`${pick} added.`);
          void apply([...order, pick], `Adding ${pick} to your playlists`);
        }}
      />
    </div>
  );
}

/** One playlist of My playlists, with its drag handle and its Up, Down and Remove buttons. */
function PlaylistRow({
  id,
  index,
  count,
  name,
  absent,
  busy,
  cannotEdit,
  cannotRemove,
  moving,
  handle,
  button,
  onMove,
  onRemove,
}: {
  id: string;
  index: number;
  /** How many playlists the list holds. */
  count: number;
  name: string;
  /** True when the board does not store the playlist. */
  absent: boolean;
  busy: boolean;
  /** Why the list cannot be reordered, or "". */
  cannotEdit: string;
  /** Why this playlist cannot be removed, or "". */
  cannotRemove: string;
  moving: boolean;
  /** The props of the drag handle. */
  handle: HTMLAttributes<HTMLElement>;
  button: (role: RowButton) => Ref<HTMLButtonElement>;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  // While the board answers, the buttons are disabled without a reason to show.
  const reason = busy ? "" : cannotEdit;
  const locked = busy || reason !== "";
  const label = `${id}, playlist ${index + 1}`;
  return (
    <li
      data-testid={`my-playlist-${index + 1}`}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card p-2",
        moving && "relative z-10 border-primary shadow-md ring-2 ring-primary",
      )}
    >
      {/* A pointer drags the handle; the keyboard moves items with the Up and Down buttons. */}
      <span
        aria-hidden="true"
        title="Drag to reorder"
        data-testid={`my-playlist-handle-${index + 1}`}
        className={cn(
          "flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-muted-foreground",
          locked ? "cursor-not-allowed opacity-50" : "cursor-grab hover:bg-accent active:cursor-grabbing",
        )}
        {...(locked ? {} : handle)}
      >
        <GripVertical className="size-4" />
      </span>
      <span className="w-5 text-sm tabular-nums text-muted-foreground" aria-hidden="true">
        {index + 1}
      </span>
      <span className="min-w-0 flex-1 basis-32 break-words text-sm">{name}</span>
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
          disabled={locked || index === 0}
          ref={button("up")}
          onClick={() => onMove(-1)}
        />
        <IconButton
          label={`Down ${label}`}
          tooltip={reason || "Move down"}
          icon={ArrowDown}
          disabled={locked || index === count - 1}
          ref={button("down")}
          onClick={() => onMove(1)}
        />
        <IconButton
          label={`Remove ${label}`}
          tooltip={cannotRemove || "Remove"}
          icon={Trash2}
          className="text-destructive"
          disabled={busy || cannotRemove !== ""}
          ref={button("remove")}
          onClick={onRemove}
        />
      </div>
    </li>
  );
}

/** The playlists of the list that the board does not store. */
function MissingAlert({ missing }: { missing: string[] }) {
  const one = missing.length === 1;
  return (
    <Alert variant="warning" data-testid="my-playlists-missing">
      <AlertDescription className="text-foreground">
        {one ? "The playlist " : "The playlists "}
        {missing.map((id, i) => (
          <span key={id}>
            {i > 0 && (i === missing.length - 1 ? " and " : ", ")}
            <code>{id}</code>
          </span>
        ))}{" "}
        {one ? "is" : "are"} not stored, so the board skips {one ? "it" : "them"}. A change to the list leaves out what
        the board does not store.
      </AlertDescription>
    </Alert>
  );
}

/** The stored playlists that are not in the list, to add one. */
function AddPlaylist({
  unused,
  pick,
  name,
  busy,
  cannotAdd,
  onPick,
  onAdd,
}: {
  unused: string[];
  /** The playlist chosen to add, or "" when there is none. */
  pick: string;
  name: (id: string) => string;
  busy: boolean;
  /** Why no playlist can be added, or "". */
  cannotAdd: string;
  onPick: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Add a playlist" className="min-w-48 flex-1">
        {(control) => (
          <Select
            {...control}
            value={pick}
            disabled={busy || cannotAdd !== ""}
            onChange={(e) => onPick(e.target.value)}
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
      <ReasonTooltip reason={busy ? "" : cannotAdd} focusable={!busy && cannotAdd !== ""}>
        <Button variant="outline" disabled={busy || cannotAdd !== "" || pick === ""} onClick={onAdd}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </ReasonTooltip>
    </div>
  );
}
