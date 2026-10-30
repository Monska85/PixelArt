// SPDX-License-Identifier: GPL-3.0-or-later

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ImprovClient, MAX_SCAN_NETWORKS, type ImprovLink, type WifiNetwork } from "../../protocol";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../components/dialog";
import { Input } from "../components/input";
import { Select } from "../components/select";
import { Field } from "../common/Field";
import { LoadingNote } from "../common/LoadingNote";
import { PASSWORD_NOTE } from "../privacy";
import { singleFlight } from "../singleFlight";
import { signalQuality } from "./wifi";

interface Props {
  link: ImprovLink;
  /** The board connected: the dialog has closed itself. */
  onConnected: () => void;
  onClose: () => void;
}

type Phase = "scanning" | "ready" | "connecting";

const OTHER = "\u0000other";

const describeNetwork = (network: WifiNetwork): string =>
  `${network.ssid} (${signalQuality(network.rssi)}, ${network.secure ? "password" : "open"})`;

/**
 * Sets up the board's WiFi with Improv on the serial port the app already uses: the networks the board sees, a name
 * and a password. The name and the password stay in this component's state only until they are sent, are never stored
 * by the app, and are never shown again.
 */
export function WifiSetupDialog({ link, onConnected, onClose }: Props) {
  const client = useMemo(() => new ImprovClient(link), [link]);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [choice, setChoice] = useState<string>(OTHER);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  // The effect below runs twice in development (StrictMode) and the client takes one request at a time: both runs
  // join the same scan.
  const [oneScan] = useState(singleFlight);

  // Lists the networks the board sees and ends the "scanning" phase, after a failure too.
  function listNetworks(): Promise<void> {
    return oneScan(async () => {
      try {
        const found = await client.scan();
        if (!mounted.current) return;
        setNetworks(found);
        setScanError(null);
        setChoice((current) => (found.some((n) => n.ssid === current) ? current : (found[0]?.ssid ?? OTHER)));
      } catch (e) {
        if (!mounted.current) return;
        setNetworks([]);
        setChoice(OTHER);
        setScanError(e instanceof Error ? e.message : "The scan failed.");
      } finally {
        if (mounted.current) setPhase("ready");
      }
    });
  }

  function scanAgain(): void {
    setPhase("scanning");
    setScanError(null);
    void listNetworks();
  }

  useEffect(() => {
    mounted.current = true;
    void listNetworks();
    return () => {
      mounted.current = false;
    };
    // The scan runs once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ssid = choice === OTHER ? name : choice;
  const chosen = networks.find((n) => n.ssid === choice);
  const needsPassword = chosen ? chosen.secure : true;

  async function connect(): Promise<void> {
    setPhase("connecting");
    setError(null);
    try {
      await client.provision(ssid, password);
    } catch (e) {
      if (!mounted.current) return;
      setPassword("");
      setError(e instanceof Error ? e.message : "The connection failed.");
      setPhase("ready");
      return;
    }
    if (!mounted.current) return;
    setPassword("");
    onConnected();
  }

  const connecting = phase === "connecting";
  return (
    <Dialog open onOpenChange={(open) => !open && !connecting && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Set up WiFi</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (phase === "ready" && ssid) void connect();
          }}
        >
          <p className="text-sm text-muted-foreground">
            The board joins the network and keeps its name and password in its own memory. It needs a 2.4 GHz network.
          </p>
          {phase === "scanning" && <LoadingNote>Looking for networks...</LoadingNote>}
          {scanError && (
            <Alert variant="warning">
              <AlertDescription className="text-foreground">
                {scanError} You can type the network name instead.
              </AlertDescription>
            </Alert>
          )}
          {networks.length > 0 && (
            <Field label="Network">
              {(control) => (
                <Select
                  {...control}
                  value={choice}
                  disabled={phase !== "ready"}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  {networks.map((network) => (
                    <option key={network.ssid} value={network.ssid}>
                      {describeNetwork(network)}
                    </option>
                  ))}
                  <option value={OTHER}>Other network...</option>
                </Select>
              )}
            </Field>
          )}
          {networks.length === MAX_SCAN_NETWORKS && (
            <p className="text-sm text-muted-foreground">
              Showing up to {MAX_SCAN_NETWORKS} networks. Choose Other network to type a name.
            </p>
          )}
          {choice === OTHER && (
            <Field label="Network name">
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  disabled={phase !== "ready"}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  maxLength={32}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
          )}
          <Field
            label="Password"
            hint={needsPassword ? PASSWORD_NOTE : `This network has no password. ${PASSWORD_NOTE}`}
          >
            {(control) => (
              <Input
                {...control}
                type="password"
                value={password}
                disabled={phase !== "ready" || !needsPassword}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {connecting && <LoadingNote>Connecting. This can take up to 30 seconds.</LoadingNote>}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={connecting} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="outline" disabled={phase !== "ready"} onClick={scanAgain}>
              <RefreshCw aria-hidden="true" />
              Scan again
            </Button>
            <Button type="submit" disabled={phase !== "ready" || !ssid}>
              {connecting && <Loader2 className="animate-spin-slow" aria-hidden="true" />}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
