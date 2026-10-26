// SPDX-License-Identifier: GPL-3.0-or-later

import { Plus } from "lucide-react";
import { useState } from "react";
import { addPart, movePart, readParts, removePart, setPart, spriteNames, spriteOf, type Doc } from "../../editor/doc";
import { Field } from "../common/Field";
import { Button } from "../components/button";
import { Select } from "../components/select";
import { EditorCard, Hint, ReorderButtons, SpriteSelect, type Edit } from "./EditorCard";
import { PosField } from "./Fields";

interface Props {
  doc: Doc;
  edit: Edit;
  composite: string;
}

export function PartsPanel({ doc, edit, composite }: Props) {
  const parts = readParts(spriteOf(doc, composite));
  const others = spriteNames(doc).filter((n) => n !== composite);
  const [toAdd, setToAdd] = useState("");
  const chosen = others.includes(toAdd) ? toAdd : (others[0] ?? "");
  return (
    <EditorCard id="parts" title={`Parts of ${composite}`}>
      <Hint>Drawn in order: later parts cover earlier ones. A part's position replaces the sprite's own.</Hint>
      {parts.length === 0 && <Hint>No parts yet.</Hint>}
      <ol className="flex flex-col gap-3">
        {parts.map((part, index) => (
          <li
            key={index}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
            data-testid={`part-${index}`}
          >
            <Field label={`Sprite of part ${index + 1}`} className="min-w-40 flex-1">
              {(control) => (
                <SpriteSelect
                  control={control}
                  value={part.sprite}
                  names={others}
                  onChange={(e) => edit((d) => setPart(d, composite, index, { ...part, sprite: e.target.value }))}
                />
              )}
            </Field>
            <PosField
              label={`Position of part ${index + 1}`}
              value={part.at}
              onChange={(at) => edit((d) => setPart(d, composite, index, { ...part, at }))}
            />
            <ReorderButtons
              noun="part"
              index={index}
              count={parts.length}
              onMove={(delta) => edit((d) => movePart(d, composite, index, delta))}
              onRemove={() => edit((d) => removePart(d, composite, index))}
            />
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Sprite to add" className="min-w-40">
          {(control) => (
            <Select {...control} value={chosen} onChange={(e) => setToAdd(e.target.value)}>
              {others.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button variant="outline" disabled={chosen === ""} onClick={() => edit((d) => addPart(d, composite, chosen))}>
          <Plus aria-hidden="true" />
          Add part
        </Button>
      </div>
    </EditorCard>
  );
}
