import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export interface ImportResource { url: string; mime: string; base64: string }
const LIMIT = 8 * 1024 * 1024;
const blocked = new BlockList();
for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(ip, bits);
for (const [ip, bits] of [["2001::", 32], ["2001:db8::", 32], ["2002::", 16]] as const) blocked.addSubnet(ip, bits, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");
const isLoopback = (host: string) => ["localhost", "127.0.0.1", "::1"].includes(host);

export function importUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Use an HTTP or HTTPS URL without credentials.");
  return url;
}

export function importAddressAllowed(ip: string, url: URL, page: URL, local: boolean): boolean {
  if (local && isLoopback(hostOf(page)) && url.origin === page.origin && ["127.0.0.1", "::1"].includes(ip)) return true;
  const family = isIP(ip);
  return family === 4 ? !blocked.check(ip, "ipv4") : family === 6 && globalV6.check(ip, "ipv6") && !blocked.check(ip, "ipv6");
}

/** Credential-free fetch for the HTML picker. Pin DNS results and recheck each redirect. */
export async function readImportResource(value: string, pageUrl: string, local: boolean): Promise<ImportResource> {
  const page = importUrl(pageUrl);
  let url = importUrl(value);
  const signal = AbortSignal.timeout(12_000);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const host = hostOf(url);
    const resolved = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
    if (!resolved.length || resolved.some(({ address }) => !importAddressAllowed(address, url, page, local))) throw new Error("This address is private. Local pages can only be imported in the local editor, with assets from the same origin.");
    const address = resolved.find((a) => a.family === 4) ?? resolved[0]!;
    const result = await new Promise<ImportResource | { redirect: string }>((resolve, reject) => {
      // Node's direct request has no environment proxy and uses the already checked address.
      const options: RequestOptions = { hostname: address.address, servername: host, headers: { host: url.host, "accept-encoding": "identity", accept: "text/html,text/css,image/*,font/*;q=0.8,*/*;q=0.1" }, agent: false, signal };
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, options, (response) => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.destroy();
          const next = response.headers.location;
          if (next) resolve({ redirect: next }); else reject(new Error("The page redirected without a destination."));
          return;
        }
        if (status < 200 || status >= 300) { response.destroy(); reject(new Error(`The page answered ${status}.`)); return; }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > LIMIT) { response.destroy(); reject(new Error("Each imported resource must be under 8 MB.")); }
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ url: url.href, mime: response.headers["content-type"]?.split(";")[0]?.trim() ?? "application/octet-stream", base64: Buffer.concat(chunks).toString("base64") }));
      });
      request.on("error", reject);
      request.end();
    });
    if (!("redirect" in result)) return result;
    url = importUrl(new URL(result.redirect, url).href);
  }
  throw new Error("The page redirected too many times.");
}
