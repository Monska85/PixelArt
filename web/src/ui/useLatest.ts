import { useEffect, useRef } from "react";

/** A ref that always holds the latest value, for callbacks that async work calls after a render. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
