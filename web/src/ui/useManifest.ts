// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import { loadManifest, type Manifest } from "../release/manifest";

export type ManifestState = { status: "loading" } | { status: "none" } | { status: "ready"; manifest: Manifest };

/** The published release, read from the site when the view opens. */
export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void loadManifest().then((manifest) => {
      if (current) setState(manifest ? { status: "ready", manifest } : { status: "none" });
    });
    return () => {
      current = false;
    };
  }, []);
  return state;
}
