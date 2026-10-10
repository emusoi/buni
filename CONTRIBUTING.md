# Contributing to buni

Thank you for helping. This guide gets you from a clone to a merged pull request.

## Set up

You need [Bun](https://bun.sh) 1.3 or later; nothing else (no database, no Electron, no accounts).

```sh
git clone https://github.com/emusoi/buni && cd buni
bun install
bun run check    # TypeScript, strict
bun test         # every test; they run offline
```

Both must pass before a pull request is reviewed; CI runs the same two commands.

## How the code is laid out

| Folder | What it is |
|---|---|
| `src/format/` | The `.buni` file: its types (`doc.ts`), parsing and validation, serialization, patches. See [FORMAT.md](FORMAT.md). |
| `src/tools/` | Every edit a person or agent can make, one file per area in `areas/` on the helpers in `kit.ts`; the workspace that applies them with undo, rendering to HTML, site export, versions. |
| `src/skills/` | Design guidance agents read, as markdown (`design/*.md`), served by `buni skills` and MCP. |
| `src/mcp/` | The MCP server: the tools, served to any MCP client. |
| `src/oplog/` | The operation log edits are recorded in. |
| `src/term/` | Drawing pages with the browser on the machine, and terminal screens as text. |
| `src/editor/` | The shared browser editor, its local server and storage contract for hosted products. |
| `src/account/` | `buni login` with Wazo, the keychain, and designs on a buni server (`--remote`). |
| `src/cli.ts` | The `buni` command; a package that carries it adds commands through its `Extension`. |

This repository is the core, including the editor. The design agent (buni-agent) and the hosted product build on
it in separate repositories; nothing here imports from them, and `src/boundary.test.ts` keeps that boundary.

## Making a change

- **Keep it small and at the root.** Fix the cause, not the symptom; one concern per pull request.
- **Types are strict.** No `any`; `unknown` only at a boundary, narrowed at once. In our own types the empty value
  is `undefined`, never `null`.
- **Leave a test** for any logic: a branch, a parser, a tool. Tests sit beside the code (`*.test.ts`) and use
  `bun:test`. A test that needs something outside the repository (a model, the network) must skip without it.
- **Match the code around you**: its naming, comment style and idioms. Comments say why, in plain words.

### Adding a design tool

Tools live in `src/tools/areas/`, one file per area (read, pages, components, system, plan, doc, flows); an agent
loads an area's tools together, so add a tool to the file of its area and list it in `src/tools/areas/areas.ts` (anything
unlisted counts as pages). Each is a `tool({ description, input, run })`: `input` is a Zod shape (agents
see it as the tool's schema, so describe each argument), and `run` returns what it changed; for anything the caller
can fix, it throws a `ToolError` that says which rule the call broke. Write the description for an agent that has never seen buni: what the tool does,
when to use it, what it refuses. Add a test in `src/tools/tools.test.ts` that calls it through a `Workspace`.

### Adding or improving a skill

Skills are markdown files in `src/skills/design/` with `name` and `description` front matter, registered in
`src/skills/skills.ts`. A skill is guidance an agent follows while designing: concrete, opinionated, short enough
to read in one go. `bun src/cli.ts skills <name>` prints one as an agent sees it.

### Changing the file format

The format is a contract with every `.buni` file in the world. Additive changes (a new optional field, a new
collection) are fine; anything that would make an existing file invalid needs an issue first. Update `doc.ts`, the
validation in `parse.ts`, [FORMAT.md](FORMAT.md) and a test with a file that uses the change.

## Pull requests

1. Open an issue first for anything larger than a fix, so we can agree on the approach before you build it.
2. Branch from `main`; keep the history readable (squash fix-ups).
3. Sign off every commit (`git commit -s`): it certifies the
   [Developer Certificate of Origin](https://developercertificate.org), that you wrote the change or have the
   right to submit it under the project's license. There is no CLA.
4. Describe what changed and how you checked it, and add a line under Unreleased in [CHANGELOG.md](CHANGELOG.md)
   for anything a user would notice.

Contributions are licensed under [Apache 2.0](LICENSE), the same as the project.

## Releases

A maintainer moves the Unreleased notes in [CHANGELOG.md](CHANGELOG.md) under the new version, bumps `version` in
`package.json`, and pushes a matching tag (`v0.2.0`). The release workflow builds
the `buni` binary on each platform (`scripts/compile.ts`), publishes it, and updates the Homebrew formula
(`scripts/formula.ts`, with bottles from `scripts/bottles.ts`) in [emusoi/homebrew-tap](https://github.com/emusoi/homebrew-tap).

## Reporting a security issue

Please don't open a public issue. Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability).
