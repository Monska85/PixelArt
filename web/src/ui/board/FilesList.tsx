import { Download, FileJson, FileText, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { loadAnimation } from "../../engine";
import { session } from "../session";
import { deleteFile, downloadFile, type BoardClient, type Entry, type Kind } from "../../protocol";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { IconButton } from "../components/icon-button";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { downloadHeld, useHeldId } from "../editor/holding";
import { EmptyList, FileTable, type FileRowData } from "../common/FileTable";
import { ListUnreadable } from "../common/ListUnreadable";
import { LoadingNote } from "../common/LoadingNote";
import type { BoardFileList } from "../fileLists";
import { MoreMenu } from "../common/MoreMenu";
import type { PreviewData } from "../common/PreviewPanel";
import { toShownError, type ShownError } from "../errors";
import { jsonBytesToYaml, saveBytes } from "../files";
import { formatSize } from "../format";
import { InstallMissingButton, MissingBadge, type MissingContext } from "./MissingAnimations";

interface Props {
  client: BoardClient;
  kind: Kind;
  /** What the session knows of this list: only a known list can be empty. */
  list: BoardFileList;
  activePlaylist: string | null;
  disabled: boolean;
  onChanged: () => void;
  onError: (error: ShownError) => void;
  onEdit: (id: string) => void;
  onPreview?: (preview: PreviewData) => void;
  /** The preview shown now, so deleting its animation closes it. */
  previewId?: string | null;
  onClosePreview?: () => void;
  onUpload: () => void;
  onNewPlaylist: () => void;
  uploadDisabledReason: string | null;
  /** Playlists only: the animations each playlist names that the board lacks (only known playlists have an entry). */
  missing?: ReadonlyMap<string, string[]>;
  missingContext?: MissingContext;
}

/** One list of the Board view: its table, the actions of each row, and the empty state. */
export function FilesList({
  client,
  kind,
  list,
  activePlaylist,
  disabled,
  onChanged,
  onError,
  onEdit,
  onPreview,
  previewId,
  onClosePreview,
  onUpload,
  onNewPlaylist,
  uploadDisabledReason,
  missing,
  missingContext,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const noun = kind === "animation" ? "animation" : "playlist";
  const held = useHeldId();

  async function run(id: string, context: string, action: () => Promise<void>): Promise<void> {
    setBusy(id);
    try {
      await action();
    } catch (error) {
      onError(toShownError(`${context} ${id}`, error));
    } finally {
      setBusy(null);
    }
  }

  const download = (entry: Entry, yaml: boolean): Promise<void> =>
    run(entry.id, "Downloading", async () => {
      const bytes = await downloadFile(client, kind, entry.id);
      if (yaml) saveBytes(new TextEncoder().encode(jsonBytesToYaml(bytes)), `${entry.id}.yaml`, "application/yaml");
      else saveBytes(bytes, `${entry.id}.json`, "application/json");
    });

  const showPreview = (entry: Entry): Promise<void> =>
    run(entry.id, "Previewing", async () => {
      const bytes = await downloadFile(client, kind, entry.id);
      const result = loadAnimation(bytes);
      onPreview?.({ id: entry.id, animation: result.animation, diagnostics: result.diagnostics });
    });

  const remove = (entry: Entry): Promise<void> =>
    run(entry.id, "Deleting", async () => {
      setConfirm(null);
      await deleteFile(client, kind, entry.id);
      void session.refreshFiles([kind]);
      if (previewId === entry.id && kind === "animation") onClosePreview?.();
      onChanged();
    });

  if (list.status === "loading")
    return (
      <div className="px-4 py-10" data-testid="list-loading">
        <LoadingNote>Reading the files from the board...</LoadingNote>
      </div>
    );
  if (list.status === "unknown")
    return (
      <div className="px-4 py-6">
        <ListUnreadable disabled={disabled} />
      </div>
    );
  const entries = list.entries;
  if (entries.length === 0)
    return (
      <EmptyList
        title={`No ${noun}s on this board`}
        actions={
          <>
            {kind === "animation" ? (
              <Button disabled={uploadDisabledReason !== null || disabled} onClick={onUpload}>
                <Upload aria-hidden="true" />
                Upload files
              </Button>
            ) : (
              <Button disabled={disabled} onClick={onNewPlaylist}>
                <Plus aria-hidden="true" />
                New playlist
              </Button>
            )}
            <Button variant="outline" asChild>
              <a href="#library">
                <Download aria-hidden="true" />
                Install from the Library
              </a>
            </Button>
          </>
        }
      >
        {kind === "animation"
          ? "Upload YAML or JSON files from this computer, or install the published ones from the Library."
          : "Make a playlist to choose which animations play and in what order, or install the published ones from the Library."}
      </EmptyList>
    );

  const rows: FileRowData[] = entries.map((entry) => {
    const inactive = disabled || busy !== null;
    const gaps = kind === "playlist" ? missing?.get(entry.id) : undefined;
    return {
      key: entry.id,
      id: entry.id,
      name: entry.name ?? null,
      badge: (
        <>
          {kind === "playlist" && entry.id === activePlaylist && (
            <Badge variant="success" data-testid={`active-${entry.id}`}>
              Active
            </Badge>
          )}
          {gaps && missingContext && <MissingBadge playlist={entry.id} missing={gaps} context={missingContext} />}
        </>
      ),
      cells: [
        ...(kind === "animation" ? [entry.version ?? ""] : []),
        <span key="size" data-testid={`size-${entry.id}`}>
          {formatSize(entry.size)}
        </span>,
      ],
      actions: (
        <>
          {kind === "animation" && (
            <IconButton
              label={`Preview ${entry.id}`}
              tooltip="Preview"
              icon={Play}
              disabled={inactive}
              onClick={() => void showPreview(entry)}
            />
          )}
          <IconButton
            label={`Edit ${entry.id}`}
            tooltip={kind === "animation" ? "Edit in the Editor" : "Edit playlist"}
            icon={Pencil}
            disabled={inactive}
            onClick={() => onEdit(entry.id)}
          />
          {gaps && missingContext && (
            <InstallMissingButton playlist={entry.id} missing={gaps} context={missingContext} />
          )}
          <MoreMenu
            label={`More actions for ${entry.id}`}
            disabled={inactive}
            entries={[
              { label: "Download JSON", icon: FileJson, onSelect: () => void download(entry, false) },
              { label: "Download YAML", icon: FileText, onSelect: () => void download(entry, true) },
              { label: "Delete", icon: Trash2, destructive: true, onSelect: () => setConfirm(entry) },
            ]}
          />
        </>
      ),
    };
  });

  return (
    <>
      <FileTable
        label={kind === "animation" ? "Animations on the board" : "Playlists on the board"}
        columns={[
          ...(kind === "animation" ? [{ label: "Version", width: "w-24" }] : []),
          { label: "Size", width: "w-28" },
        ]}
        rows={rows}
      />
      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.id}?`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setConfirm(null)}
          onConfirm={() => void remove(confirm)}
          extraAction={
            kind === "animation" &&
            held === confirm.id && (
              <Button variant="outline" onClick={() => downloadHeld()}>
                Download YAML first
              </Button>
            )
          }
        >
          <p>
            This deletes the {noun} <code className="text-foreground">{confirm.id}</code> from the board. It cannot be
            undone.
          </p>
          {kind === "playlist" && confirm.id === activePlaylist && (
            <p>This is the active playlist: the board will then play every animation.</p>
          )}
          {kind === "animation" && held === confirm.id && (
            <p data-testid="only-copy">The editor holds this animation and it has no other saved copy.</p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
