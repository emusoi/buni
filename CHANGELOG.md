# Changelog

What changed in each release of the buni engine and command line. Versions follow [semver](https://semver.org);
the `.buni` format has its own version (see [FORMAT.md](FORMAT.md)).

## 0.4.0 — 2026-10-09

- `buni open` now runs the full shared browser editor, with direct editing, playback, undo and live agent updates.
  The hosted product uses this same editor; the separate read-only viewer is removed.
- **The editor starts and draws faster**, and large design canvases show bounded bitmap previews instead of
  drawing every layer at full size.

## 0.3.3 — 2026-10-08

- **`buni open` opens the full editor in the browser** when `buni-edit` is installed; `--view` keeps the read-only
  viewer.
- **Fix:** a `<canvas>` written through `write_html` is dropped with a warning instead of making the design unopenable.

## 0.3.2 — 2026-10-08

- **`buni open` stops flashing while agents build.** A changed page or component draws in a hidden frame and swaps
  in once drawn, and the components canvas updates board by board instead of rebuilding.
- **The components canvas reads like a library**: it lays out even when a component draws nothing, keeps room for
  names at any zoom, fits its width and scrolls down.
- **No scroll bars inside drawn pages and components**, and thin ones on the viewer's own panels.
- **Fix:** a design that swaps an icon inside a nested part (a path override with markup) failed the format check.

## 0.3.1 — 2026-10-08

- **Components are how a design repeats itself.** `find_repeats` lists layers copied around the design (a sidebar
  on every page), and `componentize` makes each group one component, keeping every copy's words, styles and icons as
  overrides so nothing on the page changes. An edit that copies a part says so in its reply. Overrides can now carry
  an svg layer's markup, for another icon per use.
- **Components can hold components.** A Sidebar can be built from Nav items: `place_component` into a component's
  own layers, and a use overrides a layer inside a nested part by its path (`"item/label"`). A component holding
  itself, however far down, is refused. Detach, componentize and the components view all understand nesting.

## 0.3.0 — 2026-10-08

- **`buni open` shows the whole system**, not only the pages: the map of parts and links, the API, the data (tables,
  keys and shapes), events, traces as sequence diagrams, where each part runs, and the plan (requirements, questions
  and decisions, the design doc). Clicking anything opens its detail, which links to everything it touches, and the
  address says what is shown (`#/api/call:create-quote`), so an agent can point the person at it.
- **Agents show where they work in `buni open`**: each agent's face sits on the layer or system part it is changing,
  busy while edits come, smiling when they stop. Every writer of a design file on disk (the command
  line, MCP, an agent, an app) notes who edited what in `<file>.activity` beside the design.
- **`buni icons` and `buni pdf` work with Chrome alone**, without the desktop app. Each icon size is drawn at its own
  density, so small sizes stay sharp, on a see-through backdrop.

## 0.2.0 — 2026-10-08

- **`buni open`** shows a design in your browser, view only and live: its pages on a canvas with the flows between
  them, one page at a time, and the pages an agent just changed marked as they change.
- **The design agent moved to its own repository, buni-agent.** This one is buni's core: the format, the tools, skills,
  MCP, drawing, `buni login` and the CLI, with nothing of the agent in it. buni-agent carries the core and adds
  `buni agent`, `ask`, `eval` and `metrics`; it ships in the buni apps, and here those commands say what to use
  instead. The CLI takes an `Extension` for a package that carries it.
- **Sign in with Wazo** (`buni login`, `logout`, `whoami`) and work on the designs you keep on buni.emusoi.app
  with `--remote`: `buni ls`, then `tree`, `context`, `call`, `export` and `mcp` on a design by name.
  Edits show at once for everyone with the design open. `BUNI_TOKEN` signs in for CI.
- **Security:** SVG markup in a design is checked as a browser parses it, against what drawings need. A crafted
  file could previously put a `javascript:` link into an exported site (with an entity-encoded scheme or an
  `<animate>` that rewrote a link), or load remote and `data:` SVG images.
- **Drawing pages without the desktop app:** `buni shot` and screenshots over MCP draw with the Chrome,
  Chromium or Edge already on your machine (or `BUNI_CHROME`), so the build, look and fix loop works from this
  repository alone. Pages are found by id, name or route.
- **More security fixes for files from anyone:** ids, style property names, width styles, token names and routes
  are checked before they reach exported HTML, CSS or file paths; SVG may only use `url(#id)`; layer tags are an
  allowlist; deep nesting is refused quickly.
- Tools no longer reuse an id from another kind of record (which replaced it), and deleting, detaching or
  rewriting layers cleans up the comments and overrides that pointed at them.
- Design tools are organised one file per area (`src/tools/areas/`); their names and arguments are unchanged.
- Dead code and needless exports are gone; `BUNI_WEB_URL` is replaced by `--remote`.
- The MCP instructions, help and skills describe only what this repository does. User
  skills may fold their description over several lines, and read the same with Windows line endings.
- **Terminal screens as text:** `buni shot FILE PAGE out.txt` (or `.ans`, coloured) reads a terminal screen back
  cell by cell, borders as box drawing; `read_screen` does the same for MCP clients, and a
  terminal client's brief points builders at it. `examples/tk.buni` is a terminal task list to try it on.
- Terminal screens draw like a terminal: a border takes whole cells, a box's width counts its border, and text keeps
  its spaces. A 16-colour screen paints with the terminal's palette (`var(--term-red)`…), and its `.ans` uses the
  terminal's numbered colours and reverse video, so it shows in the reader's own theme.
- `brew install` pours a bottle, so it no longer needs up-to-date Command Line Tools on macOS.
- Components placed on a terminal screen draw in cells there too, borders and widths like the screen's own layers.
- **The terminal grid is checked:** an edit on a terminal screen says, in the tool's reply, what a terminal can't
  draw: sizes off whole cells, a second font or size, pictures, shadows and gradients, borders that aren't box
  drawing, and colours outside the palette on a 16-colour or colour-off screen.
- **One writer per design:** `buni mcp` holds the design while it runs and publishes `<file>.live`, so `buni call`
  and other MCP clients edit through it; when a buni here already has the design open, `buni mcp` passes its client
  through to it. Its tools include `screenshot`, drawn with the browser on the machine.
- `buni new FILE.buni` starts an empty design from the command line.
- The package exports its modules by path (`buni/format/doc.ts`) and its examples, so a product can install the engine
  instead of copying it. A host that ships the desktop app passes it to `renderHeadless`; the engine no longer guesses
  its path.
- The README lists every `BUNI_*` variable; font licenses are in `FONT-LICENSES.md`; CI actions are pinned.

## 0.1.0 — 2026-10-07

The first release of the open engine: the `.buni` format, the design tools, the design agent and its skills,
the CLI and the MCP server, as one binary for macOS and Linux (`brew install emusoi/tap/buni`).
