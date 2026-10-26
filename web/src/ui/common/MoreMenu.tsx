// SPDX-License-Identifier: GPL-3.0-or-later

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useRef, type RefObject } from "react";
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
  className?: string;
}

/** The items of a menu. Each remembers the menu's trigger, so focus can go back to it after the item's action. */
export function MenuItems({
  entries,
  trigger,
}: {
  entries: MenuEntry[];
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  return entries.map((entry) => {
    const Icon = entry.icon;
    return (
      <DropdownMenuItem
        key={entry.label}
        disabled={entry.disabled}
        destructive={entry.destructive}
        className={entry.className}
        onSelect={() => {
          rememberOpener(trigger.current);
          entry.onSelect();
        }}
      >
        {Icon && <Icon aria-hidden="true" />}
        {entry.label}
      </DropdownMenuItem>
    );
  });
}

/** The More menu (a row of three dots) of a row: two actions or more, destructive ones last, in the danger color. */
export function MoreMenu({ label, entries, disabled }: { label: string; entries: MenuEntry[]; disabled?: boolean }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const safe = entries.filter((e) => !e.destructive);
  const destructive = entries.filter((e) => e.destructive);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton ref={trigger} label={label} tooltip="More" icon={MoreHorizontal} disabled={disabled} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <MenuItems entries={safe} trigger={trigger} />
        {safe.length > 0 && destructive.length > 0 && <DropdownMenuSeparator />}
        <MenuItems entries={destructive} trigger={trigger} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
