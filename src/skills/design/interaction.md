---
name: interaction
description: How interfaces respond — keyboard and focus, hit targets, every state of a control, loading without flicker, optimistic updates, destructive actions and undo, forms that help, state in the URL, feedback and announcements. Read when designing anything people click, type into or wait on.
---
# Interaction

Design what happens, not only what it looks like: every control has states, every action has feedback, every wait has a plan.

## Keyboard and focus
- Everything works by keyboard, in reading order. Visible focus on every focusable thing, with 3:1 contrast; show it for keyboard use (`:focus-visible`).
- Dialogs and drawers trap focus while open and return it to what opened them.
- Autofocus the single primary input on desktop (a search, a name field); not on mobile, where the keyboard jumps the layout.
- Frequent actions get shortcuts; show them in menus and tooltips, with the platform's symbols.

## Targets
- What looks clickable is clickable, all of it: a whole row, a whole card, a checkbox with its label. No dead zones.
- Hit targets at least 24×24px on desktop and 44×44 on touch, with space between neighbours.

## States of a control
- Design rest, hover, pressed, focus, disabled, loading and error for each control that has them. Hover and pressed are more contrasting than rest, not less.
- A loading button keeps its label and adds a spinner, so the layout doesn't jump.
- Menu items that open a dialog, and loading labels, end with an ellipsis ("Rename…", "Saving…").

## Waiting
- Under about 150–300ms, show nothing. Longer, show a skeleton (for content) or a spinner (short, unknown waits); once shown, keep it at least 300–500ms so it doesn't flicker.
- Skeletons match the final layout exactly.
- Optimistic updates: show the result at once, then reconcile with the server, rolling back with a clear message if it fails.

## Destructive actions
- Prefer Undo to "Are you sure?". Confirm only what can't be undone, and the confirmation says exactly what will be lost ("Delete 3 projects and their files?").
- The destructive button names the action ("Delete projects"), never "OK".

## Forms
- Every field has a visible label; clicking the label focuses the field. Placeholders show an example ("+1 (555) 010-0199"), never the label.
- One column; related fields grouped; optional fields marked when most are required.
- Validate when someone leaves a field, explain errors next to the field in plain words, keep what they typed, and move focus to the first error on submit.
- Don't block keystrokes (let someone type, then say what's wrong); allow paste everywhere, including codes and passwords.
- The right keyboard and autofill for each field (email, phone, one-time code, address).
- Enter submits a single-line form; in a multi-line field, ⌘/Ctrl+Enter submits.
- Keep the submit button enabled until submission starts; then show progress and prevent double submits.
- Warn before leaving with unsaved changes.

## State people can share
- Filters, tabs, search, pagination and open panels live in the URL, so back, forward, refresh and sharing a link all work. Restore scroll position on back.
- Navigation uses links, so opening in a new tab works.

## Feedback
- Every action gets a response where the person is looking: the row updates, a toast confirms with Undo, an inline message explains.
- Announce asynchronous results (toasts, validation) to screen readers politely.
- Tooltips are a last resort; prefer an inline explanation. Delay the first tooltip in a group, then show the rest without delay.

## In a design
- Show the states that matter as screen states (create_page with state, or duplicate_page) and link them (connect, with the condition that leads there), so a builder sees loading, empty, error and success, not just the happy path.
