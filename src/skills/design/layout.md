---
name: layout
description: Grids, a spacing scale, proximity and rhythm, alignment (geometric and optical), density, width, responsive structure and content that can be any length. Read when composing a page or when things feel cluttered or misaligned.
---
# Layout

Layout is how people find things. Consistent spacing and alignment make a screen calm; deliberate variation gives it character.

## Spacing scale
- One scale on a 4 or 8px base: 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Put it in tokens and record the base as a decision.
- Space means relationship: tight within a group, generous between groups. Inside a card < between cards < between sections.
- More space above a heading than below it, so the heading belongs to what follows.
- Prefer flex/grid `gap` to margins; it keeps spacing in one place.

## Grid and width
- Desktop content width about 1120–1280px with 24–48px gutters; full-bleed only for backgrounds and imagery.
- A 12-column grid gives halves, thirds and quarters. Items in a row share widths and align their top edges.
- Text inside wide layouts stays within a readable measure (typography skill).

## Alignment
- Everything aligns to something: a column edge, a baseline, another element's edge. Few alignment lines make a calm screen.
- Left edges matter most; ragged left edges look broken. Left-align body text; centre only short headlines and single lines.
- Optical over geometric: nudge an icon, a play triangle or a round shape by a pixel so it looks centred. Balance an icon beside text by weight and size, not just by box.

## Density
- Match density to the surface (direction skill): airy for persuade and experience, comfortable for read, compact where people scan and compare (tables 32–40px rows; forms and settings 44–56px).
- Dense isn't cramped: keep the scale, align strictly, and use type weight instead of borders to separate.

## Rhythm and variance
- A page is a sequence of sections, each with one idea. Vary rhythm between them (dense then airy, image then text) so scanning stays comfortable.
- Choose variance on purpose: symmetry for calm and trust, asymmetry (split screens, offset columns, deliberate whitespace) for energy. A centred hero with three equal cards below is the default; use it only when it really is the best layout.
- Structure is information: borders, numbering and dividers say something about the content (a numbered list is a sequence), never decoration.

## App screens
- Fixed chrome (sidebar 220–280px, top bar 48–64px) and a scrolling content area.
- Navigation left or top, content in the middle, context (inspector, details) on the right.
- Show only scrollbars that are useful; nothing should overflow by accident.

## Responsive
- A design must work at the widths it promises: check narrow (390), laptop (1280–1440) and wide (1920+) (set_widths). Wide screens shouldn't stretch text or leave content lost in space.
- Respect notches and safe areas on mobile surfaces.
- Prefer layouts that flow and wrap over fixed pixel positions.

## Content of any length
- Design for short, typical and very long content: a two-letter name, a 60-character title, an empty list, a list of 500. Truncate with a full value available, wrap where reading matters.
- Skeletons and placeholders match the final layout, so nothing jumps when content arrives.

## Checks
- Squint: do groups read as groups?
- Is every gap from the scale, and every edge aligned to something?
- Does it hold at every promised width, with the longest real content?
