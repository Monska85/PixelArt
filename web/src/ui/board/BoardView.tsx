// SPDX-License-Identifier: GPL-3.0-or-later

import { FolderUp, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { downloadFile, isUpdateRunning, sha256Hex, supportsSchedules, type BoardClient } from "../../protocol";
import { BlockedNote } from "../common/BlockedNote";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useDeleteEverything } from "../common/DeleteEverything";
import { ErrorList, useErrorList } from "../common/ErrorList";
import { FileTabs, type ListKind } from "../common/FileTable";
import { LoadingNote } from "../common/LoadingNote";
import { PageHeader } from "../common/Page";
import { PanelLayout } from "../common/PanelLayout";
import { PreviewPanel, type PreviewData } from "../common/PreviewPanel";
import { RunningUpload } from "../common/ActivityPanel";
import { cn } from "../components/cn";
import { readAnimationBytes, showInEditor } from "../editor/open";
import { KINDS } from "../fileLists";
import { navigationMark } from "../navigation";
import { shownError, toShownError } from "../errors";
import { session, useSession } from "../session";
import { useManifest } from "../useManifest";
import { ConnectCard } from "../shell/ConnectCard";
import { uploadBlockedReason, useUploadRunning } from "../upload";
import { FilesCard } from "./FilesCard";
import { useFilesSection } from "./filesSection";
import { FilesList } from "./FilesList";
import { newModel, openStoredPlaylist } from "./playlistModel";
import { missingByPlaylist } from "./missing";
import type { MissingContext } from "./MissingAnimations";
import { SettingsPanel, SettingsUnreadable } from "./Settings";
import { StorageCard } from "./StorageCard";
import { useBoardStatus } from "./useBoardStatus";
import { usePlaylistAnimations } from "./usePlaylistAnimations";
import { useBoardUpload } from "./Upload";
import { entriesOf, useBoardData } from "./useBoardData";
import { usePlaylistEditor } from "./usePlaylistEditor";

// The cards of a connected board's WiFi, updates and network access are loaded when a board connects.
const NetworkCards = lazy(() => import("./NetworkCards").then((m) => ({ default: m.NetworkCards })));
// The editor of a playlist is loaded when the first one opens.
const PlaylistEditor = lazy(() => import("./PlaylistEditor").then((m) => ({ default: m.PlaylistEditor })));

const DESCRIPTION = "The files and settings on this board.";

export function BoardView() {
  const connection = useSession();
  const { state, client, restarts } = connection;
  if (state === "disconnected" || state === "connecting" || !client) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Board" description="Connect a board or the simulator to see its files and settings." />
        <ConnectCard />
      </div>
    );
  }
  return (
    <Connected
      client={client}
      restarts={restarts}
      lost={state === "lost"}
      blocked={uploadBlockedReason(connection, "upload")}
    />
  );
}

interface ConnectedProps {
  client: BoardClient;
  restarts: number;
  lost: boolean;
  blocked: string | null;
}

function Connected({ client, restarts, lost, blocked }: ConnectedProps) {
  const { uploadsBlocked, via, info } = useSession();
  const { errors, report, dismiss } = useErrorList();
  const editor = usePlaylistEditor();
  const [list, setList] = useState<ListKind>("animation");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const { data, reload, settingsUnreadable, setSettings } = useBoardData(client, restarts, report);
  const animations = entriesOf(data.animations);
  const playlists = entriesOf(data.playlists);
  const schedules = entriesOf(data.schedules);
  const schedulesV2 = entriesOf(data.schedulesV2);
  const knowsSchedules = supportsSchedules(info);
  // What to play replaces the Active playlist menu on a firmware that knows schedules and reports `play`: the active
  // playlist, the Settings card and the notes of the lists all follow this one value.
  const whatToPlay = knowsSchedules && data.settings?.play !== undefined;
  const animationIds = animations && new Set(animations.map((a) => a.id));
  const playlistNames = playlists && new Map(playlists.map((p) => [p.id, p.name]));

  // The lists were read again by whatever changed them: the settings and the storage are read here.
  const changed = (): void => {
    reload();
    void session.refreshInfo();
    // A stored or deleted playlist or schedule makes the board choose again: the status says what.
    statusPoll.refresh();
  };
  const refresh = (): void => {
    void session.refreshFiles(KINDS);
    changed();
  };

  // Four things open the section for the moment's need and never store it: a playlist editor (Edit, New playlist, a
  // confirmed switch), a preview, an upload that stored files, and Show playlists. Only the toggle stores the choice.
  const files = useFilesSection();
  const { reveal } = files;
  const upload = useBoardUpload({
    client,
    blocked,
    onUploaded: (stored) => {
      changed();
      if (stored) reveal();
    },
    onProblem: report,
  });
  const wipe = useDeleteEverything({ client, onDone: changed });
  const uploadRunning = useUploadRunning();
  const [wifiSetup, setWifiSetup] = useState(false);
  const statusPoll = useBoardStatus(client, restarts, lost || uploadRunning || wifiSetup);
  // A check or an installation of the board's own updates that ends may have stored files: read the lists and the
  // storage again, as after an upload.
  const updateRunning = statusPoll.status !== null && isUpdateRunning(statusPoll.status.update);
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !updateRunning) refresh();
    wasRunning.current = updateRunning;
    // `refresh` is made again on every render and only reads the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateRunning]);
  // With What to play, the active playlist is the one the board says it plays.
  const play = statusPoll.status?.play ?? null;
  const active = whatToPlay ? (play?.playing ?? null) : (data.settings?.playlist ?? null);
  const library = useManifest();
  const named = usePlaylistAnimations(client, playlists, uploadRunning);
  const missing = missingByPlaylist(named, animationIds);
  const missingContext: MissingContext = {
    library,
    blocked: upload.reason,
    onInstall: (entries) => {
      if (library.status === "ready")
        void upload.queue.install(
          entries.map((entry) => ({ kind: "animation" as const, entry })),
          library.manifest,
        );
    },
  };

  // The editor opening reveals the list next to it.
  const editingSeq = editor.editing?.seq;
  useEffect(() => {
    if (editingSeq !== undefined) reveal();
  }, [editingSeq, reveal]);

  async function edit(id: string): Promise<void> {
    try {
      const model = await openStoredPlaylist(client, id);
      if (typeof model === "string") report(shownError(`Opening playlist ${id}`, "not_editable", model));
      else editor.requestOpen(model);
    } catch (error) {
      report(toShownError(`Opening playlist ${id}`, error));
    }
  }

  async function editAnimation(id: string): Promise<void> {
    const context = `Opening animation ${id}`;
    const mark = navigationMark();
    try {
      const bytes = await downloadFile(client, "animation", id);
      const opened = readAnimationBytes(bytes, id, `The board's animation ${id}`, { sha256: await sha256Hex(bytes) });
      if (opened.ok) void showInEditor(opened.opening, "board", mark);
      else report(shownError(context, "not_editable", opened.message));
    } catch (error) {
      report(toShownError(context, error));
    }
  }

  const listProps = {
    client,
    activePlaylist: active,
    knowsSchedules: whatToPlay,
    play,
    disabled: lost,
    onChanged: changed,
    onError: report,
    onUpload: upload.openFiles,
    onNewPlaylist: () => editor.open(newModel()),
    uploadDisabledReason: upload.reason,
  };

  return (
    <div className="flex flex-col gap-4" data-testid="drop-area" {...upload.dropProps}>
      <PageHeader title="Board" description={DESCRIPTION} />
      {upload.inputs}
      {blocked && blocked === uploadsBlocked && <BlockedNote reason={blocked} />}
      <RunningUpload />
      {wipe.notice}
      <ErrorList errors={errors} onDismiss={dismiss} />
      {editor.editing && (
        <Suspense fallback={<LoadingNote>Opening the playlist editor...</LoadingNote>}>
          <PlaylistEditor
            key={editor.editing.seq}
            client={client}
            model={editor.editing.model}
            storedIds={animationIds}
            missingContext={missingContext}
            disabled={lost}
            onChange={editor.onChange}
            onClose={editor.close}
            onSaved={changed}
            onError={report}
          />
        </Suspense>
      )}
      <PanelLayout
        className={cn(
          "rounded-xl transition-shadow",
          upload.dragOver && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
        panel={preview && <PreviewPanel preview={preview} onClose={() => setPreview(null)} />}
      >
        <FilesCard
          animations={data.animations}
          playlists={data.playlists}
          settings={data.settings}
          playlistNames={playlistNames}
          schedules={knowsSchedules ? data.schedules : undefined}
          play={play}
          missing={missing}
          actions={{
            primary: {
              label: "Upload files",
              icon: Upload,
              onSelect: upload.openFiles,
              disabled: upload.reason !== null,
              reason: upload.reason,
            },
            secondary: [
              {
                label: "Upload folder",
                icon: FolderUp,
                onSelect: upload.openFolder,
                disabled: upload.reason !== null,
                reason: upload.reason,
              },
            ],
            more: [
              {
                label: "New playlist",
                icon: Plus,
                onSelect: () => editor.open(newModel()),
                disabled: lost || editor.editing !== null,
              },
              { label: "Refresh", icon: RefreshCw, onSelect: refresh, disabled: lost },
              {
                label: "Delete everything",
                icon: Trash2,
                destructive: true,
                onSelect: () => wipe.start(),
                disabled: lost || wipe.checking || uploadRunning,
              },
            ],
          }}
          open={files.open}
          onToggle={files.toggle}
          onShowPlaylists={() => {
            setList("playlist");
            reveal();
          }}
        >
          <FileTabs
            className="rounded-none border-0 border-t shadow-none"
            value={list}
            onValueChange={setList}
            animations={{
              count: animations?.length ?? null,
              content: (
                <FilesList
                  {...listProps}
                  kind="animation"
                  list={data.animations}
                  onEdit={(id) => void editAnimation(id)}
                  onPreview={(shown) => {
                    reveal();
                    setPreview(shown);
                  }}
                  previewId={preview?.id ?? null}
                  onClosePreview={() => setPreview(null)}
                />
              ),
            }}
            playlists={{
              count: playlists?.length ?? null,
              content: (
                <FilesList
                  {...listProps}
                  kind="playlist"
                  list={data.playlists}
                  onEdit={(id) => void edit(id)}
                  missing={missing}
                  missingContext={missingContext}
                />
              ),
            }}
            schedules={
              knowsSchedules
                ? {
                    count:
                      schedules !== null && schedulesV2 !== null
                        ? new Set([...schedules, ...schedulesV2].map((entry) => entry.id)).size
                        : null,
                    content: (
                      <>
                        <p className="px-4 py-2 text-xs text-muted-foreground">
                          Format 2 schedules take precedence. Format 1 copies keep older boards working.
                        </p>
                        <FilesList {...listProps} kind="schedule_v2" list={data.schedulesV2} />
                        <FilesList {...listProps} kind="schedule" list={data.schedules} />
                      </>
                    ),
                  }
                : undefined
            }
          />
        </FilesCard>
        <StorageCard
          storage={info?.storage ?? null}
          animations={animations}
          playlists={playlists}
          schedules={knowsSchedules ? schedules : undefined}
        />
        {data.settings && (
          <SettingsPanel
            client={client}
            settings={data.settings}
            playlists={playlistNames}
            schedules={schedules}
            schedulesV2={schedulesV2}
            play={play}
            whatToPlay={whatToPlay}
            active={active}
            missing={active === null ? [] : (missing.get(active) ?? [])}
            missingContext={missingContext}
            disabled={lost}
            onSettings={setSettings}
            onPlayChanged={statusPoll.refresh}
            onShowSchedules={() => {
              // The tab list is shown and the Schedules tab selected only after the render: commit it first.
              flushSync(() => {
                setList("schedule");
                reveal();
              });
              document
                .querySelector<HTMLElement>('[data-testid="files-card"] [role="tab"][aria-selected="true"]')
                ?.focus();
            }}
            onError={report}
          />
        )}
        {settingsUnreadable && <SettingsUnreadable disabled={lost} onRetry={reload} />}
        <Suspense fallback={null}>
          <NetworkCards
            client={client}
            poll={statusPoll}
            settings={data.settings}
            overWifi={via === "wifi"}
            lost={lost}
            uploadRunning={uploadRunning}
            onSetupChange={setWifiSetup}
            onSettings={setSettings}
            onError={report}
          />
        </Suspense>
      </PanelLayout>
      {upload.dialogs}
      {wipe.dialogs}
      {editor.pending && (
        <ConfirmDialog
          title={`Discard the unsaved changes to ${editor.pending.from} and open ${editor.pending.to}?`}
          confirmLabel="Discard and open"
          cancelLabel="Keep editing"
          destructive
          onCancel={editor.cancelSwitch}
          onConfirm={editor.confirmSwitch}
        >
          <p>
            The changes to {editor.pending.from} are not saved to the board. Opening {editor.pending.to} discards them.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
