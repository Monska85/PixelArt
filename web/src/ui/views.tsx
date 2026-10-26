// SPDX-License-Identifier: GPL-3.0-or-later

import { Suspense, lazy, type ReactNode } from "react";
import { LoadingNote } from "./common/LoadingNote";
import { BoardView } from "./board/BoardView";

// Every view but the Board is loaded when it is opened, so the first load holds only what the Board needs.
const PrivacyView = lazy(() => import("./privacy/PrivacyView").then((m) => ({ default: m.PrivacyView })));
const LibraryView = lazy(() => import("./library/LibraryView").then((m) => ({ default: m.LibraryView })));
const FirmwareView = lazy(() => import("./firmware/FirmwareView").then((m) => ({ default: m.FirmwareView })));
const EditorView = lazy(() => import("./editor/EditorView").then((m) => ({ default: m.EditorView })));

const loading = (what: string, view: ReactNode): ReactNode => (
  <Suspense fallback={<LoadingNote>Loading {what}...</LoadingNote>}>{view}</Suspense>
);

interface View {
  /** The fragment of the address: `#board`. */
  id: string;
  title: string;
  /** Left out of the navigation: reached from a link on the page (the footer). */
  hidden?: boolean;
  render: () => ReactNode;
}

// New views are added here; the bar and the address follow.
export const VIEWS: View[] = [
  { id: "board", title: "Board", render: () => <BoardView /> },
  { id: "library", title: "Library", render: () => loading("the Library", <LibraryView />) },
  { id: "firmware", title: "Firmware", render: () => loading("the firmware page", <FirmwareView />) },
  { id: "editor", title: "Editor", render: () => loading("the editor", <EditorView />) },
  { id: "privacy", title: "Privacy", hidden: true, render: () => loading("the privacy page", <PrivacyView />) },
];
