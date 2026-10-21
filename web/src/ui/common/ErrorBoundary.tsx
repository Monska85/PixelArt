import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { clearDraft } from "../editor/drafts";
import { Button } from "../components/button";
import { ErrorAlert } from "./ErrorAlert";

/**
 * What the page shows when drawing it throws. The actions use no state of the crashed tree: the stored
 * draft is cleared in the browser's storage and the page loads again, so a draft that crashes the editor
 * cannot make every later visit crash too. Only a crash in the editor offers that, because a crash in
 * another view leaves the draft untouched and a plain reload restores it.
 */
function CrashNote({ error, canDiscardDraft }: { error: Error; canDiscardDraft: boolean }) {
  const [confirming, setConfirming] = useState(false);
  // The store is loaded on demand, as everywhere else, and a store that cannot load has no write to stop.
  const discard = (): void => {
    void import("../editor/store")
      .then(({ editorStore }) => editorStore.stopDrafting())
      .catch(() => undefined)
      .then(() => clearDraft())
      .then(() => window.location.reload());
  };
  return (
    <ErrorAlert
      title="This page stopped working"
      testId="crash-note"
      actions={
        <>
          <Button onClick={() => window.location.reload()}>Reload the page</Button>
          {canDiscardDraft &&
            (confirming ? (
              <>
                <Button variant="outline" onClick={() => setConfirming(false)}>
                  Keep the draft
                </Button>
                <Button variant="destructive" onClick={discard}>
                  Yes, delete the draft and reload
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setConfirming(true)}>
                Discard the draft and start again
              </Button>
            ))}
        </>
      }
    >
      <p>
        Something in the document or the page could not be drawn:{" "}
        <code className="text-foreground">{error.message}</code>
      </p>
      {confirming && (
        <p>The draft saved in this browser will be deleted and the editor will start from a new animation.</p>
      )}
    </ErrorAlert>
  );
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode; canDiscardDraft?: boolean }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("The page failed to draw", error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.error ? (
      <CrashNote error={this.state.error} canDiscardDraft={this.props.canDiscardDraft === true} />
    ) : (
      this.props.children
    );
  }
}
