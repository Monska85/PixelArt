import { Button } from "../components/button";
import { FirmwareLink } from "../common/BlockedNote";
import { ErrorAlert } from "../common/ErrorAlert";
import { session, useSession } from "../session";

/** The one alert about the connection, under the top bar: a connection that failed, or one that was lost. */
export function ConnectionAlerts() {
  const { state, message, offerFirmware } = useSession();
  if (state === "lost")
    return (
      <ErrorAlert
        title="Connection lost. Reconnect to continue."
        testId="lost-alert"
        actions={<Button onClick={() => void session.reconnect()}>Reconnect</Button>}
      >
        {message && <p>{message}</p>}
      </ErrorAlert>
    );
  if (message && state === "disconnected")
    return (
      <ErrorAlert title="Could not connect" testId="connection-message">
        <p>
          {message}
          {offerFirmware && <FirmwareLink />}
        </p>
      </ErrorAlert>
    );
  return null;
}
