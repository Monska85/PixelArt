# Power protection, version 1

Status: **implemented** by the firmware and the simulator.

This document specifies how a PixelArt board notices that its power supply cannot deliver the current of its brightest animations, and how it dims those animations so that it stops restarting. Why it works this way is recorded in [ADR 0008](../adr/0008-brownout-power-protection.md). The protocol fields and the command it mentions are specified in the [command protocol](../protocol/protocol-v1.md#status).

## Overview

A WS2812B matrix draws more current the brighter its frame is. When the supply, its cable or the board's USB connector cannot deliver that current, the voltage drops, the ESP32-C3's brownout detector resets the chip, and the board starts again from the first item of its list. A board with power protection:

1. records the reason of each start in a short history kept in NVS, and, after a brownout, the estimated current of the frame that was playing when the power failed;
2. turns on a current limit once at least 3 of its last 10 starts were brownouts;
3. while the limit is on, plays each animation whose heaviest frame is over the limit at one constant, lower brightness, so that its heaviest frame fits; every other animation plays unchanged.

A board that never browns out sees no change: the limit stays off, nothing is estimated, and every frame is the same as without the feature.

## Current estimate

The estimate of a frame is a whole number of milliamperes (mA), computed by the engine (`lib/PixelEngine`) from the frame's pixels and the brightness the LEDs receive. The firmware and the simulator use the same function.

For each of the 256 pixels, with its color `#rrggbb` split into `R`, `G` and `B` (0 to 255):

1. The color is reduced to 16 bits as the matrix library does: `r5 = R ÷ 8`, `g6 = G ÷ 4`, `b5 = B ÷ 8`, where `÷` keeps only the whole part.
2. Each channel takes its gamma corrected level from the tables `gamma5` and `gamma6` of the Adafruit NeoMatrix library (version 1.3.3, file `gamma.h`), which the firmware links: `Lr = gamma5[r5]`, `Lg = gamma6[g6]`, `Lb = gamma5[b5]`. Each level is 0 to 255; black is 0 and white is 255 on every channel.
3. With `E` the brightness the LEDs receive (0 to 255, see [Brightness](#brightness)), each channel sends the LED the value `V = (L × (E + 1)) ÷ 256`. This is what the LED driver sends, so at `E = 255` the value is the level itself.

With `U` the sum of the three values `V` over all 256 pixels, the estimate is:

```text
estimate = (256 × 1000 + 60 × U + 500) ÷ 1000
```

that is, about 1 mA per LED when it is dark plus 0.06 mA per unit of LED output, rounded to the nearest milliampere, halves upwards. An all black frame is 256 mA, and an all white frame at `E = 255` is 12,006 mA.

The constants (1,000 microamperes per LED, 60 microamperes per unit) make **estimate model 1**. They are not meant to be exact for any panel: every limit is a fraction of the estimate of a frame that actually caused a brownout on that board, so a constant that is too high or too low cancels out. A firmware that changes the formula or a constant raises the model version, and the board then forgets what it learned with the old model (see [Clearing](#clearing)).

The frames of an animation are numbered for the estimate from 0, in the order the timeline lists them, counting each repetition of a frame (`repeat`) and counting the frames inside a loop once, as if every loop ran one time. These are the distinct frames of the animation: a loop repeats the same frames, and a repetition can differ only through motion and spin. The number of a frame is also the `frame` that `status.power.last_brownout` reports.

## Recording

At every start, before the first frame, the firmware reads the reason of the reset (`esp_reset_reason()`) and appends it to the **history**, the reasons of the last 10 starts, oldest first. A start that finds 10 reasons drops the oldest. It does so as early as it can read the files, right after the file system is mounted and before the protocol, the updater and the network start: the LEDs can keep showing the last frame they received until the new start shows its own, so a weak supply can brown out again while the board starts, and a start that browns out before this point is not recorded. Each reason is one of these names:

| Name         | Reasons of the reset                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| `brownout`   | `ESP_RST_BROWNOUT`: the supply voltage fell below the detector's level.            |
| `power_on`   | `ESP_RST_POWERON`: the power was switched on.                                      |
| `software`   | `ESP_RST_SW`: the firmware restarted the board, after an update or a failed trial. |
| `panic`      | `ESP_RST_PANIC`: the firmware crashed.                                             |
| `watchdog`   | `ESP_RST_INT_WDT`, `ESP_RST_TASK_WDT`, `ESP_RST_WDT`.                              |
| `deep_sleep` | `ESP_RST_DEEPSLEEP`.                                                               |
| `other`      | Every other reason: the reset button, a reset over USB, unknown.                   |

Only `brownout` counts for the limit. The others, crashes and watchdogs included, are kept for display and to push old brownouts out of the history.

### The frame that was playing

While an animation plays, the firmware keeps in memory that survives a reset but not a power cut (`RTC_NOINIT_ATTR` on the board) a small **frame marker**: the ID of the animation, which frame of it is on the matrix, and the brightness the LEDs receive for it. The ID is written when the animation starts, and the rest at every frame, with no other computation. The marker is cleared whenever no animation plays: between two animations, while the update icon or the "no animations" image is shown, and at every start. It carries a magic value and a check over its fields, so the random content of that memory after a power cut, or a marker half written when the power failed, is never taken for a frame.

At a start whose reason is `brownout`, the firmware reads the marker. When it is valid, it loads that animation once, renders that frame, computes its estimate with the brightness the marker holds, and stores it with the event. When the marker is missing or invalid, the animation cannot be loaded, or the frame is not in it any more, the event is stored without an estimate. A brownout while no animation plays (at boot, during the update icon or the "no animations" image) is therefore an event without an estimate.

The ESP32-C3 may lose the marker's memory in a real brownout as well: this has not been verified on hardware. The design does not depend on it. A brownout without an estimate counts for the trigger and the limit steps like any other; only the first limit falls back to a fixed value when no brownout in the history has an estimate.

### The record in NVS

The history, the estimates, the last brownout and the limit are kept in NVS in their own namespace, `pixelart_power`, as one record with the estimate model version it was computed with. The record is written once per start, after the reason is appended, and again only when `power_reset` or a factory reset clears it, or when the time becomes known after a start that recorded a brownout (to store its date, once). A write that fails is logged once; the board keeps using the record it holds in memory until the next start.

For each brownout in the history the record keeps its estimate, or none. For the most recent brownout since the record was last cleared it also keeps `last_brownout`: the animation ID and the frame number when the marker was valid, and the local date. The time is usually not known yet when the board starts, so the date is stored when the board first knows the time during that same run, and stays unknown when it never does or when the board restarts first. `last_brownout` stays after its brownout has left the history.

A record that cannot be read, or that was written in a layout this firmware does not know, counts as no record: the board starts a new one. The record names its own layout, so a later firmware that needs another layout writes it under another key and leaves this one for an older firmware.

## Trigger

At each start, after the reason is appended, the firmware counts the brownouts in the history. When the limit is off and at least 3 of the reasons in the history (at most 10) are `brownout`, the limit turns on.

No date and no network are needed. An old brownout leaves the history as normal starts and power cuts push it out, so a board that browned out twice months ago and once today does not turn the limit on unless those starts are among its last 10.

## Limit

The limit is a whole number of milliamperes.

1. **First limit.** When the limit turns on, it is 80 % of the lowest estimate among the brownouts in the history, `lowest × 80 ÷ 100`. When no brownout in the history has an estimate, it is 1,000 mA.
2. **Each further brownout** while the limit is on lowers it by 10 % of its current value: `limit × 90 ÷ 100`. The start that turns the limit on is not lowered again at once.
3. **Floor.** A limit below 300 mA becomes 300 mA. At 300 mA the limit stops going down and the board reports `at_floor: true`.
4. **The limit never rises by itself.** It stays on, at its value, while the brownouts leave the history; only [clearing](#clearing) turns it off.

`÷` keeps only the whole part. For example, with brownouts of estimates 3,402, 3,113 and 2,980 mA, the first limit is `2980 × 80 ÷ 100 = 2384` mA; the next brownout makes it `2384 × 90 ÷ 100 = 2145` mA, then 1,930, 1,737 and so on down to 300.

## Dimming

### When the limit is off

Nothing is computed. Loading an animation costs one check of whether the limit is on, and every frame is what it would be without the feature.

### When the limit is on

When an animation starts, the firmware scans it once to find its **heaviest frame**: it renders its distinct frames, in frame number order, into the frame buffer the player already uses, and keeps the frame with the highest estimate at the brightness `E1` the animation would get without power protection (the first such frame on a tie). The scan renders at most 1,024 frames, which draw at most 262,144 points together (the points of every sprite each frame shows, counting every part of composite sprites, as the format's limit on the points of a frame counts them). This bounds the time a scan takes on the board to about a third of a second. An animation over either limit is not scanned: it is treated as if one of its frames were all white, so its heaviest frame is a full white frame.

Then it chooses the animation's **power scale** `S`, a whole percentage from 1 to 100:

- When the heaviest frame's estimate at `E1` is at most the limit, `S` is 100 and the animation plays unchanged.
- Otherwise `S` is the largest percentage from 1 to 99 at which the heaviest frame's estimate, at the brightness `E` below, is at most the limit, and 1 when none is.

The whole animation plays at that one scale, every frame and every repetition. The scale never changes from frame to frame, which would make the animation flicker.

### Brightness

The brightness the LEDs receive is the board's `brightness` setting, lowered by the animation's own `brightness` percentage as the [format](../format/pixelart-v1.md#brightness) says, which gives `E1`, then lowered by the power scale:

- when `S` is 100, `E = E1`;
- otherwise, when `E1` is 0, `E = 0`;
- otherwise `E = (E1 × S + 50) ÷ 100`, and a result of 0 becomes 1.

The user's `brightness` setting never changes. The update icon and the "no animations" image are never scaled.

The scale is chosen when an animation starts, from the limit and the brightness of that moment. A change of the `brightness` setting reaches the LEDs from the next frame as before, and the scale follows it from the next animation. When `power_reset` clears the limit, the animation playing goes back to scale 100 from its next frame.

## Clearing

These clear the history, the estimates, the last brownout and the limit, as if the board had never browned out:

- the command [`power_reset`](../protocol/protocol-v1.md#power_reset), for use after the power hardware changed;
- a factory reset, [`delete_all`](../protocol/protocol-v1.md#delete_all) with `settings: true`;
- a start of a firmware whose estimate model version differs from the one the record was computed with. The record is cleared, then the reason of that start is appended.

Nothing else clears it: not the `brightness` setting (the limit is in milliamperes, so a lower brightness already draws less), not WiFi, the playlists, the schedule or any other setting, and not a firmware update with the same model version.

## Firmware updates and rollback

A new firmware boots on trial and confirms itself at its first frame ([Rollback](wifi-and-updates-v1.md#rollback)). The marker is empty before the first frame, and a brownout during the trial, before that frame, still rolls the firmware back, as any reset does: the previous firmware starts with the reason `brownout`. When the previous firmware has power protection, it records that brownout without an estimate. A brownout after the first frame finds the new firmware already confirmed, so it does not roll back, and the frame is recorded as usual.

A firmware older than power protection never opens the `pixelart_power` namespace and leaves it as it is. When a newer firmware runs again, it keeps the record if its model version matches; the starts that happened under the older firmware are not in the history.

## Simulator and tests

The simulator plays the firmware's code with a simulated reset reason, NVS record and marker memory. Every start of the simulator is a `power_on` unless the options say otherwise, so `make sim` keeps the limit off and every frame is the same as without the feature.

`--boot REASON[:ANIMATION:FRAME]`, which can be repeated, gives the reasons of the simulated board's starts, oldest first; the last one is the reason of the start the run plays. `REASON` is one of the names of the [Recording](#recording) table. Each start runs the recording, the trigger and the limit as on the board, with the settings at their defaults and the files of the data folder. For `brownout`, `ANIMATION:FRAME` is the animation and frame number that were on the matrix when the power failed: the marker before that start then holds them, with the brightness the board would have used for that frame at that moment, the power scale included. Without them the marker is missing, as when the memory is lost or no animation played. An animation that is not stored or valid, or a frame it does not have, stops the simulator with an error. For example, three brownouts during frame 1 of `bear`, the frame with the hat, turn the limit on at 80 % of that frame's estimate:

```sh
make serve ARGS="--boot brownout:bear:1 --boot brownout:bear:1 --boot brownout:bear:1"
```

The record of the simulator lives in memory for the length of a run, and survives the simulated restarts of a run (a firmware installation), as NVS does on the board. The protocol cases use the same seams as steps (see [`conformance/README.md`](../../conformance/README.md#protocol-cases)): `reset` restarts the board with a given reason and marker, `power_model` changes the estimate model version of the simulated firmware, and `power_store_fails` makes writes of the record fail.

The engine's estimate, scan, scale and limit rules have native tests and the shared hand-computed rows of [`conformance/power.json`](../../conformance/README.md#power-rows).

## Limits

| Limit                              | Value                                    |
| ---------------------------------- | ---------------------------------------- |
| Reasons in the history             | 10                                       |
| Brownouts that turn the limit on   | 3 of the history                         |
| First limit                        | 80 % of the lowest estimate, or 1,000 mA |
| Step of each further brownout      | 10 % of the current limit                |
| Floor                              | 300 mA                                   |
| Frames scanned per animation       | 1,024                                    |
| Points drawn by the scanned frames | 262,144                                  |
| Estimate model version             | 1                                        |
