# The tablet API

How the buni tablet app (android/, Kotlin + Jetpack Compose) talks to `buni open` on the Mac. It is served only on the
tablet listener: a port on the Mac's 127.0.0.1 that `adb reverse` brings to the tablet's `localhost:<port>` over the
USB cable. Nothing here is reachable from a network.

The Mac starts the app with:

    adb shell am start -n app.emusoi.buni/.MainActivity --es url 'http://localhost:<port>/tablet/v1?code=<CODE>'

`<CODE>` works once, for two minutes. The app trades it for a token and keeps the token (and the base URL) until the
Mac sends a new one.

## Auth

`POST /tablet/v1/pair` with `{"code": "ABCD2345"}` answers `{"token": "…", "file": "/designs/arch/parcel-arch.buni",
"device": "Galaxy Tab S7 FE 5G"}`. A used or old code is `403 {"error": "…"}`.

Every other call sends `Authorization: Bearer <token>`. Without it, or with a forgotten one: `401 {"error": "…"}`.
`file` is the design path the pairing gave, passed as `?file=` on every call.

## Reading

`GET /tablet/v1/design?file=F` — everything the app draws, in one answer:

```json
{
  "file": "/designs/arch/parcel-arch.buni",
  "name": "parcel-arch",
  "version": 42,
  "levels": {
    "context": MAP,
    "system": MAP
  },
  "api": API,
  "pages": [{ "id": "p1", "name": "Choose items", "route": "/return/items", "width": 390, "marks": 3 }],
  "flows": [FLOW],
  "marks": [MARK],
  "plans": [PLAN]
}
```

`version` goes up with every change; the app can skip redrawing when it hasn't moved.

MAP is a laid-out map, in map units (the editor's pixels at 100%):

```json
{
  "width": 1180, "height": 760,
  "boxes": [{ "key": "returns-api", "ids": ["returns-api"], "x": 400, "y": 120, "w": 220, "h": 96,
              "label": "Service", "name": "Returns API", "sub": "Node 22 · REST",
              "tone": "live" }],
  "frames": [{ "key": "g1", "x": 380, "y": 60, "w": 520, "h": 400, "title": "The system" }],
  "links": [{ "key": "l1", "ids": ["l1"], "from": "gateway", "to": "returns-api", "label": "calls",
              "tone": "live", "points": [[300, 160], [400, 160]], "at": [350, 160] }]
}
```

`tone` is `live`, `planned` (dashed teal: a plan's proposal), `deploy`, `added` or `removed`.

API is the API view, laid out the same way:

```json
{
  "width": 980, "height": 520,
  "callers": [{ "id": "buyer-portal", "name": "Buyer portal", "label": "Next.js", "x": 24, "y": 72, "w": 176, "h": 80, "to": ["gateway"] }],
  "cards": [{ "part": "returns-api", "name": "Returns API", "kind": "rest", "spec": "openapi.yaml",
              "x": 640, "y": 48, "w": 376, "h": 260,
              "sections": [{ "label": "Operations", "y": 100 }],
              "rows": [{ "op": "op1", "y": 126, "h": 30, "method": "POST", "path": "/returns/{id}/refund",
                         "field": null, "returns": null, "note": "202", "about": "Refunds a return…",
                         "request": "RefundRequest { amount, reason }", "responses": ["202 Refund queued"] }] }],
  "resolves": [{ "from": "op-graphql-field", "to": "op-rest-call" }]
}
```

FLOW is a flow laid out for the app, in its own units: the usual path left to right (`step` 1, 2, 3…), and under each
step the screens a condition sends people to (`step` null). Screens are drawn from `page.png`, cropped to their box.

```json
{
  "id": "f1", "name": "Return an item", "width": 1100, "height": 709,
  "screens": [{ "page": "p0", "name": "Find your order", "x": 175, "y": 48, "w": 150, "h": 324, "step": 1,
                "when": null, "back": null, "card": [137, 384, 176, 92] },
              { "page": "p4", "name": "Not found", "x": 149, "y": 596, "w": 93, "h": 116, "step": null,
                "when": "The number and email don't match (404)", "back": "Choose items", "card": null }],
  "links": [{ "from": "p0", "to": "p1", "label": "Find my order", "when": false, "points": [[325, 112], [610, 112]], "at": [467, 90] },
            { "from": "p0", "to": "p4", "label": "The number and email don't match (404)", "when": true, "points": [[250, 372], …], "at": [195, 438] }],
  "moves": [{ "from": "p4", "to": "p1", "label": "Try again", "when": null }],
  "lanes": ["Doing", "Thinking", "Feeling", "Risk"],
  "journey": [{ "page": "p1", "confidence": 3, "cells": { "Doing": "Ticks the shirt, picks Wrong size", "Risk": "…" } }]
}
```

`label` is what the person taps for the usual path, the condition (`when: true`) for the others; `at` is where it
sits. The other screens carry `when` (what sends people there) and `back` (the step they lead back to); a step with a
journey carries `card`, where it sits under it (x, y, w, h). `moves` is every way on from every screen, drawn or not:
what walking the flow offers. `journey` is what the person does, thinks and feels on each step, in `lanes` order.

MARK is a pen mark, on a page, an architecture view or a flow:

```json
{ "id": "c1", "view": "system", "page": null, "flow": null, "on": "jobs", "onName": "Jobs", "kind": "Circle",
  "said": "Drew a mark on Galaxy Tab S7 FE 5G.", "from": "Galaxy Tab S7 FE 5G", "state": "open",
  "strokes": [{ "tool": "pen", "color": "#c8331f", "width": 2.5, "points": [10, 20, 30, 40] }] }
```

`view` is `context`, `system`, `api`, `page`, `flow` or `sketch` (a new screen drawn on the Screens canvas, outside any
page). Points are x, y pairs: map units for the architecture views, the
page's own pixels for `page`, the flow's units for `flow`. `state` is `open`, `addressed` (Claude answered it) or `resolved`.

PLAN is a proposal waiting for the person (what Claude wrote in answer to marks). `plans` is oldest first; the app shows the last, the answer to the latest marks:

```json
{ "id": "plan1", "name": "Check returns for fraud before refunding", "issue": "RET-231",
  "about": "I read “fraud check?” as a service…",
  "changes": [{ "id": "fraud-check", "change": "add", "title": "Fraud check, a service", "detail": "Scores each return" }] }
```

`GET /tablet/v1/canvas?file=F` — the Screens canvas as the editor lays it out (slow the first time: the Mac draws every
page for it, their heights place the rows):

```json
{ "width": 9000, "height": 4200, "origin": [520, 280],
  "boards": [{ "page": "p1", "name": "Choose items", "x": 2480, "y": 280, "w": 390, "h": 844 }],
  "titles": [{ "x": 280, "y": 280, "name": "Return an item", "pages": 8 }],
  "links": [{ "id": "k1", "from": "p0", "to": "p1", "label": "Find order button", "d": "M 475 380 V 230 Q …", "dot": [475, 380], "at": [481, 225] }] }
```

`d` is an SVG path of M, V, H and Q. `origin` is where the editor's canvas 0, 0 is: a sketch's points are the editor's,
so the app draws them moved by it.

`GET /tablet/v1/page.png?file=F&page=P` — the page drawn by the Mac at its own width (PNG). It changes when the page
does; send `If-None-Match` with the last `ETag` to get `304`.

`GET /tablet/v1/events?file=F` — `text/event-stream`. A `data: changed` line (then a blank line) each time the design
changes; a comment line (`: ping`) every 15 seconds keeps it open. Read `design` again on `changed`.

## Writing

The tablet draws and decides on plans. It never edits the design otherwise.

- `POST /tablet/v1/marks?file=F` with `{"view": "system", "page": null, "on": "jobs", "strokes": [STROKE], "body": "optional typed words"}`
  answers `{"id": "c9"}`. For `view: "page"`, give `page` and, as `on`, the layer id under the mark if known (else
  null: it goes on the page's frame). For the architecture views, `on` is the part or link id under the mark, or null.
  For `view: "flow"`, give `flow` and, as `on`, the page of the screen under the mark (else null: the flow's first).
  For `view: "sketch"`, give the strokes in the editor's canvas units (the canvas's, less `origin`).
- `POST /tablet/v1/marks/erase?file=F` with `{"id": "c9"}` answers `{"ok": true}`.
- `POST /tablet/v1/send?file=F` with `{"view": "system"}`, `{"view": "page", "page": "p1"}`, `{"view": "flow", "flow": "f1"}` or `{"view": "screens"}` (every marked page and
every sketch, from the canvas) puts a request for the
  coding agent on the Mac's clipboard; answers `{"count": 2, "copied": true, "picture": "/path/on/the/mac.png"}`.
  Add `"picture": "<base64 PNG>"`: what the tablet shows, the view with its ink, as the person sees it. The agent can't
  read handwriting any other way on the architecture views and flows, so the app always sends one there (on pages it's optional:
  the Mac can draw page marks itself). Up to 4 MB.
- `POST /tablet/v1/plan?file=F` with `{"plan": "plan1", "action": "merge" | "discard"}` answers `{"ok": true, "reply": "…"}`.
  A merge may carry `"skip": ["change-id", …]`: additions the person unticked, dropped before the rest is merged. (Only
  additions can be left out.) Merging and discarding aren't confirmed; the editor on the Mac can undo either.

Errors are `{"error": "words a person can read"}` with a 4xx status.
