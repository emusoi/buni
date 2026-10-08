import { expect, test } from "bun:test";
import { cellsAnsi, cellsText, computed, type Screen } from "./cells.ts";

const ink = "rgb(212, 212, 212)";
const paper = "rgb(16, 16, 16)";
const screen: Screen = {
  fg: ink,
  bg: paper,
  grid: [
    [{ ch: "┌", fg: ink, bg: paper }, { ch: "─", fg: ink, bg: paper }, { ch: "┐", fg: ink, bg: paper }, { ch: " ", bg: paper }],
    [{ ch: "o", fg: paper, bg: ink, bold: true }, { ch: "k", fg: paper, bg: ink, bold: true }, { ch: " ", bg: ink }, { ch: " ", bg: paper }],
  ],
};

test("a screen reads as text, one line per row without trailing spaces", () => {
  expect(cellsText(screen)).toBe("┌─┐\nok\n");
});

test("in colour, the frame's own colours are left to the terminal and the rest are spelled out", () => {
  const ansi = cellsAnsi(screen);
  expect(ansi.split("\n")[0]).toBe("┌─┐ \x1b[0m");
  // The screen's own colours swapped, as a selected row is drawn, is reverse video: it follows the reader's theme.
  expect(ansi.split("\n")[1]).toBe("\x1b[0;1;7mok\x1b[0;7m \x1b[0m \x1b[0m");
});

test("on a 16-colour screen, palette colours are the terminal's numbered colours, and others are spelled out", () => {
  const red = computed("#cd3131");
  const brightBlack = computed("#666666");
  const s: Screen = { fg: ink, bg: paper, grid: [[{ ch: "!", fg: red }, { ch: "·", fg: brightBlack, bg: red }, { ch: "?", fg: "rgb(1, 2, 3)" }]] };
  const slots = new Map([[red, 1], [brightBlack, 8]]);
  expect(red).toBe("rgb(205, 49, 49)");
  expect(cellsAnsi(s, slots)).toBe("\x1b[0;31m!\x1b[0;90;41m·\x1b[0;38;2;1;2;3m?\x1b[0m\n");
});
