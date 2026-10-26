// SPDX-License-Identifier: GPL-3.0-or-later

import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isValidId, loadPlaylist, MAX_PLAYLIST_REPEAT } from "../../engine";
import { sha256Hex, UploadCancelled, type BoardClient } from "../../protocol";
import type { QueueFile } from "../../queue/plan";
import { jsonBytes } from "../../yaml/writeJson";
import { DiagnosticsTable, type ShownDiagnostic } from "../common/DiagnosticsTable";
import { toShownError, type ShownError } from "../errors";
import { Field } from "../common/Field";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { cn } from "../components/cn";
import { IconButton } from "../components/icon-button";
import { Input } from "../components/input";
import { Label } from "../components/label";
import { Select } from "../components/select";
import { WidePanel } from "../components/sheet";
import { Switch } from "../components/switch";
import { toast } from "../components/toast";
import { formatSize, plural } from "../format";
import { session } from "../session";
import { singleFileResult } from "../queue/summary";
import { blockedOrBusy } from "../upload";
import { useUploadQueue } from "../queue/useUploadQueue";
import { InstallAnimation, type MissingContext } from "./MissingAnimations";
import { contentKey, documentFromModel, newItemKey, type EditorItem, type PlaylistModel } from "./playlistModel";
import { useReorder } from "./useReorder";
import { ID_RULE } from "../common/UploadDialogs";

/** The repeat a typed text stands for: a whole number from 1 to 1000, or null. */
function parseRepeat(text: string): number | null {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_PLAYLIST_REPEAT ? n : null;
}

/** A number field that can be emptied while typing: only a valid repeat reaches the model. */
function RepeatField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  // The model can change the value from outside (Up and Down move items between fields): when it does, show it,
  // unless the text already stands for it. This runs during rendering on purpose, so no stale text is ever painted.
  if (seen !== value) {
    setSeen(value);
    if (parseRepeat(text) !== value) setText(String(value));
  }
  const invalid = parseRepeat(text) === null;
  return (
    <Field
      label="Repeat"
      className="w-24"
      error={invalid ? `Whole number from 1 to ${MAX_PLAYLIST_REPEAT.toLocaleString("en-US")}.` : null}
    >
      {(control) => (
        <Input
          {...control}
          type="number"
          aria-label={label}
          min={1}
          max={MAX_PLAYLIST_REPEAT}
          step={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseRepeat(e.target.value);
            if (n !== null) onChange(n);
          }}
          onBlur={() => setText(String(value))}
        />
      )}
    </Field>
  );
}

/** The warnings the board gives for items whose animation it does not store. */
function unknownAnimationWarnings(model: PlaylistModel, stored: ReadonlySet<string>): ShownDiagnostic[] {
  const names = new Set(model.items.map((i) => i.animation).filter((a) => a !== "" && !stored.has(a)));
  return [...names].map((name) => ({
    severity: "warning",
    code: "unknown_animation",
    where: "",
    message: `"${name}" is not stored`,
  }));
}

interface Props {
  client: BoardClient;
  model: PlaylistModel;
  /** The IDs of the stored animations, or null while they are not known: nothing is then marked as not stored. */
  storedIds: ReadonlySet<string> | null;
  /** What the Library offers for a missing animation, shared with the playlist rows and Settings. */
  missingContext: MissingContext;
  disabled: boolean;
  /** Reports whether the model differs from the one the editor opened with, and the ID it now holds. */
  onChange: (dirty: boolean, id: string) => void;
  onClose: () => void;
  onSaved: () => void;
  onError: (error: ShownError) => void;
}

/** The per-item buttons that keep a keyboard user's focus when items move or go away. */
type ItemButton = "up" | "down" | "remove";

/** The playlist editor, in a wide panel above the lists (the whole screen on a phone). */
export function PlaylistEditor({
  client,
  model: initial,
  storedIds,
  missingContext,
  disabled,
  onChange,
  onClose,
  onSaved,
  onError,
}: Props) {
  const [model, setModel] = useState(initial);
  // What the board holds, as far as this editor knows: the opened playlist, then the last one saved.
  const [saved, setSaved] = useState(initial);
  const [diagnostics, setDiagnostics] = useState<ShownDiagnostic[]>([]);
  const [saving, setSaving] = useState(false);
  const queue = useUploadQueue({
    client,
    onProblem: (shown) => {
      setDiagnostics(shown.diagnostics);
      onError(shown);
    },
    onFinished: () => void session.refreshInfo(),
  });

  const dirty = contentKey(model) !== contentKey(saved);
  useEffect(() => onChange(dirty, model.id), [dirty, model.id, onChange]);

  const patchItem = (key: number, patch: Partial<EditorItem>): void =>
    setModel((m) => ({ ...m, items: m.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const move = (from: number, to: number): void =>
    setModel((m) => {
      const items = [...m.items];
      const [item] = items.splice(from, 1);
      if (item) items.splice(to, 0, item);
      return { ...m, items };
    });

  // Screen readers hear every move, from the drag handles and from the Up and Down buttons, and every removal.
  const [announcement, setAnnouncement] = useState("");
  const list = useRef<HTMLOListElement>(null);
  const itemName = (key: number): string => {
    const animation = model.items.find((i) => i.key === key)?.animation ?? "";
    return animation === "" ? "The item without an animation" : animation;
  };
  // The Up, Down and Remove buttons of every item. A button that becomes disabled or goes away loses its focus, so
  // after a move to the top or the bottom, and after a removal, focus goes to a button a keyboard user expects.
  const itemButtons = useRef(new Map<string, HTMLButtonElement>());
  const itemButton = (key: number, role: ItemButton) => (element: HTMLButtonElement | null) => {
    if (element) itemButtons.current.set(`${key}:${role}`, element);
    else itemButtons.current.delete(`${key}:${role}`);
  };
  const focusAfterRender = (element: () => HTMLElement | null | undefined): void => {
    requestAnimationFrame(() => element()?.focus());
  };
  const moveWithButton = (key: number, index: number, by: -1 | 1): void => {
    reorder.moveBy(key, by);
    // At the top or the bottom the button that moved the item is disabled: the item's other move button takes focus.
    const to = index + by;
    const atEdge = to === 0 || to === model.items.length - 1;
    const other: ItemButton = by === -1 ? "down" : "up";
    if (atEdge) focusAfterRender(() => itemButtons.current.get(`${key}:${other}`));
  };
  const addButton = useRef<HTMLButtonElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  /**
   * Where focus goes once the item at `index` is removed: the Remove button of the item that takes its place, else of
   * the item before it, else Add animation, or the name when nothing can be added.
   */
  const afterRemoval = (rest: EditorItem[], index: number): HTMLElement | null | undefined => {
    const next = rest[index] ?? rest[index - 1];
    if (next) return itemButtons.current.get(`${next.key}:remove`);
    return addButton.current && !addButton.current.disabled ? addButton.current : nameField.current;
  };
  const remove = (key: number, index: number): void => {
    const rest = model.items.filter((i) => i.key !== key);
    const left = rest.length === 0 ? "No items left" : `${plural(rest.length, "item")} left`;
    setAnnouncement(`${itemName(key)} removed. ${left}.`);
    setModel({ ...model, items: rest });
    focusAfterRender(() => afterRemoval(rest, index));
  };
  const reorder = useReorder({
    list,
    keys: model.items.map((i) => i.key),
    move,
    name: itemName,
    announce: setAnnouncement,
  });
  const add = (): void =>
    setModel((m) => ({
      ...m,
      items: [
        ...m.items,
        {
          key: newItemKey(),
          animation: storedIds?.values().next().value ?? "",
          repeat: 1,
          enabled: true,
          original: null,
        },
      ],
    }));

  const idProblem = model.isNew && !isValidId(model.id);

  async function save(): Promise<void> {
    const bytes = jsonBytes(documentFromModel(model));
    const result = loadPlaylist(bytes);
    setDiagnostics(result.diagnostics);
    if (result.items === null) return;
    const file: QueueFile = {
      kind: "playlist",
      id: model.id,
      bytes,
      sha256: await sha256Hex(bytes),
      origin: "the playlist editor",
    };
    setSaving(true);
    const sent = singleFileResult(
      await queue.uploadPrepared([file], {
        manifest: null,
        acceptMissing: true,
        replaceWithoutAsking: !model.isNew,
        quiet: true,
      }),
      `playlist ${model.id}`,
    );
    setSaving(false);
    if (sent.status === "stored") {
      // The queue skips a playlist the board already stores, so the board says nothing: the warnings are the same.
      const warnings = sent.identical ? (storedIds ? unknownAnimationWarnings(model, storedIds) : []) : sent.warnings;
      setDiagnostics(warnings);
      setSaved(model);
      onSaved();
      toast({
        title: sent.identical ? `The board already has playlist ${model.id}` : `Uploaded playlist ${model.id}`,
        description: formatSize(bytes.length),
      });
      if (warnings.length === 0) onClose();
    } else if (sent.status === "error") {
      setDiagnostics(sent.shown.diagnostics);
      onError(sent.shown);
    } else if (sent.reason === "cancelled") {
      onError(toShownError(`Uploading playlist ${model.id}`, new UploadCancelled()));
    } else {
      // The panel stays open so the user can pick another ID or upload again.
      toast({
        title: sent.reason === "kept" ? `Kept the board's playlist ${model.id}; nothing was sent` : "Nothing was sent",
      });
    }
  }

  return (
    <>
      <WidePanel
        title={model.isNew ? "New playlist" : `Edit playlist ${model.id}`}
        onClose={onClose}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={disabled || queue.busy || idProblem} loading={saving} onClick={() => void save()}>
              Upload to board
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {model.isNew && (
            <Field label="ID" hint={ID_RULE} error={idProblem ? ID_RULE : null}>
              {(control) => (
                <Input
                  {...control}
                  value={model.id}
                  maxLength={64}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                  onChange={(e) => setModel({ ...model, id: e.target.value })}
                />
              )}
            </Field>
          )}
          <Field label="Name">
            {(control) => (
              <Input
                {...control}
                ref={nameField}
                value={model.name}
                maxLength={128}
                onChange={(e) => setModel({ ...model, name: e.target.value })}
              />
            )}
          </Field>
        </div>

        <section aria-label="Items of the playlist, in order" className="flex flex-col gap-3">
          {model.items.length === 0 && <p className="text-sm text-muted-foreground">No animations yet.</p>}
          <p className="sr-only" aria-live="polite" data-testid="reorder-status">
            {announcement}
          </p>
          <ol ref={list} className={cn("flex flex-col gap-3", reorder.moving !== null && "select-none")}>
            {model.items.map((item, index) => {
              const missing = storedIds !== null && item.animation !== "" && !storedIds.has(item.animation);
              const label = `item ${index + 1}`;
              return (
                <li
                  key={item.key}
                  data-testid={`playlist-item-${index + 1}`}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border border-border bg-card p-3",
                    reorder.moving === item.key && "relative z-10 border-primary shadow-md ring-2 ring-primary",
                  )}
                >
                  <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                    {/* A pointer drags the handle; the keyboard moves items with the Up and Down buttons. */}
                    <div className="flex h-9 w-16 shrink-0 items-center gap-1" aria-hidden="true">
                      <span
                        title="Drag to reorder"
                        data-testid={`reorder-handle-${index + 1}`}
                        className="flex size-9 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
                        {...reorder.handleProps(item.key)}
                      >
                        <GripVertical className="size-4" />
                      </span>
                      <span className="w-6 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
                    </div>
                    <Field label="Animation" className="min-w-48 flex-1">
                      {(control) => (
                        <Select
                          {...control}
                          aria-label={`Animation of ${label}`}
                          value={item.animation}
                          onChange={(e) => patchItem(item.key, { animation: e.target.value })}
                        >
                          {(item.animation === "" || missing || storedIds === null) && (
                            <option value={item.animation}>
                              {item.animation === "" ? "(choose)" : item.animation}
                            </option>
                          )}
                          {[...(storedIds ?? [])].map((id) => (
                            <option key={id} value={id}>
                              {id}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <RepeatField
                      label={`Repeat of ${label}`}
                      value={item.repeat}
                      onChange={(repeat) => patchItem(item.key, { repeat })}
                    />
                    <div className="flex h-9 items-center gap-2">
                      <Switch
                        id={`enabled-${item.key}`}
                        aria-label={`Enabled: ${label}`}
                        checked={item.enabled}
                        onCheckedChange={(enabled) => patchItem(item.key, { enabled })}
                      />
                      <Label htmlFor={`enabled-${item.key}`} aria-hidden="true">
                        Enabled
                      </Label>
                    </div>
                    <div className="ml-auto flex h-9 items-center gap-1">
                      <IconButton
                        label={`Up ${label}`}
                        tooltip="Move up"
                        icon={ArrowUp}
                        disabled={index === 0}
                        ref={itemButton(item.key, "up")}
                        onClick={() => moveWithButton(item.key, index, -1)}
                      />
                      <IconButton
                        label={`Down ${label}`}
                        tooltip="Move down"
                        icon={ArrowDown}
                        disabled={index === model.items.length - 1}
                        ref={itemButton(item.key, "down")}
                        onClick={() => moveWithButton(item.key, index, 1)}
                      />
                      <IconButton
                        label={`Remove ${label}`}
                        tooltip="Remove"
                        icon={Trash2}
                        className="text-destructive"
                        ref={itemButton(item.key, "remove")}
                        onClick={() => remove(item.key, index)}
                      />
                    </div>
                  </div>
                  {missing && (
                    // Under the animation field: past the handle and the number (w-16) and the gap (3).
                    <div className="flex flex-wrap items-center gap-2 pl-19">
                      <Badge variant="warning" data-testid={`item-missing-${index + 1}`}>
                        <TriangleAlert aria-hidden="true" />
                        Not stored
                      </Badge>
                      <InstallAnimation
                        animation={item.animation}
                        context={{ ...missingContext, blocked: blockedOrBusy(missingContext.blocked, queue.busy) }}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <div>
            <Button ref={addButton} variant="outline" onClick={add} disabled={!storedIds?.size}>
              <Plus aria-hidden="true" />
              Add animation
            </Button>
          </div>
        </section>
        <p className="text-xs text-muted-foreground">
          An animation the board does not store is kept: the board skips it until the animation exists.
        </p>
        <DiagnosticsTable diagnostics={diagnostics} />
      </WidePanel>

      {queue.dialogs}
    </>
  );
}
