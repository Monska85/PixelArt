import type { ComponentType, ReactNode, SVGProps } from "react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface Props extends Omit<ButtonProps, "children" | "size" | "aria-label"> {
  /** The accessible name and, unless `tooltip` says more, the tooltip. */
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** What the tooltip says instead of the label, for example why the button is disabled. */
  tooltip?: ReactNode;
}

/** An icon-only button: it always has an accessible name and a tooltip, also while disabled. */
export function IconButton({ label, icon: Icon, tooltip, variant = "ghost", disabled, loading, ...props }: Props) {
  const inactive = Boolean(disabled);
  return (
    <Tooltip>
      {/* A disabled button gets no pointer events and no focus, so the tooltip hangs on a wrapper that does. */}
      <TooltipTrigger asChild>
        <span
          className="inline-flex rounded-md"
          tabIndex={inactive ? 0 : undefined}
          role={inactive ? "group" : undefined}
          aria-label={inactive ? (typeof tooltip === "string" ? tooltip : label) : undefined}
        >
          <Button variant={variant} size="icon" aria-label={label} disabled={disabled} loading={loading} {...props}>
            {!loading && <Icon aria-hidden="true" />}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}
