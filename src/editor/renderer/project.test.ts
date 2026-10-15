import { expect, test } from "bun:test";
import type { HomeFile } from "../api.ts";
import { siblings } from "./ProjectSwitch.tsx";

const file = (path: string): HomeFile => ({ path, name: path.split("/").at(-1)!.replace(/\.buni$/, ""), folder: path.slice(0, path.lastIndexOf("/")), modified: "", pages: 0, doc: {} as HomeFile["doc"] });

test("a project is the open file's folder, by name", () => {
  const files = [file("/d/shop/checkout.buni"), file("/d/blog/home.buni"), file("/d/shop/admin.buni")];
  expect(siblings(files, "/d/shop/checkout.buni").map((f) => f.name)).toEqual(["admin", "checkout"]);
  expect(siblings(files, "/d/elsewhere/x.buni")).toEqual([]);
});
