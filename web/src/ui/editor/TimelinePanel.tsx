// SPDX-License-Identifier: GPL-3.0-or-later

import { memo } from "react";
import {
  addFrame,
  addLoop,
  addShowEntry,
  deleteItem,
  duplicateItem,
  isLoop,
  itemAt,
  moveItem,
  moveShowEntry,
  paletteEntries,
  readRecolor,
  readShow,
  removeShowEntry,
  setItemNumber,
  setRecolor,
  setShowField,
  spriteNames,
  unwrapLoop,
  wrapInLoop,
  asList,
  asNumber,
  type Doc,
  type Path,
  type RefKey,
} from "../../editor/doc";
import { isObject, type JsonObject, type JsonValue } from "../../engine";
import { ArrowDown, ArrowUp, Copy, Plus, Repeat, Trash2, Undo2 } from "lucide-react";
import { Field } from "../common/Field";
import { Button } from "../components/button";
import { Checkbox } from "../components/checkbox";
import { cn } from "../components/cn";
import { IconButton } from "../components/icon-button";
import { Label } from "../components/label";
import { Select } from "../components/select";
import { ButtonRow, EditorCard, Hint, ReorderButtons, SpriteSelect, type Edit } from "./EditorCard";
import { ColorField, NumberField, PosField } from "./Fields";

interface Props {
  doc: Doc;
  edit: Edit;
  selected: Path | null;
  onSelect: (path: Path | null) => void;
}

const keyOf = (path: Path): string => path.join(".");
const label = (path: Path): string => path.map((i) => i + 1).join(".");

function summary(item: JsonObject): string {
  if (isLoop(item)) return `Loop x${asNumber(item.get("loop")) ?? "?"}`;
  const names = readShow(item)
    .map((r) => r.sprite)
    .join(", ");
  const ms = asNumber(item.get("ms"));
  const repeat = asNumber(item.get("repeat"));
  return `Frame: ${names === "" ? "background only" : names}${ms === null ? "" : `, ${ms} ms`}${repeat === null || repeat === 1 ? "" : `, x${repeat}`}`;
}

interface NodeProps {
  item: JsonValue;
  path: Path;
  selectedKey: string | null;
  onSelect: (path: Path) => void;
}

const Node = memo(
  function Node({ item, path, selectedKey, onSelect }: NodeProps) {
    const map = isObject(item) ? item : null;
    const key = keyOf(path);
    const steps = map ? asList(map.get("steps")) : undefined;
    return (
      <li>
        <button
          type="button"
          className={cn(
            "my-0.5 flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            selectedKey === key
              ? "border-primary bg-primary text-primary-foreground"
              : "border-transparent hover:bg-accent hover:text-accent-foreground",
          )}
          aria-current={selectedKey === key ? "true" : undefined}
          data-testid={`item-${key}`}
          onClick={() => onSelect(path)}
        >
          <span className={cn("tabular-nums", selectedKey !== key && "text-muted-foreground")}>{label(path)}</span>
          <span className="min-w-0 break-words">{map ? summary(map) : "Not an item"}</span>
        </button>
        {steps && (
          <ol className="ml-3 border-l-2 border-border pl-3">
            {steps.map((child, i) => (
              <Node key={i} item={child} path={[...path, i]} selectedKey={selectedKey} onSelect={onSelect} />
            ))}
          </ol>
        )}
      </li>
    );
  },
  (a, b) =>
    a.item === b.item &&
    keyOf(a.path) === keyOf(b.path) &&
    a.onSelect === b.onSelect &&
    // Only the nodes on the way to the selection change with it.
    (a.selectedKey === b.selectedKey ||
      (!touches(a.selectedKey, keyOf(a.path)) && !touches(b.selectedKey, keyOf(b.path)))),
);

// True when the selection is this node or inside it.
function touches(selected: string | null, key: string): boolean {
  return selected !== null && (selected === key || selected.startsWith(`${key}.`));
}

export function TimelinePanel({ doc, edit, selected, onSelect }: Props) {
  const timeline = asList(doc.get("timeline")) ?? [];
  const item = selected ? itemAt(doc, selected) : undefined;
  const selectedKey = item && selected ? keyOf(selected) : null;

  const parent = (): Path => (selected && item ? selected.slice(0, -1) : []);
  const after = (): number | undefined => (selected && item ? selected[selected.length - 1] : undefined);
  const run = (op: (d: Doc) => { doc: Doc; path: Path }): void => {
    let path: Path = [];
    edit((d) => {
      const result = op(d);
      path = result.path;
      return result.doc;
    });
    onSelect(path);
  };

  return (
    <EditorCard id="timeline" title="Timeline">
      {timeline.length === 0 && <Hint>The timeline is empty.</Hint>}
      <ol className="flex flex-col" data-testid="timeline">
        {timeline.map((child, i) => (
          <Node key={i} item={child} path={[i]} selectedKey={selectedKey} onSelect={onSelect} />
        ))}
      </ol>
      <ButtonRow>
        <Button variant="outline" onClick={() => run((d) => addFrame(d, parent(), after()))}>
          <Plus aria-hidden="true" />
          Add frame
        </Button>
        <Button variant="outline" onClick={() => run((d) => addLoop(d, parent(), after()))}>
          <Repeat aria-hidden="true" />
          Add loop
        </Button>
        {item && selected && isLoop(item) && (
          <Button variant="outline" onClick={() => run((d) => addFrame(d, selected))}>
            Add frame inside the loop
          </Button>
        )}
      </ButtonRow>
      {item && selected && (
        <>
          <ButtonRow label="Selected item">
            <Button variant="outline" size="sm" onClick={() => run((d) => duplicateItem(d, selected))}>
              <Copy aria-hidden="true" />
              Duplicate
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => run((d) => moveItem(d, selected, -1))}
              disabled={selected[selected.length - 1] === 0}
            >
              <ArrowUp aria-hidden="true" />
              Move up
            </Button>
            <Button variant="outline" size="sm" onClick={() => run((d) => moveItem(d, selected, 1))}>
              <ArrowDown aria-hidden="true" />
              Move down
            </Button>
            <Button variant="outline" size="sm" onClick={() => edit((d) => wrapInLoop(d, selected))}>
              Wrap in a loop
            </Button>
            {isLoop(item) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  edit((d) => unwrapLoop(d, selected));
                  onSelect(null);
                }}
              >
                <Undo2 aria-hidden="true" />
                Unwrap loop
              </Button>
            )}
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={() => {
                edit((d) => deleteItem(d, selected));
                onSelect(null);
              }}
            >
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </ButtonRow>
          <ItemForm key={keyOf(selected)} doc={doc} edit={edit} path={selected} item={item} />
        </>
      )}
    </EditorCard>
  );
}

const ANGLES = [-270, -180, -90, 0, 90, 180, 270];

function ItemForm({ doc, edit, path, item }: { doc: Doc; edit: Edit; path: Path; item: JsonObject }) {
  const number = (key: string): number | null => asNumber(item.get(key));
  if (isLoop(item))
    return (
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Loop {label(path)}</legend>
        <NumberField
          label="Repetitions"
          value={number("loop")}
          min={1}
          max={10000}
          onCommit={(value) => edit((d) => setItemNumber(d, path, "loop", value ?? 1))}
        />
      </fieldset>
    );

  const shown = readShow(item);
  const sprites = spriteNames(doc);
  const pairs = readRecolor(item);
  const recolor = (next: Array<[string, string]>): void => edit((d) => setRecolor(d, path, next));
  const palette = paletteEntries(doc);
  const unusedFrom = palette.find((p) => !pairs.some(([from]) => from === p.name))?.name;

  const field = (
    index: number,
    key: "sprite" | RefKey,
    value: string | number | boolean | { x: number; y: number } | null,
  ) => edit((d) => setShowField(d, path, index, key, value));

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-border p-3" data-testid="frame-form">
      <legend className="px-1 text-sm font-medium">Frame {label(path)}</legend>
      <div className="flex flex-wrap gap-4">
        <NumberField
          label="Duration (ms)"
          value={number("ms")}
          min={20}
          max={60000}
          optional
          placeholder="frame_ms"
          hint="Empty uses the animation's frame duration."
          testId="frame-ms"
          onCommit={(value) => edit((d) => setItemNumber(d, path, "ms", value))}
        />
        <NumberField
          label="Repeat"
          value={number("repeat")}
          min={1}
          max={10000}
          optional
          placeholder="1"
          hint="Empty means 1."
          testId="frame-repeat"
          onCommit={(value) => edit((d) => setItemNumber(d, path, "repeat", value))}
        />
      </div>

      <h4 className="font-medium">Sprites shown, bottom to top</h4>
      {shown.length === 0 && <Hint>Only the background is shown.</Hint>}
      <ol className="flex flex-col gap-3">
        {shown.map((ref, index) => (
          <li
            key={index}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
            data-testid={`show-${index}`}
          >
            <Field label="Sprite" className="min-w-36">
              {(control) => (
                <SpriteSelect
                  control={control}
                  value={ref.sprite}
                  names={sprites}
                  onChange={(e) => field(index, "sprite", e.target.value)}
                />
              )}
            </Field>
            <PosField label="At" value={ref.at} testId={`show-${index}-at`} onChange={(v) => field(index, "at", v)} />
            <PosField
              label="Move"
              value={ref.move}
              testId={`show-${index}-move`}
              onChange={(v) => field(index, "move", v)}
            />
            <div className="flex h-9 items-center gap-2">
              <Checkbox
                id={`show-${index}-wrap`}
                checked={ref.wrap === true}
                onCheckedChange={(checked) => field(index, "wrap", checked === true ? true : null)}
              />
              <Label htmlFor={`show-${index}-wrap`}>Wrap</Label>
            </div>
            {(["rotate", "spin"] as const).map((key) => (
              <Field key={key} label={key === "rotate" ? "Rotate" : "Spin"} className="min-w-32">
                {(control) => (
                  <Select
                    {...control}
                    value={ref[key] === null ? "" : String(ref[key])}
                    onChange={(e) => field(index, key, e.target.value === "" ? null : Number(e.target.value))}
                  >
                    <option value="">none</option>
                    {ANGLES.map((a) => (
                      <option key={a} value={a}>
                        {a} degrees
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
            <Field label="Flip" className="min-w-36">
              {(control) => (
                <Select
                  {...control}
                  value={ref.flip ?? ""}
                  onChange={(e) => field(index, "flip", e.target.value === "" ? null : e.target.value)}
                >
                  <option value="">none</option>
                  <option value="x">x (left and right)</option>
                  <option value="y">y (top and bottom)</option>
                  <option value="xy">x and y</option>
                </Select>
              )}
            </Field>
            <PosField
              label="Pivot"
              value={ref.pivot}
              testId={`show-${index}-pivot`}
              onChange={(v) => field(index, "pivot", v)}
            />
            <ReorderButtons
              noun="entry"
              index={index}
              count={shown.length}
              onMove={(delta) => edit((d) => moveShowEntry(d, path, index, delta))}
              onRemove={() => edit((d) => removeShowEntry(d, path, index))}
            />
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="outline"
          disabled={sprites.length === 0}
          onClick={() => edit((d) => addShowEntry(d, path, sprites[0] as string))}
        >
          <Plus aria-hidden="true" />
          Add sprite to the frame
        </Button>
      </div>

      <h4 className="font-medium">Recolor</h4>
      {pairs.length === 0 && <Hint>No colors are replaced in this frame.</Hint>}
      <ul className="flex flex-col gap-3">
        {pairs.map(([from, to], index) => (
          <li key={index} className="flex flex-wrap items-end gap-3" data-testid={`recolor-${index}`}>
            <ColorField
              doc={doc}
              label={`Replace color ${index + 1}`}
              value={from}
              onCommit={(value) => recolor(pairs.map((p, i): [string, string] => (i === index ? [value, p[1]] : p)))}
            />
            <ColorField
              doc={doc}
              label={`With color ${index + 1}`}
              value={to}
              onCommit={(value) => recolor(pairs.map((p, i): [string, string] => (i === index ? [p[0], value] : p)))}
            />
            <IconButton
              label={`Remove pair ${index + 1}`}
              tooltip="Remove"
              icon={Trash2}
              className="text-destructive"
              onClick={() => recolor(pairs.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>
      <div>
        <Button
          variant="outline"
          disabled={unusedFrom === undefined}
          onClick={() =>
            recolor([
              ...pairs,
              [unusedFrom as string, palette.find((p) => p.name !== unusedFrom)?.name ?? (unusedFrom as string)],
            ])
          }
        >
          <Plus aria-hidden="true" />
          Add recolor pair
        </Button>
      </div>
    </fieldset>
  );
}
