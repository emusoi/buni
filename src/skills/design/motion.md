---
name: motion
description: When to animate and when not, what to animate, durations by size and distance, easings, entering versus leaving, interruptible and gesture motion, one orchestrated moment, and reduced motion. Read before adding any animation or transition.
---
# Motion

Motion explains change: where something came from, what it became, what caused it. Used sparingly it guides attention; scattered everywhere it reads as generated and gets in the way.

## When to animate
- To answer a person's action: opening, expanding, confirming, moving something they dragged. This motion is welcome when it shows what changed.
- To draw attention to one thing that matters (a new result, an error that appeared off-screen).
- For one orchestrated moment on a persuade surface: a single page-load sequence or one reveal lands better than effects on every section.

## When not to
- Because it looks cool, on something people see many times a day.
- On mount, with no trigger: unexpected motion disorients.
- Scroll reveals in product UI or above the fold; keep them for rare marketing moments.
- Fade-and-slide-up on every section, hover lifts on every card, infinite loops, bounce and elastic easing: the generic defaults (tells skill).
- Anything that delays focus or the completion of a task: those stay immediate.

## What to animate
- `transform` and `opacity`: they don't trigger layout and stay smooth. Avoid animating width, height, top or left.
- Colour and background changes are fine for state feedback.
- Blur, clip-path, masks and shadow can carry a reveal or a depth change when the moment earns it.
- Never `transition: all`; name the properties.
- Set the transform origin where the thing physically comes from (a menu grows from its button).

## Durations
Scale with the size of the change and the distance travelled; routine interactions stay under 300ms.
- Button press: 100–160ms. Hover colour: about 200ms; hover transform: 100–150ms.
- Small popover or tooltip: 125–200ms. Dropdown: 150–250ms.
- Modal or drawer: 200–350ms. Full-screen slide: 250–400ms.
- One duration for everything is a tell: different moves need different times.

## Easing
- Entrances and anything that should feel responsive: a strong ease-out, e.g. `cubic-bezier(0.22, 1, 0.36, 1)`.
- Panels and slides: `cubic-bezier(0.25, 1, 0.5, 1)`. A dramatic reveal: `cubic-bezier(0.19, 1, 0.22, 1)`.
- Avoid ease-in for interface motion: it starts slowly, so the screen lags the person's action.

## Entering and leaving
- Frequent, small UI (hover highlights, toggles) appears instantly and leaves in 100–150ms, so actions feel immediate.
- Occasional, larger UI can enter a little slower and leaves quicker than it came.
- Paired states match: if opening animates, closing does too.

## Interruptible and gestural
- People change their minds mid-animation; motion must retarget smoothly from where it is (transitions do; restarted keyframes don't).
- Direct manipulation follows the finger or pointer exactly with no easing; ease only after release, and add friction at boundaries instead of hard stops.
- Every gesture has a tap or keyboard alternative unless the gesture is the point.

## Reduced motion
- Honour `prefers-reduced-motion`: replace travel with an instant change or a short fade, drop parallax and autoplay.
- Nothing essential may depend on motion. Autoplaying media longer than 5 seconds needs a pause control.

## In a design
- Put motion on the layers with set_motion; it plays in an editor's preview and on the exported site, and the canvas shows each layer at rest. One motion per trigger:
  - load (as the page opens) and scroll (as it comes into view) take an entrance: fade, rise, scale, slide-left, slide-right, blur.
  - hover and press take a response: lift, grow, shrink, dim.
  - staggerMs on an entrance moves the layer's children one after another (a list, a row of features) instead of the layer as one.
  - Easing: out for nearly everything, in-out for movement between places, dramatic for the one hero reveal.
- Choose the one orchestrated moment first (usually the load sequence of a persuade page's hero: headline, then supporting line, then the product, 100–250ms apart), then add scroll entrances only where a section's arrival tells the story, and press responses on the main actions.
- Reduced motion is handled for you: every set_motion is skipped for people who ask for less.
- What set_motion can't express (a cross-fade between product colours, a shared-element move between pages) goes in the journey (set_journey) or a comment on the layer (comment): what moves, from where, how long, which easing. A builder can't infer it from a still frame.
