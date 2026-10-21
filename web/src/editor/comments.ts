// Detects comments in YAML text, to tell the user when a change made in the
// visual editor rewrites the text without them.

import { Parser } from "yaml";

function hasComment(token: unknown): boolean {
  if (Array.isArray(token)) return token.some(hasComment);
  if (typeof token !== "object" || token === null) return false;
  const record = token as Record<string, unknown>;
  if (record.type === "comment") return true;
  return Object.values(record).some((value) => typeof value === "object" && hasComment(value));
}

/** True when the YAML text has at least one comment. */
export function hasComments(text: string): boolean {
  if (!text.includes("#")) return false;
  try {
    for (const token of new Parser().parse(text)) if (hasComment(token)) return true;
  } catch {
    // Text the parser cannot read has no comments that matter.
  }
  return false;
}
