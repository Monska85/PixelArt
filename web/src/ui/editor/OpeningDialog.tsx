import { ConfirmDialog } from "../common/ConfirmDialog";
import { documentName, editorStore, useEditor } from "./store";

/** Asks before an opening replaces a document with unsaved changes. It is shown in whatever view the user is in. */
export function OpeningDialog() {
  const { state, pending } = useEditor();
  if (!pending) return null;
  const current = documentName(state.doc, state.source);
  const next = documentName(pending.doc, pending.source);
  return (
    <ConfirmDialog
      title={`Discard the unsaved changes to ${current} and open ${next}?`}
      confirmLabel="Discard and open"
      cancelLabel="Keep editing"
      destructive
      onCancel={() => editorStore.cancelPending()}
      onConfirm={() => editorStore.confirmPending()}
    >
      <p>
        The changes to {current} are not saved to a file or the board. Opening {next} discards them.
      </p>
    </ConfirmDialog>
  );
}
