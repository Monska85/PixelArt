import { useEffect, useRef, useState } from "react";
import { loadAnimation, type AnimationResult } from "../../engine";
import type { Doc } from "../../editor/doc";
import { jsonBytes } from "../../yaml/writeJson";

const DELAY_MS = 250;

export const validate = (doc: Doc): AnimationResult => loadAnimation(jsonBytes(doc));

/**
 * The engine's verdict on a document. It is computed shortly after the last change, so typing and
 * dragging stay smooth; `pending` is true until then.
 */
export function useValidation(doc: Doc): { result: AnimationResult; pending: boolean } {
  const [result, setResult] = useState(() => validate(doc));
  const [validated, setValidated] = useState(doc);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      setResult(validate(doc));
      setValidated(doc);
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [doc]);
  return { result, pending: validated !== doc };
}
