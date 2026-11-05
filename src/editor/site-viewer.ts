// What a design's website carries besides its pages: it follows the design as it's edited, and a small pill to move
// through it (pages, a flow's steps, a screen width, restart), leave comments pinned to its layers, and jump to a layer
// in the editor. The pill sits on the page in the browser tab; `viewer` runs there, so it's written as plain browser
// code that reaches nothing outside itself.
import { walkFlow, type Doc, type Id } from "buni/format/doc.ts";

export interface SitePage { id: Id; name: string; href: string }
export interface SiteComment { id: Id; node: Id; state: string; posts: { author: string; body: string }[] }
export interface SiteData {
  file: string;
  /** The page this file draws; undefined for a file that isn't a page. */
  page?: Id;
  pages: SitePage[];
  flows: { id: Id; name: string; steps: Id[] }[];
  /** Open threads on this page's layers. */
  comments: SiteComment[];
  /** The page's other widths, narrowest last: the pill offers these besides the window's own. */
  widths: number[];
}

/** What the viewer needs to know of the design, for the page drawn at `page`. `hrefOf` maps a page to its address. */
export function siteData(doc: Doc, file: string, fileOf: Map<Id, string>, base: string, page: Id | undefined): SiteData {
  const href = (id: Id) => `${base}/${(fileOf.get(id) ?? "").replace(/(^|\/)index\.html$/, "$1")}`;
  const pages = [...fileOf.keys()].map((id) => ({ id, name: doc.pages[id]?.name ?? id, href: href(id) }));
  const flows = Object.values(doc.flows).sort((a, b) => (a.index < b.index ? -1 : 1)).map((f) => ({ id: f.id, name: f.name, steps: walkFlow(doc, f.start).pages.filter((id) => fileOf.has(id)) }));
  const frame = page === undefined ? undefined : doc.pages[page]?.frame;
  const onFrame = (node: Id) => {
    let n = doc.nodes[node];
    for (let guard = 0; n?.parent !== undefined && guard < 1000; guard++) n = doc.nodes[n.parent];
    return n?.id === frame;
  };
  const comments = frame === undefined ? [] : Object.values(doc.comments).filter((c) => c.state !== "resolved" && !c.ink && onFrame(c.node)).map((c) => ({ id: c.id, node: c.node, state: c.state, posts: c.posts.map((p) => ({ author: p.author, body: p.body })) }));
  const widths = [...(page === undefined ? [] : doc.pages[page]?.widths ?? [])].sort((a, b) => b - a);
  return { file, ...(page !== undefined ? { page } : {}), pages, flows, comments, widths };
}

/** The tags that go before </body>: the data, then the viewer. Both are marked data-buni: they aren't the page's own. */
export function viewerTags(data: SiteData): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/json" id="buni-site-data" data-buni>${json}</script><script data-buni>(${viewer.toString()})(${json});</script>`;
}

interface Hub {
  mode: "" | "comment" | "edit";
  data: SiteData;
  content?: { win: Window; refresh: () => void };
  render: () => void;
  setMode: (m: Hub["mode"]) => void;
  toggleHidden: () => void;
  go: (href: string) => void;
}

/** Runs in the page. Every page shows content; the window on top also holds the pill and, at a set width, the frame. */
export function viewer(first: SiteData): void {
  let data = first;
  const framed = window.top !== window;
  const session = {
    get: (k: string) => { try { return sessionStorage.getItem(`buni-site-${k}`) ?? ""; } catch { return ""; } },
    set: (k: string, v: string) => { try { sessionStorage.setItem(`buni-site-${k}`, v); } catch { /* kept for this page only */ } },
  };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

  // ?flow= from the editor picks the flow to step through; the address keeps only the page.
  const q = new URLSearchParams(location.search);
  if (q.has("flow")) {
    session.set("flow", q.get("flow") ?? "");
    q.delete("flow");
    history.replaceState(history.state, "", location.pathname + (q.size ? `?${q}` : "") + location.hash);
  }
  if (!framed && !session.get("start") && data.page) session.set("start", data.page);

  let hub: Hub | undefined;
  try { hub = framed ? (window.top as Window & { buniHub?: Hub }).buniHub : undefined; } catch { hub = undefined; }
  const width = framed ? "" : session.get("width");

  // The keys: \ hides the controls, Esc leaves Comment or Edit. No letters: on a page of drawn fields, typing where
  // there is no real field would flip modes.
  const keys = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!hub || e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    if (e.key === "\\") hub.toggleHidden();
    else if (e.key === "Escape" && hub.mode) hub.setMode(hub.mode);
  };
  if (!framed) {
    // ---------- The pill, on top ----------
    const host = document.createElement("buni-viewer");
    const root = host.attachShadow({ mode: "open" });
    let hidden = false;
    try { hidden = localStorage.getItem("buni-site-hidden") === "1"; } catch { /* shown */ }
    const own: Hub = {
      mode: "",
      data,
      render: () => draw(),
      setMode: (m) => { own.mode = own.mode === m ? "" : m; own.content?.refresh(); draw(); },
      // Shown, the page sits above the pill's strip; hidden, it has the whole window. Either way it loads again.
      toggleHidden: () => { try { localStorage.setItem("buni-site-hidden", hidden ? "0" : "1"); } catch { /* this page only */ } location.reload(); },
      go: (href) => { if (own.content) own.content.win.location.href = href; else location.href = href; },
    };
    hub = own;
    (window as Window & { buniHub?: Hub }).buniHub = own;
    const style = `
      :host { all: initial; }
      .pill { position: fixed; z-index: 2147483647; left: 50%; bottom: 20px; transform: translateX(-50%); max-width: calc(100vw - 24px); height: 44px; padding: 0 6px; box-sizing: border-box; border-radius: 22px; background: rgba(28, 28, 30, 0.9); backdrop-filter: blur(20px); box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 12px 40px rgba(0, 0, 0, 0.35); display: flex; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: none; font: 13px/1 system-ui, -apple-system, sans-serif; color: #f5f5f7; white-space: nowrap; }
      button, select { height: 32px; padding: 0 10px; border: 0; border-radius: 16px; background: none; font: inherit; color: #aeaeb2; cursor: pointer; flex: none; }
      select { appearance: none; field-sizing: content; max-width: 200px; text-overflow: ellipsis; }
      select.page { color: #f5f5f7; font-weight: 600; }
      option { color: #1d1d1f; }
      button:hover, select:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
      button.on { color: #fff; background: rgba(255, 255, 255, 0.16); }
      button.primary.on { background: #0a66d8; }
      button:disabled { opacity: 0.35; cursor: default; background: none; }
      .step { padding: 0 2px; color: #aeaeb2; font-variant-numeric: tabular-nums; }
      .sep { width: 1px; height: 20px; flex: none; margin: 0 4px; background: rgba(255, 255, 255, 0.14); }
      .dot { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: 32px; height: 32px; padding: 0; border-radius: 16px; background: rgba(28, 28, 30, 0.9); color: #f5f5f7; font-weight: 700; }
      .stage { position: fixed; inset: 0; z-index: 2147483646; background: #1c1c1e; display: flex; justify-content: center; padding: 16px 0 80px; box-sizing: border-box; }
      .stage iframe { height: 100%; border: 0; border-radius: 12px; background: #fff; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5); }
      .stage.full { padding: 0 0 56px; }
      .stage.full iframe { width: 100%; border-radius: 0; box-shadow: none; }
      .pill.strip { bottom: 6px; }
    `;
    const draw = () => {
      const d = own.content ? own.data : data;
      const flow = d.flows.find((f) => f.id === session.get("flow"));
      const at = flow && d.page ? flow.steps.indexOf(d.page) : -1;
      const hrefOf = (id: Id | undefined) => d.pages.find((p) => p.id === id)?.href;
      const open = d.comments.length;
      // The window, then the page's own widths, named by what they're for. A width chosen on another page stays on,
      // so it can be seen that this page wasn't made for it.
      const named = (w: number) => (w <= 480 ? `Phone · ${w}` : w <= 1024 ? `Tablet · ${w}` : `${w}`);
      const sizes: [string, string][] = [["", "Desktop"], ...[...new Set([...d.widths, ...(width ? [Number(width)] : [])])].sort((a, b) => b - a).map((w): [string, string] => [String(w), named(w)])];
      root.querySelector(".pill, .dotwrap")?.remove();
      const bar = document.createElement("div");
      if (hidden) {
        bar.className = "dotwrap";
        bar.innerHTML = `<button class="dot" title="Show the controls ( \\ )" aria-label="Show the controls">b</button>`;
        bar.querySelector("button")?.addEventListener("click", own.toggleHidden);
        root.append(bar);
        return;
      }
      bar.className = width ? "pill" : "pill strip";
      bar.innerHTML = `
        <select class="page" aria-label="Page">${d.page ? "" : "<option>—</option>"}${d.pages.map((p) => `<option value="${esc(p.href)}"${p.id === d.page ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        ${d.flows.length ? `<span class="sep"></span><select class="flow" aria-label="Flow"><option value="">No flow</option>${d.flows.map((f) => `<option value="${esc(f.id)}"${f.id === flow?.id ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select>` : ""}
        ${flow ? `<button class="prev" aria-label="Previous step" ${at > 0 ? "" : "disabled"}>‹</button><span class="step">${at < 0 ? "–" : at + 1} / ${flow.steps.length}</span><button class="next" aria-label="Next step" ${at < flow.steps.length - 1 ? "" : "disabled"}>›</button>` : ""}
        ${sizes.length > 1 ? `<span class="sep"></span>${sizes.map(([w, name]) => `<button class="size${w === width ? " on" : ""}" data-w="${w}"${w ? ` title="${w} px wide${d.widths.includes(Number(w)) ? "" : ": this page has no layout for it"}"` : ""}>${name}</button>`).join("")}` : ""}
        <span class="sep"></span>
        <button class="restart" title="Back to where you started">↺ Restart</button>
        <button class="comment primary${own.mode === "comment" ? " on" : ""}" title="Click a layer to comment on it">Comment${open ? ` · ${open}` : ""}</button>
        <button class="edit${own.mode === "edit" ? " on" : ""}" title="Click a layer to open it in the editor (or ⌥-click any time)">Edit</button>
        <button class="hide" title="Hide the controls ( \\ )" aria-label="Hide the controls">\\</button>`;
      const on = (sel: string, fn: (e: Event) => void, ev = "click") => bar.querySelector(sel)?.addEventListener(ev, fn);
      on("select.page", (e) => own.go((e.target as HTMLSelectElement).value), "change");
      on("select.flow", (e) => { const id = (e.target as HTMLSelectElement).value; session.set("flow", id); const f = d.flows.find((x) => x.id === id); const s = f?.steps[0]; if (f && d.page && !f.steps.includes(d.page) && s) own.go(hrefOf(s) ?? ""); else draw(); }, "change");
      on(".prev", () => { const h = hrefOf(flow?.steps[at - 1]); if (h) own.go(h); });
      on(".next", () => { const h = hrefOf(flow?.steps[at + 1]); if (h) own.go(h); });
      bar.querySelectorAll<HTMLButtonElement>(".size").forEach((b) => b.addEventListener("click", () => { session.set("width", b.dataset.w ?? ""); location.reload(); }));
      on(".restart", () => { const h = hrefOf(flow?.steps[0] ?? session.get("start")); if (h) { own.go(h); } });
      on(".comment", () => own.setMode("comment"));
      on(".edit", () => own.setMode("edit"));
      on(".hide", own.toggleHidden);
      root.append(bar);
    };
    const css = document.createElement("style");
    css.textContent = style;
    root.append(css);
    // With the pill shown the page runs in a frame, so the pill sits below it, never over the page's own controls:
    // the window's width, or one of the page's. This window's address follows the frame.
    const staged = Boolean(width) || !hidden;
    if (staged) {
      document.body.style.display = "none";
      const stage = document.createElement("div");
      stage.className = width ? "stage" : "stage full";
      const frame = document.createElement("iframe");
      if (width) frame.style.width = `${width}px`;
      frame.src = location.href;
      frame.title = "The page";
      frame.addEventListener("load", () => {
        try {
          const w = frame.contentWindow;
          if (!w) return;
          history.replaceState(history.state, "", w.location.href);
          document.title = w.document.title;
        } catch { /* left the site */ }
      });
      stage.append(frame);
      root.append(stage);
    }
    document.documentElement.append(host);
    window.addEventListener("keydown", (e) => keys(e));
    draw();
    if (staged) return;
  }

  // ---------- The content: live, with comments and the way to the editor ----------
  if (framed) window.addEventListener("keydown", keys);

  const layer = document.createElement("buni-layer");
  layer.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647";
  const shade = layer.attachShadow({ mode: "open" });
  shade.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, sans-serif; }
    .hover { position: absolute; pointer-events: none; border: 2px solid #0a66d8; border-radius: 4px; }
    .pin { position: absolute; width: 28px; height: 28px; margin: -14px 0 0 -14px; border: 0; border-radius: 14px 14px 14px 4px; background: #0a66d8; color: #fff; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); }
    .card { position: absolute; width: 280px; padding: 12px; border-radius: 12px; background: #fff; color: #1d1d1f; box-shadow: 0 12px 36px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.1); }
    .post + .post { margin-top: 8px; }
    .who { font-size: 12px; font-weight: 600; }
    textarea { display: block; width: 100%; min-height: 56px; margin-top: 8px; padding: 8px 10px; border: 0; border-radius: 8px; background: #f2f2f4; color: #1d1d1f; resize: vertical; outline: none; }
    textarea:focus { box-shadow: 0 0 0 2px #0a66d8; }
    .row { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    .row button { height: 28px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: #0a66d8; font-weight: 600; cursor: pointer; }
    .row button.send { background: #0a66d8; color: #fff; }
    .error { margin-top: 6px; color: #c00; font-size: 12px; }
  </style>`;
  const head = document.createElement("style");
  head.setAttribute("data-buni", "");
  head.textContent = "html.buni-pick, html.buni-pick * { cursor: crosshair !important; } html.buni-hint a.b-link > *, html.buni-hint a[href]:not(.b-link) { outline: 2px solid rgba(10, 102, 216, 0.55) !important; outline-offset: 2px; }";
  document.head.append(head);
  document.documentElement.append(layer);

  /** The layer an element draws, and its id: the nearest element with a b-<id> class. */
  const layerOf = (el: Element | null): { el: Element; id: string } | undefined => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const c = [...e.classList].find((x) => x.startsWith("b-") && x !== "b-link");
      if (c) return { el: e, id: c.slice(2) };
    }
    return undefined;
  };
  const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left + scrollX, top: r.top + scrollY, width: r.width, height: r.height }; };
  const clear = (sel: string) => shade.querySelectorAll(sel).forEach((n) => n.remove());
  const call = async (args: Record<string, unknown>) => {
    const r = await fetch(`/rpc/edit?file=${encodeURIComponent(data.file)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(["comment", args]) });
    const b = (await r.json()) as { value?: { ok: boolean; reply: string }; error?: string };
    if (b.error || !b.value?.ok) throw new Error(b.error ?? b.value?.reply ?? "That didn't save");
  };
  /** A card at x, y in the page: a thread's posts if any, a box to write in, and its buttons. */
  const card = (x: number, y: number, posts: SiteComment["posts"], send: (body: string) => Promise<void>, resolve?: () => Promise<void>) => {
    clear(".card");
    const c = document.createElement("div");
    c.className = "card";
    c.style.left = `${Math.min(x, scrollX + innerWidth - 296)}px`;
    c.style.top = `${y}px`;
    c.innerHTML = `${posts.map((p) => `<div class="post"><div class="who">${esc(p.author === "you" ? "You" : p.author)}</div>${esc(p.body)}</div>`).join("")}
      <textarea placeholder="${posts.length ? "Reply" : "Add a comment"}"></textarea><div class="error" hidden></div>
      <div class="row">${resolve ? `<button class="resolve">Resolve</button>` : `<button class="cancel">Cancel</button>`}<button class="send">${posts.length ? "Reply" : "Comment"}</button></div>`;
    const text = c.querySelector("textarea") as HTMLTextAreaElement;
    const err = c.querySelector(".error") as HTMLElement;
    const run = (p: Promise<void>) => p.then(() => c.remove()).catch((e: Error) => { err.hidden = false; err.textContent = e.message; });
    const submit = () => { if (text.value.trim()) void run(send(text.value.trim())); };
    c.querySelector(".send")?.addEventListener("click", submit);
    c.querySelector(".cancel")?.addEventListener("click", () => c.remove());
    if (resolve) c.querySelector(".resolve")?.addEventListener("click", () => void run(resolve()));
    text.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") c.remove(); });
    c.addEventListener("click", (e) => e.stopPropagation());
    shade.append(c);
    text.focus();
  };
  const pins = () => {
    clear(".pin");
    if (hub?.mode !== "comment") return;
    data.comments.forEach((t, i) => {
      const el = document.querySelector(`.b-${CSS.escape(t.node)}`);
      if (!el) return;
      const b = box(el);
      const pin = document.createElement("button");
      pin.className = "pin";
      pin.textContent = String(i + 1);
      pin.title = t.posts[0]?.body ?? "";
      pin.style.left = `${b.left + b.width}px`;
      pin.style.top = `${b.top}px`;
      pin.addEventListener("click", (e) => { e.stopPropagation(); card(b.left + b.width + 20, b.top - 14, t.posts, (body) => call({ thread: t.id, body }), () => call({ thread: t.id, resolve: true })); });
      shade.append(pin);
    });
  };
  const refresh = () => {
    document.documentElement.classList.toggle("buni-pick", !!hub?.mode);
    if (!hub?.mode) { clear(".hover"); clear(".card"); }
    pins();
  };
  const report = () => { if (hub) { hub.data = data; hub.content = { win: window, refresh }; hub.render(); } refresh(); };
  window.addEventListener("resize", pins);

  const openEditor = (node: string) => {
    const url = `/?file=${encodeURIComponent(data.file)}&node=${encodeURIComponent(node)}`;
    try {
      const o = window.top?.opener as Window | null | undefined;
      if (o && !o.closed && o.location.origin === location.origin && o.location.pathname === "/") {
        o.postMessage({ buni: "show", file: data.file, node }, location.origin);
        o.focus();
        return;
      }
    } catch { /* the opener went elsewhere */ }
    window.open(url, "buni-editor");
  };
  window.addEventListener("mouseover", (e) => {
    clear(".hover");
    if (!hub?.mode) return;
    const l = layerOf(e.target as Element);
    if (!l) return;
    const b = box(l.el);
    const h = document.createElement("div");
    h.className = "hover";
    Object.assign(h.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    shade.append(h);
  });
  window.addEventListener("click", (e) => {
    // Clicks on buni's own (the pill, a pin, a card) aren't clicks on the page.
    if (e.composedPath().some((n) => n instanceof Element && n.tagName.startsWith("BUNI-"))) return;
    const mode = e.altKey ? "edit" : hub?.mode;
    if (!mode) {
      // A click that does nothing shows what does, as a prototype does.
      if (!(e.target as Element).closest("a, button, input, select, textarea, label, [onclick]")) {
        document.documentElement.classList.add("buni-hint");
        setTimeout(() => document.documentElement.classList.remove("buni-hint"), 700);
      }
      return;
    }
    const l = layerOf(e.target as Element);
    if (!l) return;
    e.preventDefault();
    e.stopPropagation();
    if (mode === "edit") return openEditor(l.id);
    card(e.pageX + 12, e.pageY + 12, [], (body) => call({ node: l.id, body }));
  }, true);

  // ---------- Following the design ----------
  const sheets = () => [...document.querySelectorAll<HTMLLinkElement>("link[rel=stylesheet]")].filter((l) => l.href.startsWith(location.origin));
  const get = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))));
  const all = () => Promise.all([get(location.href), ...sheets().map((l) => get(l.href.split("?")[0] ?? l.href))]);
  let last: string[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  let again = false;
  all().then((t) => { last = t; }).catch(() => {});
  const check = async (): Promise<void> => {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const now = await all();
      if (!last || now[0] !== last[0]) {
        const next = new DOMParser().parseFromString(now[0] ?? "", "text/html");
        // Judged on what buni serves: a host may add scripts of its own to the page (a CDN beacon).
        if (next.querySelectorAll("script:not([data-buni])").length) return location.reload();
        const typed = new Map([...document.querySelectorAll<HTMLInputElement>("input, textarea, select")].map((e) => [e.className, e.type === "checkbox" || e.type === "radio" ? e.checked : e.value] as const));
        // Read before the swap: the new body moves into this page and leaves `next` without it.
        const fresh = next.getElementById("buni-site-data")?.textContent;
        if (fresh) data = JSON.parse(fresh) as SiteData;
        const focus = document.activeElement?.className;
        document.title = next.title;
        document.body.replaceWith(next.body);
        for (const e of document.querySelectorAll<HTMLInputElement>("input, textarea, select")) {
          const v = typed.get(e.className);
          if (typeof v === "boolean") e.checked = v; else if (v !== undefined) e.value = v;
        }
        if (focus) (document.getElementsByClassName(focus)[0] as HTMLElement | undefined)?.focus?.();
      }
      sheets().forEach((l, i) => { if (last && now[i + 1] !== last[i + 1]) l.href = `${l.href.split("?")[0]}?v=${Date.now()}`; });
      last = now;
      report();
    } catch { location.reload(); } finally { busy = false; if (again) { again = false; void check(); } }
  };
  new EventSource(`/events?file=${encodeURIComponent(data.file)}`).onmessage = () => { clearTimeout(timer); timer = setTimeout(() => void check(), 250); };
  report();
}
