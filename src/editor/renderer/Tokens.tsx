// The design's tokens, editable by hand: colours with a picker, fonts, and the rest (radius, spacing). Every layer
// that uses var(--name) follows a change, so each token says how many layers use it.
import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Doc } from "buni/format/doc.ts";

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i;
const isFont = (name: string, value: string) => /font/i.test(name) || /,\s*(sans-serif|serif|monospace|system-ui)/.test(value);

/** How many layers use a token, through var(--name) in their styles. */
function uses(doc: Doc, name: string): number {
  const ref = `var(${name})`;
  return Object.values(doc.nodes).filter((n) => Object.values(n.style).some((v) => v.includes(ref))).length;
}

/** "#0f766e" for a picker; undefined when the value is not a plain hex colour. */
function hex(value: string): string | undefined {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  return undefined;
}

export function Tokens({ doc, onError }: { doc: Doc; onError: (m: string | undefined) => void }) {
  const [adding, setAdding] = useState<{ name: string; value: string }>();
  const set = async (name: string, value: string) => {
    const r = await window.buni.edit("tokens", { set: { [name]: value } });
    onError(r.ok ? undefined : r.reply);
    return r.ok;
  };
  const entries = Object.entries(doc.tokens).sort(([a], [b]) => (a < b ? -1 : 1));
  const groups: [string, [string, string][]][] = [
    ["Colours", entries.filter(([, v]) => COLOR.test(v.trim()))],
    ["Fonts", entries.filter(([n, v]) => !COLOR.test(v.trim()) && isFont(n, v))],
    ["Other", entries.filter(([n, v]) => !COLOR.test(v.trim()) && !isFont(n, v))],
  ];
  return (
    <section className="tokens" aria-label="Tokens">
      <div className="tokens-head">
        <b>Tokens</b>
        <span className="hint">{doc.tokensRef ? `Shared from ${doc.tokensRef}` : "Layers using var(--name) follow a change"}</span>
        <button type="button" className="icon-btn small" aria-label="Add a token" title="Add a token" onClick={() => setAdding({ name: "--", value: "" })}><Plus size={13} /></button>
      </div>
      {adding && (
        <form className="token-row" onSubmit={(e) => {
          e.preventDefault();
          const name = adding.name.trim().startsWith("--") ? adding.name.trim() : `--${adding.name.trim()}`;
          if (name.length > 2 && adding.value.trim()) void set(name, adding.value.trim()).then((ok) => ok && setAdding(undefined));
        }}>
          <input className="field mono" autoFocus aria-label="Token name" value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} />
          <input className="field mono" aria-label="Token value" placeholder="#0f766e, 8px, Inter" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} onKeyDown={(e) => e.key === "Escape" && setAdding(undefined)} />
          <button type="submit" className="link-btn">Add</button>
        </form>
      )}
      {entries.length === 0 && !adding && <p className="hint">No tokens yet. Add colours and fonts here, then pick them in the Inspector as var(--name).</p>}
      {groups.map(([title, list]) => list.length > 0 && (
        <div key={title} className="token-group">
          <span className="prop-name">{title}</span>
          {list.map(([name, value]) => (
            <div key={name} className="token-row">
              {COLOR.test(value.trim()) && (
                <label className="token-swatch" style={{ background: value }} title={hex(value) ? "Pick a colour" : value}>
                  {hex(value) && <input type="color" value={hex(value)} aria-label={`${name} colour`} onChange={(e) => void set(name, e.target.value)} />}
                </label>
              )}
              <span className="token-name mono" title={`${uses(doc, name)} layers use it`}>{name}<span className="count">{uses(doc, name) || ""}</span></span>
              <input key={value} className="field mono" defaultValue={value} aria-label={`${name} value`}
                onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== value) void set(name, v); }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = value; e.currentTarget.blur(); } }} />
              <button type="button" className="icon-btn small" aria-label={`Remove ${name}`} title={uses(doc, name) ? `${uses(doc, name)} layers use it; they lose this value` : "Remove"} onClick={() => void set(name, "")}><X size={12} /></button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
