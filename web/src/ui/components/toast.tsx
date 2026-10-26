// SPDX-License-Identifier: GPL-3.0-or-later
// Based on shadcn/ui (MIT): see THIRD_PARTY_NOTICES.txt of the web app.

import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useSyncExternalStore, type ComponentProps } from "react";
import { createEmitter } from "../emitter";
import { cn } from "./cn";

export function ToastViewport({ className, ...props }: ComponentProps<typeof ToastPrimitive.Viewport>) {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        "fixed bottom-0 right-0 z-[100] flex max-h-dvh w-full flex-col gap-2 p-4 outline-none sm:max-w-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Toast({ className, ...props }: ComponentProps<typeof ToastPrimitive.Root>) {
  return (
    <ToastPrimitive.Root
      className={cn(
        "relative flex w-full items-start gap-3 rounded-lg border border-border bg-card p-4 pr-10 text-sm text-foreground shadow-lg data-[state=open]:animate-toast-in data-[state=closed]:animate-toast-out",
        className,
      )}
      {...props}
    />
  );
}

export function ToastTitle({ className, ...props }: ComponentProps<typeof ToastPrimitive.Title>) {
  return <ToastPrimitive.Title className={cn("font-medium", className)} {...props} />;
}

export function ToastDescription({ className, ...props }: ComponentProps<typeof ToastPrimitive.Description>) {
  return <ToastPrimitive.Description className={cn("text-muted-foreground", className)} {...props} />;
}

export function ToastClose({ className, ...props }: ComponentProps<typeof ToastPrimitive.Close>) {
  return (
    <ToastPrimitive.Close
      aria-label="Dismiss"
      className={cn(
        "absolute right-2 top-2 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <X className="size-4" aria-hidden="true" />
    </ToastPrimitive.Close>
  );
}

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  /** An error is announced at once; a result politely. */
  tone: "success" | "info" | "error";
}

let messages: ToastMessage[] = [];
let nextId = 1;
const { subscribe, emit } = createEmitter();

const publish = (next: ToastMessage[]): void => {
  messages = next;
  emit();
};

/** Shows the outcome of an action: it is announced to screen readers and goes away by itself. */
export function toast(message: Omit<ToastMessage, "id" | "tone"> & { tone?: ToastMessage["tone"] }): void {
  publish([...messages, { ...message, tone: message.tone ?? "success", id: nextId++ }].slice(-4));
}

export const dismissToast = (id: number): void => publish(messages.filter((m) => m.id !== id));

export const useToasts = (): ToastMessage[] => useSyncExternalStore(subscribe, () => messages);
