// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import type { ShownError } from "../errors";
import { ShownErrorAlert } from "./ErrorAlert";

/** The errors a view shows, newest first, at most 10. */
export function useErrorList() {
  const [errors, setErrors] = useState<ShownError[]>([]);
  return {
    errors,
    report: (error: ShownError): void => setErrors((list) => [error, ...list].slice(0, 10)),
    dismiss: (id: number): void => setErrors((list) => list.filter((e) => e.id !== id)),
  };
}

export function ErrorList({ errors, onDismiss }: { errors: ShownError[]; onDismiss: (id: number) => void }) {
  if (errors.length === 0) return null;
  return (
    <section aria-label="Errors" className="flex flex-col gap-3">
      {errors.map((error) => (
        <ShownErrorAlert key={error.id} error={error} onDismiss={() => onDismiss(error.id)} />
      ))}
    </section>
  );
}
