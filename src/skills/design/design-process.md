---
name: design-process
description: The design around the system — requirements and phases (why each piece exists), open questions and the options weighed, assumptions, roles and who may call what, what happens when a hop fails or a part is down, personal data, and review — so an agent builds the right thing and asks instead of guessing. Read before set_requirement, set_question, set_role, set_access or review.
---
# The design process

A system design says what to build. This part says why, what is not settled yet, who may do what, and what happens when things break. An agent reading the brief follows it; where it is silent, the agent guesses.

## Requirements and phases
- A requirement is an outcome someone can check: "A buyer sends a quote in under a minute", not "quote service". Give it a priority: must, should or could.
- Phases say when things ship: `v1`, `later`. Every must belongs to a phase. set_phase, then set_requirement {phase}.
- Tie each requirement to what serves it with serve {requirement, id}: parts, calls, tables, traces, pages. A requirement nothing serves is a gap; a piece no requirement needs is a question worth asking.

## Questions, options and assumptions
- Write down what is not decided: set_question {text, options: [{name, pros, cons}], about: [ids]}. Two or three real options, each with its honest cost.
- An assumption is something the design takes as given ("under 500 quotes a day"). Record it as kind assumption so someone can say it is wrong.
- Decide with decide_question {question, option, why}; it also records a decision. Agents must not build around an open question; they ask.

## Who may call what
- set_role for each kind of person ("buyer", "admin"). Then set_access on every endpoint and operation: public, signed-in, or roles; and a rule for which rows ("only their workspace's quotes").
- A public write needs a rule saying what stops abuse: rate limits, a confirmation, a captcha.

## When things fail
- On every request-path call link: link_parts {failure: {timeoutMs, retries, idempotencyKey, fallback}}. Retries without an idempotency key double writes.
- For every store, queue and external: set_part {ifDown} says what users see while it is down.
- On trace steps, ifFails says what the person sees if that hop fails.

## Data that needs care
- Give columns a `classification` in set_table: `personal` (about a person: email, name, address) or `secret` (tokens, password hashes: never shown or logged).
- Personal data in a cache needs the viewer, user or workspace in the key.

## Review
- review {id, state}: draft, proposed, changes, approved. Propose a piece when it is ready to read; approve when the person agrees.
- discuss {target, body} starts a thread on any piece; discuss {thread, body} replies; discuss {thread, state: "resolved"} closes it.
- The brief shows open threads and review state next to the piece, so an agent sees them before building.
