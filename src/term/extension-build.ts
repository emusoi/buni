import { join } from "node:path";
import { VERSION } from "../version.ts";

/** The public key that gives the extension its fixed id (guard.ts EXTENSION_ORIGIN), so buni knows it is ours. */
const KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmMFIQwOpQVkUBdvIjebHkGVBpviXdGIYel3TRmFibRe06Bh3iHJwvXLTWbBp0cIQvmCFvdlCwrByS+TqbvYpTewCM4WxLM/dz2wBB8ZluDUwinENlcVff9KgdS3TNjYkwwHMRZ/O7Gc1lqTBn38kuGgKVeZOPo2TY7D6ORibiYb3OCAUHH6fi45ZynB3q2fKxZ/N61m47VTCVGWo4gAGfR0VCAQG3buY83m8Ii+0ByByvNvVysOmgSQqgPvkVXBAyplqks7tudyg89Ls84jwGPB1Tgq7uuvcy0+WTW9RBQUxFKVGz+EevUFvEWIetXbqgmp87NWUHKS7On0pRUbtxQIDAQAB";

/** buni's Chrome extension as files, by name: load the folder they're written to with "Load unpacked". */
export async function extensionFiles(): Promise<Record<string, string>> {
  const dir = join(import.meta.dir, "../extension");
  const bundle = async (entry: string, format: "iife" | "esm") => {
    const r = await Bun.build({ entrypoints: [join(dir, entry)], target: "browser", format, minify: true });
    if (!r.success) throw new AggregateError(r.logs, `building ${entry} failed`);
    return r.outputs[0]!.text();
  };
  const manifest = {
    manifest_version: 3, name: "buni snap", version: VERSION.replace(/[^0-9.]/g, "") || "0.1.0", key: KEY,
    description: "Snap the page you're on into a buni design as editable layers, to redesign it.",
    permissions: ["activeTab", "scripting", "storage", "nativeMessaging"],
    action: { default_popup: "popup.html", default_title: "Snap into buni" },
    background: { service_worker: "background.js", type: "module" },
  };
  return {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "popup.html": await Bun.file(join(dir, "popup.html")).text(),
    "popup.js": await bundle("popup.ts", "esm"),
    "background.js": await bundle("background.ts", "esm"),
    "content.js": await bundle("content.ts", "iife"),
  };
}
