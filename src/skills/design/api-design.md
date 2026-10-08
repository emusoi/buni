---
name: api-design
description: Designing REST endpoints, GraphQL operations and the data structures they pass — resources, methods, paths, shapes, request and response fields, errors, and tying them to pages — so screens and contracts match. Read before set_endpoint, set_operation, set_shape, connect with an endpoint, or bind.
---
# API design

An endpoint is a promise to every page and agent that uses it. Design it from what the page needs, then check it against the tables it touches.

## Resources and paths
- Paths name things, plural nouns: `/quotes`, `/quotes/{id}`, `/quotes/{id}/lines`. Verbs go in the method.
- Nest one level at most. Deeper relationships use a filter: `/lines?quoteId=…`.
- Ids in paths are opaque strings; never leak row numbers you would regret.

## Methods
- GET reads and never changes anything. POST creates or runs an action. PUT replaces, PATCH changes some fields, DELETE removes.
- An action that isn't CRUD is a POST on a sub-resource: `POST /quotes/{id}/send`.
- Anything a person might retry (payments, orders) takes an idempotency key in the request.

## REST or GraphQL
- A service is one or the other (`set_part` api: rest, graphql, or none for a worker). Don't mix styles inside one service.
- REST when callers are many and simple (webhooks, public APIs, caching at the edge by URL). GraphQL when one client needs many shapes of the same data (dashboards, admin tools) and fetch counts matter.
- Default to REST for a first service; switch a service to GraphQL when pages start stitching three or more endpoints together.

## GraphQL operations
- Queries read, mutations change, subscriptions push. Name them for the reader: `plans`, `plan(id)`, `updatePlan(input)`, `planChanged`.
- Return shapes, not scalars, from mutations (`updatePlan: Plan!`) so clients can refresh without a second query.
- Arguments are shapes too: one `input` argument per mutation (`PlanInput`) beats a list of loose fields.
- Non-null by default; mark `nullable` only when "not found" is a normal answer (`plan(id): Plan`).
- Cache queries only, keyed by every argument that changes the answer (`plans:{currency}`), and list the mutations that make them stale.
- Subscriptions are expensive to run; add one only when a page must update without the person acting.

## Errors
- List the failures a page must handle with `errors`: code and when. REST codes are HTTP statuses (`409` when the plan was retired); GraphQL codes are words (`NOT_FOUND`).
- Every listed error needs a state on the page that calls it. A trace step that can fail shows it.

## Shapes
- A shape is a data structure that moves: `Quote`, `Money`, `QuoteRequest`. PascalCase, and reused wherever the same thing travels, so a change lands everywhere at once.
- Shapes describe what crosses a boundary, not the table behind it. `Quote` for the API may drop `internal_notes` and add `total`.
- Split request and response shapes when they differ: `QuoteRequest` in, `Quote` out.
- When a body is a shape, say so: `set_endpoint {request: "QuoteRequest", response: "Quote"}`. List fields only for a body no shape describes (a filter, a cursor), so one change to the shape reaches every endpoint that sends it.
- Nest by naming another shape (`lines: QuoteLine[]`); keep nesting shallow, two levels at most.
- A field with a fixed set of values is an enum shape (`QuoteStatus`: draft, sent, accepted, declined), not a string with a comment.

## Fields
- Request: only what the client knows. Never ask for what the server can derive (totals, timestamps, owner).
- Response: what the page shows plus the id to act on next. Name fields for the reader (`total`, `createdAt`), not the column.
- camelCase fields; types are `id`, `string`, `integer`, `number`, `boolean`, `datetime`, a shape (`Quote`) or a list (`Quote[]`). buni refuses anything else. Mark optional fields.
- Lists return `{ items, nextCursor }` when they can grow past a page.


## Tie to the UI
- Every submit and every loaded list on a page should name its endpoint: `connect` with `endpoint`, and `bind` the nodes that show response fields.
- If a page shows a value no endpoint returns, the contract is missing a field, or the page is wrong. buni refuses the bind until one is fixed.
- `read_context` with `page:ID` is the check: everything the page needs should be in it.
