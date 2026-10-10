import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Doc, Page } from "buni/format/doc.ts";
import { groupPages, pageWindow } from "./sidebar.ts";

/** Keep the long page list out of layout and accessibility updates while the canvas moves. */
export function PageList(props: {
  pages: readonly Page[];
  parts: Doc["parts"];
  folded: ReadonlySet<string>;
  onFold: (key: string) => void;
  renderPage: (page: Page, indent: boolean) => ReactNode;
}) {
  type Row = { kind: "page"; page: Page; indent: boolean } | { kind: "group"; key: string; name: string; count: number };
  const rows = useMemo(() => groupPages(props.pages, props.parts).flatMap<Row>((item) => item.kind === "page"
    ? [{ ...item, indent: false }]
    : [{ kind: "group", key: item.key, name: item.name, count: item.pages.length }, ...props.folded.has(item.key) ? [] : item.pages.map((page) => ({ kind: "page" as const, page, indent: true }))]), [props.pages, props.parts, props.folded]);
  const list = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 40 });
  const virtual = rows.length > 200;
  useLayoutEffect(() => {
    const el = list.current, scroll = el?.closest("nav");
    if (!el || !scroll || !virtual) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      const top = scroll.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const next = pageWindow(rows.length, top, scroll.clientHeight);
      setRange((prev) => prev.start === next.start && prev.end === next.end ? prev : next);
    };
    const schedule = () => { pending ||= requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
    scroll.addEventListener("scroll", schedule, { passive: true });
    measure();
    return () => { cancelAnimationFrame(pending); observer.disconnect(); scroll.removeEventListener("scroll", schedule); };
  }, [rows.length, virtual]);
  const start = virtual ? Math.min(range.start, Math.max(0, rows.length - 1)) : 0;
  const end = virtual ? Math.max(start + 1, Math.min(range.end, rows.length)) : rows.length;
  return <div ref={list} className="page-list">
    {start > 0 && <div style={{ height: start * 28 }} aria-hidden="true" />}
    {rows.slice(start, end).map((row) => row.kind === "page"
      ? <Fragment key={row.page.id}>{props.renderPage(row.page, row.indent)}</Fragment>
      : <button key={row.key} type="button" className="row group-row" aria-expanded={!props.folded.has(row.key)} onClick={() => props.onFold(row.key)}>
        {props.folded.has(row.key) ? <ChevronRight size={13} className="dim" /> : <ChevronDown size={13} className="dim" />}
        <span className="name">{row.name}</span><span className="meta">{row.count}</span>
      </button>)}
    {end < rows.length && <div style={{ height: (rows.length - end) * 28 }} aria-hidden="true" />}
  </div>;
}
