import type { Person } from "../account/signin.ts";
import type { Doc, Id } from "buni/format/doc.ts";
import type { Edit } from "buni/tools/workspace.ts";
import type { DocPatch } from "buni/format/patch.ts";
import type { FormatError } from "buni/format/parse.ts";

/** Everything the window needs to draw: the live document and the work waiting on it. */
export type { Edit };
export type { AgentInfo, GitStatus, HomeFile, Presence, ProjectFile, Snapshot, SnapshotUpdate, Space, VersionInfo } from "buni/tools/protocol.ts";
import type { AgentInfo, GitStatus, HomeFile, ProjectFile, Snapshot, SnapshotUpdate, Space, VersionInfo } from "buni/tools/protocol.ts";

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
  "import_html", "use_inspiration", "save_inspiration", "set_sources", "set_text", "tokens", "rename_layer", "set_svg", "update_styles", "delete_nodes", "duplicate_nodes", "wrap_nodes", "move_nodes", "replace_html", "set_layer", "set_widths", "swap_component", "detach_instance", "link_states", "add_variant", "duplicate_page", "rename_page", "import_file", "set_variant", "write_html", "create_page",
  "make_component", "create_component", "place_component", "override", "move_component",
  "write_section", "delete_section", "comment", "mark", "merge_components", "delete_component", "rename_component",
  "set_motion", "connect", "disconnect", "set_flow", "set_screen",
  // Architecture mode: a person writes the architecture with the same tools agents use.
  "merge_plan", "delete_architecture", "set_part", "link_parts", "unlink", "set_group", "set_build", "set_api", "set_operation", "set_environment", "set_cluster",
  "set_namespace", "set_workload", "set_release", "set_migration", "set_plan", "set_stage", "set_play", "place_architecture",
  // The architecture as text, read and written whole.
  "read_architecture_text", "write_architecture_text",
  // API contracts written out as drafts to build from.
  "export_architecture",
] as const;
export type EditTool = (typeof EDIT_TOOLS)[number];

export interface EditResult {
  ok: boolean;
  reply: string;
  /** The id a set_ tool created or changed: what Architecture mode selects after + Add or a link. */
  saved?: Id;
}

/** The only bridge between the sandboxed window and the file. */
export interface BuniApi {
  /** Read a page, stylesheet or image for the static HTML picker, without browser credentials. */
  readImportResource?(url: string, pageUrl: string): Promise<import("./import-resource.ts").ImportResource>;
  /** The open file, or undefined on the home screen. */
  snapshot(): Promise<Snapshot | undefined>;
  onChange(fn: (u: SnapshotUpdate) => void): () => void;
  home(): Promise<HomeFile[]>;
  /** The project's designs as summaries, for lists and pickers; where the host has it (else they read home()). */
  project?(): Promise<ProjectFile[]>;
  /** Designs in full with their imports, by path, for Play and flows across the project. */
  documents?(paths: string[]): Promise<Record<string, Doc>>;
  /** Opens a file; without a path, asks for one. */
  open(path?: string): Promise<void>;
  /** A new, empty file, opened: named `name` where the host names files itself (the web), else saved where the person picks. */
  /** A new design, beside `beside` (in its project) and building on `core` there, when given; else `in` a space's root. */
  create(name?: string, options?: { beside?: string; core?: string; in?: string }): Promise<void>;
  /** The spaces the person's designs live in and who is in each; only where the host has them (the web). */
  spaces?(): Promise<Space[]>;
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
  /** Keeps the file as it is now as a version to go back to; where files aren't in git (the web). */
  saveVersion?(name?: string): Promise<VersionInfo>;
  /** The design folder's branch and changes, where the host can see git (designs on this machine). */
  changes?(): Promise<GitStatus | undefined>;
  /** Commits the folder's changes, and pushes them if asked. */
  commit?(message: string, push: boolean): Promise<{ ok: boolean; reply: string }>;
  /** Answers an agent's question; no text dismisses it. */
  answer?(id: string, text: string | undefined): Promise<void>;
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
  /** This tab's id in the file's presence list, where the host keeps one (the web). */
  tab?: string;
  /** Tells the others on the file which page this tab looks at and which layer it has selected. */
  presence?(page: Id | undefined, node: Id | undefined): Promise<void>;
  /** Asks where, then saves one page as a picture, a PDF, an SVG or an app icon set; undefined if cancelled. */
  exportPage(page: string, as: PageExport): Promise<{ path: string } | undefined>;
  undo(): Promise<EditResult>;
  redo(): Promise<EditResult>;
  /** ⌘Z or ⌘⇧Z from the Edit menu; the window decides between text and design undo. */
  onUndoKey(fn: (which: "undo" | "redo") => void): () => void;
  /** Design skills every agent can read, bundled and the person's own; bodies left out. */
  skills(): Promise<SkillInfo[]>;
  /** One guide's text, by name. */
  skill?(name: string): Promise<string | undefined>;
  /** The inspiration libraries' patterns (buni's and the person's own), where the host can read them. */
  inspiration?(): Promise<PatternInfo[]>;
  /** Tablets on a USB cable to this Mac; only buni open on this machine offers them. */
  tablets?(): Promise<import("./usb.ts").WiredList>;
  /** Opens the design in Chrome on a tablet on the cable, by its serial. */
  openOnTablet?(serial: string): Promise<{ name: string; locked?: true } | { error: string }>;
  /** Builds the buni app and installs it on a tablet on the cable. */
  installTabletApp?(serial: string): Promise<{ name: string } | { error: string }>;
  /** Tablet browsers that came in with a code. */
  devices?(): Promise<import("./usb.ts").Device[]>;
  forgetDevice?(id: string): Promise<void>;
  /** A page's pen marks as a request for the coding agent, put on the Mac's clipboard. */
  sendMarks?(page: Id): Promise<{ count: number; copied: boolean; request: string }>;
  /** An architecture view's pen marks as a request for a plan, put on the Mac's clipboard. */
  sendViewMarks?(view: import("buni/format/doc.ts").InkView): Promise<{ count: number; copied: boolean; request: string }>;
}

/** A pattern in an inspiration library, as a list shows it; use_inspiration takes its file. */
export interface PatternInfo { name: string; library: string; use: string; tags: string[]; file: string }

export const CHANNELS = { snapshot: "buni:snapshot", changed: "buni:changed", home: "buni:home", open: "buni:open", create: "buni:create", close: "buni:close", movePage: "buni:move-page", reorderPage: "buni:reorder-page", edit: "buni:edit", undo: "buni:undo", redo: "buni:redo", undoKey: "buni:undo-key", skills: "buni:skills", exportSite: "buni:export-site", openExample: "buni:open-example", account: "buni:account", accountChanged: "buni:account-changed", signIn: "buni:sign-in", cancelSignIn: "buni:cancel-sign-in", openSignIn: "buni:open-sign-in", signOut: "buni:sign-out", openAccountPage: "buni:open-account-page", theme: "buni:theme", setTheme: "buni:set-theme", exportPage: "buni:export-page", saveVersion: "buni:save-version", versions: "buni:versions", restoreVersion: "buni:restore-version", uploadImage: "buni:upload-image" } as const;

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
