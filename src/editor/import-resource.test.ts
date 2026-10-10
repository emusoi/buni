import { expect, test } from "bun:test";
import { importAddressAllowed, importUrl, readImportResource } from "./import-resource.ts";

test("HTML imports reject credentials, private networks and cross-origin local resources", () => {
  const publicUrl = new URL("https://example.com");
  const local = new URL("http://localhost:3000/page");
  for (const url of ["file:///etc/passwd", "ftp://example.com", "https://user:pass@example.com"]) expect(() => importUrl(url)).toThrow();
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1"]) {
    expect(importAddressAllowed(ip, publicUrl, publicUrl, true)).toBe(false);
    expect(importAddressAllowed(ip, local, local, false)).toBe(false);
  }
  expect(importAddressAllowed("127.0.0.1", local, local, true)).toBe(true);
  expect(importAddressAllowed("127.0.0.1", new URL("http://localhost:3001"), local, true)).toBe(false);
  expect(importAddressAllowed("93.184.216.34", publicUrl, publicUrl, false)).toBe(true);
  expect(importAddressAllowed("2606:4700:4700::1111", publicUrl, publicUrl, false)).toBe(true);
});

test("the resource reader keeps host, drops credentials and rechecks redirects", async () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/redirect") return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    if (url.pathname === "/large") return new Response("x".repeat(9 * 1024 * 1024));
    return new Response(JSON.stringify({ host: req.headers.get("host"), cookie: req.headers.get("cookie"), auth: req.headers.get("authorization") }), { headers: { "content-type": "text/html" } });
  } });
  const url = `http://localhost:${server.port}`;
  try {
    const response = await readImportResource(url, url, true);
    expect(response.mime).toBe("text/html");
    expect(JSON.parse(atob(response.base64))).toEqual({ host: `localhost:${server.port}`, cookie: null, auth: null });
    await expect(readImportResource(`${url}/redirect`, url, true)).rejects.toThrow("private");
    await expect(readImportResource(`${url}/large`, url, true)).rejects.toThrow("8 MB");
    await expect(readImportResource(url, url, false)).rejects.toThrow("private");
  } finally { server.stop(true); }
});
