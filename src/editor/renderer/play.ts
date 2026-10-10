import { childrenOf, walkFlow, type Comment, type Doc, type Flow, type Id } from "buni/format/doc.ts";

/** A problem noticed while playing a flow, worth handing to an agent. */
export interface Issue {
  page: Id;
  node?: Id;
  title: string;
  fix: string;
}

/** The flow to play from a page: the one asked for, else the first flow that reaches the page. */
export function flowFor(doc: Doc, page: Id, wanted?: Id): Flow | undefined {
  if (wanted && doc.flows[wanted]) return doc.flows[wanted];
  return Object.values(doc.flows)
    .sort((a, b) => (a.index < b.index ? -1 : 1))
    .find((f) => walkFlow(doc, f.start).pages.includes(page));
}

/** Where playing starts: the open page when the flow reaches it, else the flow's own start. */
export function firstPage(doc: Doc, flow: Flow | undefined, page: Id): Id {
  return !flow || walkFlow(doc, flow.start).pages.includes(page) ? page : flow.start;
}

/** Pages of a flow in walking order. */
export function flowSteps(doc: Doc, flow: Flow | undefined, fallback: Id): Id[] {
  // The usual path; a condition's alternative pages are reached from the screen that branches.
  if (!flow) return [fallback];
  // A state is played as its screen's step, so only the screens are steps.
  const { pages, alternatives } = walkFlow(doc, flow.start);
  const usual = pages.filter((p) => !alternatives.includes(p));
  return usual.filter((p) => { const page = doc.pages[p]; return page?.state === undefined || !usual.some((q) => doc.pages[q]?.route === page.route && doc.pages[q]?.state === undefined); });
}

function nodesOn(doc: Doc, page: Id): Id[] {
  const root = doc.pages[page]?.frame;
  if (!root) return [];
  const out: Id[] = [];
  const walk = (id: Id) => {
    out.push(id);
    for (const c of childrenOf(doc, id)) walk(c.id);
  };
  walk(root);
  return out;
}

/**
 * What playing the flow turned up: things that look clickable but go nowhere, and screens with
 * no way back to where the person came from.
 */
export function findIssues(doc: Doc, steps: readonly Id[]): Issue[] {
  const issues: Issue[] = [];
  const linked = new Set(Object.values(doc.connections).map((c) => `${c.page}/${c.node}`));
  for (const page of steps) {
    for (const id of nodesOn(doc, page)) {
      const n = doc.nodes[id];
      if (!n || (n.kind !== "text" && n.kind !== "frame") || (n.tag !== "a" && n.tag !== "button")) continue;
      if (linked.has(`${page}/${id}`)) continue;
      issues.push({ page, node: id, title: `“${n.name}” on ${doc.pages[page]?.name ?? page} goes nowhere`, fix: "Link it to a page, or make it plain text" });
    }
  }
  steps.forEach((page, i) => {
    if (i === 0) return;
    const earlier = new Set(steps.slice(0, i));
    const back = Object.values(doc.connections).some((c) => c.page === page && earlier.has(c.to));
    if (!back) issues.push({ page, title: `${doc.pages[page]?.name ?? page} has no way back`, fix: `Add a link back, e.g. the logo to ${doc.pages[steps[0] ?? ""]?.name ?? "the start"}` });
  });
  return issues;
}

/** Open notes (comment threads) on the given pages, in page order. */
export function notesOn(doc: Doc, pages: readonly Id[]): { comment: Comment; page: Id }[] {
  const pageOf = new Map<Id, Id>();
  for (const p of pages) for (const id of nodesOn(doc, p)) pageOf.set(id, p);
  return Object.values(doc.comments)
    .filter((c) => c.state === "open" && pageOf.has(c.node))
    .map((c) => ({ comment: c, page: pageOf.get(c.node) ?? "" }))
    .sort((a, b) => pages.indexOf(a.page) - pages.indexOf(b.page));
}

/** The request an agent gets when the person sends what they found while playing. */
export function notesPrompt(doc: Doc, flowName: string, notes: readonly { comment: Comment; page: Id }[], issues: readonly Issue[]): string {
  const lines = [`While playing the flow "${flowName}" I left notes. Plan the changes, ask me about anything unclear, then make them.`];
  notes.forEach(({ comment, page }, i) => {
    const node = doc.nodes[comment.node];
    lines.push(`${i + 1}. ${doc.pages[page]?.name ?? page} · ${node?.name ?? comment.node} (node ${comment.node}, thread ${comment.id}): ${comment.posts.at(-1)?.body ?? ""}`);
  });
  if (issues.length) {
    lines.push("", "Found while playing:");
    for (const x of issues) lines.push(`- ${x.title}${x.node ? ` (node ${x.node})` : ""}. ${x.fix}.`);
  }
  lines.push("", "When a note is handled, reply on its thread with comment {thread, body, addressed: true}.");
  return lines.join("\n");
}

/** A key press as Play sees it. */
export interface KeyPress {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const NAMES: Record<string, string> = { escape: "esc", return: "enter", arrowup: "up", arrowdown: "down", arrowleft: "left", arrowright: "right", " ": "space", control: "ctrl", option: "alt", meta: "cmd" };

/** A key the way people write it: "ctrl+k", tmux's "C-k", "Esc", "shift + tab", "?". */
function normalize(spec: string): string {
  return spec
    .trim()
    .toLowerCase()
    .replace(/^c-(.+)$/, "ctrl+$1")
    .replace(/^m-(.+)$/, "alt+$1")
    .split("+")
    .map((s) => s.trim())
    .map((s) => NAMES[s] ?? s)
    .join("+");
}

/** The press as a name: modifiers then the key; shift is part of a printed character ("?" not "shift+/"). */
export function pressName(p: KeyPress): string {
  const base = NAMES[p.key.toLowerCase()] ?? p.key.toLowerCase();
  const printable = base.length === 1;
  return [p.ctrl && "ctrl", p.alt && "alt", p.meta && "cmd", p.shift && !printable && "shift", base].filter(Boolean).join("+");
}

/** tmux's prefix: ctrl+b, after which a "prefix g" binding answers to g. */
export function isPrefix(p: KeyPress): boolean {
  return pressName(p) === "ctrl+b";
}

/** The key link a press follows on this screen, if any. */
export function keyLinkFor<T extends { key?: string }>(links: readonly T[], press: KeyPress, prefixed: boolean): T | undefined {
  const name = pressName(press);
  return links.find((c) => {
    const spec = normalize(c.key ?? "");
    if (spec.startsWith("prefix ")) return prefixed && normalize(spec.slice(7)) === name;
    return spec === name;
  });
}
