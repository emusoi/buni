// The markdown the design doc is written in, shown as reading text: paragraphs, bulleted and numbered lists,
// **bold** and `code`. Built as React elements, never injected HTML, so a section's text can't run anything.
import type { ReactNode } from "react";

/** **bold** and `code` inside one line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}

type Block = { kind: "p"; lines: string[] } | { kind: "ul" | "ol"; items: string[] };

/** Lines into blocks: a run of "- " or "1. " lines is a list, anything else a paragraph; blank lines separate. */
export function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = out.at(-1);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      const item = (bullet ?? numbered)?.[1] ?? "";
      if (last && last.kind === kind) last.items.push(item);
      else out.push({ kind, items: [item] });
    } else if (!line.trim()) {
      if (last?.kind === "p") out.push({ kind: "p", lines: [] });
    } else if (last?.kind === "p") last.lines.push(line);
    else out.push({ kind: "p", lines: [line] });
  }
  return out.filter((b) => b.kind !== "p" || b.lines.length > 0);
}

export function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      {blocks(text).map((b, i) => {
        if (b.kind === "p") return <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}{inline(l)}</span>)}</p>;
        const List = b.kind;
        return <List key={i}>{b.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</List>;
      })}
    </div>
  );
}
