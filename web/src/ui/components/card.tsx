// SPDX-License-Identifier: GPL-3.0-or-later
// Based on shadcn/ui (MIT): see THIRD_PARTY_NOTICES.txt of the web app.

import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn("min-w-0 rounded-xl border border-border bg-card text-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-0 sm:p-6 sm:pb-0", className)} {...props} />;
}

/** Cards are `h3` under the page's `h2`. */
export function CardTitle({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("text-base font-semibold leading-6", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-4 p-4 sm:p-6", className)} {...props} />;
}
