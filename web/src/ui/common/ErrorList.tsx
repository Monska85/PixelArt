import type { ShownError } from "../errors";
import { ShownErrorAlert } from "./ErrorAlert";

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
