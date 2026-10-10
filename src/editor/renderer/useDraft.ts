import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/** Follow undo and other saved changes when clean; keep a person's unfinished draft. */
export function useDraft<T>(saved: T): [T, Dispatch<SetStateAction<T>>] {
  const encoded = JSON.stringify(saved);
  const base = useRef(encoded);
  const [draft, setDraft] = useState(saved);
  useEffect(() => {
    const previous = base.current;
    base.current = encoded;
    setDraft((current) => JSON.stringify(current) === previous ? saved : current);
  }, [encoded]);
  return [draft, setDraft];
}
