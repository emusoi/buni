import { expect, test } from "bun:test";
import { gcAndSweep, heapStats } from "bun:jsc";
import { emptyDoc, type Doc } from "../format/doc.ts";
import type { SnapshotUpdate } from "./api.ts";

// Exercise the actual bridge with browser boundaries supplied by the test.
test("startup snapshots are released after handoff, with queued edits and reconnects intact", async () => {
  const streams: Stream[] = [];
  class Stream {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(_url: string) { streams.push(this); }
  }
  const response = Promise.withResolvers<Response>();
  const edited = Promise.withResolvers<void>();
  const reconnected = Promise.withResolvers<void>();
  const received: string[] = [];
  let taken = false;
  let requests = 0;
  const fixture = process.env.BUNI_MEMORY_FIXTURE;
  const text = fixture ? await Bun.file(fixture).text() : JSON.stringify(emptyDoc());
  const body = `{"value":{"path":"/design.buni","dir":"/","view":${text},"owners":{},"recent":{},"mcpUrl":"http://localhost/mcp"}}`;
  const globals = {
    location: new URL("http://localhost/?file=design.buni"),
    document: { documentElement: { dataset: {} }, styleSheets: [], title: "" },
    window: {},
    EventSource: Stream,
    fetch: async (url: string) => {
      if (url.startsWith("/rpc/snapshot")) return ++requests === 1 ? response.promise : new Response(body);
      if (url.startsWith("/rpc/build")) return Response.json({ value: "test-build" });
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  try {
    await import("./bridge.ts");
    const api = window.buni;
    const stream = streams[0];
    if (!stream) throw new Error("The bridge did not connect");
    const unsubscribe = api.onChange(u => {
      expect(taken).toBe(true);
      received.push(u.kind);
      if (u.kind === "patch") edited.resolve();
      else reconnected.resolve();
    });
    async function take(stream: Stream): Promise<WeakRef<Doc>> {
      const pending = api.snapshot();
      stream.onopen?.();
      const patch: SnapshotUpdate = { kind: "patch", view: { head: { buni: 1 }, bags: {} }, owners: {}, recent: {} };
      stream.onmessage?.({ data: JSON.stringify(patch) });
      expect(received).toEqual([]);
      response.resolve(new Response(body));
      const snap = await pending;
      if (!snap) throw new Error("The bridge did not hand off the snapshot");
      expect(snap.system).toBe(snap.view);
      taken = true;
      return new WeakRef(snap.view);
    }
    const initial = await take(stream);
    await edited.promise;
    expect(received).toEqual(["patch"]);
    expect(await api.snapshot()).toBeDefined();
    expect(requests).toBe(2);
    stream.onopen?.();
    await reconnected.promise;
    expect(received).toEqual(["patch", "whole"]);
    expect(requests).toBe(3);
    unsubscribe();
    // Weak references become collectible on a later event-loop turn, after the consumer drops the design.
    await Bun.sleep(1);
    gcAndSweep();
    const heap = heapStats().heapSize;
    const retained = initial.deref() !== undefined;
    if (fixture) console.log(JSON.stringify({ fixture, startupSnapshotRetained: retained, heapBytes: heap }));
    expect(retained).toBe(false);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
