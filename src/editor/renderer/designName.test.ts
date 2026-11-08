import { expect, test } from "bun:test";
import { designName } from "./AgentTerminal.tsx";

test("a request names its design by its first sentence, in a few words", () => {
  expect(designName("Bakery welcome page. Reply only: got it.")).toBe("Bakery welcome page");
  expect(designName("A calm checkout for a small shop: cart, address, payment")).toBe("A calm checkout for a");
  expect(designName("  ✨ Onboarding!! for a meditation app")).toBe("Onboarding");
  expect(designName("...")).toBe("Untitled");
});
