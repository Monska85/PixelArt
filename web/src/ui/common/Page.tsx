import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { rememberOpener } from "./focusReturn";
import { Button } from "../components/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";

export interface PageAction {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  /** Why the action is disabled, shown as a tooltip. */
  reason?: string | null;
  loading?: boolean;
}

interface Props {
  title: string;
  /** One line that says what the view is for. */
  description: ReactNode;
  /** The view's single primary action. */
  primary?: PageAction;
  /** A primary action that is not a plain button, such as an install button of a web component. */
  primaryNode?: ReactNode;
  /** Secondary actions: buttons on a wide screen, items of the More menu on a phone. */
  secondary?: PageAction[];
  /** Everything else, in the More menu. Destructive items go last. */
  more?: Array<PageAction & { destructive?: boolean }>;
}

function ActionButton({
  action,
  variant,
  className,
}: {
  action: PageAction;
  variant: "default" | "outline";
  className?: string;
}) {
  const Icon = action.icon;
  const button = (
    <Button
      variant={variant}
      className={className}
      disabled={action.disabled}
      loading={action.loading}
      onClick={action.onSelect}
    >
      {Icon && !action.loading && <Icon aria-hidden="true" />}
      {action.label}
    </Button>
  );
  if (!action.disabled || !action.reason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className} tabIndex={0} role="group" aria-label={action.reason}>
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{action.reason}</TooltipContent>
    </Tooltip>
  );
}

/** The header every view starts with: the title, what the view is for, and its actions on the right. */
export function PageHeader({ title, description, primary, primaryNode, secondary = [], more = [] }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = [...secondary.map((action) => ({ ...action, phoneOnly: true, destructive: false })), ...more];
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-2xl font-semibold leading-8 tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {primary && <ActionButton action={primary} variant="default" />}
        {primaryNode}
        {secondary.map((action) => (
          <ActionButton key={action.label} action={action} variant="outline" className="max-sm:hidden" />
        ))}
        {menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" ref={trigger}>
                <MoreHorizontal aria-hidden="true" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {menu.map((item) => {
                const Icon = item.icon;
                return (
                  <DropdownMenuItem
                    key={item.label}
                    destructive={item.destructive}
                    disabled={item.disabled}
                    className={"phoneOnly" in item ? "sm:hidden" : undefined}
                    onSelect={() => {
                      rememberOpener(trigger.current);
                      item.onSelect();
                    }}
                  >
                    {Icon && <Icon aria-hidden="true" />}
                    {item.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
