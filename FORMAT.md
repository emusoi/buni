# The .buni format

A `.buni` file is one JSON document holding a whole design: its screens and what they are made of, how people
move between them, and the system behind them. The TypeScript types in [`src/format/doc.ts`](src/format/doc.ts)
are the normative definition; this page is the map.

## Shape

```json
{
  "buni": 1,
  "tokens": { "--color-ink": "#10131A" },
  "pages": { "home": { "id": "home", "name": "Home", "route": "/", "frame": "home-frame", "index": "a0" } },
  "nodes": { "home-frame": { "id": "home-frame", "kind": "frame", "name": "Home", "index": "a0", "style": {} } },
  "shared": {}, "connections": {}, "flows": {}, "journeys": {}, "comments": {}, "rules": {}, "attachments": {}
}
```

- **`buni`** is the format version, now `1`.
- **Every collection is an object keyed by id**, and every entry repeats its own `id`. Order, where it matters,
  lives in an `index` field (a fractional index compared as a plain string), never in array position.
- **buni writes canonical JSON:** keys sorted at every level, two-space indent, a trailing newline, and every
  collection present. The same design always gives the same bytes, so a git diff shows only what changed. (The
  examples are laid out by hand, one entry per line; buni reads any layout and writes its own on the first save.)
- The screen collections are always present, even when empty: `tokens`, `pages`, `nodes`, `shared`,
  `connections`, `flows`, `journeys`, `comments`, `rules`, `attachments`. Every other collection may be left out,
  and a missing one reads as empty.

## Collections

**Screens**

| Key | What it holds |
|---|---|
| `tokens` | Design tokens: CSS custom property name (`--` then letters, digits, `-` and `_`) → value. |
| `pages` | Screens and boards: name, `route`, its root `frame`, optional `state` (Empty, Error…) and canvas position. |
| `nodes` | The layer tree: frames, text, images, svg and component instances, each with a `parent`, `index` and CSS `style`. |
| `shared` | Components: a reusable root, placed into pages as instances with overrides (per layer: `text`, `style`, styles `at` other widths, and `markup` for an svg layer, held to the same rules as an svg layer's own). A component may hold uses of other components, never of itself; a use overrides a layer inside one by the path of use ids to it (`"nav-item/label"`). |
| `connections` | Links from a node to a page: what a click does. |
| `flows`, `journeys` | Named paths through the screens, and the experience they describe. |
| `attachments` | Files beside the design (images, briefs), by path relative to the `.buni` file. |

**The design's reasoning**

| Key | What it holds |
|---|---|
| `sections` | The design doc every agent reads first. |
| `decisions`, `rules`, `requirements`, `questions` | What was decided and why, rules every screen keeps, what must be true, what is open. |
| `comments`, `threads`, `reviews` | Discussion on the canvas, and reviews of the design. |
| `phases`, `roles` | Delivery phases, and who does what. |

**The system behind the screens**

| Key | What it holds |
|---|---|
| `parts`, `links` | The system's parts (clients, services, stores) and what flows between them. |
| `endpoints`, `operations` | HTTP endpoints and GraphQL operations, with request and response shapes and designed errors. |
| `tables`, `shapes` | Data: tables with columns and relations, and shared data shapes. |
| `events` | Messages on queues and topics. |
| `traces` | Request paths through the system. |
| `environments`, `clusters`, `placements` | Where the parts run. |
| `positions` | Layout only: where things sit on the system canvases. |

**Agents**

| Key | What it holds |
|---|---|
| `agents` | Agents designed in the file: instructions, model, tools. |
| `evals` | Cases those agents are checked against. |

## Terminal screens

A design can hold terminal software as well as web pages: full-screen TUIs, output a CLI prints, tmux, zellij and
Neovim surfaces, prompts and pickers.

- A **terminal client** is a part with `terminal.targets`: each a `language` (`go`, `rust`, `python`, `typescript`)
  and, when it draws full screens, a `framework` (`bubbletea`, `ratatui`, `textual`, `ink`, `opentui`, `pi-tui`).
  The screens are designed once; each target is a build of them.
- A **terminal screen** is a page whose `client` is such a part, with `terminal`: its `surface` (`app`, `inline`,
  `tmux-status`, `tmux-layout`, `tmux-popup`, `tmux-menu`, `zellij-plugin`, `nvim-float`, `nvim-split`, `prompt`,
  `picker`), its size in `cols` and `rows` (no `rows` for `inline`: it grows as it prints), and the `colors` it is
  designed for (`none`, `16`, `256`, `truecolor`).

How a screen draws, so the canvas, the text it reads back as and the built app agree:

| | |
|---|---|
| Cells | One cell is 9×18 px. The screen's frame is `cols × 9` by `rows × 18`, in one monospace font set on the frame alone. |
| Borders | A border takes whole cells, a row above and below and a column each side, drawn as box drawing: `1px solid` single (with `border-radius`, rounded), `2px solid` thick, `3px double` double. A box's width counts its border. |
| Text | Spaces are kept, as a terminal keeps them. |
| Colour | Every terminal screen names the 16 colours as `var(--term-black)` … `var(--term-white)` and `var(--term-bright-black)` … `var(--term-bright-white)` (ANSI 0–15), and the terminal's own text and background as `var(--term-fg)` and `var(--term-bg)`. A 16-colour screen paints only with these, so the built app follows the reader's theme; swapping fg and bg is reverse video. |

A screen reads back as the characters a terminal shows (`buni shot FILE PAGE out.txt`, or `.ans` with its colours;
`read_screen` over MCP). Every edit on a terminal screen is checked against these rules, and the tool's reply lists
what breaks them.

## Imports

`imports` lists other `.buni` files (relative paths) whose system this file builds on. This file's references
resolve against everything it imports, and an id may live in only one of the files; each imported file is checked
in full when it is opened itself. (`tokensRef` is reserved for a shared tokens file; nothing reads it yet.)

## Validity

`parseDoc` in [`src/format/parse.ts`](src/format/parse.ts) checks a file: the shape of every entry, that every
reference (a parent, a frame, a link target, an endpoint a node binds to) points at something that exists, and the
rules that keep a design coherent. A file can come from anyone, so whatever reaches exported HTML, CSS or file
paths is held to a strict shape:

- **Ids** are letters, digits, `-` and `_` (a canvas position may add `:`), up to 128 characters.
- **Style property names** are CSS names or `--custom-properties`; values can't contain `{`, `}` or `<`. Styles at a
  width (`at`) are checked the same way, and the width must be one of the page's `widths`.
- **Routes** start with `/` and have no `.` or `..` segments, backslashes or control characters.
- **Layer tags** are layout, text and form elements only.
- **SVG markup** holds drawing elements only, with no scripts or event handlers; links go to `http(s)`, `mailto` or
  `#id`, images point inside the drawing or embed a PNG, JPEG, GIF or WebP, and any `url()` points inside the drawing.
- **Layers** nest at most 256 deep.
 The design tools never write a file that fails it. `buni tree <file>` and
`buni call <file> …` report problems in plain words.

## Changing the format

Additive changes (a new optional field, a new collection) keep version `1`. A change that would make an existing
file invalid raises the version and comes with a migration. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Implementation sources

Design records can carry an optional `sources` array. It is context for people and agents, not a command to modify code. Use repository-relative paths whenever possible; any file type is supported.

```json
"sources": [{ "file": "src/components/Header.tsx", "symbol": "Header", "repository": "web", "line": 20, "endLine": 64, "url": "http://localhost:3000/home", "selector": "header" }]
```

Each reference needs a `file` or an HTTP(S) `url`. Other fields are optional; positive line numbers refer to a file. `endLine` requires `line` and cannot precede it. Pages, layers, components, system records, plan records and agents use the same shape. `set_sources {ids, sources}` replaces the links; an empty array removes them. Manual editor controls use the same undoable operation. `create_page`, `create_component` and `write_html` also accept `sources` during creation. HTML may attach per-element references with a JSON `data-buni-sources` attribute. `read_tree`, `get_node` and `read_context` expose the stored context. Source links do not imply automatic synchronization with the implementation.
