import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs break-words rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

/**
 * A tooltip on a wrapper that takes focus and names itself with `reason`, so a disabled control, which gets no pointer
 * events and no focus, keeps its tooltip. While `focusable` is false the wrapper is a plain span. The tooltip says
 * `tip`, or `reason` when `tip` is absent.
 */
export function ReasonTooltip({
  reason,
  tip,
  tipTestId,
  focusable = true,
  className,
  testId,
  children,
}: {
  reason: string;
  tip?: ReactNode;
  tipTestId?: string;
  focusable?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={className}
          tabIndex={focusable ? 0 : undefined}
          role={focusable ? "group" : undefined}
          aria-label={focusable ? reason : undefined}
          data-testid={testId}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent data-testid={tipTestId}>{tip ?? reason}</TooltipContent>
    </Tooltip>
  );
}
