import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { applyPatch, sharing } from "buni/format/patch.ts";
import type { Snapshot, SnapshotUpdate } from "../api.ts";
import { App } from "./App.tsx";
import { Home } from "./Home.tsx";

/** `prev` with an edit's changes; a patch that comes before the first snapshot is covered by that snapshot. */
function patched(prev: Snapshot, u: Extract<SnapshotUpdate, { kind: "patch" }>): Snapshot {
  const view = applyPatch(prev.view, u.view);
  return { ...prev, view, system: u.system ? applyPatch(prev.system, u.system) : view, owners: u.owners, recent: u.recent, ...(u.connected ? { connected: u.connected } : {}), ...(u.edits ? { edits: u.edits } : {}), ...(u.asking ? { asking: u.asking } : {}), ...(u.present ? { present: u.present } : {}), ...(u.agents ? { agents: u.agents } : {}) };
}

/** The designs a tab switched away from, as last drawn, newest last: switching back shows one at once. */
const seen = new Map<string, Snapshot>();
const KEEP = 4;

/** Home when no file is open, the editor when one is. */
function Root() {
  const [snap, setSnap] = useState<Snapshot | undefined>();
  const latest = useRef<Snapshot | undefined>(undefined);
  latest.current = snap;
  // The tab switched to another design (the web bridge): keep this one's, draw that one's if seen, until it arrives.
  useEffect(() => {
    const onSwitch = (e: Event) => {
      const to = e instanceof CustomEvent && typeof e.detail === "string" ? e.detail : undefined;
      const was = latest.current;
      if (was) {
        seen.delete(was.path);
        seen.set(was.path, was);
        if (seen.size > KEEP) seen.delete(seen.keys().next().value ?? "");
      }
      const cached = to ? seen.get(to) : undefined;
      if (cached) setSnap(cached);
    };
    window.addEventListener("buni:switch", onSwitch);
    return () => window.removeEventListener("buni:switch", onSwitch);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string>();
  useEffect(() => {
    void window.buni.snapshot().then(
      (s) => {
        setSnap(s);
        setLoaded(true);
      },
      // A file that can't be opened (gone, or not a .buni file) lands on the home screen, saying so.
      (e: unknown) => {
        setFailed(`That design couldn't be opened: ${e instanceof Error ? e.message : String(e)}`);
        setLoaded(true);
      },
    );
    return window.buni.onChange((u) => setSnap((prev) => {
      if (u.kind !== "whole") return prev && patched(prev, u);
      // The same design fetched again (after a switch drew it from the cache): what didn't change keeps its identity.
      const next = u.snap;
      if (!next || !prev || prev.path !== next.path) return next;
      const view = sharing(prev.view, next.view);
      return { ...next, view, system: next.system === next.view ? view : sharing(prev.system, next.system) };
    }));
  }, []);
  if (!loaded) return null;
  return snap ? <App key={snap.path} snap={snap} /> : <Home notice={failed} />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Root />);
