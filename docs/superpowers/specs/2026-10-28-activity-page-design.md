# Activity page: the whole history at `/activity`

Date: 2026-10-28. Sub-project 3 of the overview work (`2026-10-28-overview-page-design.md`); builds on that branch (`feat/overview-page`, PR #132).

## Decision record

- **One merged timeline**, not an audit log alone. The audit log records intent (what was asked of the app), the reconciler's A-HIST-1 feed records outcomes (what happened on the host), and most questions span both: did my deploy land, when did this start failing. `who: app` narrows it to the audit log when that is what is wanted.
- **Failed rows carry their error text in full.** Refused cross-site requests stay out, as on the overview.
- **Approach A: the server filters and pages by cursor; the page shows "Show older".** Rejected: sending the whole history and filtering in the browser (every 15s re-read downloads a payload that grows forever), and numbered pages (page numbers drift while the log is written at the top).
- **History exists only for what the app does and what the reconciler manages.** Static sites, plain proxies, Caddy and the tunnel have no recorded history anywhere, and the app's polls are not a record. A recorder for them belongs in lychee-ops, beside `events.json`, and is out of scope.
- **Visual treatment** is chosen by a rendered comparison (impeccable + comparing-design-variants) after this spec is approved, and recorded under "Visual decision".

## Goal

- `/activity` lists every event the two sources hold, newest first, 50 at a time, narrowable by subject, `who` and `kind`, with each failure's error text on its row.
- A site's page links to its own history. The overview links to the whole of it.

## Non-goals

- History for static sites, plain proxies, Caddy or the tunnel (needs a lychee-ops recorder).
- Refused cross-site requests in the feed.
- An `activity` link on board rows (every board fixture is frozen; the subject select covers units for now).
- Free-text search, several kinds at once, date ranges.
- Changes to lychee-ops or lychee-contract.

## Decisions

### 1. Events gain `detail`

`ActivityEvent` (`src/shared/activity.ts`) gains `detail: string | null`. It is set only on a failed, refused or blocked row, and is `null` everywhere else:

| Source | Row | `detail` |
|---|---|---|
| audit | any `*-failed`, `*-rollback-failed`, `prune-declaration-refused` line | the line's `detail`, when present |
| audit | `host-action` with `outcome` `refused: <reason>` | `<reason>` |
| reconciler | `failed` | `failed_step` in full |
| reconciler | `blocked` | the `gate` sentence, when non-empty |

The code still branches on `gate_code` and `result`, never on these strings; they are only displayed. The overview's table does not show `detail`.

### 2. Order, filters and the cursor

**One total order**, the one `buildActivity` already sorts by: `at` newest first; within one `at`, the reconciler's event before the app's (the effect before the cause, as the overview decided); then later file position first. The order is total and stable across reads of the same files, which the cursor depends on. A test pins it, including a tick whose events share one `at`.

**Filters**, applied before paging:
- `subject`: exact, case-insensitive match on the event's subject. A site's subject is its hostname, which already covers its container's reconciler events.
- `who`: `app` or `reconciler`.
- `kind`: one `ActivityKind`.

**Cursor.** `next` names the last event returned as its `at` (milliseconds) plus how many events at exactly that `at` have been returned so far, encoded as an opaque base64url string. `before=<cursor>` returns the events after that position in the total order: every event with an earlier `at`, plus the events at the cursor's `at` after the first `n`. A timestamp alone would drop the rest of a tick that a page boundary split. `next` is `null` when nothing older remains.

**Subjects.** The payload carries `subjects`: every distinct subject in the whole unfiltered history, sorted, so the page's subject select lists only real names.

`buildActivity` keeps its signature for the overview's use. The filtering, cursor and subject list are a new node-free function beside it in `src/views/activityModel.ts`: `pageActivity(events, { subject, who, kind, before, limit }) → { events, next, subjects }` over the full ordered list. It throws a typed error for a malformed cursor, so the route can answer `400`.

### 3. API

`GET /api/activity` keeps every current behaviour and gains:

- `subject`, `who`, `kind` and `before`, as above.
- An unknown `who` or `kind`, or a malformed `before`, answers `400` with `{ ok: false, reason }`. Ignoring it would show an unfiltered list that looks filtered.
- A `subject` that matches nothing is not an error: it answers `200` with no events.
- `limit`: unchanged, default 8 and capped at 50. The page asks for 50.
- The audit log is read whole (`readAuditTail` with no limit), not the last 200 lines. At a few lines a day this stays small, and the reader is still the one place that would change if it grew.
- The payload becomes `{ events, next, subjects, sources, now }`.

Unchanged: always `200` otherwise, with an unreadable source reported in `sources`, both files read on every request and nothing cached.

### 4. The page

`/activity` is a client route (`ACTIVITY_ROUTE` in `src/client/clientNav.tsx`), and its loader primes the first page for the URL's filters. Its title is `activity · lychee admin`, as the overview's is `overview · lychee admin`. Focus on arrival moves to the eyebrow, as on the board pages.

**Rail.** A new `activity` row sits directly under `overview`, as plain navigation with no mark. It has `aria-current="page"` on `/activity`.

**Top to bottom:**
1. **An `Activity` eyebrow**, as on the board pages.
2. **The filter line**: three native selects, `subject` (all, then `subjects`), `who` (all, app, reconciler) and `kind` (all, then the nine kinds). Every change rewrites the URL's query in place (`replace`, so filter changes do not pile up history entries; `?subject=&who=&kind=`, empty ones omitted) and restarts from one page. A reload, or coming back to the page, keeps the view. A URL value that is not one of the options (a subject no longer in history) still filters, and the select shows it as an extra option so the view never lies about its filter.
3. **The table**: the overview's columns, `when`, `who`, `kind`, `subject`, `outcome`. `when` is an age in a `<time datetime>` with the exact local time as its title. A row with a `detail` shows it in full on a second line under its outcome, wrapping and never cut off.
4. **"Show older"**, under the last row, while `next` is not null. It appends the next 50. At the start of history it is replaced by a quiet `Start of history` line.

**Live.** A TanStack infinite query keyed by the filters. Every 15s, only while the tab is visible and again on focus, TanStack re-reads every loaded page from the newest one down, deriving each page's cursor from the page before it. So new events appear at the top with no duplicate and no gap at a page boundary. The infinite query's 2s `staleTime` keeps the loader's read from being fetched again on mount, as the board's query does.

**When something fails:**
- **A failed re-read** keeps the last good table under a `role="alert"` line, `Couldn't refresh activity: <reason>`, which clears on the next success.
- **A failed first load** shows that alert alone.
- **A failed "Show older"** shows `Couldn't load older activity: <reason>` beside the button, which stays and can be pressed again.
- **A `400`** (a hand-edited URL) shows the alert with the server's reason and a link that clears the filters.
- **One source unreadable**: the overview's sentence, plus `so this history is incomplete.`
- **Both unreadable**: `Activity couldn't be read.` alone.
- **No events with filters set**: `No activity matches these filters.` with a link that clears them.
- **No events and no filters**: `Nothing recorded yet.`

### 5. Links in

- **The overview's** `Recent activity` table gains `see all` linking to `/activity`. Its position is part of the visual comparison.
- **A site's page** gains a quiet `activity` link to `/activity?subject=<hostname>`. Its position is part of the visual comparison.
- Both are router links, like every other in-app link.

### 6. Edge cases

- **A removed or pruned site** keeps its history under its hostname, and its subject renders as plain text, not a link, as `buildActivity` already does.
- **A site removed and re-added** under one hostname shows as one subject with one continuous history; the `removed` and `added` rows make the gap visible.
- **An event with a malformed timestamp** is dropped, as now, so it can never reach a cursor.
- **The overview** changes only by gaining `see all`. It still asks for 8 rows and ignores `detail`, `next` and `subjects`.

### 7. Docs

- CLAUDE.md: the route, the API's new parameters and payload, the rail's `activity` row, and the observability paragraph that now says there is no `/activity` page.
- DESIGN.md and its sidecar through a scoped `/impeccable document` refresh after the build, recording the page and the detail line.

## Testing

- `src/views/activityModel.test.ts`:
  - the total order within one `at` (reconciler before app, later file position first);
  - `detail` for every row in section 1's table, and `null` elsewhere;
  - each filter on its own and combined, and `subject` case-insensitive;
  - a cursor across a boundary that splits one tick: no duplicate, no gap;
  - `next` is `null` exactly at the start of history;
  - a malformed cursor throws the typed error;
  - `subjects` is distinct, sorted and unfiltered.
- `src/routes/apiActivity.test.ts`: each parameter's `400`, `limit` default and cap kept, the whole audit log read (an event older than the last 200 lines appears), each source missing, the overview's request unchanged.
- The page:
  - URL ↔ filters, including an unknown subject shown as its own option;
  - "Show older" appends, and its failure keeps the button;
  - a re-read with new events adds them on top with no duplicate at the seam;
  - the no-matches state and its clear link; the `400` state;
  - each failure state above.
- Rail: the `activity` row and its `aria-current`, declared in `src/client/test/redesigns.ts`; the overview's `see all`; the site page's link (a declared substitution or a retired fixture, depending on the design chosen).

## Visual decision

To be chosen from a rendered comparison after this spec is approved: where the filters sit, how the detail line reads, whether rows group by day, and where the site page's and overview's links go.
