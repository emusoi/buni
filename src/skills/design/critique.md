---
name: critique
description: Reviewing and refining a design — a shared vocabulary of lenses (critique, audit, polish, explore, distill, bolder, quieter, typeset, layout, colorize, animate, harden, onboard, clarify, delight, adapt), what each looks for and fixes, a bounded review loop with screenshots, and snapshot-then-improve for a page that already ships. Read before reviewing a design, before improving an existing product, when the person asks for one of these by name, or before calling work done.
---
# Critique: review with names, fix in rounds

A shared vocabulary makes feedback precise. When the person says "make it quieter" or "polish the settings page", use the matching lens. When reviewing on your own, run the lenses that fit the surface.

## The loop
1. Look: screenshot every screen in scope (and each important state, at each promised width). A picture shows what the tree hides.
2. Find: review against the direction, the principles and the tells in one batched pass. Write the findings down, worst first, each with where it is and what's wrong. Then run review_page: it checks the rendered page for what a careful reviewer flags every time (motion, contrast, type, targets, overflow, tells) and scores it out of 100. Judge first, check second, so the checks don't narrow what you look for; merge both lists.
3. Fix: fix everything you found in one round. A problem repeated across layers (one grey on 60 timestamps) is one find_nodes {style, replace_with} edit, ideally to a token.
4. Check: screenshot again and run review_page again, once. Fix only what's still wrong.
5. Stop. Endless self-review costs more than it finds; report what you changed and what's left for the person to decide.

## Improving a real product: snapshot, then improve
When the work is to improve something that already ships, start from the thing itself, not from memory or a description. Every change then answers a problem you can point at.
1. Snapshot: import_html_page the live page (url, or file for a local build), at each width it ships, onto a page with no route named "<Screen> · Now" (a board: site export skips it). Add source_file and symbol when you know them, so findings lead back to the code. Leave the snapshot untouched; it is the evidence.
2. Look and find: buni shot it and run the loop's Find step on the snapshot. Pin each of your findings to the layer it is about with comment {node, body}: what is wrong, the principle it breaks, the fix. Then review_page {page, pin: true} pins the mechanical issues the same way and gives the snapshot its score.
3. Improve: duplicate_page {page, name: "<Screen> · Next", route} and make the fixes there, worst first. Change what the findings name; keep the content, function and conventions people rely on (direction skill: refining, not redesigning, unless the person asked for one).
4. Show before and after: screenshot both and run review_page {page: Next, against: Now}, which gives both scores and what was fixed, what remains and what is new. Mark each comment addressed, and tell the person which findings each change answers and which are theirs to decide.
If the person snapped the page with buni's Chrome extension, the "· Now" page is already there: start from step 2. Skip the snapshot only when the page doesn't exist yet. A JavaScript-rendered app (most products) needs live: true, which runs its scripts and captures it once it settles; a signed-in page also needs cookies (the Cookie header from a signed-in session, as "name=value; …") and wait_for set to something only the real page shows, so a login screen fails loudly instead of being imported. Don't write a capture script of your own. Snapshot every screen in scope before improving any, so the fixes stay consistent across them.

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
- explore: try 3 or 4 real alternatives before settling. explore_page {page, options: [{name, idea}]} makes each a copy to change on its own; vary named axes (what comes first, density, layout, type, colour), keep the content, data and components fixed, and write each idea as a bet ("Proof first: buyers trust lead times before they ask for a price"). Build each fully, then compare_options reviews them side by side; judge the bets, ask_person when the choice is theirs, and pick_option {option, why} makes the winner live (the why is kept as a decision).
- delight: add personality where it earns its place (an empty state, a success moment, a small detail tied to the subject), never at the cost of speed or clarity.
- adapt: make it work on another size or device. Narrow and wide layouts, touch targets, safe areas, input methods, platform conventions (layout and mobile skills).

## Severity
Tag every finding, yours and review_page's alike: P1 gets in someone's way (can't read it, can't hit it, content hidden), P2 a careful reviewer would send back, P3 polish. Would someone contact support about it? Then it is at least P1. Fix in that order.

## Writing findings
- Specific and located: "Today, the 'Coming up' header has more space below than above, so it floats" beats "spacing is off".
- Say why it matters and what you'll do: the principle it breaks and the fix.
- Separate what you fixed from what the person should decide (taste calls, product questions).
- For a recorded review, pin the findings as comments on their layers (comment, or review_page with pin) so the notes live with the design.

_The lenses are named after the commands of [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (MIT)._
