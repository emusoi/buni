// The page buni open shows: the design's pages on a canvas, the system behind them view by view, a rail to find
// them, and one page or one thing at a time when asked.
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
#sys { position: absolute; inset: 48px 0 0 0; display: none; }
#sys.on { display: flex; }
#sys .sysbody { position: relative; flex: 1; min-width: 0; overflow: auto; }
#sys .sysbody.canvas { overflow: hidden; }
.pan { position: absolute; inset: 0; overflow: hidden; cursor: grab; background-image: radial-gradient(circle, rgba(55,53,47,0.14) 1px, transparent 1px); background-size: 20px 20px; }
.pan.panning { cursor: grabbing; }
.pan .world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.syszoom { position: absolute; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: var(--r-menu); background: var(--bar); box-shadow: var(--shadow-pop); z-index: 2; }
.syszoom button { border: 0; background: none; padding: 6px 8px; border-radius: var(--r-sm); font: 12px var(--font); color: var(--ink-2); cursor: pointer; }
.syszoom button:hover { background: var(--selected); }
.syszoom .pct { font: 12px var(--mono); color: var(--ink-2); padding: 0 4px; min-width: 44px; text-align: center; }
.legend { position: absolute; right: 16px; bottom: 16px; display: flex; gap: 14px; padding: 6px 12px; border-radius: var(--r-menu); background: var(--bar); box-shadow: var(--shadow-card); font-size: 12px; color: var(--ink-2); z-index: 2; }
.legend span { display: flex; align-items: center; gap: 6px; }
.legend i { width: 18px; border-top: 1.5px solid #a3a29e; }
.legend i.dash { border-top-style: dashed; }
.kind { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.kind svg { flex-shrink: 0; }
.colhead { position: absolute; top: 0; margin: 0; white-space: nowrap; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--ink-3); }
.part { position: absolute; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; overflow: hidden; }
.part .ptop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.part .tech { font: 11px var(--mono); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.part b { font-size: 14px; margin-top: 2px; }
.part p { margin: 0; font-size: 12px; line-height: 16px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
[data-ref].sel { box-shadow: 0 0 0 2px var(--ink), var(--shadow-card) !important; }
[data-ref].changed { box-shadow: 0 0 0 2px var(--live), var(--shadow-card); }
.links { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.links path { fill: none; stroke: #cfcecb; stroke-width: 1.25; marker-end: url(#m-off); }
.links .async path { stroke-dasharray: 5 4; }
.links text { display: none; font: 600 10px var(--font); fill: var(--ink); paint-order: stroke; stroke: var(--canvas); stroke-width: 4px; text-anchor: middle; }
.links .on path { stroke: var(--ink); stroke-width: 1.75; marker-end: url(#m-on); }
.links .on text { display: block; }
.links.none path { stroke: #a3a29e; }
#drawer { display: none; flex-direction: column; width: 340px; flex-shrink: 0; overflow-y: auto; background: var(--page); border-left: 1px solid var(--divider); }
#drawer.on { display: flex; }
.dhead { display: flex; flex-direction: column; gap: 4px; padding: 16px 18px 14px; }
.dtop { display: flex; align-items: center; justify-content: space-between; }
.dclose { display: flex; border: 0; background: none; padding: 2px; color: var(--ink-3); cursor: pointer; border-radius: var(--r-sm); }
.dclose:hover { background: var(--selected); }
.dhead h3 { margin: 4px 0 0; font-size: 17px; font-weight: 600; }
.dhead .sub { margin: 0; font: 12px var(--mono); color: var(--ink-3); }
.dhead .about { margin: 6px 0 0; font-size: 13px; line-height: 19px; color: var(--ink-2); }
.dsec { display: flex; flex-direction: column; gap: 4px; padding: 14px 18px; border-top: 1px solid var(--divider); }
.dsec h4 { margin: 0 0 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
.dsec h4 span { font-weight: 500; }
.drow { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 13px; }
.drow.go { cursor: pointer; }
.drow.go:hover .l { text-decoration: underline; }
.drow .l { flex: 1; min-width: 0; }
.drow .r { font-size: 12px; color: var(--ink-2); text-align: right; }
.drow svg { color: var(--ink-3); flex-shrink: 0; }
.drow code, .dsec code { font: 12px var(--mono); }
.dnote { margin: 0; font-size: 12px; line-height: 18px; color: var(--ink-2); }
.dsec > .dnote:first-of-type:last-child { font-size: 13px; color: var(--ink); }
.m-GET, .m-query { color: #448361; } .m-POST, .m-mutation { color: #3346d3; } .m-PUT, .m-PATCH { color: #b45309; } .m-DELETE { color: #b42318; } .m-subscription { color: #7c3aed; }
.item.on { background: var(--selected); }
.item.on .name { font-weight: 600; }
.item.sub { padding-left: 30px; }
.item.sub .name { font-size: 13px; }

.cworld .crowtitle { position: absolute; margin: 0; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); white-space: nowrap; transform: scale(var(--inv, 1)); transform-origin: 0 100%; }
.cboard { position: absolute; cursor: pointer; box-shadow: none !important; }
.cboard .clabel { position: absolute; left: 0; bottom: 100%; display: flex; align-items: baseline; gap: 8px; max-width: calc(var(--bw, 1280) * 1px / var(--inv, 1)); overflow: hidden; padding-bottom: 6px; white-space: nowrap; transform: scale(var(--inv, 1)); transform-origin: 0 100%; }
.cboard .clabel b, .cboard .clabel span { overflow: hidden; text-overflow: ellipsis; }
.cboard .clabel b { flex-shrink: 1; min-width: 0; }
.cboard .clabel b { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.cboard .clabel span { font-size: 11px; color: var(--ink-3); }
.cboard .csheet { background: var(--page); box-shadow: var(--shadow-card); overflow: hidden; }
.cboard .csheet iframe { display: block; border: 0; pointer-events: none; width: 1280px; height: 200px; }
.cboard.copy .csheet { outline: calc(1.5px * var(--inv, 1)) dashed #b45309; outline-offset: calc(4px * var(--inv, 1)); }
.cboard.sel .csheet { box-shadow: 0 0 0 calc(2px * var(--inv, 1)) var(--ink), var(--shadow-card); }
.cboard.changed .csheet { box-shadow: 0 0 0 calc(2px * var(--inv, 1)) var(--live), var(--shadow-card); }

.comps { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.comp { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.cname { display: flex; flex-direction: column; gap: 2px; }
.cname span { font-size: 11px; color: var(--ink-3); }
.cname b { font-size: 14px; }
.cname small { font-size: 12px; color: var(--ink-2); }
.tags.left { justify-content: flex-start; }
.cprev { position: relative; height: 120px; overflow: hidden; border-radius: 8px; background: var(--rail); box-shadow: inset 0 0 0 1px var(--divider); }
.cprev.big { height: 170px; }
.cprev iframe { position: absolute; left: 0; top: 0; width: 1280px; height: 800px; border: 0; transform-origin: 0 0; pointer-events: none; visibility: hidden; }
.dprev { padding: 0 18px 14px; }
.repeat { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.repeat .rmain { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.repeat b { font-size: 13px; }
.repeat small { font-size: 12px; color: var(--ink-2); }
.repeat code { padding: 4px 10px; border-radius: 6px; background: var(--rail); font: 11px var(--mono); color: var(--ink-2); white-space: nowrap; }
pre.ask { margin: 0; padding: 10px 12px; border-radius: 8px; background: var(--rail); font: 11px/17px var(--mono); white-space: pre-wrap; word-break: break-all; user-select: all; }
.use-box { position: absolute; z-index: 4; pointer-events: none; border: calc(2px * var(--inv)) solid #9c36b5; background: rgba(156, 54, 181, 0.06); }
.board .label { max-width: var(--lw, none); overflow: hidden; }
.board .label b, .board .label span { overflow: hidden; text-overflow: ellipsis; }
.board .label b { flex-shrink: 1; min-width: 0; }

.agent { --c: #37352f; position: absolute; left: 0; top: 0; z-index: 5; pointer-events: none; transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1), width 0.5s cubic-bezier(0.25, 1, 0.5, 1), height 0.5s cubic-bezier(0.25, 1, 0.5, 1), opacity 0.4s; }
.agent .abox { position: absolute; inset: 0; border: calc(1.5px * var(--inv)) solid var(--c); }
.agent .h { position: absolute; width: calc(6px * var(--inv)); height: calc(6px * var(--inv)); background: #fff; border: calc(1.5px * var(--inv)) solid var(--c); box-sizing: border-box; transform: translate(-50%, -50%); }
.agent .h.tl { left: 0; top: 0; } .agent .h.tr { left: 100%; top: 0; } .agent .h.bl { left: 0; top: 100%; } .agent .h.br { left: 100%; top: 100%; }
.agent:not(.working) .abox, .agent:not(.working) .h { display: none; }
.agent.idle { opacity: 0.6; }
.agent .apin { position: absolute; left: 0; bottom: 100%; display: flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px 0 4px; margin-bottom: calc(3px * var(--inv)); border-radius: 4px 4px 4px 0; background: var(--c); color: #fff; font-size: 11px; font-weight: 600; white-space: nowrap; transform: scale(var(--inv)); transform-origin: 0 100%; }
.agent.below .apin { bottom: auto; top: 100%; margin: calc(3px * var(--inv)) 0 0; border-radius: 0 4px 4px 4px; transform-origin: 0 0; }
.agent .apin svg { width: 16px; height: 16px; flex-shrink: 0; overflow: visible; }
.agent .apin i { font-style: normal; font-weight: 500; opacity: 0.85; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
.agent .smile { display: none; }
.agent.done .smile { display: inline; }
.agent.done .open { display: none; }
.agent .eye, .agent .apin svg { transform-box: fill-box; transform-origin: center; }
@media (prefers-reduced-motion: no-preference) {
  .agent.working .abox { animation: abreathe 2.6s ease-in-out infinite; }
  .agent .eye { animation: ablink 4s ease-in-out infinite; }
  .agent.done .apin svg { animation: abounce 0.9s ease-in-out 1; }
}
@keyframes abreathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes ablink { 0%, 86%, 92%, 100% { transform: scaleY(1); } 89% { transform: scaleY(0.12); } }
@keyframes abounce { 0%, 100% { transform: translateY(0); } 40% { transform: translateY(-3px); } }

.sheetview { display: flex; flex-direction: column; gap: 26px; padding: 28px 32px 48px; max-width: 1100px; }
.vhead { display: flex; align-items: baseline; gap: 10px; }
.vhead h1 { margin: 0; font-size: 20px; font-weight: 600; }
.vhead > span { font-size: 13px; color: var(--ink-3); }
.group { display: flex; flex-direction: column; gap: 8px; }
.ghead { display: flex; align-items: baseline; gap: 10px; }
.ghead b { font-size: 15px; }
.ghead code { font: 12px var(--mono); color: var(--ink-3); }
.call { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.verb { font: 700 12px var(--mono); width: 96px; flex-shrink: 0; text-transform: uppercase; }
.dtop .verb { width: auto; }
.cmain { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.cmain code { font: 600 13px var(--mono); }
.cmain span { font-size: 12px; color: var(--ink-2); }
.tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.tag { padding: 2px 8px; border-radius: 99px; background: var(--chip); font-size: 11px; color: var(--ink-2); white-space: nowrap; }
.tag.amber { background: #fdf3e7; color: #b45309; }
.tag.violet { background: #f3eefe; color: #7c3aed; }
.tag.red { background: #fdeeee; color: #b42318; }
.field { display: flex; gap: 8px; padding: 2px 0; font: 12px var(--mono); }
.field code { flex: 1; }
.field span { color: var(--ink-2); }
.store { position: absolute; border: 1.5px dashed rgba(194,65,12,0.35); border-radius: 14px; cursor: pointer; }
.store .slabel { position: absolute; left: 14px; top: -11px; display: flex; align-items: center; gap: 8px; padding: 0 6px; background: var(--canvas); white-space: nowrap; }
.store .slabel b { font-size: 13px; }
.store .slabel code { font: 11px var(--mono); color: var(--ink-3); }
.table { position: absolute; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); overflow: hidden; cursor: pointer; }
.thead { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; color: #c2410c; }
.thead b { font: 600 13px var(--mono); color: var(--ink); }
.col { display: flex; align-items: center; gap: 8px; height: 29px; padding: 0 12px; border-top: 1px solid var(--divider); font: 12px var(--mono); }
.col code { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col span { color: var(--ink-2); }
.col i, .shead i { font: normal 700 10px var(--font); letter-spacing: 0.04em; color: var(--ink-3); }
.col i.pk { color: #c2410c; } .col i.fk { color: #3346d3; }
.keys { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.keys path { fill: none; stroke: #3346d3; stroke-width: 1.5; marker-end: url(#m-key); }
.shape { position: absolute; display: flex; flex-direction: column; gap: 3px; width: 180px; padding: 10px 12px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.shead { display: flex; justify-content: space-between; }
.shead b { font-size: 13px; }
.shape code { font: 11px var(--mono); color: var(--ink-2); }

.trace { display: flex; flex-direction: column; gap: 14px; }
.thead2 { display: flex; align-items: center; gap: 12px; cursor: pointer; padding: 4px 6px; margin: -4px -6px; border-radius: var(--r-sm); }
.thead2 h2 { margin: 0; font-size: 18px; font-weight: 600; }
.thead2 .from { display: flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 99px; background: var(--page); box-shadow: var(--shadow-card); font-size: 12px; cursor: pointer; }
.thead2 .grow { flex: 1; }
.thead2 .total { font-size: 13px; color: var(--ink-2); }
.thead2 .total b { color: var(--ink); }
.seq { position: relative; flex-shrink: 0; }
.steps { position: absolute; left: 0; top: 0; overflow: visible; }
.steps .life { stroke: #cfcecb; stroke-width: 1.25; stroke-dasharray: 3 4; }
.steps .step path { fill: none; stroke: var(--ink); stroke-width: 1.5; marker-end: url(#m-step); }
.steps .step.async path { stroke-dasharray: 5 4; }
.steps .step circle { fill: var(--ink); }
.lane { position: absolute; top: 0; width: 128px; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 0; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; text-align: center; }
.lane b { font-size: 13px; }
.slabel2 { position: absolute; display: flex; flex-direction: column; padding: 2px 6px; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.slabel2 code { font: 600 12px var(--mono); }
.slabel2 code i { font-style: normal; color: var(--ink-3); }
.slabel2 span { font-size: 11px; color: var(--ink-2); }
.slabel2.sel { background: var(--page); }
.fails { position: absolute; width: 240px; padding: 6px 10px; border-radius: 8px; background: #fdeeee; color: #b42318; font-size: 12px; line-height: 16px; }
.dlabel { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--ink-3); }
.erow { display: flex; align-items: center; gap: 4px; }
.ecol { display: flex; flex-direction: column; gap: 6px; }
.elabel { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; color: var(--ink-3); }
.flowarrow { display: flex; align-items: center; flex: 1; min-width: 40px; margin-top: 18px; color: #a3a29e; }
.flowarrow i { flex: 1; border-top: 1.5px dashed #a3a29e; }
.who { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 190px; padding: 10px 12px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.who b { font-size: 13px; }
.who code { font: 11px var(--mono); color: var(--ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.event { display: flex; flex-direction: column; gap: 4px; width: 240px; padding: 10px 12px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.event div { display: flex; align-items: center; gap: 6px; color: #7c3aed; }
.event code { font: 600 13px var(--mono); color: var(--ink); }
.event span { font: 11px var(--mono); color: var(--ink-2); }

.warn { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 10px; background: #fdf3e7; color: #92400e; font-size: 12px; }
.warn svg { color: #b45309; flex-shrink: 0; }
.clusters { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 14px; }
.cluster { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1.5px dashed rgba(55,53,47,0.2); border-radius: 12px; }
.chead { display: flex; align-items: baseline; gap: 8px; }
.chead b { font-size: 13px; }
.chead code { font: 11px var(--mono); color: var(--ink-3); }
.cards { display: flex; flex-wrap: wrap; gap: 10px; max-width: 640px; }
.placed { display: flex; flex-direction: column; gap: 3px; width: 200px; padding: 10px 12px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.placed .ptop { display: flex; justify-content: space-between; gap: 6px; }
.placed .tech { font-size: 11px; color: var(--ink-3); }
.placed b { font-size: 13px; }
.placed code { font: 11px var(--mono); color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ghead .goal { font-size: 13px; color: var(--ink-2); }
.req { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.rtitle { flex: 1; font-size: 14px; }
.rwarn { font-size: 11px; color: #b45309; white-space: nowrap; }
.pri { padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.pri.must { background: #fdeeee; color: #b42318; } .pri.should { background: #fdf3e7; color: #b45309; } .pri.could { background: var(--chip); color: var(--ink-2); }
.chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; background: var(--chip); font-size: 11px; white-space: nowrap; cursor: pointer; }
.chip:hover { background: #e3e3df; }
.question { display: flex; flex-direction: column; gap: 8px; padding: 14px; border-radius: 10px; background: var(--page); box-shadow: var(--shadow-card); cursor: pointer; }
.question.decided { opacity: 0.75; }
.question p { margin: 0; font-size: 15px; font-weight: 600; }
.qtop, .qfoot { display: flex; align-items: center; gap: 10px; }
.qtop .grow { flex: 1; }
.qby, .qfoot > span { font-size: 12px; color: var(--ink-3); }
.qfoot { justify-content: space-between; }
.qkind { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; }
.qkind.q { color: #7c3aed; } .qkind.a { color: #b45309; }
.opts { display: flex; gap: 10px; }
.opt { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 8px; box-shadow: 0 0 0 1px var(--divider); }
.opt.chosen { box-shadow: 0 0 0 2px var(--live); }
.opt b { font-size: 13px; }
.pro { font-size: 12px; color: var(--live); } .con { font-size: 12px; color: #b42318; }
.vhead.sub { margin-top: 10px; }
.vhead h2 { margin: 0; font-size: 16px; font-weight: 600; }
.decision { display: flex; flex-direction: column; gap: 2px; padding: 2px 0 2px 12px; border-left: 2px solid var(--divider); }
.decision span { font-size: 14px; }
.decision small { font-size: 12px; color: var(--ink-3); }
.docview { display: flex; justify-content: center; padding: 40px 32px 64px; }
.docview article { display: flex; flex-direction: column; gap: 22px; width: 640px; max-width: 100%; }
.docview h1 { margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
.docview .dmeta { margin-top: -14px; font-size: 13px; color: var(--ink-2); }
.docview h2 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
.docview p { margin: 0 0 10px; font-size: 15px; line-height: 25px; }
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
    // Labels stay readable at any zoom, and never wider than their board, so neighbours don't run into each other.
    node.label.style.transform = "scale(" + (1 / scale) + ")";
    node.label.style.setProperty("--lw", b.width * scale + "px");
  }
  drawArrows(at);
  // Until someone moves the view, it keeps the whole design in sight as pages report their heights.
  if (!moved) fit();
  applyView();
  drawAgents();
  if (outlined) outlineUses(outlined);
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
  for (const [id, n] of boards) {
    n.label.style.transform = "scale(" + (1 / scale) + ")";
    const b = snap && snap.boards.find((x) => x.id === id);
    if (b) n.label.style.setProperty("--lw", b.width * scale + "px");
  }
  for (const box of document.querySelectorAll(".use-box")) box.style.setProperty("--inv", String(1 / scale));
  for (const p of $("#arrows").querySelectorAll("path[marker-end]")) p.setAttribute("stroke-width", String(1.5 / scale));
  drawAgents();
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

// Where the person is: the pages' canvas ("#/"), one page ("#/page/ID"), or a system view, maybe with one thing
// open in the drawer ("#/map/part:api"). The address can be shared, so an agent can point at a view.
function current() {
  const [, view, ...rest] = decodeURIComponent(location.hash.replace(/^#/, "")).split("/");
  return { view: view || "", ref: rest.join("/") };
}
const refPath = (ref) => encodeURIComponent(ref).replace(/%3A/g, ":");
function go(ref) {
  if (ref.startsWith("uses:")) { location.hash = "#/uses/" + encodeURIComponent(ref.slice(5)); return; }
  if (ref.startsWith("page:")) { location.hash = "#/page/" + encodeURIComponent(ref.slice(5)); return; }
  const view = snap.system.where[ref];
  if (view) location.hash = "#/" + view + "/" + refPath(ref);
}
const recentRef = (ref) => Date.now() - (changedAt[ref] || 0) < 10000;

function rail() {
  const r = $("#rail"), here = current();
  const top = r.scrollTop;
  r.innerHTML = "";
  const mark = el("div", "mark");
  mark.innerHTML = ${JSON.stringify(WORDMARK)};
  r.appendChild(mark);
  const row = (icon, name, meta, opts) => {
    const e = el("div", "item" + (opts.on ? " on" : "") + (opts.sub ? " sub" : ""));
    if (icon) { const i = el("span"); i.innerHTML = icon; e.appendChild(i); }
    e.appendChild(el("span", "name", name));
    if (opts.dot) e.appendChild(el("span", "dot"));
    e.appendChild(el("span", "meta", meta));
    e.onclick = opts.go;
    r.appendChild(e);
  };
  const onScreens = here.view === "" || here.view === "page" || here.view === "uses";
  const pages = snap.boards.filter((b) => !b.terminal), screens = snap.boards.filter((b) => b.terminal);
  const boardRows = (list) => { if (onScreens) for (const b of list) row("", b.state ? b.name + " · " + b.state : b.name, meta(b), { sub: true, on: here.ref === b.id, dot: recentRef(b.id), go: () => { location.hash = "#/"; focusBoard(b.id); } }); };
  r.appendChild(el("h2", "", "SCREENS"));
  row(${JSON.stringify(ICON.page)}, "Pages", String(pages.length), { on: onScreens && !screens.length, dot: !onScreens && pages.some((b) => recentRef(b.id)), go: () => { location.hash = "#/"; } });
  boardRows(pages);
  if (screens.length) { row(${JSON.stringify(ICON.terminal)}, "Terminal", String(screens.length), { go: () => { location.hash = "#/"; focusBoard(screens[0].id); } }); boardRows(screens); }
  if (snap.flows.length) {
    row(${JSON.stringify(ICON.flow)}, "Flows", String(snap.flows.length), { go: () => { location.hash = "#/"; focusBoard(snap.flows[0].pages[0]); } });
    if (onScreens) for (const f of snap.flows) row("", f.name, f.pages.length + " step" + (f.pages.length === 1 ? "" : "s"), { sub: true, go: () => focusBoard(f.pages[0]) });
  }
  for (const v of snap.system.views.filter((x) => x.group === "screens")) {
    row(v.icon, v.name, String(v.count), { on: here.view === v.id, go: () => { location.hash = "#/" + v.id; } });
  }
  for (const [group, title] of [["system", "SYSTEM"], ["plan", "PLAN"]]) {
    const views = snap.system.views.filter((v) => v.group === group);
    if (!views.length) continue;
    r.appendChild(el("h2", "", title));
    for (const v of views) {
      const dot = Object.keys(changedAt).some((ref) => snap.system.where[ref] === v.id && recentRef(ref));
      row(v.icon, v.name, String(v.count), { on: here.view === v.id, dot, go: () => { location.hash = "#/" + v.id; } });
    }
  }
  const note = el("div", "note");
  note.appendChild(el("b", "", "View only"));
  note.appendChild(el("p", "", "Ask your agent to change the design. It edits this file, and the views follow."));
  note.appendChild(el("code", "", "buni skill · buni mcp"));
  r.appendChild(note);
  r.scrollTop = top;
}


// Agents at work: one face per agent, on the layer or the system thing it last changed. It works while edits keep
// coming, smiles when they stop, and fades after a quiet minute. buni call and buni mcp share who did what (the
// file's .activity), so the faces follow agents whichever way they edit.
const FACE = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect x="120" y="120" width="272" height="272" fill="none" stroke="currentColor" stroke-width="40"/><rect x="78" y="78" width="84" height="84" fill="currentColor"/><rect x="350" y="78" width="84" height="84" fill="currentColor"/><rect x="78" y="350" width="84" height="84" fill="currentColor"/><rect x="350" y="350" width="84" height="84" fill="currentColor"/><g class="open"><rect class="eye" x="161" y="189" width="62" height="118" rx="31" fill="currentColor"/><rect class="eye" x="289" y="189" width="62" height="118" rx="31" fill="currentColor"/></g><path class="smile" d="M153 267A38 38 0 0 1 231 267M281 267A38 38 0 0 1 359 267" fill="none" stroke="currentColor" stroke-width="34" stroke-linecap="round"/></svg>';
/** One colour per agent, the same every time for the same name. */
const AGENT_COLORS = ["#d9480f", "#3346d3", "#2b8a3e", "#9c36b5", "#0b7285", "#c2255c"];
const KNOWN_AGENTS = { claude: "#d9480f", codex: "#3346d3", gemini: "#2b8a3e" };
const colorOf = (name) => KNOWN_AGENTS[name.toLowerCase()] || AGENT_COLORS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AGENT_COLORS.length];
const faces = new Map();
const moodOf = (a) => { const age = Date.now() - Date.parse(a.at); return age < 6000 ? "working" : age < 10000 ? "done" : age < 90000 ? "idle" : ""; };
function latestEdits() {
  const out = new Map();
  for (const a of snap.activity || []) out.set(a.author, a);
  return out;
}
/** Where an edit sits in what is on screen now: the box to frame, in the coordinates of the layer it is drawn in. */
function spotOf(a) {
  const here = current();
  if (here.view === "page") return null;
  if (here.view !== "" && here.view !== "uses") {
    const body = $("#sys .sysbody");
    const t = a.ref && body.querySelector('[data-ref="' + CSS.escape(a.ref) + '"]');
    if (!t) return null;
    const world = t.closest(".world");
    if (world) return { parent: world, x: t.offsetLeft, y: t.offsetTop, top: t.offsetTop, w: t.offsetWidth, h: t.offsetHeight, inv: 1 / ((pans[shownView] && pans[shownView].scale) || 1) };
    const r = t.getBoundingClientRect(), b = body.getBoundingClientRect();
    return { parent: body, x: r.left - b.left + body.scrollLeft, y: r.top - b.top + body.scrollTop, top: r.top - b.top + body.scrollTop, w: r.width, h: r.height, inv: 1 };
  }
  const b = a.page && snap.boards.find((x) => x.id === a.page), n = b && boards.get(b.id);
  if (!b || !n) return null;
  const at = layout()[b.id];
  const doc = n.frame.contentDocument, t = a.node && doc && doc.querySelector(".b-" + CSS.escape(a.node));
  const r = t ? t.getBoundingClientRect() : { left: 0, top: 0, width: b.width, height: heightOf(b) };
  return { parent: $("#world"), x: at.x + r.left, y: at.y + r.top, top: r.top, w: r.width, h: r.height, inv: 1 / scale };
}
function drawAgents() {
  if (!snap) return;
  const latest = latestEdits();
  for (const [author, f] of faces) if (!latest.has(author)) { f.remove(); faces.delete(author); }
  for (const [author, a] of latest) {
    const mood = moodOf(a), spot = mood && spotOf(a);
    let f = faces.get(author);
    if (!spot) { if (f) f.style.display = "none"; continue; }
    if (!f) {
      f = el("div", "agent");
      f.innerHTML = '<div class="abox"></div><span class="h tl"></span><span class="h tr"></span><span class="h bl"></span><span class="h br"></span><div class="apin">' + FACE + '<b></b><i></i></div>';
      f.style.setProperty("--c", colorOf(author));
      faces.set(author, f);
    }
    if (f.parentElement !== spot.parent) spot.parent.appendChild(f);
    f.style.display = "";
    // At the top of a page or a view there's no room above: the tag hangs below the frame.
    f.className = "agent " + mood + (spot.top < 30 * spot.inv ? " below" : "");
    f.style.transform = "translate(" + spot.x + "px," + spot.y + "px)";
    f.style.width = spot.w + "px";
    f.style.height = spot.h + "px";
    f.style.setProperty("--inv", String(spot.inv));
    f.querySelector("b").textContent = author;
    f.querySelector("i").textContent = mood === "working" ? "· " + a.label : "";
  }
}



/** The components canvas: each board sized to what it draws, in a row per group, then fitted like any canvas. */
function layoutComponents(view, world) {
  const boards = [...world.querySelectorAll(".cboard")];
  // Not drawn yet, or drawing nothing (an empty or hidden component): a small board, so the rest still lay out.
  const size = (b) => {
    const doc = b.querySelector("iframe").contentDocument;
    if (!doc || !doc.body || !doc.body.childElementCount) return { w: 160, h: 48 };
    return { w: Math.min(1280, Math.max(40, doc.body.scrollWidth)), h: Math.min(1200, Math.max(20, doc.body.scrollHeight)) };
  };
  const place = () => {
    if (!world.isConnected) return false;
    const sizes = boards.map(size);
    for (const t of world.querySelectorAll(".crowtitle")) t.remove();
    let y = 0, widest = 0;
    for (const row of world.querySelectorAll(".crow")) {
      const title = el("p", "crowtitle", row.dataset.title);
      title.style.left = "0px"; title.style.top = y + "px";
      world.appendChild(title);
      y += 64;
      let x = 0, tallest = 0;
      for (const b of row.querySelectorAll(".cboard")) {
        const z = sizes[boards.indexOf(b)];
        if (x > 0 && x + z.w > 2600) { x = 0; y += tallest + 90; tallest = 0; }
        b.style.left = x + "px"; b.style.top = y + "px";
        const sheet = b.querySelector(".csheet"), frame = b.querySelector("iframe");
        sheet.style.width = z.w + "px"; sheet.style.height = z.h + "px"; b.style.setProperty("--bw", String(z.w));
        frame.style.width = z.w + "px"; frame.style.height = z.h + "px";
        x += z.w + 96; tallest = Math.max(tallest, z.h); widest = Math.max(widest, x);
      }
      y += tallest + 110;
    }
    world.dataset.w = String(Math.max(400, widest)); world.dataset.h = String(Math.max(300, y));
    const st = pans[view];
    if (st && st.fit) st.fit();
    drawAgents();
    return true;
  };
  // Laid out now, then again as each board draws and its fonts arrive, at most once a frame.
  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; place(); }); };
  for (const b of boards) {
    const frame = b.querySelector("iframe");
    frame.addEventListener("load", () => { soon(); if (frame.contentDocument) frame.contentDocument.fonts.ready.then(soon); });
  }
  place();
}

/** Component previews: each drawn at its own size, then scaled down to fit its card. */
function fitPreviews(root) {
  for (const frame of root.querySelectorAll(".cprev iframe")) {
    const fit = () => {
      const doc = frame.contentDocument, box = frame.parentElement;
      if (!doc || !doc.body || !box) return;
      const w = Math.max(1, doc.body.scrollWidth), h = Math.max(1, doc.body.scrollHeight);
      const k = Math.min(1, (box.clientWidth - 24) / w, (box.clientHeight - 24) / h);
      frame.style.width = w + "px"; frame.style.height = h + "px";
      frame.style.transform = "translate(" + (box.clientWidth - w * k) / 2 + "px," + (box.clientHeight - h * k) / 2 + "px) scale(" + k + ")";
      frame.style.visibility = "visible";
    };
    frame.addEventListener("load", () => { fit(); if (frame.contentDocument) frame.contentDocument.fonts.ready.then(fit); });
    if (frame.contentDocument && frame.contentDocument.readyState === "complete" && frame.contentDocument.body && frame.contentDocument.body.childElementCount) fit();
  }
}

/** "Show on the pages": every use of one component outlined on the canvas. */
let outlined = "";
function outlineUses(id) {
  for (const b of document.querySelectorAll(".use-box")) b.remove();
  outlined = id;
  if (!id) return;
  const at = layout();
  for (const u of (snap.uses && snap.uses[id]) || []) {
    const b = snap.boards.find((x) => x.id === u.page), n = b && boards.get(b.id);
    const doc = n && n.frame.contentDocument, t = doc && doc.querySelector(".b-" + CSS.escape(u.node));
    if (!t) continue;
    const r = t.getBoundingClientRect(), box = el("div", "use-box");
    box.style.left = at[b.id].x + r.left + "px"; box.style.top = at[b.id].y + r.top + "px";
    box.style.width = r.width + "px"; box.style.height = r.height + "px";
    box.style.setProperty("--inv", String(1 / scale));
    $("#world").appendChild(box);
  }
}

// A system view: its HTML from the server, swapped in only when it changed, so a canvas keeps where it was looked at.
const pans = {};
let shownView = "", shownHtml = "";
function showSystem(view, ref) {
  const v = snap.system.views.find((x) => x.id === view);
  const body = $("#sys .sysbody"), drawer = $("#drawer");
  if (!v) { location.hash = "#/"; return; }
  if (shownView !== view || shownHtml !== v.html) {
    shownView = view; shownHtml = v.html;
    body.className = "sysbody" + (v.canvas ? " canvas" : "");
    body.innerHTML = v.html;
    if (v.canvas) panner(view, body.querySelector(".pan"));
    else body.scrollTop = 0;
    const cworld = body.querySelector(".cworld");
    if (cworld) layoutComponents(view, cworld);
    fitPreviews(body);
  }
  for (const e of body.querySelectorAll(".sel")) e.classList.remove("sel");
  const detail = ref && snap.system.details[ref];
  drawer.classList.toggle("on", Boolean(detail));
  if (drawer.dataset.ref !== ref || drawer.innerHTML !== (detail || "")) { drawer.innerHTML = detail || ""; drawer.dataset.ref = ref || ""; fitPreviews(drawer); }
  if (detail) for (const e of body.querySelectorAll('[data-ref="' + CSS.escape(ref) + '"]')) e.classList.add("sel");
  // On the map, the open part's links come forward with their names.
  const part = ref && ref.startsWith("part:") ? ref.slice(5) : "";
  const links = body.querySelector(".links");
  if (links) {
    links.classList.toggle("none", !part);
    for (const g of links.querySelectorAll(".link")) g.classList.toggle("on", Boolean(part) && (g.dataset.a === part || g.dataset.b === part));
  }
  marks();
  drawAgents();
}
/** Outlines what changed in the last ten seconds, wherever it is drawn. */
function marks() {
  for (const e of document.querySelectorAll("#sys [data-ref]")) e.classList.toggle("changed", recentRef(e.dataset.ref) && !e.classList.contains("sel"));
}

/** Pans and zooms one system canvas; each view remembers its own, and fits until it is moved. */
function panner(view, pan) {
  if (!pan) return;
  const world = pan.querySelector(".world");
  const st = pans[view] || (pans[view] = { scale: 1, x: 40, y: 40, moved: false });
  const zoom = el("div", "syszoom");
  zoom.innerHTML = '<button data-z="out" aria-label="Zoom out">−</button><span class="pct"></span><button data-z="in" aria-label="Zoom in">+</button><button data-z="fit">Fit</button>';
  pan.parentElement.appendChild(zoom);
  const apply = () => { world.style.transform = "translate(" + st.x + "px," + st.y + "px) scale(" + st.scale + ")"; world.style.setProperty("--inv", String(1 / st.scale)); zoom.querySelector(".pct").textContent = Math.round(st.scale * 100) + "%"; drawAgents(); };
  const fitView = () => {
    const c = pan.getBoundingClientRect(), w = Number(world.dataset.w) || 800, h = Number(world.dataset.h) || 600;
    if (c.width < 100) return;
    st.scale = Math.max(0.1, Math.min(1, (c.width - 80) / w, (c.height - 120) / h));
    st.x = Math.max(40, (c.width - w * st.scale) / 2); st.y = Math.max(56, (c.height - 40 - h * st.scale) / 2);
    apply();
  };
  const zoomAt = (f, cx, cy) => { st.moved = true; const next = Math.min(2, Math.max(0.1, st.scale * f)); st.x = cx - (cx - st.x) * (next / st.scale); st.y = cy - (cy - st.y) * (next / st.scale); st.scale = next; apply(); };
  st.fit = () => { if (!st.moved) fitView(); };
  pan.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = pan.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { st.moved = true; st.x -= e.deltaX; st.y -= e.deltaY; apply(); }
  }, { passive: false });
  pan.addEventListener("pointerdown", (e) => {
    if (e.target.closest("[data-ref]")) return;
    let last = { x: e.clientX, y: e.clientY };
    pan.classList.add("panning");
    const move = (ev) => { st.moved = true; st.x += ev.clientX - last.x; st.y += ev.clientY - last.y; last = { x: ev.clientX, y: ev.clientY }; apply(); };
    const up = () => { pan.classList.remove("panning"); removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  });
  zoom.onclick = (e) => {
    const z = e.target.closest("button") && e.target.closest("button").dataset.z, r = pan.getBoundingClientRect();
    if (z === "in") zoomAt(1.25, r.width / 2, r.height / 2);
    if (z === "out") zoomAt(1 / 1.25, r.width / 2, r.height / 2);
    if (z === "fit") { st.moved = false; fitView(); }
  };
  if (st.moved) apply(); else requestAnimationFrame(fitView);
}

// One place decides what shows, from the address.
function route() {
  if (!snap) return;
  const here = current();
  if (here.view === "" && !snap.boards.length && snap.system.views.length) { location.replace("#/" + snap.system.views[0].id); return; }
  const sys = here.view !== "" && here.view !== "page" && here.view !== "uses";
  $("#sys").classList.toggle("on", sys);
  $("#canvas").style.visibility = sys ? "hidden" : "";
  $("#empty").classList.toggle("on", !sys && !snap.boards.length);
  if (sys) { closePage(); showSystem(here.view, here.ref); }
  else if (here.view === "page" && here.ref) openPage(here.ref);
  else closePage();
  outlineUses(here.view === "uses" ? here.ref : "");
  rail();
}
addEventListener("hashchange", route);
$("#sys").addEventListener("click", (e) => {
  const goTo = e.target.closest("[data-go]");
  if (goTo) { go(goTo.dataset.go); return; }
  if (e.target.closest(".dclose")) { location.hash = "#/" + current().view; return; }
  const thing = e.target.closest(".sysbody [data-ref]");
  if (thing) location.hash = "#/" + current().view + "/" + refPath(thing.dataset.ref);
});

function liveLine() {
  const pill = $(".pill"), ago = $(".ago");
  const recent = [...snap.boards.filter((b) => recentRef(b.id)).map((b) => b.name), ...Object.keys(snap.system.names).filter(recentRef).map((r) => snap.system.names[r])];
  const doing = [...latestEdits().values()].filter((a) => moodOf(a) === "working").map((a) => a.author + " · " + a.label);
  pill.className = "pill" + (snap.error ? " bad" : recent.length || doing.length ? " on" : "");
  pill.lastChild.textContent = snap.error ? "Can't read the file: " + snap.error.split("\n")[0].slice(0, 80)
    : doing.length ? doing.join(", ") : recent.length ? recent.slice(0, 3).join(", ") + (recent.length > 3 ? " and " + (recent.length - 3) + " more" : "") + " changed" : snap.boards.length || snap.system.views.length ? "Watching for changes" : "Waiting for an agent";
  const s = Math.round((Date.now() - lastUpdate) / 1000);
  ago.textContent = "updated " + (s < 5 ? "just now" : s < 60 ? s + "s ago" : Math.round(s / 60) + "m ago");
  for (const [id, n] of boards) {
    const on = Date.now() - (changedAt[id] || 0) < 10000;
    n.el.classList.toggle("changed", on);
    n.badge.style.display = on ? "" : "none";
  }
}

function render(s) {
  if (snap && !first) for (const [ref, html] of Object.entries(s.system.details)) if (snap.system.details[ref] !== html) changedAt[ref] = Date.now();
  snap = s;
  $("#file b").textContent = s.name;
  $("#file span").textContent = s.folder;
  document.title = s.name + " · buni";
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
      e.onclick = () => { location.hash = "#/page/" + encodeURIComponent(b.id); };
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
  place();
  liveLine();
  route();
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
  back.onclick = () => { location.hash = "#/"; };
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
  if (e.key === "Escape") { const h = current(); location.hash = h.ref && h.view !== "page" ? "#/" + h.view : "#/"; }
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
addEventListener("resize", () => { if (!moved) fit(); const p = pans[shownView]; if (p && p.fit) p.fit(); });
// The "changed" marks fade after ten seconds, in the rail too (redrawn only then, so it keeps its scroll).
let railMarks = "";
setInterval(() => {
  if (!snap) return;
  liveLine();
  drawAgents();
  const now = Object.keys(changedAt).filter(recentRef).join();
  if (now !== railMarks) { railMarks = now; rail(); marks(); }
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
    <div id="sys"><div class="sysbody"></div><aside id="drawer"></aside></div>
  </main>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
