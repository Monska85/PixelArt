import { CheckCircle2, Info, XCircle } from "lucide-react";
import { dismissToast, Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport, useToasts } from "./toast";

const ICONS = {
  success: <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />,
  info: <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />,
  error: <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />,
};

/** Renders the toasts. It lives once, inside the ToastProvider. */
export function Toaster() {
  const toasts = useToasts();
  return (
    <>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          type={t.tone === "error" ? "foreground" : "background"}
          duration={t.tone === "error" ? 10_000 : 5_000}
          onOpenChange={(open) => !open && dismissToast(t.id)}
        >
          {ICONS[t.tone]}
          <div className="flex min-w-0 flex-col gap-1">
            <ToastTitle>{t.title}</ToastTitle>
            {t.description && <ToastDescription>{t.description}</ToastDescription>}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport label="Notifications ({hotkey})" />
    </>
  );
}
