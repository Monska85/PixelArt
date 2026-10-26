// SPDX-License-Identifier: GPL-3.0-or-later

import { X } from "lucide-react";
import type { ReactNode } from "react";
import type { ShownError } from "../errors";
import { Alert, AlertDescription, AlertTitle } from "../components/alert";
import { IconButton } from "../components/icon-button";
import { DiagnosticsTable, type ShownDiagnostic } from "./DiagnosticsTable";

/** An error code inside a sentence. */
export function CodeChip({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 text-foreground">{children}</code>;
}

interface Props {
  title: string;
  /** The text under the title. */
  children?: ReactNode;
  diagnostics?: ShownDiagnostic[];
  onDismiss?: () => void;
  /** Actions next to the text, for example Reconnect. */
  actions?: ReactNode;
  variant?: "destructive" | "warning" | "info";
  testId?: string;
}

/** The one way the app shows a problem: icon, title, text and, when there are some, the diagnostics table. */
export function ErrorAlert({
  title,
  children,
  diagnostics = [],
  onDismiss,
  actions,
  variant = "destructive",
  testId,
}: Props) {
  return (
    <Alert variant={variant} data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <AlertTitle className="min-w-0 break-words">{title}</AlertTitle>
        {onDismiss && (
          <IconButton label="Dismiss" icon={X} onClick={onDismiss} className="-my-2 -mr-2 size-8 shrink-0" />
        )}
      </div>
      {children && <AlertDescription>{children}</AlertDescription>}
      {diagnostics.length > 0 && (
        <div className="pt-2">
          <DiagnosticsTable diagnostics={diagnostics} />
        </div>
      )}
      {actions && <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>}
    </Alert>
  );
}

/** The alert of an error reported by an action: what the user was doing, the code, the board's message. */
export function ShownErrorAlert({ error, onDismiss }: { error: ShownError; onDismiss: () => void }) {
  return (
    <ErrorAlert
      title={error.context}
      diagnostics={error.diagnostics}
      onDismiss={onDismiss}
      variant={error.info ? "info" : error.warning ? "warning" : "destructive"}
    >
      <p>
        {error.code !== "error" &&
          error.code !== "cancelled" &&
          error.code !== "warnings" &&
          error.code !== "summary" && (
            <>
              <CodeChip>{error.code}</CodeChip>{" "}
            </>
          )}
        {error.message}
      </p>
      {error.lines && error.lines.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="summary-lines">
          {error.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </ErrorAlert>
  );
}
