import { Loader2 } from "lucide-react";
import { Button } from "../components/button";
import { Progress } from "../components/progress";
import { cancelRunningUpload, useUploadActivity } from "../upload";
import { formatSize } from "../format";

interface Props {
  /** What is running: "Uploading ball". */
  title: string;
  /** "File 2 of 5", when there is more than one. */
  step?: string;
  done: number;
  total: number;
  /** Work with no byte count: the bar only says something runs, and the byte line is left out. */
  indeterminate?: boolean;
  onCancel?: () => void;
  testId?: string;
}

/** The one panel for work that takes time: what runs, a progress bar, and Cancel. It is the same in every view. */
export function ActivityPanel({ title, step, done, total, indeterminate, onCancel, testId = "activity" }: Props) {
  return (
    <section
      aria-label="Activity"
      data-testid={testId}
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 items-center gap-2 font-medium" role="status">
          <Loader2 className="size-4 shrink-0 animate-spin-slow" aria-hidden="true" />
          <span className="min-w-0 break-words">{title}</span>
          {step && <span className="font-normal text-muted-foreground">{step}</span>}
        </p>
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {indeterminate ? (
        <Progress value={1} max={1} aria-label={title} className="animate-pulse" />
      ) : (
        <>
          <Progress value={done} max={total} aria-label={title} />
          <p className="text-xs text-muted-foreground">
            {formatSize(done)} of {formatSize(total)}
          </p>
        </>
      )}
    </section>
  );
}

/** Shows the upload that runs now, started from any view, with its Cancel. Nothing while no upload runs. */
export function RunningUpload() {
  const activity = useUploadActivity();
  if (!activity) return null;
  return (
    <ActivityPanel
      title={activity.label}
      step={activity.step}
      done={activity.done}
      total={activity.total}
      indeterminate={activity.indeterminate}
      onCancel={activity.cancellable === false ? undefined : cancelRunningUpload}
    />
  );
}
