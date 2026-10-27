// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useRef, useState, type ReactNode } from "react";
import { SERIAL_UNSUPPORTED } from "../../protocol/serial";
import { checkFirmware, type FirmwareCheck } from "../../release/semver";
import { Alert, AlertDescription, AlertTitle } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card";
import { Checkbox } from "../components/checkbox";
import { Label } from "../components/label";
import { RunningUpload } from "../common/ActivityPanel";
import { ResetBox, RESET_TEXT, useDeleteEverything } from "../common/DeleteEverything";
import { ManifestPending, PageHeader } from "../common/Page";
import { SERIAL_SUPPORTED, session, useSession } from "../session";
import { useUploadRunning } from "../upload";
import { useLatest } from "../useLatest";
import { useManifest } from "../useManifest";
import { closeConnectionBeforeClick } from "./handover";
import { SCRATCH_MANIFEST } from "./installDialog";
import { onOldLayout } from "./layout";
import { NetworkUpdates } from "./NetworkUpdates";
import { useContentInstall } from "./useContentInstall";

const TITLE = "Firmware";
const DESCRIPTION = "Install or update the board's firmware.";

function badgeFor(check: FirmwareCheck): ReactNode {
  switch (check.kind) {
    case "older":
      return <Badge variant="warning">Update available</Badge>;
    case "same":
      return <Badge variant="success">Up to date</Badge>;
    case "newer":
      return <Badge variant="info">Newer than the release</Badge>;
    case "incomparable":
      return <Badge variant="outline">Not compared</Badge>;
  }
}

export function FirmwareView() {
  const manifest = useManifest();
  const { state, info, client, restarts } = useSession();
  const [handedOver, setHandedOver] = useState(false);
  const wipe = useDeleteEverything({
    client: state === "connected" ? client : null,
    onDone: () => void session.refreshInfo(),
    onFirmwareView: true,
  });
  const uploadRunning = useUploadRunning();
  const reset = (
    <ResetCard
      connected={state === "connected"}
      disabled={wipe.checking || uploadRunning}
      onDelete={(resetSettings) => wipe.start({ resetSettings })}
      notice={wipe.notice}
      dialogs={wipe.dialogs}
    />
  );
  const network =
    state === "connected" && client ? (
      <NetworkUpdates client={client} restarts={restarts} paused={uploadRunning} />
    ) : null;
  const serial = SERIAL_SUPPORTED();
  // A manifest without firmware (a content release alone) has no firmware version to offer or to compare.
  const release = manifest.status === "ready" && manifest.manifest.hasFirmware ? manifest.manifest : null;
  const installer = useInstaller(release !== null && serial);
  const published =
    manifest.status === "ready" && manifest.manifest.animations.length + manifest.manifest.playlists.length > 0;
  const [thenInstall, setThenInstall] = useState(true);
  const content = useContentInstall(manifest.status === "ready" ? manifest.manifest : null, thenInstall && published);

  if (release === null)
    return (
      <ManifestPending
        title={TITLE}
        description={DESCRIPTION}
        loading={manifest.status === "loading"}
        loadingText="Checking for a firmware release..."
        emptyTitle="No firmware release is published yet"
        emptyTestId="firmware-empty"
        emptyText="The firmware appears here once a release is published."
      >
        {network}
        {reset}
      </ManifestPending>
    );

  const latest = release.version;
  const check = state === "connected" && info ? checkFirmware(info.firmware, latest) : null;
  const development = check !== null && check.kind !== "incomparable" && check.development;
  const oldLayout = state === "connected" && onOldLayout(info);
  const handover = () => setHandedOver(true);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        primaryNode={
          <InstallButton
            state={serial ? installer : "failed"}
            manifest="./firmware/update.json"
            label="Update firmware"
            variant="default"
            fallbackVariant="default"
            onHandover={handover}
          />
        }
      />
      {!serial && (
        <Alert variant="info">
          <AlertDescription className="text-foreground">{SERIAL_UNSUPPORTED}</AlertDescription>
        </Alert>
      )}
      {installer === "failed" && (
        <Alert variant="destructive">
          <AlertTitle>The installer could not be loaded</AlertTitle>
          <AlertDescription>Reload the page.</AlertDescription>
        </Alert>
      )}
      <RunningUpload />
      {content.notice}
      {handedOver && state !== "connected" && !content.following && (
        <Alert variant="info" data-testid="reconnect">
          <AlertTitle>The connection of this app was closed</AlertTitle>
          <AlertDescription>
            <p>
              ESP Web Tools needs the port. When the installation is done and the board has restarted, connect again to
              see the new version.
            </p>
            <div className="pt-2">
              <Button variant="outline" loading={state === "connecting"} onClick={() => void session.connectBoard()}>
                Connect board
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card aria-labelledby="firmware-status">
        <CardHeader>
          <CardTitle id="firmware-status">Status</CardTitle>
        </CardHeader>
        <CardContent>
          {info && check ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="firmware-check">
              <p>
                This board runs <strong>{info.firmware}</strong>. The latest release is{" "}
                <strong data-testid="firmware-latest">{latest}</strong>.
              </p>
              {badgeFor(check)}
              {development && <Badge variant="outline">Development build</Badge>}
              {check.kind === "incomparable" && (
                <p className="basis-full text-sm text-muted-foreground">
                  At least one of them is not a valid version number, so they are not compared.
                </p>
              )}
            </div>
          ) : (
            <p>
              The latest release is <strong data-testid="firmware-latest">{latest}</strong>. Connect a board to compare
              it with the firmware it runs.
            </p>
          )}
          {oldLayout && (
            <Alert variant="warning" data-testid="old-layout">
              <AlertTitle>This board needs Install from scratch once</AlertTitle>
              <AlertDescription>
                It still has the flash layout of the firmware before WiFi, and Update firmware cannot move its stored
                files to the current one. Use Install from scratch below and let it erase the board: that deletes the
                animations, playlists and settings, and the app then installs the published animations and playlists.
                Later updates keep them.
              </AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">
            ESP Web Tools closes the connection of this app, because a serial port can only be open once. Put the board
            in download mode first if it does not appear in the list: hold BOOT while plugging it in.
          </p>
        </CardContent>
      </Card>

      {network}

      <Card aria-labelledby="firmware-scratch">
        <CardHeader>
          <CardTitle id="firmware-scratch">Install from scratch</CardTitle>
          <CardDescription>
            For a new board, to start over, or once for a board flashed before the firmware with WiFi, whose stored
            files Update firmware cannot move to the current flash layout. It writes the firmware. The animations and
            playlists of the latest release follow when the box below is checked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="warning" data-testid="erase-warning">
            <AlertTitle>This can erase the board</AlertTitle>
            <AlertDescription>
              ESP Web Tools offers to erase the board first. Erasing deletes the settings and every stored file.
            </AlertDescription>
          </Alert>
          <div className="flex items-start gap-2">
            <Checkbox
              id="then-install-content"
              className="mt-0.5"
              checked={thenInstall && published}
              disabled={!published}
              onCheckedChange={(value) => setThenInstall(value === true)}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="then-install-content" className="leading-normal text-foreground">
                Then install the animations and playlists
              </Label>
              <p className="text-sm text-muted-foreground">
                {published
                  ? "Keep the board connected until they are installed: the app opens the same port when the installation is done."
                  : "No animations or playlists are published."}
              </p>
            </div>
          </div>
          <div>
            <InstallButton
              state={serial ? installer : "failed"}
              manifest={SCRATCH_MANIFEST}
              label="Install from scratch"
              variant="destructive-outline"
              fallbackVariant="outline"
              onHandover={handover}
            />
          </div>
        </CardContent>
      </Card>

      {reset}
      {content.dialogs}
    </div>
  );
}

/** Delete everything, with the dialog of the Board view. */
function ResetCard({
  connected,
  disabled,
  onDelete,
  notice,
  dialogs,
}: {
  connected: boolean;
  disabled: boolean;
  onDelete: (resetSettings: boolean) => void;
  notice: ReactNode;
  dialogs: ReactNode;
}) {
  // Checked here, the dialog opens with its own box checked too, and a board without files can still be reset.
  const [resetSettings, setResetSettings] = useState(false);
  const overWifi = useSession().via === "wifi";
  return (
    <Card aria-labelledby="firmware-reset">
      <CardHeader>
        <CardTitle id="firmware-reset">Reset</CardTitle>
        <CardDescription>
          Delete every animation and playlist stored on the board. The firmware stays. With the box checked,{" "}
          {RESET_TEXT.charAt(0).toLowerCase() + RESET_TEXT.slice(1)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {notice}
        <ResetBox
          id="reset-card-settings"
          checked={resetSettings && !overWifi}
          overWifi={overWifi}
          onChange={setResetSettings}
          labelClassName=""
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="destructive-outline"
            disabled={!connected || disabled}
            onClick={() => {
              onDelete(resetSettings && !overWifi);
              // The dialog carries the choice from here: the box is off again for the next time.
              setResetSettings(false);
            }}
          >
            Delete everything
          </Button>
          {!connected && <p className="text-sm text-muted-foreground">Connect a board to delete its files.</p>}
        </div>
      </CardContent>
      {dialogs}
    </Card>
  );
}

type Loading = "loading" | "ready" | "failed";

/** Loads ESP Web Tools, which is large, only when the Firmware view needs it. */
function useInstaller(wanted: boolean): Loading {
  const [loaded, setLoaded] = useState<Loading>("loading");
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    import("esp-web-tools/dist/web/install-button.js").then(
      () => current && setLoaded("ready"),
      () => current && setLoaded("failed"),
    );
    return () => {
      current = false;
    };
  }, [wanted]);
  return loaded;
}

interface InstallerProps {
  manifest: string;
  label: string;
  variant: "default" | "destructive-outline";
  onHandover: () => void;
}

/** The installer's button once the installer is ready; before that, or without it, a disabled `fallbackVariant` one. */
function InstallButton({
  state,
  fallbackVariant,
  ...props
}: InstallerProps & { state: Loading; fallbackVariant: "default" | "outline" }) {
  if (state === "ready") return <Installer {...props} />;
  return (
    <Button variant={fallbackVariant} disabled loading={state === "loading"}>
      {props.label}
    </Button>
  );
}

function Installer({ manifest, label, variant, onHandover }: InstallerProps) {
  const host = useRef<HTMLElement>(null);
  const handover = useLatest(onHandover);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    return closeConnectionBeforeClick(
      element,
      () => session.getSnapshot().state !== "disconnected",
      async () => {
        await session.disconnect();
        handover.current();
      },
    );
  }, [handover]);
  return (
    <esp-web-install-button ref={host} manifest={manifest}>
      <Button slot="activate" variant={variant}>
        {label}
      </Button>
      <span slot="unsupported">{SERIAL_UNSUPPORTED}</span>
      <span slot="not-allowed">Installing firmware needs a secure page (https) or localhost.</span>
    </esp-web-install-button>
  );
}
