---
name: principles
description: The foundations every screen is held to: hierarchy, progressive disclosure, consistency, contrast, accessibility, proximity and alignment, how perception groups things, feedback and forgiveness. Read first on any new design.
---
# Design principles

Good interfaces feel obvious: people see what matters, understand what they can do, and get it done without thinking about the interface. These principles come from how people perceive (the Gestalt laws) and from decades of product work. Hold every screen to them.

## 1. Hierarchy: the important thing is seen first
- Decide what someone must see first, second and third on each screen, then make the design say it. If you can't rank the content, the screen isn't designed yet.
- Build rank with size, weight, contrast and position, in that order, before boxes and colour. Change one property at a time for emphasis.
- What is above the fold, or first in reading order, is the most valuable space. Spend it on what people came for, not on decoration or chrome.
- Navigation tells people where they are, like a book's running header: section, page, current item.
- Squint test: blur your eyes. The thing that still stands out must be the most important thing.

## 2. Progressive disclosure: the right amount at each step
- Show what is needed for the current decision; reveal the rest when it becomes relevant (an "Advanced" section, a second step, a detail panel).
- Split long tasks into short steps, each with one purpose. A ten-field onboarding form reads as three easy screens.
- Always orient: where am I, how many steps are left, how do I go back. Never lose someone between steps.
- Don't hide what people need often. Disclosure is for the rare and the advanced, not for the core.

## 3. Consistency: the same thing looks and works the same
- One button style per role, one spacing scale, one type scale, one icon set, one word for one thing. Build a part once as a component and reuse it.
- Follow platform conventions people already know (links look like links, destructive actions look dangerous, back goes back) unless you have a strong reason, and write the reason down as a decision.
- Every inconsistency makes someone stop and wonder why. A button that is suddenly larger than its siblings reads as "this one is different": make sure it is.

## 4. Contrast: difference carries meaning
- High contrast for what needs attention now (the primary action, an error, the current selection); lower contrast for what supports it.
- A destructive action can be the high-contrast one when it is the point of the dialog ("Delete account" in red), with the safe choice quiet beside it.
- Contrast isn't only colour: size, weight, space and motion all set things apart. Use the least that works.
- If everything is emphasised, nothing is.

## 5. Accessibility: it works for everyone
- More than one in four people have some vision impairment, and everyone is sometimes in bright sun, in a hurry or one-handed.
- Contrast that passes (4.5:1 body text, 3:1 large text and UI parts), text alternatives for images, full keyboard use, visible focus, targets big enough to hit, and nothing that relies on colour alone. The accessibility skill has the details.

## 6. Proximity: what belongs together sits together
- People read nearness as relationship. Put controls next to what they act on, and group related fields, actions and information.
- Separate what doesn't belong: a player keeps play, skip and seek together and puts "exit" apart, so a wrong tap doesn't end the film.
- Space between groups is larger than space within them. Tight groups, generous separation.

## 7. Alignment: everything lines up with something
- Use a grid. Every element aligns to a column edge, a baseline or another element's edge; nothing is placed by eye alone.
- Few alignment lines make a calm screen. Ragged left edges look broken.
- Optical beats geometric when they disagree: nudge an icon or a round shape a pixel so it looks centred.

## How people group what they see
- Similarity: things that look alike read as alike. Same style, same meaning; different style, different meaning.
- Common region: a shared background or border groups things, so use it when space alone can't.
- Figure and ground: overlays, menus and dialogs must sit clearly above what they came from.
- Continuity and closure: people follow lines and complete shapes, so a row of aligned items reads as one sequence.

## Feedback and forgiveness
- Every action gets a visible response: a pressed state, progress, a result, or an error that says what to do next.
- Make actions reversible (Undo) rather than asking "are you sure?". Confirm only what can't be undone, and say exactly what will be lost.
- Empty, loading and error states are designed screens, not afterthoughts.

## Practice
- Design the path, not just the screens: place each element where the person's flow needs it next, and link screens into flows (connect, set_flow).
- Make it effortless: consistent navigation, clear feedback, search and shortcuts for frequent tasks. The best interface goes unnoticed.
- Shortcuts for people who repeat a task often (keyboard shortcuts, recent items, defaults that remember), without getting in the way of people who don't.
- Test with real content and real tasks. Screenshot your work and look at it before calling it done.

## Before you call a screen done
1. Can someone say what the screen is for in three seconds?
2. Does the most important thing win the squint test?
3. Is there exactly one primary action?
4. Do related things sit together and does everything align to the grid?
5. Are empty, loading and error states designed?
6. Does it pass contrast and work by keyboard?
7. Does it follow the design doc's decisions and direction?
