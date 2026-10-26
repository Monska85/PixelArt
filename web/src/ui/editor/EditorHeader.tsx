// SPDX-License-Identifier: GPL-3.0-or-later

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FilePlus2,
  FolderOpen,
  Redo2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isValidId, loadAnimation, type Diagnostic } from "../../engine";
import { jsonBytes, writeJson } from "../../yaml/writeJson";
import { sha256Hex, type WireDiagnostic } from "../../protocol";
import { deriveSaveState } from "../../editor/saves";
import type { QueueFile } from "../../queue/plan";
import { newAnimation, setTopField, type Doc } from "../../editor/doc";
import type { EditorState } from "../../editor/state";
import { Alert, AlertDescription } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";
import { IconButton } from "../components/icon-button";
import { BlockedNote } from "../common/BlockedNote";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { DiagnosticsTable } from "../common/DiagnosticsTable";
import { ErrorAlert } from "../common/ErrorAlert";
import { PageHeader } from "../common/Page";
import { RunningUpload } from "../common/ActivityPanel";
import { shownMessage } from "../errors";
import { suggestId } from "../files";
import { singleFileResult } from "../queue/summary";
import { useUploadQueue } from "../queue/useUploadQueue";
import { formatSize } from "../format";
import { session, useSession } from "../session";
import { readStored, writeStored } from "../storage";
import { CANCELLED_MESSAGE, SKIPPED_MESSAGE, blockedOrBusy, uploadBlockedReason } from "../upload";
import { boardFilesOf } from "./boardFiles";
import { TextField } from "./Fields";
import { readAnimationFile } from "./open";
import { documentName, editorStore } from "./store";

interface Outcome {
  /** A result, something the user chose, or a problem. */
  tone: "success" | "info" | "error";
  message: string;
  diagnostics: Array<Diagnostic | WireDiagnostic>;
}

interface Props {
  state: EditorState;
  /** Shown at the right of the name: undo and redo, the draft status. */
  children?: ReactNode;
  onOpenError: (message: string | null) => void;
}

/**
 * The editor's header: the name, Upload to board (primary), Download YAML, and More with Open file, New animation and
 * Discard the draft. It is keyed by the number of documents opened, so the result of a save or upload belongs to one
 * document and starts over with the next.
 */
export function EditorHeader({ state, children, onOpenError }: Props) {
  const connection = useSession();
  const { client } = connection;
  const queue = useUploadQueue({
    client,
    // A file left out or a warning on the way: shown as this document's result, not in a list of the view.
    onProblem: (shown) => setOutcome({ tone: "error", message: shownMessage(shown), diagnostics: shown.diagnostics }),
    onFinished: () => void session.refreshInfo(),
  });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const blocked = uploadBlockedReason(connection, "upload");
  const uploadReason = blockedOrBusy(blocked, queue.busy);

  // The ID is chosen the first time the document is saved.
  async function ensureId(): Promise<string | null> {
    if (state.id && isValidId(state.id)) return state.id;
    const chosen = await queue.askId(
      "The ID is the file name of the animation",
      suggestId(documentName(state.doc, "")),
    );
    if (chosen) editorStore.dispatch({ type: "setId", id: chosen });
    return chosen;
  }

  // While the text is invalid the document is the last valid one, so saving or uploading would use something
  // the user is not looking at and mark the invalid text as done.
  function refuseWhileTextInvalid(done: string): boolean {
    if (!state.textError) return false;
    setOutcome({
      tone: "error",
      message: `The YAML tab has an error, so ${done}. Fix the text first.`,
      diagnostics: [],
    });
    return true;
  }

  async function downloadYaml(): Promise<void> {
    if (refuseWhileTextInvalid("the file was not downloaded")) return;
    const id = await ensureId();
    if (!id) return;
    if (!editorStore.downloadYaml(id)) return;
    setOutcome({ tone: "success", message: `Downloaded ${id}.yaml.`, diagnostics: [] });
  }

  async function upload(): Promise<void> {
    if (!client) return;
    if (refuseWhileTextInvalid("the animation was not uploaded")) return;
    // The queue is held from the ID question to the last byte, so a second entry point cannot take it meanwhile.
    const held: { id?: string; doc?: Doc; bytes?: Uint8Array; file?: QueueFile } = {};
    const outcome = await queue.uploadAfter(
      async () => {
        const id = await ensureId();
        if (!id) return null;
        const doc = state.doc;
        const bytes = jsonBytes(doc);
        const checked = loadAnimation(bytes);
        if (!checked.animation) {
          setOutcome({
            tone: "error",
            message: "The animation has errors and was not uploaded.",
            diagnostics: checked.diagnostics,
          });
          return null;
        }
        const file: QueueFile = { kind: "animation", id, bytes, sha256: await sha256Hex(bytes), origin: "the editor" };
        Object.assign(held, { id, doc, bytes, file });
        return [file];
      },
      { manifest: null, quiet: true },
    );
    const { id, doc, bytes, file } = held;
    if (!outcome || !id || !doc || !bytes || !file) return;
    const result = singleFileResult(outcome, "the animation");
    if (result.status === "error")
      setOutcome({ tone: "error", message: shownMessage(result.shown), diagnostics: result.shown.diagnostics });
    else if (result.status === "stopped")
      setOutcome({
        tone: "info",
        message: result.reason === "kept" ? SKIPPED_MESSAGE : CANCELLED_MESSAGE,
        diagnostics: [],
      });
    else {
      editorStore.saved(doc, { kind: "board", name: id, at: Date.now(), json: writeJson(doc), sha256: file.sha256 });
      setOutcome({
        tone: "success",
        message: result.identical
          ? `The board already has this exact animation as ${id}.`
          : `Uploaded animation ${id} (${formatSize(bytes.length)}).`,
        diagnostics: result.warnings,
      });
    }
  }

  return (
    <>
      <PageHeader
        title="Editor"
        description={
          <span data-testid="editor-source">
            {state.source}
            {state.dirty ? ", changed" : ""}
          </span>
        }
        primary={{
          label: "Upload to board",
          icon: Upload,
          loading: queue.busy,
          disabled: uploadReason !== null,
          reason: uploadReason,
          onSelect: () => void upload(),
        }}
        secondary={[{ label: "Download YAML", icon: Download, onSelect: () => void downloadYaml() }]}
        more={[
          { label: "Open file", icon: FolderOpen, onSelect: () => picker.current?.click() },
          {
            label: "New animation",
            icon: FilePlus2,
            onSelect: () => void editorStore.request({ doc: newAnimation(), id: null, source: "A new animation" }),
          },
          { label: "Discard the draft", icon: Trash2, destructive: true, onSelect: () => setDiscarding(true) },
        ]}
      />
      <input
        id="editor-open"
        ref={picker}
        className="sr-only"
        type="file"
        accept=".yaml,.yml,.json"
        tabIndex={-1}
        aria-label="Choose an animation file to open"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void readAnimationFile(file).then((opened) => {
            onOpenError(opened.ok ? null : opened.message);
            if (opened.ok) void editorStore.request(opened.opening);
          });
        }}
      />
      {blocked && blocked === connection.uploadsBlocked && <BlockedNote reason={blocked} />}
      <FirstUseNote />
      <RunningUpload />
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <TextField
          label="Name"
          value={documentName(state.doc, "")}
          maxLength={128}
          className="w-full max-w-md"
          hint={
            <>
              ID: {state.id ? <code data-testid="editor-id">{state.id}</code> : "chosen when you upload or download"}
              {state.id && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-4"
                    onClick={() => editorStore.dispatch({ type: "setId", id: null })}
                  >
                    Change ID
                  </button>
                </>
              )}
            </>
          }
          onCommit={(value) => editorStore.edit((d) => setTopField(d, "name", value))}
        />
        <div className="flex items-center gap-1 pb-6">
          <IconButton
            label="Undo"
            icon={Undo2}
            variant="outline"
            disabled={state.past.length === 0}
            tooltip={state.past.length === 0 ? "Nothing to undo" : "Undo"}
            onClick={() => editorStore.dispatch({ type: "undo" })}
          />
          <IconButton
            label="Redo"
            icon={Redo2}
            variant="outline"
            disabled={state.future.length === 0}
            tooltip={state.future.length === 0 ? "Nothing to redo" : "Redo"}
            onClick={() => editorStore.dispatch({ type: "redo" })}
          />
        </div>
        <SaveStatePill state={state} />
        {children}
      </div>
      {outcome &&
        (outcome.tone !== "error" ? (
          <Alert variant={outcome.tone} data-testid="save-outcome">
            <AlertDescription className="text-foreground">
              <p>{outcome.message}</p>
              <DiagnosticsTable diagnostics={outcome.diagnostics} />
            </AlertDescription>
          </Alert>
        ) : (
          <ErrorAlert
            title="Nothing was uploaded or downloaded"
            testId="save-outcome"
            diagnostics={outcome.diagnostics}
            onDismiss={() => setOutcome(null)}
          >
            <p>{outcome.message}</p>
          </ErrorAlert>
        ))}
      {queue.dialogs}
      {discarding && (
        <ConfirmDialog
          title="Discard the draft?"
          confirmLabel="Discard the draft"
          cancelLabel="Keep the draft"
          destructive
          onCancel={() => setDiscarding(false)}
          onConfirm={() => {
            setDiscarding(false);
            editorStore.discardDraft();
          }}
        >
          <p>The draft saved in this browser is deleted and the editor starts from a new animation.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** Where the document lives: the header always says whether it is only a draft in this browser. */
function SaveStatePill({ state }: { state: EditorState }) {
  const files = boardFilesOf(useSession());
  // The board may have changed without this app (another computer, a reset): opening the Editor checks it again.
  useEffect(() => void session.refreshFiles(["animation"]), []);
  const saved = useMemo(
    () => deriveSaveState(state.saves, writeJson(state.doc), files),
    [state.saves, state.doc, files],
  );
  const Icon = saved.warning ? AlertTriangle : CheckCircle2;
  return (
    <div className="pb-6">
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex" data-testid="save-state" data-kind={saved.kind}>
            <Badge variant={saved.warning ? "warning" : "success"} className="whitespace-normal text-left">
              <Icon aria-hidden="true" />
              {saved.text}
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {saved.details.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

const NOTE_KEY = "pixelart.editorNote";
// When storage is blocked the note shows again next time, not again in this visit.
let noteDismissedThisVisit = false;

/** Said once per browser: the draft is not a backup. */
function FirstUseNote() {
  const [hidden, setHidden] = useState(() => noteDismissedThisVisit || readStored(NOTE_KEY) === "1");
  if (hidden) return null;
  return (
    <Alert variant="info" data-testid="editor-note">
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <p>
          Your work is kept in this browser as a draft. It is not a backup: clearing the browser&apos;s data, using
          another browser, or deleting the animation from the board can lose it. Upload to board or download the YAML
          file to keep it.
        </p>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              noteDismissedThisVisit = true;
              writeStored(NOTE_KEY, "1");
              setHidden(true);
            }}
          >
            Got it
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
