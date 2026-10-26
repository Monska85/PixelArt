// SPDX-License-Identifier: GPL-3.0-or-later

import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

/** One line for something that is loading, announced politely. */
export function LoadingNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin-slow" aria-hidden="true" />
      {children}
    </p>
  );
}
