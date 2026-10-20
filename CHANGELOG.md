# Changelog

What changed in each release of the buni engine and command line. Versions follow [semver](https://semver.org);
the `.buni` format has its own version (see [FORMAT.md](FORMAT.md)).

## Unreleased

- The side panel is minimal (designed in designs/extension.buni, option Minimal): the page you're on is the headline,
  one line says where it goes, and Capture page is the only button; Pick a part and "or keep it as inspiration" sit
  beside it, recent captures are plain rows, everything else is in Library. A capture keeps the page's own name,
  goes to the design its site's captures go to (one of your projects, chosen once from the designs you've opened, or
  a scratch design for the site), copies the prompt for Claude, and the panel then follows the redesign (captured,
  reviewed, Next ready, options) as Claude works. `buni open` remembers designs for this; the site links live in
  ~/.buni/settings.json.
- Fixed: a capture with frames or pictures the page can't hand over failed ("attachment … does not exist"). They are
  now drawn by Chrome's own screenshot of each box, wherever it is on the page (the extension asks for the debugger
  permission with page access; without it, it scrolls to each and cuts it from the screen), and one that still can't
  be drawn comes in as an empty box instead of refusing the import.
- The side panel fits narrow widths: the two intents are one switch, "What should change?" comes first, a long error
  shows its first line with Details, and a capture to redesign opens its design right there. The editor, under
  640px wide (or with `?compact=1`), starts with its panels folded, frames the page it was opened on, keeps a one-line
  title and drops the insert tools; watching that way, it follows an agent to the page it is changing.
- The extension is called buni now.
- buni opens in Chrome's side panel, beside the page you're working on: the extension's icon opens it. Capture
  (redesign it, or keep as inspiration) stays open while you pick a part; Snaps lists your captures with their briefs
  and opens any in the buni editor right in the panel (or in a tab), or copies the prompt for Claude; Inspiration
  searches your libraries. The panel asks once to read pages. The editor may only be framed by itself and the
  extension.
- Capture to redesign, end to end: the extension asks "What should change?" and keeps the answer as a brief on the
  captured page (`import_snapshot {brief}`), which also remembers the page's URL. `buni snaps` lists captures newest
  first with their briefs, so "work on my latest snap" is enough for an agent. "Copy for Claude" now carries the
  whole loop (look, review, a "· Next" copy or options, before and after), and "Open in buni" lands on the captured
  page: the editor opens on `?page=<id>`.
- Fixed: Pick a part in the Chrome extension. The popup now closes only once the request has arrived, the page's
  own mouse and pointer handlers don't fire while picking (a card inside a link no longer navigates), and a pick that
  fails shows a red badge and its reason when the popup opens again. While picking, ↑ takes the part around the one
  under the pointer and ↓ goes back; Enter captures.
- Import keeps the sizes a page set: a box keeps its width or height whenever laying it out at auto would change it
  (a 44px row, a progress fill at 62%, a full-width table), instead of guessing from what it holds. Tables keep
  `border-collapse`, `border-spacing` and `table-layout`; a fieldset and legend lose the browser's border when the
  page did; an open `<details>` comes in as it shows, its content and all.
- Inspiration libraries: folders of finished UI and UX patterns, one self-contained HTML file each, opening with
  what it is and when to use it (`inspiration/README.md`). buni ships its own; `buni inspiration add <folder>` adds
  yours (kept in `~/.buni/settings.json`), and `buni inspiration [find <words>]` lists them. Agents search with
  `find_inspiration`, bring one in as a reference page with `use_inspiration`, and keep a finished page or part as
  a pattern with `save_inspiration` (to `~/.buni/inspiration`, unless another library is named). The editor lists
  the patterns under the component library: click one to bring it in, + to keep the page you're on. The Chrome
  extension can save a snap straight into the library: open any site, Save to "My inspiration library".
- `buni adopt <scratch.buni> <folder>` moves a scratch design (a snap) into a project folder, assets and history
  with it.
- A Chrome extension snaps the page you're on into a design, as you see it, signed in: `buni extension [dir]`
  writes it to load unpacked, and lets Chrome-family browsers start buni for it (native messaging), so no editor
  has to be running. A snap of the whole page, or of a part you point at, becomes "<title> · Now" in a new scratch
  design (`~/buni/scratch/<name>/<name>.buni`) or one snapped into before; frames and pixels the page can't read
  are cut from the visible tab. The popup then copies a prompt for Claude or opens the design in buni.
  `import_snapshot` imports such a snapshot from MCP or the CLI, and an open editor takes one at `/snap`, only from
  its own page and from this extension, by its fixed id.
- Options: try other takes on a page and keep the best. `explore_page {page, options: [{name, idea}]}` makes each
  a copy of the page that changes on its own (a new format field, `Page.option = {of, idea}`; an option has no route
  while it is one). `compare_options {page}` reviews the page and its options side by side, best first, with each
  one's bet. `pick_option {option, why, others?}` makes one live: it takes the route, links and flows to the page now
  reach it, the old page becomes one of its options, and the why is kept as a decision. The sidebar lists options
  under their page; the critique skill gains an explore lens.
- Fixed: a live page's frames could be imported blank when the app reloaded them while it was being measured (the
  buni editor's own page previews did). Frames are drawn once they have loaded and painted again.
- `find_nodes {style?, text?, page?, root?, replace_with?}` finds layers by style, token or words. A colour matches
  however it is written, inside longer values such as a border, and through tokens set to it; `replace_with` swaps
  what matched on every layer in one edit (every `#999` for `var(--muted)`), at every width.
- `buni shot FILE PAGE out.png --frames 6` draws a page's motion as moments side by side, each labelled with its
  time, from the start to when the last entrance ends: an image an agent can read to check order and pace.
- An agent's edits come back with quick checks on the layers they changed, over MCP and `buni call`: contrast,
  tiny text, small targets, text spilling out, content left invisible. Nothing is added when they pass, there is
  no browser, or the edit changed nothing visible yet; `BUNI_EDIT_CHECKS=0` turns them off.
- `review_page {page, pin?}` reviews a page as it renders in Chrome, motion included, and answers with a score out
  of 100 and each issue worst first (P1 to P3) on the layers it is on. The first rules are motion: overshooting
  (bounce) curves, transitions that lay the page out, `transition: all`, ease-in, slow feedback, endless loops,
  entrances on many separate parts of a page, one duration for everything, long staggers, no reduced-motion
  alternative, and text left invisible once the page settles. Then type, colour and layout: contrast below WCAG AA
  against what is really behind the text, tiny text, long lines, tight leading, capitals for sentences, a flat
  type scale, skipped heading levels, targets under 24px, text spilling out of its box, text pressed against its
  box's edge. And the generated look (tells skill): nested cards, a coloured side stripe, gradient text, glows,
  eyebrows over headings, buzzwords, an arrow on every link, em dashes everywhere. `pin: true` leaves each issue as
  a comment on its layer once. `against` reviews the page a fixed copy came from too and says which issues were
  fixed, which remain and which are new, with both scores. The critique skill now judges first, runs review_page
  second, tags every finding P1 to P3, and ends snapshot-then-improve with that before-and-after.
- An imported page keeps its motion. Keyframe entrances and hover or press responses that set_motion can express
  become the layer's motion, with the page's exact timing curve kept as `curve` (a format addition: a motion may
  carry its own `cubic-bezier`). Loops and custom keyframes Buni can't hold are left as one comment per kind on the
  first layer that has them, with the CSS.
- `import_html_page {url, live: true}` snapshots a JavaScript app as a person sees it: the page's scripts run, it is
  captured once it settles, `cookies` signs it in and `wait_for` fails loudly on a login screen. Local Buni only.
  What a live page shows as pixels comes in as images: canvases (a PDF reader's pages), video frames, images by URL
  (fetched with the page's sign-in), and frames, embedded PDFs and cross-origin pixels drawn from the screen at 2×;
  pdf.js text layers are left out. A live page counts as settled only once its canvases are drawn, and a page laid
  out against the window is captured in a desktop window. A scrolling pane keeps `overflow: auto`, a grid keeps
  `justify-items`/`justify-self`, a controlled field keeps its placeholder, and a flex item as wide as its content
  no longer gets a fixed width that wraps its words in Buni's fonts. A tag reset to look like its parent (an upright
  `<i>`, a small `<h2>`, a `<textarea>` in the page's font, a list with no indent) keeps the reset, icons keep their
  size in a row, and a box whose children are all laid over it (a PDF page) keeps its height.
  The critique skill now says how to improve a product that ships: snapshot it, pin findings to its layers, fix them
  on a copy beside it.
- Pages can be renamed and moved: double-click a page in the sidebar (a new page starts there, named first), edit
  the route in the inspector, or `rename_page {page, name?, route?}`; a screen's states move with it.
- The library starts a component on its own board ("New"), so a core file of components needs no page.
- Fixed: an edit typed into the inspector (a layer's text, a width) was lost when the canvas was clicked next.
- Switching designs happens in the tab: no page load, the stream moves to the new file, a design seen before draws
  from a cache at once (41 to 85 ms for 1 MB designs), and back and forward move between them.
- Faster projects: the server keeps a project index (a design read and parsed again only when it changes) and answers
  lists and pickers with summaries, 6 KB where home() sent 1.4 MB; the editor asks once per tab, and loads other
  designs in full only for Play and flow boards. Opening a 1 MB design no longer blocks the window for half a second.
- Flows cross the project: in the editor a flow walks from a page here into the next design's pages, and Play plays
  it through in place (site → shop → account) rather than opening each file.
- Switching designs: the sidebar lists the project's designs, one click apart, and ⌘P goes to any of them, or straight
  to a page in one, by a few letters ("shop chec").
- A component's layer can link on every use (`connect` with the component as `page`; "Link on every use" in the
  editor): a core's nav, linked once in the core, works on every section's pages; a page's own link still wins.
- With a frame selected, the insert bar's "Adds inside" switches to "Adds after"; a design's first page takes the
  project's look; a component made with New (or `create_component` with `root`) is its element, hugging its content.
- A component placed on a page links its own layers there ("Links in this use": a nav's items and button), once for
  every page of the design that uses it; a core's nav is linked in each section that shows it.
- The insert bar adds a form field (label and input), its label ready to type; a new page takes the open page's
  background and font.
- On a page, a click selects the component placed there (a card), not a layer of its source (the card's button);
  a use's text overrides reach into the components it holds; links choose how the next page comes in.
- Making a component asks its name; a library tile renames one on double-click; component boards count their uses in
  the project's other designs.
- Links by hand: a layer's Link picks any page of the project, here or in another design (imported when picked).
- `buni open FOLDER` opens the folder's newest design, or starts one named for it.
- A tool given bad arguments says what's wrong in a line, not as raw JSON.
- Agents at work show wherever they edit from (the buni command too, not only MCP): tagged where they last edited,
  a dot on the page they're on, and a pill to jump there. What they add rises into place in their colour.
- Text or a heading added from the insert bar is typed straight away.
- Adding tokens keeps the form open for the next; text with no font reads in the system face, not Times.
- Core files: `imports` now shares components and tokens as well as the system. A section that imports `core.buni`
  places its components and inherits its tokens (its own value wins); they stay edited in the core, and open sections
  redraw when the core changes. The editor lists imported components and tokens with the file they come from.
- Links across files: a section that imports another can `connect` to its pages. Export links them by route, the
  inspector lists them under "Goes to other files", the canvas tags them at the page's edge, and Play follows one into
  the other file; flows stay in one file.
- `buni split FILE core core.buni` moves a design's components and tokens into a core file it imports, ids kept, so
  every page draws as before and the next section can share them.
- The agent guide (`buni skill`, `buni help`) explains how to split a big app into a project: core files for what
  sections share, a file per product area.

## 0.4.4 — 2026-10-15

- Projects: the designs in one folder are a project. The file name in the editor's top bar lists the project's other
  designs and starts a new one beside them; Home lists projects, including folders nested up to three deep.

## 0.4.3 — 2026-10-11

- Parallel standalone CLI calls to the same design preserve each other's edits and activity, including calls through symlinks.

## 0.4.2 — 2026-10-11

- Large designs retain less memory when parsed, and the editor releases its startup design snapshot after loading.
- Offscreen canvas boards release their mounted state and documents; distant previews decode at bounded sizes.
- Canvas zoom gestures update the camera directly, keeping React updates out of the active gesture.
- Agents can import static HTML pages and selected sections with `import_html_page` through CLI or MCP,
  resolving CSS and images while retaining source references in one undoable design edit.
- Empty designs open directly on the canvas; the introductory prompt screen is removed.

## 0.4.1 — 2026-10-10

- **Large designs move more smoothly:** virtualized page navigation and canvas overviews keep distant pages and
  connections in bounded bitmap previews, while selected pages remain editable.
- **Fix:** trackpad pinch and wheel gestures stay inside the canvas instead of zooming the browser page.
- **Import HTML as editable designs**, from a URL, files or pasted markup. Preview a page and select a smaller
  section to bring into a new page or the current frame, with its styles, images and fonts.
- **Keep source context with the design:** attach file paths, symbols, line ranges and URLs to layers, components
  and system entities, whether imported or built manually; the inspector and agent tools expose these references.
- **More reliable manual system, plan and agent editing**, including saved API access settings and agent test
  cases, with forms that follow undo and external edits without replacing unsaved work.

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
