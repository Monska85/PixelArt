// SPDX-License-Identifier: GPL-3.0-or-later
// Based on shadcn/ui (MIT): see THIRD_PARTY_NOTICES.txt of the web app.

import type { ComponentProps } from "react";
import { cn } from "./cn";

const FIELD =
  "w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive aria-invalid:outline-destructive";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(FIELD, "h-9", type === "color" && "w-12 cursor-pointer p-1", className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(FIELD, "min-h-16 py-2", className)} {...props} />;
}

export { FIELD as fieldClasses };
