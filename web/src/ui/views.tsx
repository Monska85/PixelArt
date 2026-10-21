import { Suspense, lazy, type ReactNode } from "react";
import { LoadingNote } from "./common/LoadingNote";
import { BoardView } from "./board/BoardView";

// Every view but the Board is loaded when it is opened, so the first load holds only what the Board needs.
const LibraryView = lazy(() => import("./library/LibraryView").then((m) => ({ default: m.LibraryView })));
const FirmwareView = lazy(() => import("./firmware/FirmwareView").then((m) => ({ default: m.FirmwareView })));
const EditorView = lazy(() => import("./editor/EditorView").then((m) => ({ default: m.EditorView })));

const loading = (what: string, view: ReactNode): ReactNode => (
  <Suspense fallback={<LoadingNote>Loading {what}...</LoadingNote>}>{view}</Suspense>
);

export interface View {
  /** The fragment of the address: `#board`. */
  id: string;
  title: string;
  render: () => ReactNode;
}

// New views are added here; the bar and the address follow.
export const VIEWS: View[] = [
  { id: "board", title: "Board", render: () => <BoardView /> },
  { id: "library", title: "Library", render: () => loading("the Library", <LibraryView />) },
  { id: "firmware", title: "Firmware", render: () => loading("the firmware page", <FirmwareView />) },
  {
    id: "editor",
    title: "Editor",
    render: () => loading("the editor", <EditorView />),
  },
];
