// SPDX-License-Identifier: GPL-3.0-or-later

import type { Entry } from "../../protocol";
import { Alert, AlertDescription } from "../components/alert";
import { Card, CardContent, CardHeader, CardTitle } from "../components/card";
import { Progress } from "../components/progress";
import { formatSize, plural } from "../format";
import { summarizeStorage } from "./storage";

interface Props {
  /** `info.storage`, or null for a board that does not say. */
  storage: { total: number; used: number } | null;
  /** The stored animations and playlists, or null while a list is not known. */
  animations: Entry[] | null;
  playlists: Entry[] | null;
  /** The stored schedules, null while not known; left out for a board that knows none. */
  schedules?: Entry[] | null;
}

/**
 * The Storage card of the Board view: the space left, a bar, how many files are stored and how many more animations
 * of average size would fit, with a warning when less than one is left.
 */
export function StorageCard({ storage, animations, playlists, schedules }: Props) {
  if (!storage || storage.total <= 0) return null;
  const s = summarizeStorage(storage, animations ?? [], playlists ?? []);
  const known = animations !== null && playlists !== null && schedules !== null;
  return (
    <Card aria-labelledby="storage-title" data-testid="storage-card">
      <CardHeader>
        <CardTitle id="storage-title">Storage</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm" data-testid="storage-free">
          <span className="font-medium">{formatSize(s.free)} free</span> of {formatSize(s.total)}
        </p>
        <Progress aria-label="Storage used" value={s.used} max={s.total} className="max-w-sm" />
        {known && (
          <p className="text-sm text-muted-foreground" data-testid="storage-files">
            {schedules === undefined
              ? `${plural(s.animations, "animation")} and ${plural(s.playlists, "playlist")} stored.`
              : `${plural(s.animations, "animation")}, ${plural(s.playlists, "playlist")} and ${plural((schedules ?? []).length, "schedule")} stored.`}
          </p>
        )}
        {known && (
          <p className="text-sm text-muted-foreground" data-testid="storage-estimate">
            {s.averageAnimation === null
              ? "Store an animation to see how many more would fit."
              : `Estimate: about ${plural(s.estimate ?? 0, "more animation")} of average size (${formatSize(s.averageAnimation)} each) would fit.`}
          </p>
        )}
        {known && s.full && (
          <Alert variant="warning" data-testid="storage-warning">
            <AlertDescription className="text-foreground">
              The board is full. Delete files you do not need before uploading more.
            </AlertDescription>
          </Alert>
        )}
        {known && !s.full && s.low && (
          <Alert variant="warning" data-testid="storage-warning">
            <AlertDescription className="text-foreground">
              Space is low: less than one animation of average size is left. Delete files you do not need before
              uploading more.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
