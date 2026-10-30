// SPDX-License-Identifier: GPL-3.0-or-later

import { useEffect, useState } from "react";
import type { Manifest } from "../release/manifest";

export type ManifestState = { status: "loading" } | { status: "none" } | { status: "ready"; manifest: Manifest };

let inFlight: Promise<Manifest | null> | null = null;

function readManifest(): Promise<Manifest | null> {
  if (inFlight) return inFlight;
  const request = import("../release/manifest").then(({ loadManifest }) => loadManifest()).catch(() => null);
  inFlight = request;
  void request.then(() => {
    if (inFlight === request) inFlight = null;
  });
  return request;
}

/** The published release, read from the site when the view opens. */
export function useManifest(): ManifestState {
  const [state, setState] = useState<ManifestState>({ status: "loading" });
  useEffect(() => {
    let current = true;
    void readManifest().then((manifest) => {
      if (current) setState(manifest ? { status: "ready", manifest } : { status: "none" });
    });
    return () => {
      current = false;
    };
  }, []);
  return state;
}
