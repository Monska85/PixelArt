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
import {
  DEFAULT_SCHEDULE_ID,
  nextScheduleChange,
  scheduleWinner,
  type LocalDate,
  type PlayMode,
  type Schedule,
} from "../../engine";
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
import { useManifest, type ManifestState } from "../useManifest";
import {
  addReason,
  automaticSchedule,
  describeEnd,
  describePlay,
  describeAutomatic,
  describeToday,
  editReason,
  entryLabel,
  formatDate,
  listToSend,
  ownRule,
  playlistList,
  removeReason,
} from "./play";
import { browserTimeZone, localDateIn, localMinuteIn, zoneOfSetting } from "./timezones";
import { nextTimedChange } from "./nextTimedChange";
import { useFocusAfter } from "./useFocusAfter";
import { usePendingSend } from "./usePendingSend";
import { useReorder } from "./useReorder";
import { readBoardSchedule, useScheduleSource, useSiteSchedule, type ScheduleSource } from "./useScheduleSource";

export interface WhatToPlayProps {
  client: BoardClient;
  /** The settings of a firmware that knows schedules: `play`, `playlists` and `schedule` are there. */
  settings: Settings;
  /** The stored playlists by ID with their names, or null while they are not known. */
  playlists: ReadonlyMap<string, string | null> | null;
  /** The stored schedules, or null while they are not known. */
  schedules: Entry[] | null;
  schedulesV2?: Entry[] | null;
  /** `status.play`, or null while it is not known. */
  play: PlayStatus | null;
  disabled: boolean;
  /** Sends a change; the caller shows the board's answer or the error. */
  change: (changes: SettingsChanges, context: string) => Promise<void>;
  /** Opens the Files section on its Schedules tab. */
  onShowSchedules: () => void;
}

type Choice = "auto" | "mine";
type Segment = "playlists" | "schedule";

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: "playlists", label: "Playlists" },
  { value: "schedule", label: "Schedule" },
];

const segmentLabel = (segment: Segment): string => SEGMENTS.find((s) => s.value === segment)!.label;
const timedKey = (entry: Entry): string => `${entry.id}:${entry.sha256 ?? ""}:${entry.size}`;

/**
 * "What to play" on a firmware that knows schedules, one card with two choices: Automatic (what the site chose, or the
 * board's own rule) and My choice, which is Playlists (the `playlists` setting) or Schedule (the `schedule` setting).
 * Each change is sent at once, and only what changes: `play` for the choice and the segment, `playlists` for the
 * list and `schedule` for the schedule, which are kept while another choice plays.
 */
export function WhatToPlay({
  client,
  settings,
  playlists,
  schedules,
  schedulesV2 = [],
  play,
  disabled,
  change,
  onShowSchedules,
}: WhatToPlayProps) {
  const { pending, send } = usePendingSend(change);
  const library = useManifest();
  // The `play` being sent shows as chosen until the board answers; its answer then decides.
  const [choosing, setChoosing] = useState<PlayMode | null>(null);
  // The segment the user looked at while Automatic plays, which has none of its own: it shows Playlists otherwise.
  const [looking, setLooking] = useState<Segment | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const group = useId();
  const mode = settings.play ?? "auto";
  const busy = disabled || pending;
  const segmentOf = (value: PlayMode): Segment =>
    value === "schedule" ? "schedule" : value === "playlists" ? "playlists" : (looking ?? "playlists");
  const segment = segmentOf(mode);
  const shown = choosing ?? mode;
  const choice: Choice = shown === "auto" ? "auto" : "mine";
  const shownSegment = segmentOf(shown);
  // The board's own state decides what is announced, so a change that fails is not announced.
  const [seen, setSeen] = useState({ auto: mode === "auto", segment });
  if (seen.auto !== (mode === "auto") || seen.segment !== segment) {
    setSeen({ auto: mode === "auto", segment });
    setAnnouncement(
      seen.auto !== (mode === "auto")
        ? mode === "auto"
          ? "Automatic chosen."
          : `My choice chosen, ${segmentLabel(segment)}.`
        : `${segmentLabel(segment)} chosen.`,
    );
  }

  const logicalSchedules = useMemo(() => {
    const entries = new Map((schedules ?? []).map((e) => [e.id, e]));
    for (const entry of schedulesV2 ?? []) entries.set(entry.id, entry);
    return [...entries.values()];
  }, [schedules, schedulesV2]);
  const [timed, setTimed] = useState<Map<string, boolean>>(new Map());
  useEffect(() => {
    let current = true;
    void (async () => {
      for (const entry of schedulesV2 ?? []) {
        const schedule = await readBoardSchedule(client, entry, "schedule_v2").catch(() => null);
        if (!current) return;
        setTimed((before) => new Map(before).set(timedKey(entry), !!schedule?.entries.some((e) => e.hours?.length)));
      }
    })();
    return () => {
      current = false;
    };
  }, [client, schedulesV2]);
  const scheduleNames = useMemo(() => new Map(logicalSchedules.map((e) => [e.id, e.name ?? e.id])), [logicalSchedules]);
  const noSchedules = schedules !== null && schedulesV2 !== null && logicalSchedules.length === 0;
  // The board reads its local date in its own time zone: the app does the same.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  const zone = zoneOfSetting(settings.timezone, browserTimeZone());
  const today = localDateIn(zone, clock);
  const minute = localMinuteIn(zone, clock);

  function choose(value: PlayMode, context: string): void {
    setChoosing(value);
    void send({ play: value }, context).finally(() => setChoosing(null));
  }

  const pane = (value: Choice, label: string, text: string, body: ReactNode) => {
    const checked = choice === value;
    return (
      <section
        aria-labelledby={`${group}-${value}`}
        data-testid={`play-${value}`}
        className={cn("flex min-w-0 flex-col gap-3 rounded-md p-3", checked && "bg-accent/40")}
      >
        <label className="flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed">
          <input
            type="radio"
            name={`${group}-choice`}
            value={value}
            checked={checked}
            disabled={busy}
            aria-labelledby={`${group}-${value}`}
            aria-describedby={`${group}-${value}-text`}
            className="mt-0.5 size-4 shrink-0 accent-primary"
            onChange={() => {
              setLooking(null);
              if (value === "auto") choose("auto", "Choosing Automatic");
              else choose(shownSegment, "Choosing My choice");
            }}
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span id={`${group}-${value}`} className="text-sm font-medium leading-none">
              {label}
            </span>
            <span id={`${group}-${value}-text`} className="text-xs text-muted-foreground">
              {text}
            </span>
          </span>
        </label>
        {body}
      </section>
    );
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-3" data-testid="what-to-play">
      <legend className="mb-1.5 text-sm font-medium leading-none">What to play</legend>
      <p className="sr-only" aria-live="polite" data-testid="what-to-play-status">
        {announcement}
      </p>
      <div className="grid min-w-0 gap-1 rounded-lg border border-border p-1 md:grid-cols-2 md:items-start">
        {pane(
          "auto",
          "Automatic",
          "What the site chose for this board, or the board's own rule when it chose nothing.",
          <Automatic
            client={client}
            today={today}
            minute={minute}
            schedules={logicalSchedules}
            legacySchedules={schedules}
            schedulesV2={schedulesV2}
            scheduleNames={scheduleNames}
            playlists={playlists}
            play={play}
            library={library}
          />,
        )}
        {pane(
          "mine",
          "My choice",
          "Your playlists, each one played in full, in turn, or one of the schedules on the board.",
          <div className="flex min-w-0 flex-col gap-3 sm:pl-7" data-testid="my-choice">
            <div
              role="radiogroup"
              aria-label="My choice plays"
              className="inline-flex self-start rounded-md border border-input bg-card p-0.5"
            >
              {SEGMENTS.map(({ value, label }) => {
                const locked = busy || (value === "schedule" && noSchedules);
                return (
                  <label
                    key={value}
                    className={cn(
                      "relative cursor-pointer rounded px-3 py-1 text-sm font-medium has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${group}-segment`}
                      value={value}
                      checked={shownSegment === value}
                      disabled={locked}
                      // Invisible over its label: a click and a pointer land on the control itself.
                      className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      onChange={() => {
                        // Automatic has no segment of its own: looking at one changes nothing on the board.
                        if (mode === "auto") setLooking(value);
                        else choose(value, `Choosing ${label}`);
                      }}
                    />
                    {label}
                  </label>
                );
              })}
            </div>
            {noSchedules && (
              <p className="text-xs text-muted-foreground" data-testid="no-schedule-link">
                This board stores no schedule. Add one in the{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline underline-offset-4"
                  onClick={onShowSchedules}
                >
                  Schedules tab of Files
                </button>
                .
              </p>
            )}
            {shownSegment === "playlists" ? (
              <MyPlaylists
                list={settings.playlists ?? [settings.playlist]}
                playlists={playlists}
                automatic={mode === "auto"}
                busy={busy}
                send={send}
              />
            ) : (
              <MySchedule
                client={client}
                id={settings.schedule ?? DEFAULT_SCHEDULE_ID}
                today={today}
                minute={minute}
                schedules={logicalSchedules}
                legacySchedules={schedules}
                schedulesV2={schedulesV2}
                scheduleNames={scheduleNames}
                timed={timed}
                play={mode === "schedule" ? play : null}
                automatic={mode === "auto"}
                library={library}
                busy={busy}
                send={send}
              />
            )}
          </div>,
        )}
      </div>
    </fieldset>
  );
}

function Automatic({
  client,
  today,
  minute,
  schedules,
  legacySchedules,
  schedulesV2,
  scheduleNames,
  playlists,
  play,
  library,
}: {
  client: BoardClient;
  today: LocalDate;
  minute: number;
  schedules: Entry[] | null;
  legacySchedules: Entry[] | null;
  schedulesV2: Entry[] | null;
  scheduleNames: ReadonlyMap<string, string | null>;
  playlists: ReadonlyMap<string, string | null> | null;
  /** `status.play`, or null while it is not known. */
  play: PlayStatus | null;
  library: ManifestState;
}) {
  const choice = play?.serverChoice ?? null;
  const id = schedules === null ? null : automaticSchedule(choice, new Set(scheduleNames.keys()), play);
  // A board that stores no schedule shows the one the site publishes: the schedule its play file names, none when it
  // chooses playlists, else `default`.
  const siteId = useSiteSchedule(library, schedules !== null && schedules.length === 0);
  const source = useScheduleSource(client, legacySchedules, schedulesV2, library, id, siteId);

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm sm:pl-7" data-testid="automatic">
      {play !== null && (
        <p data-testid="server-choice">
          {describeAutomatic(play, { schedules: scheduleNames, playlists: playlists ?? new Map() })}
        </p>
      )}
      {schedules !== null && schedules.length === 0 && (
        <p className="text-muted-foreground" data-testid="no-schedule">
          This board stores no schedule.
          {source.status === "site" &&
            " The site publishes the schedule below, which comes with the animations and playlists."}
        </p>
      )}
      <ScheduleDetails
        prefix="play"
        id={id ?? siteId}
        source={source}
        today={today}
        minute={minute}
        status={play?.mode === "auto" ? play : null}
      />
    </div>
  );
}

/** Now, the next change and the schedule itself for a schedule the board stores, or the one the site publishes. */
function ScheduleDetails({
  prefix,
  id,
  source,
  today,
  minute,
  status,
}: {
  /** The test ids start with it: `<prefix>-now` and `<prefix>-next`. */
  prefix: string;
  id: string | null;
  source: ScheduleSource;
  today: LocalDate;
  minute: number;
  /** `status.play` while the choice this card belongs to is the one that plays, else null. */
  status: PlayStatus | null;
}) {
  const [open, setOpen] = useState(false);
  const viewId = useId();
  const schedule = source.status === "board" || source.status === "site" ? source.schedule : null;
  const onBoard = source.status === "board" ? source.schedule : null;
  const todayEntry = schedule ? scheduleWinner(schedule, today) : -1;

  let now: string | null = null;
  if (status) now = describePlay(status, onBoard);
  else if (onBoard)
    now = describeToday(onBoard, todayEntry, onBoard.entries.some((e) => e.hours?.length) ? minute : undefined);
  // The status polls render this often: the next change is worked out again only for a new schedule or day.
  const { year, month, day } = today;
  const next = useMemo(
    () =>
      onBoard
        ? onBoard.entries.some((e) => e.hours?.length)
          ? nextTimedChange(onBoard, { year, month, day }, minute)
          : nextScheduleChange(onBoard, { year, month, day })
        : null,
    [onBoard, year, month, day, minute],
  );

  return (
    <>
      {source.status === "loading" && <p className="text-muted-foreground">Reading the schedule...</p>}
      {source.status === "board" && source.schedule === null && (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            The schedule {id} on the board is not valid, so the board does not use it.
          </AlertDescription>
        </Alert>
      )}
      {now && (
        <p data-testid={`${prefix}-now`}>
          <span className="font-medium">Now:</span> {now}
        </p>
      )}
      {onBoard && (
        <p data-testid={`${prefix}-next`}>
          <span className="font-medium">Next change:</span>{" "}
          {next
            ? `${formatDate(next.date)}${"minute" in next && typeof next.minute === "number" ? ` at ${String(Math.floor(next.minute / 60)).padStart(2, "0")}:${String(next.minute % 60).padStart(2, "0")}` : ""}, ${next.entry === null ? "the fallback" : entryLabel(onBoard.entries[next.entry], next.entry)}: ${playlistList(next.playlists)}.`
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
            <ScheduleView
              id={viewId}
              scheduleId={id ?? ""}
              schedule={schedule}
              published={source.status === "site"}
              today={todayEntry}
            />
          )}
        </div>
      )}
    </>
  );
}

/** The schedule, read only: its entries in file order and the fallback, with the entry that wins today marked. */
function ScheduleView({
  id,
  scheduleId,
  schedule,
  published,
  today,
}: {
  id: string;
  scheduleId: string;
  schedule: Schedule;
  published: boolean;
  /** The entry that wins today, or -1. */
  today: number;
}) {
  const title = `${schedule.name ?? `Schedule ${scheduleId}`}, ${published ? "published by the site" : "stored on this board"}`;
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
              <TableCell className="break-words px-3 py-2 font-mono text-xs">
                <div>
                  {entry.hours?.length ? "Other hours: " : ""}
                  {entry.playlists.join(", ")}
                </div>
                {entry.hours?.map((window) => (
                  <div key={`${window.from}-${window.to}`}>
                    {window.from} to {window.to}: {window.playlists.join(", ")}
                  </div>
                ))}
              </TableCell>
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

/** My choice, Schedule: one of the stored schedules, with now, the next change and the schedule itself. */
function MySchedule({
  client,
  id,
  today,
  minute,
  schedules,
  legacySchedules,
  schedulesV2,
  scheduleNames,
  timed,
  play,
  automatic,
  library,
  busy,
  send,
}: {
  client: BoardClient;
  /** The `schedule` setting. */
  id: string;
  today: LocalDate;
  minute: number;
  schedules: Entry[] | null;
  legacySchedules: Entry[] | null;
  schedulesV2: Entry[] | null;
  scheduleNames: ReadonlyMap<string, string | null>;
  timed: ReadonlyMap<string, boolean>;
  /** `status.play` while My choice, Schedule plays, else null. */
  play: PlayStatus | null;
  automatic: boolean;
  library: ManifestState;
  busy: boolean;
  send: (changes: SettingsChanges, context: string) => Promise<void>;
}) {
  const source = useScheduleSource(client, legacySchedules, schedulesV2, library, id);
  const absent = schedules !== null && !scheduleNames.has(id);
  const label = (entry: Entry): string =>
    `${entry.name ? `${entry.id}: ${entry.name}` : entry.id} (${timed.get(timedKey(entry)) ? "timed" : "all day"})`;

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm" data-testid="my-schedule">
      {automatic && (
        <p className="text-xs text-muted-foreground">
          Automatic is on. Choosing a schedule here switches to My choice.
        </p>
      )}
      <Field label="Schedule">
        {(control) => (
          <Select
            {...control}
            value={id}
            disabled={busy || schedules === null || schedules.length === 0}
            onChange={(e) =>
              // The schedule alone keeps the choice that plays; from Automatic it also chooses Schedule.
              void send(
                automatic ? { schedule: e.target.value, play: "schedule" } : { schedule: e.target.value },
                "Choosing the schedule",
              )
            }
          >
            {(schedules === null || absent) && <option value={id}>{absent ? `${id} (not stored)` : id}</option>}
            {(schedules ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {label(entry)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {absent && (
        <Alert variant="warning" data-testid="my-schedule-missing">
          <AlertDescription className="text-foreground">
            The schedule <code>{id}</code> is not stored, so the board plays {ownRule(scheduleNames)} while it is
            chosen.
          </AlertDescription>
        </Alert>
      )}
      <ScheduleDetails prefix="my-schedule" id={id} source={source} today={today} minute={minute} status={play} />
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
  // The stored playlist IDs, or null while they are not known.
  const stored: ReadonlySet<string> | null = playlists ? new Set(playlists.keys()) : null;
  const missing = stored ? order.filter((id) => !stored.has(id)) : [];
  const unused = stored ? [...stored].filter((id) => !order.includes(id)) : [];
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
    const sent = stored && listToSend(next, stored);
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
  const keyOf = (id: string, role: RowButton): string => `${id}:${role}`;
  const button = (id: string, role: RowButton) => focus.ref(keyOf(id, role));
  const moveWithButton = (id: string, index: number, by: -1 | 1): void => {
    reorder.moveBy(id, by);
    // The button that moved the item keeps the focus, unless the item reached the top or the bottom: that button is
    // then disabled, and the other move button takes the focus.
    const same: RowButton = by === -1 ? "up" : "down";
    const opposite: RowButton = by === -1 ? "down" : "up";
    const to = index + by;
    const reachedEdge = to === 0 || to === order.length - 1;
    const role = reachedEdge ? opposite : same;
    focus.focusLater(keyOf(id, role));
  };
  const remove = (id: string, index: number): void => {
    const rest = order.filter((other) => other !== id);
    setAnnouncement(`${id} removed.`);
    const after = rest[index] ?? rest[index - 1];
    focus.focusLater(after ? keyOf(after, "remove") : null);
    void apply(rest, `Removing ${id} from your playlists`);
  };

  const cannotEdit = editReason(order, stored);
  const cannotAdd = addReason(order, stored);

  return (
    <div className="flex min-w-0 flex-col gap-3 sm:pl-7" data-testid="my-playlists">
      {automatic && (
        <p className="text-xs text-muted-foreground">
          Automatic is on. This list is kept for when you choose My choice, Playlists, and you can change it meanwhile.
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
            absent={stored !== null && !stored.has(id)}
            busy={busy}
            cannotEdit={cannotEdit}
            cannotRemove={removeReason(order, id, stored)}
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
