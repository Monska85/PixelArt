// SPDX-License-Identifier: GPL-3.0-or-later

import type { Frame } from "../../engine";

/** Draws a frame on a 16x16 canvas. */
export function drawFrame(canvas: HTMLCanvasElement | null, frame: Frame): void {
  const context = canvas?.getContext("2d");
  if (!context) return;
  const image = context.createImageData(16, 16);
  frame.pixels.forEach((rgb, i) => {
    image.data[i * 4] = (rgb >> 16) & 0xff;
    image.data[i * 4 + 1] = (rgb >> 8) & 0xff;
    image.data[i * 4 + 2] = rgb & 0xff;
    image.data[i * 4 + 3] = 255;
  });
  context.putImageData(image, 0, 0);
}
