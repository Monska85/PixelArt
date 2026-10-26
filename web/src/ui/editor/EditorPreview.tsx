// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useMemo, useRef, useState } from "react";
import type { Animation, Frame } from "../../engine";
import type { Path } from "../../editor/doc";
import { FrameCursor } from "../../editor/preview";
import { Pause, Play, StepForward } from "lucide-react";
import { CANVAS_CLASS } from "../board/Preview";
import { drawFrame } from "../common/drawFrame";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { EditorCard } from "./EditorCard";

interface Props {
  animation: Animation | null;
  /** The timeline item selected in the editor: the preview shows its first frame. */
  selected: Path | null;
}

interface Shown {
  n: number;
  frame: Frame;
  path: readonly number[];
}

/** Frame `n` of the animation, or null past its end. */
function shownAt(cursor: FrameCursor, n: number): Shown | null {
  const at = cursor.frameAt(n);
  return at ? { n, ...at } : null;
}

const startFrame = (cursor: FrameCursor, selected: Path | null): Shown | null =>
  shownAt(cursor, (selected && cursor.firstFrameOf(selected)) || 1);

/** The frame after `current`, back to the first after the last. */
const step = (current: Shown, cursor: FrameCursor): Shown | null =>
  shownAt(cursor, current.n + 1) ?? shownAt(cursor, 1);

/** Plays the animation with play, pause and step, and says which timeline item made the frame. */
export function EditorPreview({ animation, selected }: Props) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [playing, setPlaying] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const selectedKey = selected ? selected.join(".") : null;
  // One cursor per animation: playing moves it one frame at a time instead of searching from the start.
  const cursor = useMemo(() => (animation ? new FrameCursor(animation) : null), [animation]);

  // A new animation or a new selection starts at the first frame of the selection, or at frame 1.
  const [basis, setBasis] = useState<{ animation: Animation | null; key: string | null }>({
    animation: null,
    key: null,
  });
  if (basis.animation !== animation || basis.key !== selectedKey) {
    setBasis({ animation, key: selectedKey });
    setShown(cursor ? startFrame(cursor, selected) : null);
  }

  useEffect(() => {
    if (shown) drawFrame(canvas.current, shown.frame);
  }, [shown]);

  useEffect(() => {
    if (!playing || !shown || !cursor) return;
    const timer = setTimeout(() => setShown((current) => (current ? step(current, cursor) : current)), shown.frame.ms);
    return () => clearTimeout(timer);
  }, [playing, shown, cursor]);

  return (
    <EditorCard id="preview" title="Preview">
      <div className="flex flex-col items-start gap-3">
        <canvas
          ref={canvas}
          width={16}
          height={16}
          role="img"
          aria-label="Preview of the animation"
          data-testid="preview-canvas"
          hidden={!animation}
          className={CANVAS_CLASS}
        />
        {!animation && (
          <Alert variant="warning">
            <AlertDescription className="text-foreground">
              The animation has errors, so it cannot play. See the diagnostics.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!animation} onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!animation || !shown}
            onClick={() => {
              setPlaying(false);
              if (cursor && shown) setShown(step(shown, cursor));
            }}
          >
            <StepForward aria-hidden="true" />
            Step
          </Button>
        </div>
        {shown && (
          <div className="text-sm text-muted-foreground">
            <p data-testid="preview-frame">
              Frame {shown.n}, {shown.frame.ms} ms
            </p>
            <p data-testid="preview-item">Timeline item {shown.path.map((i) => i + 1).join(".")}</p>
          </div>
        )}
      </div>
    </EditorCard>
  );
}
