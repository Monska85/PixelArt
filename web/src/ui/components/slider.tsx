import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** The accessible name and description belong to the thumb, the element with the slider role. */
export function Slider({
  className,
  "aria-label": label,
  "aria-describedby": describedBy,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex h-6 w-full touch-none select-none items-center", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-2 grow overflow-hidden rounded-full bg-secondary">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-describedby={describedBy}
        className="block size-5 rounded-full border-2 border-primary bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[disabled]:border-input"
      />
    </SliderPrimitive.Root>
  );
}
