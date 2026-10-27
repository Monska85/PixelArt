// SPDX-License-Identifier: GPL-3.0-or-later

import { Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../components/badge";
import { cn } from "../components/cn";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs";
import { TruncatedText } from "./TruncatedText";

export interface FileRowData {
  key: string;
  id: string;
  /** The name from the file; null when the board could not read it, and the row then shows the ID alone. */
  name: string | null;
  /** Next to the name, for example Active. */
  badge?: ReactNode;
  /** The view's own columns, in the order of `columns`. */
  cells: ReactNode[];
  /** Icon buttons and the More menu. */
  actions: ReactNode;
}

interface FileColumn {
  label: string;
  /** Tailwind width class of the column on a wide screen. */
  width: string;
}

// Below 640 px a row is two lines: name and ID, then the columns as text, with the actions at the right.
// Tailwind needs whole class names, so each number of columns has its own.
const PHONE_GRID: Record<number, { grid: string; name: string; actions: string }> = {
  1: { grid: "max-sm:grid-cols-[max-content_1fr_auto]", name: "max-sm:col-span-2", actions: "max-sm:col-start-3" },
  2: {
    grid: "max-sm:grid-cols-[repeat(2,max-content)_1fr_auto]",
    name: "max-sm:col-span-3",
    actions: "max-sm:col-start-4",
  },
};

interface TableProps {
  /** The accessible name of the table. */
  label: string;
  columns: FileColumn[];
  rows: FileRowData[];
}

/** The table of the list pattern. Board and Library both draw their files with it. */
export function FileTable({ label, columns, rows }: TableProps) {
  const phone = PHONE_GRID[columns.length] ?? PHONE_GRID[1]!;
  return (
    <Table className="table-fixed" aria-label={label}>
      <TableHeader className="max-sm:sr-only">
        <TableRow>
          <TableHead>Name</TableHead>
          {columns.map((column) => (
            <TableHead key={column.label} className={cn("max-sm:w-auto", column.width)}>
              {column.label}
            </TableHead>
          ))}
          <TableHead className="w-36 max-sm:w-auto">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.key}
            className={cn("max-sm:grid max-sm:items-center max-sm:gap-x-3 max-sm:px-3 max-sm:py-2", phone.grid)}
          >
            <TableCell className={cn("max-sm:row-start-1 max-sm:p-0", phone.name)}>
              <div className="flex min-w-0 items-center gap-2">
                {row.name === null ? (
                  <TruncatedText as="code" className="text-sm font-medium">
                    {row.id}
                  </TruncatedText>
                ) : (
                  <TruncatedText className="font-medium">{row.name}</TruncatedText>
                )}
                {row.badge}
              </div>
              {row.name !== null && (
                <TruncatedText as="code" className="text-xs text-muted-foreground">
                  {row.id}
                </TruncatedText>
              )}
            </TableCell>
            {row.cells.map((cell, index) => (
              <TableCell
                key={index}
                className="whitespace-nowrap max-sm:p-0 max-sm:text-xs max-sm:text-muted-foreground"
              >
                {cell}
              </TableCell>
            ))}
            <TableCell className={cn("max-sm:row-span-2 max-sm:row-start-1 max-sm:p-0", phone.actions)}>
              <div className="flex items-center justify-end gap-1">{row.actions}</div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** What a list says when it is empty: a title, one sentence and the actions that fill it. */
export function EmptyList({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      </div>
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export type ListKind = "animation" | "playlist";

interface TabsProps {
  /** The accessible name of the list of tabs. */
  label?: string;
  value: ListKind;
  onValueChange: (value: ListKind) => void;
  /** `count` is null while the list is not known: the tab shows no number rather than 0. */
  animations: { count: number | null; content: ReactNode };
  playlists: { count: number | null; content: ReactNode };
  /** Added to the card look: the Board overrides it to sit flush inside its Files card. */
  className?: string;
}

/**
 * The tabs of the list pattern: Animations and Playlists with their counts, in one card with the table under them.
 * Both lists stay mounted, so one keeps its state (an open preview) while the other is shown.
 */
export function FileTabs({
  label = "Stored files",
  value,
  onValueChange,
  animations,
  playlists,
  className,
}: TabsProps) {
  const trigger = (kind: ListKind, label: string, count: number | null) => (
    <TabsTrigger value={kind}>
      {label}
      {count !== null && (
        <Badge variant="default" className="px-2 py-0">
          {count}
        </Badge>
      )}
    </TabsTrigger>
  );
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onValueChange(next === "playlist" ? "playlist" : "animation")}
      className={cn("min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm", className)}
    >
      <TabsList aria-label={label} className="px-2">
        {trigger("animation", "Animations", animations.count)}
        {trigger("playlist", "Playlists", playlists.count)}
      </TabsList>
      <TabsContent value="animation" forceMount className="data-[state=inactive]:hidden">
        {animations.content}
      </TabsContent>
      <TabsContent value="playlist" forceMount className="data-[state=inactive]:hidden">
        {playlists.content}
      </TabsContent>
    </Tabs>
  );
}
