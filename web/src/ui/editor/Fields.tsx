// Form fields of the editor. Text and numbers commit when the user leaves the
// field or presses Enter, so a half-typed value never reaches the document.

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { MAX_COORD, MIN_COORD, asObject, resolveColor, type Doc } from "../../editor/doc";
import { Field } from "../common/Field";
import { cn } from "../components/cn";
import { Input, Textarea } from "../components/input";

/** Text being typed in a field. It starts again from `value` whenever the value changes from outside. */
function useDraft(value: string): [string, (draft: string) => void] {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

const commitOnEnter = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
  if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) event.currentTarget.blur();
};

interface TextProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  /** Returns a message when the text cannot be used. */
  validate?: (value: string) => string | null;
  /** Muted text under the field; a problem replaces it. */
  hint?: ReactNode;
  maxLength?: number;
  multiline?: boolean;
  hideLabel?: boolean;
  testId?: string;
  className?: string;
}

export function TextField({
  label,
  value,
  onCommit,
  validate,
  hint,
  maxLength,
  multiline,
  hideLabel,
  testId,
  className,
}: TextProps) {
  const [draft, setDraft] = useDraft(value);
  const problem = draft !== value && validate ? validate(draft) : null;
  const commit = (): void => {
    if (draft === value) return;
    if (problem) setDraft(value);
    else onCommit(draft);
  };
  return (
    <Field label={label} hint={hint} error={problem} hideLabel={hideLabel} className={className}>
      {(control) => {
        const common = {
          ...control,
          value: draft,
          maxLength,
          "data-testid": testId,
          onBlur: commit,
          onKeyDown: commitOnEnter,
        };
        return multiline ? (
          <Textarea {...common} rows={3} onChange={(e) => setDraft(e.target.value)} />
        ) : (
          <Input {...common} onChange={(e) => setDraft(e.target.value)} />
        );
      }}
    </Field>
  );
}

interface NumberProps {
  label: string;
  value: number | null;
  /** Called with the new whole number, or null when the field was emptied (only if `optional`). */
  onCommit: (value: number | null) => void;
  min: number;
  max: number;
  optional?: boolean;
  /** An example of a value, shown only while the field is empty. */
  placeholder?: string;
  hint?: ReactNode;
  hideLabel?: boolean;
  testId?: string;
  className?: string;
}

function parseWhole(text: string, min: number, max: number): number | null {
  if (!/^\s*[+-]?\d+(\.\d+)?\s*$/.test(text)) return null;
  return Math.max(min, Math.min(max, Math.round(Number(text))));
}

export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  optional,
  placeholder,
  hint,
  hideLabel,
  testId,
  className,
}: NumberProps) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useDraft(shown);
  const commit = (): void => {
    if (draft === shown) return;
    if (draft.trim() === "" && optional) return onCommit(null);
    const parsed = parseWhole(draft, min, max);
    if (parsed === null) setDraft(shown);
    else onCommit(parsed);
  };
  return (
    <Field
      label={label}
      hint={hint ?? `${min} to ${max.toLocaleString("en-US")}`}
      hideLabel={hideLabel}
      className={className}
    >
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          placeholder={placeholder}
          data-testid={testId}
          className="w-28 max-w-full"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={commitOnEnter}
        />
      )}
    </Field>
  );
}

interface PosProps {
  label: string;
  value: { x: number; y: number } | null;
  onChange: (value: { x: number; y: number } | null) => void;
  testId?: string;
}

/** A pair of coordinates, or none. Emptying both fields removes the value. */
export function PosField({ label, value, onChange, testId }: PosProps) {
  const id = useId();
  const [x, setX] = useDraft(value ? String(value.x) : "");
  const [y, setY] = useDraft(value ? String(value.y) : "");
  const commit = (): void => {
    if (x.trim() === "" && y.trim() === "") return value === null ? undefined : onChange(null);
    const nx = parseWhole(x.trim() === "" ? "0" : x, MIN_COORD, MAX_COORD);
    const ny = parseWhole(y.trim() === "" ? "0" : y, MIN_COORD, MAX_COORD);
    if (nx === null || ny === null) {
      setX(value ? String(value.x) : "");
      setY(value ? String(value.y) : "");
    } else if (!value || value.x !== nx || value.y !== ny) onChange({ x: nx, y: ny });
  };
  const input = (axis: string, text: string, set: (v: string) => void) => (
    <Input
      type="number"
      min={MIN_COORD}
      max={MAX_COORD}
      step={1}
      aria-label={`${label} ${axis}`}
      placeholder={axis}
      data-testid={testId ? `${testId}-${axis}` : undefined}
      value={text}
      className="w-20"
      onChange={(e) => set(e.target.value)}
      onBlur={commit}
      onKeyDown={commitOnEnter}
    />
  );
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-labelledby={id}>
      <span id={id} className="text-sm font-medium leading-none">
        {label}
      </span>
      <span className="flex items-center gap-2">
        {input("x", x, setX)}
        {input("y", y, setY)}
      </span>
    </div>
  );
}

export function Swatch({ doc, color }: { doc: Doc; color: string }) {
  const hex = resolveColor(doc, color);
  return (
    <span
      className={cn(
        "inline-block size-6 shrink-0 rounded border border-input",
        hex === null && "bg-[repeating-linear-gradient(45deg,var(--border)_0_4px,transparent_4px_8px)]",
      )}
      style={hex ? { background: hex } : undefined}
      data-unknown={hex === null}
    />
  );
}

interface ColorProps {
  doc: Doc;
  label: string;
  value: string;
  /** `picker` is true while the value comes from the color picker, which reports every step of a drag. */
  onCommit: (value: string, picker: boolean) => void;
  optional?: boolean;
  testId?: string;
}

const COLOR_HINT = "A palette name or a #rrggbb value.";

/** A color: a palette name or a hex value typed in, or picked with the color picker. */
export function ColorField({ doc, label, value, onCommit, optional, testId }: ColorProps) {
  const [draft, setDraft] = useDraft(value);
  const listId = useId();
  const hex = resolveColor(doc, value);
  const names = [...(asObject(doc.get("palette"))?.keys() ?? [])];
  const problem =
    draft === value || (optional && draft === "") || resolveColor(doc, draft) !== null ? null : COLOR_HINT;
  const commit = (): void => {
    if (draft === value) return;
    if (problem) setDraft(value);
    else onCommit(draft, false);
  };
  return (
    <Field label={label} error={problem} hint={COLOR_HINT}>
      {(control) => (
        <span className="flex items-center gap-2">
          <Swatch doc={doc} color={value} />
          <Input
            {...control}
            list={listId}
            value={draft}
            maxLength={32}
            data-testid={testId}
            className="w-36 font-mono"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={commitOnEnter}
          />
          <datalist id={listId}>
            {names.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <Input
            type="color"
            aria-label={`${label}, color picker`}
            value={hex ?? "#000000"}
            onChange={(e) => onCommit(e.target.value, true)}
          />
        </span>
      )}
    </Field>
  );
}
