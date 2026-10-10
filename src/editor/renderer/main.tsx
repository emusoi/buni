import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { applyPatch } from "buni/format/patch.ts";
import type { Snapshot, SnapshotUpdate } from "../api.ts";
import { App } from "./App.tsx";
import { Home } from "./Home.tsx";

/** `prev` with an edit's changes; a patch that comes before the first snapshot is covered by that snapshot. */
function patched(prev: Snapshot, u: Extract<SnapshotUpdate, { kind: "patch" }>): Snapshot {
  const view = applyPatch(prev.view, u.view);
  return { ...prev, view, system: u.system ? applyPatch(prev.system, u.system) : view, owners: u.owners, recent: u.recent, ...(u.connected ? { connected: u.connected } : {}), ...(u.edits ? { edits: u.edits } : {}) };
}

/** Home when no file is open, the editor when one is. */
function Root() {
  const [snap, setSnap] = useState<Snapshot | undefined>();
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
    return window.buni.onChange((u) => setSnap((prev) => (u.kind === "whole" ? u.snap : prev && patched(prev, u))));
  }, []);
  if (!loaded) return null;
  return snap ? <App key={snap.path} snap={snap} /> : <Home notice={failed} />;
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Root />);
