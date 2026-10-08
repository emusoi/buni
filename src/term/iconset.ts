import { Buffer } from "node:buffer";

/** Every size an app icon set holds, in pixels. 180 is Apple's touch icon. */
export const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/** A Windows/browser .ico holding PNGs, which every browser and Windows since Vista read. */
export function icoFile(pngs: ReadonlyMap<number, Buffer>, sizes: readonly number[] = [16, 32, 48]): Buffer {
  const images = sizes.flatMap((s) => {
    const png = pngs.get(s);
    return png ? [{ size: s, png }] : [];
  });
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

/** macOS icon types that hold a PNG of a given pixel size (the @2x types share sizes with the next one up). */
const ICNS_TYPES: [string, number][] = [
  ["icp4", 16], ["icp5", 32], ["ic11", 32], ["ic07", 128], ["ic12", 64], ["ic08", 256], ["ic13", 256], ["ic09", 512], ["ic14", 512], ["ic10", 1024],
];

/** A macOS .icns built straight from PNGs, so no platform tool is needed. */
export function icnsFile(pngs: ReadonlyMap<number, Buffer>): Buffer {
  const chunks = ICNS_TYPES.flatMap(([type, size]) => {
    const png = pngs.get(size);
    if (!png) return [];
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    return [head, png];
  });
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(8 + chunks.reduce((n, c) => n + c.length, 0), 4);
  return Buffer.concat([head, ...chunks]);
}
