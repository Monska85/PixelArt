import { Download, TriangleAlert } from "lucide-react";
import type { Published } from "../../release/manifest";
import { Alert, AlertDescription } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { IconButton } from "../components/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/tooltip";
import { capNames, nameList, splitMissing } from "./missing";
import type { ManifestState } from "../useManifest";

const plural = (count: number): string => `${count} animation${count === 1 ? "" : "s"}`;

/** What the Library can do about missing animations. `library` is a ManifestState: nothing is offered while its status is "loading". */
export interface MissingContext {
  library: ManifestState;
  /** Why installing is not possible now, or null. */
  blocked: string | null;
  onInstall: (animations: Published[]) => void;
}

/** The ones the Library has and the ones it lacks; nothing is said about the Library while it is being read. */
function describe(missing: string[], context: MissingContext) {
  const ready = context.library.status !== "loading";
  const { installable, unavailable } = splitMissing(
    missing,
    context.library.status === "ready" ? context.library.manifest : null,
  );
  return { installable, unavailable: ready ? unavailable : [] };
}

/** Names capped at ten in view, with the full list kept for assistive technology. */
function Names({ names }: { names: string[] }) {
  const capped = nameList(names);
  const full = names.join(", ");
  if (capped === full) return <>{full}</>;
  return (
    <>
      <span aria-hidden="true">{capped}</span>
      <span className="sr-only">{full}</span>
    </>
  );
}

/** A warning badge with the count of missing animations (icon and word, not color alone) and the list in a tooltip. */
export function MissingBadge({
  playlist,
  missing,
  context,
}: {
  playlist: string;
  missing: string[];
  context: MissingContext;
}) {
  const { unavailable } = describe(missing, context);
  const summary = `Missing ${plural(missing.length)}: ${missing.join(", ")}`;
  const { shown, more } = capNames(missing);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role="group" aria-label={summary} data-testid={`missing-${playlist}`}>
          <Badge variant="warning">
            <TriangleAlert aria-hidden="true" />
            {missing.length} missing
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent data-testid={`missing-tip-${playlist}`}>
        <p className="font-medium">Not stored on the board:</p>
        <ul className="list-disc pl-4">
          {shown.map((name) => (
            <li key={name}>
              {name}
              {unavailable.includes(name) ? " (not available in the Library)" : ""}
            </li>
          ))}
        </ul>
        {more > 0 && <p>and {more} more</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The direct action of a playlist row: sends the missing animations that the Library publishes. */
export function InstallMissingButton({
  playlist,
  missing,
  context,
}: {
  playlist: string;
  missing: string[];
  context: MissingContext;
}) {
  const { installable } = describe(missing, context);
  if (installable.length === 0) return null;
  return (
    <IconButton
      label={`Install missing animations of ${playlist}`}
      tooltip={context.blocked ?? `Install ${plural(installable.length)} from the Library`}
      icon={Download}
      disabled={context.blocked !== null}
      onClick={() => context.onInstall(installable)}
    />
  );
}

/** What one missing animation offers in the playlist editor: Install when the Library has it, else a note. */
export function InstallAnimation({ animation, context }: { animation: string; context: MissingContext }) {
  const { installable, unavailable } = describe([animation], context);
  if (unavailable.length > 0)
    return <span className="text-xs text-muted-foreground">Not available in the Library</span>;
  if (installable.length === 0) return null;
  return (
    <IconButton
      label={`Install ${animation}`}
      tooltip={context.blocked ?? "Install from the Library"}
      icon={Download}
      disabled={context.blocked !== null}
      onClick={() => context.onInstall(installable)}
    />
  );
}

/** In the Settings card: the active playlist names animations the board lacks, with the fix. */
export function ActiveMissingNote({
  playlist,
  missing,
  context,
}: {
  playlist: string;
  missing: string[];
  context: MissingContext;
}) {
  const { installable, unavailable } = describe(missing, context);
  return (
    <Alert variant="warning" data-testid="active-missing">
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <p>
          The active playlist <code>{playlist}</code> is missing {plural(missing.length)}: <Names names={missing} />.
          The board skips them.
        </p>
        {unavailable.length > 0 && (
          <p>
            Not available in the Library: <Names names={unavailable} />.
          </p>
        )}
        {installable.length > 0 && (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={context.blocked !== null}
              onClick={() => context.onInstall(installable)}
            >
              <Download aria-hidden="true" />
              Install missing
            </Button>
            {context.blocked && <p className="mt-1 text-xs text-muted-foreground">{context.blocked}</p>}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
