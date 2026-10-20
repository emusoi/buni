// How an element moves on a live page, read from its computed style and the page's stylesheets: entrances
// (keyframe animations) and hover or press responses, as Buni's motion where they fit one, and what doesn't fit
// written down so a snapshot never loses it silently. Runs in the page, next to the HTML capture.
import type { Easing, Motion, MotionEffect } from "buni/format/doc.ts";

/** One rule for a pointer state on the page: what it changes, for elements its selector (without the state) matches. */
interface StateRule { selector: string; state: "hover" | "active"; style: CSSStyleDeclaration }
export interface PageMotion { keyframes: Map<string, CSSKeyframesRule>; states: StateRule[] }
/** What an element does: Buni motion, plus what Buni's motion can't hold, as CSS a person can read. */
export interface ElementMotion { motion: Motion[]; unkept: string[] }

const KEYWORDS: Record<string, string> = {
  ease: "cubic-bezier(0.25, 0.1, 0.25, 1)", "ease-in": "cubic-bezier(0.42, 0, 1, 1)",
  "ease-out": "cubic-bezier(0, 0, 0.58, 1)", "ease-in-out": "cubic-bezier(0.42, 0, 0.58, 1)",
};
/** The curves Buni's easings draw (html.ts EASE); a timing function that is one of them needs no curve of its own. */
const PRESETS: Record<string, Easing> = {
  "cubic-bezier(0.22, 1, 0.36, 1)": "out", "cubic-bezier(0.65, 0, 0.35, 1)": "in-out", "cubic-bezier(0.19, 1, 0.22, 1)": "dramatic",
};

/** The page's keyframes and pointer-state rules, from every stylesheet it can read (a cross-origin one can't be). */
export function pageMotion(doc: Document, view: Window & typeof globalThis): PageMotion {
  const keyframes = new Map<string, CSSKeyframesRule>();
  const states: StateRule[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (rule instanceof view.CSSKeyframesRule) keyframes.set(rule.name, rule);
      else if (rule instanceof view.CSSMediaRule) { if (view.matchMedia(rule.media.mediaText).matches) walk(rule.cssRules); }
      else if (rule instanceof view.CSSStyleRule) {
        for (const part of rule.selectorText.split(",")) {
          // Only the element's own state (".card:hover"), not an ancestor's (".card:hover img").
          const m = part.trim().match(/^(.*?):(hover|active)$/);
          if (m?.[1]) states.push({ selector: m[1], state: m[2] === "hover" ? "hover" : "active", style: rule.style });
        }
        if (rule.cssRules.length) walk(rule.cssRules);
      } else if (rule instanceof view.CSSGroupingRule) walk(rule.cssRules);
    }
  };
  for (const sheet of doc.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* A cross-origin stylesheet's rules can't be read. */ }
  }
  return { keyframes, states };
}

const ms = (time: string): number => Math.round(time.endsWith("ms") ? parseFloat(time) : parseFloat(time) * 1000) || 0;
const nth = (list: string, i: number): string => {
  const parts = list.split(/,(?![^(]*\))/).map((s) => s.trim());
  return parts[i % parts.length] ?? "";
};

/** A timing function as Buni's easing, plus the exact curve when it isn't one of Buni's own. */
function easing(timing: string): { easing: Easing; curve?: string } | undefined {
  if (timing === "linear") return { easing: "linear" };
  const curve = KEYWORDS[timing] ?? timing;
  const m = curve.match(/^cubic-bezier\(([^)]+)\)$/);
  if (!m?.[1]) return undefined;
  const preset = PRESETS[curve];
  if (preset) return { easing: preset };
  // A curve that starts slowly is movement between places; anything else reads as a deceleration. The exact curve is
  // kept either way, so this is only its name.
  return { easing: Number(m[1].split(",")[0]) >= 0.4 ? "in-out" : "out", curve };
}

/** Where a transform puts the element, read through DOMMatrix (Tailwind's var() pieces are read from their variables). */
function moved(style: CSSStyleDeclaration, view: Window & typeof globalThis): { x: number; y: number; scale: number } | undefined {
  const tw = (name: string) => style.getPropertyValue(`--tw-${name}`).trim();
  const length = (v: string) => (v.endsWith("rem") ? parseFloat(v) * 16 : parseFloat(v)) || 0;
  const factor = (v: string) => (v.endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));
  if (tw("translate-y") || tw("translate-x") || tw("scale-x")) {
    return { x: length(tw("translate-x")), y: length(tw("translate-y")), scale: tw("scale-x") ? factor(tw("scale-x")) : 1 };
  }
  const transform = style.getPropertyValue("transform").trim();
  const translate = style.getPropertyValue("translate").trim();
  const scale = style.getPropertyValue("scale").trim();
  if (!transform && !translate && !scale) return undefined;
  let x = 0, y = 0, s = 1;
  if (transform && transform !== "none") {
    try { const m = new view.DOMMatrix(transform); x = m.m41; y = m.m42; s = Math.hypot(m.a, m.b); } catch { return undefined; }
  }
  if (translate && translate !== "none") { const [tx = "0", ty = "0"] = translate.split(/\s+/); x += length(tx); y += length(ty); }
  if (scale && scale !== "none") s *= factor(scale.split(/\s+/)[0] ?? "1");
  return { x, y, scale: s };
}

/** Which of Buni's entrances a keyframe's starting point is, if any. */
function entrance(from: CSSStyleDeclaration, view: Window & typeof globalThis): MotionEffect | undefined {
  if (/blur\(/.test(from.getPropertyValue("filter"))) return "blur";
  const at = moved(from, view);
  const faded = from.getPropertyValue("opacity").trim() !== "" && parseFloat(from.getPropertyValue("opacity")) < 1;
  if (at && Math.abs(at.y) > Math.abs(at.x) && at.y > 0) return "rise";
  if (at && Math.abs(at.x) > 0 && at.x > 0) return "slide-left";
  if (at && Math.abs(at.x) > 0 && at.x < 0) return "slide-right";
  if (at && at.scale < 1) return "scale";
  if (faded && (!at || (at.x === 0 && at.y === 0 && at.scale === 1))) return "fade";
  return undefined;
}

/** Which of Buni's responses a hover or press rule is, if any. */
function response(style: CSSStyleDeclaration, view: Window & typeof globalThis): MotionEffect | undefined {
  const at = moved(style, view);
  if (at && at.y < 0) return "lift";
  if (at && at.scale > 1) return "grow";
  if (at && at.scale < 1) return "shrink";
  const opacity = style.getPropertyValue("opacity").trim();
  if (opacity && parseFloat(opacity) < 1) return "dim";
  return undefined;
}

/** How one element moves on the page. */
export function elementMotion(el: Element, cs: CSSStyleDeclaration, page: PageMotion, view: Window & typeof globalThis): ElementMotion {
  const motion: Motion[] = [];
  const unkept: string[] = [];
  const names = cs.animationName.split(",").map((s) => s.trim()).filter((n) => n && n !== "none");
  names.forEach((name, i) => {
    const css = `animation: ${name} ${nth(cs.animationDuration, i)} ${nth(cs.animationTimingFunction, i)} ${nth(cs.animationDelay, i)} ${nth(cs.animationIterationCount, i)}`;
    const rule = page.keyframes.get(name);
    const from = rule?.findRule("0%") ?? rule?.findRule("from");
    const effect = from && nth(cs.animationIterationCount, i) !== "infinite" ? entrance(from.style, view) : undefined;
    const ease = easing(nth(cs.animationTimingFunction, i));
    const timeline = cs.getPropertyValue("animation-timeline");
    const trigger = /view\(/.test(nth(timeline, i)) ? "scroll" : "load";
    if (!effect || !ease || motion.some((m) => m.trigger === trigger)) {
      unkept.push(`${css}${rule ? `; ${rule.cssText.replace(/\s+/g, " ")}` : ""}`);
      return;
    }
    const delay = ms(nth(cs.animationDelay, i));
    motion.push({ trigger, effect, durationMs: Math.min(10_000, ms(nth(cs.animationDuration, i))), easing: ease.easing, ...(ease.curve ? { curve: ease.curve } : {}), ...(delay > 0 ? { delayMs: Math.min(10_000, delay) } : {}) });
  });
  for (const state of ["hover", "active"] as const) {
    const rule = page.states.find((r) => r.state === state && (() => { try { return el.matches(r.selector); } catch { return false; } })() && response(r.style, view));
    if (!rule) continue;
    const effect = response(rule.style, view)!;
    // The transition that carries it: the one naming transform or opacity, else all.
    const props = cs.transitionProperty.split(",").map((s) => s.trim());
    const i = Math.max(0, props.findIndex((p) => p === (effect === "dim" ? "opacity" : "transform") || p === "all"));
    const duration = ms(nth(cs.transitionDuration, i));
    const ease = easing(nth(cs.transitionTimingFunction, i)) ?? { easing: "out" as const };
    motion.push({ trigger: state === "hover" ? "hover" : "press", effect, durationMs: Math.min(10_000, duration), easing: ease.easing, ...(ease.curve ? { curve: ease.curve } : {}) });
  }
  return { motion, unkept };
}
