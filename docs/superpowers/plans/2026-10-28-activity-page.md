# Activity Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/activity` lists the whole merged history (audit log + reconciler A-HIST-1 feed), newest first, 50 at a time, filterable by subject, `who` and `kind`, with each failure's error text on its row; the overview and every site page link to it.

**Architecture:** The server merges both sources with the existing `buildActivity`, then a new node-free `pageActivity` filters, pages by an opaque cursor and lists subjects. `GET /api/activity` gains `subject`/`who`/`kind`/`before` and returns `next` and `subjects`. The page is a TanStack infinite query keyed by URL filters, rendering the overview's table rows under day headings.

**Tech Stack:** React 19, React Router 8.4 (data mode), TanStack Query 5, Express, Tailwind v4, `tsx --test` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-28-activity-page-design.md` (its "Visual decision" section is binding for every class and copy choice below).

## Global Constraints

- `src/views/*` stays node-free (no `node:` imports, no `Buffer`, no `js-yaml`); `src/client/clientImports.test.ts` enforces it for anything the client imports. Use `btoa`/`atob` for base64url.
- Frozen fixtures in `src/dev/fixtures/` are never edited. Markup changes to fixture-covered output are declared in `src/client/test/redesigns.ts` (dated `2026-10-28`, with a `why`), which `redesigns.test.ts` checks against each raw fixture independently.
- Class strings are exported constants in `src/views/` and match DESIGN.md tokens and its type ramp (1.5, 1.7, 1, 0.85, 0.75, 0.6875, 0.8, 0.9, 0.72rem). No new colour, no new tone.
- Edit `src/views/**` and `src/client/**` with the Edit/Write tools, never through shell commands, so the impeccable detector hook sees every change.
- Copy, verbatim: `Couldn't refresh activity: <reason>`, `Couldn't load older activity: <reason>`, `No activity matches these filters.`, `clear filters`, `Nothing recorded yet.`, `Activity couldn't be read.`, `Show older`, `Start of history`, `see all activity`, `Activity`, title `activity · lychee admin`, eyebrow `Activity`.
- `GET /api/activity`: `limit` default 8, cap 50 (unchanged); the page asks for 50. Unknown `who`/`kind` or malformed `before` → `400 { ok: false, reason }`. Otherwise always `200`.
- `refused-cross-site` audit lines never appear.
- Every task ends green on `npm run typecheck && npm run lint && npm test`.

## Review Focus

1. **A page boundary inside one reconciler tick** (several events sharing one `at`): "Show older" must return the rest of that tick, with no event shown twice and none skipped. Pinned in Task 1.
2. **New events arriving while older pages are loaded**: the 15s re-read must not duplicate the row that sat at a page seam. Pinned in Task 4.
3. **A hand-edited or stale URL** (`?kind=deploys`, `?before=garbage`, `?subject=old.lychee.land` after its history is gone): an explanation and a way out, never a blank page or an unfiltered list posing as filtered. Pinned in Tasks 2 and 4.
4. **Day headings around midnight and across a year boundary**: an event at 00:05 local belongs to its own day, not the previous one; a date in an earlier year shows its year. Pinned in Task 3.
5. **The overview's request** (`?limit=8`, no filters) keeps returning exactly what it did, so the overview's table is unchanged. Pinned in Task 2.

---

### Task 1: `detail` and `pageActivity` in the activity model

**Files:**
- Modify: `src/shared/activity.ts`
- Modify: `src/views/activityModel.ts`
- Test: `src/views/activityModel.test.ts`

**Interfaces:**
- Produces, in `src/shared/activity.ts`:
  - `ActivityEvent` gains `detail: string | null`.
  - `export const ACTIVITY_KINDS: readonly ActivityKind[]` (the nine kinds, in the type's order) and `export const ACTIVITY_WHO: readonly ActivityWho[]` (`["app", "reconciler"]`). Type-only file today; these two arrays are its only values, and the client may import them.
  - `export interface ActivityFilters { subject: string | null; who: ActivityWho | null; kind: ActivityKind | null }`.
- Produces, in `src/views/activityModel.ts`:
  - `export class ActivityCursorError extends Error {}`.
  - `export function pageActivity(events: ActivityEvent[], query: ActivityFilters & { before: string | null; limit: number }): { events: ActivityEvent[]; next: string | null; subjects: string[] }`. `events` is `buildActivity`'s full ordered output (pass `limit` = `Number.POSITIVE_INFINITY`).
  - `buildActivity`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests** in `src/views/activityModel.test.ts` (new `describe` blocks beside the existing ones):
  - `detail` per the spec's section 1 table: `add-site-failed` with `detail: "caddy validate: boom"` → `detail === "caddy validate: boom"`; `add-site-rollback-failed` and `prune-declaration-refused` likewise; a `-failed` line with no `detail` → `null`; `host-action` with `outcome: "refused: unit is busy"` → `"unit is busy"`; reconciler `failed` with `failed_step: "Start the container: unhealthy"` → that full string; `blocked` with `gate: "job test concluded: failure"` → that string, and with `gate: ""` → `null`; every neutral and ok row → `null`.
  - Order within one `at`: a reconciler event and an app line at the same millisecond → reconciler first; two reconciler events of one tick → the later file position first (existing behaviour, now pinned for the cursor).
  - Filters: `subject: "APP.lychee.land"` matches `app.lychee.land` events from both sources; `who: "app"`; `kind: "deploy"`; all three combined.
  - Cursor across a split tick: 5 events where events 2–4 share one `at`; `limit: 2` → page 1 is events 1–2 with a non-null `next`; `before: next` → events 3–4; again → event 5 with `next === null`. Concatenated pages deep-equal the unpaged list.
  - `next === null` exactly when the page reaches the last event (including a page that ends precisely on the last one).
  - Cursor applies after filters: paging `who: "reconciler"` with `limit: 1` walks only reconciler events.
  - Malformed `before` (`"garbage"`, base64url of `{"t":"x","n":1}`, `n: 0`) → `assert.throws(..., ActivityCursorError)`.
  - `subjects`: distinct, sorted with `localeCompare`, computed from the unfiltered list (same result whatever filters are passed).

- [ ] **Step 2: Run to verify failure**

Run: `npx tsx --tsconfig tsconfig.test.json --test src/views/activityModel.test.ts`
Expected: FAIL (`pageActivity` not exported; `detail` missing).

- [ ] **Step 3: Implement**
  - `Outcome` gains `detail: string | null`; the `RECONCILER` and audit mappers fill it per the section 1 table (a `-failed`/`-rollback-failed`/`-refused` variant takes `line.detail ?? null`; a refused host action takes the text after `refused: `; `rolled back` has none).
  - `pageActivity`: filter (subject compared lowercased on both sides), then skip to the cursor, then take `limit`. Cursor = base64url(JSON `{ t: <ms of the event's at>, n: <events at exactly that ms already returned, counting earlier pages> }`). Decoding validates `t` is a finite integer and `n` a positive integer, else throws `ActivityCursorError`. Skipping: drop every event with `ms > t`, then the first `n` with `ms === t`.

- [ ] **Step 4: Run to verify pass** — same command, expected PASS; then `npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat: activity detail, filters and cursor paging"`

---

### Task 2: `GET /api/activity` filters, cursor and payload; `GET /activity` document

**Files:**
- Modify: `src/routes/activity.ts`
- Modify: `src/client/activity.ts` (`fetchActivity` returns the new fields)
- Test: `src/routes/apiActivity.test.ts`, `src/lib/auditLog.test.ts`

**Interfaces:**
- Consumes: `pageActivity`, `ActivityCursorError`, `ACTIVITY_KINDS`, `ACTIVITY_WHO`, `ActivityFilters` (Task 1).
- Produces:
  - `ActivityPayload` (in `src/shared/activity.ts`) becomes `{ events; next: string | null; subjects: string[]; sources; now }`.
  - `export function parseActivityQuery(q: Record<string, unknown>): { ok: true; filters: ActivityFilters; before: string | null; limit: number } | { ok: false; reason: string }` in `src/routes/activity.ts`. Empty strings count as absent.
  - `GET /activity` answers the client document (`sendClientDocument(res, deps)`), as `GET /sites` does.

- [ ] **Step 1: Write the failing tests** in `src/routes/apiActivity.test.ts`:
  - `?who=bot` → 400, `reason` names `who`; `?kind=deploys` → 400 naming `kind`; `?before=garbage` → 400 naming the cursor.
  - `?subject=nothing.lychee.land` → 200, `events: []`, `next: null`, `subjects` still listing every subject.
  - `?limit=50&who=reconciler` returns only reconciler events, and `next` fed back as `before` returns the following page.
  - Whole log read: an audit log of 250 `add-site` lines; the oldest appears when paging to the end (it would not with the old 200-line tail).
  - Overview unchanged: `?limit=8` returns the same `events` (ignoring the new `detail` field) as before for the seeded files, `next` non-null when more than 8 exist.
  - `GET /activity` → 200 with the client document.
  - In `src/lib/auditLog.test.ts`: `readAuditTail(fs, Number.POSITIVE_INFINITY)` returns every well-formed line.

- [ ] **Step 2: Run to verify failure** — `npx tsx --tsconfig tsconfig.test.json --test src/routes/apiActivity.test.ts src/lib/auditLog.test.ts`; expected FAIL.

- [ ] **Step 3: Implement** — `parseActivityQuery` (keeps `parseLimit`'s rules for `limit`), the route reading `readAuditTail(deps.fs, Number.POSITIVE_INFINITY)` and answering `pageActivity(buildActivity(..., Number.POSITIVE_INFINITY), …)`; an `ActivityCursorError` becomes a 400. `fetchActivity` copies `next` and `subjects` through. Remove `AUDIT_LINES`.

- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "feat: activity API filters, cursor and whole-log read"`

---

### Task 3: client data layer and page model

**Files:**
- Modify: `src/client/activity.ts`
- Create: `src/views/activityPageModel.ts`
- Test: `src/views/activityPageModel.test.ts`, `src/client/activity.test.ts` (create if absent)

**Interfaces:**
- Consumes: `ActivityFilters`, `ACTIVITY_KINDS`, `ACTIVITY_WHO`, `ActivityPayload` (Tasks 1–2).
- Produces, in `src/views/activityPageModel.ts` (node-free):
  - `export function filtersFromSearch(search: URLSearchParams): ActivityFilters` — unknown `who`/`kind` values are kept as given, as strings, so the server's 400 explains them; type that as `ActivityFilters`-compatible by widening `who`/`kind` to `string | null` in a local `ActivityUrlFilters` type, and export it.
  - `export function searchFromFilters(f: ActivityUrlFilters): string` — `?subject=&who=&kind=` in that order, empty ones omitted, `""` when none.
  - `export function hasFilters(f: ActivityUrlFilters): boolean`.
  - `export function dayKey(at: string): string` — local `YYYY-MM-DD`.
  - `export function dayLabel(at: string, now: Date): string` — `today · wed 28 oct`, `yesterday · tue 27 oct`, else `mon 26 oct`, with ` 2025` appended when the year differs from `now`'s. Weekday and month names from fixed lowercase arrays, never `toLocaleDateString`.
  - Class constants (Visual decision): `ACTIVITY_PAGE` (frame width, flex column, `gap-6`), `ACTIVITY_FILTERS` (flex, wrap, `items-end`, `gap-4`), `ACTIVITY_FILTER_LABEL` (grid, `gap-1`), `ACTIVITY_FILTER_CAPTION` (the section-label base in Smoke Light), `ACTIVITY_SELECT` (`INPUT` from `shared.ts`, `min-w-[150px]`, 0.8rem), `ACTIVITY_DAY_TH` (the `ACTIVITY_TH` cell treatment for a full-width heading row, with top padding so a day reads as a break), `ACTIVITY_DETAIL` (`block` 0.75rem mono Smoke Light, wrapping, `mt-1`), `ACTIVITY_END` (0.75rem mono Smoke), `ACTIVITY_SEE_ALL` (0.75rem mono Smoke Light, underlined with a Hairline Strong decoration, `FOCUS_RING`).
- Produces, in `src/client/activity.ts`:
  - `export const ACTIVITY_PAGE_SIZE = 50`.
  - `export async function fetchActivityPage(f: ActivityUrlFilters, before: string | null): Promise<ActivityPayload>` — same error contract as `fetchActivity`.
  - `export function activityPageQuery(f: ActivityUrlFilters)` returning infinite-query options: key `["activity-page", f.subject, f.who, f.kind]`, `initialPageParam: null as string | null`, `getNextPageParam: (last) => last.next`, `refetchInterval: 15_000`, `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`, `staleTime: 2_000`.

- [ ] **Step 1: Write the failing tests**:
  - `filtersFromSearch` / `searchFromFilters` round-trip; empty values dropped; `?kind=deploys` survives as `"deploys"`.
  - `dayLabel` with local-component dates (`new Date(2026, 9, 28, 23, 18).toISOString()` against `now = new Date(2026, 9, 28, 23, 31)`): today, yesterday, older; `00:05` on the 28th is `today`, `23:59` on the 27th is `yesterday`; a date in 2025 gets ` 2025`; `dayKey` of `00:05` local differs from `23:59` the night before.
  - `fetchActivityPage` with a stubbed `fetch`: URL is `/api/activity?limit=50` plus filters plus `&before=<cursor>` when given; a 400 body's `reason` becomes the thrown message.

- [ ] **Step 2: Run to verify failure** — expected FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run to verify pass**, then `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat: activity page data layer and day labels"`

---

### Task 4: the `/activity` page, its route and the rail row

**Files:**
- Create: `src/client/pages/ActivityPage.tsx`, `src/client/components/ActivityRow.tsx`
- Modify: `src/client/components/ActivityTable.tsx` (renders rows through `ActivityRow`)
- Modify: `src/client/clientNav.tsx`, `src/client/router.tsx`, `src/client/components/Rail.tsx`, `src/client/test/redesigns.ts`
- Test: `src/client/pages/ActivityPage.test.tsx`, `src/client/components/Rail.test.tsx`, `src/client/router.test.tsx` (whichever file holds the route tests today)

**Interfaces:**
- Consumes: Task 3's model, query and class constants; `ACTIVITY_*` row class strings in `src/views/overviewModel.ts`; `BOARD_ALERT`.
- Produces:
  - `export const ACTIVITY_ROUTE = "/activity"` in `clientNav.tsx`; `isClientRoute` accepts it.
  - `export function ActivityRow({ event, now, showDetail }: { event: ActivityEvent; now: Date; showDetail: boolean })` — one `<tr>`: the overview's five cells exactly (age in `<time dateTime title={toLocaleString()}>`, who, kind tag, subject link or text, outcome); with `showDetail` and a non-null `detail`, an `ACTIVITY_DETAIL` span inside the outcome cell after the outcome word. The overview passes `showDetail={false}`, so its markup is unchanged.
  - `export function ActivityPage()`.

- [ ] **Step 1: Write the failing tests** in `src/client/pages/ActivityPage.test.tsx` (mount through the router as `OverviewPage.test.tsx` does, with `fetch` stubbed per URL):
  - Renders the eyebrow `Activity`, three labelled selects (`subject`, `who`, `kind`) with `all subjects` / `all` / `all` first, the table, day heading rows (`today · …`) only where the local day changes, and a detail line under a failed row.
  - The `subject` select lists the payload's `subjects`; with `?subject=gone.lychee.land` not among them, that value is present as an extra option and selected.
  - Changing `who` rewrites the URL to `/activity?who=reconciler` with `replace` (history length unchanged) and requests page 1 with that filter; `clear filters` appears only when a filter is set and returns to `/activity`.
  - `Show older` appends the next page's rows below without repeating the day heading of a day that continues across the seam; with `next: null` it is replaced by `Start of history`.
  - Seam (Review Focus 2): load two pages, then make the newest page's response gain one event at the top; after the interval re-read the table holds every event exactly once.
  - Failures: first load fails → only `Couldn't refresh activity: <reason>`; a re-read fails → last good table plus that alert; `Show older` fails → `Couldn't load older activity: <reason>` beside a still-present button; a 400 (`?kind=deploys`) → the alert with the server's reason and a `clear filters` link.
  - Empty states: filters set and no events → `No activity matches these filters.` with `clear filters`; no filters, no events → `Nothing recorded yet.`; one source unreadable → exactly `Reconciler history couldn't be read; showing app actions only, so this history is incomplete.` or `The audit log couldn't be read; showing reconciler events only, so this history is incomplete.` (the overview's sentences, with the spec's clause appended; the overview's own wording does not change); both unreadable → `Activity couldn't be read.` alone.
  - Title `activity · lychee admin`; focus moves to the eyebrow on an in-app arrival, not on a document load.
  - Rail (`Rail.test.tsx`): an `activity` row directly after `overview`, a router link to `/activity`, `aria-current="page"` on `/activity` only, and no mark.

- [ ] **Step 2: Run to verify failure** — expected FAIL.

- [ ] **Step 3: Implement**
  - Route in `router.tsx` beside the overview's: path `ACTIVITY_ROUTE`, loader `client.ensureInfiniteQueryData(activityPageQuery(filtersFromSearch(new URL(request.url).searchParams))).catch(() => undefined)`, `HydrateFallback: Nothing`, element `<ActivityPage />`.
  - The page reads filters with `useSearchParams` and writes them with `setSearchParams(…, { replace: true })`; flattens `data.pages` into one list and inserts a day heading row whenever `dayKey` changes. Distinguish a failed re-read from a failed "Show older" with TanStack's `isFetchNextPageError` / `isRefetchError`, keeping the last reason across a retry as `OverviewPage` does. Focus/title follow `OverviewPage`'s pattern.
  - Rail: the `activity` `RailLink` inside the existing `Overview` nav, after the overview link, `RAIL_ROW`, with `aria-current` when `nav.pathname === ACTIVITY_ROUTE`.
  - `redesigns.ts`: extend `rail-overview-row`'s `to` so the `Overview` nav holds both rows (`…overview</a><a href="/activity" class="${RAIL_ROW}">activity</a></nav>`), keeping its id and date and adding a sentence to its `why`; each entry is checked against raw fixtures independently, so a second entry anchored on the first one's output would match nothing.

- [ ] **Step 4: Run to verify pass**, then `npm test` (the rail and frame parity suites must stay green).

- [ ] **Step 5: Commit** — `git commit -m "feat: the activity page and its rail row"`

---

### Task 5: links in, and the seed's app error

**Files:**
- Modify: `src/client/components/ActivityTable.tsx` (overview `see all activity`)
- Modify: `src/client/components/SiteDetail.tsx` (header `Activity` link)
- Modify: `src/client/test/redesigns.ts` (the site header substitution)
- Modify: `src/dev/seed.ts` (legacy's failed remove gains a `detail`)
- Test: `src/client/pages/OverviewPage.test.tsx`, `src/client/components/SiteDetailRules.test.tsx`, `src/dev/seed.test.ts` (or wherever the seed's events are pinned)

**Interfaces:**
- Consumes: `ACTIVITY_ROUTE`, `ACTIVITY_SEE_ALL` (Tasks 3–4), `BUTTON_SECONDARY`.

- [ ] **Step 1: Write the failing tests**:
  - Overview: when the table shows rows, `see all activity` follows it as a router link to `/activity`; it is absent when activity couldn't be read at all.
  - Site page: the header holds `Activity` (a link to `/activity?subject=<hostname>`, `BUTTON_SECONDARY` classes) immediately before Visit, for a serving site (Visit Primary) and a non-serving one (Visit Secondary); the not-found and Caddyfile-error bodies have none.
  - Seed: the `remove-site-failed` line for `legacy.lychee.land` carries `detail: "caddy validate: Error: adapting config using caddyfile: ambiguous site definition: http://legacy.lychee.land"`, and the activity API returns it as that row's `detail`.

- [ ] **Step 2: Run to verify failure** — expected FAIL.

- [ ] **Step 3: Implement**
  - Overview: `see all activity` as a `RailLink` under the table, inside the activity section, after the source line.
  - Site header: wrap Activity and Visit in one `flex items-center gap-2.5 shrink-0` group in the header's action slot; Activity is a `RailLink` with `${BUTTON_SECONDARY} no-underline shrink-0`.
  - `redesigns.ts`: one entry, `site-activity-link`, `since: "2026-10-28"`, anchored on `>Visit ` in the detail fixtures, whose `from` captures the hostname and the whole Visit anchor and whose `to` wraps the new group around the Activity anchor and that captured Visit anchor. Check every `src/dev/fixtures/detail/*` file that holds a Visit link matches exactly once.

- [ ] **Step 4: Run to verify pass**, then `npm test` (`SiteDetailParity.test.tsx` and `redesigns.test.ts` green).

- [ ] **Step 5: Commit** — `git commit -m "feat: links to the activity page from the overview and site pages"`

---

### Task 6: docs and verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**: the Stack paragraph's page list and routes (`/activity`; `GET /api/activity`'s `subject`/`who`/`kind`/`before`, `next`, `subjects`, the whole-log read, the 400s); the rail description (`activity` row under `overview`); the observability paragraph that says no `/activity` page exists; the overview's `see all activity` and the site page's `Activity` link.
- [ ] **Step 2: Run the detector by hand** — `"/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable" detect --json src/views src/client`; expected: no findings.
- [ ] **Step 3: Full check** — `npm run typecheck && npm run lint && npm test && npm run build`; expected all green.
- [ ] **Step 4: Commit** — `git commit -m "docs: the activity page in CLAUDE.md"`

The controller (not a subagent) then checks `/activity` in a browser on `npm run dev:mock` at 1440, 760 and 400px: day headings, the legacy and broken detail lines, `Show older`/`Start of history`, filters in the URL, no sideways page scroll at 400px. After the whole-branch review, the main session runs a scoped `/impeccable document` refresh.
