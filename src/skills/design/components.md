---
name: components
description: Common desktop web components and patterns — buttons, forms, navigation, cards, tables, dialogs, menus, empty and loading states — and when to use each. Read when building UI parts.
---
# Components and patterns

Reuse beats reinvention. Build a part once as a buni component (`make_component`), place it everywhere (`place_component`), and change text per use with `override`.

## Composing components
- One component per role, with variants for its real differences (add_variant, set_variant): a Button with Primary, Secondary, Tertiary and Destructive, not five near-duplicate buttons. Name them "Group / Name" ("Buttons / Primary").
- Variants describe kinds and states (Size, State: Default, Hover, Disabled, Loading), not a pile of independent switches; if two options can't be on together, they're one choice, not two.
- Build bigger parts from smaller ones (a Plant row uses the Icon tile, the Name block and the Action buttons) so a fix in one place reaches everywhere.
- Run library_report now and then: merge near-duplicates (merge_components) and remove what nothing uses.

## Buttons
- Roles: primary (one per view, filled accent), secondary (outlined or tinted), tertiary (text only), destructive (danger colour, never the default).
- Labels are verbs: "Save changes", "Start a quote". Not "OK" or "Submit".
- Height 32–44px on desktop; consistent padding; icon + label only when the icon helps.

## Icons
- One icon set everywhere: Lucide, through `<buni-icon name="…">` (`find_icons` searches). Never text symbols or hand-drawn paths.
- One stroke width per product (1.5–2) and a few sizes: 14–16 in dense UI, 20 in navigation, 24 for feature highlights.
- Icons sit next to a label; an icon-only button needs a tooltip and an aria-label in the build.
- Colour icons with the text colour they sit beside (`--ink-2` for quiet UI, the accent only when selected).

## Navigation
- Marketing: top nav with logo left, 3–6 links, one call to action right.
- Apps: sidebar for sections, top bar for context and global actions. Show the current location clearly.
- Breadcrumbs for hierarchies deeper than two levels. Tabs for peer views of the same thing.

## Forms
- One column. Label above field. Group related fields with a heading.
- Mark the exception: if most fields are required, mark the optional ones.
- Validate on blur, explain errors inline in plain words, and keep the person's input.
- Primary action at the end, aligned with the fields.

## Cards and lists
- A card is one clickable thing with a clear title; do not put five buttons on a card.
- Use a card only when the content is one thing; group everything else with space and alignment. Identical icon-heading-text cards in a row, and cards nested in cards, are tells.
- Lists for scanning many similar items; tables when people compare attributes across items. Right-align numbers in tables.

## Overlays
- Dialog: a decision that blocks the flow. Title says the question, buttons say the answers.
- Popover/menu: options related to what was clicked; closes on outside click and Escape.
- Toast: confirmation of something already done, with Undo where possible. Never for errors that need action.

## States
- Every list, table and page has an empty state: what goes here, why it is empty, and the action to fill it.
- Loading: skeletons that match the final layout for content; spinners only for short, indeterminate waits.
- Errors: what happened, why if known, and what to do next.

## Flows
- Link screens with `connect`, name the path with `set_flow`, and write the experience with `set_journey` so the whole flow is reviewable, not only screens.
