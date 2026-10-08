# buni

[![CI](https://github.com/emusoi/buni/actions/workflows/ci.yml/badge.svg)](https://github.com/emusoi/buni/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/emusoi/buni)](https://github.com/emusoi/buni/releases)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)

*buni* /ˈbu.ni/ — Swahili, *to design; to invent.*

buni is a design tool for agents and people. A design lives in one `.buni` file: the screens, the flows between
them, the components they share, and the system behind them (the API, the data, the events). Any coding agent can
read and edit it through the buni CLI or MCP server, and buni's own design agent works in it beside you.

This repository is buni's open core: the [file format](FORMAT.md), the design tools, the design skills, the CLI and the
MCP server. buni's design agent and the buni apps (the desktop editor and [buni.emusoi.app](https://buni.emusoi.app))
are built on it.

## Install

```sh
brew install emusoi/tap/buni
buni --help
```

Or download the binary for your platform from the [releases](https://github.com/emusoi/buni/releases): one file,
nothing else to install.

## Try it from source

You need [Bun](https://bun.sh) 1.3 or later.

```sh
git clone https://github.com/emusoi/buni && cd buni
bun install
bun src/cli.ts tree examples/portal.buni      # the outline of an example design
bun src/cli.ts help                           # how to design with buni
```

Edit a design the way an agent does: one tool call at a time, each written to the file at once.

```sh
bun src/cli.ts new my.buni                    # an empty design
bun src/cli.ts call my.buni create_page '{"name":"Home","route":"/"}'
bun src/cli.ts tools                          # every tool and its arguments
bun src/cli.ts open my.buni                   # see it in your browser, live as an agent designs it
```

A design keeps a few working files beside it: `<file>.live` while something holds it open, and `<file>.chats/` for
an agent's chats. Keep both out of git.

## See it

`buni open design.buni` shows the design in your browser: its pages on a canvas, the flows between them, and one
page at a time when you pick it; and the system behind them: the map of parts, the API, the data, events, traces,
where each part runs, and the plan. Anything you click opens its detail, linked to everything it touches. It is view only and follows the file, so as an agent designs, the pages it changes
appear and are marked. To change the design, ask your agent. `buni shot` draws one page to a PNG or PDF instead.

## Use it from your coding agent

**MCP.** Point any MCP client at the server, one file per server:

```json
{ "mcpServers": { "buni": { "command": "buni", "args": ["mcp", "/path/to/design.buni"] } } }
```

While it runs, it holds the design: `buni call`, other MCP clients and the buni apps edit through it, so nothing is
written underneath anyone.

**Shell.** Agents that can run commands use the CLI directly; `buni skill` prints a SKILL.md that teaches them how.

## Your designs on buni.emusoi.app

Sign in once with your [Wazo](https://wazo.emusoi.app) account, and the same commands work on the designs you keep
there: add `--remote` and name the design as `buni ls` shows it.

```sh
buni login                                   # a code to approve on Wazo; kept in your keychain
buni ls                                      # your designs
buni tree "Example" --remote
buni call "Example" create_page '{"name":"About","route":"/about"}' --remote
```

Edits made this way show at once for everyone with the design open. For a coding agent, serve the hosted design
over MCP: `{ "command": "buni", "args": ["mcp", "Example", "--remote"] }`. In CI, set `BUNI_TOKEN` instead of
signing in.

## The design agent

buni's own design agent ships with the buni apps (the desktop app carries a `buni` with every command here plus
`buni agent`, `buni ask` and evals). With this repository alone, any coding agent designs with buni: give it
`buni skill`, or serve the tools with `buni mcp`.

## Drawing pages

`buni shot` (and an agent's screenshots) draws a page with the Chrome, Chromium or Edge already on your
machine; set `BUNI_CHROME` to use another one. A terminal screen also draws as text (`out.txt`, or `out.ans` in
colour for `cat`): the characters a terminal shows, which a builder matches and keeps as a golden file. `buni icons`
and `buni pdf` (the whole system design as one PDF) are made by the buni desktop app. Everything else runs from this
repository alone.

## Environment

| Variable | What it does |
| --- | --- |
| `BUNI_AGENT` | The name `--as` defaults to, shown on the canvas where you work. |
| `BUNI_CHROME` | The browser `buni shot` draws with, when it isn't in its usual place. |
| `BUNI_TOKEN` | A sign-in for `--remote`, for CI; it takes the place of `buni login`. |
| `BUNI_SERVER_URL` | Where `buni login` and `--remote` keep designs, instead of buni.emusoi.app. |
| `BUNI_WAZO_URL` | The Wazo that `buni login` signs in with, instead of wazo.emusoi.app. |

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

The backend skill adapts parts of [The System Design Primer](https://github.com/donnemartin/system-design-primer) by
Donne Martin ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). The critique skill's lenses are named after
the commands of [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (MIT). The embedded fonts come from
[Fontsource](https://fontsource.org) under the SIL Open Font License; see [FONT-LICENSES.md](FONT-LICENSES.md).

## License

[Apache 2.0](LICENSE).
