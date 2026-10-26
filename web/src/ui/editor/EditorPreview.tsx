// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import type { Animation, Frame } from "../../engine";
import type { Path } from "../../editor/doc";
import { firstFrameOf, frameAt } from "../../editor/preview";
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
function shownAt(animation: Animation, n: number): Shown | null {
  const at = frameAt(animation, n);
  return at ? { n, ...at } : null;
}

const startFrame = (animation: Animation, selected: Path | null): Shown | null =>
  shownAt(animation, (selected && firstFrameOf(animation, selected)) || 1);

/** The frame after `current`, back to the first after the last. */
const step = (current: Shown, animation: Animation): Shown | null =>
  shownAt(animation, current.n + 1) ?? shownAt(animation, 1);

/** Plays the animation with play, pause and step, and says which timeline item made the frame. */
export function EditorPreview({ animation, selected }: Props) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [playing, setPlaying] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const selectedKey = selected ? selected.join(".") : null;

  // A new animation or a new selection starts at the first frame of the selection, or at frame 1.
  const [basis, setBasis] = useState<{ animation: Animation | null; key: string | null }>({
    animation: null,
    key: null,
  });
  if (basis.animation !== animation || basis.key !== selectedKey) {
    setBasis({ animation, key: selectedKey });
    setShown(animation ? startFrame(animation, selected) : null);
  }

  useEffect(() => {
    if (shown) drawFrame(canvas.current, shown.frame);
  }, [shown]);

  useEffect(() => {
    if (!playing || !shown || !animation) return;
    const timer = setTimeout(
      () => setShown((current) => (current ? step(current, animation) : current)),
      shown.frame.ms,
    );
    return () => clearTimeout(timer);
  }, [playing, shown, animation]);

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
              if (animation && shown) setShown(step(shown, animation));
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
