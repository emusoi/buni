// What a host sees of an open design and its agents: every buni editor and the terminal speak this.
import type { Doc, Id } from "../format/doc.ts";
import type { DocPatch } from "../format/patch.ts";
import type { Edit } from "./workspace.ts";

/**
 * What an editor hears when its file changes: the whole snapshot when a file opens or closes, else
 * only what changed since the last snapshot it was given. A big file is megabytes; an edit is a few entries.
 */
export type SnapshotUpdate =
  | { kind: "whole"; snap: Snapshot | undefined }
  /** `system` is left out when it is the view itself: the file imports nothing. */
  | { kind: "patch"; view: DocPatch; system?: DocPatch; owners: Record<Id, string>; recent: Record<string, Id[]>; connected?: string[]; edits?: readonly Edit[]; asking?: Asking[]; present?: Presence[] };

/** Someone with the design open in a tab, and where they are in it. */
export interface Presence {
  /** The tab, so a person with two open shows twice and a tab can leave itself out. */
  tab: string;
  who: string;
  page?: Id;
  /** The layer they have selected. */
  node?: Id;
}

export interface Snapshot {
  path: string;
  /** Folder of the .buni file, for resolving attachments. */
  dir: string;
  view: Doc;
  /** The view with everything it imports: the components and tokens the canvas draws. */
  system: Doc;
  /** Imported things by id: the file (relative to this one) each lives in. */
  owners: Record<Id, string>;
  /** Nodes each author's latest edit touched, by author name: where they are working. */
  recent: Record<string, Id[]>;
  /** Where MCP clients connect. */
  mcpUrl: string;
  /** Coding agents connected over MCP right now, by the name they gave; only where the host lists them (the web). */
  connected?: string[];
  /** The latest edits, newest last: what agents just did, to show as it lands. */
  edits?: readonly Edit[];
  /** Questions agents are waiting on the person to answer, oldest first. */
  asking?: Asking[];
  /** People with the design open right now, and where; only where the host keeps the feed (the web). */
  present?: Presence[];
}

/** An agent's question to the person watching, about a layer or the design. */
export interface Asking {
  id: string;
  author: string;
  question: string;
  /** Short answers to pick from; the person can also write their own. */
  options: string[];
  node?: Id;
}

/**
 * One design of a project as lists and pickers need it: its pages and components by name, not its layers. A few KB
 * where its document is a megabyte.
 */
export interface ProjectFile {
  path: string;
  name: string;
  folder: string;
  /** ISO 8601. */
  modified: string;
  pages: { id: Id; name: string; route?: string }[];
  /** Its components, each with how often the project's other designs place it. */
  components: { id: Id; name: string; usedElsewhere: number }[];
  imports: string[];
  agentNote?: string;
}

/** A recently opened file, as the home screen shows it. */
export interface HomeFile {
  path: string;
  /** File name without .buni. */
  name: string;
  /** Folder, with the home directory as ~. */
  folder: string;
  /** ISO 8601. */
  modified: string;
  pages: number;
  doc: Doc;
  /** First page, drawn as the thumbnail. */
  preview?: Id;
  /** What the lead agent did last in this file, in one line. */
  agentNote?: string;
}

/** One of the agents working in the open file. */
export interface AgentInfo {
  id: string;
  name: string;
  /** Its colour on the canvas and in the panel. */
  color: string;
  /** Page it was asked to stay on, if any. */
  page?: string;
}


/** A saved version of a design: a name if it was given one, when, and who saved it. */
export interface VersionInfo {
  id: string;
  name: string;
  at: string;
  by: string;
}

/** The design folder in git: its branch and what changed in it since the last commit. */
export interface GitStatus {
  branch: string;
  changes: { path: string; state: "modified" | "added" | "deleted" | "renamed" | "new" }[];
}
