---
name: depth
description: Surfaces, elevation, shadows, borders, radius and translucency — how layers read as layers. Read when styling cards, menus, dialogs or toolbars.
---
# Depth and materials

Depth tells people what is on top, what is interactive and where they can go back to.

## Elevation levels
Define a few levels and use only those:
- 0 page: flat background.
- 1 surface: cards and panels. A 1px line or a 2–4% lightness step; shadow optional and faint.
- 2 raised: dropdowns, popovers, sticky bars. Soft shadow, e.g. `0 4px 16px rgba(0,0,0,.08)`.
- 3 overlay: dialogs and sheets. Stronger shadow plus a scrim behind (`rgba(0,0,0,.3)`).

## Shadows
- Shadows come from one light direction (above), are soft and low-contrast, and grow with elevation.
- A shadow needs offset as well as blur to read as light; a coloured glow with no offset is decoration, not depth.
- Pair a semi-transparent border with a shadow for crisp edges; on a tinted background, tint the shadow and border toward the same hue.
- Combine a tight shadow for the edge with a wide one for lift rather than one heavy shadow.
- Never use shadows on text, and avoid them on flat, non-interactive content.

## Borders and radius
- Borders are for separation when whitespace is not enough; keep them light (`--line`).
- Pick a radius scale (e.g. 4 / 8 / 12 / 20) and nest correctly: inner radius = outer radius − padding.
- Similar things share a radius: all buttons, all cards, all inputs. Different roles may differ: one radius on everything regardless of hierarchy is a tell.
- A child's radius is never larger than its parent's, and corners stay concentric.

## Translucency
- Blurred translucent bars (`backdrop-filter: blur(20px)` with a semi-opaque fill) keep context visible under sticky headers and sidebars. Use them for that job only; glass as decoration on cards and heroes is a tell.

## Interactive depth
- Hover: slight lift or tint. Pressed: flatten or darken. Disabled: reduce contrast, no shadow.
- Don't make static content look pressable (no shadows on things that do not click).
