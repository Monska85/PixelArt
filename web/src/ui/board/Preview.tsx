// SPDX-License-Identifier: GPL-3.0-or-later

import { Pause, Play, StepForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Player, type Animation, type Frame } from "../../engine";
import { Button } from "../components/button";
import { drawFrame } from "../common/drawFrame";

interface Model {
  player: Player;
  n: number;
}

function advance(model: Model): { frame: Frame; n: number } {
  let frame = model.player.next();
  if (!frame) {
    model.player.restart();
    model.n = 0;
    frame = model.player.next();
  }
  model.n += 1;
  return { frame: frame as Frame, n: model.n };
}

function createModel(animation: Animation) {
  const model: Model = { player: new Player(animation), n: 0 };
  return { model, first: advance(model) };
}

/** The canvas that shows a frame, 16 by 16 pixels drawn large and sharp. */
export const CANVAS_CLASS =
  "size-48 max-w-full shrink-0 rounded-md border border-border bg-black [image-rendering:pixelated]";

/** Plays an animation on a 16x16 canvas, with play, pause and step. Use `key` to start another animation. */
export function Preview({ animation, label }: { animation: Animation; label: string }) {
  const [initial] = useState(() => createModel(animation));
  const [shown, setShown] = useState(initial.first);
  const [playing, setPlaying] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => drawFrame(canvas.current, shown.frame), [shown]);

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setShown(advance(initial.model)), shown.frame.ms);
    return () => clearTimeout(timer);
  }, [playing, shown, initial]);

  return (
    <div className="flex flex-col items-start gap-3">
      <canvas
        ref={canvas}
        width={16}
        height={16}
        role="img"
        aria-label={`Preview of ${label}`}
        className={CANVAS_CLASS}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPlaying(false);
            setShown(advance(initial.model));
          }}
        >
          <StepForward aria-hidden="true" />
          Step
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="off" data-testid="frame-info">
        Frame {shown.n}, {shown.frame.ms} ms
      </p>
    </div>
  );
}
