---
name: system-design
description: How to lay out the system behind the pages — clients, services, stores, caches, queues and externals, the links between them, the data each link carries, and caching — so an agent can build any piece from the file alone. Read before set_part, link_parts or caching an endpoint.
---
# System design

The system view answers "what runs, and who talks to whom". Keep it at the level a new engineer draws on a whiteboard in five minutes.

## Parts
- **client**: where pages live (web app, mobile app, admin). Put every page in one with `place_page`.
- **service**: code you run that serves requests or does work (API, worker, cron). Owns endpoints.
- **store**: where data rests for good (Postgres, S3). Owns tables.
- **cache**: where copies rest for a while (Redis, a CDN). Losing it must only cost speed.
- **queue**: where work waits (SQS, Kafka topic). Owns events.
- **external**: someone else's system you call (Stripe, Resend, Auth0).
- `purpose` is one sentence a stranger understands. `tech` names the actual choice ("Postgres 16"), not the category.

## Start small
- Begin with one client, one service, one store. Split only for a reason you can name: different scaling, different team, different failure domain, different language.
- A second service that shares the first one's database is not a second service. Give each store one writing owner.
- Add a queue when work can happen after the response (emails, exports, webhooks), or when one failure must not block another.

## Links
- `calls` for synchronous requests; `publishes` and `subscribes` for async. `reads`/`writes` only to stores and caches.
- Clients call services, never stores. Stores and queues never start a link.
- Endpoints can only read, write or emit through a link their service has; buni refuses anything else, so draw the link first.
- Put the why in `note` when it isn't obvious ("read replica for reports").
- Say what travels: `carries` names the shapes on a link. A link with nothing named is a link nobody can build against.

## Caching
- Cache only what is read far more than it changes, and only after naming who can tolerate stale data and for how long. Write that as a decision.
- Only GET responses are cached. Give each a lifetime (`ttlSeconds`) and a key that includes everything the response varies by: `quote:{id}`, `plans:{currency}`. A key that misses a variable serves one person's data to another.
- Every endpoint that changes the data lists the cached endpoints it makes stale in `invalidates`. The lifetime is the backstop, not the plan.
- Never cache per-person data in a shared cache without the person in the key. Never cache errors.
- Start with no cache; add one where a measured or expected hot read needs it.

## Traces
- A trace follows one thing a person does ("Submit a quote") through every part, in order: `set_trace`. Each step goes over a link that exists, names the endpoint, operation or event it uses and the shape it carries.
- Mark steps after the response `async`. Give request-path steps a time budget (`ms`); their sum is what the person waits.
- Write a trace for every flow that writes data or crosses more than two parts. If a trace can't be drawn, a link or a call is missing.

## Intent lives in the doc
- Record each architecture choice with `decide` ("one Postgres, no ORM", "at-least-once delivery; handlers are idempotent"). Decisions are what agents follow when the diagram is silent.
- Write non-functional needs as a doc section: expected load, latency budget, what may be stale, what must never be lost.

## Hand it off
- `read_context` with `part:ID` is the brief for whoever builds that part; check it reads complete before handing it over.
- If the brief needs a paragraph of explanation, that paragraph belongs in the doc or a decision.
