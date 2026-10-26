// SPDX-License-Identifier: GPL-3.0-or-later
// Based on shadcn/ui (MIT): see THIRD_PARTY_NOTICES.txt of the web app.

import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A table that fills its container. Callers decide how columns shrink: nothing here scrolls sideways. */
export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("border-b border-border", className)} {...props} />;
}

export function TableHead({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={cn("h-10 px-3 text-left align-middle text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("min-w-0 px-3 py-2 align-middle", className)} {...props} />;
}
