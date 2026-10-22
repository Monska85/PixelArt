import { Loader2 } from "lucide-react";
import { Button } from "../components/button";
import { Progress } from "../components/progress";
import { cancelRunningUpload, useUploadActivity } from "../upload";
import { formatSize } from "../format";

/**
 * The one panel for work that takes time, the same in every view: the upload that runs now, started from any view,
 * with a progress bar and its Cancel. Nothing while no upload runs.
 */
export function RunningUpload() {
  const activity = useUploadActivity();
  if (!activity) return null;
  const { label: title, step, done, total, indeterminate } = activity;
  return (
    <section
      aria-label="Activity"
      data-testid="activity"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex min-w-0 items-center gap-2 font-medium" role="status">
          <Loader2 className="size-4 shrink-0 animate-spin-slow" aria-hidden="true" />
          <span className="min-w-0 break-words">{title}</span>
          {step && <span className="font-normal text-muted-foreground">{step}</span>}
        </p>
        {activity.cancellable !== false && (
          <Button variant="outline" size="sm" onClick={cancelRunningUpload}>
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
