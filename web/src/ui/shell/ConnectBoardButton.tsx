import type { ReactNode } from "react";
import { Button } from "../components/button";
import { SERIAL_SUPPORTED, session, useSession } from "../session";

/** Connect board: disabled while a connection starts or when the browser has no Web Serial. */
export function ConnectBoardButton({ onDone, children }: { onDone?: () => void; children: ReactNode }) {
  const { state, via } = useSession();
  const busy = state === "connecting";
  return (
    <Button
      disabled={busy || !SERIAL_SUPPORTED()}
      loading={busy && via === "board"}
      onClick={() => {
        const connecting = session.connectBoard();
        void (onDone ? connecting.finally(onDone) : connecting);
      }}
    >
      {children}
    </Button>
  );
}
