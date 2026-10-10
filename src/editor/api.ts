import type { Person } from "../account/wazo.ts";
import type { Change } from "buni/tools/changes.ts";
import type { Doc, Id } from "buni/format/doc.ts";
import type { Edit } from "buni/tools/workspace.ts";
import type { DocPatch } from "buni/format/patch.ts";
import type { FormatError } from "buni/format/parse.ts";

/** Everything the window needs to draw: the live document and the work waiting on it. */
export type { Edit };
export type { AgentInfo, HomeFile, Snapshot, SnapshotUpdate, VersionInfo } from "buni/tools/protocol.ts";
import type { AgentInfo, HomeFile, Snapshot, SnapshotUpdate, VersionInfo } from "buni/tools/protocol.ts";

export interface SkillInfo {
  name: string;
  description: string;
  source: "buni" | "yours";
}

export interface SettleResult {
  dropped: { change: string; errors: FormatError[] }[];
}

/** Tools a person can run from the window; everything else stays with agents. */
export const EDIT_TOOLS = [
  "set_text", "tokens", "rename_layer", "set_svg", "update_styles", "delete_nodes", "duplicate_nodes", "wrap_nodes", "move_nodes", "replace_html", "set_layer", "set_widths", "swap_component", "detach_instance", "link_states", "add_variant", "duplicate_page", "set_variant", "write_html", "create_page",
  "make_component", "place_component", "override", "move_component",
  "write_section", "delete_section", "decide", "drop_decision", "comment", "merge_components", "delete_component", "rename_component",
  "bind", "set_motion", "connect", "disconnect", "place_page", "set_flow", "set_screen",
  "set_part", "move_part", "link_parts", "delete_system", "set_agent", "set_eval", "set_shape", "set_table", "set_endpoint", "set_event", "set_operation", "set_trace", "set_environment", "set_cluster", "place", "move_table", "arrange_tables", "move_on_canvas", "arrange_canvas",
  "set_phase", "set_requirement", "serve", "set_question", "decide_question", "set_role", "set_access", "review", "discuss",
] as const;
export type EditTool = (typeof EDIT_TOOLS)[number];

export interface EditResult {
  ok: boolean;
  reply: string;
}

/** The only bridge between the sandboxed window and the file. */
export interface BuniApi {
  /** The open file, or undefined on the home screen. */
  snapshot(): Promise<Snapshot | undefined>;
  onChange(fn: (u: SnapshotUpdate) => void): () => void;
  home(): Promise<HomeFile[]>;
  /** Opens a file; without a path, asks for one. */
  open(path?: string): Promise<void>;
  /** A new, empty file, opened: named `name` where the host names files itself (the web), else saved where the person picks. */
  create(name?: string): Promise<void>;
  /** Back to the home screen. */
  close(): Promise<void>;
  /** Renames a file on the home screen; only where files have no Finder of their own (the web). Returns its new path. */
  renameFile?(path: string, name: string): Promise<string>;
  /** Deletes a file from the home screen; only on the web. */
  removeFile?(path: string): Promise<void>;
  /** Saves the open file as a .buni the person keeps (in a repo, say); where files live on a server (the web). */
  downloadFile?(): Promise<{ path: string }>;
  /** This host has no sign-in (the web, for now): the profile and its menu stay out. */
  noAccounts?: true;
  /** Where a file's images are served from, if not from disk (the web): a folder's are at this plus its path. */
  assetBase?: string;
  /** Keeps the file as it is now as the version systemChanges compares with; where files aren't in git (the web). */
  saveVersion?(name?: string): Promise<VersionInfo>;
  /** Keeps an image in the design's folder and attaches it; resolves to its attachment id, for <img src="asset:ID">. */
  uploadImage?(name: string, base64: string, mime: string): Promise<string>;
  /** Saved versions, newest first. */
  versions?(): Promise<VersionInfo[]>;
  /** Makes the design match a saved version, as one edit that undo takes back. */
  restoreVersion?(id: string): Promise<EditResult>;
  /** Your own move of a page on the canvas; saved at once. */
  movePage(page: string, x: number, y: number): Promise<void>;
  /** Your own change to the sitemap order; after undefined makes the page first. */
  reorderPage(page: string, after: string | undefined): Promise<void>;
  /** Your own edit of the design; saved at once, or joined to the agent work it touches. */
  edit(tool: EditTool, args: Record<string, unknown>): Promise<EditResult>;
  /** Asks for a folder and writes the site there as static HTML + CSS; undefined if cancelled. */
  exportSite(): Promise<{ dir: string; files: number } | undefined>;
  /** The whole system design as one PDF to share, saved where the person picks. */
  exportSystem(): Promise<{ path: string } | undefined>;
  /** Opens a copy of the bundled example, so exploring it changes nothing that matters. */
  openExample(): Promise<void>;
  /** Who's signed in with Wazo, or the sign-in under way. */
  account(): Promise<AccountState>;
  onAccount(fn: (s: AccountState) => void): () => void;
  /** Starts signing in with Wazo: a code here, the approval page in the browser. */
  signIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  /** Opens the approval page again, for a sign-in under way. */
  openSignIn(): Promise<void>;
  /** Forgets the account here and signs its token out on Wazo. */
  signOut(): Promise<void>;
  /** Opens your account on Wazo's site, where your name and picture are edited. */
  openAccountPage(): Promise<void>;
  theme(): Promise<ThemeChoice>;
  setTheme(t: ThemeChoice): Promise<void>;
  /** What the system design changed since the file's last git commit; why not, when it can't tell. */
  systemChanges(): Promise<{ changes: Change[] } | { error: string }>;
  /** Asks where, then saves one page as a picture, a PDF, an SVG or an app icon set; undefined if cancelled. */
  exportPage(page: string, as: PageExport): Promise<{ path: string } | undefined>;
  undo(): Promise<EditResult>;
  redo(): Promise<EditResult>;
  /** ⌘Z or ⌘⇧Z from the Edit menu; the window decides between text and design undo. */
  onUndoKey(fn: (which: "undo" | "redo") => void): () => void;
  /** Design skills every agent can read, bundled and the person's own; bodies left out. */
  skills(): Promise<SkillInfo[]>;
}

export const CHANNELS = { snapshot: "buni:snapshot", changed: "buni:changed", home: "buni:home", open: "buni:open", create: "buni:create", close: "buni:close", movePage: "buni:move-page", reorderPage: "buni:reorder-page", edit: "buni:edit", undo: "buni:undo", redo: "buni:redo", undoKey: "buni:undo-key", skills: "buni:skills", exportSite: "buni:export-site", exportSystem: "buni:export-system", openExample: "buni:open-example", account: "buni:account", accountChanged: "buni:account-changed", signIn: "buni:sign-in", cancelSignIn: "buni:cancel-sign-in", openSignIn: "buni:open-sign-in", signOut: "buni:sign-out", openAccountPage: "buni:open-account-page", theme: "buni:theme", setTheme: "buni:set-theme", systemChanges: "buni:system-changes", exportPage: "buni:export-page", saveVersion: "buni:save-version", versions: "buni:versions", restoreVersion: "buni:restore-version", uploadImage: "buni:upload-image" } as const;

/** What one page can be saved as. PNG scale 1 is the page's own size, 2 is retina. */
export type PageExport = { format: "png"; scale: 1 | 2 } | { format: "pdf" } | { format: "svg" } | { format: "icons" };

/** One tab in a window's tab strip. */
export interface StripTab {
  id: number;
  title: string;
  /** False for a Files (home) tab. */
  file: boolean;
}

export interface StripState {
  tabs: StripTab[];
  active: number | undefined;
}

/** The tab strip along the top of a window. */
export interface StripApi {
  onTabs(fn: (state: StripState) => void): () => void;
  select(id: number): Promise<void>;
  close(id: number): Promise<void>;
  newTab(): Promise<void>;
  move(id: number, to: number): Promise<void>;
}

export const STRIP = { tabs: "strip:tabs", select: "strip:select", close: "strip:close", newTab: "strip:new-tab", move: "strip:move", ready: "strip:ready" } as const;

export type ThemeChoice = "system" | "light" | "dark";

/** Signing in with Wazo, as the window sees it. */
export type AccountState =
  | { state: "signed-out"; error?: string }
  | { state: "waiting"; userCode: string; url: string }
  | { state: "signed-in"; person: Person; server: string };
