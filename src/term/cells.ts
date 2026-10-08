// A terminal screen read back as the characters a terminal would show: every glyph the browser drew goes to the cell
// under its centre, borders become box-drawing characters, and each cell keeps its colours. `buni shot` writes it as
// .txt or, coloured, as .ans; builders read it as the screen and use it as a golden file.
import { CELL } from "../format/doc.ts";

export interface Cell {
  ch: string;
  /** CSS colours as the browser computes them ("rgb(…)"); undefined is the terminal's own. */
  fg?: string;
  bg?: string;
  bold?: boolean;
}

/** A screen read cell by cell, with the frame's own colours: what the terminal shows where nothing else is drawn. */
export interface Screen {
  fg?: string;
  bg?: string;
  grid: Cell[][];
}

/**
 * Runs in the page: reads the screen's frame (the body's first element) into rows of cells. Backgrounds first, then
 * borders, then text, each in document order so what's drawn later wins, as in the browser.
 */
export const READ_CELLS = `(() => {
  const W = ${CELL.w}, H = ${CELL.h};
  const root = document.body.firstElementChild;
  const o = root.getBoundingClientRect();
  const rows = Math.round(o.height / H), cols = Math.round(o.width / W);
  const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: " " })));
  const at = (r, c) => grid[r] && grid[r][c];
  const col = (x) => Math.round((x - o.left) / W), row = (y) => Math.round((y - o.top) / H);
  const shown = (c) => c && c !== "transparent" && !/^rgba\\(.*,\\s*0\\)$/.test(c);
  const els = [root, ...root.querySelectorAll("*")];
  for (const el of els) {
    const bg = getComputedStyle(el).backgroundColor;
    if (!shown(bg)) continue;
    const r = el.getBoundingClientRect();
    for (let y = row(r.top); y < row(r.bottom); y++) for (let x = col(r.left); x < col(r.right); x++) { const c = at(y, x); if (c) c.bg = bg; }
  }
  const BOX = { s: "─│┌┐└┘", r: "─│╭╮╰╯", h: "━┃┏┓┗┛", d: "═║╔╗╚╝" };
  // A terminal layer's border is drawn by its ::before (html.ts cellCss); the layer itself spans the border's cells.
  for (const el of els) {
    const s = getComputedStyle(el, "::before");
    if (s.content === "none" || s.position !== "absolute") continue;
    const on = ["Top", "Right", "Bottom", "Left"].map((k) => parseFloat(s["border" + k + "Width"]) > 0 && s["border" + k + "Style"] !== "none");
    if (!on.some(Boolean)) continue;
    const kind = s.borderTopStyle === "double" ? "d" : parseFloat(s.borderTopWidth) >= 2 ? "h" : parseFloat(s.borderTopLeftRadius) > 0 ? "r" : "s";
    const [hz, vt, tl, tr, bl, br] = BOX[kind];
    const r = el.getBoundingClientRect();
    const t = row(r.top), b = row(r.bottom) - 1, l = col(r.left), rt = col(r.right) - 1;
    const put = (y, x, ch) => { const c = at(y, x); if (c) { c.ch = ch; c.fg = s.borderTopColor; } };
    if (on[0]) for (let x = l; x <= rt; x++) put(t, x, hz);
    if (on[2]) for (let x = l; x <= rt; x++) put(b, x, hz);
    if (on[3]) for (let y = t; y <= b; y++) put(y, l, vt);
    if (on[1]) for (let y = t; y <= b; y++) put(y, rt, vt);
    if (on[0] && on[3]) put(t, l, tl);
    if (on[0] && on[1]) put(t, rt, tr);
    if (on[2] && on[3]) put(b, l, bl);
    if (on[2] && on[1]) put(b, rt, br);
  }
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = getComputedStyle(n.parentElement);
    const bold = parseInt(s.fontWeight, 10) >= 600;
    const text = n.data;
    for (let i = 0; i < text.length; i++) {
      range.setStart(n, i);
      range.setEnd(n, i + 1);
      const r = range.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const c = at(Math.floor(((r.top + r.bottom) / 2 - o.top) / H), Math.floor(((r.left + r.right) / 2 - o.left) / W));
      if (!c) continue;
      c.ch = text[i];
      c.fg = s.color;
      c.bold = bold;
    }
  }
  const rs = getComputedStyle(root);
  return JSON.stringify({ fg: rs.color, bg: rs.backgroundColor, grid });
})()`;

/** The screen as plain text: one line per row, without trailing spaces. */
export function cellsText({ grid }: Screen): string {
  return `${grid.map((row) => row.map((c) => c.ch).join("").trimEnd()).join("\n")}\n`;
}

const RGB = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/;
const sgr = (layer: 38 | 48, css: string | undefined) => {
  const m = css?.match(RGB);
  return m ? `${layer};2;${m[1]};${m[2]};${m[3]}` : undefined;
};

/**
 * The screen with its colours as ANSI escapes, for `cat`. The frame's own colours are left to the terminal, so the
 * screen sits on the reader's theme the way the built app will; the two swapped is reverse video. With `slots` (the
 * palette of a 16-colour screen, by computed colour), a palette colour is its ANSI number and follows the theme too;
 * any other colour is spelled out.
 */
export function cellsAnsi({ grid, ...base }: Screen, slots: ReadonlyMap<string, number> = new Map()): string {
  const paint = (layer: 38 | 48, css: string | undefined) => {
    const slot = css === undefined ? undefined : slots.get(css);
    if (slot !== undefined) return String((layer === 38 ? 30 : 40) + (slot < 8 ? slot : 60 + slot - 8));
    return sgr(layer, css);
  };
  const lines = grid.map((row) => {
    let out = "";
    let last = "";
    for (const c of row) {
      // On the default text colour a cell is part of a reversed bar (a blank one has no text colour of its own). A
      // coloured glyph there is reverse video with its colour as the background, which reverse swaps back to the text.
      const onBar = base.fg !== undefined && c.bg === base.fg;
      const colours = !onBar
        ? [c.fg !== base.fg ? paint(38, c.fg) : undefined, c.bg !== base.bg ? paint(48, c.bg) : undefined]
        : c.fg === base.bg || (c.fg === undefined && c.ch === " ") ? ["7"] : ["7", paint(48, c.fg)];
      const codes = [c.bold ? "1" : undefined, ...colours].filter((x) => x !== undefined).join(";");
      if (codes !== last) out += `\x1b[0${codes ? `;${codes}` : ""}m`;
      last = codes;
      out += c.ch;
    }
    return `${out}\x1b[0m`;
  });
  return `${lines.join("\n")}\n`;
}

/** A hex colour as the browser computes it, so a cell's colour can be looked up in the palette. */
export const computed = (hex: string) => `rgb(${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
