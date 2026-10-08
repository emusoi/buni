// Terminal clients in the brief, in each framework's own words, and what to look at before building them.
import { CELL, type Doc, type Id, type Node, type Page, type Part, type Style, type TerminalFramework, type TerminalLanguage, type TerminalSurface, type TerminalTarget } from "../format/doc.ts";

/**
 * The 16 colours a terminal names, in ANSI order (black is 0, bright white 15), as a dark theme draws them on the
 * canvas. A screen designed for 16 colours paints with var(--term-red) and the rest, so it follows the reader's
 * theme once built; --term-fg and --term-bg are the terminal's own text and background.
 */
export const ANSI = [
  ["black", "#000000"], ["red", "#cd3131"], ["green", "#0dbc79"], ["yellow", "#e5e510"],
  ["blue", "#2472c8"], ["magenta", "#bc3fbc"], ["cyan", "#11a8cd"], ["white", "#e5e5e5"],
  ["bright-black", "#666666"], ["bright-red", "#f14c4c"], ["bright-green", "#23d18b"], ["bright-yellow", "#f5f543"],
  ["bright-blue", "#3b8eea"], ["bright-magenta", "#d670d6"], ["bright-cyan", "#29b8db"], ["bright-white", "#ffffff"],
] as const;
export const TERM_FG = "#cccccc";
export const TERM_BG = "#1e1e1e";

/** The palette as the CSS custom properties a terminal screen's frame defines. */
export function paletteVars(): Record<string, string> {
  return { ...Object.fromEntries(ANSI.map(([name, hex]) => [`--term-${name}`, hex])), "--term-fg": TERM_FG, "--term-bg": TERM_BG };
}

const LANGUAGE = { go: "Go", rust: "Rust", python: "Python", typescript: "TypeScript" } as const;

/** What a builder reaches for in each framework, so the brief maps straight onto real code. */
const FRAMEWORK: Record<TerminalFramework, string> = {
  bubbletea: "Bubble Tea (a model with Update and View per screen; Lip Gloss for styles and borders; Bubbles for list, table, textinput, viewport, spinner, help)",
  ratatui: "Ratatui (a Block per bordered box, List, Table, Paragraph, Tabs, Gauge; Layout constraints for the grid; crossterm events for keys)",
  textual: "Textual (an App with a Screen per screen, widgets such as ListView, DataTable, Input, Footer for the keys; TCSS for styles; BINDINGS for keys)",
  ink: "Ink (<Box> for layout with flexbox, <Text> for styled text, useInput for keys)",
  opentui: "OpenTUI (createCliRenderer; BoxRenderable with flexbox and single, double, rounded or heavy borders, TextRenderable, SelectRenderable, TabSelectRenderable, InputRenderable, ScrollBoxRenderable, TextTable; renderer.keyInput for keys; or the same through its React or Solid bindings)",
  "pi-tui": "pi-tui (TuiAltScreen for a full screen or TuiMainScreen to keep scrollback; Container, VStack, HStack and Box for layout, Text, SelectList, SettingsList, Input, Editor, ScrollView, Loader; overlays for popups; matchesKey and KeybindingsManager for keys)",
};

const SURFACE: Record<TerminalSurface, string> = {
  app: "full-screen app (alternate screen)",
  inline: "output printed inline into the scrollback",
  "tmux-status": "tmux status line",
  "tmux-layout": "tmux window layout of panes",
  "tmux-popup": "tmux popup (display-popup)",
  "tmux-menu": "tmux menu (display-menu)",
  "zellij-plugin": "zellij plugin pane",
  "nvim-float": "Neovim floating window",
  "nvim-split": "Neovim split",
  prompt: "shell prompt",
  picker: "fzf-style picker",
};

const COLORS = { none: "no colour", "16": "the terminal's 16 colours", "256": "256 colours", truecolor: "full colour" } as const;

function targetText(t: TerminalTarget): string {
  return `${LANGUAGE[t.language]}${t.framework ? ` with ${FRAMEWORK[t.framework]}` : ""}`;
}

/** How a terminal client is built, for its line in the brief: one build, or the same screens built several ways. */
export function terminalClientText(p: Part): string | undefined {
  const targets = p.terminal?.targets ?? [];
  if (targets.length === 0) return undefined;
  if (targets.length === 1 && targets[0]) return `runs in a terminal, written in ${targetText(targets[0])}`;
  return `runs in a terminal; the same screens are built ${targets.length} ways, to compare:\n${targets.map((t) => `    - ${targetText(t)}`).join("\n")}`;
}

/** What a target is called on the command line and in tools: its framework, or its language when it has none. */
export function targetName(t: TerminalTarget): TerminalFramework | TerminalLanguage {
  return t.framework ?? t.language;
}

/**
 * The document as one target sees it: every terminal client that builds that target keeps only it,
 * so a brief speaks one framework's words. Undefined when no client builds it.
 */
export function forTarget(doc: Doc, target: string): Doc | undefined {
  let found = false;
  const parts: Doc["parts"] = {};
  for (const [id, p] of Object.entries(doc.parts)) {
    const keep = p.terminal?.targets.filter((t) => targetName(t) === target) ?? [];
    if (keep.length > 0) found = true;
    parts[id] = keep.length > 0 ? { ...p, terminal: { targets: keep } } : p;
  }
  return found ? { ...doc, parts } : undefined;
}

/** One terminal screen: where it shows, its grid, its colour, and the keys that leave it. */
export function screenText(doc: Doc, page: Page): string | undefined {
  const t = page.terminal;
  if (!t) return undefined;
  const keys = Object.values(doc.connections)
    .filter((c) => c.page === page.id && c.trigger === "key")
    .map((c) => `${c.key} → ${doc.pages[c.to]?.name ?? c.to}`);
  return [
    `${SURFACE[t.surface]}, ${t.cols}${t.rows !== undefined ? `×${t.rows}` : " columns wide, growing as it prints"}, designed for ${COLORS[t.colors]}`,
    keys.length ? `keys: ${keys.join(", ")}` : "",
  ].filter(Boolean).join("; ");
}

/** Surfaces a person acts in, which need keys to move, act and leave. */
const INTERACTIVE = new Set<TerminalSurface>(["app", "tmux-popup", "tmux-menu", "zellij-plugin", "nvim-float", "picker"]);

/** What to look at before building terminal screens, one sentence each. */
export function terminalNotes(doc: Doc): string[] {
  const notes: string[] = [];
  const screens = Object.values(doc.pages).filter((p) => p.terminal);
  for (const p of screens) {
    const t = p.terminal;
    if (!t) continue;
    const links = Object.values(doc.connections).filter((c) => c.page === p.id);
    if (INTERACTIVE.has(t.surface) && !links.some((c) => c.trigger === "key")) notes.push(`${p.name} has no keys linked; say how to move, act and leave.`);
    for (const c of links) if (c.trigger === "click" || c.trigger === "hover") notes.push(`${p.name} reaches ${doc.pages[c.to]?.name ?? c.to} only with the mouse; give it a key.`);
  }
  // Colour is a client's choice more than a screen's: one note per client, naming its screens.
  for (const part of Object.values(doc.parts)) {
    const rich = screens.filter((p) => p.client === part.id && (p.terminal?.colors === "truecolor" || p.terminal?.colors === "256"));
    if (rich.length === 0) continue;
    const names = rich.length > 3 ? `${rich.slice(0, 3).map((p) => p.name).join(", ")} and ${rich.length - 3} more` : rich.map((p) => p.name).join(", ");
    notes.push(`${part.name} is designed for more than 16 colours (${names}); say what it looks like with 16 colours and with colour off.`);
  }
  // A full-screen app should still work in the classic 80×24 terminal.
  for (const part of Object.values(doc.parts)) {
    const apps = screens.filter((p) => p.client === part.id && p.terminal?.surface === "app");
    if (apps.length > 0 && apps.every((p) => (p.terminal?.cols ?? 0) > 80)) notes.push(`${part.name}'s screens are all wider than 80 columns; design what it shows at 80×24.`);
  }
  return notes;
}

// What a terminal can't draw, as a designer would break it on the canvas. Checked on every layer an edit touches on a
// terminal screen and reported with the tool's reply, so whoever made it can fix it before a builder finds it.

const ACROSS = ["width", "minWidth", "maxWidth", "left", "right", "paddingLeft", "paddingRight", "marginLeft", "marginRight", "columnGap"];
const DOWN = ["height", "minHeight", "maxHeight", "top", "bottom", "paddingTop", "paddingBottom", "marginTop", "marginBottom", "rowGap"];
/** Shorthands by position: top, right, bottom, left (CSS's own order), or row then column for gap. */
const BOX = ["padding", "margin", "inset"];
const FONT = ["fontFamily", "fontSize", "lineHeight", "letterSpacing"];
const UNDRAWABLE = ["boxShadow", "textShadow", "filter", "backdropFilter", "transform", "backgroundImage"];
const COLOURED = ["color", "background", "backgroundColor", "borderColor", "border", "borderTop", "borderRight", "borderBottom", "borderLeft", "outline", "outlineColor"];
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(|\b(?:red|green|blue|white|black|gray|grey|yellow|orange|purple|pink|cyan|magenta)\b/i;
const BOXES = new Set(["1px solid", "2px solid", "3px double"]);

/** Why a length isn't whole cells of `step` px, or undefined when it is (0, auto and percentages are fine). */
function offGrid(token: string, step: number): string | undefined {
  if (token === "0" || token === "auto" || token.endsWith("%")) return undefined;
  const px = token.match(/^(-?\d*\.?\d+)px$/);
  if (!px) return /^-?\d*\.?\d+[a-z]+$/i.test(token) ? `${token} isn't px` : undefined;
  return Number(px[1]) % step === 0 ? undefined : `${token} isn't whole ${step === CELL.w ? "columns" : "rows"} (${step}px)`;
}

function nodeProblems(n: Node, page: Page, root: boolean): string[] {
  const colors = page.terminal?.colors ?? "truecolor";
  const style: Style = n.style;
  const out: string[] = [];
  const say = (what: string) => out.push(`"${n.name}" ${what}`);
  if (n.kind === "image" || n.kind === "svg") say("is a picture; a terminal draws characters (✓ ● › ⠋), not images or icons");
  for (const [k, v] of Object.entries(style)) {
    if (v === undefined) continue;
    if (!root && (k === "width" || k === "height" || ACROSS.includes(k) || DOWN.includes(k))) {
      const why = offGrid(v.trim(), ACROSS.includes(k) ? CELL.w : CELL.h);
      if (why) say(`${k}: ${why}`);
    }
    if (BOX.includes(k) || k === "gap") {
      const parts = v.trim().split(/\s+/);
      const [a = "0", b = a, c = a, d = b] = parts;
      // CSS's order: top, right, bottom, left (rows, columns, rows, columns); gap is row, then column. One gap in a flex
      // line spaces only along it: columns in a row, rows in a column.
      const along = style.flexDirection?.startsWith("column") ? CELL.h : CELL.w;
      const sides: [string, number][] = k !== "gap" ? [[a, CELL.h], [b, CELL.w], [c, CELL.h], [d, CELL.w]]
        : parts.length === 1 && style.display?.includes("flex") ? [[a, along]] : [[a, CELL.h], [b, CELL.w]];
      for (const [t, step] of sides) {
        const why = offGrid(t, step);
        if (why) say(`${k}: ${why}`);
      }
    }
    if (!root && FONT.includes(k)) say(`sets ${k}; a terminal has one font and size, set on the screen's frame`);
    if (UNDRAWABLE.includes(k) || ((k === "background" || k === "backgroundImage") && /gradient\(|url\(/i.test(v))) say(`${k}: a terminal draws no shadows, gradients, filters or transforms`);
    if (k.startsWith("border") && /\d/.test(v) && !k.endsWith("Radius") && !k.endsWith("Color")) {
      const m = v.match(/(\d+px)\s+(solid|double|dashed|dotted|groove|ridge|inset|outset)/);
      if (m && !BOXES.has(`${m[1]} ${m[2]}`)) say(`${k}: ${m[1]} ${m[2]} isn't a box-drawing border; use 1px solid, 2px solid (thick) or 3px double`);
    }
    if ((colors === "16" || colors === "none") && COLOURED.includes(k)) {
      const vars = [...v.matchAll(/var\(--([\w-]+)/g)].map((x) => x[1] ?? "");
      const allowed = colors === "none" ? (x: string) => x === "term-fg" || x === "term-bg" : (x: string) => x.startsWith("term-");
      if (LITERAL.test(v.replace(/var\([^)]*\)/g, "")) || vars.some((x) => !allowed(x))) {
        say(colors === "none"
          ? `${k}: ${v} — this screen is designed with colour off; use bold, dim, reverse (var(--term-fg) on var(--term-bg) swapped) and symbols`
          : `${k}: ${v} — a 16-colour screen paints with the terminal's palette, var(--term-red) and the rest`);
      }
    }
  }
  return out;
}

/** What breaks the terminal grid among `ids`, the layers an edit wrote; nothing for layers on other pages. */
export function gridProblems(doc: Doc, ids: readonly Id[]): string[] {
  const pageOf = new Map(Object.values(doc.pages).filter((p) => p.terminal).map((p) => [p.frame, p]));
  if (pageOf.size === 0) return [];
  const out: string[] = [];
  for (const id of new Set(ids)) {
    let n = doc.nodes[id];
    const self = n;
    while (n?.parent !== undefined) n = doc.nodes[n.parent];
    const page = n ? pageOf.get(n.id) : undefined;
    if (page && self) out.push(...nodeProblems(self, page, self.id === page.frame));
  }
  return [...new Set(out)];
}
