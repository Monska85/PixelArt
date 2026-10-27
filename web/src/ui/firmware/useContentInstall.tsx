// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SerialPortLike } from "../../protocol/serial";
import { contentVersionOf, type Manifest } from "../../release/manifest";
import { Button } from "../components/button";
import { ErrorAlert } from "../common/ErrorAlert";
import { ErrorList, useErrorList } from "../common/ErrorList";
import { session, useSession } from "../session";
import { useUploadQueue } from "../queue/useUploadQueue";
import { announceActivity } from "../upload";
import { useLatest } from "../useLatest";
import { watchInstallDialogs } from "./installDialog";

type Phase = "idle" | "connecting" | "connected" | "running" | "failed";

interface Job {
  manifest: Manifest;
  /** Clears the activity panel's announcement. */
  stop: () => void;
}

/**
 * The animations and playlists after a first install (docs/web/web-app-v1.md#install-and-update): when the ESP Web
 * Tools dialog of Install from scratch closes after a finished installation and `enabled` is true, connect over the
 * port it used and send everything the release publishes through the upload queue.
 */
export function useContentInstall(manifest: Manifest | null, enabled: boolean) {
  const { state, client } = useSession();
  const { errors, report, dismiss } = useErrorList();
  const queue = useUploadQueue({
    client: state === "connected" ? client : null,
    onProblem: report,
    onFinished: () => void session.refreshInfo(),
  });
  // "connected" means the port is open and the queue starts in the render that has the client. The job is a ref, so
  // a repeated effect run never starts the queue twice and leaving the view drops it.
  const [phase, setPhase] = useState<Phase>("idle");
  const job = useRef<Job | null>(null);
  const latest = useLatest({ manifest, enabled });

  useEffect(() => {
    async function start(port: SerialPortLike, release: Manifest): Promise<void> {
      if (job.current) return;
      const mine: Job = {
        manifest: release,
        stop: announceActivity(`Installing the animations and playlists of release ${contentVersionOf(release)}`),
      };
      job.current = mine;
      setPhase("connecting");
      const ok = await session.connectPort(port);
      // The view was left meanwhile: the connection stays, the installation does not follow.
      if (job.current !== mine) return;
      if (!ok) {
        mine.stop();
        job.current = null;
        setPhase("failed");
        return;
      }
      setPhase("connected");
    }
    const stopWatching = watchInstallDialogs((port) => {
      const { manifest, enabled } = latest.current;
      if (enabled && manifest) void start(port, manifest);
    });
    return () => {
      stopWatching();
      job.current?.stop();
      job.current = null;
    };
  }, [latest]);

  const { install } = queue;
  useEffect(() => {
    const current = job.current;
    if (phase !== "connected" || !current || state !== "connected" || !client) return;
    setPhase("running");
    const { manifest } = current;
    const items = [
      ...manifest.animations.map((entry) => ({ kind: "animation" as const, entry })),
      ...manifest.playlists.map((entry) => ({ kind: "playlist" as const, entry })),
    ];
    void install(items, manifest).finally(() => {
      current.stop();
      if (job.current !== current) return;
      job.current = null;
      setPhase("idle");
    });
  }, [phase, state, client, install]);

  const notice: ReactNode = (
    <>
      {phase === "failed" && (
        <ErrorAlert
          title="The animations and playlists were not installed"
          testId="content-not-installed"
          onDismiss={() => setPhase("idle")}
          actions={
            <Button variant="outline" onClick={() => void session.connectBoard()}>
              Connect board
            </Button>
          }
        >
          <p>
            The board could not be reached after the installation. It shows its &quot;no animations&quot; image until it
            gets them. Connect the board, then use <strong>Install all</strong> in the{" "}
            <a href="#library" className="font-medium text-primary underline underline-offset-4">
              Library view
            </a>
            .
          </p>
        </ErrorAlert>
      )}
      <ErrorList errors={errors} onDismiss={dismiss} />
    </>
  );
  return { notice, dialogs: queue.dialogs, following: phase !== "idle" };
}
