import { expect, test } from "bun:test";
import { prepareHtml } from "../editor/renderer/html-preview.ts";
import { captureSource } from "./capture-build.ts";
import { evaluateWithBrowser, findBrowser } from "./chrome.ts";

const browser = findBrowser();
test.skipIf(!browser)("agents use the editor's computed-style converter to select a section, with errors for ambiguous selectors", async () => {
  const preview = await prepareHtml('<style>.hero{display:flex;gap:24px}@media(max-width:500px){.hero{gap:8px}}</style><section id="hero" class="hero"><h1>Hello</h1><button style="border:0;padding:0">View design</button></section><footer>Outside</footer>', undefined);
  const response = await evaluateWithBrowser(browser!, { html: preview.html, dir: ".", width: 390 }, `${await captureSource()};(async () => JSON.stringify(await Promise.all([
    window.buniCaptureHtml({selector:'#hero',file:'src/Hero.tsx',symbol:'Hero'}),
    window.buniCaptureHtml({selector:'#missing'}),window.buniCaptureHtml({selector:'section,footer'})
  ])))()`);
  const [selected, missing, ambiguous]: string[] = JSON.parse(response);
  expect(selected).toContain("gap: 8px");
  expect(selected).toContain("src/Hero.tsx");
  expect(selected).toContain('"count":3');
  expect(selected).toContain('border: 0px none');
  expect(selected).toContain('padding: 0px');
  expect(selected).not.toContain("Outside");
  expect(missing).toContain("found 0");
  expect(ambiguous).toContain("found 2");
}, 60_000);
