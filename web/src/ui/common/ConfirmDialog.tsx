// SPDX-License-Identifier: GPL-3.0-or-later

import { useRef, useState, type ReactNode } from "react";
import { takeOpener } from "./focusReturn";
import { Button } from "../components/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";

interface Props {
  /** A short question with the verb: "Delete ball?". */
  title: string;
  /** The label of the action on the right: a verb. */
  confirmLabel: string;
  /** The label of the safe action on the left. */
  cancelLabel?: string;
  /** Red, and focus starts on the safe action. Only destructive actions are red. */
  destructive?: boolean;
  confirmDisabled?: boolean;
  /** An extra action between the safe action and the confirm button, such as "Download YAML first". */
  extraAction?: ReactNode;
  /** What changes, naming the files. */
  children: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Every confirmation of the app. The dialog is open while it is mounted. Escape and a click outside cancel; focus
 * goes back to the control that opened it.
 */
export function ConfirmDialog({
  title,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  confirmDisabled = false,
  extraAction,
  children,
  onConfirm,
  onCancel,
}: Props) {
  const safe = useRef<HTMLButtonElement>(null);
  // Read while rendering the first time: the control that opened the dialog still has focus (or the menu note).
  const [opener] = useState(takeOpener);
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // Something else took focus meanwhile (a panel the answer opened): leave it there.
          const active = document.activeElement;
          const dialog = event.currentTarget instanceof Element ? event.currentTarget : null;
          if (active && active !== document.body && !dialog?.contains(active)) return;
          if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        }}
        onOpenAutoFocus={(event) => {
          // Destructive dialogs start on the safe action; the others on their first field or button.
          if (destructive) {
            event.preventDefault();
            safe.current?.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground [&_p]:leading-relaxed">{children}</div>
        <DialogFooter>
          <Button ref={safe} variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {extraAction}
          <Button variant={destructive ? "destructive" : "default"} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
