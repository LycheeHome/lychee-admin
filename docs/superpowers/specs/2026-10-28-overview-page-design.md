# Overview page: triage and recent activity at `/`

Date: 2026-10-28 (brainstorm begun 2026-10-27, paused for reconciler history, resumed 2026-10-28)

## Decision record

- **Purpose: triage plus recent activity.** "Is the whole host OK?" and "what just happened?" on one page. An inventory-style summary (counts and versions for their own sake) was not chosen.
- **`/` becomes the overview; the sites list moves to `/sites`.**
- **Named `overview`**, not `home` or `dashboard`. The rail's other labels name what is on the page (`sites`, `services`, `reconciler`, `infrastructure`); `home` names a position, and `dashboard` is generic product language that DESIGN.md's Warm Terminal voice avoids. The wordmark is already the "take me home" control.
- **Tiles are always visible** (one per rail destination, with ok/bad/unknown counts). Rejected: a single quiet line that expands only on trouble, and listing every site and unit (which repeats the list and the boards).
- **The rail loses all per-item health:** site-row dots, host-link chips, the top bar's count, and the `health unavailable` line. **One signal** remains, on a new `overview` link. The user first asked for the signal on `sites`. That was rejected because `sites` will link to `/sites`, so a whole-host signal would point somewhere that does not show the trouble.
- **Find keeps its attention-first order and per-row state.** Find is a destination picker, and which destination is broken is part of choosing.
- **The audit log gets its own page later.** `/activity` is sub-project 3. The overview shows a short slice of it, with no `see all` link until that page exists.
- **Reconciler history was made a prerequisite, and has shipped.** The inventory stamps `last_run` on every tick, publishes `skipped` on most of them and holds only the latest run, so it cannot be a timeline. lychee-ops now publishes a transitions feed: lychee-contract v2.1.0, `schemas/events.schema.json`, agreement A-HIST-1, lychee-ops #63–65. An earlier idea, annotating the app's deploy requests with their live outcome, was dropped: the reconciler's own `deployed` / `failed` events now follow the app's `requested`.
- **Approach A:** the tiles, the attention list and the rail signal all read the existing `/api/health` query (one poll, one counting function). A new `/api/activity` merges the two activity sources on the server. Rejected: one aggregate `/api/home` (two endpoints would report the same health and could drift apart), and merging on the client (the page would fetch the whole board payload, and the kind mapping would live where `/activity`'s server-side paging cannot reuse it).
- **Visual treatment is not decided here.** The form of the tiles, the `overview` signal and the activity table goes through impeccable's comparing-design-variants procedure after this spec is approved. The chosen variant is written into this spec under "Visual decision" before writing-plans.

## Why

Health is spread across four pages plus the rail. The rail shows it as a dot per site and two chips per host link on every page, which makes the navigation carry a dashboard's job in a 250px column. Nothing anywhere shows what has happened recently: the app's own audit log is written and never read, and the reconciler's outcomes existed only as each unit's latest state.

## Goal

- `/` shows four tiles, a needs-attention list when needed, and the last eight events from the app and the reconciler together, each labelled by who did it and what kind of action it was.
- The rail is navigation plus one whole-host signal on `overview`.
- The sites list lives at `/sites`, unchanged.

## Non-goals

- The `/activity` page, paging or filtering (sub-project 3).
- Any change to the sites list's own markup, the boards, the site page beyond its link targets, the find box, or any write route.
- A new tone or colour. New status words.
- Changes to lychee-ops or lychee-contract. The feed is consumed as published.

## Decisions

### 1. Data and API

**Contract.** `contract.lock` goes from v2.0.0 to v2.1.0. `src/lib/platform.ts` gains `PATHS.events = "/var/lib/lychee-inventory/events.json"`. A-HIST-1 states that path, but `constants.json` does not list it, so a contract test reads `AGREEMENTS.md`'s A-HIST-1 section and requires the path to appear there.

**Reconciler feed reader:** `readReconcilerEvents(fs)` in `src/lib/reconcilerEvents.ts`. It returns the lifetimes as typed values, or `null`. The A-HIST-1 reader rules are requirements:
- A missing file, unparseable JSON or a wrong top-level shape returns `null` ("no history"), never a throw.
- Unknown event `type`s and unknown fields are dropped silently. An event whose known type lacks a required field is dropped, not the whole file.
- `last` is never read.
- When a name has two open lifetimes (`removed_at: null`), only the one with the later `added_at` counts as open. The other is treated as closed.
- Branching uses `gate_code`, never `gate`.

**Audit reader:** `readAuditTail(fs, n)` in `src/lib/auditLog.ts`. It reads `config.logFile` and returns the last `n` lines that parse as JSON objects with a string `timestamp` and `action`, skipping malformed lines without counting them. A missing or unreadable file returns `null`. v1 reads the whole file and takes the tail, which is fine at this host's volume of a few lines a day. The reader is the only place that knows this, so it can become a backwards read without changing anything else.

**Merge, node-free:** `buildActivity(audit, lifetimes, ctx, limit)` in `src/views/activityModel.ts`. `ctx` holds the managed hostnames in the Caddyfile and the inventory's name → href map. The module must stay free of node built-ins and `js-yaml`, which `clientImports.test.ts` already enforces if the client imports it. `/activity` will reuse it.

```ts
// src/shared/activity.ts (types only)
type ActivityWho = "app" | "reconciler";
type ActivityKind = "add" | "remove" | "deploy" | "attach" | "repository" | "prune" | "files" | "host" | "stop";
interface ActivityEvent {
  at: string;            // ISO timestamp
  who: ActivityWho;
  kind: ActivityKind;
  subject: string;       // hostname or inventory name
  href: string | null;
  outcome: string;       // short phrase, mono
  tone: "ok" | "bad" | "neutral";
}
interface ActivityPayload {
  events: ActivityEvent[];
  sources: { app: boolean; reconciler: boolean };
  now: string;
}
```

**Order.** Newest `at` first. Reconciler events sharing one `at` within a lifetime came from one tick, so their A-HIST-1 order (`added`, `deployed`/`stopped`/`down`, `recovered`, `failed`/`blocked`/`awaiting-image`, `removed`) is reversed. Ties across sources put the reconciler event before the app event, because a reconciler act at the same second as a request is its effect. Then the first `limit` events are kept.

**Mapping, reconciler events** (`who: "reconciler"`):

| Event | kind | outcome | tone |
|---|---|---|---|
| `deployed` | deploy | `<from> → <to>`, or `→ <to>` when `from` is null | ok |
| `failed` | deploy | `failed at <step name>` (the text of `failed_step` before the first `: `) | bad |
| `blocked` | deploy | `blocked · <gate_code>` | bad |
| `awaiting-image` | deploy | `awaiting image` | neutral |
| `recovered` | deploy | `recovered after <attempts> attempts` (`1 attempt` when singular) | ok |
| `stopped` | stop | `stopped` | neutral |
| `down` | stop | `down, was <from>` | neutral |
| `added` | add | `declared` | neutral |
| `removed` | remove | `pruned` | neutral |

The `gate_code` shows as the code itself, in mono. It is a machine fact, and the board's deploy line is where codes get prose.

**Mapping, audit actions** (`who: "app"`). The `-failed`, `-rolled-back`, `-rollback-failed` and `-refused` variants keep their kind and take the bad tone, with outcome `failed`, `rolled back`, `rollback failed` or `refused`. `detail`, when present, is not shown in v1.

| action | kind | outcome |
|---|---|---|
| `add-site` | add | `added` |
| `remove-site` | remove | `removed` |
| `delete-site-files` | files | `files deleted` |
| `deploy-service` | deploy | `requested` |
| `attach-site` | attach | `attached` |
| `detach-site` | remove | `retired` |
| `change-repository` | repository | `repository changed` |
| `prune-declaration` | prune | `pruned` |
| `refused-cross-site` | attach | `refused` (bad) |
| `host-action` | host | `<hostAction> started`, or `<hostAction> refused` (bad) when `outcome` begins `refused` |

A successful `deploy-service` is logged with the tag as its whole `detail` (`src/routes/services.ts`), so its outcome reads `<tag> requested`. The `-failed` variant's `detail` is free text (`<tag>: <reason>` or an error string) and is never shown. An unknown audit action is dropped, so new actions do not render as raw strings.

**Links.** A subject links to `/sites/<hostname>` when it is a managed hostname still in the Caddyfile, or when it is a site resource (`<label>-lychee-land`) whose hostname is still in the Caddyfile. It links to its board row (the same href `UnitHealth` uses) when it is an inventory entry still listed. Otherwise there is no link: a pruned resource or a removed site has nowhere to go.

**Endpoint:** `GET /api/activity?limit=<n>` in `src/routes/activity.ts`. The default and the overview's request are both 8. Values below 1 or non-numeric fall back to 8, and the limit is capped at 50. It always answers `200`, with `sources.app` / `sources.reconciler` false for a reader that returned `null`. Neither source is cached: they are two small files, and the audit log changes on every write. A Caddyfile that cannot be read means no site links, never an error. It sits behind the same basic auth and `sameOrigin` middleware as every route.

**`/api/health` gains `generated: string | null`**, the inventory's write time, which the route already has from `loadBoardPage`.

### 2. The rail and the `overview` signal

**Removed** from `src/client/components/Rail.tsx`:
- The status dot on site rows. Rows keep the label and the `static`/`:<port>` hint.
- The chips on all four host-side links.
- The `health unavailable · last read` line.
- The top bar's overall count.

`attentionCounts` stays: the overview tiles and the signal use it.

**Added:**
- An **`overview`** link at the top of the rail nav, above the `sites` heading, linking to `/` and `aria-current="page"` there. The wordmark stays the h1 and keeps linking to `/`, with no signal.
- `sites` links to `/sites`.

**The signal's states**, from `attentionCounts(...).total`:

| State | Shown | Screen reader, after "overview" |
|---|---|---|
| `total.bad > 0` | Scorch | `, <n> need attention` (or `needs`) |
| `total.bad == 0`, `total.unknown > 0` | neutral | `, <n> couldn't be read` |
| everything clean | nothing | nothing |
| health poll failed (no data, or the last read errored) | neutral | `, health unavailable` |

A remembered green never shows: after a failed read the signal is neutral, whatever it was before. Whether it shows a dot, a number or split numbers is the visual decision. Its states are fixed here.

**Top bar (below 900px).** The same signal, on the menu button that opens the drawer holding `overview`.

**The poll is unchanged:** `GET /api/health` every 15s, only while the tab is visible and again on focus, with the same query key. The overview page reads that query too, so it adds no poll and no host reads.

**Find is unchanged.**

### 3. The overview page

`/` renders `OverviewPage` (`src/client/pages/OverviewPage.tsx`) in `AppFrame`'s 1080px column:
- Title `overview · lychee admin`, following the existing per-page title pattern.
- An `Overview` heading, which takes focus on an in-app arrival under the same rule as the other pages (not when focus is in the find box).
- The route loader primes the health and activity queries.

**Tiles.** Four, in rail order, each a router link to its page:
- **sites** → `/sites`
- **services** → `/services`
- **reconciler** → `/reconciler`
- **infrastructure** → `/infrastructure`

Each shows its total and noun (`9 sites`, `6 units`), then its bad count (Scorch) and unknown count (neutral), each only when non-zero. Counts are `attentionCounts`' per-page numbers, so a tile always agrees with its page's summary line and with what its rail link counted before this change. The reconciler tile also states `last tick <age>` from `generated`. With no inventory (`units: null`), the three unit tiles read `inventory unavailable` in neutral. When the health poll has failed, the tiles drop their counts rather than show stale ones.

**Needs attention.** Present only when `total.bad + total.unknown > 0`:
- One row per thing, counted as `total` counts: a site and its container are one row, bad if either is.
- Each row is a link (the site's page, or the unit's board row), with the subject, its state word and where it lives (`site`, `services`, `reconciler`, `infrastructure`).
- Bad rows first, then unknown rows under a neutral subheading, in Caddyfile order for sites and inventory order for units.
- The state words come from the health payload's `label`, which is the boards' and the site pages' vocabulary.
- When the poll fails, this block is replaced by `health unavailable · last read <age>`, or `health unavailable` before any successful read.

**Recent activity.** The last 8 events as a table with columns: age (`2m`, `4h`, `1d`, in a `<time datetime>` with the exact local time as its title), who, kind, subject (a router link when `href` is set), and outcome (toned).
- No events and both sources readable: `Nothing recorded yet.`
- One source unreadable: one neutral line under the table, `Reconciler history couldn't be read; showing app actions only.` or `The audit log couldn't be read; showing reconciler events only.`
- Both unreadable: `Activity couldn't be read.` alone.
- The query polls every 15s while visible and on focus. A failed re-read keeps the last good table under a `role="alert"` line, `Couldn't refresh activity: <reason>`, matching the other live pages.
- No `see all` link until `/activity` exists.

**Not on this page:** the sites list's pills and its host-trouble line stay on `/sites`.

### 4. Routing and links

**Server (`src/routes/sites.ts`):**
- `GET /` keeps answering the static document, always `200`.
- New `GET /sites` answers the same document, always `200`. It is registered beside `POST /sites`, and its route needs no ordering against `/sites/new` or `/sites/:hostname`, since `/sites` matches neither.
- `src/routes/activity.ts` is mounted in `createApp`.

**Client:**
- `src/client/clientNav.tsx` gains `OVERVIEW_ROUTE = "/"`, and `SITES_ROUTE` becomes `"/sites"`. `isClientRoute` covers both.
- `router.tsx` adds the overview route. The sites route moves to `/sites`, and the client's site route already requires a hostname segment.
- `readInitialNotice` keys `?removed=` on `SITES_ROUTE`, so the notice follows with no logic change.

**Links that change from `/` to `/sites`:**
- the rail's `sites` heading;
- the site page's breadcrumb, its not-found body's way back and its error body's way back (`SiteDetail.tsx`);
- the add page's breadcrumb (`AddSitePage.tsx`) and Cancel (`AddSiteForm.tsx`);
- `removeChain.ts`'s landing, now `/sites?removed=<host>`.

The wordmark stays at `/`.

**Frozen fixtures:**
- The rail cases in `src/dev/fixtures/rail/` that contain dots, chips, the top bar count or the unavailable line are **retired**, along with any shell case whose comparison depends on them. New tests in `Rail.test.tsx` hold the new markup.
- The site page's and add page's fixtures differ only in those links' `href`. That is declared in `src/client/test/redesigns.ts`, dated, with each substitution anchored on the link's own class string so the wordmark's `href="/"` never matches. `redesigns.test.ts` already fails on an anchor that matches nothing or matches outside its anchor.
- The sites list fixtures are unchanged.

## Visual decision

To be filled in from the comparison (impeccable + comparing-design-variants) before writing-plans. It covers:
- the tile form;
- the `overview` signal's form in each state, in the rail and on the top bar's menu button;
- the needs-attention rows;
- the activity table's columns, especially how `who` and `kind` read as labels.

## Testing

- `src/lib/reconcilerEvents.test.ts`:
  - each A-HIST-1 rule: missing file, invalid JSON, wrong shape;
  - unknown type, unknown field, a known type missing a field;
  - two open lifetimes;
  - `last` ignored.
- `src/lib/auditLog.test.ts`: tail across malformed lines, `n` larger than the file, missing file.
- `src/views/activityModel.test.ts`:
  - every row of both mapping tables;
  - an unknown audit action dropped;
  - order within one tick, ties across sources, the limit;
  - each link rule, including a pruned resource and a removed site with no link.
- `src/routes/apiActivity.test.ts`: both sources, each source missing on its own, both missing, limit default/cap/garbage, unreadable Caddyfile.
- `src/routes/health.test.ts`: `generated` present, and null without an inventory.
- `src/client/pages/OverviewPage.test.tsx`:
  - tiles all clear, with bad, with unknown, with no inventory, after a failed poll;
  - attention rows in order, including a site with its container as one row;
  - activity empty, one source down, both down, a failed re-read keeping the table;
  - title and heading focus.
- `src/client/components/Rail.test.tsx`: the `overview` row and its four signal states (visible and screen reader), site rows without dots, `sites` → `/sites`, the top bar menu button's signal.
- Routing tests: `GET /sites` returns the document with `200`, `/sites/` redirects with `308`, and `removeChain` lands on `/sites?removed=`.
- A contract test for `PATHS.events` against A-HIST-1.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Run the detector by hand over `src/views src/client`.

**Dev mode.** `src/dev/seed.ts` gains an audit log (an add, a failed remove, a deploy request, a host action, a refusal) and an `events.json` with:
- every event type;
- one failed episode and one blocked episode;
- a recovery;
- one closed lifetime (a pruned site);
- two events from one tick.

## Docs

- CLAUDE.md:
  - Stack: `/` is the overview, the list is at `/sites`, `/api/activity`, the rail's single signal, find unchanged.
  - Core v1 feature flow: the list's URL, the rail paragraph, the remove chain's landing.
- PRODUCT.md, only if its description of the read job changes.
- DESIGN.md and `.impeccable/design.json` through `/impeccable document` (a scoped refresh) after the build, with the sidecar's rule bodies re-derived, not hand-edited.
