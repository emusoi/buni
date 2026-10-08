---
name: typography
description: Choosing faces for the subject, a real type scale, measure and leading, hierarchy, type as an active part of the design, and the details that show craft. Read when choosing fonts, setting the scale, or when hierarchy feels flat or noisy.
---
# Typography

Most of an interface is text, and type carries the personality of the page. Choose it on purpose.

## Choose faces for this subject
- Pick faces that belong to the brief's world, not the families you'd use on any project. A field guide, a bank, a toy and a developer tool should not share a typeface.
- One family is often enough. Two at most, and if two, make them clearly different (a characterful display with a quiet text face), not two similar sans-serifs.
- Inter, Roboto, Arial and the system stack are the defaults of generated pages; use them only when the brief or the brand asks.
- A text face must stay readable at 14–16px: open shapes, clear Il1 and O0, enough x-height.
- A monospace only for code, data and tabular figures, never as a "technical" costume.
- Load only the weights you use (usually a regular, a medium or semibold, a bold). For web designs, use faces that can be self-hosted or are on Google Fonts.

## Faces buni draws
These render on the canvas, in previews, in images and on the exported site (all weights 100–900); any other family falls back to the system sans-serif everywhere, so pick from here unless the brief names a face, and then say a builder must load it.
- Sans: Manrope, Inter, Bricolage Grotesque (characterful, warm), DM Sans (soft, geometric), Space Grotesk (quirky, technical), Instrument Sans (precise, editorial), Plus Jakarta Sans (friendly, modern), Schibsted Grotesk (newsy, sturdy), Figtree (clean, approachable).
- Serif: Fraunces (soft, expressive display), Newsreader (reading, editorial), Source Serif 4 (dependable text), Playfair Display (high-contrast display), EB Garamond (classic, literary).
- Display: Unbounded (wide, bold), Syne (art-school, eccentric).
- Mono: JetBrains Mono.

## A scale, not guesses
- Use a modular scale and put it in tokens, in the spirit of The Elements of Typographic Style: a ratio (1.2 for dense apps, 1.25–1.333 for most products, 1.5+ for editorial and marketing), starting from a 16px body.
- A dependable desktop set: 12 / 14 / 16 / 20 / 24 / 32 / 44 / 60, with display sizes above that for persuade surfaces. Display type tops out around 6rem.
- Leading: about 1.5 for sans-serif body, a little more (1.55–1.65) for serif body, 1.2–1.3 for headings, 1.0–1.1 for display.
- Tracking: tighten large display slightly (to about -0.02em; never past -0.04em); body at 0; small text a touch looser only if the face needs it.

## Measure
- Body text 50–75 characters per line (65ch is a good default); never over 80. Serif text can run a little longer than sans.
- Wide layouts hold narrow text columns. A paragraph across a 1280px container is unreadable.

## Hierarchy
- Three levels per screen are usually enough: title, section, body. A fourth often means the layout needs restructuring.
- Change one property at a time for emphasis: size, or weight, or colour.
- Secondary text uses a lighter ink rather than a smaller size where possible.
- Headings get more space above than below, so they belong to what follows.

## Type as design
- When type is a headline or a visual element, make the treatment itself part of the design (scale, weight, width, the way lines break), not a neutral container for words.
- Don't accent one word in a headline with italic, bold or colour; let the whole line carry it.
- Avoid all-caps labels and eyebrows over headings; sentence case reads faster and looks less templated. Use caps only where a convention needs it (short codes, some navigation).

## Details that show craft
- Tabular figures for prices, tables, timers and counters (`font-variant-numeric: tabular-nums`).
- Real punctuation: curly quotes, en dashes for ranges, the ellipsis character (…), a non-breaking space between a number and its unit ("10 MB").
- No orphans or widows in headlines and short paragraphs: rewrite or rebalance the break.
- Text layers need `margin:0` in buni; control space with the layout's gap.
- Test with real content at every width: long names, translated strings and big numbers must not overflow.
