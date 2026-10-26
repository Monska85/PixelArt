// SPDX-License-Identifier: GPL-3.0-or-later

import { ChevronDown } from "lucide-react";
import { Button } from "../components/button";
import { cn } from "../components/cn";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { ConnectionChip } from "./ConnectionChip";
import { ThemeButton } from "./ThemeButton";

interface Props {
  views: ReadonlyArray<{ id: string; title: string }>;
  current: string;
}

/** The name, the navigation, the connection chip and the theme control. Below 640 px the navigation is a menu button. */
export function TopBar({ views, current }: Props) {
  const currentTitle = views.find((v) => v.id === current)?.title ?? "";
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <h1 className="text-lg font-semibold tracking-tight">PixelArt</h1>
        <nav aria-label="Views" className="max-sm:hidden">
          <ul className="flex gap-1">
            {views.map((v) => (
              <li key={v.id}>
                <a
                  href={`#${v.id}`}
                  aria-current={v.id === current ? "page" : undefined}
                  className={cn(
                    "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    v.id === current && "bg-accent text-accent-foreground",
                  )}
                >
                  {v.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Views" className="sm:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" data-testid="nav-menu">
                {currentTitle}
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {views.map((v) => (
                <DropdownMenuItem key={v.id} asChild>
                  <a href={`#${v.id}`} aria-current={v.id === current ? "page" : undefined}>
                    {v.title}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="flex items-center gap-2 sm:ml-auto max-sm:w-full">
          <ConnectionChip />
          <ThemeButton />
        </div>
      </div>
    </header>
  );
}
