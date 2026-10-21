// A brief an agent can build from: the design doc, then one page or flow with its screen, links and states. Without a
// focus, every page and flow.
import { SOURCE_COLLECTIONS, sourceLabel, sourceTarget, type SourceOwner } from "../format/sources.ts";
import { outline, pageName, walkFlow, type Connection, type Doc, type Id, type Page } from "../format/doc.ts";
import { docText } from "./doc-text.ts";
import { screenText, terminalNotes } from "./terminal.ts";

export type Focus = { page: Id } | { flow: Id };

/** Building a terminal screen to its drawing: a builder reads it cell by cell and can keep it as a golden file. */
const AS_TEXT = "Build each screen to match it cell for cell. Read one as the terminal shows it, borders and colours included, with read_screen {page}, or `buni shot FILE PAGE out.txt` (`.ans` in colour); keep it as a golden file in the screen's tests. On a 16-colour screen var(--term-red) is the terminal's red (ANSI 1, bright forms 9–15), and var(--term-fg) and var(--term-bg) its default colours; a bar in --term-fg on --term-bg swapped is reverse video.";

/** One link as a builder reads it: from which page and layer, on what trigger, to where, and when. */
function connectionLine(doc: Doc, c: Connection): string {
  const when = c.condition ? ` (only when ${c.condition.charAt(0).toLowerCase()}${c.condition.slice(1)})` : c.nav ? " (navigation, on every screen)" : "";
  return `- ${doc.pages[c.page]?.name ?? c.page}: ${c.trigger}${c.key ? ` ${c.key}` : ""} on "${doc.nodes[c.node]?.name ?? c.node}" → ${pageName(doc, c.to)}${when}`;
}

/** The page's layers as an outline, so the brief carries the screen's structure and words. */
function screenOutline(doc: Doc, page: Page): string[] {
  const frame = doc.nodes[page.frame];
  if (!frame) return [];
  const lines: string[] = [];
  outline(doc, frame, 0, lines);
  return ["```", ...lines, "```"];
}

/** Where these pieces were built from, so a builder opens the right files. */
function sourceLines(doc: Doc, ids: Iterable<Id>): string[] {
  return [...new Set(ids)].flatMap((id) => {
    const target = sourceTarget(doc, id);
    return target?.entity.sources?.map((source) => `- ${target.collection}/${id}: ${sourceLabel(source)}`) ?? [];
  });
}

function slice(doc: Doc, focus: Focus): { title: string; sections: [string, string[]][] } | string {
  if ("flow" in focus) {
    // A flow is the slice to build end to end: its pages in walking order, and how they link.
    const flow = doc.flows[focus.flow];
    if (!flow) return `flow "${focus.flow}" does not exist`;
    const walk = walkFlow(doc, flow.start);
    const pages = walk.pages.flatMap((id) => (doc.pages[id] ? [doc.pages[id]] : []));
    const name = (id: Id) => doc.pages[id]?.name ?? id;
    return {
      title: `flow ${flow.name}`,
      sections: [
        ["Pages, in order", pages.map((p, i) => `${i + 1}. ${p.name} (${p.id})${p.route ? ` ${p.route}` : ""}${p.terminal ? `: ${screenText(doc, p)}` : ""}`)],
        ["How they link", walk.links.map((c) => `- ${name(c.page)} → ${name(c.to)}: ${c.trigger === "key" ? `key ${c.key}` : `${c.trigger} ${doc.nodes[c.node]?.name ?? c.node}`}${c.condition ? ` (when ${c.condition})` : ""}`)],
        ["Terminal", pages.some((p) => p.terminal) ? [AS_TEXT] : []],
        ["Source files", sourceLines(doc, [flow.id, ...walk.pages])],
      ],
    };
  }

  const page = doc.pages[focus.page];
  if (!page) return `page "${focus.page}" does not exist`;
  // The screen and its states share a route: whoever builds one builds them all.
  const siblings = page.route === undefined ? [] : Object.values(doc.pages).filter((p) => p.route === page.route && p.id !== page.id);
  return {
    title: `page ${page.name}${page.route ? ` (${page.route}${page.state ? `, state ${page.state}` : ""})` : ""}`,
    sections: [
      ["States", siblings.map((p) => `- ${p.state ? `state **${p.state}**` : "the screen itself"}: page ${p.name} (${p.id})`)],
      // How a person gets here, and where each link on the page goes: the routing a builder wires up.
      ["Arrives from", Object.values(doc.connections).filter((c) => c.to === page.id && c.page !== page.id).map((c) => connectionLine(doc, c))],
      ["Links out", Object.values(doc.connections).filter((c) => c.page === page.id).sort((a, b) => Number(Boolean(a.condition)) - Number(Boolean(b.condition))).map((c) => connectionLine(doc, c))],
      ["Flows", Object.values(doc.flows).filter((f) => walkFlow(doc, f.start).pages.includes(page.id)).map((f) => `- ${f.name} (${f.id})`)],
      ["Screen", screenOutline(doc, page)],
      ["Terminal", page.terminal ? [`- ${screenText(doc, page)}`, "", AS_TEXT] : []],
      ["Source files", sourceLines(doc, [page.id])],
    ],
  };
}

function whole(doc: Doc): { title: string; sections: [string, string[]][] } {
  const pages = Object.values(doc.pages).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
  const terminal = pages.filter((p) => p.terminal);
  return {
    title: "the whole design",
    sections: [
      ["Pages", pages.filter((p) => p.route !== undefined && !p.terminal).map((p) => `- ${p.name} (${p.id}) ${p.route}${p.state ? `, state ${p.state}` : ""}${p.widths?.length ? `; must also work at ${p.widths.join(", ")} px (layers' "at" styles)` : ""}`)],
      ["Flows", Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1)).map((f) => `- ${f.name} (${f.id}): ${walkFlow(doc, f.start).pages.map((id) => pageName(doc, id)).join(" → ")}`)],
      ["Terminal screens", terminal.length ? [...terminal.map((p) => `- ${p.name} (${p.id}): ${screenText(doc, p)}`), "", AS_TEXT] : []],
      ["Worth a look", terminalNotes(doc).map((n) => `- ${n}`)],
      ["Source files", SOURCE_COLLECTIONS.flatMap((collection) => {
        const entities: (SourceOwner & { id: string })[] = Object.values(doc[collection]);
        return entities.flatMap((entity) => (entity.sources ?? []).map((source) => `- ${collection}/${entity.id}: ${sourceLabel(source)}`));
      })],
    ],
  };
}

/** Markdown brief for `focus`, or the error when the focus names nothing. */
export function contextText(doc: Doc, focus?: Focus): { ok: true; text: string } | { ok: false; error: string } {
  const s = focus ? slice(doc, focus) : whole(doc);
  if (typeof s === "string") return { ok: false, error: s };
  const intent = docText(doc);
  const body = s.sections.filter(([, lines]) => lines.length).map(([h, lines]) => `## ${h}\n${lines.join("\n")}`);
  return { ok: true, text: [`# Context: ${s.title}`, ...(intent ? [`## Intent\n${intent.replace(/^## /gm, "### ")}`] : []), ...body].join("\n\n") };
}

/** "page:checkout" → { page: "checkout" }; "flow:buy" → { flow: "buy" }. */
export function parseFocus(arg: string): Focus | undefined {
  const [kind, id] = arg.split(/:(.*)/s);
  if (!id) return undefined;
  if (kind === "page") return { page: id };
  if (kind === "flow") return { flow: id };
  return undefined;
}
