// The design doc as text: its sections and decisions in order, for briefs and agents' context.
import type { Decision, Doc, Section } from "../format/doc.ts";

export function sectionsInOrder(doc: Doc): Section[] {
  return Object.values(doc.sections).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
}

export function decisionsInOrder(doc: Doc): Decision[] {
  return Object.values(doc.decisions).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));
}

/** The design doc as plain text, for agents' context. */
export function docText(doc: Doc): string {
  const parts = sectionsInOrder(doc).map((s) => `## ${s.heading} (section ${s.id})\n${s.body}`);
  const decisions = decisionsInOrder(doc);
  if (decisions.length) parts.push(`## Decisions\n${decisions.map((d) => `- ${d.text} (${d.by}, ${d.at.slice(0, 10)}, decision ${d.id})`).join("\n")}`);
  return parts.join("\n\n");
}
