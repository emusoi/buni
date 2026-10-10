// What the local web server lets through. It listens on 127.0.0.1, but any page open in the person's browser can
// still send it requests; these checks keep other sites from changing designs or reading them.

/** Where buni's own pages are served from on this machine; a hosted buni has its public origin instead. */
export const localOrigins = (port: number): ReadonlySet<string> => new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

/**
 * A request that may change things: from buni's own page (its Origin is ours), or from a tool on this machine
 * (CLI, MCP client), which sends no Origin. Another site's page always sends its Origin and is refused.
 */
export function allowedOrigin(req: Request, own: ReadonlySet<string>): boolean {
  const origin = req.headers.get("origin");
  return origin === null || own.has(origin);
}

/**
 * A call into the editor's API: as above, and JSON. A cross-site page can only send JSON after the browser asks
 * first (a preflight), which this server never answers, so it can't send this at all.
 */
export function allowedCall(req: Request, own: ReadonlySet<string>): boolean {
  return allowedOrigin(req, own) && (req.headers.get("content-type") ?? "").split(";")[0]?.trim() === "application/json";
}

/** The mock API answers pages on this machine (a front end on any local port), never other sites. */
export function mockOrigin(req: Request): string | undefined {
  const origin = req.headers.get("origin");
  return origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin) ? origin : undefined;
}

const below = (path: string, dir: string) => path.startsWith(`${dir}/`) && !path.split("/").some((p) => p === ".." || p === ".");

/** A design's own file: <dir>/<folder>/<name>.buni, nothing above or beside it. `dir` is the person's designs. */
export function isDesignPath(path: unknown, dir = "/designs"): path is string {
  return typeof path === "string" && below(path, dir) && /^[^/]+\/[^/]+\.buni$/.test(path.slice(dir.length + 1));
}

/** A file inside one of the person's design folders (an image, an attachment), for /files/. */
export function isDesignFile(path: string, dir = "/designs"): boolean {
  return below(path, dir) && /^[^/]+\/.+/.test(path.slice(dir.length + 1));
}
