import { AlertTriangle, XCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/table";

export interface ShownDiagnostic {
  severity: string;
  code: string;
  where: string;
  message: string;
}

// Every text here comes from a file or a board: React shows it as text only.
export function DiagnosticsTable({ diagnostics, caption }: { diagnostics: ShownDiagnostic[]; caption?: string }) {
  if (diagnostics.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-card text-foreground">
      <Table className="table-fixed text-xs max-sm:text-[0.8rem]">
        {caption && <caption className="p-2 text-left text-muted-foreground">{caption}</caption>}
        <TableHeader>
          <TableRow>
            <TableHead className="w-20 sm:w-24">Severity</TableHead>
            <TableHead className="w-28 max-sm:hidden sm:w-36">Code</TableHead>
            <TableHead className="w-32 max-sm:hidden sm:w-44">Place</TableHead>
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
                <TableCell className="break-words py-2 align-top max-sm:hidden">
                  <code>{d.code}</code>
                </TableCell>
                <TableCell className="break-all py-2 align-top max-sm:hidden">
                  <code>{d.where === "" ? "(whole file)" : d.where}</code>
                </TableCell>
                <TableCell className="break-words py-2 align-top">
                  <span className="sm:hidden">
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
