import { useEffect, useRef, useState, type ReactNode } from "react";
import { SERIAL_UNSUPPORTED } from "../../protocol/serial";
import { checkFirmware, type FirmwareCheck } from "../../release/semver";
import { Alert, AlertDescription, AlertTitle } from "../components/alert";
import { Badge } from "../components/badge";
import { Button } from "../components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card";
import { Checkbox } from "../components/checkbox";
import { Label } from "../components/label";
import { DEFAULTS_TEXT, useDeleteEverything } from "../common/DeleteEverything";
import { EmptyList } from "../common/FileTable";
import { LoadingNote } from "../common/LoadingNote";
import { PageHeader } from "../common/Page";
import { SERIAL_SUPPORTED, session, useSession } from "../session";
import { useUploadRunning } from "../upload";
import { useLatest } from "../useLatest";
import { useManifest } from "../useManifest";
import { closeConnectionBeforeClick } from "./handover";

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
  const { state, info, client } = useSession();
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
  const serial = SERIAL_SUPPORTED();
  const installer = useInstaller(manifest.status === "ready" && serial);

  if (manifest.status === "loading")
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <LoadingNote>Checking for a firmware release...</LoadingNote>
      </div>
    );
  if (manifest.status === "none")
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <Card data-testid="firmware-empty">
          <EmptyList title="No firmware release is published yet">
            The firmware appears here once a release is published.
          </EmptyList>
        </Card>
        {reset}
      </div>
    );

  const latest = manifest.manifest.version;
  const check = state === "connected" && info ? checkFirmware(info.firmware, latest) : null;
  const development = check !== null && check.kind !== "incomparable" && check.development;
  const handover = () => setHandedOver(true);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        primaryNode={
          serial && installer === "ready" ? (
            <InstallButton
              manifest="./firmware/update.json"
              label="Update firmware"
              variant="default"
              onHandover={handover}
            />
          ) : (
            <Button disabled loading={serial && installer === "loading"}>
              Update firmware
            </Button>
          )
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
      {handedOver && state !== "connected" && (
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
          <p className="text-sm text-muted-foreground">
            ESP Web Tools closes the connection of this app, because a serial port can only be open once. Put the board
            in download mode first if it does not appear in the list: hold BOOT while plugging it in.
          </p>
        </CardContent>
      </Card>

      <Card aria-labelledby="firmware-scratch">
        <CardHeader>
          <CardTitle id="firmware-scratch">Install from scratch</CardTitle>
          <CardDescription>
            For a new board, or to start over. It writes the firmware and the published animations and playlists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="warning" data-testid="erase-warning">
            <AlertTitle>This can erase the board</AlertTitle>
            <AlertDescription>
              ESP Web Tools offers to erase the board first. Erasing deletes the settings and every stored file.
            </AlertDescription>
          </Alert>
          <div>
            {serial && installer === "ready" ? (
              <InstallButton
                manifest="./firmware/install.json"
                label="Install from scratch"
                variant="destructive-outline"
                onHandover={handover}
              />
            ) : (
              <Button variant="outline" disabled loading={serial && installer === "loading"}>
                Install from scratch
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {reset}
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
  return (
    <Card aria-labelledby="firmware-reset">
      <CardHeader>
        <CardTitle id="firmware-reset">Reset</CardTitle>
        <CardDescription>
          Delete every animation and playlist stored on the board, and if you choose, put the settings back to their
          defaults: {DEFAULTS_TEXT}. The firmware stays.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {notice}
        <div className="flex items-start gap-2">
          <Checkbox
            id="reset-card-settings"
            className="mt-0.5"
            checked={resetSettings}
            onCheckedChange={(checked) => setResetSettings(checked === true)}
          />
          <Label htmlFor="reset-card-settings" className="leading-normal">
            Also reset the settings
          </Label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="destructive-outline"
            disabled={!connected || disabled}
            onClick={() => {
              onDelete(resetSettings);
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

function InstallButton({
  manifest,
  label,
  variant,
  onHandover,
}: {
  manifest: string;
  label: string;
  variant: "default" | "destructive-outline";
  onHandover: () => void;
}) {
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
