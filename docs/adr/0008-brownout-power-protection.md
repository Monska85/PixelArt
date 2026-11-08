# 8. Brownout power protection

Date: 2026-11-08

Status: accepted

## Context

Some boards restart during bright animations (`bear`, `snow_globe`, `santa_bag` and others), and the list starts again from its first item, because a restart is the only path that resets the player's place. The restarts are brownout resets. Some facts shape the solution:

- **The current is far beyond what USB through the board delivers.** At brightness 100 the brightest frames of the shipped animations need an estimated 2.2 to 2.9 A with the estimate below (the frame of `bear` with the hat is the heaviest). The ESP32-C3 SuperMini routes the matrix current through its USB connector unless the matrix has its own supply.
- **The detector is at its most sensitive level.** The Arduino core builds with `CONFIG_ESP_BROWNOUT_DET_LVL=7`. WiFi transmit bursts add their own peaks, so the resets land on heavy frames but not always on the same one.
- **Most boards work.** Boards with a proper supply play the same animations without a restart, so the content must not be dimmed for everyone.
- **The time is optional.** A board may never get the time (no WiFi, a blocked server), so a rule cannot depend on dates.
- **The loop task is small.** It plays the animations and answers the protocol on a stack of 8 KB, and the frame buffer is already static to keep it off that stack.
- **Whether the ESP32-C3 keeps its RTC memory through a real brownout is not known.** It has not been tested on hardware, and testing it would mean browning out a board on purpose.

## Decision

1. **The board learns from its own resets.** At every start it appends the reset reason to a history of the last 10 reasons in NVS, in its own namespace. During playback a small marker in `RTC_NOINIT_ATTR` memory holds the animation, the frame and the brightness on the matrix. After a brownout the next start renders that frame once and stores its estimated current with the event. Panic and watchdog resets are kept for display and never count.
2. **The limit turns on after 3 brownouts among the last 10 starts**, with no date and no network. The first limit is 80 % of the lowest stored frame estimate, or 1,000 mA when no brownout has one; each further brownout lowers it by 10 %, down to a floor of 300 mA. The limit never rises by itself.
3. **The estimate is relative.** A pure function in `lib/PixelEngine` gives about 1 mA per LED plus 0.06 mA per unit of LED output, after the board brightness, the animation brightness and the NeoMatrix gamma correction. Its constants are not accurate for any panel, and need not be: every limit is a fraction of the estimate of a frame that actually browned the board out. The constants carry a model version stored with the data.
4. **Dimming is per animation, at one constant scale.** While the limit is on, an animation is scanned when it starts, reusing the static frame buffer, to find its heaviest frame. When that frame is over the limit, the whole animation plays at the one power scale that makes it fit; otherwise it plays unchanged. A scale per frame would make animations flicker. The power scale multiplies the board brightness and the animation brightness; the user's setting never changes, and the update icon and the "no animations" image are never scaled.
5. **Clearing is explicit.** A new command `power_reset`, for use after the power hardware changed, a factory reset (`delete_all` with `settings: true`), and a firmware with another model version clear the history and the limit. Nothing else does.
6. **The protocol grows by addition.** `status.power` reports the history, the limit and the scale; older clients ignore it, and a client offers the feature only when it is present. A board without the feature answers `power_reset` with `unknown_command`.
7. **The design holds without the marker.** A brownout without a valid marker is an event without an estimate, which still counts for the trigger and the steps. The simulator injects resets and markers for the tests; the real brownout path was not exercised on hardware.

## Consequences

- A healthy board sees no change: nothing is computed while the limit is off, loading an animation costs one check, and every frame stays byte-identical, which `make sim` confirms.
- A board with a weak supply needs 3 restarts before it protects itself, and then plays its brightest animations dimmer. The user can see why in the web app and undo it after fixing the hardware.
- Each start writes one small NVS record. Starts are rare, so the wear is negligible next to the settings.
- A brownout during a firmware trial boot, before the first frame, still rolls the firmware back as before.
- The scan is bounded: an animation with more than 1,024 distinct frames, or whose frames draw more than 262,144 points together, is not scanned, and while the limit is on it is dimmed as if one of its frames were all white. Without the point budget, a 2 KB file of 1,024 frames of 4,096 drawn points took 3.1 seconds to scan on an ESP32-C3, with the loop task answering nothing; 1,024 frames of 256 points took 0.34 seconds. No shipped animation comes close (the longest has 52 frames).
- If the ESP32-C3 turns out to keep its RTC memory through a brownout, the limits follow the real frames; if it does not, the first limit is 1,000 mA and the steps bring it down from there.

## Alternatives considered

- **Lowering `brightness` in the heavy animations.** It would dim the boards that work.
- **Disabling or lowering the brownout detector.** It hides the symptom and risks flash corruption during writes at low voltage.
- **A time window for the trigger.** It needs a known date, which a board without WiFi never has.
- **Clearing on a brightness change.** It throws away what was learned and costs 3 more restarts, while the limit, in milliamperes, already accounts for the brightness.
- **Raising the limit again by itself.** The board would have to brown out to find out that the limit is still needed.
- **A scale per frame.** It fits every frame exactly, but makes animations flicker.
