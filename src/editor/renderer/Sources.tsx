import { useState } from "react";
import { Code2, Plus, Trash2 } from "lucide-react";
import type { Doc } from "buni/format/doc.ts";
import { sourceLabel, sourceRef, sourceTarget, type SourceRef } from "buni/format/sources.ts";

function SourceForm({ source, onSave, onCancel }: { source?: SourceRef; onSave: (value: SourceRef) => Promise<void>; onCancel: () => void }) {
  const [file, setFile] = useState(source?.file ?? "");
  const [symbol, setSymbol] = useState(source?.symbol ?? "");
  const [repository, setRepository] = useState(source?.repository ?? "");
  const [line, setLine] = useState(source?.line?.toString() ?? "");
  const [endLine, setEndLine] = useState(source?.endLine?.toString() ?? "");
  const [url, setUrl] = useState(source?.url ?? "");
  const [selector, setSelector] = useState(source?.selector ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const parsed = sourceRef.safeParse({
      ...(file.trim() ? { file: file.trim() } : {}), ...(symbol.trim() ? { symbol: symbol.trim() } : {}),
      ...(repository.trim() ? { repository: repository.trim() } : {}),
      ...(line ? { line: Number(line) } : {}), ...(endLine ? { endLine: Number(endLine) } : {}),
      ...(url.trim() ? { url: url.trim() } : {}), ...(selector.trim() ? { selector: selector.trim() } : {}),
    });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message); return; }
    setBusy(true); setError(undefined);
    try { await onSave(parsed.data); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <form className="source-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <label>Source file<input autoFocus value={file} onChange={(e) => setFile(e.target.value)} placeholder="src/components/Header.tsx" /></label>
    <label>Symbol or component<input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Header" /></label>
    <details open={Boolean(source?.repository || source?.line || source?.url)}>
      <summary>Repository, lines and page URL</summary>
      <label>Repository<input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="Repository name or URL" /></label>
      <div className="source-lines">
        <label>Start line<input type="number" min="1" value={line} onChange={(e) => setLine(e.target.value)} /></label>
        <label>End line<input type="number" min="1" value={endLine} onChange={(e) => setEndLine(e.target.value)} /></label>
      </div>
      <label>Page URL<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/page" /></label>
      <label>Element selector<input value={selector} onChange={(e) => setSelector(e.target.value)} placeholder="#header" /></label>
    </details>
    {error && <p role="alert" className="notice">{error}</p>}
    <div className="source-actions"><button className="btn primary" disabled={busy || (!file.trim() && !url.trim())}>{busy ? "Saving…" : "Save source"}</button><button className="btn" type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}

/** One editing surface for source context on every kind of design item. */
export function Sources({ doc, id, inherited }: { doc: Doc; id: string; inherited?: { name: string; sources?: SourceRef[] } }) {
  const [editing, setEditing] = useState<number>();
  const [error, setError] = useState<string>();
  const target = sourceTarget(doc, id);
  if (!target) return null;
  const sources = target.entity.sources ?? [];
  const save = async (next: SourceRef[]) => {
    const result = await window.buni.edit("set_sources", { ids: [id], sources: next });
    if (!result.ok) throw new Error(result.reply);
    setError(undefined); setEditing(undefined);
  };
  return <section className="source-links" aria-label="Implementation sources">
    <header><b><Code2 size={13} /> Source files</b><button type="button" className="link-btn" onClick={() => setEditing(sources.length)}><Plus size={12} /> Add source</button></header>
    {!sources.length && editing === undefined && <p>Link the file and symbol that implement this design. Any language or file type.</p>}
    {sources.map((source, i) => <div className="source-item" key={i}>
      <button type="button" className="source-path" title="Edit source link" onClick={() => setEditing(i)}>{sourceLabel(source)}</button>
      <button type="button" className="icon" aria-label={`Remove source ${source.file ?? source.url}`} onClick={() => void save(sources.filter((_, at) => at !== i)).catch((e: Error) => setError(e.message))}><Trash2 size={12} /></button>
    </div>)}
    {inherited?.sources?.length ? <div className="source-inherited"><small>From {inherited.name}</small>{inherited.sources.map((s, i) => <code key={i}>{sourceLabel(s)}</code>)}</div> : null}
    {editing !== undefined && <SourceForm key={`${id}:${editing}`} source={sources[editing]} onCancel={() => setEditing(undefined)} onSave={(source) => save(editing < sources.length ? sources.map((s, i) => i === editing ? source : s) : [...sources, source])} />}
    {error && <p role="alert" className="notice">{error}</p>}
  </section>;
}
