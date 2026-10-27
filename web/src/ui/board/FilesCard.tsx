// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useRef, type ComponentProps, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { PageActions } from "../common/Page";
import { plural } from "../format";
import { summarize, type FilesSummary } from "./filesSection";
import { Names } from "./MissingAnimations";

interface Props extends FilesSummary {
  /** The missing animations of each playlist that has any. */
  missing: ReadonlyMap<string, string[]>;
  actions: ComponentProps<typeof PageActions>;
  open: boolean;
  onToggle: () => void;
  /** Opens the section on the Playlists tab; the card then moves the focus to the tab. */
  onShowPlaylists: () => void;
  /** The tabs of the stored files. */
  children: ReactNode;
}

/**
 * The Files card of the Board view: a summary and the actions on files always, the stored files under a toggle. The
 * files stay mounted while the section is closed, so the selected tab, a preview and the dialogs keep their state.
 */
export function FilesCard(props: Props) {
  const { missing, actions, open, onToggle, onShowPlaylists, children } = props;
  const region = useId();
  const files = useRef<HTMLDivElement>(null);
  const incomplete = [...missing.keys()];
  return (
    <Card aria-labelledby="files-title" data-testid="files-card">
      <CardHeader className="gap-3 pb-4 sm:pb-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <CardTitle id="files-title">Files</CardTitle>
          <PageActions {...actions} />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="files-summary">
          {summarize(props)}
        </p>
        {incomplete.length > 0 && (
          <Alert variant="warning" data-testid="files-missing">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-foreground">
              <p>
                {plural(incomplete.length, "playlist")} {incomplete.length === 1 ? "is" : "are"} missing animations:{" "}
                <Names names={incomplete} />.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  // The tab list is shown and the Playlists tab selected only after the render: commit it first.
                  flushSync(() => onShowPlaylists());
                  files.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
                }}
              >
                Show playlists
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Button variant="outline" className="self-start" aria-expanded={open} aria-controls={region} onClick={onToggle}>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
          {open ? "Hide files" : "Show all files"}
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        <div id={region} ref={files} hidden={!open}>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
