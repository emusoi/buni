import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyDoc } from "../format/doc.ts";
import { serializeDoc } from "../format/serialize.ts";
import { createEditor } from "./server.ts";
import { DiskStore } from "./store.ts";
import { Tablets } from "./usb.ts";

/** A stand-in for adb: one tablet on the cable (or one still to be allowed), and a log of what it was asked. */
async function fakeAdb(dir: string, state = "device"): Promise<string> {
  const bin = join(dir, "adb");
  await writeFile(bin, `#!/bin/sh
echo "$@" >> "${join(dir, "adb.log")}"
case "$*" in
  "devices -l") printf 'List of devices attached\\nR52R70ERD7J            ${state} usb:1 product:gts7 model:SM_T738U device:gts7 transport_id:1\\n\\n' ;;
  *"device_name"*) echo "Galaxy Tab S7 FE 5G" ;;
  *"pm list packages"*) [ -n "$BUNI_FAKE_APP" ] && echo "package:app.emusoi.buni" ;;
esac
exit 0
`);
  await chmod(bin, 0o755);
  return bin;
}

test("a tablet on the cable opens the design with a one-time code, then only reaches what drawing needs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-usb-"));
  const tablets = new Tablets(undefined, await fakeAdb(dir));
  tablets.port = 47123;
  try {
    await mkdir(join(dir, "d"));
    const doc = emptyDoc();
    doc.pages.p = { id: "p", name: "Home", frame: "f", index: "a0", route: "/" };
    doc.nodes.f = { id: "f", kind: "frame", name: "Home", index: "a0", style: { width: "390px" } };
    await writeFile(join(dir, "d/x.buni"), serializeDoc(doc));
    const editor = await createEditor({ store: new DiskStore(dir), origin: "http://localhost:1", localFile: join(dir, "d/x.buni"), assets: () => ({ files: new Map(), client: "", styles: "" }), tablets });
    const file = "/designs/d/x.buni";

    const list = await tablets.list();
    expect("tablets" in list && list.tablets).toEqual([{ serial: "R52R70ERD7J", name: "Galaxy Tab S7 FE 5G", state: "ready", app: false }]);
    expect(await tablets.open("R52R70ERD7J", file)).toEqual({ name: "Galaxy Tab S7 FE 5G" });
    const log = await readFile(join(dir, "adb.log"), "utf8");
    expect(log).toContain("-s R52R70ERD7J reverse tcp:47123 tcp:47123");
    const code = log.match(/pair\?code=([A-Z0-9]+)/)?.[1] ?? "";
    expect(log).toContain(`'http://localhost:47123/pair?code=${code}'`);

    const host = "localhost:47123";
    const at = (path: string, init: RequestInit = {}) => editor.tabletFetch(new Request(`http://${host}${path}`, { ...init, headers: { host, ...init.headers } }));
    // The Mac's own door never answers the tablet's way in, and the tablet's door asks for the code first.
    expect((await editor.fetch(new Request(`http://${host}/pair?code=${code}`, { headers: { host } }))).status).toBe(403);
    expect((await at(`/?file=${encodeURIComponent(file)}`)).status).toBe(401);
    const paired = await at(`/pair?code=${code}`);
    expect(paired.status).toBe(303);
    expect(paired.headers.get("location")).toContain("tablet=1");
    const cookie = paired.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await at(`/pair?code=${code}`)).status).toBe(403);

    const rpc = (name: string, args: unknown[], origin = `http://${host}`) => at(`/rpc/${name}?file=${encodeURIComponent(file)}`, { method: "POST", body: JSON.stringify(args), headers: { cookie, origin, "content-type": "application/json" } });
    expect((await rpc("snapshot", [])).status).toBe(200);
    const mark = await (await rpc("edit", ["mark", { page: "p", from: "someone else", strokes: [{ tool: "pen", color: "#c8331f", width: 3, points: [1, 2, 30, 4] }] }])).json();
    expect(mark.value.ok).toBe(true);
    const drawn = Object.values((await (await rpc("snapshot", [])).json()).value.view.comments) as { ink?: { from?: string } }[];
    expect(drawn[0]?.ink?.from).toBe("Galaxy Tab S7 FE 5G");
    expect((await rpc("edit", ["write_html", { parent: "f", html: "<p>x</p>" }])).status).toBe(403);
    for (const name of ["commit", "removeFile", "create", "openOnTablet", "tablets", "undo"]) expect((await rpc(name, [])).status).toBe(403);
    expect((await at(`/mcp?file=${encodeURIComponent(file)}`, { method: "POST", headers: { cookie } })).status).toBe(404);
    expect((await rpc("snapshot", [], "https://evil.example")).status).toBe(403);
    // The live feed: the tablet's cookie and host, or nothing.
    const socket = (headers: Record<string, string>) => editor.tabletSocket(new Request(`http://${host}/events?file=${encodeURIComponent(file)}`, { headers: { host, origin: `http://${host}`, ...headers } }));
    expect(socket({ cookie })).toBe(file);
    expect(socket({})).toBeUndefined();

    const [device] = tablets.paired();
    tablets.forget(device?.id ?? "");
    expect((await rpc("snapshot", [])).status).toBe(401);
    tablets.stop();
    expect(await readFile(join(dir, "adb.log"), "utf8")).toContain("reverse --remove tcp:47123");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the Mac says what to do when the tablet isn't ready, or there's no adb", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-usb-"));
  try {
    const waiting = new Tablets(undefined, await fakeAdb(dir, "unauthorized"));
    waiting.port = 1;
    const list = await waiting.list();
    expect("tablets" in list && list.tablets[0]?.state).toBe("unauthorized");
    const opened = await waiting.open("R52R70ERD7J", "/designs/d/x.buni");
    expect("error" in opened && opened.error).toContain("tap Allow");
    const none = await new Tablets(undefined, join(dir, "no-adb-here")).list();
    expect("error" in none && none.error).toContain("platform tools");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a tablet stays in when buni open restarts, and its cookie is never written down", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-usb-"));
  const keep = join(dir, "devices.json");
  const adb = await fakeAdb(dir);
  try {
    const first = new Tablets(keep, adb);
    first.port = 47123;
    await first.open("R52R70ERD7J", "/designs/d/x.buni");
    const code = (await readFile(join(dir, "adb.log"), "utf8")).match(/pair\?code=([A-Z0-9]+)/)?.[1] ?? "";
    const got = first.redeem(code);
    if (!got) throw new Error("no device");
    expect(await Bun.file(keep).text()).not.toContain(got.token);
    const req = new Request("http://x/", { headers: { cookie: `buni-device=${got.token}` } });
    const again = new Tablets(keep, adb);
    expect(again.device(req)?.name).toBe("Galaxy Tab S7 FE 5G");
    again.forget(again.paired()[0]?.id ?? "");
    expect(new Tablets(keep, adb).device(req)).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
