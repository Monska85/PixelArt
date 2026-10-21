import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "./cn";
import { fieldClasses } from "./input";

/**
 * A select built on the browser's own control: its menu is the operating system's, which is the most accessible
 * and the smallest option, and it works with a keyboard, a phone and a screen reader out of the box.
 */
export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select className={cn(fieldClasses, "h-9 appearance-none truncate pr-9")} {...props}>
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}
