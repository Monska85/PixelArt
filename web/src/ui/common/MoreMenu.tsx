import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/dropdown-menu";
import { IconButton } from "../components/icon-button";
import { rememberOpener } from "./focusReturn";

export interface MenuEntry {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** The More menu (a row of three dots) of a row: two actions or more, destructive ones last, in the danger color. */
export function MoreMenu({ label, entries, disabled }: { label: string; entries: MenuEntry[]; disabled?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const safe = entries.filter((e) => !e.destructive);
  const destructive = entries.filter((e) => e.destructive);
  const item = (entry: MenuEntry) => {
    const Icon = entry.icon;
    return (
      <DropdownMenuItem
        key={entry.label}
        disabled={entry.disabled}
        destructive={entry.destructive}
        onSelect={() => {
          rememberOpener(trigger.current);
          entry.onSelect();
        }}
      >
        {Icon && <Icon aria-hidden="true" />}
        {entry.label}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton ref={trigger} label={label} tooltip="More" icon={MoreHorizontal} disabled={disabled} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {safe.map(item)}
        {safe.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
