import { brotliCompressSync, constants } from "node:zlib";
import { editorSources } from "./build.ts";

export interface Asset {
  body: Uint8Array<ArrayBuffer>;
  br: Uint8Array<ArrayBuffer>;
  gzip: Uint8Array<ArrayBuffer>;
  type: string;
}

export interface Built {
  files: Map<string, Asset>;
  client: string;
  styles: string;
  xyflow: string;
}

export const compress = (body: Uint8Array<ArrayBuffer>, type: string): Asset => ({
  body, type,
  br: new Uint8Array(brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })),
  gzip: Bun.gzipSync(body, { level: 9 }),
});

export async function buildAssets(): Promise<Built> {
  const { files, ...paths } = await editorSources();
  return { ...paths, files: new Map(files.map(({ path, body, type }) => [path, compress(body, type)])) };
}

export function serveAsset(a: Asset, req: Request): Response {
  const accepts = req.headers.get("accept-encoding") ?? "";
  const [body, encoding] = accepts.includes("br") ? [a.br, "br"] : accepts.includes("gzip") ? [a.gzip, "gzip"] : [a.body, undefined];
  return new Response(body, {
    headers: { "content-type": a.type, "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding", ...(encoding ? { "content-encoding": encoding } : {}) },
  });
}

export function page(html: string, built: Built): Response {
  const body = html
    .replace('<link rel="stylesheet" href="xyflow.css">', `<link rel="stylesheet" href="${built.xyflow}">`)
    .replace('<link rel="stylesheet" href="styles.css">', `<link rel="stylesheet" href="${built.styles}">`)
    .replace('<script src="main.js"></script>', `<script type="module" src="${built.client}"></script>`);
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
