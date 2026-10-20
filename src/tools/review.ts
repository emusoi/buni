// A page of the design reviewed in Chrome as it is laid out, by the rules in editor/renderer/review.ts: what is
// wrong, on which layers, how much it matters, and a score that goes up as it is fixed.
import { z } from "zod";
import type { Doc, Id } from "../format/doc.ts";
import { RULES, type Category, type Severity } from "../editor/renderer/review.ts";
import { evaluateWithBrowser, findBrowser } from "../term/chrome.ts";
import { reviewSource } from "../term/capture-build.ts";
import { embeddedFont } from "./fontdata.ts";
import { fontFaces, motionCss, renderPage } from "./html.ts";

/** Every occurrence of one rule on the page, with the layers it is on. */
export interface Issue { rule: string; severity: Severity; category: Category; messages: string[]; nodes: Id[] }
export interface Review { score: number; issues: Issue[] }

const found = z.array(z.object({ rule: z.string(), message: z.string(), nodes: z.array(z.string()), selector: z.string() }));
const WEIGHT: Record<Severity, number> = { p1: 20, p2: 8, p3: 3 };
const RANK: Record<Severity, number> = { p1: 0, p2: 1, p3: 2 };

/** Out of 100: each rule broken costs its weight, and a little more for each further place it is broken. */
export function score(issues: readonly Issue[]): number {
  return Math.max(0, 100 - issues.reduce((sum, i) => sum + WEIGHT[i.severity] + Math.min(i.messages.length - 1, 5), 0));
}

/** One page reviewed as it renders, motion included. `edit` runs only the quick checks made after each edit. */
export async function reviewPage(doc: Doc, pageId: Id, opts: { edit?: boolean } = {}): Promise<Review> {
  const browser = findBrowser();
  if (!browser) throw new Error("Reviewing a page needs Chrome, Chromium or Edge on this machine, or BUNI_CHROME pointing at one.");
  const page = doc.pages[pageId];
  if (!page) throw new Error(`page "${pageId}" does not exist`);
  const { html, css } = renderPage(doc, pageId);
  const width = Number.parseInt(doc.nodes[page.frame]?.style.width ?? "", 10) || 1440;
  const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}${fontFaces(doc, embeddedFont)}${css}${motionCss(doc)}</style></head><body>${html}</body></html>`;
  const raw: unknown = JSON.parse(await evaluateWithBrowser(browser, { html: sheet, dir: ".", width }, `${await reviewSource()};window.buniReview(${JSON.stringify(opts.edit ? { edit: true } : {})})`));
  const failure = z.object({ error: z.string() }).safeParse(raw);
  if (failure.success) throw new Error(failure.data.error);
  const issues = new Map<string, Issue>();
  for (const f of found.parse(raw)) {
    const rule = RULES.find((r) => r.id === f.rule);
    if (!rule) continue;
    const issue = issues.get(rule.id) ?? { rule: rule.id, severity: rule.severity, category: rule.category, messages: [], nodes: [] };
    issue.messages.push(f.message);
    for (const n of f.nodes) if (doc.nodes[n] && !issue.nodes.includes(n)) issue.nodes.push(n);
    issues.set(rule.id, issue);
  }
  const sorted = [...issues.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.messages.length - a.messages.length);
  return { score: score(sorted), issues: sorted };
}

/** A review as the reply reads it: the score, then each issue, worst first, with the layers it is on. */
export function reviewText(doc: Doc, pageName: string, r: Review): string {
  if (!r.issues.length) return `${pageName}: ${r.score}/100. Nothing the checks catch; judge the rest with read_skill critique.`;
  const name = (id: Id) => `${doc.nodes[id]?.name ?? id} (${id})`;
  return [`${pageName}: ${r.score}/100, ${r.issues.length} issue${r.issues.length === 1 ? "" : "s"}.`, ...r.issues.map((i) =>
    `${i.severity.toUpperCase()} ${i.rule}${i.messages.length > 1 ? ` ×${i.messages.length}` : ""}: ${i.messages[0]}${i.nodes.length ? ` On ${i.nodes.slice(0, 4).map(name).join(", ")}${i.nodes.length > 4 ? ` and ${i.nodes.length - 4} more` : ""}.` : ""}`)].join("\n");
}

/** How a pinned finding starts, so a second review doesn't pin it again. */
export const pinTag = (rule: string) => `[review: ${rule}]`;
