import type { Animation } from "../../engine";
import { Alert, AlertDescription } from "../components/alert";
import { SidePanel } from "../components/sheet";
import { Preview } from "../board/Preview";
import { DiagnosticsTable, type ShownDiagnostic } from "./DiagnosticsTable";

export interface PreviewData {
  id: string;
  animation: Animation | null;
  diagnostics: ShownDiagnostic[];
}

/** The side panel that plays a stored or published animation, with the engine's diagnostics under it. */
export function PreviewPanel({ preview, onClose }: { preview: PreviewData; onClose: () => void }) {
  return (
    <SidePanel title={`Preview of ${preview.id}`} onClose={onClose}>
      {preview.animation ? (
        <Preview key={preview.id} animation={preview.animation} label={preview.id} />
      ) : (
        <Alert variant="destructive">
          <AlertDescription>The app's engine rejects this file.</AlertDescription>
        </Alert>
      )}
      <DiagnosticsTable diagnostics={preview.diagnostics} />
    </SidePanel>
  );
}
