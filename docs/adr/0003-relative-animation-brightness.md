# 3. Animations can lower the brightness, relative to the board's setting

Date: 2026-10-19

Status: accepted

## Context

The brightness of the LEDs is a board setting. It is stored in the board's settings memory (NVS), defaults to 100 on a scale from 0 to 255, and the user changes it through the command protocol (`settings_set`, see [the protocol](../protocol/protocol-v1.md)). The animation format says so explicitly: brightness is a board setting and is not part of the file.

Authors still want some animations to be softer than others, for example a calm night scene next to a bright fireworks show. Today the only way is to choose darker colors, which also changes the hue and loses color steps at low values.

Two constraints shape any answer:

- **Power.** 256 LEDs on full white at brightness 255 draw about 15 A, far more than a USB port or a small supply gives. The board setting is the user's guarantee that the matrix stays within what their power supply handles.
- **User control.** The user sets the brightness for the room: dim at night, brighter by day. An animation, including one downloaded later from a URL, must not undo that choice.

Nothing has been released yet: no board outside the project runs the format, so `pixelart/1` can still gain an optional field without a new format version.

## Decision

1. **An animation has an optional `brightness` field**, a whole percentage from 1 to 100, default 100. It is part of `pixelart/1`, specified in [the animation format](../format/pixelart-v1.md#brightness).
2. **The field is relative.** The LEDs run at the board's brightness multiplied by the animation's percentage, with the rounding rule of the format specification. Nothing in a file can make the matrix brighter than the board setting.
3. **The board setting stays the absolute limit**, in NVS, changed only through the protocol. Its default of 100 does not change.
4. **The brightness applies to the whole animation,** every frame and every LED, background included. The built-in "no animations" image uses the board brightness as it is.

## Alternatives considered

- **An absolute brightness in the file** (0 to 255, replacing the board setting while the animation plays). Rejected: one animation could light up a matrix the user dimmed for the night, and could exceed what the user's power supply handles.
- **A brightness on the playlist item** (`- animation: snow_globe, brightness: 50`). The same animation could then look different in different playlists. Rejected for now: the author of the animation, who knows how bright it should look, could not set it, and the board would need two places to combine. It can still be added later as a further relative factor.
- **Both, on the animation and on the playlist item.** Rejected for now for the same reason, and because two multiplications make the result harder to predict. The animation field comes first; the playlist item can follow if it is missed.

## Consequences

- `pixelart/1` gains an optional field before the first release. A board with older firmware would reject a file that uses it as an unknown field, which is acceptable because no such board exists outside the project.
- Every existing animation has no `brightness` field, so it plays at 100 percent of the board setting: exactly as today, pixel for pixel.
- Every implementation of the format applies the same rounding rule. The conformance suite gains cases for the field, and the planned web app engine implements it too.
- The protocol's `brightness` setting keeps its meaning as the user's limit; its documentation gains a sentence about the animation factor.
