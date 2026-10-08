---
name: terminal
description: Designing terminal software — full-screen TUIs (Bubble Tea, Ratatui, Textual, Ink), output a CLI prints, tmux status lines, layouts, popups and menus, zellij plugins, Neovim floats and splits, shell prompts and pickers — on a grid of character cells, driven by keys. Read before making a terminal client, a terminal screen, or key links.
---
# Terminal screens

A terminal screen is a grid of character cells: every box, gap and line is a whole number of cells, one monospace font, colour from a palette, and no images or mouse to rely on. buni designs it; whoever builds it writes the Go, Rust, Python or TypeScript.

## Clients, targets and frameworks
- A terminal client is a client part with `terminal.targets`: each target is a language and, when it draws full screens, a framework. Go: Bubble Tea with Lip Gloss. Rust: Ratatui. Python: Textual. TypeScript: Ink, OpenTUI or pi-tui. A CLI that only prints, a tmux script or a prompt names a language and no framework.
- Design the screens once. Several targets build the same screens in different frameworks so the person can compare them; the first target is the main one. Unless asked, give one target.
- Keep the design framework-neutral: boxes, borders, lists, inputs and keys every target can draw. When one framework can't do something the design needs (a popup over the screen, mouse), say so in a comment on the screen (comment) rather than designing around one framework.
- Speak the frameworks' words in the client part's purpose and in comments so the builder maps straight across: Lip Gloss styles and borders, Bubbles components (list, table, textinput, viewport, spinner, help); Ratatui `Block`, `List`, `Table`, `Paragraph`, `Tabs`, `Gauge`, `Layout` constraints; Textual widgets, screens and TCSS; Ink `<Box>`, `<Text>`, `useInput`; OpenTUI's `BoxRenderable`, `TextRenderable`, `SelectRenderable` and `renderer.keyInput`; pi-tui's `Container`, `SelectList`, `Input`, overlays and `matchesKey`.
- Each target gets its own brief: `read_context` with `target` ("ratatui", "opentui", or the language for a target with no framework), `buni context FILE part:ID --target ratatui` on the command line.
- tmux, zellij and Neovim are hosts, not frameworks. Say which language drives them: "a Go binary prints the status segments; tmux runs it every 5s", "a Rust zellij plugin (zellij-tile)", "a Neovim plugin in TypeScript over the remote API".

## Surfaces
Pick the surface the screen really is (`create_page` with `terminal`, or `set_screen`):
- `app`: takes over the whole terminal (the alternate screen). Design at 120×36, and check it still works at 80×24.
- `inline`: printed into the scrollback by a command: prompts, progress, tables, results, errors. No height; it grows. Keep it short, end on what to do next, and never redraw what scrolled away.
- `tmux-status`: one row, the full window width. Left segments say where you are (session, window), right ones say state (agents busy, time). Separate segments with spacing or one glyph, not decoration.
- `tmux-layout`: a window split into panes. Draw each pane as a frame sized in cells; put another screen in a pane with a component instance.
- `tmux-popup`: a floating box over the window (`display-popup`), usually 60–80% of it, holding a small TUI. Esc or q closes it.
- `tmux-menu`: a short list of choices, each with its key (`display-menu`). Eight items at most.
- `zellij-plugin`: a pane or floating pane drawn by a plugin; the same grid rules.
- `nvim-float` / `nvim-split`: a floating window or split inside Neovim. Floats get a border and a title; splits fill their side.
- `prompt`: a shell prompt, one or two rows. Say the most useful thing first; it must read with colour off.
- `picker`: an fzf-style list with a query line, the matches, and the selected one marked; arrows or ctrl+n/p move, enter picks, esc leaves.

## Drawing on the grid
- One monospace font everywhere; set it on the screen's frame and nothing else. A cell is 9×18px on the canvas.
- Sizes are whole cells: width in multiples of 9px, height in multiples of 18px. Padding is 1 cell sideways and 0 or 1 row; gaps are 1 cell.
- Spaces in text are kept, as a terminal keeps them, so a column of counts can be padded with spaces. Rows of several parts are still a flex frame with fixed widths in cells, `justify-content: space-between` for left and right parts of a bar.
- Borders are the box-drawing styles every framework has: `1px solid` for single, `3px double` for double, `1px solid` with `border-radius` for rounded, `2px solid` for thick. On a terminal screen a border is drawn in whole cells, a row above and below and a column each side, and a box's width counts its border: a 24-column box is `width: 216px`, border included.
- Emphasis is bold, dim, reverse (swap text and background) or underline, then colour. Reverse is how the selected row looks in most TUIs.
- No images, no shadows, no gradients, no half cells. Icons are characters: ✓ ✗ ● ○ › ▸ ⠋ (spinner frames).
- Every edit on a terminal screen is checked against these rules, and the tool's reply lists what breaks them ("On the terminal grid:"): fix those before moving on.
- Check the grid by reading the screen back as text: `read_screen` (or `buni shot FILE PAGE out.txt`) shows each cell as a terminal would, borders as box drawing. Text that lands on a border, columns that drift, or collapsed spaces show there before a builder finds them. That text is also what the builder matches.

## Colour
- Design for the screen's `colors` and say what happens with colour off: every state still readable from text, symbols and reverse video. `NO_COLOR` users and pipes see the "none" version.
- With 16 colours, paint only with the terminal's own palette so the user's theme applies: `var(--term-black)`, `var(--term-red)`, `--term-green`, `--term-yellow`, `--term-blue`, `--term-magenta`, `--term-cyan`, `--term-white` and their `--term-bright-…` forms, plus `var(--term-fg)` and `var(--term-bg)`, the terminal's own text and background. Reverse video is `background: var(--term-fg); color: var(--term-bg)`. Use red for errors, yellow for warnings, green for done, and never colour alone.
- Truecolor is for apps that own their look; still ship a 16-colour fallback.

## Keys
- Every action has a key, and every screen says its keys: a help line at the bottom (`↑↓ move · enter open · / search · q quit`) or `?` for a help screen. Link screens with `connect` and `trigger: "key"`.
- Follow what people already know: q or esc leaves, ? helps, / searches, enter opens, tab moves focus, j/k or arrows move, ctrl+c always quits. In tmux, bindings sit after the prefix ("prefix g").
- Never require the mouse. Mouse support is a bonus, not a path.

## States to design
For each screen: loading (a spinner and what it is waiting for), empty (what to do first), error (what failed and the key to retry), narrow (the 80-column layout), and long (scrolling, with where you are: "12/240").
