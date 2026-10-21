import { useId, type ReactNode } from "react";
import { Label } from "../components/label";
import { cn } from "../components/cn";

export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean;
}

interface Props {
  label: string;
  /** Muted text under the field. An error replaces it. */
  hint?: ReactNode;
  /** The problem with the value, in the danger color. */
  error?: string | null;
  hideLabel?: boolean;
  /** An id for the control when something outside needs to know it; made up otherwise. */
  id?: string;
  className?: string;
  /** Receives the props that tie the control to its label, hint and error. */
  children: (control: FieldControlProps) => ReactNode;
}

/** A label above a control, with a hint or an error linked to the control by `aria-describedby`. */
export function Field({ label, hint, error, hideLabel, id: given, className, children }: Props) {
  const generated = useId();
  const id = given ?? generated;
  const noteId = `${id}-note`;
  const note = error ?? hint;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      {children({ id, "aria-describedby": note ? noteId : undefined, "aria-invalid": Boolean(error) })}
      {note && (
        <p id={noteId} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {note}
        </p>
      )}
    </div>
  );
}
