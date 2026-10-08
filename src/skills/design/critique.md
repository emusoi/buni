---
name: critique
description: Reviewing and refining a design — a shared vocabulary of lenses (critique, audit, polish, distill, bolder, quieter, typeset, layout, colorize, animate, harden, onboard, clarify, delight, adapt), what each looks for and fixes, and a bounded review loop with screenshots. Read before reviewing a design, when the person asks for one of these by name, or before calling work done.
---
# Critique: review with names, fix in rounds

A shared vocabulary makes feedback precise. When the person says "make it quieter" or "polish the settings page", use the matching lens. When reviewing on your own, run the lenses that fit the surface.

## The loop
1. Look: screenshot every screen in scope (and each important state, at each promised width). A picture shows what the tree hides.
2. Find: review against the direction, the principles and the tells in one batched pass. Write the findings down, worst first, each with where it is and what's wrong.
3. Fix: fix everything you found in one round.
4. Check: screenshot again, once. Fix only what's still wrong.
5. Stop. Endless self-review costs more than it finds; report what you changed and what's left for the person to decide.

## The lenses
- critique: a design review of hierarchy, clarity, flow and feel. Can someone tell what the screen is for in three seconds? Does the most important thing win? Does it feel like this product (direction) or like a template (tells)? Score each screen and name the top three problems.
- audit: the technical floor. Contrast, keyboard and focus, hit targets, headings and labels, behaviour at every width, long content, states. Report each failure with the fix.
- polish: the final pass before handing off. Alignment to the grid and scale, consistent components and tokens, real punctuation and copy, every state present, nothing off by a pixel. Don't change the design; perfect it.
- distill: strip to the essence. Remove what doesn't serve the job: extra labels, duplicate actions, decorative containers, a second accent, the section nobody needs. Take one thing away, then one more.
- bolder: amplify a timid design. Find the one element that should be memorable and commit to it (scale, type, colour, image, layout move); keep the rest quiet so it stands out.
- quieter: tone down an overstimulating design. Fewer accents, less saturation, less motion, fewer containers and borders, more space; keep the one bold thing and calm everything else.
- typeset: fix type. Faces right for the subject, a real scale, measure, leading, hierarchy in three levels, craft details (tabular figures, punctuation, breaks).
- layout: fix spacing, alignment and rhythm. Everything on the scale and the grid, proximity that reads, more space above headings, rhythm between sections, density right for the surface.
- colorize: bring strategic colour to a flat or monochrome design. Derive it from the subject, one accent with a job, tinted neutrals, semantic colour only for state.
- animate: add purposeful motion. One orchestrated moment and responses to actions, with the right durations and easing, interruptible, reduced-motion respected (motion skill). Remove motion that has no purpose.
- harden: make it survive real use. Error and empty states, loading without flicker, long and short content, translated strings, slow and failed requests, permissions, offline where it matters (interaction skill).
- onboard: design the first run. The empty state as an invitation with one clear first action, progressive disclosure, sensible defaults, what a new person needs to know and nothing more.
- clarify: fix the words. Labels in the person's language, actions that say what they do and keep their names through the flow, errors with the problem and the fix (ux-writing skill).
- delight: add personality where it earns its place (an empty state, a success moment, a small detail tied to the subject), never at the cost of speed or clarity.
- adapt: make it work on another size or device. Narrow and wide layouts, touch targets, safe areas, input methods, platform conventions (layout and mobile skills).

## Writing findings
- Specific and located: "Today, the 'Coming up' header has more space below than above, so it floats" beats "spacing is off".
- Say why it matters and what you'll do: the principle it breaks and the fix.
- Separate what you fixed from what the person should decide (taste calls, product questions).
- For a recorded review of a whole piece, use review and discuss on that piece so the notes live with the design.

_The lenses are named after the commands of [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (MIT)._
