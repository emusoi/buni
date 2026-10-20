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
