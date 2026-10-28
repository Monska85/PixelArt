// SPDX-License-Identifier: GPL-3.0-or-later

import { TimeSettings } from "./TimeSettings";
import { WhatToPlay, type WhatToPlayProps } from "./WhatToPlay";

/**
 * The settings of a firmware that knows schedules: what to play, and the time it is chosen by. The Settings card loads
 * this module only for such a board.
 */
export function PlaySettings(props: WhatToPlayProps) {
  return (
    <>
      <WhatToPlay {...props} />
      <TimeSettings settings={props.settings} disabled={props.disabled} change={props.change} />
    </>
  );
}
