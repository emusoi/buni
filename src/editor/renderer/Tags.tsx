// A page's tags, in the inspector: words to filter the page list by ("next", "checkout"). Typing one and Enter adds
// it; × takes it off. Tags the design already uses are offered as you type.
import { useState } from "react";
import { X } from "lucide-react";
import { tagOf, type Doc, type Id } from "buni/format/doc.ts";

export function Tags({ doc, page, onError }: { doc: Doc; page: Id; onError: (m: string | undefined) => void }) {
  const [text, setText] = useState("");
  const p = doc.pages[page];
  if (!p) return null;
  const tags = p.tags ?? [];
  const known = [...new Set(Object.values(doc.pages).flatMap((x) => x.tags ?? []))].filter((t) => !tags.includes(t)).sort();
  const edit = async (change: { add?: string[]; remove?: string[] }) => {
    const r = await window.buni.edit("set_tags", { pages: [page], ...change });
    onError(r.ok ? undefined : r.reply);
  };
  const add = () => {
    const t = tagOf(text);
    setText("");
    if (t && !tags.includes(t)) void edit({ add: [t] });
  };
  return (
    <section className="page-tags" aria-label="Tags">
      <b>Tags</b>
      <div className="tag-row">
        {tags.map((t) => (
          <span key={t} className="tag-chip">#{t}<button type="button" className="tag-x" aria-label={`Remove #${t}`} title="Remove" onClick={() => void edit({ remove: [t] })}><X size={11} /></button></span>
        ))}
        <input list="buni-tags" placeholder="+ tag" value={text} aria-label="Add a tag" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => {
          if (e.key === "Enter") add();
          if (e.key === "Escape") setText("");
        }} onBlur={add} />
        <datalist id="buni-tags">{known.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
    </section>
  );
}
