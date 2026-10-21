// Splitting a big design across files: move its components and tokens into a core file the sections share.
import { componentNodes, emptyDoc, type Doc } from "../format/doc.ts";

/**
 * `doc`'s components (with their layers) and tokens, moved into a core file that `doc` then imports, so sections can
 * share them. Ids stay, so every use, override and link on a component's layers still resolves. Attachments are
 * copied, as a component may show an image of the file's.
 */
export function splitCore(doc: Doc, corePath: string): { rest: Doc; moved: Doc } | string {
  if (Object.keys(doc.shared).length === 0 && Object.keys(doc.tokens).length === 0) return "this file has no components or tokens to move";
  const rest: Doc = structuredClone(doc);
  const moved: Doc = emptyDoc();
  for (const id of Object.keys(componentNodes(doc))) {
    moved.nodes[id] = doc.nodes[id]!;
    delete rest.nodes[id];
  }
  moved.shared = doc.shared;
  moved.tokens = doc.tokens;
  moved.attachments = doc.attachments;
  rest.shared = {};
  rest.tokens = {};
  rest.imports = [...new Set([...(doc.imports ?? []), corePath])];
  return { rest, moved };
}
