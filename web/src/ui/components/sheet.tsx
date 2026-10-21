import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";
import { IconButton } from "./icon-button";

/**
 * The column that holds side panels. On a wide screen it sits next to the list that opened the panel, in its own
 * grid column; on a phone it is a panel fixed to the bottom of the screen. It renders nothing without panels.
 */
export function SidePanelColumn({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside
      aria-label="Side panel"
      className={cn(
        "flex min-w-0 flex-col gap-4",
        "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[80dvh] max-lg:overflow-y-auto max-lg:rounded-t-xl max-lg:border max-lg:border-border max-lg:bg-card max-lg:shadow-lg",
        "lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:self-start lg:overflow-y-auto",
        className,
      )}
    >
      {children}
    </aside>
  );
}

interface PanelProps extends Omit<ComponentProps<"div">, "title"> {
  title: string;
  /** Called by Escape and by the close button. */
  onClose: () => void;
  /** What keyboard focus goes to when the panel opens. The title when absent. */
  initialFocus?: () => HTMLElement | null;
  footer?: ReactNode;
  /** True while the panel covers the page: focus stays in it and the page behind is hidden from screen readers. */
  modal?: boolean;
}

/**
 * A panel on Radix Dialog without the modal part: the list next to it stays usable. Focus goes to the title when it
 * opens and back to the control that opened it when it closes.
 */
export function SidePanel({
  title,
  onClose,
  initialFocus,
  footer,
  modal = false,
  className,
  children,
  ...props
}: PanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  // Taken during the first render: by the time Radix moves focus into the panel, the opener is already known.
  const [opener] = useState(() => document.activeElement);
  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );
  return (
    <DialogPrimitive.Root open modal={modal} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (initialFocus?.() ?? heading.current)?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className={cn(
          "flex min-w-0 flex-col rounded-xl border border-border bg-card text-foreground shadow-sm",
          className,
        )}
        {...props}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 rounded-t-xl border-b border-border bg-card px-4 py-3">
          <DialogPrimitive.Title asChild>
            <h3 ref={heading} tabIndex={-1} className="min-w-0 truncate text-base font-semibold">
              {title}
            </h3>
          </DialogPrimitive.Title>
          <DialogPrimitive.Close asChild>
            <IconButton label="Close" icon={X} />
          </DialogPrimitive.Close>
        </div>
        <div className="flex min-w-0 flex-col gap-4 p-4">{children}</div>
        {footer && (
          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-border bg-card px-4 py-3">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}

/** Below 1,024 px (Tailwind's `lg`) a wide panel covers the screen. */
const coversScreen = (): boolean => window.matchMedia("(width < 64rem)").matches;

/**
 * A side panel for editing that needs room (the playlist editor). On a wide screen it spans the whole content width
 * where it is rendered, above the list that opened it, which stays usable below. Under 1,024 px it covers the screen
 * and is modal, so focus and screen readers stay in it; it scrolls itself, which a modal dialog allows. Whether it is
 * modal is decided when it opens and kept: Radix draws modal and non-modal content with different components, so a
 * change while open would rebuild the panel and put it above any dialog opened from it.
 */
export function WidePanel({ className, ...props }: Omit<PanelProps, "modal">) {
  const [modal] = useState(coversScreen);
  return (
    <SidePanel
      modal={modal}
      data-testid="wide-panel"
      className={cn(
        // z-[45]: above the side panels fixed to the bottom on a phone (z-40), below dialogs, menus and tooltips (z-50).
        "max-lg:fixed max-lg:inset-0 max-lg:z-[45] max-lg:overflow-y-auto max-lg:rounded-none max-lg:border-0 max-lg:shadow-none",
        className,
      )}
      {...props}
    />
  );
}
