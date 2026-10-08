// The engine's version, from package.json: what `buni --version` and the MCP server report.
import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
