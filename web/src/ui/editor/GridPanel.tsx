import { clsx } from "clsx";
import { memo, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  GRID,
  paintCells,
  readPoints,
  readPos,
  resolveColor,
  setSpriteAt,
  setSpritePivot,
  spriteOf,
  type Doc,
} from "../../editor/doc";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { ButtonRow, EditorCard, Hint, type Edit } from "./EditorCard";
import { PosField } from "./Fields";

type Tool = "draw" | "erase" | "pick";

interface Props {
  doc: Doc;
  edit: Edit;
  sprite: string;
  /** The drawing color: a palette name or a hex value. */
  color: string;
  onPick: (ref: string) => void;
}

interface CellProps {
  index: number;
  hex: string | null;
  filled: boolean;
  cursor: boolean;
  origin: boolean;
  pivot: boolean;
}

const Cell = memo(function Cell({ index, hex, filled, cursor, origin, pivot }: CellProps) {
  return (
    <div
      className={clsx("cell", cursor && "is-cursor", origin && "is-origin", pivot && "is-pivot")}
      data-testid={`cell-${index % GRID}-${Math.floor(index / GRID)}`}
      data-color={filled ? (hex ?? "unknown") : "empty"}
      style={filled && hex ? { background: hex } : undefined}
    />
  );
});

const clampCell = (v: number): number => Math.min(GRID - 1, Math.max(0, v));

const cellIndex = (event: PointerEvent<HTMLElement>): number => {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = clampCell(Math.floor(((event.clientX - rect.left) / rect.width) * GRID));
  const y = clampCell(Math.floor(((event.clientY - rect.top) / rect.height) * GRID));
  return y * GRID + x;
};

export function GridPanel({ doc, edit, sprite, color, onPick }: Props) {
  const spriteMap = spriteOf(doc, sprite);
  const view = useMemo(() => readPoints(spriteMap), [spriteMap]);
  const [tool, setTool] = useState<Tool>("draw");
  const [cursor, setCursor] = useState(0);
  // A stroke is painted here while the pointer is down, and committed as one undo step on release.
  const [stroke, setStroke] = useState<Map<number, string | null> | null>(null);
  const strokeRef = useRef<Map<number, string | null> | null>(null);
  const drawHex = resolveColor(doc, color);

  const apply = (index: number, into: Map<number, string | null>): boolean => {
    const value = tool === "draw" ? color : null;
    if (tool === "pick" || into.get(index) === value) return false;
    into.set(index, value);
    return true;
  };

  if (!view || !spriteMap)
    return (
      <EditorCard id="grid" title="Grid">
        <Hint>The points of this sprite are not in a form the grid can edit. Fix them in the YAML tab.</Hint>
      </EditorCard>
    );

  const cellColor = (index: number): string | null | undefined =>
    stroke?.has(index) ? stroke.get(index) : view.cells[index];

  const pickAt = (index: number): void => {
    const value = view.cells[index];
    if (value) onPick(value);
  };

  const commit = (changes: Map<number, string | null>): void => {
    if (changes.size > 0) edit((d) => paintCells(d, sprite, changes));
  };

  const down = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const index = cellIndex(event);
    setCursor(index);
    if (tool === "pick") return pickAt(index);
    if (tool === "draw" && !drawHex) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = new Map<number, string | null>();
    apply(index, next);
    strokeRef.current = next;
    setStroke(new Map(next));
  };
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const current = strokeRef.current;
    if (!current) return;
    const index = cellIndex(event);
    if (apply(index, current)) {
      setStroke(new Map(current));
      setCursor(index);
    }
  };
  const up = (): void => {
    const current = strokeRef.current;
    strokeRef.current = null;
    setStroke(null);
    if (current) commit(current);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>): void => {
    const x = cursor % GRID;
    const y = Math.floor(cursor / GRID);
    const go = (nx: number, ny: number): void => {
      event.preventDefault();
      setCursor(clampCell(ny) * GRID + clampCell(nx));
    };
    if (event.key === "ArrowLeft") go(x - 1, y);
    else if (event.key === "ArrowRight") go(x + 1, y);
    else if (event.key === "ArrowUp") go(x, y - 1);
    else if (event.key === "ArrowDown") go(x, y + 1);
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (tool === "pick") pickAt(cursor);
      else if (tool === "draw" && !drawHex) return;
      else commit(new Map([[cursor, tool === "draw" ? color : null]]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      commit(new Map([[cursor, null]]));
    }
  };

  const cx = cursor % GRID;
  const cy = Math.floor(cursor / GRID);
  const here = cellColor(cursor);
  const pivotValue = readPos(spriteMap.get("pivot"));
  const onCanvas = (p: { x: number; y: number }): boolean => p.x >= 0 && p.y >= 0 && p.x < GRID && p.y < GRID;
  const pivotCell =
    pivotValue && onCanvas({ x: pivotValue.x + view.at.x, y: pivotValue.y + view.at.y })
      ? (pivotValue.y + view.at.y) * GRID + pivotValue.x + view.at.x
      : -1;
  const originCell = onCanvas(view.at) ? view.at.y * GRID + view.at.x : -1;

  return (
    <EditorCard id="grid" title={`Grid: ${sprite}`}>
      <ButtonRow label="Tools">
        {(["draw", "erase", "pick"] as const).map((t) => (
          <Button
            key={t}
            variant={tool === t ? "default" : "outline"}
            aria-pressed={tool === t}
            onClick={() => setTool(t)}
          >
            {t === "draw" ? "Draw" : t === "erase" ? "Erase" : "Pick color"}
          </Button>
        ))}
      </ButtonRow>
      {tool === "draw" && !drawHex && (
        <Alert variant="warning">
          <AlertDescription className="text-foreground">
            The drawing color is not a palette name or a hex value.
          </AlertDescription>
        </Alert>
      )}
      <div
        className="grid-board"
        tabIndex={0}
        role="application"
        aria-label="Pixel grid, 16 by 16. Arrow keys move, Space applies the tool, Delete erases."
        data-testid="grid"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {Array.from({ length: GRID * GRID }, (_, i) => {
          const value = cellColor(i);
          return (
            <Cell
              key={i}
              index={i}
              hex={value ? resolveColor(doc, value) : null}
              filled={Boolean(value)}
              cursor={i === cursor}
              origin={i === originCell}
              pivot={i === pivotCell}
            />
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite" data-testid="grid-cursor">
        Cell {cx}, {cy} (sprite point {cx - view.at.x}, {cy - view.at.y}): {here ?? "empty"}
      </p>
      <div className="flex flex-wrap gap-4">
        <PosField
          label="Position (at)"
          value={view.at}
          testId="sprite-at"
          onChange={(value) => edit((d) => setSpriteAt(d, sprite, value ?? { x: 0, y: 0 }))}
        />
        <PosField
          label="Pivot"
          value={pivotValue}
          testId="sprite-pivot"
          onChange={(value) => edit((d) => setSpritePivot(d, sprite, value))}
        />
      </div>
      <ButtonRow label="Move the sprite">
        {(
          [
            ["Left", -1, 0],
            ["Up", 0, -1],
            ["Down", 0, 1],
            ["Right", 1, 0],
          ] as const
        ).map(([label, dx, dy]) => (
          <Button
            key={label}
            variant="outline"
            size="sm"
            onClick={() => edit((d) => setSpriteAt(d, sprite, { x: view.at.x + dx, y: view.at.y + dy }))}
          >
            Move {label.toLowerCase()}
          </Button>
        ))}
      </ButtonRow>
      {view.outside.length > 0 && (
        <div data-testid="outside-points" className="flex flex-col gap-2">
          <h4 className="font-medium">Points outside the canvas ({view.outside.length})</h4>
          <Hint>They are kept. Edit them in the YAML tab.</Hint>
          <ul className="flex flex-col gap-1 text-sm">
            {view.outside.slice(0, 64).map((p, i) => (
              <li key={i}>
                [{p.x}, {p.y}] <code>{p.color}</code>
              </li>
            ))}
          </ul>
          {view.outside.length > 64 && <Hint>And {view.outside.length - 64} more.</Hint>}
        </div>
      )}
    </EditorCard>
  );
}
