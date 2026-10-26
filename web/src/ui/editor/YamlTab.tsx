// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState } from "react";
import { editorStore } from "./store";
import type { EditorState } from "../../editor/state";
import { ErrorAlert } from "../common/ErrorAlert";
import { Field } from "../common/Field";
import { Alert, AlertDescription } from "../components/alert";
import { Textarea } from "../components/input";
import { EditorCard } from "./EditorCard";

const DELAY_MS = 400;

/** The document as YAML text. Valid text replaces the document; invalid text keeps the last valid one. */
export function YamlTab({ state }: { state: EditorState }) {
  const [draft, setDraft] = useState(state.text);
  // What this tab last sent to the editor: text that came from the editor itself replaces the draft.
  const sent = useRef(state.text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.text !== sent.current) {
      // The editor rewrote the text: a change not yet sent from here is outdated.
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      sent.current = state.text;
      setDraft(state.text);
    }
  }, [state.text]);

  const flush = (text: string): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text === sent.current) return;
    sent.current = text;
    editorStore.dispatch({ type: "text", text });
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <EditorCard id="yaml" title="YAML">
      {state.commentsDropped && (
        <Alert variant="info" data-testid="comments-dropped">
          <AlertDescription className="text-foreground">
            A change made in the visual editor rewrote this text, so the comments are gone.
          </AlertDescription>
        </Alert>
      )}
      {state.textError && (
        <ErrorAlert title="The YAML text has an error" testId="yaml-error">
          <p>
            {state.textError.line !== undefined && `Line ${state.textError.line}: `}
            {state.textError.message} The visual editor keeps the last valid document.
          </p>
        </ErrorAlert>
      )}
      <Field label="Animation as YAML" hideLabel id="yaml-text">
        {(control) => (
          <Textarea
            {...control}
            className="min-h-[32rem] font-mono text-sm leading-relaxed"
            spellCheck={false}
            value={draft}
            aria-invalid={state.textError !== null}
            onChange={(e) => {
              const text = e.target.value;
              setDraft(text);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => flush(text), DELAY_MS);
            }}
            onBlur={() => flush(draft)}
          />
        )}
      </Field>
    </EditorCard>
  );
}
