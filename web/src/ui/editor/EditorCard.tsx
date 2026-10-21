import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";

interface Props {
  /** Makes the card a labelled region: `${id}-title` names it. */
  id: string;
  title: string;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  children: ReactNode;
}

/** One card of the editor, in the app's one card style. */
export function EditorCard({ id, title, actions, children }: Props) {
  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle id={`${id}-title`}>{title}</CardTitle>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A row of related buttons. */
export function ButtonRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

/** Muted explanation text. */
export function Hint({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {children}
    </p>
  );
}
