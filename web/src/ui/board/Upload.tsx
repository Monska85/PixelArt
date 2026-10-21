import { useRef, useState, type DragEvent, type ReactNode } from "react";
import type { BoardClient } from "../../protocol";
import { blockedOrBusy } from "../upload";
import { useUploadQueue, type UploadQueue } from "../queue/useUploadQueue";
import type { ShownError } from "../errors";

interface Options {
  client: BoardClient;
  /** Why uploads are not possible now (no connection, a board that cannot read the formats), or null. */
  blocked: string | null;
  onUploaded: () => void;
  /** A file that was refused, rejected or failed, and the summary of a queue: shown as an alert next to the list. */
  onProblem: (problem: ShownError) => void;
}

/**
 * Uploading from the Board view: the pickers (hidden inputs) and dropping on the view. Every file goes through the
 * shared upload queue.
 */
export function useBoardUpload({ client, blocked, onUploaded, onProblem }: Options): {
  /** Render once, anywhere in the view. */
  inputs: ReactNode;
  dialogs: ReactNode;
  /** The queue behind the pickers, for the other ways to send files from this view. */
  queue: UploadQueue;
  openFiles: () => void;
  openFolder: () => void;
  /** Why the pickers are disabled, or null. */
  reason: string | null;
  dragOver: boolean;
  dropProps: {
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
} {
  const [dragOver, setDragOver] = useState(false);
  const queue = useUploadQueue({ client, onProblem, onFinished: onUploaded });
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const reason = blockedOrBusy(blocked, queue.busy);

  async function addFiles(picked: File[]): Promise<void> {
    if (reason !== null) return;
    await queue.uploadFiles(picked);
  }

  const onChosen = (input: HTMLInputElement): void => {
    void addFiles(Array.from(input.files ?? []));
    input.value = "";
  };

  const inputs = (
    <>
      <input
        id="upload-input"
        ref={files}
        className="sr-only"
        type="file"
        multiple
        accept=".json,.yaml,.yml"
        tabIndex={-1}
        aria-label="Choose files to upload"
        disabled={reason !== null}
        onChange={(e) => onChosen(e.target)}
      />
      <input
        id="upload-folder-input"
        ref={(element) => {
          folder.current = element;
          // Not in React's types: lets the user pick a whole folder, subfolders included.
          element?.setAttribute("webkitdirectory", "");
        }}
        className="sr-only"
        type="file"
        multiple
        tabIndex={-1}
        aria-label="Choose a folder to upload"
        disabled={reason !== null}
        onChange={(e) => onChosen(e.target)}
      />
    </>
  );

  return {
    inputs,
    dialogs: queue.dialogs,
    queue,
    openFiles: () => files.current?.click(),
    openFolder: () => folder.current?.click(),
    reason,
    dragOver,
    dropProps: {
      onDragOver: (event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      },
      onDragLeave: () => setDragOver(false),
      onDrop: (event) => {
        event.preventDefault();
        setDragOver(false);
        void addFiles(Array.from(event.dataTransfer.files));
      },
    },
  };
}
