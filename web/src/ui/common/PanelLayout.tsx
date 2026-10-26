// SPDX-License-Identifier: GPL-3.0-or-later

import type { ReactNode } from "react";
import { cn } from "../components/cn";
import { SidePanelColumn } from "../components/sheet";

interface Props {
  /** The side panels, or null when none is open: the content then fills the width. */
  panel: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The content and, when a panel is open, the panel next to it (below 1,024 px the panel is fixed to the bottom). */
export function PanelLayout({ panel, className, children }: Props) {
  return (
    <div
      className={cn(
        panel && "max-lg:pb-[60dvh] lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-6",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {panel && <SidePanelColumn>{panel}</SidePanelColumn>}
    </div>
  );
}
