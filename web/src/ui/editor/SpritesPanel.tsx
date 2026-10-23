import { Copy, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  addCompositeSprite,
  addPointsSprite,
  countSpriteUses,
  deleteSprite,
  duplicateSprite,
  isComposite,
  renameSprite,
  spriteNameProblem,
  spriteNames,
  spriteOf,
  uniqueName,
  type Doc,
} from "../../editor/doc";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { EditorCard, ButtonRow, type Edit } from "./EditorCard";
import { TextField } from "./Fields";
import { plural } from "../format";

interface Props {
  doc: Doc;
  edit: Edit;
  selected: string | null;
  onSelect: (name: string | null) => void;
}

export function SpritesPanel({ doc, edit, selected, onSelect }: Props) {
  const names = spriteNames(doc);
  const [deleting, setDeleting] = useState<string | null>(null);
  const uses = deleting ? countSpriteUses(doc, deleting) : 0;

  const add = (composite: boolean): void => {
    const name = uniqueName(composite ? "composite" : "sprite", names);
    edit((d) => (composite ? addCompositeSprite(d, name) : addPointsSprite(d, name)));
    onSelect(name);
  };
  const remove = (name: string): void => {
    setDeleting(null);
    edit((d) => deleteSprite(d, name));
    onSelect(names.find((n) => n !== name) ?? null);
  };

  return (
    <EditorCard
      id="sprites"
      title="Sprites"
      actions={
        <ButtonRow>
          <Button variant="outline" size="sm" onClick={() => add(false)}>
            <Plus aria-hidden="true" />
            Add points sprite
          </Button>
          <Button variant="outline" size="sm" onClick={() => add(true)}>
            <Plus aria-hidden="true" />
            Add composite sprite
          </Button>
        </ButtonRow>
      }
    >
      <ul className="flex flex-wrap gap-2">
        {names.map((name) => (
          <li key={name}>
            <Button
              variant={name === selected ? "default" : "outline"}
              aria-pressed={name === selected}
              data-testid={`sprite-${name}`}
              onClick={() => onSelect(name)}
            >
              {name}
              <Badge variant={name === selected ? "outline" : "default"} className="text-current">
                {isComposite(spriteOf(doc, name)) ? "composite" : "points"}
              </Badge>
            </Button>
          </li>
        ))}
      </ul>
      {selected && spriteOf(doc, selected) && (
        <>
          <TextField
            label={`Name of the sprite ${selected}`}
            value={selected}
            maxLength={32}
            className="max-w-sm"
            validate={(value) => spriteNameProblem(doc, value, selected)}
            onCommit={(value) => {
              edit((d) => renameSprite(d, selected, value));
              onSelect(value);
            }}
          />
          <ButtonRow>
            <Button
              variant="outline"
              onClick={() => {
                const copy = duplicateSprite(doc, selected);
                edit(() => copy.doc);
                onSelect(copy.name);
              }}
            >
              <Copy aria-hidden="true" />
              Duplicate sprite
            </Button>
            <Button
              variant="destructive-outline"
              onClick={() => (countSpriteUses(doc, selected) > 0 ? setDeleting(selected) : remove(selected))}
            >
              <Trash2 aria-hidden="true" />
              Delete sprite
            </Button>
          </ButtonRow>
        </>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting}?`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => remove(deleting)}
        >
          <p>
            The sprite {deleting} is used {plural(uses, "time")} in frames and composite sprites. Those entries are
            removed too.
          </p>
        </ConfirmDialog>
      )}
    </EditorCard>
  );
}
