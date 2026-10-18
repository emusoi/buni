# buni

Buni's open engine for designing interfaces, flows and systems in `.buni` files. Includes a browser editor,
CLI and MCP server.

## Install

```sh
brew install emusoi/tap/buni
```

Or download a standalone binary from the [releases](https://github.com/emusoi/buni/releases).

## Use

```sh
buni new design.buni
buni open design.buni
```

Watch saved agent changes in the native `buni-tui` renderer (install it separately). Run `buni open` without
a file to wait for an agent to attach a design. Use `buni open design.buni --web` for the browser editor.
Run `buni --help` for all commands.

## Coding agents

Run `buni skill` for CLI instructions, or configure your agent's MCP client:

```json
{ "mcpServers": { "buni": { "command": "buni", "args": ["mcp", "/path/to/design.buni"] } } }
```

## Documentation

[File format](FORMAT.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Apache 2.0 license](LICENSE)

## Credits

Design guidance adapts [The System Design Primer](https://github.com/donnemartin/system-design-primer) by Donne
Martin ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and references
[Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (MIT). Fonts come from
[Fontsource](https://fontsource.org); see [FONT-LICENSES.md](FONT-LICENSES.md).
