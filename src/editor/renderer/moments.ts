// A page's motion as words and as moments: what the Inspector says about one motion, and when the Moments strip
// takes its frames. Pure, so the editor's test runs it without a browser.
import { childrenOf, entersOn, type Doc, type Id, type Motion } from "buni/format/doc.ts";
import { EASE } from "buni/tools/html.ts";

const TRIGGER_WORDS = { load: "On load", scroll: "Into view", hover: "On hover", press: "On press" } as const;
const ENTRANCE_WORDS: Record<string, string> = { fade: "fades in", rise: "rises in", scale: "scales in", "slide-left": "slides in from the right", "slide-right": "slides in from the left", blur: "sharpens in" };
const RESPONSE_WORDS: Record<string, string> = { lift: "lifts", grow: "grows", shrink: "shrinks", dim: "dims" };

/** One motion read as a sentence: "On load, rises in over 320 ms, easing out." */
export function motionSentence(m: Motion): string {
  const ease = m.curve ? "on its own curve" : m.easing === "linear" ? "evenly" : `easing ${m.easing}`;
  if (entersOn(m.trigger)) {
    const who = m.staggerMs !== undefined ? `its children ${ENTRANCE_WORDS[m.effect] ?? m.effect} one by one, ${m.staggerMs} ms apart,` : `${ENTRANCE_WORDS[m.effect] ?? m.effect}`;
    const when = m.trigger === "scroll" ? ` as it scrolls through ${m.durationMs} ms of reading` : ` over ${m.durationMs} ms`;
    const delay = m.delayMs ? `, after ${m.delayMs} ms` : "";
    return `${TRIGGER_WORDS[m.trigger]}, ${who}${when}${delay}, ${ease}.`;
  }
  return `${TRIGGER_WORDS[m.trigger]}, ${RESPONSE_WORDS[m.effect] ?? m.effect} in ${m.durationMs} ms, ${ease}.`;
}

/** The four numbers of a motion's curve, for drawing it. */
export function curvePoints(m: Pick<Motion, "easing" | "curve">): [number, number, number, number] {
  const text = m.curve ?? EASE[m.easing];
  const nums = text.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
  const [a, b, c, d] = nums;
  return nums.length === 4 && a !== undefined && b !== undefined && c !== undefined && d !== undefined ? [a, b, c, d] : [0, 0, 1, 1];
}

/** When a page's entrances are over, in ms from its load: the last layer's delay plus its duration, staggers included. 0 when nothing enters. */
export function motionEnd(doc: Doc, pageId: Id): number {
  return Math.max(0, ...entrancesOn(doc, pageId).map(([id, m]) => (m.delayMs ?? 0) + (m.staggerMs === undefined ? 0 : Math.max(0, childrenOf(doc, id).length - 1) * m.staggerMs) + m.durationMs));
}

/** Every entrance on the page, with the layer it is on. */
export function entrancesOn(doc: Doc, pageId: Id): [Id, Motion][] {
  const root = doc.pages[pageId]?.frame;
  const found: [Id, Motion][] = [];
  const walk = (id: Id) => {
    const n = doc.nodes[id];
    if (!n) return;
    for (const m of n.motion ?? []) if (entersOn(m.trigger)) found.push([id, m]);
    for (const c of childrenOf(doc, id)) walk(c.id);
  };
  if (root) walk(root);
  return found;
}

/** `count` moments from 0 to `end`, evenly, the first at rest before anything moves and the last when all has arrived. */
export function momentTimes(end: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.round(count === 1 ? end : (end * i) / (count - 1)));
}
