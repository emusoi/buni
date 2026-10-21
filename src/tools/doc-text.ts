// The design doc as text: its sections in order, for briefs and agents' context.
import type { Doc, Section } from "../format/doc.ts";

export function sectionsInOrder(doc: Doc): Section[] {
  return Object.values(doc.sections).sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
}

/** The design doc as plain text, for agents' context. */
export function docText(doc: Doc): string {
  return sectionsInOrder(doc).map((s) => `## ${s.heading} (section ${s.id})\n${s.body}`).join("\n\n");
}
