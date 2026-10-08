import { expect, test } from "bun:test";
import { bottle, formula, PLATFORMS, tarball } from "./formula.ts";

test("the formula pours a bottle on every platform, so installing needs no compiler tools", () => {
  const names = PLATFORMS.flatMap((p) => [tarball("1.2.3", p), bottle("1.2.3", p)]);
  const sums = names.map((n, i) => `${String(i).padStart(64, "0")}  ${n}`).join("\n");
  const rb = formula("1.2.3", sums);
  expect(rb).toContain('root_url "https://github.com/emusoi/buni/releases/download/v1.2.3"');
  for (const p of PLATFORMS) expect(rb).toMatch(new RegExp(`sha256 cellar: :any_skip_relocation, ${p.tag}: "\\d{64}"`));
  // Homebrew asks the root_url for name-version.tag.bottle.tar.gz.
  expect(bottle("1.2.3", PLATFORMS[0])).toBe("buni-1.2.3.arm64_sonoma.bottle.tar.gz");
  expect(() => formula("1.2.3", sums.split("\n").slice(1).join("\n"))).toThrow("no checksum for buni-1.2.3-darwin-arm64.tar.gz");
});
