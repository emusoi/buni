import { expect, test } from "bun:test";
import { cornerRadii, radiusShorthand, withRotation } from "./Inspector.tsx";

test("corner radii read every shorthand and write back the shortest", () => {
  expect(cornerRadii("")).toEqual(["0", "0", "0", "0"]);
  expect(cornerRadii("8px")).toEqual(["8px", "8px", "8px", "8px"]);
  expect(cornerRadii("8px 0")).toEqual(["8px", "0", "8px", "0"]);
  expect(cornerRadii("1px 2px 3px")).toEqual(["1px", "2px", "3px", "2px"]);
  expect(cornerRadii("1px 2px 3px 4px / 5px")).toEqual(["1px", "2px", "3px", "4px"]);
  expect(radiusShorthand(["8px", "8px", "8px", "8px"])).toBe("8px");
  expect(radiusShorthand(["8px", "0", "8px", "0"])).toBe("8px 0");
  expect(radiusShorthand(["1px", "2px", "3px", "2px"])).toBe("1px 2px 3px");
  expect(radiusShorthand(["1px", "2px", "3px", "4px"])).toBe("1px 2px 3px 4px");
});

test("rotation is set in the transform without losing the rest of it", () => {
  expect(withRotation("", "15")).toBe("rotate(15deg)");
  expect(withRotation("scale(1.2) rotate(3deg)", "-10")).toBe("scale(1.2) rotate(-10deg)");
  expect(withRotation("rotate(3deg) translateX(4px)", "")).toBe("translateX(4px)");
  expect(withRotation("rotate(3deg)", "0")).toBe("");
});
