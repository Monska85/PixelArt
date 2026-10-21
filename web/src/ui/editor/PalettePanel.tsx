import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  HEX_PATTERN,
  addColor,
  colorNameProblem,
  countColorUses,
  deleteColor,
  paletteEntries,
  renameColor,
  setColorHex,
  uniqueName,
  type Doc,
} from "../../editor/doc";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Button } from "../components/button";
import { cn } from "../components/cn";
import { IconButton } from "../components/icon-button";
import { Input } from "../components/input";
import { EditorCard, Hint } from "./EditorCard";
import { Swatch, TextField } from "./Fields";
import type { Edit } from "./types";

interface Props {
  doc: Doc;
  edit: Edit;
  current: string;
  onCurrent: (ref: string) => void;
}

export function PalettePanel({ doc, edit, current, onCurrent }: Props) {
  const entries = paletteEntries(doc);
  const [deleting, setDeleting] = useState<string | null>(null);
  const uses = deleting ? countColorUses(doc, deleting) : 0;

  const remove = (name: string): void => {
    setDeleting(null);
    edit((d) => deleteColor(d, name));
    if (current === name) onCurrent(entries.find((e) => e.name !== name)?.hex ?? "#ffffff");
  };

  return (
    <EditorCard
      id="palette"
      title="Palette"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const name = uniqueName(
              "color",
              entries.map((e) => e.name),
            );
            edit((d) => addColor(d, name, "#ffffff"));
          }}
        >
          <Plus aria-hidden="true" />
          Add color
        </Button>
      }
    >
      {entries.length === 0 && <Hint>No named colors. Hex values still work.</Hint>}
      <ul className="flex flex-col divide-y divide-border">
        {entries.map(({ name, hex }) => (
          <li key={name} className="flex flex-wrap items-center gap-2 py-2" data-testid={`palette-${name}`}>
            <button
              type="button"
              aria-pressed={current === name}
              aria-label={`Draw with ${name}`}
              className={cn(
                "rounded-md border-2 p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                current === name ? "border-primary" : "border-transparent",
              )}
              onClick={() => onCurrent(name)}
            >
              <Swatch doc={doc} color={name} />
            </button>
            <TextField
              label={`Name of ${name}`}
              hideLabel
              value={name}
              maxLength={32}
              className="w-36"
              validate={(value) => colorNameProblem(doc, value, name)}
              onCommit={(value) => {
                edit((d) => renameColor(d, name, value));
                if (current === name) onCurrent(value);
              }}
            />
            <TextField
              label={`Hex value of ${name}`}
              hideLabel
              value={hex}
              maxLength={7}
              className="w-28"
              validate={(value) => (HEX_PATTERN.test(value) ? null : "A #rrggbb value.")}
              onCommit={(value) => edit((d) => setColorHex(d, name, value))}
            />
            <Input
              type="color"
              aria-label={`Color picker of ${name}`}
              value={HEX_PATTERN.test(hex) ? hex.toLowerCase() : "#000000"}
              onChange={(e) => edit((d) => setColorHex(d, name, e.target.value), `color:${name}`)}
            />
            <IconButton
              label={`Delete ${name}`}
              tooltip="Delete color"
              icon={Trash2}
              className="ml-auto text-destructive"
              onClick={() => setDeleting(name)}
            />
          </li>
        ))}
      </ul>
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting}?`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        >
          <p>
            {uses === 0
              ? `The color ${deleting} is not used.`
              : `The color ${deleting} is used ${uses} time${uses === 1 ? "" : "s"}. Each use becomes its hex value.`}
          </p>
        </ConfirmDialog>
      )}
    </EditorCard>
  );
}
