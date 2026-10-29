// SPDX-License-Identifier: GPL-3.0-or-later

import { useState } from "react";
import type { SettingsChanges } from "../../protocol";

/**
 * Sends settings changes through `change`, and says whether one is on its way, so the controls stay disabled until
 * the board answers.
 */
export function usePendingSend(change: (changes: SettingsChanges, context: string) => Promise<void>) {
  const [pending, setPending] = useState(false);

  async function send(changes: SettingsChanges, context: string): Promise<void> {
    setPending(true);
    try {
      await change(changes, context);
    } finally {
      setPending(false);
    }
  }

  return { pending, send };
}
