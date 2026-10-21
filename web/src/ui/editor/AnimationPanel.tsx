import { setTopField, type Doc } from "../../editor/doc";
import { JsonNumber } from "../../engine/json";
import { EditorCard } from "./EditorCard";
import { ColorField, NumberField, TextField } from "./Fields";
import type { Edit } from "./types";

const text = (doc: Doc, key: string): string => {
  const value = doc.get(key);
  return typeof value === "string" ? value : "";
};
const number = (doc: Doc, key: string): number | null => {
  const value = doc.get(key);
  return value instanceof JsonNumber ? value.value : null;
};

/** The animation's own fields. Its name is in the editor header. */
export function AnimationPanel({ doc, edit }: { doc: Doc; edit: Edit }) {
  const optionalText = (key: string) => (value: string) =>
    edit((d) => setTopField(d, key, value === "" ? null : value));
  const optionalNumber = (key: string, fallback?: number) => (value: number | null) =>
    edit((d) =>
      setTopField(
        d,
        key,
        value === null ? null : JsonNumber.int(value),
        fallback === undefined ? undefined : JsonNumber.int(fallback),
      ),
    );
  const background = doc.get("background");
  return (
    <EditorCard id="animation" title="Animation">
      <div className="flex flex-wrap gap-4">
        <NumberField
          label="Version"
          value={number(doc, "version")}
          min={1}
          max={2147483647}
          optional
          placeholder="1"
          hint="Empty means 1."
          onCommit={optionalNumber("version", 1)}
        />
        <NumberField
          label="Frame duration (ms)"
          value={number(doc, "frame_ms")}
          min={20}
          max={60000}
          optional
          placeholder="500"
          hint="Empty means 500."
          onCommit={optionalNumber("frame_ms", 500)}
        />
        <NumberField
          label="Brightness (1 to 100)"
          value={number(doc, "brightness")}
          min={1}
          max={100}
          optional
          placeholder="100"
          hint="Percent of the board's setting. Empty means 100."
          onCommit={optionalNumber("brightness", 100)}
        />
      </div>
      <TextField label="Author" value={text(doc, "author")} maxLength={128} onCommit={optionalText("author")} />
      <TextField
        label="Description"
        value={text(doc, "description")}
        maxLength={512}
        multiline
        onCommit={optionalText("description")}
      />
      <ColorField
        doc={doc}
        label="Background"
        value={typeof background === "string" ? background : ""}
        optional
        onCommit={(value, picker) =>
          edit((d) => setTopField(d, "background", value === "" ? null : value), picker ? "background" : undefined)
        }
      />
    </EditorCard>
  );
}
