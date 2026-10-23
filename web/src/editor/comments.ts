// Detects comments in YAML text, to tell the user when a change made in the
// visual editor rewrites the text without them.

import { CST, Lexer } from "yaml";

/** True when the YAML text has at least one comment. */
export const hasComments = (text: string): boolean =>
  text.includes("#") && [...new Lexer().lex(text)].some((token) => CST.tokenType(token) === "comment");
