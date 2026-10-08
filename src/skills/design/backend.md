---
name: backend
description: Backend fundamentals for designing a system that holds up — performance vs scale, latency vs throughput, consistency and availability, DNS, CDNs, load balancers and proxies, services and discovery, databases (replication, federation, sharding, SQL vs NoSQL), caching strategies, queues and back pressure, protocols, reliability patterns, security, observability and capacity estimates — each tied to where it goes in the design. Read before deciding how a system scales, stays up, stores data or talks between parts.
---
# Backend fundamentals

Everything here is a trade-off: consistency against availability, simplicity against flexibility, read speed against write speed, cost against reliability. A good system design names the trade-off it took and why (decide), not just the boxes. Start simple and add each of these only for a reason you can state.

## Know which problem you have
- Performance problem: slow for one user. Scalability problem: fast for one, slow under load. They have different fixes; measure which before designing for it.
- Latency is how long one action takes; throughput is how many happen per second. Aim for the most throughput at a latency people accept, and write the latency budget per flow (set_trace steps with ms; their sum is what the person waits).
- Write the non-functional needs as a doc section: expected load (requests per second, data size, growth), latency budget, what may be stale and for how long, what must never be lost, availability target.

## Consistency and availability
- When the network splits, a system keeps answering (available, possibly stale) or refuses until it can be sure (consistent). Choose per piece of data: a bank balance wants consistency; a like count can be eventual.
- Weak (reads may miss writes: live video, games), eventual (reads catch up in milliseconds to seconds: feeds, search, email), strong (reads always see the last write: money, inventory, permissions).
- Record the choice per store or flow as a decision, and say what the person sees while data catches up.

## Staying up
- Fail-over: active-passive (a standby takes over; simple, some downtime) or active-active (both serve; better use, needs stateless servers and conflict handling).
- Replication: a primary with read replicas scales reads (replicas lag; never read your own write from one without care); multi-primary scales writes at the cost of conflicts.
- Every store, queue and external needs ifDown (what people see while it's down); every request-path link needs failure (timeout, retries, idempotency key, fallback).
- Availability adds up badly in series (two 99.9% parts in a chain give about 99.8%) and well in parallel; put redundancy where the chain is longest.

## The edge
- DNS routes people to the nearest or healthiest region (latency or geo routing); answers are cached, so changes take time to spread.
- A CDN serves static files and cacheable responses from near the person. Pull CDNs fetch on first request (good for busy sites); push CDNs are uploaded ahead (good for small or rarely changing content). Model it as a cache part in front of the client or service.
- A load balancer spreads requests over identical servers: layer 4 by address (fast), layer 7 by content (route /api to one pool, /static to another). It needs stateless servers: keep sessions in a shared store.
- A reverse proxy (TLS, compression, static files, caching) helps even with one server.

## Services
- Start with one service. Split when parts need to scale, fail, deploy or be owned separately, and say which (decide). A split that shares one database isn't a real split; each store has one writing owner.
- Services find each other through service discovery or the platform (Kubernetes services, a gateway); note it in deployment, not in every link.

## Databases
- Relational by default for structured, related, transactional data. Add a document, key-value, wide-column or graph store only for a need it serves (flexible documents, huge simple lookups, very high write volume, deep relationship queries).
- Scale reads with replicas and caching first. Then federation (split databases by function: users, orders) and only then sharding (split one table's rows by a key), which complicates joins, transactions and rebalancing; choose a key that spreads load evenly and keeps a person's data together.
- Denormalise (store a copy for fast reads) only where reads outnumber writes by 100:1 or more, and say who keeps the copy right.
- Indexes for every query path that matters; record them with decide (tables have no index field yet). Hot tables get partitioned by time or key.

## Caching
- Levels: the browser, the CDN, the server, an application cache (Redis), the database's own.
- Cache-aside (read the cache, load on a miss): simple and the default; data can be stale and a cold cache is slow.
- Write-through (write to the cache, which writes to the store): reads always fresh, writes slower.
- Write-behind (write to the cache, store later): fast writes, risk of loss; only for data you can afford to lose.
- Refresh-ahead: renew before expiry for predictable hot reads.
- Invalidation is the hard part: every write lists what it makes stale (invalidates); the lifetime is a backstop. Never share per-person data without the person in the key (system-design skill).

## Asynchronous work
- Put work that can happen after the response on a queue (emails, exports, webhooks, image processing): the person gets an answer at once and a failure doesn't block the request.
- Delivery is usually at least once, so handlers are idempotent (decide). Order only where it matters, and say per what (per order, per account).
- Back pressure: bound the queue; when full, refuse new work (a 503 with Retry-After) rather than fall over; retry with exponential backoff and jitter; send poison messages to a dead-letter queue.
- Scheduled work (crons) and long jobs get their own part, with what happens if one run is missed or runs twice.

## Talking between parts
- HTTP and REST for public and most internal APIs; RPC (gRPC) for chatty internal calls with strict contracts; GraphQL when many clients need different shapes of the same graph; WebSockets or server-sent events for live updates; webhooks to tell other systems.
- TCP for everything that must arrive whole and in order; UDP only when late is worse than lost (voice, games, live video).
- Each link says what it carries (carries) and its failure policy.

## Reliability patterns
- Timeouts on every call; retries only with idempotency keys, backoff and a cap.
- Circuit breaker: stop calling a failing dependency for a while and fall back.
- Bulkhead: separate pools so one slow dependency can't use every thread.
- Outbox: write the event in the same transaction as the data, then publish, so you never lose or invent one.
- Saga: a multi-step change across services with a compensating step for each, instead of a distributed transaction.
- Rate limits and quotas on public writes, and per person or key on expensive reads.
- CQRS (separate write and read models) only when reads and writes truly diverge in shape and scale.

## Security
- Authenticate every request; authorise every row (set_access with a row rule). Least privilege for services and agents.
- Secrets never in code, logs or the design's examples; personal and secret columns marked with `classification` (design-process).
- Validate input at the edge, encode output, protect against replay (idempotency, nonces) and abuse (rate limits, confirmations on public writes).
- Encrypt in transit everywhere and at rest for personal data; say retention and deletion per kind of data.

## Seeing it run
- Logs (what happened), metrics (how much, how fast: rate, errors, duration per endpoint), traces (one request across parts). Name what each part reports and what pages someone at night (an alert on symptoms people feel, not every cause).
- Health checks for the load balancer and the platform; readiness separate from liveness.

## Back-of-the-envelope
- Estimate before designing: daily actives × actions per day ÷ 86,400 = average requests per second; peak is usually 2–10× average. Storage = items × size × retention.
- Rough costs of waiting: memory about 100 ns, SSD read about 16 µs, a round trip in one data centre about 0.5 ms, a disk seek about 2–10 ms, a round trip across a continent about 70–150 ms.
- Powers of two: 2^10 ≈ a thousand, 2^20 ≈ a million, 2^30 ≈ a billion, 2^40 ≈ a trillion.
- Write the estimate in the non-functional section; it justifies (or rules out) every scaling choice above.

_Adapted in part from [The System Design Primer](https://github.com/donnemartin/system-design-primer) by Donne Martin, licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); rewritten and condensed for buni._
