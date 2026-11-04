# The .buni format

A `.buni` file is one JSON document holding a whole design: its screens and what they are made of, and how people
move between them. The TypeScript types in [`src/format/doc.ts`](src/format/doc.ts)
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
  collection present. The same design always gives the same bytes, so a git diff shows only what changed. (buni
  reads any layout and writes its own on the first save.)
- The screen collections are always present, even when empty: `tokens`, `pages`, `nodes`, `shared`,
  `connections`, `flows`, `journeys`, `comments`, `rules`, `attachments`. `sections` may be left out, and a
  missing one reads as empty. `architecture` is there only when the design has one.

## Collections

**Screens**

| Key | What it holds |
|---|---|
| `tokens` | Design tokens: CSS custom property name (`--` then letters, digits, `-` and `_`) → value. |
| `modes` | Optional. Other appearances of the tokens, by mode name (`dark`: lowercase letters, digits and `-`): only the tokens that differ there, to their values. A page is drawn in a mode on the canvas, in Play and on the exported site (`<html data-mode="dark">`); `dark` also follows the system's choice where nothing asked. |
| `pages` | Screens and boards: name, `route`, its root `frame`, optional `state` (Empty, Error…), canvas position, `option` `{of, idea}` for another take on page `of` (an option has no `route` while it is one), `picked` `{why, at, over}` on a page chosen over its options (the why stays on the canvas), and `live` for a live page: `{libraries: [{name, url}], css, js}`, its libraries pinned to a version on cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or fonts.googleapis.com, and its own stylesheet and script as attachments under `live/`. Scripts run in a live page's preview and on the exported site. |
| `nodes` | The layer tree: frames, text, images, svg and component instances, each with a `parent`, `index` and CSS `style`; `classes` (one word each) for a live page's files and libraries to find a layer by, beside its `b-ID` class. |
| `shared` | Components: a reusable root, placed into pages as instances with overrides (per layer: `text`, `style`, styles `at` other widths, and `markup` for an svg layer, held to the same rules as an svg layer's own). A component may hold uses of other components, never of itself; a use overrides a layer inside one by the path of use ids to it (`"nav-item/label"`). |
| `connections` | Links from a node to a page: what a click does. |
| `flows`, `journeys` | Named paths through the screens, and the experience they describe. |
| `tasks` | What the person asked for, in their words: title, detail, the page it is about, `state` queued, working or done, who took it (`by`), the note it was finished with, and when each happened. |
| `attachments` | Files beside the design (images, briefs), by path relative to the `.buni` file. |

**The design's reasoning**

| Key | What it holds |
|---|---|
| `sections` | The design doc every agent reads first. |
| `rules` | Rules every screen keeps. |
| `comments` | Discussion on the canvas, on a layer. |

**Files from before**

buni once also designed the system behind the screens and the agents around them. A file from then still opens: its
`parts`, `links`, `tables`, `endpoints`, `operations`, `events`, `shapes`, `traces`, `environments`, `clusters`,
`placements`, `positions`, `phases`, `requirements`, `questions`, `roles`, `reviews`, `threads`, `agents`,
`evals`, the design doc's `decisions`, a layer's `bind`, a page's `client` and a connection's `endpoint` are accepted
and never read, so the next save drops them. The format version stays `1`: no file that opened before fails to open
now.

## Architecture

`architecture` holds how the app behind the screens is built and shipped: code → build → release → Kubernetes → run.
buni designs it, before and while it is built; nothing in it is live state. It is one object of twelve collections,
each keyed by id like the rest (one left out reads as empty), and an id names one thing across all twelve.

| Key | What it holds |
|---|---|
| `parts` | The app's parts: `kind` `client`, `service`, `worker`, `job`, `store`, `cache`, `queue`, `external` or `edge`; `tech`, `about`, `group`, `owners`; `build` `{repo, path, dockerfile, steps, artifact, registry}`; `managed` when it runs as a cloud service rather than a workload. |
| `links` | How two parts talk: `from`, `to`, `kind` (`calls`, `reads`, `writes`, `publishes`, `subscribes`, `routes`), `carries`. |
| `groups` | Boundaries parts sit in: a `system`, `domain` or `team`, with an optional `parent`. |
| `environments` | Where releases go, by `order` (preview, staging, prod), with the `cluster` it runs on, `provider`, `region`, `preview`. |
| `clusters` | Kubernetes clusters: `provider` (`eks`, `gke`, `aks`, `k3s`, `kind`, `other`), `version`, `zones`, node `pools`, `addons`, `gitops` `{tool: argocd or flux, repo, path}`. |
| `namespaces` | A `cluster`'s namespaces, by Kubernetes `name`, with `owners`. |
| `workloads` | What a `part` runs as in an `environment`: `namespace`, `kind` (`Deployment`, `Rollout`, `StatefulSet`, `Job`, `CronJob`, `DaemonSet`), `name`, `image`, `replicas`, `scale`, `keep` (disruption budget), `resources`, `probes`, `service`, `ingress`, `config`, `secrets`, `account`, `egress` (parts its network policy allows), `schedule`, `before` (a Job run before each sync), `nodes` (a pool). |
| `releases` | How parts ship: `parts`, `path` (environments in order), `manifests`, `strategy` `{kind: rolling, canary or blue-green, steps, hold}`, `checks`, `rollback`, `before` (Jobs that run first). |
| `migrations` | A change to a `store` part, the `release` it goes with, `change`, and `safe`: `additive` or `breaking`. |
| `plans` | A planned change: `issue`, `about`, the `releases` it ships in. |
| `stages` | The software path, idea to respond, by `order`: `tools`, `steps`, `makes`, `gate`. |
| `plays` | A `request`, `release` or `failure` played step by step: each step `touches` architecture ids and may name a `check`; `fails` `{at, then}` is the failure play that follows when step `at` (from 1) fails its check. |

Parts, links, workloads and migrations carry an optional `status` (`live` when absent, `planned`, `deprecated`,
`removed`) and `plan`: what a plan adds is `planned`, what it takes out is `removed`. Merging a plan makes what it
adds live and deletes what it removes, then the plan goes; discarding it (deleting the plan) deletes what it would
have added. Parts, workloads, releases and plans take `sources`.

The architecture can also be read and written whole as YAML (`read_architecture_text`, `write_architecture_text`,
`buni arch FILE text|write|edit`): a section per collection, each a map keyed by id with no `id` inside, `status: live`
and empty lists left out, and a link optionally on one line as `FROM KIND TO`. That text is a view for people to
write; the file itself stays JSON, and a text is held to the same rules before anything in it is saved.

The reader checks every reference, the enums, Kubernetes names (lowercase letters, digits and `-`, up to 63), that a
workload's namespace is in its environment's cluster, that only a CronJob has a `schedule` and only a Job runs
`before`, that a canary's steps rise to 100, that a migration changes a store, that a managed part is no workload, and
that a release's `before` are Jobs. The keys of buni's earlier system model (`parts`, `clusters`… at the top level)
are not these: they stay ignored (Files from before, above).

## Terminal screens

A design can hold terminal software as well as web pages: full-screen TUIs, output a CLI prints, tmux, zellij and
Neovim surfaces, prompts and pickers.

- A **terminal screen** is a page with `terminal`: its `surface` (`app`, `inline`,
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

`imports` lists other `.buni` files (relative paths) whose components and tokens this file builds on. This
file's references resolve against everything it imports: an instance may place an imported component, a token the
file doesn't set comes from its imports (its own value wins), and a connection may go to an imported file's page,
which opens that file. Imported pages are only places to go: they aren't drawn, and flows stay in their own file.
A connection whose `page` is a component (not a page) holds on every use of it: on each page that shows the component,
here or in a file that imports this one, unless that page links the same layer itself. An id may live in
only one of the files, so an imported component is edited in its own file; each imported file is checked in full
when it is opened itself. (`tokensRef` is reserved for a shared tokens file; nothing reads it yet.)

## Validity

`parseDoc` in [`src/format/parse.ts`](src/format/parse.ts) checks a file: the shape of every entry, that every
reference (a parent, a frame, a link target, a component an instance places) points at something that exists, and the
rules that keep a design coherent. A file can come from anyone, so whatever reaches exported HTML, CSS or file
paths is held to a strict shape:

- **Ids** are letters, digits, `-` and `_`, up to 128 characters.
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

Each reference needs a `file` or an HTTP(S) `url`. Other fields are optional; positive line numbers refer to a file. `endLine` requires `line` and cannot precede it. Pages, layers, components, links, flows, journeys, doc sections, rules, attachments and comments use the same shape, and so do the architecture's parts, workloads, releases and plans. `set_sources {ids, sources}` replaces the links; an empty array removes them. Manual editor controls use the same undoable operation. `create_page`, `create_component` and `write_html` also accept `sources` during creation. HTML may attach per-element references with a JSON `data-buni-sources` attribute. `read_tree`, `get_node` and `read_context` expose the stored context. Source links do not imply automatic synchronization with the implementation.
