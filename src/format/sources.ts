import { z } from "zod";
import type { Doc } from "./doc.ts";

/** Links to implementation or capture context; paths are relative to the named repository when possible. */
export const sourceRef = z.object({
  file: z.string().trim().min(1).optional(),
  repository: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).optional(),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  url: z.url().refine((s) => /^https?:\/\//.test(s), "Source URLs use HTTP or HTTPS").optional(),
  selector: z.string().trim().min(1).optional(),
}).strict().refine((s) => s.file !== undefined || s.url !== undefined, "Give a file or URL")
  .refine((s) => s.line === undefined || s.file !== undefined, "A source line needs a file")
  .refine((s) => s.endLine === undefined || (s.line !== undefined && s.endLine >= s.line), "The end line must follow the start line");
export const sourceRefs = z.array(sourceRef);
export type SourceRef = z.infer<typeof sourceRef>;
export interface SourceOwner { sources?: SourceRef[] }

export const SOURCE_COLLECTIONS = ["nodes", "pages", "shared", "connections", "parts", "links", "tables", "endpoints", "operations", "events", "shapes", "traces", "environments", "clusters", "placements", "phases", "requirements", "questions", "roles", "agents", "evals", "flows", "journeys", "sections", "decisions", "rules", "attachments", "comments", "threads"] as const;
export type SourceCollection = (typeof SOURCE_COLLECTIONS)[number];
export type SourceTarget = { [C in SourceCollection]: { collection: C; entity: Doc[C][string] } }[SourceCollection];

export function sourceTarget(doc: Doc, id: string): SourceTarget | undefined {
  for (const collection of SOURCE_COLLECTIONS) {
    const entity = doc[collection][id];
    if (entity) return { collection, entity } as SourceTarget;
  }
  return undefined;
}

export function sourceLabel(source: SourceRef): string {
  const at = source.file ? `${source.file}${source.line ? `:${source.line}${source.endLine ? `–${source.endLine}` : ""}` : ""}` : source.url ?? "";
  return `${source.repository ? `${source.repository} · ` : ""}${at}${source.symbol ? ` · ${source.symbol}` : ""}${source.file && source.url ? ` · ${source.url}` : ""}${source.selector ? ` · ${source.selector}` : ""}`;
}
