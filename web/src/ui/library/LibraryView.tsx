// SPDX-License-Identifier: GPL-3.0-or-later

import { Check, ChevronDown, CircleDashed, Download, GitCompare, Pencil, Play } from "lucide-react";
import { useState } from "react";
import { loadAnimation } from "../../engine";
import { supportsSchedules, type BoardClient, type Entry } from "../../protocol";
import { downloadPublished, libraryState, type LibraryState } from "../../release/library";
import type { Manifest, Published, PublishedKind } from "../../release/manifest";
import { entriesOf, useBoardFiles } from "../board/useBoardData";
import { RunningUpload } from "../common/ActivityPanel";
import { BlockedNote, FirmwareLink } from "../common/BlockedNote";
import { ErrorList, useErrorList } from "../common/ErrorList";
import { EmptyList, FileTable, FileTabs, type FileRowData, type ListKind } from "../common/FileTable";
import { ListUnreadable } from "../common/ListUnreadable";
import { LoadingNote } from "../common/LoadingNote";
import { ManifestPending, PageHeader } from "../common/Page";
import { PanelLayout } from "../common/PanelLayout";
import { PreviewPanel, type PreviewData } from "../common/PreviewPanel";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { ReasonTooltip } from "../components/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../components/dropdown-menu";
import { IconButton } from "../components/icon-button";
import { type BoardFileList } from "../fileLists";
import { readAnimationBytes, showInEditor } from "../editor/open";
import { navigationMark } from "../navigation";
import { useLatest } from "../useLatest";
import { shownError, toShownError, type ShownError } from "../errors";
import { session, useSession } from "../session";
import { useUploadQueue } from "../queue/useUploadQueue";
import { blockedOrBusy, uploadBlockedReason } from "../upload";
import { useManifest } from "../useManifest";

export function LibraryView() {
  const manifest = useManifest();
  const connection = useSession();
  const { state, client } = connection;
  const blocked = uploadBlockedReason(connection, "install");
  if (manifest.status !== "ready")
    return (
      <ManifestPending
        title="Library"
        description="Animations, playlists and schedules published with a content release."
        loading={manifest.status === "loading"}
        loadingText="Reading the published release..."
        emptyTitle="Nothing is published yet"
        emptyTestId="library-empty"
        emptyText="No animations, playlists or schedules are available here. They appear once a release is published."
      />
    );
  if (!client || state === "disconnected" || state === "connecting")
    return <Library manifest={manifest.manifest} board={null} blocked={blocked} />;
  return <Connected manifest={manifest.manifest} client={client} blocked={blocked} />;
}

interface ConnectedProps {
  manifest: Manifest;
  client: BoardClient;
  blocked: string | null;
}

function Connected({ manifest, client, blocked }: ConnectedProps) {
  const { errors, report, dismiss } = useErrorList();
  const data = useBoardFiles(report);
  return (
    <Library
      manifest={manifest}
      board={{ client, animations: data.animations, playlists: data.playlists, schedules: data.schedules }}
      blocked={blocked}
      errors={errors}
      onError={report}
      onDismiss={dismiss}
    />
  );
}

interface LibraryBoard {
  client: BoardClient;
  /** A list that is not known leaves the state column empty rather than saying "Not on the board". */
  animations: BoardFileList;
  playlists: BoardFileList;
  schedules: BoardFileList;
}

interface LibraryProps {
  manifest: Manifest;
  board: LibraryBoard | null;
  /** Why installing is not possible right now, or null. */
  blocked: string | null;
  errors?: ShownError[];
  onError?: (error: ShownError) => void;
  onDismiss?: (id: number) => void;
}

const STATE_BADGES = {
  missing: { label: "Not on the board", variant: "outline", icon: CircleDashed },
  same: { label: "Same", variant: "success", icon: Check },
  different: { label: "Different", variant: "warning", icon: GitCompare },
} as const;

function StateBadge({ state, id }: { state: LibraryState; id: string }) {
  if (state === "unknown") return null;
  const { label, variant, icon: Icon } = STATE_BADGES[state];
  return (
    <Badge variant={variant} data-testid={`state-${id}`}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

function Library({ manifest, board, blocked, errors = [], onError, onDismiss }: LibraryProps) {
  const { uploadsBlocked, info } = useSession();
  // Everything brings the published schedules too, to a board that knows them: an older one answers invalid_kind.
  const schedulesSupported = board === null || supportsSchedules(info);
  const installableSchedules = board !== null && schedulesSupported ? manifest.schedules.length : 0;
  const [list, setList] = useState<ListKind>("animation");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const reported = useLatest(onError);
  const queue = useUploadQueue({
    client: board?.client ?? null,
    onProblem: (problem) => reported.current?.(problem),
    onFinished: () => void session.refreshInfo(),
  });

  const stored = (kind: PublishedKind): Entry[] | null => {
    if (board === null || (kind === "schedule" && !schedulesSupported)) return null;
    if (kind === "animation") return entriesOf(board.animations);
    if (kind === "playlist") return entriesOf(board.playlists);
    return entriesOf(board.schedules);
  };

  const published: Record<PublishedKind, Published[]> = {
    animation: manifest.animations,
    playlist: manifest.playlists,
    schedule: manifest.schedules,
    play: manifest.play,
  };
  const everything = (kinds: PublishedKind[]): Array<{ kind: PublishedKind; entry: Published }> =>
    kinds.flatMap((kind) => published[kind].map((entry) => ({ kind, entry })));

  async function showPreview(entry: Published): Promise<void> {
    setPreviewing(entry.id);
    try {
      const result = loadAnimation(await downloadPublished("animation", entry));
      setPreview({ id: entry.id, animation: result.animation, diagnostics: result.diagnostics });
    } catch (error) {
      reported.current?.(toShownError(`Previewing ${entry.id}`, error));
    } finally {
      setPreviewing(null);
    }
  }

  async function edit(entry: Published): Promise<void> {
    const mark = navigationMark();
    setPreviewing(entry.id);
    try {
      const bytes = await downloadPublished("animation", entry);
      const opened = readAnimationBytes(bytes, entry.id, `The published animation ${entry.id}`);
      if (opened.ok) void showInEditor(opened.opening, "library", mark);
      else reported.current?.(shownError(`Opening ${entry.id}`, "not_editable", opened.message));
    } catch (error) {
      reported.current?.(toShownError(`Opening ${entry.id}`, error));
    } finally {
      setPreviewing(null);
    }
  }

  // A manifest from before the content package names the firmware release the animations were published with.
  const origin =
    manifest.contentVersion !== null ? `content release ${manifest.contentVersion}` : `release ${manifest.version}`;
  const installReason = blockedOrBusy(blocked, queue.busy);
  const installDisabled = installReason !== null || board === null;

  function table(kind: PublishedKind, entries: Published[]) {
    if (entries.length === 0)
      return (
        <EmptyList title={`No ${kind}s are published`}>
          This release has no {kind}s. They appear here when one is published.
        </EmptyList>
      );
    const rows: FileRowData[] = entries.map((entry) => {
      const state = libraryState(entry, stored(kind));
      return {
        key: entry.id,
        id: entry.id,
        name: entry.name ?? null,
        cells: [
          ...(kind === "animation" ? [entry.version ?? ""] : []),
          <StateBadge key="state" state={state} id={entry.id} />,
        ],
        actions: (
          <>
            <IconButton
              label={`Install ${entry.id}`}
              tooltip={
                installReason ??
                (kind === "schedule" && !schedulesSupported
                  ? "Update the board's firmware to install schedules"
                  : state === "same"
                    ? "The board has this file"
                    : kind === "playlist"
                      ? "Install with its animations"
                      : "Install on the board")
              }
              icon={Download}
              disabled={installDisabled || state === "same" || (kind === "schedule" && !schedulesSupported)}
              onClick={() => board && void queue.install([{ kind, entry }], manifest)}
            />
            {kind === "animation" && (
              <IconButton
                label={`Preview ${entry.id}`}
                tooltip="Preview"
                icon={Play}
                disabled={previewing !== null}
                onClick={() => void showPreview(entry)}
              />
            )}
            {kind === "animation" && (
              <IconButton
                label={`Open ${entry.id} in editor`}
                tooltip="Open in editor"
                icon={Pencil}
                disabled={previewing !== null}
                onClick={() => void edit(entry)}
              />
            )}
          </>
        ),
      };
    });
    return (
      <FileTable
        label={
          kind === "animation"
            ? "Published animations"
            : kind === "playlist"
              ? "Published playlists"
              : "Published schedules"
        }
        columns={[
          ...(kind === "animation" ? [{ label: "Version", width: "w-24" }] : []),
          { label: "On the board", width: "w-44" },
        ]}
        rows={rows}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Library"
        description={`Files published with ${origin}.${board === null ? " Connect a board to install them." : ""}`}
        primaryNode={
          <InstallAllMenu
            disabled={installDisabled}
            reason={installReason}
            loading={queue.busy}
            animations={manifest.animations.length}
            playlists={manifest.playlists.length}
            schedules={installableSchedules}
            onInstall={(kinds) => void queue.install(everything(kinds), manifest)}
          />
        }
      />
      {board && uploadsBlocked && blocked === uploadsBlocked && <BlockedNote reason={blocked} />}
      <RunningUpload />
      <ErrorList errors={errors} onDismiss={onDismiss ?? (() => undefined)} />
      {board && <BoardListsNote lists={board} />}
      <PanelLayout panel={preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}>
        <FileTabs
          label="Published files"
          value={list}
          onValueChange={setList}
          animations={{ count: manifest.animations.length, content: table("animation", manifest.animations) }}
          playlists={{ count: manifest.playlists.length, content: table("playlist", manifest.playlists) }}
          schedules={{
            count: manifest.schedules.length,
            content: (
              <>
                {board && !schedulesSupported && manifest.schedules.length > 0 && (
                  <p className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
                    This board's firmware does not support schedules. Update it to install them.
                    <FirmwareLink />
                  </p>
                )}
                {table("schedule", manifest.schedules)}
              </>
            ),
          }}
        />
      </PanelLayout>
      {queue.dialogs}
    </div>
  );
}

/** Says why the state column is empty: the board's lists are being read, or could not be. */
function BoardListsNote({ lists }: { lists: LibraryBoard }) {
  const statuses = [lists.animations, lists.playlists, lists.schedules];
  if (statuses.some((l) => l.status === "unknown")) return <ListUnreadable />;
  if (statuses.some((l) => l.status === "loading")) return <LoadingNote>Reading the board...</LoadingNote>;
  return null;
}

/**
 * Install all: every published animation, every published playlist, or everything, which also brings the `schedules`
 * published schedules after the playlists (0 for a board that knows none).
 */
function InstallAllMenu({
  disabled,
  reason,
  loading,
  animations,
  playlists,
  schedules,
  onInstall,
}: {
  disabled: boolean;
  reason: string | null;
  loading: boolean;
  animations: number;
  playlists: number;
  schedules: number;
  onInstall: (kinds: PublishedKind[]) => void;
}) {
  const total = animations + playlists + schedules;
  const trigger = (
    <Button disabled={disabled} loading={loading}>
      {!loading && <Download aria-hidden="true" />}
      Install all
      <ChevronDown aria-hidden="true" />
    </Button>
  );
  if (disabled) return reason ? <ReasonTooltip reason={reason}>{trigger}</ReasonTooltip> : trigger;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem disabled={animations === 0} onSelect={() => onInstall(["animation"])}>
          All animations ({animations})
        </DropdownMenuItem>
        <DropdownMenuItem disabled={playlists === 0} onSelect={() => onInstall(["playlist"])}>
          All playlists ({playlists})
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={total === 0}
          onSelect={() => onInstall(schedules > 0 ? ["animation", "playlist", "schedule"] : ["animation", "playlist"])}
        >
          Everything ({total})
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
