/// <reference path="./md.d.ts" />
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import accessibility from "./design/accessibility.md" with { type: "text" };
import apiDesign from "./design/api-design.md" with { type: "text" };
import branding from "./design/branding.md" with { type: "text" };
import color from "./design/color.md" with { type: "text" };
import components from "./design/components.md" with { type: "text" };
import databaseDesign from "./design/database-design.md" with { type: "text" };
import deployment from "./design/deployment.md" with { type: "text" };
import designProcess from "./design/design-process.md" with { type: "text" };
import depth from "./design/depth.md" with { type: "text" };
import layout from "./design/layout.md" with { type: "text" };
import logo from "./design/logo.md" with { type: "text" };
import motion from "./design/motion.md" with { type: "text" };
import principles from "./design/principles.md" with { type: "text" };
import systemDesign from "./design/system-design.md" with { type: "text" };
import terminal from "./design/terminal.md" with { type: "text" };
import typography from "./design/typography.md" with { type: "text" };
import uxWriting from "./design/ux-writing.md" with { type: "text" };
import critique from "./design/critique.md" with { type: "text" };
import direction from "./design/direction.md" with { type: "text" };
import interaction from "./design/interaction.md" with { type: "text" };
import mobile from "./design/mobile.md" with { type: "text" };
import palettes from "./design/palettes.md" with { type: "text" };
import styles from "./design/styles.md" with { type: "text" };
import philosophies from "./design/philosophies.md" with { type: "text" };
import tells from "./design/tells.md" with { type: "text" };
import agentDesign from "./design/agent-design.md" with { type: "text" };
import backend from "./design/backend.md" with { type: "text" };

/** Design guidance an agent reads before it designs: when it applies (description) and what to do (body). */
export interface Skill {
  name: string;
  description: string;
  body: string;
  /** Shipped with buni, or the person's own from ~/.buni/skills. */
  source: "buni" | "yours";
}

/**
 * Reads a SKILL.md-style file: `name:` and `description:` in the front matter, the rest is the body. A value may be
 * on one line, or folded over the indented lines below it (`description: >-`), as `buni skill` itself writes it.
 */
function parseSkill(raw: string, source: Skill["source"], fallbackName: string): Skill {
  const text = raw.replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const field = (k: string) => {
    const at = m?.[1]?.match(new RegExp(`^${k}:[ \\t]*(.*)$((?:\\n[ \\t]+.*)*)`, "m"));
    if (!at) return undefined;
    const first = (at[1] ?? "").trim();
    const folded = (at[2] ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
    const value = /^[>|][-+]?$/.test(first) ? folded : [first, folded].filter(Boolean).join(" ");
    return value || undefined;
  };
  return { name: field("name") ?? fallbackName, description: field("description") ?? "", body: (m ? text.slice(m[0].length) : text).trim(), source };
}

// The order is the reading order: foundations, direction and its guards, the craft areas, then systems.
const BUNDLED = [principles, direction, tells, palettes, styles, philosophies, critique, accessibility, color, typography, layout, depth, components, interaction, uxWriting, motion, mobile, branding, logo, systemDesign, backend, apiDesign, databaseDesign, deployment, designProcess, agentDesign, terminal].map((t) => parseSkill(t, "buni", "skill"));

/** Skills every design request needs, sent with the instructions so the provider caches them once for every chat. */
export const CORE = ["principles", "direction", "tells", "styles", "philosophies"];

/** The core skills' bundled text, for the instructions. */
export function coreSkills(): string {
  return BUNDLED.filter((s) => CORE.includes(s.name)).map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`).join("\n\n");
}

export const SKILLS_DIR = join(homedir(), ".buni", "skills");

/** Bundled skills plus the person's own (`<dir>/<name>.md` or `<dir>/<name>/SKILL.md`); theirs win on a name clash. */
export async function loadSkills(dir = SKILLS_DIR): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return BUNDLED;
  }
  const own = await Promise.all(
    entries.map(async (e) => {
      const name = e.replace(/\.md$/, "");
      const path = e.endsWith(".md") ? join(dir, e) : join(dir, e, "SKILL.md");
      try {
        return [parseSkill(await readFile(path, "utf8"), "yours", name)];
      } catch {
        return [];
      }
    }),
  );
  const mine = own.flat();
  return [...BUNDLED.filter((b) => !mine.some((s) => s.name === b.name)), ...mine];
}

/** One line per skill, for list_skills and the CLI. */
export function skillList(skills: readonly Skill[]): string {
  return skills.map((s) => `${s.name}${s.source === "yours" ? " (yours)" : ""} — ${s.description}`).join("\n");
}

export async function readSkill(name: string, dir?: string): Promise<Skill | undefined> {
  return (await loadSkills(dir)).find((s) => s.name === name);
}
