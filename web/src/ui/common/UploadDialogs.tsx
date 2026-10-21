import { useEffect, useRef, useState, type ReactNode } from "react";
import { isValidId } from "../../engine";
import type { PlanEntry, Resolution } from "../../queue/plan";
import type { DifferingChoice } from "../../queue/run";
import { Button } from "../components/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";
import { Input } from "../components/input";
import { formatSize } from "../format";
import { ConfirmDialog } from "./ConfirmDialog";
import { Field } from "./Field";
import { takeOpener } from "./focusReturn";

export type { DifferingChoice };

type Prompt =
  | { type: "id"; intro: string; suggestion: string; resolve: (id: string | null) => void }
  | { type: "differing"; entries: PlanEntry[]; resolve: (choice: DifferingChoice | null) => void }
  | { type: "missing"; missing: Resolution["missing"]; resolve: (go: boolean) => void };

const ID_RULE = "Lowercase letters, digits, _ and -, starting with a letter or digit, at most 32 characters.";

function IdDialog({
  intro,
  suggestion,
  onResolve,
}: {
  intro: string;
  suggestion: string;
  onResolve: (id: string | null) => void;
}) {
  const [text, setText] = useState(suggestion);
  const valid = isValidId(text);
  return (
    <ConfirmDialog
      title="Choose an ID"
      confirmLabel="Use this ID"
      confirmDisabled={!valid}
      onCancel={() => onResolve(null)}
      onConfirm={() => onResolve(text)}
    >
      <p>{intro}.</p>
      <Field label="ID" hint={ID_RULE} error={valid ? null : `Not a valid ID yet. ${ID_RULE}`}>
        {(control) => (
          <Input
            {...control}
            value={text}
            maxLength={64}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) onResolve(text);
            }}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}

/** One dialog for all the files that differ from the board's: replace them, keep the board's, or cancel. */
function DifferingDialog({
  entries,
  onResolve,
}: {
  entries: PlanEntry[];
  onResolve: (choice: DifferingChoice | null) => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  const [opener] = useState(takeOpener);
  return (
    <Dialog open onOpenChange={(open) => !open && onResolve(null)}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          safe.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {entries.length === 1 ? "Replace the stored file?" : `Replace ${entries.length} stored files?`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>The board stores different versions of these files. Replacing them overwrites the board&apos;s copies.</p>
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto" data-testid="differing-files">
            {entries.map(({ file, stored }) => (
              <li key={`${file.kind}/${file.id}`} className="flex flex-wrap items-baseline gap-x-2">
                <code className="text-foreground">{file.id}</code>
                <span>
                  {file.kind}, {stored ? `${formatSize(stored.size)} on the board, ` : ""}
                  {formatSize(file.bytes.length)} new
                </span>
              </li>
            ))}
          </ul>
        </div>
        <DialogFooter>
          <Button ref={safe} variant="outline" onClick={() => onResolve(null)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => onResolve("keep")}>
            Keep the board&apos;s
          </Button>
          <Button variant="destructive" onClick={() => onResolve("replace")}>
            Replace them
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The questions every upload can ask: which ID, what to do with differing files, and missing animations.
 * Render `dialogs` once; the ask functions resolve when the user answers.
 */
export function useUploadDialogs(): {
  dialogs: ReactNode;
  askId: (intro: string, suggestion: string) => Promise<string | null>;
  /** The queue's one question for every differing file. `null` is Cancel. */
  askDiffering: (entries: PlanEntry[]) => Promise<DifferingChoice | null>;
  /** Playlists whose animations are nowhere: upload them anyway (true) or cancel. */
  askMissing: (missing: Resolution["missing"]) => Promise<boolean>;
} {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  // Answers the open question as "no", for a question replaced by another or left behind by an unmounted view.
  const dismissOpen = useRef<(() => void) | null>(null);

  useEffect(() => () => dismissOpen.current?.(), []);

  const ask = <T,>(make: (resolve: (answer: T) => void) => Prompt, none: T): Promise<T> => {
    dismissOpen.current?.();
    return new Promise<T>((resolve) => {
      const answer = (value: T): void => {
        dismissOpen.current = null;
        setPrompt(null);
        resolve(value);
      };
      dismissOpen.current = () => answer(none);
      setPrompt(make(answer));
    });
  };

  const askId = (intro: string, suggestion: string): Promise<string | null> =>
    ask<string | null>((resolve) => ({ type: "id", intro, suggestion, resolve }), null);

  const askDiffering = (entries: PlanEntry[]): Promise<DifferingChoice | null> =>
    ask<DifferingChoice | null>((resolve) => ({ type: "differing", entries, resolve }), null);

  const askMissing = (missing: Resolution["missing"]): Promise<boolean> =>
    ask<boolean>((resolve) => ({ type: "missing", missing, resolve }), false);

  let dialogs: ReactNode = null;
  if (prompt?.type === "id")
    dialogs = <IdDialog intro={prompt.intro} suggestion={prompt.suggestion} onResolve={prompt.resolve} />;
  else if (prompt?.type === "differing")
    dialogs = <DifferingDialog entries={prompt.entries} onResolve={prompt.resolve} />;
  else if (prompt?.type === "missing")
    dialogs = (
      <ConfirmDialog
        title="Upload the playlist without all its animations?"
        confirmLabel="Upload the playlist anyway"
        onCancel={() => prompt.resolve(false)}
        onConfirm={() => prompt.resolve(true)}
      >
        <p>
          These animations are not in the selection, in the Library or on the board. The board stores the playlist with
          an <code>unknown_animation</code> warning, and skips them until they are stored.
        </p>
        <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto" data-testid="missing-animations">
          {prompt.missing.map((m) => (
            <li key={m.animation}>
              <code className="text-foreground">{m.animation}</code>, named by{" "}
              {m.playlists.map((id, i) => (
                <span key={id}>
                  {i > 0 && ", "}
                  <code className="text-foreground">{id}</code>
                </span>
              ))}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    );
  return { dialogs, askId, askDiffering, askMissing };
}
