# Web app, version 1

Status: **implemented** by the web app in `web/`.

This document specifies the PixelArt web app: a static site that installs the firmware on a board, shows what the board stores, uploads, downloads and deletes animations and playlists, changes the board's settings, and edits animations. It needs nothing installed on the computer. Why the web app works this way is recorded in [ADR 0004](../adr/0004-web-app.md).

The web app talks to boards with the [command protocol](../protocol/protocol-v1.md), reads and writes the [animation](../format/pixelart-v1.md) and [playlist](../format/playlist-v1.md) formats, and reads the [release manifest](../format/manifest-v1.md).

## Where it runs

- **Address.** GitHub Pages, at `https://monska85.github.io/PixelArt/`, at the root of the same site as the published firmware and animations. See [Publishing](#publishing).
- **Browsers.** Connecting to a board and installing firmware need Web Serial, which only desktop Chromium browsers have: Chrome, Edge, Opera and others built on Chromium. In other browsers (Firefox, Safari, phones) the app still connects to the simulator and still edits and previews animations; the board and firmware buttons are replaced by a message that names the browsers that work.
- **Development.** `make web-dev` starts the app on `http://localhost:5173` with live reload. `make serve` starts the simulator with the command protocol on `ws://127.0.0.1:8765`, so the whole app works without a board. The simulator accepts the origins `http://localhost:*`, `http://127.0.0.1:*` and `https://monska85.github.io` (see [WebSocket](../protocol/protocol-v1.md#websocket-simulator)).

The app is a single page with four views, reached from a bar at the top: **Board**, **Library**, **Firmware** and **Editor**. The address keeps the view in its fragment (`#board`, `#library`, `#firmware`, `#editor`), so reloading the page stays on the same view.

## User interface

The app is built from one set of components and a few layout patterns, so every view looks and behaves the same. The components come from shadcn/ui: Radix primitives give the behavior (keyboard, focus, screen readers), Tailwind CSS gives the look, and the component code lives in `web/src/ui/components/`. Icons come from lucide-react. Why: [ADR 0004](../adr/0004-web-app.md), decision 9. A view never draws its own variant of a component or a pattern below.

The details the build settled:

- **Menus of choices** (the animation of a playlist item, the active playlist, the angles of a sprite) use the browser's own select control, styled like the other fields: it is the most accessible choice and adds nothing to the download.
- **Side panels** are Radix Dialog without its modal part, so the list next to them stays usable (a wide panel below 1,024 px is the one exception, see below). From 1,024 px wide they sit in a column to the right of the list; below that they are fixed to the bottom of the screen, with their title and their buttons staying in view. Escape and the close button close them.
- **Wide panels** are side panels for editing that needs room: the playlist editor. From 1,024 px wide a wide panel spans the whole content width above the list that opened it, and the list stays usable below it; below that it fills the screen, with its title and its buttons staying in view, and it is modal: focus stays in it and the page behind it is hidden from screen readers, since that page cannot be seen. Whether a wide panel is modal is decided when it opens and kept while it is open, so resizing the window or turning a tablet never rebuilds it or hides a dialog opened from it. The cost is a rare one: a wide panel opened on a phone stays modal when the window widens, so the page next to it can be used again once the panel is closed.
- **Theme:** the page carries the theme in `data-theme` on the root element. A small script in the head (no inline script) sets it from the remembered choice or the operating system before the first paint; the app keeps it in step with the operating system while the choice is System.
- **Disabled actions** keep their style and their contrast, and a tooltip on them says why they are disabled.
- **Menus:** a menu is used only for two or more actions; a single action is a direct icon button with a tooltip.

### App shell

- **Top bar:** the name PixelArt, the navigation (Board, Library, Firmware, Editor) as one tab-style bar with the current view marked, the connection chip and the theme control. Below 640 px wide the navigation becomes a menu button that shows the current view.
- **Connection chip:** a dot and a word for the state (Connected, Connecting, Lost, Not connected; never color alone), and when connected the board and its firmware. It opens a panel with the details (board, firmware, storage), **Disconnect**, **Connect board** and the simulator address with **Connect simulator**. The connect controls are not shown on the page while a board is connected.
- **Not connected:** the Board view shows a connect card with **Connect board** (primary) and, folded under "Use the simulator", the address and **Connect simulator**. Library, Firmware and Editor work without a board and say in place what needs one.
- **Lost connection:** one alert under the top bar, "Connection lost. Reconnect to continue.", with **Reconnect**. Actions that need the board are disabled and their tooltip says why.
- **Theme control:** three states, **System** (the default), **Dark** and **Light**. System follows the operating system and changes live when the operating system switches. The control is one icon button, not a menu: a click moves on from System to Dark, from Dark to Light and from Light back to System. The icon shows the current state (a monitor, a moon or a sun), the tooltip names the current state and the next one ("Theme: System. Click for Dark."), and the accessible name carries the same text, so a screen reader announces the state. Enter and Space work as they do on any button. The choice is remembered in the browser; when the browser refuses to store it, the app stays on System. Text and controls meet the WCAG AA contrast ratios in both themes.

### Page pattern

Every view starts with the same page header: the title (`h2`), one line saying what the view is for, and on the right the view's single primary action, its secondary actions, and a **More** menu for the rest. On a phone the secondary actions move into **More**. Content follows in cards with one shared style.

### List pattern

Board and Library show their files the same way:

- **Tabs** **Animations** and **Playlists**, with counts, as a tab component (not buttons); the tab label is the only heading, the card below repeats nothing.
- **A table** that fills its card: the name with the ID under it in monospace (cut with an ellipsis, whole in a tooltip), then the view's own columns (Board: version and size; Library: version and the state on this board), all vertically centered on one line.
- **Row actions** at the right end, aligned with the cells: up to three icon buttons with a tooltip and an accessible name, then, when there are two actions or more to fold away, a **More** menu (⋯). Destructive items are last in the menu, in the danger color. A menu is used only for two or more actions; a single action is a direct icon button with a tooltip, never a menu of one.
- **Install on the row:** a file listed as not on the board (or different from the board's copy) has a visible **Install** icon button on its row, never hidden in a menu. A playlist's Install brings its animations through the shared upload queue.
- **Preview opens in a side panel** (from the right on a wide screen, from the bottom on a phone), next to the list that opened it, and **the playlist editor in a wide panel** (above the list on a wide screen, the whole screen below 1,024 px), never at the end of the page.
- **Below 640 px** each row becomes two lines (name and ID, then the columns as text) with the actions on the right; the page never scrolls sideways.
- **Empty list:** only for a list the app has read and found empty: a title ("No animations on this board"), one sentence, and the actions that fill it (animations: **Upload files** and **Install from the Library**; playlists: **New playlist** and **Install from the Library**).
- **List not read yet:** while the first read after connecting is under way, a loading line ("Reading the files from the board...") and no counts, never the empty list. In the Library, the state column stays blank and a line says "Reading the board...".
- **List that could not be read:** the notice "Could not read the files from the board." with **Retry**, which reads the lists again; the tab shows no count. The Library shows the same notice above its tables, and its state column stays blank rather than saying "Not on the board". A failed read is reported once, as an error of the view that sees it first, not again when another view opens.
- **List read again after a change:** the rows stay while the new read is under way.

### Dialog pattern

Every confirmation is a dialog. The title is a short question with the verb ("Delete ball?"); the text says what changes and names the files. Buttons are at the bottom right: the safe action on the left (**Cancel**, or a precise label such as **Keep editing**), the action on the right with a verb label (**Delete**, **Replace**, **Discard and open**, **Use this ID**). Only destructive actions are red. Escape cancels; focus starts on the safe action for destructive dialogs, and goes back to the control that opened the dialog when it closes. On a phone the dialog fills the width at the bottom of the screen.

### Feedback pattern

- **Progress:** an action that takes time shows a spinner in its button, and uploads, installs and the wipe show one activity panel under the page header (file N of M, a progress bar, **Cancel**). It is the same panel in every view.
- **Results:** a toast for the outcome of an action ("Uploaded 3 animations"), which also announces it to screen readers.
- **Errors:** one alert component (icon, title, text, and the diagnostics table when there are diagnostics), shown next to what failed and kept until the user acts. Errors are never red text on a colored background.

### Wording and formats

- Sentence case for every label, title, badge and menu item.
- Verbs: **Upload** sends files from the computer to the board, **Install** sends published files from the Library, **Download** saves to the computer, **Open** loads into the editor. "Save" is not used for these.
- Nouns: "animation" and "playlist"; "file" only when the kind is not known.
- Sizes: bytes below 1,024 (`845 B`), then KB and MB with one decimal (`2.9 KB`, `1.4 MB`), base 1,024, everywhere.
- States are words with an icon (On the board, Same, Different, Active), never color alone.

### Forms

Labels above fields; a hint in muted text under the field; an error replaces the hint in the danger color and is linked with `aria-describedby`. Filled-in values look like values, placeholders only show examples. Numbers use number fields or sliders with the value shown next to them.

### Accessibility, spacing and size

- Everything works with the keyboard and shows a visible focus ring; `prefers-reduced-motion` turns off animations.
- One spacing scale (multiples of 4 px), one card style, `h2` for the page, `h3` for cards; monospace only for IDs, codes and YAML.
- The content is at most 72 rem wide and centered, with a 16 px margin on phones.
- **Size budget:** the JavaScript the page loads at start (the entry chunk and the chunks it imports, each gzipped, 1 KB being 1,000 bytes) stays within 190 KB; `npm run size` checks it and CI fails the build above it. Everything else loads on demand: the Library, Firmware and Editor views, the playlist editor, the YAML reader, the editor's document store (which brings the stored draft back right after the first paint) and ESP Web Tools.

### How each view applies the rules

```text
Board        [PixelArt  Board Library Firmware Editor   ● Connected: simulator 0.0.0   System ◐]
             Board: the files and settings on this board     [Upload files] [Upload folder] [⋯]
             (activity panel when an upload or wipe runs)                   ⋯: New playlist,
             ┌ Animations 30 ┐ Playlists 1                                    Refresh, Delete everything
             │ Ball        ball      1   2.8 KB   ▶ ✎ ⋯ │  ⋯: Download JSON, Download YAML, Delete
             playlist row: name, [Active] [⚠ 2 missing]   ⬇ Install missing, ✎ Edit, ⋯
             └──────────────────────────────────────────┘
             Settings card: brightness slider with value, active playlist select, a note with Install missing when the active playlist lacks animations
Library      Library: animations published with release 1.2.0          [Install all ▾]
             same tabs and table; columns: version, state (icon + word); actions ⬇ Install, ▶ Preview, ✎ Open in editor
Firmware     Firmware: install or update the board's firmware           [Update firmware]
             status card: "This board runs X. The latest release is Y." with a state badge
             separate card "Install from scratch" with its warning and its own button;
             a "Reset" card with an "Also reset the settings" box and Delete everything (same dialog as in the Board view)
Editor       ← Back to Board   Name field   save state   [Download YAML] [Upload to board] [⋯ Open file, New animation, Discard the draft]
             tabs Visual | YAML; side column: preview, diagnostics; activity panel while uploading
Playlist     wide panel: ID and name, items as rows (drag handle, animation select, repeat field, enabled switch, move and remove icon buttons),
editor       "Add animation", footer [Cancel] [Upload to board]
```

## Connection

The connection chip of the [app shell](#user-interface) is always visible. It shows the state (Not connected, Connecting, Connected, Lost) and, when connected, the board and its firmware version. Its panel shows the details, including the storage used and free, and holds the connect and disconnect controls.

### Transports

- **Board (USB).** "Connect board" asks the browser for a serial port (`navigator.serial.requestPort()`), then opens it at 115,200 baud with `bufferSize` 8,192 and keeps DTR and RTS low, so opening the port does not reset the board. Incoming bytes arrive in arbitrary pieces; a stream transform splits them into lines at `\n` and drops a `\r` before it. Lines longer than 16 KiB are dropped up to the next newline.
- **Simulator (WebSocket).** "Connect simulator" opens a WebSocket to the address in the field next to the button, `ws://127.0.0.1:8765` by default. The address is remembered in the browser. Each text message is one line. Chrome may ask the user to allow the page to reach devices on the local network the first time a page from the internet connects to `127.0.0.1`; the app says so next to the button.

Both transports deliver lines to the same protocol client. Lines that do not start with `@PR ` are ignored, as are lines with a bad CRC. Board lines with an `event` field and no `seq` are ignored, since protocol 1 defines no events.

Only one program can open a serial port. If the port is busy (the serial monitor or `tools/pixelart.py` holds it), the browser refuses to open it, and the app says to close the other program.

### Handshake and versions

Right after the transport opens, the client sends `info` and waits for the reply before anything else. It retries as described under [Requests](#requests), so a board that is still starting has time to answer.

- `info.protocol` must be `1`. Otherwise the app shows "This board speaks protocol N, which this web app does not know" and offers the Firmware view; it sends nothing else.
- `info.formats.animation` must contain `pixelart/1` and `info.formats.playlist` must contain `pixelart-playlist/1`. Otherwise uploads are disabled and the app offers a firmware update.
- `info.limits` gives the line length, chunk size, page size and file limits. The client uses these values, never the ones of the protocol document.
- `info.boot_id` is remembered. When a later `info` reports another value, the board has restarted: any upload in progress is gone, and the app reloads the file list and the settings.

### Requests

The client follows the rules of the protocol and does what `tools/pixelart.py` does:

- One request in flight. The next one is sent only after the reply or after the client gave up.
- The first `seq` is random, then it increases by one for each new request, wrapping after 4,294,967,295.
- Requests are written as `@PR <crc> <json>` with the CRC-32 of the JSON bytes, and the JSON escapes every character outside ASCII (`\uXXXX`), so a line's length in bytes equals its length in characters.
- The client waits 2 seconds for a reply, 10 seconds for `put_end` and `delete_all`, and sends the same request again with the same `seq`, up to 5 tries in all.
- A `bad_frame` reply makes the client send the request again at once, as one of the 5 tries.
- A reply whose `seq` is not the request in flight is discarded.
- After 5 tries without a reply the connection state becomes "lost". The user can reconnect; the app then sends `put_abort` if an upload was in progress.

The client never sends a path, only `kind` and `id`.

## Board view

Shown when a board or the simulator is connected.

### Files

Two lists, animations and playlists, read with `list` page by page until `more` is `false`. They follow the [list pattern](#list-pattern): the two tabs of a tab component, **Animations** and **Playlists**, each with its number of files, and a table that fills the card. The tabs follow the WAI-ARIA tabs pattern: Left and Right arrows move between them and wrap around, Home and End jump to the first and the last, and focus follows the selected tab. The Animations tab is shown first, and the other list keeps its state (an open preview) while it is hidden.

Each row shows the ID, the name, the version (animations) and the size (written on one line, for example `1,234 B`), then the actions, as described under [User interface](#user-interface):

- **Preview** (icon button, animations): the app downloads the file, loads it with its own engine and plays it in a 16x16 preview with play, pause and step.
- **Edit** (icon button): opens the file in the Editor (animations) or in the playlist editor (playlists). The Editor then offers a way back to the Board view, see [Opening a document](#opening-a-document).
- **More** menu: **Download JSON** saves the file as stored (`<id>.json`); **Download YAML** saves it converted to YAML (`<id>.yaml`); **Delete**, after a confirmation that names the file. Deleting the active playlist shows an extra line: the board will then play every animation.

The page header offers **Upload files** (primary) and **Upload folder**, and a **More** menu with **New playlist**, **Refresh** and **Delete everything** (see [Delete everything](#delete-everything)), as the [page pattern](#page-pattern) says.

A download reads the file with `get` in chunks of `info.limits.chunk` bytes and compares the SHA-256 of what it read with the one `list` reported. When they differ (the file changed during the download), it reads the file again once, then reports the error.

A file whose name or version the board could not read (the board leaves them out of `list`) is listed with its ID only, and can still be downloaded and deleted.

### Upload

**Upload files** accepts one or more `.json`, `.yaml` or `.yml` files, picked or dropped on the view. **Upload folder** takes every such file in a folder the user picks (the browser's folder picker), subfolders included; files with another extension are ignored without a message. All of them go through the [upload queue](#upload-queue), also one single file. For each file:

1. **ID.** The file name without its extension, lower-cased. When it does not follow the ID rule, the app asks for one, with the name as a suggestion.
2. **Kind.** From the document's `format` field: `pixelart/1` is an animation, `pixelart-playlist/1` is a playlist. Anything else is refused before upload, with the field's value in the message.
3. **Conversion.** A YAML file is converted to JSON as described in [YAML](#yaml). A JSON file is uploaded with its bytes unchanged.
4. **Check.** The app validates the JSON with its own engine. A file with errors is not uploaded: the app shows the diagnostics. Warnings are shown and do not stop the upload.
5. **Replace.** A stored file with the same kind, ID and SHA-256 is skipped, and a toast says the board already has it. When files differ from the stored ones, the queue asks once for all of them, see [Upload queue](#upload-queue). A folder or a selection with two files of the same kind and ID keeps the first and lists the second as left out, unless both are the same file.
6. **Upload,** as described in [Uploads](#uploads). The board validates the file again; its answer is what counts.

The board takes one upload at a time, so the app runs one upload at a time across the Board, Library and Editor views. The lock lives outside the views, so it holds after a change of view, and every view shows the activity panel with a **Cancel** button while an upload runs. Starting another upload while one runs is refused with the code `upload_busy` and the message "Another upload is still running. Wait for it to finish or cancel it."

### Upload queue

Every upload from the Board view (files, folder, drop), every install from the Library and the editor's **Upload to board** go through one queue, so they all behave the same:

1. **Check.** Every file is converted and validated by the app's engine first. A file with errors, or of another format, is listed with its diagnostics (one alert per file) and left out; the other files go on.
2. **Plan.** The queue reads the board's files with `list` and sorts each file into missing, identical (same SHA-256, skipped) or different. When some differ, one dialog lists them with their sizes and asks: **Replace them**, **Keep the board's** (only missing files are sent; the differing ones count as skipped) or **Cancel** (nothing is sent). The dialog starts on **Cancel**.
3. **Playlists bring their animations.** When the queue holds a playlist, it adds every animation the playlist names, enabled or not. It takes each one from the same selection or folder first, then from the published Library (downloaded and checked against the manifest, then compared with the board like any file: identical is skipped, different goes to the dialog above), then it accepts the board's own copy when only the board has it. Animations found nowhere are listed with the playlists that name them, and the dialog **Upload the playlist without all its animations?** offers **Upload the playlist anyway** (the board stores it with an `unknown_animation` warning, as today) or **Cancel**. An animation of the Library that cannot be downloaded or fails the check counts as found nowhere, unless the board stores it: then the board's own copy is used without a question. The dialog names only the playlists that reference each animation.
4. **Space.** Before sending anything, the queue reads `info` again and plays the files in send order against the free space in `info.storage` (total minus used), in blocks of 4,096 bytes. The board needs room for the new file while the old one still exists, so before each file the free space must hold the file's blocks, and a replaced file gives its blocks back only after its replacement is stored. When some file would not fit at its turn, nothing is sent and an alert says how much the files need, how much the board has free and how much more is needed at the tightest point. A board that reports no storage is not checked. When `info` cannot be read, nothing is sent and an alert says the board could not be read.
5. **Send.** Animations go first, playlists last, each kind in the order given, one file at a time. The queue holds the upload lock from the first file to the last, so no other upload can slip in between two files. The [activity panel](#user-interface) shows the file being sent ("File N of M"), its bytes and a **Cancel** button; **Cancel** sends `put_abort`, counts the file in progress as not attempted and stops.
6. **Stop at the first failure.** The queue stops at the first file the board refuses or that cannot be sent, so a playlist is never sent after one of the animations before it failed. Running the same queue again resumes, because identical files are skipped.
7. **Summary.** A toast says the outcome in one line ("Uploaded 3 animations and 1 playlist", "Installed animation bear", "Upload stopped at ball", "Nothing to upload"). When more than one file is involved, or something failed or was cancelled, an alert that stays until dismissed lists what was uploaded (or installed), skipped (the board has the same file, or the board's file was kept), failed (with the board's code and message and its diagnostics) and not attempted. Files that went through with warnings get an alert with the warnings, from the board when it gave some.

The queue is one at a time: while it asks a question or sends, the pickers and the Install buttons are disabled with the reason "Another upload is still running."

### Delete everything

**Delete everything** removes every animation and playlist on the board with the protocol's `delete_all` command; the firmware stays, and the settings stay unless the user also resets them. It is in the Board view's **More** menu (last, in the danger color) and in a **Reset** card of the Firmware view, with the same dialog in both. The app first reads the lists to count the files. A board with no files gets a toast ("The board has no animations or playlists"; in the Firmware view it adds "Check Also reset the settings to put the settings back to their defaults."), unless the settings are to be reset, see below. Otherwise a dialog names what will go (title "Delete all 30 animations and 1 playlist from this board?", text "This cannot be undone. The firmware and the settings stay.") with the button **Delete 31 files**; it starts on **Cancel**. In the Firmware view the button is disabled without a connected board and says so next to it.

The dialog has a checkbox **Also reset the settings**. It is unchecked each time the dialog opens from the Board view. The Firmware view's **Reset** card has the same checkbox, unchecked by default, above its **Delete everything** button, and the dialog opens with its checkbox as the card's is; the card's box is then cleared, so the next Delete everything starts with it off again. On a board with no files and the card's box checked, the dialog asks only for the reset: title "Reset the settings of this board?", text "The board has no animations or playlists. The settings go back to their defaults: brightness 100 and active playlist default.", button **Reset the settings**, and the app sends `delete_all` with `settings: true`, which removes nothing. When it is checked, the text says what goes back to its default ("This cannot be undone. The firmware stays; the settings go back to their defaults: brightness 100 and active playlist default."), the button becomes **Delete 31 files and reset the settings**, and the app sends `delete_all` with `settings: true`, so the board removes the files and then resets the settings in one command. While it runs, the activity panel says "Deleting every animation and playlist and resetting the settings". The toast says so ("Deleted 30 animations and 1 playlist and reset the settings", or "Reset the settings" when there was no file to remove), with a second line "The settings are back to their defaults: brightness 100 and active playlist default.", and the Board view reads the settings again. Without the checkbox the request carries no `settings` field, so a firmware older than that field still deletes everything. A firmware that does not know the field answers `bad_request` and deletes nothing: the app says "The firmware of this board cannot reset the settings", that nothing was deleted, and offers the Firmware view, or Delete everything without the reset (for the settings-only reset of a board without files it says that nothing was changed and the firmware needs an update). After a `storage_error`, **Run it again** repeats the same choice, and the alert says so ("Running it again removes the rest and resets the settings.").

While the command runs, the app holds the upload lock, so no upload can start, and the activity panel says "Deleting every animation and playlist" with a bar that only shows that work goes on and no **Cancel** (the command cannot be stopped). Afterwards the view reads the files again, and a toast says how many were removed. A board whose firmware does not know the command answers `unknown_command`; the app then says the firmware must be updated, with a link to the Firmware view (not shown in the Firmware view itself). When the board answers `storage_error`, the app shows the message, says that the files removed before stay removed, and offers **Run it again**. Any other error is shown as an alert.

The dialog adds a line when the editor holds one of the animations that will go and its only saved copy is that board file, see [Where the work is saved](#where-the-work-is-saved).

### Uploads

An upload follows the protocol's [upload sequence](../protocol/protocol-v1.md#uploads), with the same recovery as `tools/pixelart.py`:

- `put_begin` with kind, ID, size and SHA-256, then `put_chunk` with chunks of `info.limits.chunk` bytes, waiting for each reply, then `put_end`.
- After an acknowledged chunk, the next offset is the reply's `received` when it is larger than the client's own count.
- `bad_offset` resumes from `expected`, at most 5 times per upload.
- `no_upload`, or a changed `boot_id`, restarts the upload from `put_begin` once; a second one fails the upload.
- Any other error sends `put_abort` and reports the error.
- When the connection is lost, the upload fails; after a reconnection the app sends `put_abort`.

### Errors

Every error of the board is shown with its code and the board's message. An `invalid_file` reply also shows the diagnostics as a table: severity, code, place (`where`) and message. The app's own validation uses the same table, so a file looks the same whether the app or the board rejected it. The text of messages and places comes from files and boards and is always shown as plain text.

### Settings

- **Brightness:** a slider from 0 to 255 with the number next to it, sent with `settings_set` when the slider is released. A note says that animations can lower it with their own `brightness`, never raise it.
- **Active playlist:** a menu of the stored playlists. Choosing one sends `settings_set {playlist}`. When the setting names a playlist that is not stored (it was deleted), the menu shows it as missing and says the board plays every animation. When the active playlist names animations the board does not store, a warning note under the menu lists them and offers **Install missing** (see [Missing animations](#missing-animations)).

The view shows the settings from the reply to `settings_set`, not the values the user asked for. When the settings cannot be read, the Settings card says "Could not read the board's settings." with a **Retry** that reads the settings again and nothing else.

### Missing animations

A stored playlist can name animations the board does not store (they were deleted, or never uploaded). The app reads each stored playlist from the board and compares the animations it names, enabled or not, with the stored animation list. Nothing is called missing while a list is not known (still being read, or unreadable), or while a playlist could not be read.

- **Playlists tab:** a playlist with missing animations shows a warning badge with an icon and the word, "2 missing", next to its name. A tooltip (also on keyboard focus) lists at most 10 missing animations, then "and N more", so it stays shorter than the screen; the accessible name lists them all. A row **Install missing** icon button sends the missing animations that `./manifest.json` publishes through the [upload queue](#upload-queue); the ones that are not published are listed in the tooltip as "not available in the Library". The button is not shown when none of them is published.
- **Settings card:** the active playlist gets the same warning as a note with the list (at most 10 names, then "and N more"; assistive technology reads them all), "Not available in the Library: ..." for the unpublished ones, and an **Install missing** button.
- **Playlist editor:** each item whose animation is not stored is marked "Not stored". When the release publishes it, the item has an **Install** icon button for that animation; otherwise it says "Not available in the Library".

### Playlist editor

Edits any stored playlist (**Edit** in the Playlists tab), or a new one (**New playlist**) with an ID the user chooses (the ID rule applies). The editor opens in a wide panel of the [list pattern](#list-pattern), so it is in view however many files are stored and an item fits on one line on a wide screen; its footer has **Cancel** and **Upload to board**. It shows the playlist's name and its items in order. For each item: the animation (a menu of the stored animations, plus the current value when it is not stored), `repeat` (1 to 1,000) and `enabled`. Items can be added, removed and moved up and down, with the **Up** and **Down** icon buttons or, with a pointer, with the drag handle at the start of each item:

- **With a pointer** (mouse, pen or touch), dragging the handle moves the item over the others: it takes its new place as soon as the pointer passes the middle of another item, and it is marked while it moves. Near the edge of the scrolling area the list scrolls, and keeps scrolling while the pointer rests there; it stops when the pointer leaves the edge, the list cannot scroll further, or the drag ends or is cancelled. Releasing drops it; a cancelled touch puts it back.
- **With the keyboard**, the **Up** and **Down** buttons move an item one place; focus stays on the button of the moved item, so pressing it again keeps moving the same item. When the move reaches the top or the bottom, that button is disabled and focus goes to the item's other move button. After **Remove**, focus goes to the **Remove** button of the item that takes its place, or of the item before it when the last one went, or to **Add animation** when the list is empty (to the name field when no animation can be added). The handle is for a pointer only: it is not focusable and is hidden from screen readers (its tooltip "Drag to reorder" is the browser's own), so nothing in the tab order does nothing.
- **Every move is announced** to screen readers in a polite live region: a move with **Up** or **Down** ("ball moved to position 2 of 30."), the end of a drag ("ball dropped at position 2 of 30.", or "ball dropped at its place, position 3 of 30." when it did not move), a cancelled drag ("Move cancelled. ball is back at position 3 of 30.") and a removal ("ball removed. 29 items left.", or "No items left." for the last one).
- **A missing animation's mark** ("Not stored", with **Install** when the Library has it) sits under the item's animation field, aligned with it.

No drag-and-drop library is used: the handles work with the browser's pointer events, which adds nothing to the download. The repeat field can be emptied while the user types; it takes the number once it is a whole number from 1 to 1,000, and shows the stored value again when the field loses focus with anything else in it. **New playlist** is unavailable while the editor is open. **Edit** on another playlist while the editor has unsaved changes asks first ("Discard the unsaved changes to playlist ID and open playlist ID?", with **Discard and open** and **Keep editing**; a playlist is named by its ID, and one that has no ID yet is called "the new playlist"). A repeat field with something else than a whole number from 1 to 1,000 shows "Whole number from 1 to 1,000." next to it. Every opening moves focus to the editor's heading.

**Upload to board** builds the playlist document, validates it with the app's engine, and sends it through the [upload queue](#upload-queue) as a single file, so it gets the same space check. A new playlist whose ID the board already stores asks the queue's question about a differing file; an opened playlist replaces the stored one without a question, and a playlist the board already stores unchanged is not sent again. The panel shows the result, with a toast, and not the queue's own alerts. When nothing was sent because the user answered **Cancel**, or **Keep the board's** to the question about a stored ID, a toast says so ("Nothing was sent", "Kept the board's playlist ID; nothing was sent") and the panel stays open. Items that name an animation that is not stored are allowed and marked, and the queue does not ask about them: the board stores the playlist with an `unknown_animation` warning, which the panel shows (for an unchanged playlist the app shows the same warning itself). The saved document keeps the fields of the original and writes `repeat` and `enabled` only when they differ from their defaults.

## Library view

Lists the animations and playlists published in `./manifest.json` (see [Latest release](#latest-release)), with their name and version, and a preview of each animation. Without a manifest (nothing published yet, or running from `make web-dev`), the view says that nothing is published.

When a board is connected, each entry shows whether the board has it:

- **Not on the board:** no stored file with that ID.
- **Same:** the stored file has the published SHA-256.
- **Different:** the stored file has another SHA-256 (another version or a local change).

The lists follow the [list pattern](#list-pattern), like the Board view, with the state on the board as a column; the row actions are the icon buttons **Install** (on every row, disabled with a tooltip on the ones the board already has the same), **Preview** and **Open in editor** (animations), with no menu, because no row has two actions to fold away. **Install** downloads the published file, checks its size and SHA-256 against the manifest, and sends it through the [upload queue](#upload-queue). On a playlist, the install brings the animations it names (the button's tooltip says so). The **Install all** menu in the page header offers all animations, all playlists, or everything, with their counts; files the board already has identical are skipped, and differing ones are asked about once.

## Firmware view

### Latest release

The app reads `./manifest.json`, relative to its own address, with `cache: "no-cache"`, so the browser checks with the server instead of using a copy up to 10 minutes old. A manifest that does not load, is not valid JSON, or has a `format` other than `pixelart-manifest/1` counts as no release; the view then says that no firmware release is published yet.

### Version check

When a board is connected, the view compares `info.firmware` with the manifest's `version` by Semantic Versioning precedence:

The status card says "This board runs Y. The latest release is X." and a badge gives the result:

- **Older:** the badge "Update available".
- **Same:** "Up to date".
- **Newer** (a board built from a newer commit): "Newer than the release".
- **Development builds** report versions such as `1.2.0-dev.3+gabc1234` or `0.0.0-unknown`. A pre-release sorts below its release, so a development build of an older or the same version counts as older; the view adds the badge "Development build".

A version that is not valid Semantic Versioning is shown as it is, with no comparison.

When the board is not connected, the view still offers the install button, since an empty board cannot answer the protocol.

### Install and update

The buttons are ESP Web Tools install buttons, loaded only when the Firmware view opens:

- **Update firmware** uses `./firmware/update.json`: it writes the bootloader, the partition table, `boot_app0` and the firmware, and keeps the animations, playlists and settings.
- **Install from scratch** uses `./firmware/install.json`: it also writes the published animations and playlists, and ESP Web Tools offers to erase the board first. Erasing deletes the settings and every stored file. The view says so before the button.

ESP Web Tools detects the chip and picks the matching build (ESP32-C3, ESP32, ESP32-S3) from the manifest.

The serial port can only be open once, so the app closes its own connection before ESP Web Tools opens the port, and says so. After the installation the board restarts; the app offers "Connect board" again and then shows the new version.

## Editor view

The editor opens an animation from a file (`.yaml`, `.yml`, `.json`), from the board (Edit in the Board view), from the Library, or as a new animation from a template. It edits the whole `pixelart/1` format.

### Opening a document

Every opening shows what the user asked for, never an older document or a stored draft. A draft that the browser's storage returns late (after 3 seconds) is restored only if nothing was opened or edited meanwhile.

- **Without unsaved changes** the new document opens at once. A restored draft that had no unsaved changes counts as none.
- **With unsaved changes** a dialog appears at once, in the view where the user is (an **Edit** in the Board view or an **Open in editor** in the Library view asks there, not after a jump to the Editor): "Discard the unsaved changes to NAME and open NAME?", with **Discard and open** and **Keep editing**. Escape also keeps the document. Names are the `name` of each animation, or where it came from when it has none. The app then shows the Editor with the document the user ended up with, also after **Keep editing**. An opening replaced by a newer one does not show the Editor; the newer one decides.
- **The Editor menu item** only shows the document being edited and opens nothing.
- **Back:** when an animation was opened from the Board view (**Edit**) or the Library view (**Open in editor**), the Editor shows **Back to Board** or **Back to Library** above the toolbar. It stays while that document is edited, also after the user has been to another view and returned with the menu. The way back is stored with the draft, so it also stays after a reload. Opening a file or a new animation shows no such button. After the user presses **Back**, keyboard focus moves to the heading of the view shown.
- **After Upload to board** succeeds, the editor stays open and shows the success note next to the upload button, with the way back still there. Opening another document clears that note and any other save or upload result. Returning to the Board view reads the files again, so the uploaded file is in the list.

### Layout

- **Palette:** the named colors, each with its name and a color picker with a hex field. Colors can be added, renamed and deleted. Renaming a color updates every place that uses its name; deleting one that is used asks first, then replaces it with its hex value in every place. The current drawing color is a palette entry or a hex value.
- **Sprites:** the list of sprites, with add, rename (references follow), duplicate and delete (a sprite still referenced asks first). Each sprite is either a points sprite or a composite.
- **Grid:** a 16x16 grid for the selected points sprite, drawn at its home position `at`. Tools: draw (current color), erase, pick a color from the grid. Moving the sprite changes `at`. Points outside the 16x16 canvas are kept and listed under the grid; they are edited in the YAML tab. The sprite's `pivot` is set with a field and shown on the grid.
- **Composite:** for a composite sprite, its parts in order, each a sprite and an optional `at` for this composite only; parts can be added, removed and moved.
- **Timeline:** the items in order, frames and loops nested as in the file. Items can be added, duplicated, deleted, moved, and put into or taken out of a loop. A loop has its count. A frame has `ms` (empty means the animation's `frame_ms`), `repeat`, `recolor` (pairs of colors) and its `show` list. Each entry of `show` is a sprite and the optional fields of a sprite reference: `at`, `move`, `wrap`, `rotate`, `spin`, `flip` and `pivot`, as form fields.
- **Animation:** `name`, `version`, `author`, `description`, `frame_ms`, `brightness` (1 to 100 percent of the board setting) and `background`.
- **YAML tab:** the whole document as YAML text, see [YAML tab](#yaml-tab).
- **Preview:** the animation played by the app's engine, with play, pause, step, the frame number and the timeline item that produced the frame. Selecting a timeline item moves the preview to its first frame.
- **Diagnostics:** the engine's errors and warnings for the current document, updated as the user edits, in the table described under [Errors](#errors).

Every change can be undone and redone (at least 100 steps).

### Writing the document

The editor keeps the document as data and changes only what the user changed. Fields keep their order. A sprite whose points are edited on the grid is written with its points grouped by color, in the order in which each color first appears on the grid row by row; other sprites keep the form they had. Optional fields equal to their default are left out when the editor creates them, and kept when the file had them.

### YAML tab

The YAML tab shows the document as YAML and accepts edits. While the text is not valid YAML, the visual editor keeps the last valid document and the tab shows the parse error with its line. When the text parses, it replaces the document and the visual editor follows. Comments are kept in the YAML tab while the user edits there; a change made in the visual editor rewrites the text and drops the comments, and the tab says so.

### Where the work is saved

The editor's document has two real copies only: the file on a board (**Upload to board**) and a YAML file the user downloads (**Download YAML**). The browser draft (see [Saving](#saving)) protects against a reload, but it is not a backup: it is lost when the browser's data is cleared, and it is not on another browser or computer. The editor makes this visible at all times.

- **Save state.** The editor header always shows where the current version lives:
  - **Draft in this browser only**, in the warning color, for a new animation, an animation from the Library, or any document never uploaded or downloaded since it was opened.
  - **Saved to board as `<id>` at `<time>`** after an upload, or when the animation was opened from the board with **Edit** (the time is then the opening).
  - **Downloaded as `<id>.yaml` at `<time>`** after **Download YAML**, or **Same as `<file name>`** for a document opened from a file.
  - **Changed since** in front of the last one (for example "Changed since: saved to board as `ball` at 10:42", or "Changed since: opened from `ball.yaml`" for a file), in the warning color, when the document differs from what was last uploaded or downloaded. The comparison is on the document's content, so undoing back to the saved version shows it as saved again.
  - Times are the browser's local time as `HH:MM` (24 hours).
  - When both copies exist and are current, the header shows the most recent, and its tooltip lists both; the tooltip marks an older version of a copy that no longer matches.
  - A document opened with **Open file** starts as **Same as** that file; a new document and one opened from the Library start as a draft.
  - The save state is kept with the draft, so it is still right after a reload.
  - When a board is connected, "Saved to board" is checked against that board's files: if the board has no file with that ID, or one with another SHA-256 (another board, or the file was changed or deleted), the header says **Not on the connected board** instead, unless a current download exists.
  - The board's file lists are read again when a board connects or restarts, when the Editor view opens, and after every upload, delete and **Delete everything**, so a file removed from any view is noticed at once.
  - While nothing is known about the board's files (the first read after connecting is not done, or the last read failed), the header says **Board copy not checked**, in the warning color, unless a current download exists.
  - During a re-read after a change, the header is judged by the last known list. A copy the editor saved after that read began counts as on the board until the new list arrives, so an upload from the editor never makes the header flicker to a warning.
- **The two saves are the primary actions.** **Upload to board** (primary button) and **Download YAML** stay in the editor header, next to the save state, in every tab.
- **First use.** The first time the editor opens in a browser, a short note explains: "Your work is kept in this browser as a draft. It is not a backup: clearing the browser's data, using another browser, or deleting the animation from the board can lose it. Upload to board or download the YAML file to keep it." **Got it** hides it for good in that browser (if the browser refuses to remember, the note shows again next time).
- **Leaving the page.** While the document has changes saved nowhere (the save state is "Draft in this browser only" with changes, or "Changed since"), closing the tab, reloading or leaving the page asks the browser's standard question first. The question is also asked for "Not on the connected board" or "Board copy not checked" with no current download, since the board file may be the only copy. Without a connected board the board copy counts. An unchanged new animation, and an opened document with no change, can be left without a question; so can a changed one after an undo back to a saved version. A YAML tab with an error always counts as unsaved.
- **Deleting the only copy.** When the editor holds an animation whose only saved copy is the board file about to be deleted (the save state is "Saved to board" for that ID, with no current download), the confirmation of **Delete** in the Board view, and of **Delete everything**, adds: "The editor holds this animation and it has no other saved copy." with a **Download YAML first** button next to the confirm button. The button downloads the editor's YAML as `<id>.yaml` and the warning goes away, since the document then has a second copy. While the YAML tab has an error, the download is refused, as for **Download YAML**.

### Saving

- **Download YAML:** downloads `<id>.yaml`, in the format the repository uses: the same document the editor shows, hex colors quoted. While the YAML tab has an error, nothing is saved and the editor says so, because the file would not match the text on screen. **Upload to board** is refused the same way, before it asks for an ID, because the board would receive the last valid document and not the text on screen; the document stays unsaved.
- **Upload to board:** converts and uploads like the Board view's [Upload](#upload) through the [upload queue](#upload-queue), with the ID chosen at the first save. The result is shown next to the buttons instead of as a toast: uploaded, "The board already has this exact animation" (a file that is identical counts as saved to the board), skipped (**Keep the board's**) or cancelled.
- **Drafts:** the document being edited is kept in the browser's storage shortly after every change (a short delay joins quick changes into one write), so a reload or a closed tab does not lose it. Drafts stay in the browser that made them; files on the board and saved YAML files are the real copies, see [Where the work is saved](#where-the-work-is-saved).
- **A restored draft:** when the app starts and finds a draft, the editor brings it back, whichever view the page shows. The draft records whether the document had unsaved changes. A draft with unsaved changes shows a note, in the Editor view, with the time it was saved; a draft without them comes back silently and is replaced by the next opening without a question. **Dismiss** hides the note and keeps the draft. **Discard the draft** deletes it and starts from a new animation. The **Discard the draft** item of the editor's More menu does the same after a confirmation.
- **When the page crashes:** if drawing a view fails, that view is replaced by a notice with the error message, and the top bar still works. **Reload the page** is offered in every view, and the draft comes back when the page loads again. Only in the editor, a second action, **Discard the draft and start again**, deletes the stored draft and reloads, so a draft that crashes the editor cannot make every visit crash. It first asks for confirmation and says that the draft will be deleted. A crash in another view never offers it, because the draft is not the cause.

## Engine

The app has its own implementation of the formats, in TypeScript, with no access to the page: it runs in the browser and in Node for the tests. It parses, validates and plays `pixelart/1` and `pixelart-playlist/1` exactly as the engine in `lib/PixelEngine/` does: the same limits, the same error and warning codes, the same `where` places, at most 32 diagnostics per file with the same rule for which ones are kept, and the same frames. The text of messages may differ.

- `loadAnimation(bytes)` returns the animation, or the diagnostics that reject it. The input is the file's bytes, so the app checks exactly what it uploads.
- A player gives the frames in order: for each, its duration and the color of each of the 256 pixels.
- `loadPlaylist(bytes)` returns the enabled items, or the diagnostics.
- `effectiveBrightness(board, percent)` implements the [brightness rule](../format/pixelart-v1.md#brightness).

Both engines read strict JSON as the [format specification](../format/pixelart-v1.md#files) requires. The browser's `JSON.parse` turns `1.0` into the integer 1, but `1.0` is not an integer in the format, so the engine has its own JSON reader that keeps integers and other numbers apart.

The engine passes every case of the [conformance suite](../../conformance/README.md), checked in CI. The suite is the contract between the two engines: a difference between them is fixed with a new case that both must pass.

## YAML

The app reads YAML the way `tools/pixelart.py` does, so a file gives the same JSON in the app and on the command line:

- YAML 1.1 rules, as PyYAML applies them: `yes`, `no`, `on` and `off` are booleans, and numbers keep their YAML 1.1 forms.
- A key repeated in the same mapping, or a key that is not a string, is an error.
- Only plain data: no custom tags, no aliases that build unbounded structures (the reader refuses a document in which aliases expand to more than 100,000 nodes in total, and YAML text over 256 KiB).
- The JSON is written compact, with no spaces, keys in the order of the YAML text, and characters outside ASCII written as they are (UTF-8), without a final newline.
- A YAML number with a fraction or an exponent stays a non-integer in the JSON (written with a fraction, for example `100.0`), so the engine rejects it where an integer is required, exactly as it would reject the command line's output.

For every animation and playlist of the repository, the app's conversion gives the same bytes as `make data`. A test checks it.

Converting JSON back to YAML (Download as YAML, the YAML tab) writes block style for mappings, flow style for points and coordinate pairs, and quotes every hex color.

## Publishing

The firmware and the web app are released separately, each with its own version, tag and changelog, by release-please:

- **Firmware:** everything in the repository except `web/`. Tags `vX.Y.Z`, changelog `CHANGELOG.md`, as described in the README. A firmware release attaches `pixelart-site-<version>.zip` and the factory images to its GitHub Release.
- **Web app:** the `web/` folder. Tags `web-vX.Y.Z`, changelog `web/CHANGELOG.md`, version in `web/package.json`. A web release attaches `pixelart-web-<version>.zip`, the built app, to its GitHub Release.

A commit that changes only `web/` releases only the web app. A commit that changes `web/` and other files counts for both.

A Pages deployment replaces the whole site, so every deployment publishes the latest firmware release and the latest web release together. After either release, for each package the workflow takes the highest release that is neither a draft nor a pre-release, has a tag of the exact form (`vX.Y.Z` or `web-vX.Y.Z`) and already carries its archive. A newer release that does not carry its archive yet is skipped, because it can still be building or its publish can have failed. A failed query of GitHub Releases fails the job and is never read as "no release". The workflow downloads the two archives, unpacks the firmware site and then the web app into one folder, and deploys it. When one of the two has never been released, the deployment publishes the other alone. The web app's files never overwrite a release file: a name present in both archives fails the deployment.

The published site:

| Path                                             | Content                                                    |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `index.html`, `assets/`                          | The web app.                                               |
| `manifest.json`, `firmware/`, `animations/`, ... | The firmware release, as described in the manifest format. |

`make release-site` builds both from the working tree into `site/`, the site Pages would show if both were released from that commit. CI builds it for every pull request and on `main`.

The firmware version rules do not change: only tags of the form `vX.Y.Z` count, so `web-v` tags never change a firmware version.

## Security

- **Untrusted text.** File content, board replies and the manifest are untrusted. The app shows their text only as text, never as HTML, and never builds a link or an address from it. Previews draw pixels on a canvas.
- **Content Security Policy.** Pages cannot send headers, so the page carries the policy in a `<meta>` tag: scripts, images and fonts only from the site itself, styles from the site itself and inline (Radix inserts a `<style>` element while a dialog is open), connections only to the site itself and to WebSockets on `127.0.0.1` and `localhost`, no plugins (`object-src 'none'`), no `<base>` change (`base-uri 'none'`), and no inline scripts.
- **Dependencies.** Every library is bundled into the site at build time; the published page loads nothing from other servers. Versions are pinned exactly, `package-lock.json` is committed, CI installs with `npm ci`, and dependency install scripts never run (`ignore-scripts=true` in `web/.npmrc`). Dependabot proposes updates weekly.
- **Board access.** The browser lets the page use a serial port only after the user picks it. The simulator accepts WebSocket connections only from the origins listed in the protocol, and has no authentication, as the protocol says.
- **Deployment permissions.** The deployment job has only `pages: write`, `id-token: write` and `contents: read`; the jobs that create releases are the only ones with `contents: write`.

## Tests

- **Engine:** the whole conformance suite (`conformance/valid`, `invalid`, `playlist/valid`, `playlist/invalid`) with the rules of `conformance/README.md`, and the brightness rule from `conformance/brightness.json`, which the C++ tests read too.
- **YAML:** the conversion gives the bytes of `make data` for every repository file; the YAML 1.1 cases, duplicate keys, non-string keys and floats above.
- **Protocol client:** framing, CRC, retries, `bad_frame`, discarded replies, upload recovery (`bad_offset`, `no_upload`, changed `boot_id`), line splitting of serial data arriving in arbitrary pieces, and oversize lines, against a scripted fake board.
- **End to end:** Playwright drives the built app in Chromium against the simulator started with `--ws` on a temporary data folder: connect, list, upload a valid file, upload a rejected file and see its diagnostics, download and compare, delete, change brightness and the active playlist, edit and save a playlist, create an animation in the editor, upload it and see it listed. Web Serial and ESP Web Tools need a real board and a user's choice of port, so they are tested by hand on a real board.
- **Upload queue:** unit tests of the planner (missing, identical and different files, ordering, the space arithmetic with block rounding and the order of replaced files, where a playlist's animations come from, the stop at the first failure and no playlist after a failed animation) and of the queue's run against the scripted fake board (the questions about differing and missing files, the reasons for a refusal, cancel, one lock for the whole queue, cancel with `put_abort`, resume on a second run), and of `deleteAll` with its 10-second wait. End to end against the simulator: Upload folder, a playlist with its animations from the selection and from the Library, the missing-animation dialog, Install all with a differing file (each choice), a playlist installed from the Library, cancel in the activity panel. A board scripted in the page covers what the simulator cannot give: a small storage, a refused file.
- **Missing animations:** unit tests of the computation (what a playlist names against the stored list, unknown lists, the split into published and not published); end to end for the badge with its count and tooltip after deleting animations a playlist uses, the editor marks, the active playlist note, **Install missing** through the queue with a published and an unpublished animation, and the row **Install** of a missing animation and of a missing playlist with its animations.
- **Delete everything:** end to end from the Board view and from the Firmware view (counts in the dialog, files and settings afterwards), with and without **Also reset the settings** (the dialog text and button, unchecked again on every opening, the Reset card's own box starting the dialog checked, the settings-only reset of a board without files, the activity panel text and the toast, brightness 100 and playlist `default` afterwards, no `settings` field without the checkbox), the activity panel and the upload lock while it runs, and, with a scripted board, `unknown_command` (update message with the link), `bad_request` to the `settings` field (nothing deleted) and `storage_error` (run again); unit tests of `deleteAll` with and without the reset.
- **Playlist editor:** end to end for the wide panel (the content width above the lists at 1,280 px, the whole screen at 375 px, modal there, with focus kept in it and the page behind hidden, and not modal when opened on the wide screen, where a discard question asked from it still works after the window narrows), reordering by dragging a handle with the mouse, reordering from the keyboard with **Up** and **Down** (focus following the moved item, every move announced, the handles out of the tab order and hidden from screen readers), the missing-animation mark aligned under the animation field at both widths, a cancelled touch drag putting the item back, the panel scrolling while a dragged item rests near its edge and stopping when it leaves the edge or the drag ends, focus and the announcement after **Remove** (the next item, the previous one, then **Add animation**), each reorder checked against the playlist the board stores after the upload.
- **Editor save state:** unit tests of the state for every case (draft, saved to board, downloaded, same as file, changed, not on the connected board), of the editor's copies and of the leave-the-page question, including a board copy that the board no longer has; end to end through upload, download, edit, undo, the board's file removed, the first-use note (also with blocked storage), the leave-the-page question and the delete warnings with **Download YAML first**.
- **Theme:** an end-to-end test cycles the theme button through System, Dark and Light (tooltip, accessible name, keyboard), checks the page follows an emulated operating system change only on System, checks the choice survives a reload, and checks that with storage blocked the app starts on System.
- **Look:** Playwright compares screenshots of every view and its main states (not connected, connected, empty, lost connection, dialogs, side panels, progress, errors), 1,280 px and 375 px wide, in both themes, and checks that no page scrolls sideways. Each state is its own test with its own simulator, started on board files and a published release that belong to the suite (`web/screenshots/board-files/`), with a fixed clock, time zone and firmware version, so nothing but a change of the app moves a picture. The comparison runs inside the official Playwright container, in CI and locally with `make web-screenshots` (`make web-screenshots-update` draws the reference images again), so text renders the same everywhere. The reference images are kept in `web/screenshots/baselines/`, so a layout change is a reviewed change. The suite is separate from the functional end-to-end tests, which run on the host with `make web-e2e`.

CI runs the type check, the linter, the unit tests, the conformance suite, the build and the end-to-end tests on every pull request and on `main`. `make check` runs the type check, the linter and the unit tests too.

## Limits of version 1

- No WiFi connection: boards are reached over USB only. Phase 4 adds WiFi.
- No board settings beyond brightness and the active playlist.
- No import of GIF or PNG images.
- Older firmware releases are installed from their GitHub Release with `esptool`, not from the web app.
