import { ToastProvider } from "@radix-ui/react-toast";
import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "./common/ErrorBoundary";
import { TooltipProvider } from "./components/tooltip";
import { Toaster } from "./components/toaster";
import { takeFocusRequest } from "./navigation";
import { boardFilesOf } from "./editor/boardFiles";
import { session, useSession } from "./session";
import type { BoardFileList } from "./fileLists";
import { ConnectionAlerts } from "./shell/ConnectionAlerts";
import { TopBar } from "./shell/TopBar";
import { theme } from "./theme";
import { VIEWS } from "./views";

// The editor's store and its dialog hold the YAML library: they load right after the first paint, not with it.
const OpeningDialog = lazy(() => import("./editor/OpeningDialog").then((m) => ({ default: m.OpeningDialog })));

const viewFromHash = (): string => {
  const id = window.location.hash.replace(/^#/, "");
  return VIEWS.some((view) => view.id === id) ? id : (VIEWS[0]?.id ?? "");
};

/** The state of a session list as attributes on the shell, for tests that wait for a read to land. */
function listAttributes(kind: "animations" | "playlists", list: BoardFileList) {
  return {
    [`data-list-${kind}`]: list.status,
    [`data-list-${kind}-count`]: list.status === "known" ? list.entries.length : undefined,
  };
}

export function App() {
  const { files } = useSession();
  const [current, setCurrent] = useState(viewFromHash);
  useEffect(() => {
    const onHash = (): void => setCurrent(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // After a navigation that asked for it, focus the new view's heading, or the content when it has none yet.
  useEffect(() => {
    if (!takeFocusRequest()) return;
    const target = document.querySelector<HTMLElement>("#main h2") ?? document.getElementById("main");
    target?.setAttribute("tabindex", "-1");
    target?.focus();
  }, [current]);
  // The stored draft comes back before anything is opened, whichever view the page starts on. Leaving the page
  // asks a question while the work is saved nowhere, judged against the board's files the session keeps.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let unmounted = false;
    void import("./editor/store").then((store) => {
      void store.editorStore.start();
      if (!unmounted) stop = store.watchLeaving(() => boardFilesOf(session.getSnapshot()));
    });
    return () => {
      unmounted = true;
      stop?.();
    };
  }, []);
  // The theme follows the operating system while the choice is System.
  useEffect(() => theme.start(), []);
  const view = VIEWS.find((v) => v.id === current) ?? VIEWS[0];

  return (
    <TooltipProvider delayDuration={300}>
      <ToastProvider swipeDirection="right" label="Notifications">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
          href="#main"
          onClick={(event) => {
            // A fragment would change the view: move focus instead.
            event.preventDefault();
            document.getElementById("main")?.focus();
          }}
        >
          Skip to the content
        </a>
        <TopBar views={VIEWS} current={view?.id ?? ""} />
        <main
          id="main"
          className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 focus:outline-none"
          {...listAttributes("animations", files.animation)}
          {...listAttributes("playlists", files.playlist)}
        >
          <ConnectionAlerts />
          <ErrorBoundary key={view?.id} canDiscardDraft={view?.id === "editor"}>
            {view?.render()}
          </ErrorBoundary>
        </main>
        <Suspense fallback={null}>
          <OpeningDialog />
        </Suspense>
        <Toaster />
      </ToastProvider>
    </TooltipProvider>
  );
}
