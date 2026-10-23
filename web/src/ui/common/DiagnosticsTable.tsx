import { AlertTriangle, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";

export interface ShownDiagnostic {
  severity: string;
  code: string;
  where: string;
  message: string;
}

// Every text here comes from a file or a board: React shows it as text only. The table follows the width of its
// container, not of the window: below 36 rem (a phone, or the editor's side column) code and place go into the message.
export function DiagnosticsTable({ diagnostics }: { diagnostics: ShownDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="@container rounded-md border border-border bg-card text-foreground">
      <Table className="table-fixed text-xs max-sm:text-[0.8rem]" aria-label="Diagnostics">
        <TableHeader>
          <TableRow>
            <TableHead className="w-20 @xl:w-24">Severity</TableHead>
            <TableHead className="w-36 @max-xl:hidden">Code</TableHead>
            <TableHead className="w-44 @max-xl:hidden">Place</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {diagnostics.map((d, i) => {
            const error = d.severity === "error";
            const Icon = error ? XCircle : AlertTriangle;
            return (
              <TableRow key={i} className="align-top">
                <TableCell className={`py-2 align-top font-medium ${error ? "text-destructive" : "text-warning"}`}>
                  <span className="inline-flex items-center gap-1">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {d.severity}
                  </span>
                </TableCell>
                <TableCell className="break-words py-2 align-top @max-xl:hidden">
                  <code>{d.code}</code>
                </TableCell>
                <TableCell className="break-all py-2 align-top @max-xl:hidden">
                  <code>{d.where === "" ? "(whole file)" : d.where}</code>
                </TableCell>
                <TableCell className="break-words py-2 align-top">
                  <span className="@xl:hidden">
                    <code>{d.code}</code>
                    {d.where !== "" && (
                      <>
                        {" at "}
                        <code className="break-all">{d.where}</code>
                      </>
                    )}
                    {": "}
                  </span>
                  {d.message}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
