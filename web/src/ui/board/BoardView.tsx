import { FolderUp, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { downloadFile, sha256Hex, type BoardClient } from "../../protocol";
import { BlockedNote } from "../common/BlockedNote";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useDeleteEverything } from "../common/DeleteEverything";
import { ErrorList } from "../common/ErrorList";
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
import { toShownError, type ShownError } from "../errors";
import { session, useSession } from "../session";
import { useManifest } from "../useManifest";
import { ConnectCard } from "../shell/ConnectCard";
import { uploadBlockedReason, useUploadRunning } from "../upload";
import { FilesList } from "./FilesList";
import { newModel, openStoredPlaylist } from "./playlistModel";
import { missingByPlaylist } from "./missing";
import type { MissingContext } from "./MissingAnimations";
import { SettingsPanel, SettingsUnreadable } from "./Settings";
import { usePlaylistAnimations } from "./usePlaylistAnimations";
import { useBoardUpload } from "./Upload";
import { entriesOf, useBoardData } from "./useBoardData";
import { usePlaylistEditor } from "./usePlaylistEditor";

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
  const { uploadsBlocked } = useSession();
  const [errors, setErrors] = useState<ShownError[]>([]);
  const editor = usePlaylistEditor();
  const [list, setList] = useState<ListKind>("animation");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const report = (error: ShownError): void => setErrors((current) => [error, ...current].slice(0, 10));
  const { data, reload, settingsUnreadable, setSettings } = useBoardData(client, restarts, report);
  const animations = entriesOf(data.animations);
  const playlists = entriesOf(data.playlists);
  const animationIds = animations && new Set(animations.map((a) => a.id));
  const playlistNames = playlists && new Map(playlists.map((p) => [p.id, p.name]));

  // The lists were read again by whatever changed them: the settings and the storage are read here.
  const changed = (): void => {
    reload();
    void session.refreshInfo();
  };
  const refresh = (): void => {
    void session.refreshFiles(KINDS);
    changed();
  };

  const upload = useBoardUpload({ client, blocked, onUploaded: changed, onProblem: report });
  const wipe = useDeleteEverything({ client, onDone: changed });
  const uploadRunning = useUploadRunning();
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

  async function edit(id: string): Promise<void> {
    try {
      const model = await openStoredPlaylist(client, id);
      if (typeof model === "string")
        report({
          id: Date.now(),
          context: `Opening playlist ${id}`,
          code: "not_editable",
          message: model,
          diagnostics: [],
        });
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
      else report({ id: Date.now(), context, code: "not_editable", message: opened.message, diagnostics: [] });
    } catch (error) {
      report(toShownError(context, error));
    }
  }

  const listProps = {
    client,
    activePlaylist: data.settings?.playlist ?? null,
    disabled: lost,
    onChanged: changed,
    onError: report,
    onUpload: upload.openFiles,
    onNewPlaylist: () => editor.open(newModel()),
    uploadDisabledReason: upload.reason,
  };

  return (
    <div className="flex flex-col gap-4" data-testid="drop-area" {...upload.dropProps}>
      <PageHeader
        title="Board"
        description={DESCRIPTION}
        primary={{
          label: "Upload files",
          icon: Upload,
          onSelect: upload.openFiles,
          disabled: upload.reason !== null,
          reason: upload.reason,
        }}
        secondary={[
          {
            label: "Upload folder",
            icon: FolderUp,
            onSelect: upload.openFolder,
            disabled: upload.reason !== null,
            reason: upload.reason,
          },
        ]}
        more={[
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
        ]}
      />
      {upload.inputs}
      {blocked && blocked === uploadsBlocked && <BlockedNote reason={blocked} />}
      <RunningUpload />
      {wipe.notice}
      <ErrorList errors={errors} onDismiss={(id) => setErrors((current) => current.filter((e) => e.id !== id))} />
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
        <FileTabs
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
                onPreview={setPreview}
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
        />
        {data.settings && (
          <SettingsPanel
            client={client}
            settings={data.settings}
            playlists={playlistNames}
            missing={missing.get(data.settings.playlist) ?? []}
            missingContext={missingContext}
            disabled={lost}
            onSettings={setSettings}
            onError={report}
          />
        )}
        {settingsUnreadable && <SettingsUnreadable disabled={lost} onRetry={reload} />}
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
