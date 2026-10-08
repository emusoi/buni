---
name: mobile
description: Designing native and mobile apps — platform conventions (iOS and Android), reach and touch targets, safe areas, navigation, sheets and gestures, keyboards and forms, system type and dark mode, latency and offline. Read when designing screens for phones or tablets, or adapting a web design to them.
---
# Mobile and native apps

A phone is held in one hand, used in passing, in sunlight, on a train, with a thumb. Design for that, and for the platform people already know.

## Follow the platform
- iOS and Android have conventions people rely on (navigation, back, sheets, switches, share). Use them unless you have a strong reason, and design both where both ship: an iOS-shaped app on Android feels foreign.
- System fonts (SF Pro, Roboto) respect each platform's text settings; a brand face can lead in headings.
- Support the system text size (Dynamic Type, font scale): layouts must grow, wrap and scroll, never clip.
- Support light and dark appearance; test both.

## Touch and reach
- Targets at least 44×44pt (iOS) or 48×48dp (Android), with at least 8pt between neighbours.
- The bottom of the screen is easiest to reach with a thumb: put primary actions and navigation there; keep destructive actions away from where people tap often.
- Nothing depends on hover. Every gesture (swipe to delete, long press) has a visible alternative.
- Press states show instantly; a subtle scale-down (about 0.97) or highlight confirms the touch.

## Safe areas and layout
- Keep content inside safe areas (notch, home indicator, rounded corners, status bar); backgrounds can bleed to the edge.
- Design at a common width (390pt) and check small (360) and large (430) phones, plus tablet if it ships.
- One column; side-by-side only for short items. Horizontal scrolling only for carousels that clearly look scrollable.

## Navigation
- A bottom tab bar for 3–5 top-level destinations; more goes into a "More" tab or a different structure.
- Stack navigation within a tab, with a reliable back (and the platform's back gesture working).
- Sheets for focused sub-tasks and pickers; full-screen modals for flows that need full attention, always with a clear way out.
- Don't hide primary navigation behind a hamburger.

## Keyboards and forms
- The right keyboard per field (email, number, phone, one-time code) and autofill (contacts, addresses, passwords, codes from SMS).
- Inputs at least 16px so the browser doesn't zoom on focus (web); the focused field stays visible above the keyboard.
- Short forms; one question per screen for long flows, with progress.

## Speed and connection
- Show cached content first and refresh in place; skeletons for first loads.
- Optimistic actions with a clear rollback if the network fails.
- Design the offline and poor-connection states for anything people do on the move.
- Keep motion short and native-feeling (sheets slide from the bottom, pushes slide from the side); respect reduced motion.

## In buni
- Design mobile pages at the device width (create_page with width 390, or set_widths) and keep the same tokens and components as the web, adapting density and placement rather than starting over.
- Note platform differences (iOS vs Android back, share sheets) in a comment on the screen (comment) so builders get them right.
