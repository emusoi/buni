// UI review: checks that read a laid-out page the way a person would meet it, in the page itself. One list of
// rules, each with an id, what it's about and how much it matters, so the same ids drive review_page, the edit
// checks, pinned comments and the critique skill. Judgement (is this the right design?) stays with the agent; these
// are the things a careful reviewer would flag every time.
import { pageMotion, type PageMotion } from "./motionRead.ts";

/** p1 gets in someone's way, p2 a careful reviewer would send back, p3 polish. */
export type Severity = "p1" | "p2" | "p3";
export const CATEGORIES = ["motion", "type", "color", "layout", "tells"] as const;
export type Category = (typeof CATEGORIES)[number];
export interface Finding { rule: string; message: string; el: Element }

export interface Check {
  view: Window & typeof globalThis;
  motions: PageMotion;
  /** Every visible element in the reviewed part of the page, with its computed style. */
  elements: { el: Element; cs: CSSStyleDeclaration }[];
}

export interface Rule {
  id: string;
  category: Category;
  severity: Severity;
  /** What it catches, one line, for read_skill critique and the reply. */
  about: string;
  /** Checked on every edit (clear-cut, cheap), or only in a full review. */
  tier: "edit" | "review";
  /** An element's problem, as a sentence; undefined when it has none. */
  element?: (el: Element, cs: CSSStyleDeclaration, check: Check) => string | undefined;
  /** Problems of the page as a whole. */
  page?: (check: Check) => { el: Element; message: string }[];
}

const seconds = (time: string): number[] => time.split(",").map((t) => (t.trim().endsWith("ms") ? parseFloat(t) / 1000 : parseFloat(t)) || 0);
const list = (value: string): string[] => value.split(/,(?![^(]*\))/).map((s) => s.trim());
const curve = (timing: string): number[] | undefined => {
  const m = timing.match(/^cubic-bezier\(([^)]+)\)$/);
  return m?.[1] ? m[1].split(",").map(Number) : undefined;
};
/** Transitions that actually run: a computed transition of 0s on "all" is every element's default. */
const transitions = (cs: CSSStyleDeclaration) => {
  const props = list(cs.transitionProperty), durations = seconds(cs.transitionDuration), timings = list(cs.transitionTimingFunction);
  return props.map((prop, i) => ({ prop, seconds: durations[i % durations.length] ?? 0, timing: timings[i % timings.length] ?? "ease" })).filter((t) => t.seconds > 0 && t.prop !== "none");
};
const animations = (cs: CSSStyleDeclaration) => {
  const names = list(cs.animationName), durations = seconds(cs.animationDuration), delays = seconds(cs.animationDelay);
  const timings = list(cs.animationTimingFunction), counts = list(cs.animationIterationCount);
  return names.map((name, i) => ({ name, seconds: durations[i % durations.length] ?? 0, delay: delays[i % delays.length] ?? 0, timing: timings[i % timings.length] ?? "ease", infinite: counts[i % counts.length] === "infinite" }))
    .filter((a) => a.name !== "none");
};
const LAYOUT = /^(width|height|top|left|right|bottom|inset|(min|max)-(width|height)|margin(-\w+)?|padding(-\w+)?)$/;
const ms = (s: number) => `${Math.round(s * 1000)}ms`;
/** The element's own words, not its children's. */
const ownWords = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? "").join("").trim();
const ownText = (el: Element) => ownWords(el).length > 0;
const snippet = (el: Element) => { const t = (el.textContent ?? "").trim().replace(/\s+/g, " "); return t.length > 40 ? `${t.slice(0, 40)}…` : t; };

type Rgba = [number, number, number, number];
const painted = new Map<string, Rgba>();
/** Any CSS colour as sRGB bytes and alpha, by painting it: computed colours can be oklch(), color(), … */
function rgba(color: string, check: Check): Rgba {
  let found = painted.get(color);
  if (!found) {
    const canvas = check.view.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [0, 0, 0, 1];
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
    found = [r, g, b, a / 255];
    painted.set(color, found);
  }
  return found;
}
/** `top` laid over `under`. */
const blend = (top: Rgba, under: Rgba): Rgba => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as Rgba;
/** What is behind the element: its own and its ancestors' background colours, laid over white; undefined over an image. */
function behind(el: Element, check: Check): Rgba | undefined {
  const layers: Rgba[] = [];
  for (let at: Element | null = el; at; at = at.parentElement) {
    const s = check.view.getComputedStyle(at);
    if (s.backgroundImage !== "none") return undefined;
    const c = rgba(s.backgroundColor, check);
    if (c[3] > 0) layers.push(c);
    if (c[3] >= 1) break;
  }
  return layers.reduceRight<Rgba>((under, top) => blend(top, under), [255, 255, 255, 1]);
}
const luminance = (c: Rgba) => {
  const [r, g, b] = [c[0], c[1], c[2]].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: Rgba, b: Rgba) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };
/** How colourful, 0 for a grey to 1 for a pure hue. */
const chroma = (c: Rgba) => (Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])) / 255;
/** A box drawn as a card: big enough to hold content, filled, rounded, with a shadow or a border. */
const card = (el: Element, cs: CSSStyleDeclaration, check: Check) => {
  const box = el.getBoundingClientRect();
  return box.width >= 120 && box.height >= 48 && parseFloat(cs.borderTopLeftRadius) >= 6
    && (cs.boxShadow !== "none" || parseFloat(cs.borderTopWidth) >= 1) && rgba(cs.backgroundColor, check)[3] > 0.5;
};

export const RULES: Rule[] = [
  {
    id: "bounce-easing", category: "motion", severity: "p2", tier: "review",
    about: "Easing that overshoots and springs back (bounce, elastic): a generated look, and it makes the interface feel unsteady.",
    element: (_el, cs) => {
      const all = [...transitions(cs).map((t) => t.timing), ...animations(cs).map((a) => a.timing)];
      const springy = all.find((t) => { const c = curve(t); return c !== undefined && [c[1] ?? 0, c[3] ?? 1].some((y) => y < -0.1 || y > 1.1); });
      if (springy) return `Moves with an overshooting curve, ${springy}; use a plain ease-out such as cubic-bezier(0.22, 1, 0.36, 1).`;
      const named = animations(cs).find((a) => /bounce|elastic|wobble|jiggle|spring/i.test(a.name));
      return named ? `Plays "${named.name}"; bounce and elastic motion read as generated. Settle with an ease-out instead.` : undefined;
    },
  },
  {
    id: "layout-transition", category: "motion", severity: "p2", tier: "review",
    about: "Transitions on width, height, margin, padding or position: they lay the page out every frame and stutter.",
    element: (_el, cs) => {
      const props = transitions(cs).map((t) => t.prop).filter((p) => LAYOUT.test(p));
      return props.length ? `Transitions ${props.join(", ")}, which lays the page out every frame; move it with transform, or show the change at once.` : undefined;
    },
  },
  {
    id: "transition-all", category: "motion", severity: "p3", tier: "review",
    about: "transition: all animates whatever happens to change, layout included; name the properties.",
    element: (_el, cs) => (transitions(cs).some((t) => t.prop === "all") ? "Transitions all properties; name the ones meant to move (transform, opacity, color)." : undefined),
  },
  {
    id: "ease-in", category: "motion", severity: "p3", tier: "review",
    about: "Ease-in on interface motion: it starts slowly, so the screen lags the person's action.",
    element: (_el, cs) => {
      const slow = [...transitions(cs).map((t) => t.timing), ...animations(cs).filter((a) => !a.infinite).map((a) => a.timing)]
        .find((t) => t === "ease-in" || (() => { const c = curve(t); return c !== undefined && (c[0] ?? 0) >= 0.4 && (c[1] ?? 0) <= 0.05 && (c[2] ?? 0) >= 0.9; })());
      return slow ? `Starts slowly (${slow}), so it lags what the person did; use an ease-out.` : undefined;
    },
  },
  {
    id: "slow-feedback", category: "motion", severity: "p2", tier: "review",
    about: "Responses over 400ms, or entrances over a second: long feedback feels like latency.",
    element: (_el, cs) => {
      const slow = transitions(cs).find((t) => t.seconds > 0.4);
      if (slow) return `${slow.prop} takes ${ms(slow.seconds)} to respond; keep feedback at 100–300ms.`;
      const entrance = animations(cs).find((a) => !a.infinite && a.seconds > 1);
      return entrance ? `"${entrance.name}" takes ${ms(entrance.seconds)}; an entrance over a second makes people wait for the page.` : undefined;
    },
  },
  {
    id: "endless-loop", category: "motion", severity: "p2", tier: "review",
    about: "Animation that never stops (pulsing dots, shimmering badges): it pulls the eye forever. A spinner while loading is fine.",
    element: (el, cs) => {
      const loop = animations(cs).find((a) => a.infinite);
      if (!loop) return undefined;
      const box = el.getBoundingClientRect();
      // A small one is a loading indicator, doing its job until the load ends.
      if (box.width <= 32 && box.height <= 32 && !(box.width <= 12 && parseFloat(cs.borderTopLeftRadius) >= box.width / 2)) return undefined;
      return box.width <= 12 ? `A dot pulses forever ("${loop.name}"); show the state without motion.` : `"${loop.name}" loops forever; stop it when its job is done, or drop it.`;
    },
  },
  {
    id: "hidden-at-rest", category: "motion", severity: "p1", tier: "edit",
    about: "Much of the page's text still invisible once it settles: an entrance that never played leaves the content hidden.",
    page: (check) => {
      // Hidden on purpose (a closed menu, a tooltip) also takes the pointer away or is hidden from screen readers; a
      // scroll entrance plays as it is scrolled to.
      const words = (el: Element) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim() ?? "").join("").length;
      let all = 0;
      const hidden: Element[] = [];
      for (const { el, cs } of check.elements) {
        const n = words(el);
        if (!n || cs.pointerEvents === "none" || el.closest("[aria-hidden=true], [role=tooltip]")) continue;
        all += n;
        let opacity = 1, scrolled = false;
        for (let at: Element | null = el; at; at = at.parentElement) {
          const s = check.view.getComputedStyle(at);
          opacity *= parseFloat(s.opacity);
          scrolled ||= s.getPropertyValue("animation-timeline").includes("view(");
        }
        if (!scrolled && (opacity < 0.05 || cs.visibility === "hidden")) hidden.push(el);
      }
      const share = hidden.reduce((sum, el) => sum + words(el), 0) / Math.max(all, 1);
      return hidden[0] && share > 0.15 ? [{ el: hidden[0], message: `${Math.round(share * 100)}% of the text is invisible once the page settles (${hidden.length} blocks, from "${hidden[0].textContent?.trim().slice(0, 40)}"); keep content visible by default and animate from there.` }] : [];
    },
  },
  {
    id: "motion-everywhere", category: "motion", severity: "p2", tier: "review",
    about: "Entrances on many separate parts of a page: one orchestrated moment lands; motion on everything reads as generated.",
    page: (check) => {
      // Small things entering one after another (a stagger of cards) are one moment, counted by their parent; a
      // section-sized block is a moment of its own.
      const groups = new Map<Element, Element>();
      for (const { el, cs } of check.elements) {
        if (!animations(cs).some((a) => !a.infinite)) continue;
        const key = el.getBoundingClientRect().height >= 240 ? el : el.parentElement ?? el;
        if (!groups.has(key)) groups.set(key, el);
      }
      const firsts = [...groups.values()];
      return firsts.length > 4 ? [{ el: firsts[0]!, message: `${firsts.length} separate parts of the page animate in; choose the one moment that tells the story and let the rest appear.` }] : [];
    },
  },
  {
    id: "one-duration", category: "motion", severity: "p3", tier: "review",
    about: "Every move takes the same time: different moves need different durations (a press is quicker than a drawer).",
    page: (check) => {
      const moving = check.elements.flatMap(({ el, cs }) => [...transitions(cs), ...animations(cs).filter((a) => !a.infinite)].map((m) => ({ el, seconds: m.seconds })));
      const durations = new Set(moving.map((m) => m.seconds));
      return moving.length >= 6 && durations.size === 1 ? [{ el: moving[0]!.el, message: `All ${moving.length} moves take ${ms(moving[0]!.seconds)}; time them by size and distance.` }] : [];
    },
  },
  {
    id: "long-stagger", category: "motion", severity: "p3", tier: "review",
    about: "A stagger whose last item waits too long: cap the total delay so the list is usable at once.",
    page: (check) => {
      const byParent = new Map<Element, number[]>();
      for (const { el, cs } of check.elements) {
        const a = animations(cs).find((x) => !x.infinite);
        if (a && el.parentElement) byParent.set(el.parentElement, [...(byParent.get(el.parentElement) ?? []), a.delay]);
      }
      return [...byParent].filter(([, delays]) => delays.length >= 3 && Math.max(...delays) - Math.min(...delays) > 0.8)
        .map(([parent, delays]) => ({ el: parent, message: `Its ${delays.length} items enter over ${ms(Math.max(...delays) - Math.min(...delays))}; keep a stagger's total under about 500ms.` }));
    },
  },
  {
    id: "no-reduced-motion", category: "motion", severity: "p2", tier: "review",
    about: "Motion with no prefers-reduced-motion alternative.",
    page: (check) => {
      const moving = check.elements.find(({ cs }) => animations(cs).length > 0);
      if (!moving) return [];
      let honoured = false;
      for (const sheet of check.view.document.styleSheets) {
        try { honoured ||= [...sheet.cssRules].some((r) => r instanceof check.view.CSSMediaRule && r.media.mediaText.includes("prefers-reduced-motion")); } catch { honoured = true; }
      }
      return honoured ? [] : [{ el: moving.el, message: "Nothing here honours prefers-reduced-motion; give people who ask for less motion an instant change or a short fade." }];
    },
  },
  {
    id: "low-contrast", category: "color", severity: "p1", tier: "edit",
    about: "Text below WCAG AA against what is behind it: 4.5:1, or 3:1 for large text (24px, or 18.7px bold).",
    element: (el, cs, check) => {
      if (!ownText(el) || el.closest("[disabled], [aria-disabled=true]")) return undefined;
      const back = behind(el, check);
      if (!back) return undefined;
      const fg = rgba(cs.color, check);
      const ratio = contrast(blend(fg, back), back);
      const size = parseFloat(cs.fontSize);
      const need = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) ? 3 : 4.5;
      return ratio < need ? `"${snippet(el)}" is ${ratio.toFixed(2)}:1 against its background; it needs ${need}:1.` : undefined;
    },
  },
  {
    id: "gray-on-color", category: "color", severity: "p3", tier: "review",
    about: "Grey text on a coloured surface looks dirty; tint it toward the surface's hue.",
    element: (el, cs, check) => {
      if (!ownText(el)) return undefined;
      const back = behind(el, check);
      const fg = rgba(cs.color, check);
      return back && chroma(back) > 0.25 && chroma(fg) < 0.06 && fg[0] > 60 && fg[0] < 200 ? `"${snippet(el)}" is grey on a coloured surface; tint it toward the surface's hue.` : undefined;
    },
  },
  {
    id: "tiny-text", category: "type", severity: "p2", tier: "edit",
    about: "Text people must read under 12px (controls under 11px).",
    element: (el, cs) => {
      if (!ownText(el)) return undefined;
      const size = parseFloat(cs.fontSize);
      const control = el.closest("button, a, label, input, select, [role=button], [role=tab]") !== null;
      return size < (control ? 11 : 12) ? `"${snippet(el)}" is ${size}px; body text needs at least 12px and a control's label 11px.` : undefined;
    },
  },
  {
    id: "line-length", category: "type", severity: "p3", tier: "review",
    about: "Lines of running text much longer than 75 characters are hard to follow back.",
    element: (el, cs) => {
      if (!/^(p|li|blockquote|dd)$/.test(el.localName) || (el.textContent?.length ?? 0) < 160) return undefined;
      const chars = el.getBoundingClientRect().width / (parseFloat(cs.fontSize) * 0.5);
      return chars > 90 ? `About ${Math.round(chars)} characters a line; keep running text near 65–75 (max-width around 65ch).` : undefined;
    },
  },
  {
    id: "tight-leading", category: "type", severity: "p3", tier: "review",
    about: "Running text with line-height under 1.3 reads as a block.",
    element: (el, cs) => {
      if (!ownText(el) || (el.textContent?.length ?? 0) < 120 || cs.lineHeight === "normal") return undefined;
      const ratio = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
      return el.getBoundingClientRect().height > parseFloat(cs.lineHeight) * 1.5 && ratio < 1.3 ? `Line height ${ratio.toFixed(2)} on running text; give it 1.4–1.6.` : undefined;
    },
  },
  {
    id: "all-caps-text", category: "type", severity: "p3", tier: "review",
    about: "Sentences set in capitals are slow to read; keep capitals for short labels.",
    element: (el, cs) => (ownText(el) && cs.textTransform === "uppercase" && (el.textContent?.trim().length ?? 0) > 40 ? `"${snippet(el)}" is a sentence in capitals; use sentence case.` : undefined),
  },
  {
    id: "flat-hierarchy", category: "type", severity: "p3", tier: "review",
    about: "Headings barely bigger than body text: the page has no clear order to read in.",
    page: (check) => {
      const sizes = check.elements.filter(({ el }) => ownText(el)).map(({ el, cs }) => ({ el, size: parseFloat(cs.fontSize), length: el.textContent?.length ?? 0 }));
      const heading = check.elements.find(({ el }) => /^h[1-3]$/.test(el.localName));
      if (!heading || sizes.length < 5) return [];
      // The body size: the size most of the words are set in.
      const words = new Map<number, number>();
      for (const s of sizes) words.set(s.size, (words.get(s.size) ?? 0) + s.length);
      const body = [...words].sort((a, b) => b[1] - a[1])[0]![0];
      const top = Math.max(...sizes.map((s) => s.size));
      return top / body < 1.25 ? [{ el: heading.el, message: `The largest text is ${top}px over ${body}px body text; give the page a real scale (a heading at least 1.25× the body, the main one more).` }] : [];
    },
  },
  {
    id: "skipped-heading", category: "type", severity: "p3", tier: "review",
    about: "Heading levels that jump (an h1, then an h3): screen readers navigate by them.",
    page: (check) => {
      const levels = check.elements.filter(({ el }) => /^h[1-6]$/.test(el.localName)).map(({ el }) => ({ el, level: Number(el.localName[1]) }));
      return levels.flatMap((h, i) => (i > 0 && h.level > levels[i - 1]!.level + 1 ? [{ el: h.el, message: `An h${h.level} follows an h${levels[i - 1]!.level}; don't skip a level.` }] : []));
    },
  },
  {
    id: "small-target", category: "layout", severity: "p2", tier: "edit",
    about: "Buttons and links smaller than 24×24px are hard to hit (WCAG 2.2).",
    element: (el, cs) => {
      if (!el.matches("button, [role=button], input:not([type=hidden]), select, a[href]") || cs.display === "inline") return undefined;
      const box = el.getBoundingClientRect();
      // Small one way only (a 30×23 button) is still easy to hit.
      return box.width && box.height && ((box.width < 24 && box.height < 24) || Math.min(box.width, box.height) < 16) ? `${el.localName} "${snippet(el) || el.getAttribute("aria-label") || ""}" is ${Math.round(box.width)}×${Math.round(box.height)}px; give it at least 24×24 to hit.` : undefined;
    },
  },
  {
    id: "text-overflow", category: "layout", severity: "p2", tier: "edit",
    about: "Text that spills out of its box or is cut off without an ellipsis.",
    element: (el, cs) => {
      if (!ownText(el) || el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) return undefined;
      if (cs.textOverflow === "ellipsis" || /auto|scroll/.test(cs.overflowX)) return undefined;
      return `"${snippet(el)}" is ${el.scrollWidth - el.clientWidth}px wider than its box and ${cs.overflowX === "visible" ? "spills out" : "is cut off"}; let it wrap, or truncate with an ellipsis.`;
    },
  },
  {
    id: "cramped-padding", category: "layout", severity: "p3", tier: "review",
    about: "Text pressed against the edge of its filled or bordered box.",
    element: (el, cs, check) => {
      if (!ownText(el) || !(rgba(cs.backgroundColor, check)[3] > 0.1 || parseFloat(cs.borderTopWidth) > 0)) return undefined;
      // Where the words actually sit: a letter centred in an avatar has no padding and plenty of room.
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      const words = [...range.getClientRects()].filter((r) => r.width > 0);
      if (!words.length) return undefined;
      const box = el.getBoundingClientRect();
      const top = Math.min(...words.map((r) => r.top)) - box.top - parseFloat(cs.borderTopWidth);
      const bottom = box.bottom - Math.max(...words.map((r) => r.bottom)) - parseFloat(cs.borderBottomWidth);
      const left = Math.min(...words.map((r) => r.left)) - box.left - parseFloat(cs.borderLeftWidth);
      const right = box.right - Math.max(...words.map((r) => r.right)) - parseFloat(cs.borderRightWidth);
      const size = parseFloat(cs.fontSize), v = Math.min(top, bottom), h = Math.min(left, right);
      return v < Math.max(1, size * 0.1) || h < Math.max(4, size * 0.3) ? `"${snippet(el)}" sits ${Math.max(0, Math.round(v))}px/${Math.max(0, Math.round(h))}px from the edge of its box; give it room.` : undefined;
    },
  },
  {
    id: "nested-cards", category: "tells", severity: "p3", tier: "review",
    about: "A card inside a card: group with space and alignment instead.",
    element: (el, cs, check) => {
      if (!card(el, cs, check)) return undefined;
      for (let at = el.parentElement; at; at = at.parentElement) {
        if (card(at, check.view.getComputedStyle(at), check)) return "A card sits inside another card; let space and alignment do the grouping.";
      }
      return undefined;
    },
  },
  {
    id: "side-tab", category: "tells", severity: "p3", tier: "review",
    about: "A thick coloured stripe down one side of a rounded card: a generated look.",
    element: (_el, cs, check) => {
      const left = parseFloat(cs.borderLeftWidth), others = Math.max(parseFloat(cs.borderTopWidth), parseFloat(cs.borderRightWidth));
      return left >= 3 && others <= 1 && parseFloat(cs.borderTopLeftRadius) > 0 && chroma(rgba(cs.borderLeftColor, check)) > 0.2 ? "A coloured stripe down the left of a rounded box; say what it marks another way, or drop it." : undefined;
    },
  },
  {
    id: "gradient-text", category: "tells", severity: "p2", tier: "review",
    about: "Text filled with a gradient: decoration that costs legibility.",
    element: (el, cs) => (ownText(el) && cs.getPropertyValue("background-clip").includes("text") && cs.backgroundImage.includes("gradient") ? `"${snippet(el)}" is gradient text; let size and weight carry it.` : undefined),
  },
  {
    id: "glow", category: "tells", severity: "p3", tier: "review",
    about: "A coloured shadow with no offset (a glow) passed off as depth.",
    element: (_el, cs, check) => {
      const glow = list(cs.boxShadow).find((s) => {
        const m = s.match(/^(rgba?\([^)]*\)|\S+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/);
        return m && Math.abs(parseFloat(m[2]!)) < 1 && Math.abs(parseFloat(m[3]!)) < 1 && parseFloat(m[4]!) >= 8 && chroma(rgba(m[1]!, check)) > 0.3;
      });
      return glow ? `A coloured glow (${glow}); shadows read as light when they fall: an offset plus a blur.` : undefined;
    },
  },
  {
    id: "kicker", category: "tells", severity: "p3", tier: "review",
    about: "A small capitalised label above a heading (an eyebrow), by habit.",
    element: (el, _cs, check) => {
      if (!/^h[1-3]$/.test(el.localName)) return undefined;
      const before = el.previousElementSibling;
      if (!before || !ownText(before) || (before.textContent?.length ?? 0) > 40) return undefined;
      const s = check.view.getComputedStyle(before);
      return s.textTransform === "uppercase" || parseFloat(s.letterSpacing) > parseFloat(s.fontSize) * 0.06 ? `"${snippet(before)}" is an eyebrow over the heading; keep it only if it says something the heading doesn't.` : undefined;
    },
  },
  {
    id: "buzzwords", category: "tells", severity: "p3", tier: "review",
    about: "Marketing filler: unlock, seamless, supercharge, elevate, effortlessly, the future of…",
    element: (el) => {
      if (!ownText(el)) return undefined;
      const word = ownWords(el).match(/\b(unlock|seamless(ly)?|supercharge|elevate|effortless(ly)?|revolutioni[sz]e|game-?chang\w*|the future of)\b/i)?.[0];
      return word ? `"${snippet(el)}" says "${word}"; say plainly what it is and what happens.` : undefined;
    },
  },
  {
    id: "arrow-links", category: "tells", severity: "p3", tier: "review",
    about: "An arrow on every link and button (\"Learn more →\").",
    page: (check) => {
      const arrows = check.elements.filter(({ el }) => el.matches("a, button, [role=button]") && /[→↗➝⟶]\s*$/.test(el.textContent ?? ""));
      return arrows.length >= 3 ? [{ el: arrows[0]!.el, message: `${arrows.length} links and buttons end in an arrow; keep it where it means "goes somewhere else".` }] : [];
    },
  },
  {
    id: "em-dashes", category: "tells", severity: "p3", tier: "review",
    about: "Em dashes everywhere in the copy.",
    page: (check) => {
      const words = check.elements.map(({ el }) => ownWords(el)).join(" ");
      const dashes = (words.match(/—/g) ?? []).length;
      return dashes >= 6 && dashes >= words.length / 500 ? [{ el: check.elements[0]!.el, message: `${dashes} em dashes in the copy; most read better as a full stop or a comma.` }] : [];
    },
  },
];

/** Every rule's findings in `root`, in page order. `only` limits it to some rules (the edit tier, one category). */
export function review(root: Element, only: (rule: Rule) => boolean = () => true): Finding[] {
  const view = root.ownerDocument.defaultView;
  if (!view) throw new Error("The page is not ready.");
  // Let entrances finish, as they would by the time someone reads the page; a scroll-driven one can't be.
  for (const a of root.ownerDocument.getAnimations()) {
    try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch { /* Scroll-driven: it plays as the page scrolls. */ }
  }
  const elements = [root, ...root.querySelectorAll("*")].map((el) => ({ el, cs: view.getComputedStyle(el) }))
    .filter(({ el, cs }) => cs.display !== "none" && !["script", "style", "head", "meta", "link", "title"].includes(el.localName));
  const check: Check = { view, motions: pageMotion(root.ownerDocument, view), elements };
  const findings: Finding[] = [];
  for (const rule of RULES.filter(only)) {
    if (rule.element) for (const { el, cs } of elements) { const message = rule.element(el, cs, check); if (message) findings.push({ rule: rule.id, message, el }); }
    if (rule.page) for (const f of rule.page(check)) findings.push({ rule: rule.id, ...f });
  }
  return findings;
}
