// The fonts' own files as data: URLs, for what leaves buni: exports, PNGs and headless renders. They are large (about
// 850 KB), so the web window loads this only when it exports; the canvas asks for /fonts/<slug>.woff2 instead.
import { FONT_DATA } from "./fontdata.gen.ts";
import type { FontSrc } from "./html.ts";

export const embeddedFont: FontSrc = (family) => `data:font/woff2;base64,${FONT_DATA[family] ?? ""}`;
