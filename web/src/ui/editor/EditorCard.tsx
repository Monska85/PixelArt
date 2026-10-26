// SPDX-License-Identifier: GPL-3.0-or-later

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import type { Doc } from "../../editor/doc";
import type { FieldControlProps } from "../common/Field";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { IconButton } from "../components/icon-button";
import { Select } from "../components/select";

/** Applies a change to the document. Changes with the same `group` in a row are one undo step. */
export type Edit = (change: (doc: Doc) => Doc, group?: string) => void;

interface Props {
  /** Makes the card a labelled region: `${id}-title` names it. */
  id: string;
  title: string;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
}

/** One card of the editor, in the app's one card style. */
export function EditorCard({ id, title, actions, children }: Props) {
  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle id={`${id}-title`}>{title}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function ButtonRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

export function Hint({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  );
}

/** A sprite picker. A name that is not a sprite (the file names a missing one) stays listed, so it can be seen. */
export function SpriteSelect({
  control,
  value,
  names,
  onChange,
}: {
  control: FieldControlProps;
  value: string;
  names: string[];
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <Select {...control} value={value} onChange={onChange}>
      {!names.includes(value) && <option value={value}>{value}</option>}
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </Select>
  );
}

/** Move up, Move down and Remove for item `index` of `count`, named "<noun> <index + 1>". */
export function ReorderButtons({
  noun,
  index,
  count,
  onMove,
  onRemove,
}: {
  noun: string;
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <span className="ml-auto flex items-center gap-1">
      <IconButton
        label={`Move up ${noun} ${index + 1}`}
        tooltip="Move up"
        icon={ArrowUp}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      />
      <IconButton
        label={`Move down ${noun} ${index + 1}`}
        tooltip="Move down"
        icon={ArrowDown}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
      />
      <IconButton
        label={`Remove ${noun} ${index + 1}`}
        tooltip="Remove"
        icon={Trash2}
        className="text-destructive"
        onClick={onRemove}
      />
    </span>
  );
}
