---
name: logo
description: Designing a logo, wordmark, mark or app icon — meaning first, drawn as shapes, optically corrected, checked small, exported as a set. Read before drawing any logo or icon.
---
# Logo

A logo is a promise made small. It has to mean something, read at 16 pixels, and survive being black on white.

## Start from meaning
- Ask what the name means and what the product does. Many names carry a meaning worth drawing (a word in another language, a place, a founder's story). Say it in one sentence before drawing.
- One idea per mark. A logo that explains everything says nothing: pick the single detail that carries the meaning (a pen nib for a writing app, a seedling for a garden service, a key for a password manager).
- Offer three directions that differ in idea, not in colour: e.g. a wordmark with one telling detail, a letter-mark, and an abstract symbol. Then refine the one the person picks; do not keep polishing all three.

## Draw it as shapes
- Make the logo a graphic: create_page with no route and a size (512×512 for a mark, 1200×400 for a wordmark, 1024×1024 for an app icon).
- Draw with one `<svg>` holding paths, circles and rects. Letters are drawn, not typed: text depends on the viewer's fonts, shapes do not. If text must stay text, use one of the faces buni embeds (typography skill).
- Change it with set_svg (same layer, new markup) rather than deleting and writing again.
- Keep a system: one stroke weight, one corner or cap style, one x-height. A family of marks (several products) shares all three and differs only in its detail.

## Correct it by eye, not by numbers
- Overshoot: round letters (o, a, b, g) must go slightly past the x-height and baseline, about 2% of the height, or they look smaller than the straight ones.
- Optical spacing: equal gaps look wrong. Give straight-to-straight pairs the most room, round-to-round less, diagonal-to-round least. Look at the word blurred; no letter pair should clump or gape.
- Details sit a consistent distance from the letters they belong to and never touch them. If a detail reads as an accent or another letter (a bar over an a reads as ā, a dot over a b as a stray i), move it.
- Where shapes are cut or broken, use square ends (butt caps) at the cut; round caps turn a clean cut into a blob.
- Centre by the visual mass, not the bounding box: a mark whose detail flies off one side needs nudging back.

## Black and white first
- Design in black on white. If it does not work in one colour it will not work in colour. Add colour last, if at all.
- Check it reversed (white on black) too; a wordmark in currentColor works on both.

## Check it small
- Check it at 16, 32, 48 and 64 px on light and dark (`buni shot` at small scales, or the editor's preview). The smallest dot or gap must still be visible at 32; at 16 the silhouette alone must hold.
- A wordmark will not read at favicon size. Give the product a mark (usually the letter or detail that carries the idea) for favicons and app icons, and keep the wordmark for places with room.

## App icons
- An app icon is a square graphic: the mark on a solid background, the mark taking about 60% of the width, kept inside the central 80% so round and squircle masks do not clip it.
- For macOS draw the rounded square with a transparent margin (about 10% each side); for PWA and phone icons the background fills the whole square.
- `buni icons FILE PAGE DIR` (with the buni desktop app) writes every size, favicon.ico and AppIcon.icns.

## Deliver
- A wordmark, a mark, an app icon, each as its own graphic page, plus the one-sentence meaning in the design doc.
- Export SVG for the drawings (`buni shot FILE PAGE out.svg`) and PNG at 1× and 2× (`--scale 2`) for anywhere SVG is not accepted.
