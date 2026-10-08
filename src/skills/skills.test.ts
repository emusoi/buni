import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills, readSkill } from "./skills.ts";

test("bundled skills all have a name, a description and a body", async () => {
  const skills = await loadSkills(join(tmpdir(), "no-such-skills-dir"));
  expect(skills.map((s) => s.name)).toEqual(["principles", "direction", "tells", "palettes", "styles", "philosophies", "critique", "accessibility", "color", "typography", "layout", "depth", "components", "interaction", "ux-writing", "motion", "mobile", "branding", "logo", "system-design", "backend", "api-design", "database-design", "deployment", "design-process", "agent-design", "terminal"]);
  for (const s of skills) {
    expect(s.description.length).toBeGreaterThan(20);
    expect(s.body).toStartWith("# ");
  }
});

test("your own skills are added, and replace a bundled one of the same name", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-skills-"));
  await writeFile(join(dir, "color.md"), "---\nname: color\ndescription: Our palette only.\n---\n# Our colours\nUse --brand.");
  await mkdir(join(dir, "icons"));
  await writeFile(join(dir, "icons", "SKILL.md"), "---\ndescription: Lucide, 1.75 stroke.\n---\n# Icons");
  const skills = await loadSkills(dir);
  expect(skills.filter((s) => s.name === "color")).toEqual([{ name: "color", description: "Our palette only.", body: "# Our colours\nUse --brand.", source: "yours" }]);
  expect((await readSkill("icons", dir))?.description).toBe("Lucide, 1.75 stroke.");
});

test("the typography skill names exactly the faces buni draws", async () => {
  const { FONT_FAMILIES } = await import("../tools/fonts.gen.ts");
  const body = (await loadSkills("/nonexistent")).find((s) => s.name === "typography")?.body ?? "";
  for (const f of FONT_FAMILIES) expect(body).toContain(f);
});

test("a skill's description may be folded over several lines, and Windows line endings read the same", async () => {
  const dir = await mkdtemp(join(tmpdir(), "buni-skills-"));
  await writeFile(join(dir, "folded.md"), "---\r\nname: folded\r\ndescription: >-\r\n  Spacing for\r\n  dense tables.\r\n---\r\n# Folded");
  await writeFile(join(dir, "wrapped.md"), "---\nname: wrapped\ndescription: Starts here\n  and carries on.\n---\n# Wrapped");
  expect(await readSkill("folded", dir)).toMatchObject({ description: "Spacing for dense tables.", body: "# Folded" });
  expect((await readSkill("wrapped", dir))?.description).toBe("Starts here and carries on.");
});
