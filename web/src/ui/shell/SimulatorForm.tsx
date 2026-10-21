import { useState } from "react";
import { Button } from "../components/button";
import { Input } from "../components/input";
import { Field } from "../common/Field";
import { session, useSession } from "../session";
import { loadSimulatorAddress, saveSimulatorAddress } from "../storage";

/** The address of the simulator and the button that connects to it. */
export function SimulatorForm({ onDone }: { onDone?: () => void }) {
  const { state, via } = useSession();
  const [address, setAddress] = useState(loadSimulatorAddress);
  const connecting = state === "connecting";
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        saveSimulatorAddress(address);
        void session.connectSimulator(address).finally(onDone);
      }}
    >
      <Field
        label="Simulator address"
        hint="The first time a page from the internet connects to 127.0.0.1, Chrome may ask to allow access to devices on the local network."
      >
        {(control) => (
          <Input
            {...control}
            value={address}
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            className="font-mono"
            onChange={(e) => setAddress(e.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={connecting} loading={connecting && via === "simulator"}>
          Connect simulator
        </Button>
      </div>
    </form>
  );
}
