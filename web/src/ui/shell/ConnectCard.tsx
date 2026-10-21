import { ChevronRight, Usb } from "lucide-react";
import { useState } from "react";
import { SERIAL_UNSUPPORTED } from "../../protocol/serial";
import { Alert, AlertDescription } from "../components/alert";
import { Button } from "../components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/card";
import { cn } from "../components/cn";
import { SERIAL_SUPPORTED, session, useSession } from "../session";
import { SimulatorForm } from "./SimulatorForm";

/** Shown by the Board view while nothing is connected: Connect board, and the simulator folded under it. */
export function ConnectCard() {
  const { state, via } = useSession();
  const [simulator, setSimulator] = useState(false);
  const serial = SERIAL_SUPPORTED();
  const busy = state === "connecting";
  return (
    <Card aria-labelledby="connect-title">
      <CardHeader>
        <CardTitle id="connect-title">Connect a board</CardTitle>
        <CardDescription>Plug the board into this computer with a USB cable, then pick its port.</CardDescription>
      </CardHeader>
      <CardContent>
        {!serial && (
          <Alert variant="info">
            <AlertDescription className="text-foreground">{SERIAL_UNSUPPORTED}</AlertDescription>
          </Alert>
        )}
        <div>
          <Button
            disabled={busy || !serial}
            loading={busy && via === "board"}
            onClick={() => void session.connectBoard()}
          >
            <Usb aria-hidden="true" />
            Connect board
          </Button>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <button
            type="button"
            aria-expanded={simulator}
            aria-controls="simulator-form"
            className="flex w-fit items-center gap-1 rounded-md text-sm font-medium text-primary hover:underline"
            onClick={() => setSimulator((open) => !open)}
          >
            <ChevronRight className={cn("size-4 transition-transform", simulator && "rotate-90")} aria-hidden="true" />
            Use the simulator
          </button>
          <div id="simulator-form" hidden={!simulator} className="max-w-xl">
            {simulator && <SimulatorForm />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
