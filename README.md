# buni

Buni's open engine for designing interfaces, flows and UX journeys in `.buni` files. Includes a browser editor,
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

`buni open design.buni` opens the browser editor. To watch saved agent changes in the terminal,
install `buni-tui` separately and run `buni-tui open design.buni`, or `buni-tui open` to wait for an agent attachment.
Run `buni --help` for all commands.

`buni arch design.buni` briefs the architecture behind the screens (how the app is built and shipped);
`buni arch design.buni check` reviews it, and `buni arch design.buni export manifests|argocd|ci|brief` writes draft
Kubernetes YAML, Argo CD Applications, GitHub Actions workflows or a Markdown brief to review.

## Coding agents

Run `buni skill` for CLI instructions, or configure your agent's MCP client:

```json
{ "mcpServers": { "buni": { "command": "buni", "args": ["mcp", "/path/to/design.buni"] } } }
```

## Documentation

[File format](FORMAT.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Apache 2.0 license](LICENSE)

## Credits

Design guidance references [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (MIT). Fonts come from
[Fontsource](https://fontsource.org); see [FONT-LICENSES.md](FONT-LICENSES.md).
