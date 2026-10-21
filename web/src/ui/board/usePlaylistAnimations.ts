import { useEffect, useRef, useState } from "react";
import { downloadFile, type BoardClient, type Entry } from "../../protocol";
import { playlistAnimations } from "../../queue/plan";

type Names = ReadonlyMap<string, readonly string[]>;

const NONE: Names = new Map();
const keyOf = (entry: Entry): string => `${entry.id}:${entry.sha256 ?? `size-${entry.size}`}`;

/**
 * The playlist reads that failed, so an effect re-run does not repeat them in a loop. A failure is forgotten when the
 * connection or the list of playlists changes and while reads are paused, so the next chance retries it.
 */
export class ReadFailures {
  private scope: readonly unknown[] = [];
  private readonly keys = new Set<string>();

  sync(client: BoardClient, playlists: Entry[] | null, paused: boolean): void {
    if (paused || this.scope[0] !== client || this.scope[1] !== playlists) this.keys.clear();
    this.scope = [client, playlists];
  }
  has(key: string): boolean {
    return this.keys.has(key);
  }
  add(key: string): void {
    this.keys.add(key);
  }
}

/**
 * Reads the named playlists in turn. A read that fails is recorded, unless the effect was cancelled meanwhile: a
 * cancelled read says nothing about the playlist. Returns null when cancelled.
 */
export async function readNames(
  wanted: readonly Entry[],
  load: (entry: Entry) => Promise<readonly string[]>,
  failures: ReadFailures,
  isCurrent: () => boolean,
): Promise<Map<string, readonly string[]> | null> {
  const found = new Map<string, readonly string[]>();
  for (const entry of wanted) {
    try {
      found.set(keyOf(entry), await load(entry));
    } catch {
      if (isCurrent()) failures.add(keyOf(entry));
    }
    if (!isCurrent()) return null;
  }
  return found;
}

/**
 * The animations each stored playlist names, read from the board's copy. Nothing is read while `paused` (an upload
 * owns the board), and a playlist that cannot be read has no entry: it is not called anything.
 */
export function usePlaylistAnimations(client: BoardClient, playlists: Entry[] | null, paused: boolean): Names {
  // Read playlists by ID and content, for one connection.
  const [read, setRead] = useState<{ client: BoardClient; names: Names }>({ client, names: NONE });
  const failures = useRef(new ReadFailures());
  const names = read.client === client ? read.names : NONE;

  useEffect(() => {
    failures.current.sync(client, playlists, paused);
    if (paused || playlists === null) return;
    const wanted = playlists.filter((entry) => !names.has(keyOf(entry)) && !failures.current.has(keyOf(entry)));
    if (wanted.length === 0) return;
    let current = true;
    void (async () => {
      const found = await readNames(
        wanted,
        async (entry) => playlistAnimations(await downloadFile(client, "playlist", entry.id, entry)),
        failures.current,
        () => current,
      );
      if (found === null) return;
      setRead((previous) => ({
        client,
        names: new Map([...(previous.client === client ? previous.names : NONE), ...found]),
      }));
    })();
    return () => {
      current = false;
    };
  }, [client, playlists, paused, names]);

  const byId = new Map<string, readonly string[]>();
  for (const entry of playlists ?? []) {
    const named = names.get(keyOf(entry));
    if (named) byId.set(entry.id, named);
  }
  return byId;
}
