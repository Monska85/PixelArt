import { MoreHorizontal } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { EmptyList } from "./FileTable";
import { LoadingNote } from "./LoadingNote";
import { MenuItems, type MenuEntry } from "./MoreMenu";
import { Button } from "../components/button";
import { Card } from "../components/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../components/dropdown-menu";
import { ReasonTooltip } from "../components/tooltip";

interface PageAction extends MenuEntry {
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
  more?: PageAction[];
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
    <ReasonTooltip reason={action.reason} className={className}>
      {button}
    </ReasonTooltip>
  );
}

/** The header every view starts with: the title, what the view is for, and its actions on the right. */
export function PageHeader({ title, description, primary, primaryNode, secondary = [], more = [] }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = [...secondary.map((action) => ({ ...action, className: "sm:hidden", destructive: false })), ...more];
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
              <MenuItems entries={menu} trigger={trigger} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

/** A view that shows the published release while the release is read, or when none is published. */
export function ManifestPending({
  title,
  description,
  loading,
  loadingText,
  emptyTitle,
  emptyTestId,
  emptyText,
  children,
}: {
  title: string;
  description: ReactNode;
  loading: boolean;
  loadingText: string;
  emptyTitle: string;
  emptyTestId: string;
  emptyText: string;
  /** Shown under the empty card. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description} />
      {loading ? (
        <LoadingNote>{loadingText}</LoadingNote>
      ) : (
        <>
          <Card data-testid={emptyTestId}>
            <EmptyList title={emptyTitle}>{emptyText}</EmptyList>
          </Card>
          {children}
        </>
      )}
    </div>
  );
}
