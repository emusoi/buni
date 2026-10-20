# Inspiration libraries

A folder of UI and UX patterns, each one a self-contained HTML file, that buni and its agents use as reference
when designing. This folder is buni's own library; anyone can keep their own (`buni inspiration add <folder>`).

## A pattern

One `.html` file per pattern, anywhere under the library (folders group them: `navigation/`, `forms/`, …). It opens
with a comment that says what it is, then a full document:

```html
<!--
name: Command palette
tags: navigation, search, keyboard
use: Jump to any place or run any action from the keyboard, in an app with many places and commands.
avoid: Small sites with a handful of pages; people who never touch the keyboard need the same actions in the UI.
why: One shortcut (⌘K) reaches everything; fuzzy matching forgives typos; recent and suggested items fill the
  empty state so it is useful before typing.
seen in: Linear, Raycast, Vercel, GitHub
-->
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Command palette</title><style>…</style></head>
<body>…</body>
</html>
```

- `name`, `tags`, `use` are required; `avoid`, `why` and `seen in` are encouraged. A value may continue on lines
  indented by two spaces.
- The document is a realistic screen at 1440px wide (or the component in context on a page), with real-looking
  content, not lorem ipsum. Original markup and CSS: no copied code, logos or brand assets from the products named.
- Self-contained: CSS in one `<style>`, no scripts, no external fonts, images or icons (inline SVG is fine). Colours,
  type and spacing as CSS custom properties on `:root`, so the pattern reads as structure, not a brand.
- It passes buni's review: AA contrast, text 12px and up, targets 24px and up, nothing spilling out of its box.
