---
name: color
description: Building a palette from the subject — roles not hues, neutrals with temperature, one accent with a job, semantic colour, dark surfaces, states, charts and contrast. Read when setting tokens or restyling.
---
# Color

Colour should communicate, not decorate. Derive it from the subject, define it once as tokens by role, and keep it disciplined.

## Start from the subject
- Look at the brief's world: its materials, places, objects and light (soil and leaf, steel and safety orange, paper and ink). A palette taken from there is distinctive; one taken from habit looks generated (tells skill).
- Describe the core palette as 4–6 named hex values with roles before building. Working in OKLCH makes even lightness steps and matched saturation easier.

## Roles, not paint
Set tokens before building (buni `tokens`), named for what they do:
- `--bg`, `--surface`, `--surface-2`: page, panels, raised panels.
- `--ink`, `--ink-2`, `--ink-3`: primary, secondary, tertiary text.
- `--line`: dividers and borders.
- `--accent`, `--accent-ink`, `--accent-tint`: the action colour, text on it, and a soft background.
- `--success`, `--warning`, `--danger` (with tints): states only, never decoration.
Use `var(--…)` everywhere; a raw hex in a layer is a bug.

## Neutrals carry the design
- 80–90% of a screen is neutrals. Give them a slight temperature (warm or cool) that matches the subject, and keep it consistent.
- Separate surfaces with small lightness steps (2–5%), not heavy borders.
- Text is rarely pure black; a very dark tinted neutral reads softer. Don't use near-black stand-ins like #111 by habit either: pick the dark that fits the palette.
- On a coloured surface, secondary text is tinted toward that surface's hue (or a lighter version of the foreground), never a flat grey.

## One accent with a job
- One accent for interactive and selected things. If everything is accented, nothing is.
- The saturated accent marks the primary action and the current selection; its tint covers hover and soft emphasis.
- A second accent needs a job (a data series, a category), recorded as a decision.
- Keep saturation in check: an accent that shouts on every screen gets tiring in an app people use all day.

## Semantic colour
- Red means destructive or error, amber caution, green success. Don't use them for branding on the same screen, and a red brand still needs a distinct danger style.
- Always pair with text or an icon, never colour alone.

## States
- Hover, pressed and focus states have more contrast than the resting state, not less.
- Disabled reduces contrast and drops shadows, but its label stays readable.

## Charts
- Use colour-blind-safe series colours, label directly where possible, and never rely on colour alone (pattern, position or labels too).

## Dark surfaces
- Choose light or dark for how the product is used (a cockpit at night, an editor all day), not by product category.
- Not inverted light mode: raise surfaces by getting lighter, not by adding shadow. Desaturate the accent slightly; use about 90% white for text to reduce glare.

## Checks
- Contrast: body text 4.5:1, large text and UI parts 3:1 (WCAG 2). APCA gives a more accurate perceptual check when in doubt.
- Squint test: the most important thing on the screen is the most contrasting thing.
- Does the palette still feel like this product if you take the logo away?
