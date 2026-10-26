// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { paletteEntries, spriteNames, spriteOf, isComposite, type Path, itemAt } from "../../editor/doc";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { DiagnosticsTable } from "../common/DiagnosticsTable";
import { ErrorAlert } from "../common/ErrorAlert";
import { LoadingNote } from "../common/LoadingNote";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Card, CardContent } from "../components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs";
import { AnimationPanel } from "./AnimationPanel";
import { EditorCard, type Edit } from "./EditorCard";
import { EditorHeader } from "./EditorHeader";
import { ColorField } from "./Fields";
import { EditorPreview } from "./EditorPreview";
import { GridPanel } from "./GridPanel";
import { PalettePanel } from "./PalettePanel";
import { PartsPanel } from "./PartsPanel";
import { SpritesPanel } from "./SpritesPanel";
import { TimelinePanel } from "./TimelinePanel";
import { YamlTab } from "./YamlTab";
import { navigateAndFocus } from "../navigation";
import { editorStore, useEditor } from "./store";
import { useValidation } from "./useValidation";

const TABS = [
  { id: "visual", label: "Visual" },
  { id: "yaml", label: "YAML" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function EditorView() {
  const { state, restored, draft, origin, openings } = useEditor();
  const [tab, setTab] = useState<Tab>("visual");
  const [selectedSprite, setSelectedSprite] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<Path | null>(null);
  const [color, setColor] = useState("");
  const [openError, setOpenError] = useState<string | null>(null);
  const { result, pending: checking } = useValidation(state.doc);

  // Undo and redo with the keyboard, except where the field has its own undo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z") editorStore.dispatch({ type: event.shiftKey ? "redo" : "undo" });
      else if (key === "y" && !event.shiftKey) editorStore.dispatch({ type: "redo" });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const edit: Edit = (change, group) => editorStore.edit(change, group);

  const names = spriteNames(state.doc);
  const sprite = selectedSprite && names.includes(selectedSprite) ? selectedSprite : (names[0] ?? null);
  const spriteMap = sprite ? spriteOf(state.doc, sprite) : undefined;
  const item = selectedItem && itemAt(state.doc, selectedItem) ? selectedItem : null;
  // The drawing color follows the palette: a deleted or renamed name is not drawable.
  const drawColor = color || paletteEntries(state.doc)[0]?.name || "#ffffff";

  return (
    <div className="flex flex-col gap-4">
      {origin && (
        <div>
          <Button variant="ghost" size="sm" data-testid="editor-back" onClick={() => navigateAndFocus(origin)}>
            <ArrowLeft aria-hidden="true" />
            Back to {origin === "board" ? "Board" : "Library"}
          </Button>
        </div>
      )}
      <EditorHeader key={openings} state={state} onOpenError={setOpenError}>
        <p className="pb-6 text-sm text-muted-foreground" data-testid="draft-status" aria-live="polite">
          {draft === "saved" && "Draft saved in this browser."}
          {draft === "saving" && "Saving the draft..."}
          {draft === "unavailable" && "This browser cannot keep a draft."}
        </p>
      </EditorHeader>
      {restored && (
        <Alert variant="info" data-testid="draft-restored">
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p>
              {restored} It stays in this browser only; download a YAML file or upload to the board to keep a real copy.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => editorStore.dismissRestored()}>
                Dismiss
              </Button>
              <Button variant="outline" size="sm" onClick={() => editorStore.discardDraft()}>
                Discard the draft
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {openError && (
        <ErrorAlert title="The file was not opened" onDismiss={() => setOpenError(null)}>
          <p>{openError}</p>
        </ErrorAlert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs value={tab} onValueChange={(value) => setTab(value === "yaml" ? "yaml" : "visual")}>
            <TabsList aria-label="Editor tabs">
              {TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value="visual" className="flex flex-col gap-4 pt-4">
              <AnimationPanel doc={state.doc} edit={edit} />
              <PalettePanel doc={state.doc} edit={edit} current={drawColor} onCurrent={setColor} />
              <SpritesPanel doc={state.doc} edit={edit} selected={sprite} onSelect={setSelectedSprite} />
              {sprite && !isComposite(spriteMap) && (
                <>
                  <Card>
                    <CardContent>
                      <ColorField
                        doc={state.doc}
                        label="Drawing color"
                        value={drawColor}
                        testId="drawing-color"
                        onCommit={(value) => setColor(value)}
                      />
                    </CardContent>
                  </Card>
                  <GridPanel doc={state.doc} edit={edit} sprite={sprite} color={drawColor} onPick={setColor} />
                </>
              )}
              {sprite && isComposite(spriteMap) && <PartsPanel doc={state.doc} edit={edit} composite={sprite} />}
              <TimelinePanel doc={state.doc} edit={edit} selected={item} onSelect={setSelectedItem} />
            </TabsContent>
            <TabsContent value="yaml" className="pt-4">
              <YamlTab state={state} />
            </TabsContent>
          </Tabs>
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          <EditorPreview animation={result.animation} selected={item} />
          <EditorCard id="diagnostics" title="Diagnostics">
            {checking && <LoadingNote>Checking...</LoadingNote>}
            {!checking && result.diagnostics.length === 0 && (
              <p className="flex items-center gap-2 text-sm" data-testid="diagnostics-clean">
                <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                The engine finds no problems.
              </p>
            )}
            <div data-testid="diagnostics" aria-busy={checking}>
              <DiagnosticsTable diagnostics={result.diagnostics} />
            </div>
          </EditorCard>
        </div>
      </div>
    </div>
  );
}
