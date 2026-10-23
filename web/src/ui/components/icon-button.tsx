import type { ComponentType, ReactNode, SVGProps } from "react";
import { Button, type ButtonProps } from "./button";
import { ReasonTooltip } from "./tooltip";

interface Props extends Omit<ButtonProps, "children" | "size" | "aria-label" | "loading"> {
  /** The accessible name and, unless `tooltip` says more, the tooltip. */
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** What the tooltip says instead of the label, for example why the button is disabled. */
  tooltip?: ReactNode;
}

/** An icon-only button: it always has an accessible name and a tooltip, also while disabled. */
export function IconButton({ label, icon: Icon, tooltip, variant = "ghost", disabled, ...props }: Props) {
  return (
    <ReasonTooltip
      reason={typeof tooltip === "string" ? tooltip : label}
      tip={tooltip ?? label}
      focusable={Boolean(disabled)}
      className="inline-flex rounded-md"
    >
      <Button variant={variant} size="icon" aria-label={label} disabled={disabled} {...props}>
        <Icon aria-hidden="true" />
      </Button>
    </ReasonTooltip>
  );
}
