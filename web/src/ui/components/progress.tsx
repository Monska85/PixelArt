import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export function Progress({ className, value, max = 100, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  const percent = value == null || max === 0 ? 0 : Math.min(100, (value / max) * 100);
  return (
    <ProgressPrimitive.Root
      value={value}
      max={max}
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
    </ProgressPrimitive.Root>
  );
}
