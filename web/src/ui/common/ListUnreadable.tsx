import { RefreshCw } from "lucide-react";
import { KINDS } from "../fileLists";
import { session } from "../session";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";

interface Props {
  disabled?: boolean;
  /** What could not be read; the files by default. */
  message?: string;
  /** Reads again what failed; the files by default. */
  onRetry?: () => void;
}

/** What a view shows in place of what the board holds when a read failed: nothing is known, and Retry reads it again. */
export function ListUnreadable({
  disabled = false,
  message = "Could not read the files from the board.",
  onRetry = () => void session.refreshFiles(KINDS),
}: Props) {
  return (
    <Alert variant="warning">
      <AlertDescription className="text-foreground">{message}</AlertDescription>
      <Button variant="outline" size="sm" className="self-start" disabled={disabled} onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        Retry
      </Button>
    </Alert>
  );
}
