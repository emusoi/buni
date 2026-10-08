// The page buni open shows: the design's pages on a canvas, a rail to find them, and one page at a time when asked.
// Plain HTML, CSS and script, so the core needs no front-end build. Drawn after designs/viewer.buni.

const WORDMARK =
  '<svg viewBox="-18 92 460 186" height="18" aria-label="buni"><path d="M0 110V260M0 210A50 50 0 1 0 100 210A50 50 0 1 0 0 210M140 160V210A50 50 0 0 0 240 210M240 160V260M280 260V160M280 210A50 50 0 0 1 380 210V260M420 160V260" fill="none" stroke="currentColor" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/><rect x="404" y="98" width="32" height="32" fill="none" stroke="currentColor" stroke-width="7"/></svg>';

const ICON = {
  page: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  terminal: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/></svg>',
  flow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
  panel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>',
  back: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
};

const CSS = `
@font-face { font-family: Manrope; src: url(/fonts/Manrope) format("woff2"); font-weight: 200 800; }
@font-face { font-family: "JetBrains Mono"; src: url(/fonts/JetBrains%20Mono) format("woff2"); font-weight: 100 800; }
:root {
  --canvas: #e9e9e6; --bar: #ffffff; --rail: #f7f7f5; --page: #ffffff; --chip: #efefec; --selected: #efefec;
  --ink: #37352f; --ink-2: #787774; --ink-3: #a3a29e; --live: #448361; --danger: #c4453c;
  --divider: rgba(55,53,47,0.09); --font: Manrope, ui-sans-serif, system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, monospace; --r-sm: 6px; --r-menu: 10px;
  --shadow-card: 0 1px 2px rgba(28,27,24,0.06), 0 0 0 1px rgba(28,27,24,0.05);
  --shadow-pop: 0 12px 32px -8px rgba(28,27,24,0.18), 0 2px 6px rgba(28,27,24,0.06);
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--canvas); color: var(--ink); font: 14px var(--font); }
#app { display: flex; height: 100%; }
#app.collapsed #rail { display: none; }
#rail { display: flex; flex-direction: column; width: 232px; flex-shrink: 0; background: var(--rail); border-right: 1px solid var(--divider); padding: 14px 10px; overflow-y: auto; }
#rail .mark { padding: 4px 8px 14px; color: var(--ink); }
#rail h2 { margin: 18px 8px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--ink-3); }
#rail h2:first-of-type { margin-top: 10px; }
#rail .none { margin: 0 8px; font-size: 13px; color: var(--ink-3); }
.item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--r-sm); cursor: pointer; color: var(--ink-2); }
.item:hover { background: var(--selected); }
.item .name { flex: 1; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item .meta { font: 12px var(--mono); color: var(--ink-3); }
.item .dot { width: 6px; height: 6px; border-radius: 99px; background: var(--live); }
.note { margin: auto 2px 0; padding: 12px; border-radius: var(--r-menu); background: var(--page); box-shadow: var(--shadow-card); }
.note b { display: block; font-size: 13px; margin-bottom: 6px; }
.note p { margin: 0 0 6px; font-size: 12px; line-height: 18px; color: var(--ink-2); }
.note code { font: 11px var(--mono); color: var(--ink-2); }
main { position: relative; display: flex; flex-direction: column; flex: 1; min-width: 0; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 48px; padding: 0 16px; background: var(--bar); border-bottom: 1px solid var(--divider); }
header .file { display: flex; align-items: center; gap: 10px; min-width: 0; }
#toggle { display: flex; padding: 5px; margin-left: -6px; border: 0; border-radius: var(--r-sm); background: none; color: var(--ink-2); cursor: pointer; }
#toggle:hover { background: var(--selected); }
#file { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
#file b { font-size: 14px; }
#file > span { font: 12px var(--mono); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.live { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
.pill { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; background: var(--chip); font-size: 12px; color: var(--ink-2); }
.pill i { width: 7px; height: 7px; border-radius: 99px; background: var(--ink-3); }
.pill.on i { background: var(--live); }
.pill.bad { color: var(--danger); }
.pill.bad i { background: var(--danger); }
.ago { font-size: 12px; color: var(--ink-3); }
#canvas { position: relative; flex: 1; overflow: hidden; cursor: grab; }
#canvas.panning { cursor: grabbing; }
#world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
#arrows { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.board { position: absolute; cursor: pointer; }
.board .label { position: absolute; left: 0; bottom: 100%; display: flex; align-items: center; gap: 8px; padding-bottom: 8px; white-space: nowrap; transform-origin: 0 100%; }
.board .label b { font-size: 12px; color: var(--ink-2); font-weight: 600; }
.board .label span { font: 12px var(--mono); color: var(--ink-3); }
.board .label em { font-style: normal; padding: 2px 8px; border-radius: 99px; background: var(--live); color: #fff; font-size: 11px; font-weight: 600; }
.board .sheet { background: var(--page); box-shadow: var(--shadow-card); overflow: hidden; }
.board.changed .sheet { box-shadow: 0 0 0 3px var(--live), var(--shadow-card); }
iframe { display: block; border: 0; pointer-events: none; background: var(--page); }
#zoom { position: absolute; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: var(--r-menu); background: var(--bar); box-shadow: var(--shadow-pop); }
#zoom button { border: 0; background: none; padding: 6px 8px; border-radius: var(--r-sm); font: 12px var(--font); color: var(--ink-2); cursor: pointer; }
#zoom button:hover { background: var(--selected); }
#zoom .pct { font: 12px var(--mono); color: var(--ink-2); padding: 0 4px; min-width: 44px; text-align: center; }
#zoom hr { width: 1px; height: 16px; border: 0; background: var(--divider); margin: 0 4px; }
#empty, #page { position: absolute; inset: 48px 0 0 0; display: none; }
#empty.on { display: flex; align-items: center; justify-content: center; }
.start { display: flex; flex-direction: column; gap: 16px; width: 520px; padding: 32px; border-radius: var(--r-menu); background: var(--page); box-shadow: var(--shadow-pop); }
.start h1 { margin: 0; font-size: 20px; letter-spacing: -0.01em; }
.start p { margin: 0; font-size: 14px; line-height: 22px; color: var(--ink-2); }
.start .cmds { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; border-radius: var(--r-sm); background: var(--rail); font: 12px/18px var(--mono); }
.start .cmds div { display: flex; justify-content: space-between; gap: 16px; }
.start .cmds span { color: var(--ink-3); }
.start small { font-size: 12px; color: var(--ink-3); }
#page.on { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 20px 32px; overflow: auto; background: var(--canvas); }
#page .bar { display: flex; align-items: center; justify-content: space-between; align-self: stretch; }
#page .back { display: flex; align-items: center; gap: 6px; padding: 5px 12px 5px 8px; border: 0; border-radius: 99px; background: var(--bar); box-shadow: var(--shadow-card); font: 13px var(--font); color: var(--ink); cursor: pointer; }
#page .title { font-size: 12px; color: var(--ink-2); }
#page .title b { color: var(--ink); margin-right: 8px; }
#page .title span { font-family: var(--mono); color: var(--ink-3); }
#page .sheet { flex-shrink: 0; background: var(--page); box-shadow: var(--shadow-pop); overflow: hidden; }
#page .bar .spacer { width: 96px; }
`;

const SCRIPT = String.raw`
const $ = (s) => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
let snap = null, first = true, scale = 0.4, panX = 40, panY = 40, moved = false, open = null, lastUpdate = Date.now();
const boards = new Map(), heights = {}, changedAt = {};

// Pages run no script (the sandbox allows none); sharing this page's origin, they load their fonts and images from
// this server and the viewer can measure them.
const withBase = (html) => html.replace("<head>", '<head><base href="' + location.origin + '/">');
const SANDBOX = "allow-same-origin";
/** Keeps a board as tall as its page, as fonts and images arrive. */
function measure(id, frame) {
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return;
    const tell = () => { const h = doc.body.scrollHeight; if (h && heights[id] !== h) { heights[id] = h; place(); if (open === id) openPage(id); } };
    tell();
    doc.fonts.ready.then(tell);
    new ResizeObserver(tell).observe(doc.body);
  });
}
const heightOf = (b) => b.height || heights[b.id] || 900;
const meta = (b) => b.terminal ? b.terminal.cols + "×" + (b.terminal.rows || "…") : (b.route || "");

function layout() {
  const placed = snap.boards.filter((b) => b.x !== undefined);
  let x = 0, y = 0;
  if (placed.length) y = Math.max(...placed.map((b) => b.y + heightOf(b))) + 160;
  const at = {};
  for (const b of snap.boards) {
    if (b.x !== undefined) { at[b.id] = { x: b.x, y: b.y }; continue; }
    at[b.id] = { x, y };
    x += b.width + 120;
  }
  return at;
}

function place() {
  if (!snap) return;
  const at = layout();
  for (const b of snap.boards) {
    const node = boards.get(b.id);
    if (!node) continue;
    node.el.style.left = at[b.id].x + "px";
    node.el.style.top = at[b.id].y + "px";
    node.sheet.style.width = b.width + "px";
    node.sheet.style.height = heightOf(b) + "px";
    node.frame.style.width = b.width + "px";
    node.frame.style.height = heightOf(b) + "px";
    // Labels stay readable at any zoom.
    node.label.style.transform = "scale(" + (1 / scale) + ")";
  }
  drawArrows(at);
  // Until someone moves the view, it keeps the whole design in sight as pages report their heights.
  if (!moved) fit();
  applyView();
}

function drawArrows(at) {
  const svg = $("#arrows");
  svg.innerHTML = "";
  for (const l of snap.links) {
    const a = snap.boards.find((b) => b.id === l.from), b = snap.boards.find((x) => x.id === l.to);
    if (!a || !b) continue;
    const x1 = at[a.id].x + a.width, y1 = at[a.id].y + Math.min(heightOf(a), 400) / 2;
    const x2 = at[b.id].x, y2 = at[b.id].y + Math.min(heightOf(b), 400) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const mid = (x1 + x2) / 2;
    path.setAttribute("d", "M" + x1 + " " + y1 + " C" + mid + " " + y1 + " " + mid + " " + y2 + " " + x2 + " " + y2);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#a3a29e");
    path.setAttribute("stroke-width", String(1.5 / scale));
    path.setAttribute("marker-end", "url(#head)");
    svg.appendChild(path);
  }
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = '<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#a3a29e"/></marker>';
  svg.appendChild(defs);
}

function applyView() {
  $("#world").style.transform = "translate(" + panX + "px," + panY + "px) scale(" + scale + ")";
  $("#zoom .pct").textContent = Math.round(scale * 100) + "%";
  for (const n of boards.values()) n.label.style.transform = "scale(" + (1 / scale) + ")";
  for (const p of $("#arrows").querySelectorAll("path[marker-end]")) p.setAttribute("stroke-width", String(1.5 / scale));
}

function bounds() {
  const at = layout();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of snap.boards) {
    x0 = Math.min(x0, at[b.id].x); y0 = Math.min(y0, at[b.id].y - 40);
    x1 = Math.max(x1, at[b.id].x + b.width); y1 = Math.max(y1, at[b.id].y + heightOf(b));
  }
  return { x0, y0, x1, y1 };
}

function fit() {
  if (!snap || !snap.boards.length) return;
  const c = $("#canvas").getBoundingClientRect(), r = bounds();
  if (c.width < 200 || c.height < 200) return;
  scale = Math.max(0.05, Math.min(1, (c.width - 120) / (r.x1 - r.x0), (c.height - 120) / (r.y1 - r.y0)));
  panX = (c.width - (r.x1 - r.x0) * scale) / 2 - r.x0 * scale;
  panY = Math.max(60, (c.height - (r.y1 - r.y0) * scale) / 2) - r.y0 * scale;
  applyView();
}

function zoomAt(factor, cx, cy) {
  moved = true;
  const next = Math.min(2, Math.max(0.05, scale * factor));
  panX = cx - (cx - panX) * (next / scale);
  panY = cy - (cy - panY) * (next / scale);
  scale = next;
  applyView();
}

function focusBoard(id) {
  moved = true;
  const b = snap.boards.find((x) => x.id === id);
  if (!b) return;
  const c = $("#canvas").getBoundingClientRect(), at = layout()[id];
  panX = c.width / 2 - (at.x + b.width / 2) * scale;
  panY = 80 - at.y * scale;
  applyView();
}

function rail() {
  const r = $("#rail");
  r.innerHTML = "";
  const mark = el("div", "mark");
  mark.innerHTML = ${JSON.stringify(WORDMARK)};
  r.appendChild(mark);
  const recent = (id) => Date.now() - (changedAt[id] || 0) < 10000;
  const section = (title, items, icon, empty) => {
    if (!items.length && !empty) return;
    r.appendChild(el("h2", "", title));
    if (!items.length) { r.appendChild(el("p", "none", empty)); return; }
    for (const it of items) {
      const row = el("div", "item");
      const i = el("span"); i.innerHTML = icon; row.appendChild(i);
      row.appendChild(el("span", "name", it.name));
      if (it.id && recent(it.id)) row.appendChild(el("span", "dot"));
      row.appendChild(el("span", "meta", it.meta));
      row.onclick = it.go;
      r.appendChild(row);
    }
  };
  const pages = snap.boards.filter((b) => !b.terminal), screens = snap.boards.filter((b) => b.terminal);
  section("PAGES", pages.map((b) => ({ id: b.id, name: b.state ? b.name + " · " + b.state : b.name, meta: meta(b), go: () => focusBoard(b.id) })), ${JSON.stringify(ICON.page)}, screens.length ? undefined : "None yet");
  section("TERMINAL", screens.map((b) => ({ id: b.id, name: b.name, meta: meta(b), go: () => focusBoard(b.id) })), ${JSON.stringify(ICON.terminal)});
  section("FLOWS", snap.flows.map((f) => ({ name: f.name, meta: f.pages.length + " step" + (f.pages.length === 1 ? "" : "s"), go: () => focusBoard(f.pages[0]) })), ${JSON.stringify(ICON.flow)});
  const note = el("div", "note");
  note.appendChild(el("b", "", "View only"));
  note.appendChild(el("p", "", "Ask your agent to change the design. It edits this file, and the canvas follows."));
  note.appendChild(el("code", "", "buni skill · buni mcp"));
  r.appendChild(note);
}

function liveLine() {
  const pill = $(".pill"), ago = $(".ago");
  const recent = snap.boards.filter((b) => Date.now() - (changedAt[b.id] || 0) < 10000);
  pill.className = "pill" + (snap.error ? " bad" : recent.length ? " on" : "");
  pill.lastChild.textContent = snap.error ? "Can't read the file: " + snap.error.split("\n")[0].slice(0, 80)
    : recent.length ? recent.map((b) => b.name).join(", ") + " changed" : snap.boards.length ? "Watching for changes" : "Waiting for an agent";
  const s = Math.round((Date.now() - lastUpdate) / 1000);
  ago.textContent = "updated " + (s < 5 ? "just now" : s < 60 ? s + "s ago" : Math.round(s / 60) + "m ago");
  for (const [id, n] of boards) {
    const on = Date.now() - (changedAt[id] || 0) < 10000;
    n.el.classList.toggle("changed", on);
    n.badge.style.display = on ? "" : "none";
  }
}

function render(s) {
  snap = s;
  $("#file b").textContent = s.name;
  $("#file span").textContent = s.folder;
  document.title = s.name + " · buni";
  $("#empty").classList.toggle("on", !s.boards.length);
  $("#zoom").style.display = s.boards.length ? "" : "none";
  const world = $("#world");
  for (const [id, n] of boards) if (!s.boards.some((b) => b.id === id)) { n.el.remove(); boards.delete(id); }
  for (const b of s.boards) {
    let n = boards.get(b.id);
    if (!n) {
      const e = el("div", "board"), label = el("div", "label"), sheet = el("div", "sheet"), frame = el("iframe");
      frame.setAttribute("sandbox", SANDBOX);
      frame.setAttribute("tabindex", "-1");
      measure(b.id, frame);
      label.appendChild(el("b")); label.appendChild(el("span"));
      const badge = el("em", "", "changed"); label.appendChild(badge);
      sheet.appendChild(frame); e.appendChild(label); e.appendChild(sheet); world.appendChild(e);
      e.onclick = () => openPage(b.id);
      n = { el: e, label, sheet, frame, badge, html: "" };
      boards.set(b.id, n);
    }
    n.label.children[0].textContent = b.state ? b.name + " · " + b.state : b.name;
    n.label.children[1].textContent = meta(b);
    if (n.html !== b.html) {
      n.html = b.html;
      n.frame.srcdoc = withBase(b.html);
      if (!first) changedAt[b.id] = Date.now();
    }
  }
  if (!first) lastUpdate = Date.now();
  rail();
  place();
  liveLine();
  if (open) openPage(open);
  first = false;
}

function openPage(id) {
  const b = snap.boards.find((x) => x.id === id);
  const view = $("#page");
  if (!b) { closePage(); return; }
  open = id;
  view.innerHTML = "";
  const bar = el("div", "bar"), back = el("button", "back");
  back.innerHTML = ${JSON.stringify(ICON.back)};
  back.appendChild(document.createTextNode("All pages"));
  back.onclick = closePage;
  const fitTo = Math.min(1, (view.getBoundingClientRect().width || innerWidth - 300) / b.width);
  const title = el("div", "title");
  title.appendChild(el("b", "", b.name));
  title.appendChild(el("span", "", meta(b) + " · " + b.width + " wide · " + Math.round(fitTo * 100) + "%"));
  bar.appendChild(back); bar.appendChild(title); bar.appendChild(el("div", "spacer"));
  const sheet = el("div", "sheet"), frame = el("iframe");
  frame.setAttribute("sandbox", SANDBOX);
  frame.srcdoc = withBase(b.html);
  frame.style.width = b.width + "px";
  frame.style.height = heightOf(b) + "px";
  frame.style.transform = "scale(" + fitTo + ")";
  frame.style.transformOrigin = "0 0";
  sheet.style.width = b.width * fitTo + "px";
  sheet.style.height = heightOf(b) * fitTo + "px";
  sheet.appendChild(frame);
  view.appendChild(bar); view.appendChild(sheet);
  view.classList.add("on");
}

function closePage() { open = null; $("#page").classList.remove("on"); }

// The sidebar folds away for more canvas, and stays the way it was left.
function setRail(shown) {
  $("#app").classList.toggle("collapsed", !shown);
  try { localStorage.setItem("buni.rail", shown ? "shown" : "hidden"); } catch {}
  if (!moved) fit();
  if (open) openPage(open);
}
try { if (localStorage.getItem("buni.rail") === "hidden") $("#app").classList.add("collapsed"); } catch {}
$("#toggle").onclick = () => setRail($("#app").classList.contains("collapsed"));
addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePage();
  if (e.key === "[" && !e.metaKey && !e.ctrlKey && !e.altKey) setRail($("#app").classList.contains("collapsed"));
});

const canvas = $("#canvas");
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  else { moved = true; panX -= e.deltaX; panY -= e.deltaY; applyView(); }
}, { passive: false });
let drag = null;
canvas.addEventListener("pointerdown", (e) => { if (e.target.closest(".board, #zoom")) return; drag = { x: e.clientX, y: e.clientY }; canvas.classList.add("panning"); });
addEventListener("pointermove", (e) => { if (!drag) return; moved = true; panX += e.clientX - drag.x; panY += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; applyView(); });
addEventListener("pointerup", () => { drag = null; canvas.classList.remove("panning"); });
$("#minus").onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(1 / 1.25, r.width / 2, r.height / 2); };
$("#plus").onclick = () => { const r = canvas.getBoundingClientRect(); zoomAt(1.25, r.width / 2, r.height / 2); };
$("#fit").onclick = () => { moved = false; fit(); };
addEventListener("resize", () => { if (!moved) fit(); });
// The "changed" marks fade after ten seconds, in the rail too (redrawn only then, so it keeps its scroll).
let railMarks = "";
setInterval(() => {
  if (!snap) return;
  liveLine();
  const marks = snap.boards.filter((b) => Date.now() - (changedAt[b.id] || 0) < 10000).map((b) => b.id).join();
  if (marks !== railMarks) { railMarks = marks; rail(); }
}, 1000);

fetch("/design").then((r) => r.json()).then(render);
const events = new EventSource("/events");
events.onmessage = (e) => render(JSON.parse(e.data));
`;

/** The viewer's page. */
export function viewerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>buni</title><style>${CSS}</style></head>
<body>
<div id="app">
  <aside id="rail"></aside>
  <main>
    <header>
      <div class="file"><button id="toggle" aria-label="Show or hide the sidebar" title="Sidebar  [">${ICON.panel}</button><span id="file"><b></b> <span></span></span></div>
      <div class="live"><span class="pill"><i></i><span></span></span><span class="ago"></span></div>
    </header>
    <div id="canvas">
      <div id="world"><svg id="arrows" width="1" height="1"></svg></div>
      <div id="zoom"><button id="minus" aria-label="Zoom out">−</button><span class="pct"></span><button id="plus" aria-label="Zoom in">+</button><hr><button id="fit">Fit</button></div>
    </div>
    <div id="empty"><div class="start">
      <h1>Nothing designed yet</h1>
      <p>Ask your coding agent to design in this file. It works through buni's tools, and every page it makes appears here as it goes.</p>
      <div class="cmds"><div>buni skill<span>teach a shell agent buni</span></div><div>buni mcp &lt;file&gt;<span>or serve the tools over MCP</span></div></div>
      <small>Try: “Design a landing page and a pricing page for a bike shop.”</small>
    </div></div>
    <div id="page"></div>
  </main>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
