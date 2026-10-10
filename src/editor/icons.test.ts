import { expect, test } from "bun:test";
import { icnsFile, icoFile } from "./icons.ts";

test("ico and icns wrap the PNGs they are given, with sizes and offsets that add up", () => {
  const png = (n: number) => Buffer.alloc(n, n);
  const pngs = new Map([[16, png(10)], [32, png(20)], [48, png(30)], [1024, png(40)]]);
  const ico = icoFile(pngs);
  expect(ico.readUInt16LE(4)).toBe(3);
  expect(ico.readUInt8(6 + 16)).toBe(32);
  expect(ico.readUInt32LE(6 + 16 * 2 + 12)).toBe(6 + 16 * 3 + 10 + 20);
  expect(ico.length).toBe(6 + 16 * 3 + 60);
  const icns = icnsFile(pngs);
  expect(icns.toString("ascii", 0, 4)).toBe("icns");
  expect(icns.readUInt32BE(4)).toBe(icns.length);
  expect(icns.toString("ascii", 8, 12)).toBe("icp4");
  expect(icns.includes(Buffer.from("ic10"))).toBe(true);
});
