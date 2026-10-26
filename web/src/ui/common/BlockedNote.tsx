// SPDX-License-Identifier: GPL-3.0-or-later

import { Alert, AlertDescription } from "../components/alert";
import { useSession } from "../session";

/** The link to the Firmware view, where a board that is too old gets a firmware update, after a space. */
export function FirmwareLink() {
  return (
    <>
      {" "}
      <a href="#firmware" data-testid="firmware-link" className="font-medium text-primary underline underline-offset-4">
        Open the Firmware view
      </a>
    </>
  );
}

/** Why a view cannot send files. When the board's formats are the reason, it also points to the firmware update. */
export function BlockedNote({ reason }: { reason: string }) {
  const { uploadsBlocked } = useSession();
  return (
    <Alert variant="warning" data-testid="blocked-note">
      <AlertDescription className="text-foreground">
        {reason}
        {reason === uploadsBlocked && <FirmwareLink />}
      </AlertDescription>
    </Alert>
  );
}
