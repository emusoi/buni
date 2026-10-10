import { expect, test } from "bun:test";
import { prepareHtml } from "./html-preview.ts";

test("HTML previews keep stylesheet layout and images while excluding scripts and navigation", async () => {
  const requested: string[] = [];
  const result = await prepareHtml(`<html><head><script>evil()</script><meta http-equiv="refresh" content="0;url=https://bad.test"><link rel="stylesheet" href="styles/main.css"></head><body onload="evil()"><a href="https://bad.test" ping="https://bad.test/track">Link</a><section data-source-file="src/Hero.tsx"><img src="image.png" onerror="evil()"><svg><use href="#star"/></svg></section><iframe src="https://bad.test"></iframe></body></html>`, "https://example.test/page", async (url) => {
    requested.push(url);
    if (url.endsWith("main.css")) return { url, mime: "text/css", base64: btoa('@import "type.css"; section { display: flex; background: url(../image.png) }') };
    if (url.endsWith("type.css")) return { url, mime: "text/css", base64: btoa("h1{font-size:32px}") };
    return { url, mime: "image/png", base64: "aW1hZ2U=" };
  });
  expect(result.html).toContain("display: flex");
  expect(result.html).toContain("font-size:32px");
  expect(result.html).toContain("data:image/png;base64,aW1hZ2U=");
  expect(result.html).toContain('data-source-file="src/Hero.tsx"');
  expect(result.html).toContain('href="#star"');
  for (const unsafe of ["<script", "<iframe", "onload", "onerror", "bad.test", "http-equiv=\"refresh\""]) expect(result.html).not.toContain(unsafe);
  expect(result.html).toContain("default-src 'none'");
  expect(requested).toEqual(["https://example.test/styles/main.css", "https://example.test/styles/type.css", "https://example.test/image.png"]);
  expect(result.warnings.some((w) => w.includes("Scripts"))).toBe(true);
});

test("pasted fragments need no network and missing resources are reported", async () => {
  const result = await prepareHtml('<style>.card {color:red}</style><section class="card"><h1>Hello</h1><img src="missing.png"></section>', undefined);
  expect(result.html).toContain(".card {color:red}");
  expect(result.html).toContain("<h1>Hello</h1>");
  expect(result.html).not.toContain('src="missing.png"');
  expect(result.warnings.join(" ")).toContain("associated CSS and images");
});

test("repeated images share a fetch and cannot expand a preview without bound", async () => {
  let reads = 0;
  const result = await prepareHtml('<img src="photo.png">'.repeat(100), "https://example.test/", async (url) => {
    reads++;
    return { url, mime: "image/png", base64: "A".repeat(512 * 1024) };
  });
  expect(reads).toBe(1);
  expect(result.html.length).toBeLessThan(49 * 1024 * 1024);
  expect(result.warnings.join(" ")).toContain("Embedded assets exceed 48 MB");
});
