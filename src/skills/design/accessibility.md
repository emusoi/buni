---
name: accessibility
description: Designing so everyone can use it — contrast, text size, targets, focus, colour independence, motion and structure. Read before finalising any screen.
---
# Accessibility

Accessible design is better design for everyone. Build it in, do not bolt it on.

## Contrast
- Body text: at least 4.5:1 against its background. Large text (24px+, or 19px+ bold): at least 3:1.
- Icons, input borders and focus rings that carry meaning: at least 3:1 against what is next to them.
- Placeholder text is not a label; if it must be read, it needs body-text contrast.
- Check text on images and gradients at their lightest point; add a scrim if needed.

## Text
- Body text 16px on desktop web; never below 12px for anything people must read.
- Line length 50–75 characters for reading; line height 1.4–1.6 for body.
- Layouts must survive 200% zoom and longer translated strings without clipping or overlap.

## Targets and pointer
- Click targets at least 24×24px, preferably 32px+ for primary controls; keep 8px between adjacent targets.
- Make the whole row or card clickable when it represents one thing, not just the text inside.

## Colour is never the only signal
- Pair colour with text, icon or shape: errors get a message and an icon, not just red.
- Links in running text are underlined or otherwise distinct beyond hue.
- Charts use labels or patterns as well as colour.

## Focus and keyboard
- Every interactive element has a visible focus style with 3:1 contrast; do not remove outlines without a replacement.
- Tab order follows reading order. Dialogs trap focus and return it when closed.

## Structure
- Use real headings in order (h1 → h2 → h3), landmarks (header, nav, main, footer) and buttons for actions, links for navigation.
- Every image that carries meaning has alt text; decorative images have empty alt.
- Form fields have visible labels, not just placeholders; errors sit next to the field they describe.

## Motion
- Animations are short and purposeful; nothing essential depends on motion.
- Offer a reduced-motion path: fades instead of slides, no parallax, no autoplay.
