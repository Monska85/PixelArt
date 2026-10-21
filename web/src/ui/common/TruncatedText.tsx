import { useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "../components/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";

interface Props {
  children: string;
  /** The element: a span by default. Use `code` for IDs. */
  as?: ElementType;
  className?: string;
  /** What the tooltip says when the text is cut: the whole text by default. */
  full?: ReactNode;
}

/** One line cut with an ellipsis, with the whole text in a tooltip when it was cut. Never breaks inside a word. */
export function TruncatedText({ children, as: Tag = "span", className, full }: Props) {
  const element = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const cut = (): boolean => (element.current ? element.current.scrollWidth > element.current.clientWidth : false);
  return (
    <Tooltip open={open} onOpenChange={(next) => setOpen(next && cut())}>
      <TooltipTrigger asChild>
        <Tag ref={element} className={cn("block min-w-0 truncate", className)}>
          {children}
        </Tag>
      </TooltipTrigger>
      <TooltipContent>{full ?? children}</TooltipContent>
    </Tooltip>
  );
}
