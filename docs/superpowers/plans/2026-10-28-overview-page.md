# Overview Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/` becomes the overview (a four-cell strip, a needs-attention list and the last eight events from the app's audit log and the reconciler's history), the sites list moves to `/sites`, and the rail trades its per-item health for one signal on a new `overview` row.

**Architecture:** Two node-side readers (`reconcilerEvents.ts` for A-HIST-1's `events.json`, `auditLog.ts` for the action log) feed one node-free merge (`src/views/activityModel.ts`), served by `GET /api/activity`. The page and the rail signal both read the existing `/api/health` query through one node-free model (`src/views/overviewModel.ts`), so they add no poll and no host read. Routing moves the list with no logic change beyond constants. Frozen fixtures are held through declared redesigns.

**Tech Stack:** React 19, React Router (data mode), TanStack Query, Express, Tailwind v4, `tsx --test` with happy-dom and @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-28-overview-page-design.md` (its "Visual decision" section is 04 Ledger, from https://claude.ai/artifact/RPb8NWPButp2dcWDKZ8ebX).

## Global Constraints

- Everything in `src/views/` and `src/shared/` stays node-free: no `node:` built-ins and no `js-yaml`. Types from `src/lib/` come in only through `import type`. `src/client/clientImports.test.ts` enforces this for anything the client imports.
- Class strings live in `src/views/` as exported constants, matching `railModel.ts` and `shared.ts`. Components import them.
- Edit files under `src/views` and `src/client` with the Edit and Write tools, never through a shell command. The impeccable detector hook only sees Edit and Write.
- Mono is for machine facts (names, counts, ages, tags, outcomes, gate codes) and sans is for sentences. A tone never appears without its word. Ember never goes on the strip.
- Frozen fixtures in `src/dev/fixtures/` are never edited or regenerated. Every markup change to a fixture-held surface is declared in `src/client/test/redesigns.ts` with `since: "2026-10-28"`.
- The copy below is verbatim from the spec:
  - Page:
    - document title `overview · lychee admin`
    - heading `Overview`
  - Needs attention:
    - `<n> need attention` / `1 needs attention`
    - `<n> couldn't be read`
    - `health unavailable · last read <age>` / `health unavailable`
  - Activity:
    - `Recent activity`
    - `Nothing recorded yet.`
    - `Reconciler history couldn't be read; showing app actions only.`
    - `The audit log couldn't be read; showing reconciler events only.`
    - `Activity couldn't be read.`
    - `Couldn't refresh activity: <reason>`
  - Strip cells:
    - `all clear`
    - `inventory unavailable`
    - `last tick <age>`
- Live queries poll every 15s, only while the tab is visible, and again on focus (`refetchInterval: 15_000`, `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`).
- Every test file that renders React starts with `import "./test/setup"` (or the right relative path), as the existing ones do.
- Each task ends with `npm run typecheck && npm test` green. Commits end with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Mixed timestamp precision.** The audit log writes `…:02.123Z` and the reconciler writes `…:02Z`. Comparing them as strings misorders them, so the merge must compare parsed milliseconds. Pinned in Task 3.
2. **A clock that is ahead or a timestamp that doesn't parse.** An event `at` in the future reads `now`, never a negative age. An `at` that does not parse is dropped and never sorted. Pinned in Task 3.
3. **The two polls fail independently.** A failed health poll must not blank the activity table, and a failed activity poll must not touch the strip or the attention list. Pinned in Task 6.
4. **History outlives the thing.** A pruned site's closed lifetime still lists its events, unlinked. A re-added name contributes events from both lifetimes in time order. Pinned in Task 3.
5. **A 63-character subject.** A site label at the resource-name limit must wrap inside the table cell (`[overflow-wrap:anywhere]`) and not widen the page. Pinned in Task 6.

---

### Task 1: Contract v2.1.0 and the reconciler events reader

**Files:**
- Modify: `contract.lock`
- Modify: `src/lib/platform.ts` (add `EVENTS_PATH` after `PATHS`)
- Modify: `src/lib/platform.test.ts`
- Create: `src/lib/reconcilerEvents.ts`
- Create: `src/lib/reconcilerEvents.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // platform.ts
  export const EVENTS_PATH = "/var/lib/lychee-inventory/events.json";
  // reconcilerEvents.ts
  export type ReconcilerEvent =
    | { at: string; type: "added" }
    | { at: string; type: "deployed"; from: string | null; to: string }
    | { at: string; type: "stopped" }
    | { at: string; type: "down"; from: string | null }
    | { at: string; type: "failed"; failed_step: string }
    | { at: string; type: "blocked"; gate_code: string }
    | { at: string; type: "awaiting-image" }
    | { at: string; type: "recovered"; from: string; from_gate_code: string | null; attempts: number }
    | { at: string; type: "removed" };
  export interface Lifetime {
    id: string; name: string; kind: string;
    added_at: string; removed_at: string | null;
    /** False for a closed lifetime, and for the earlier of two open ones for one name (A-HIST-1). */
    open: boolean;
    events: ReconcilerEvent[]; // file order, oldest first
  }
  export function parseReconcilerEvents(raw: string): Lifetime[] | null;
  export function readReconcilerEvents(fs: FileSystem, path?: string /* = EVENTS_PATH */): Lifetime[] | null;
  ```
  `gate` is never carried, because nothing may branch on it, and `last` is never read.

- [ ] **Step 1: Bump the pin.** Set `contract.lock` to `{"tag": "v2.1.0", "commit": "9505c4cfaba1eefc07c8f43092b2714b43d7de28"}` and run `sh scripts/fetch-contract.sh`. Expected: `contract: v2.1.0 (9505c4c)`, and `.contract/examples/events/` exists.

- [ ] **Step 2: Write the failing tests.**

  In `platform.test.ts`:
  ```ts
  test("EVENTS_PATH is the path A-HIST-1 states", () => {
    const agreements = loadContractText("AGREEMENTS.md");
    const section = agreements.slice(agreements.indexOf("## A-HIST-1"), agreements.indexOf("\n## ", agreements.indexOf("## A-HIST-1") + 1));
    assert.ok(section.includes(`\`${EVENTS_PATH}\``));
  });
  ```

  `reconcilerEvents.test.ts`, one test each:
  - `"every valid contract example parses"`: for each file in `listContractDir("examples/events/valid")`, `parseReconcilerEvents` returns an array whose length equals the file's `lifetimes.length`.
  - `"no invalid contract example throws"`: for each `examples/events/invalid/*.json` except `expected.json`, the call does not throw.
  - `"a missing file is no history"`: `readReconcilerEvents(fakeFs)` with no file returns `null`.
  - `"unparseable JSON is no history"`: `parseReconcilerEvents("{")` returns `null`.
  - `"a wrong top-level shape is no history"`: `parseReconcilerEvents('{"lifetimes": 3}')` and `'[]'` both return `null`.
  - `"an unknown type and unknown fields are dropped"`: one lifetime with events `[{at, type:"added", extra:1}, {at, type:"teleported"}]` gives `events` deep-equal to `[{at, type:"added"}]`.
  - `"a known type missing a required field drops that event, not the file"`: `{type:"deployed", from:null}` (no `to`) beside a valid `added` leaves only the `added`.
  - `"of two open lifetimes for one name, only the later added_at is open"`: two `removed_at: null` lifetimes for `swee`, `added_at` `2026-10-01T00:00:00Z` and `2026-10-02T00:00:00Z`, give `open` false and true respectively.
  - `"last is never read"`: a lifetime whose `last` is `"garbage"` still parses, and the result has no `last` key.
  - `"blocked keeps gate_code and drops gate"`: the parsed event deep-equals `{at, type:"blocked", gate_code:"ci-pending"}`.

  Use the in-memory filesystem from `src/dev/fakes.ts` as the other lib tests do.

- [ ] **Step 3: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/lib/reconcilerEvents.test.ts src/lib/platform.test.ts`. Expected: FAIL, because `reconcilerEvents` does not exist and `EVENTS_PATH` is not exported.

- [ ] **Step 4: Implement `EVENTS_PATH` and the reader.** `readReconcilerEvents` returns `null` when `fs.exists(path)` is false and catches a throwing read as `null`. A lifetime missing a string `id`, `name`, `kind` or `added_at`, or a non-array `events`, is dropped on its own. Validate each event per type, keep only the fields in the union, and drop anything else.

- [ ] **Step 5: Run the tests and check they pass.** Run the same command. Expected: PASS.

- [ ] **Step 6: Commit.**
  ```bash
  git add contract.lock src/lib/platform.ts src/lib/platform.test.ts src/lib/reconcilerEvents.ts src/lib/reconcilerEvents.test.ts
  git commit -m "feat: read the reconciler's history feed (contract v2.1.0, A-HIST-1)"
  ```

### Task 2: The audit log reader

**Files:**
- Create: `src/lib/auditLog.ts`
- Create: `src/lib/auditLog.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AuditLine {
    timestamp: string; action: string;
    hostname?: string; detail?: string;
    caller?: string; unit?: string; hostAction?: string; outcome?: string; // host-action lines
  }
  export function readAuditTail(fs: FileSystem, n: number, path?: string /* = config.logFile */): AuditLine[] | null;
  ```

- [ ] **Step 1: Write the failing tests** in `auditLog.test.ts`:
  - `"returns the last n good lines, oldest first, skipping malformed ones without counting them"`: the file holds `A`, `not json`, `B`, `{"action":"x"}` (no timestamp), `C`, `[1]`, `D`. `readAuditTail(fs, 3)` gives actions `["B","C","D"]`.
  - `"n larger than the file returns every good line"`: 2 good lines and `n = 50` give 2 lines.
  - `"a missing file is null"`: `readAuditTail(fs, 8)` with no file gives `null`.
  - `"an unreadable file is null"`: an `fs` whose `readFile` throws gives `null`.
  - `"non-string optional fields are dropped"`: `{"timestamp":"…","action":"add-site","hostname":7}` gives a line with no `hostname`.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/lib/auditLog.test.ts`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement `readAuditTail`.** Read the whole file (as the spec says, v1 volume is a few lines a day), split on `\n`, parse each line in a try, keep objects with string `timestamp` and `action`, copy only string-valued optional fields, and return the last `n`.

- [ ] **Step 4: Run the tests and check they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat: read the tail of the audit log"` with both files.

### Task 3: Activity types and the merge

**Files:**
- Create: `src/shared/activity.ts`
- Create: `src/views/activityModel.ts`
- Create: `src/views/activityModel.test.ts`
- Modify: `src/views/railModel.ts` (export `unitHref`)

**Interfaces:**
- Consumes: `Lifetime`, `ReconcilerEvent` (Task 1) and `AuditLine` (Task 2), as `import type`.
- Produces:
  ```ts
  // src/shared/activity.ts: the spec's ActivityWho, ActivityKind, ActivityEvent and ActivityPayload, verbatim.
  // src/views/railModel.ts
  export function unitHref(name: string, group: ServiceGroup): string; // `${GROUP_PAGE[group]}#service-${name}`; unitHealth uses it
  // src/views/activityModel.ts
  export interface ActivityContext {
    domain: string;
    /** Managed hostnames in the Caddyfile; null when it could not be read (no site links then). */
    sites: ReadonlySet<string> | null;
    /** Inventory name → board-row href, for every listed entry. */
    units: ReadonlyMap<string, string>;
  }
  export function buildActivity(audit: AuditLine[] | null, lifetimes: Lifetime[] | null, ctx: ActivityContext, limit: number): ActivityEvent[];
  export function shortAge(at: string, now: Date): string; // "now" | "<n>m" | "<n>h" | "<n>d"
  ```

Rules, all from the spec:
- **Subject and link.** One helper serves both sources:
  - The raw name is an audit line's `unit ?? hostname`, or a lifetime's `name`.
  - The subject is `hostnameForResource(raw, domain) ?? raw`.
  - The href is `/sites/<encodeURIComponent(subject)>` when the subject is a managed hostname in `ctx.sites`. Failing that, it is `ctx.units.get(raw)`. Failing that, `null`.
- **Mapping.** The two mapping tables in spec section 1 are applied exactly, with section 1's amended `deployed` row: `deployed <from> → <to>`, or `deployed <to>`.
  - Audit successes are `tone: "neutral"`.
  - Audit suffixes are checked longest first: `-rollback-failed`, then `-rolled-back`, then `-failed`, then `-refused`.
  - `failed at <step name>` takes the text of `failed_step` before the first `: `.
- **Order.** Sort by parsed ms descending, then reconciler before app, then file sequence descending. The sequence runs across the audit lines and across each lifetime's events in file order, which reverses a tick's A-HIST-1 order. Events with an unparseable time are dropped before sorting. Keep the first `limit`.
- **`shortAge`.** Under 60s, or a future time, is `now`. Under 60 minutes is `<n>m` (floor). Under 24 hours is `<n>h`. Otherwise `<n>d`.

- [ ] **Step 1: Write the failing tests** in `activityModel.test.ts`. Use the context `ctx = { domain: "lychee.land", sites: new Set(["app.lychee.land","blog.lychee.land"]), units: new Map([["app-lychee-land","/services#service-app-lychee-land"],["swee","/services#service-swee"]]) }`.
  - Reconciler mapping, one assertion per row. Each case's `{kind, outcome, tone}` must equal the spec table:
    - `deployed {from:"0.1.0",to:"0.2.0"}` gives `{deploy, "deployed 0.1.0 → 0.2.0", ok}`.
    - `deployed {from:null,to:"0.1.0"}` gives `{deploy, "deployed 0.1.0", ok}`.
    - `failed {failed_step:"Start the container: dependency failed"}` gives `{deploy, "failed at Start the container", bad}`.
    - `blocked {gate_code:"ci-pending"}` gives `{deploy, "blocked · ci-pending", bad}`.
    - `awaiting-image` gives `{deploy, "awaiting image", neutral}`.
    - `recovered {attempts:1}` gives `"recovered after 1 attempt"`. `attempts:3` gives `"recovered after 3 attempts"`. Both are ok.
    - `stopped` gives `{stop, "stopped", neutral}`.
    - `down {from:"0.4.2"}` gives `{stop, "down, was 0.4.2", neutral}`.
    - `added` gives `{add, "declared", neutral}`.
    - `removed` gives `{remove, "pruned", neutral}`.
  - Audit mapping, one assertion per base action in the spec table:
    - `deploy-service` with `detail:"1.8.0"` gives `"1.8.0 requested"`, and with no detail gives `"requested"`.
    - `host-action` with `hostAction:"restart"` and `outcome:"started"` gives `{host, "restart started", neutral}`. With `outcome:"refused: busy"` it gives `{host, "restart refused", bad}`.
    - `refused-cross-site` gives `{attach, "refused", bad}`.
    - Each suffix: `add-site-failed` gives `{add, "failed", bad}`, `remove-site-rolled-back` gives `"rolled back"`, `remove-site-rollback-failed` gives `"rollback failed"`, `prune-declaration-refused` gives `{prune, "refused", bad}`.
    - `"deploy-service-failed never shows its detail"`: `detail:"1.8.0: boom"` gives outcome `"failed"`.
  - `"an unknown audit action is dropped"`: `{action:"reboot-host"}` produces no event.
  - `"a tick's events come out newest first"`: lifetime events `[added@T, deployed@T]` come out as `deployed` then `added`.
  - `"a reconciler event ties ahead of an app event at the same time"`.
  - `"mixed precision sorts by time, not text"` (Review Focus 1): app `2026-10-28T10:00:02.500Z` and reconciler `2026-10-28T10:00:02Z` put the app event first.
  - `"an unparseable time is dropped"` (Review Focus 2).
  - `"the limit keeps the newest"`: 10 events and limit 8 keep the 8 newest.
  - `"a site resource's subject is its hostname and links to its page"`: lifetime `app-lychee-land` gives subject `app.lychee.land` and href `/sites/app.lychee.land`.
  - `"a plain unit links to its board row"`: `swee` gives `/services#service-swee`.
  - `"a pruned resource and a removed site have no link"`: lifetime `old-lychee-land` (closed) gives subject `old.lychee.land` and href `null`. Audit `remove-site` for `gone.lychee.land` gives `null`.
  - `"a closed lifetime and a re-added one both contribute, in time order"` (Review Focus 4).
  - `"an unreadable Caddyfile means no site links"`: with `sites: null`, `app-lychee-land` gives href `/services#service-app-lychee-land`.
  - `shortAge`: 30s gives `now`, a future time gives `now`, 5m10s gives `5m`, 3h gives `3h`, 26h gives `1d`.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/views/activityModel.test.ts`. Expected: FAIL, because the module is missing.

- [ ] **Step 3: Implement** the types, `unitHref` (with `unitHealth` switched to it), `buildActivity` and `shortAge`. Hold the tables as `Record`s keyed by event type and audit base action, so that a missing row is a type error.

- [ ] **Step 4: Run the tests and check they pass.** Run the same command plus `src/views/railModel.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat: merge audit and reconciler history into labelled activity"`

### Task 4: `GET /api/activity`, `generated` on health, and the client queries

**Files:**
- Create: `src/routes/activity.ts`
- Create: `src/routes/apiActivity.test.ts`
- Modify: `src/app.ts` (mount `createActivityRouter(deps)` beside `createHealthRouter`)
- Modify: `src/shared/health.ts` (`generated: string | null` on `HealthPayload`)
- Modify: `src/views/railModel.ts` (`buildHealth` sets `generated: board.inventoryAvailable ? board.generated : null`)
- Modify: `src/routes/health.test.ts`
- Modify: `src/client/health.ts` (`fetchHealth` returns `generated`)
- Create: `src/client/activity.ts`
- Modify: every test or helper that builds a `HealthPayload` literal (add `generated: null`). `npm run typecheck` lists them.

**Interfaces:**
- Consumes: `readReconcilerEvents`, `readAuditTail`, `buildActivity`, `unitHref`, and `readInventory` (`src/lib/serviceInventory.ts`).
- Produces:
  ```ts
  // routes/activity.ts
  export function createActivityRouter(deps: Deps): Router;
  export function parseLimit(raw: unknown): number; // default 8, <1 or non-numeric → 8, cap 50
  // client/activity.ts
  export async function fetchActivity(limit?: number): Promise<ActivityPayload>; // same error handling as fetchHealth
  export const ACTIVITY_LIMIT = 8;
  export const ACTIVITY_QUERY: { queryKey: ["activity", 8]; queryFn; refetchInterval: 15_000; refetchIntervalInBackground: false; refetchOnWindowFocus: true; staleTime: 2_000 };
  ```
  The route answers `200` with `ApiOk<ActivityPayload>` in every case. It reads `readAuditTail(deps.fs, 200)`, which reads past dropped actions. It builds `ctx.sites` from the managed hostnames in the Caddyfile, or `null` if reading it throws. It builds `ctx.units` from the inventory's entries via `unitHref(name, group)`, and an empty map when the inventory is unavailable. `now` is `new Date().toISOString()`. Nothing is cached.

- [ ] **Step 1: Write the failing tests.** `apiActivity.test.ts` uses the route-test harness the other `api*.test.ts` files use (the dev fakes behind `createApp`, basic auth):
  - `"both sources"`: seed one audit line and one lifetime. Expect `sources: {app:true, reconciler:true}` and two events, with the reconciler one first when its time is newer.
  - `"no audit log"`: expect `sources.app` false and the reconciler events present.
  - `"no events feed"`: expect `sources.reconciler` false and the app events present.
  - `"neither"`: expect `200`, `events: []`, and both sources false.
  - `"limit default, cap and garbage"`: `parseLimit(undefined)`, `parseLimit("0")` and `parseLimit("x")` give 8, `parseLimit("12")` gives 12, `parseLimit("999")` gives 50. Over HTTP, `?limit=2` returns at most 2 events.
  - `"an unreadable Caddyfile still answers, with no site links"`.

  In `health.test.ts`, add `"generated is the inventory's write time"` and `"generated is null without an inventory"`.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/routes/apiActivity.test.ts src/routes/health.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the route, the `generated` field, and `client/activity.ts`.**

- [ ] **Step 4: Verify.** Run `npm run typecheck && npm test`. Expected: PASS, with every `HealthPayload` literal updated.

- [ ] **Step 5: Commit.** `git commit -m "feat: GET /api/activity, and the inventory's write time on /api/health"`

### Task 5: The overview model (strip, attention rows, signal) and its class strings

**Files:**
- Create: `src/views/overviewModel.ts`
- Create: `src/views/overviewModel.test.ts`

**Interfaces:**
- Consumes: `attentionCounts` (`railModel.ts`), `formatAge` (`shared.ts`), `HealthPayload` with `generated` (Task 4).
- Produces:
  ```ts
  export type OverviewPage = "sites" | "services" | "reconciler" | "infrastructure";
  export interface StripCell {
    page: OverviewPage; href: string;          // "/sites", "/services", "/reconciler", "/infrastructure"
    total: string | null;                      // "8 sites", "1 site", "11 units", "1 unit"; null when nothing to show
    bad: number; unknown: number;              // 0 when not shown
    note: string | null;                       // "last tick <formatAge>", "all clear", "inventory unavailable", or null
  }
  export function stripCells(h: HealthPayload | null, failed: boolean, now: Date): StripCell[];
  export interface AttentionRow { subject: string; href: string; word: string; tone: "bad" | "neutral"; where: OverviewPage }
  export function attentionRows(h: HealthPayload): { bad: AttentionRow[]; unknown: AttentionRow[] };
  export interface OverviewSignal { tone: "bad" | "neutral"; count: number | null; spoken: string }
  export function overviewSignal(h: HealthPayload | null, failed: boolean): OverviewSignal | null;
  /** attentionCounts over the payload's own site hostnames: the one count the page and the signal share. */
  export function overviewCounts(h: HealthPayload): ReturnType<typeof attentionCounts>;
  // class strings, exported: STRIP, STRIP_CELL, STRIP_LABEL, STRIP_TOTAL, STRIP_NOTE,
  // ATTENTION_HEADING, ATTENTION_SUBHEAD, ATTENTION_ROW, ATTENTION_WHERE,
  // ACTIVITY_TABLE, ACTIVITY_TH, ACTIVITY_TD, ACTIVITY_KIND_TAG, ACTIVITY_OUTCOME (Record<ActivityEvent["tone"], string>),
  // ACTIVITY_SUBJECT, RAIL_SIGNAL, RAIL_SIGNAL_DOT (Record<"bad"|"neutral", string>), RAIL_SIGNAL_COUNT (Record<…>), MENU_BADGE (Record<…>)
  ```

Rules:
- **Strip cells.** The counts come from `overviewCounts`. `sites` uses `counts.sites` and the others use the group counts.
  - Before the first data, or after a failed poll, every cell has `total: null`, chips 0 and `note: null`.
  - With `units: null`, the three unit cells read `inventory unavailable`, with `total: null`.
  - The reconciler cell's note is always `last tick ${formatAge(generated, now)}` when `generated` is set. Otherwise it follows the next rule.
  - Any cell with a total and nothing bad or unknown reads `all clear`.
- **Attention rows.**
  - Sites come first, in payload order, each together with its containers (`u.site === hostname`). A site is bad if any part has `attention`. Otherwise it is unknown if any part reads `unknown` and is not attention.
  - The site row's word is the site's label when the site itself is the bad part. Otherwise it is the first bad container's word.
  - Then plain units (`site === null`) in payload order.
  - A unit's word is `deploy ${trouble}` when `trouble` is set, else its `label`.
  - `href` is `/sites/<hostname>` for a site and `UnitHealth.href` for a unit.
  - `where` is `sites`, or the unit group's page name (`service` maps to `services`).
- **Signal.** It returns `null` before the first answer and when everything is clean.
  - A failed poll gives `{neutral, null, ", health unavailable"}`.
  - Anything bad gives `{bad, n, ", <n> need attention"}`, with `needs` when n is 1.
  - Unknown only gives `{neutral, n, ", <n> couldn't be read"}`.
- **Class strings** follow spec "Visual decision", in Tailwind on the existing palette. Match `railModel.ts`' mapping:
  - Hearth Lift is `bg-stone-800`, Hairline is `border-stone-700`, Smoke is `text-stone-400`, Smoke Light is `text-stone-300`, Chalk is `text-stone-50`, and Scorch is `text-red-300`.
  - `STRIP` is `CARD`'s ground and edge with no padding, laid out as `grid grid-cols-2 sm:grid-cols-4`.
  - `STRIP_CELL` is a padded link, `px-5 py-4 grid gap-1.5 no-underline` with a hairline `border-l` on cells after the first and `FOCUS_RING`.
  - The label is `CARD_LABEL_BASE` in Smoke Light. The total is mono `text-[0.95rem]` in Chalk. The note is mono `text-[0.75rem]` in Smoke with `min-h-[1lh]`, so empty notes keep the cells level.
  - `ATTENTION_ROW` is `grid grid-cols-[150px_minmax(0,1fr)_auto] gap-4 items-center py-2 border-b border-stone-700`.
  - `ACTIVITY_KIND_TAG` is mono `text-[0.72rem]` in Smoke Light with `rounded-full border border-stone-600 px-2`, and never a tone.
  - `ACTIVITY_SUBJECT` includes `[overflow-wrap:anywhere]`.
  - `RAIL_SIGNAL_DOT` is `inline-block size-1.5 rounded-full`, plus `bg-red-300` for bad or `bg-stone-400` for neutral.

- [ ] **Step 1: Write the failing tests** in `overviewModel.test.ts`. Build payloads with a local `payload({sites, units, generated})` helper.
  - `"all clear: totals and all clear, last tick on the reconciler cell"`: 2 sites and 3 units give cells `8 sites`-style totals. The reconciler note matches `/^last tick /`.
  - `"bad and unknown chips come from the shared count"`: chips equal `overviewCounts(h)` per page.
  - `"no inventory: the unit cells say so"`.
  - `"a failed poll drops every count"`: each cell has `total` null, chips 0 and note null.
  - `"singular nouns"`: 1 site gives `1 site`, 1 unit gives `1 unit`.
  - `"a site and its blocked container are one bad row, worded by the container"`: the site reads `running` and its container has `trouble: "blocked"`. Expect one row, `{subject:"app.lychee.land", word:"deploy blocked", where:"sites", href:"/sites/app.lychee.land"}`.
  - `"rows count exactly what the total counts"`: for a mixed payload, `bad.length === overviewCounts(h).total.bad` and the same for unknown.
  - `"rows keep payload order, sites before plain units"`.
  - `"a plain unit's where is its page"`: a reconciler unit gives `where: "reconciler"`.
  - The signal's states: pending gives `null`; clean gives `null`; failed gives `{neutral, null, ", health unavailable"}`; 5 bad and 3 unknown gives `{bad, 5, ", 5 need attention"}`; 1 bad gives `", 1 needs attention"`; 3 unknown only gives `{neutral, 3, ", 3 couldn't be read"}`.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/views/overviewModel.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `overviewModel.ts`.**

- [ ] **Step 4: Run the tests and check they pass.** Run the same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat: the overview's strip, attention rows and signal, as data"`

### Task 6: `OverviewPage` and its three blocks

**Files:**
- Create: `src/client/components/OverviewStrip.tsx`
- Create: `src/client/components/AttentionList.tsx`
- Create: `src/client/components/ActivityTable.tsx`
- Create: `src/client/pages/OverviewPage.tsx`
- Create: `src/client/pages/OverviewPage.test.tsx`

**Interfaces:**
- Consumes: Task 5's model and classes, `ACTIVITY_QUERY` (Task 4), `useRailHealth()` (`src/client/health.ts`, which gives `health`, `healthError` and `lastRead`), `shortAge` (Task 3), `RailLink` (`clientNav.tsx`), `BOARD_ALERT`, `TONE_PILL`, `formatAge`.
- Produces: `export function OverviewPage(): JSX.Element`, which Task 7 routes at `/`.

Page behaviour, from spec section 3 and "Visual decision":
- The order is the eyebrow heading `Overview`, then the strip, the attention block and the activity block.
  - The heading uses the same element and class as `BoardPage`'s eyebrow.
  - The attention block renders only when there are rows, or when the poll failed.
- `useLayoutEffect` sets `document.title = "overview · lychee admin"`.
- Heading focus copies `SitesPage`: once on an in-app arrival, not when `#find` outside a dialog has focus, and again on a same-page `locationKey` change.
- The attention block's failed state is `health unavailable · last read ${formatAge(lastRead, now)}`, or `health unavailable` when `lastRead` is null.
- The activity block:
  - The heading is `Recent activity`.
  - Under it is a `<table>` with the header cells `when who kind subject outcome`.
  - `when` is `<time dateTime={at} title={new Date(at).toLocaleString()}>{shortAge(at, now)}</time>`.
  - `who` is plain text.
  - `kind` is a tag span.
  - `subject` is a `RailLink` when `href` is set, otherwise a span.
  - `outcome` is a span carrying `ACTIVITY_OUTCOME[tone]`.
- The activity states:
  - Empty with both sources readable: `Nothing recorded yet.`
  - One source down: its line, under the table.
  - Both down: `Activity couldn't be read.` alone.
  - A failed re-read keeps the last table under a `role="alert"` `BOARD_ALERT` line, `Couldn't refresh activity: <reason>`, detected by timestamps as `SitesPage` does.
- The health and activity queries are read independently. Neither one's failure hides the other's block.

- [ ] **Step 1: Write the failing tests** in `OverviewPage.test.tsx`. Render inside a `QueryClientProvider` whose cache is pre-filled with `setQueryData(HEALTH_QUERY.queryKey, …)` and `setQueryData(ACTIVITY_QUERY.queryKey, …)`, the way `SitesPage.test.tsx` primes its query.
  - `"title and heading"`: `document.title === "overview · lychee admin"`, and a heading `Overview` exists.
  - `"four cells link to their pages, in rail order"`: the hrefs are `["/sites","/services","/reconciler","/infrastructure"]`.
  - `"all clear shows no attention block"`.
  - `"bad rows first, then unknown under its subheading"`: the headings `2 need attention` and `1 couldn't be read`, then the rows' subjects in order. Each row's first child is the pill.
  - `"a failed health poll replaces the attention block and keeps the activity table"` (Review Focus 3): the health query is errored and activity is present. Expect the `health unavailable` text, a table with rows, and no chip numbers in the strip.
  - `"a failed activity re-read keeps the table under an alert and leaves the strip alone"` (Review Focus 3).
  - `"activity empty"`: `Nothing recorded yet.`
  - `"reconciler history unreadable"`: the table, then `Reconciler history couldn't be read; showing app actions only.`
  - `"audit log unreadable"`: the matching line.
  - `"both unreadable"`: only `Activity couldn't be read.`, with no table.
  - `"an outcome carries its word and its tone class"`: the `deployed 0.1.0 → 0.2.0` cell's class includes `text-green-300`.
  - `"a subject with no href is not a link"`.
  - `"a 63-character subject wraps inside its cell"` (Review Focus 5): the subject element's class includes `[overflow-wrap:anywhere]`.
  - `"the age is a time element with the exact time as its title"`.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/client/pages/OverviewPage.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the three components and the page.** Each component takes plain props (`cells`, `rows`/`failed`/`lastRead`, `payload`/`alert`). Only the page touches queries.

- [ ] **Step 4: Run the tests and check they pass.** Run the same command, then `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Run the detector.** `"/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable" detect --json src/views src/client`. Expected: no new finding in the files this task added. Fix any that appear.

- [ ] **Step 6: Commit.** `git commit -m "feat: the overview page (strip, needs attention, recent activity)"`

### Task 7: Move the list to `/sites` and route the overview at `/`

**Files:**
- Modify: `src/routes/sites.ts` (add `sitesRouter.get("/sites", (_req, res) => sendClientDocument(res, deps))` beside `GET /`)
- Modify: `src/routes/staticShell.test.ts` or `src/routes/sites.test.ts`, wherever `GET /` serving the document is tested now
- Modify: `src/client/clientNav.tsx` (`OVERVIEW_ROUTE = "/"`, `SITES_ROUTE = "/sites"`, `isClientRoute` includes `OVERVIEW_ROUTE`)
- Modify: `src/client/router.tsx` (the overview route: a loader `ensureQueryData` for `HEALTH_QUERY` and `ACTIVITY_QUERY`, each `.catch(() => undefined)`, `HydrateFallback: Nothing`, and `element: <OverviewPage />`; the sites route at `SITES_ROUTE`)
- Modify: `src/client/components/SiteDetail.tsx:119,512,530`, `src/client/pages/AddSitePage.tsx:444`, `src/client/components/AddSiteForm.tsx:209` (`href="/"` becomes `"/sites"`; use `SITES_ROUTE`)
- Modify: `src/client/removeChain.ts:111` (`/sites?removed=`)
- Modify: `src/client/test/redesigns.ts` (link substitutions)
- Modify: `src/client/AppFrameParity.test.tsx` (the `sites` and `sites-removed` shell cases' `path` becomes `"/sites"`)
- Modify: `src/client/router.test.tsx`, `src/client/removeChain.test.tsx`, and any test that navigates to `/` expecting the list

**Interfaces:**
- Consumes: `OverviewPage` (Task 6), `HEALTH_QUERY`, `ACTIVITY_QUERY`.
- Produces: `OVERVIEW_ROUTE` and the new `SITES_ROUTE` value, which Task 8 reads.

- [ ] **Step 1: Write the failing tests.**
  - Server: `"GET /sites serves the client document with 200"` and `"GET /sites/ redirects 308 to /sites"`.
  - `router.test.tsx`: `"/ renders the overview"` (the heading is `Overview`) and `"/sites renders the sites list"`.
  - `clientNav`: `isClientRoute("/")` and `isClientRoute("/sites?x=1")` are both true.
  - `removeChain.test.tsx`: the landing is `/sites?removed=blog.lychee.land`.
  - `AppFrame.test.tsx`: `"?removed= on /sites shows the notice"` and `"?removed= on / shows none"`.

- [ ] **Step 2: Run the tests and check they fail.** Run `npm test`. Expected: those tests fail.

- [ ] **Step 3: Implement the route moves and the link changes.** Then add the redesign entries for the fixture links:
  - Each has `since: "2026-10-28"` and `why: "The sites list moved to /sites when / became the overview (spec 2026-10-28-overview-page)."`.
  - Each `from` and `anchor` is the link's exact `href="/" class="<class string>"` prefix as it appears in the frozen fixtures. Read the fixture text for each anchor, and never anchor on `href="/"` alone. One entry covers the shared breadcrumb class (site page and add page). There is one each for the not-found way back, the error way back, and the add form's Cancel.
  - `to` swaps in `href="/sites"`.

- [ ] **Step 4: Verify.** Run `npm run typecheck && npm test`. Expected: PASS, including `redesigns.test.ts`. The rail's own `sites` heading still links to `/` until Task 8, so expect no rail failures yet.

- [ ] **Step 5: Commit.** `git commit -m "feat: the sites list moves to /sites; / is the overview"`

### Task 8: The rail's single signal

**Files:**
- Modify: `src/client/components/Rail.tsx`
- Modify: `src/shared/rail.ts` (`RailCurrent`'s page union gains `"overview"`)
- Modify: `src/views/railModel.ts` (delete `RAIL_DOT` and `RAIL_COUNT_PAIR` if nothing else uses them; keep `RAIL_COUNT_BAD`/`RAIL_COUNT_UNKNOWN`, which the strip reuses for its chips)
- Modify: `src/client/test/redesigns.ts` (the four rail substitutions)
- Modify: `src/client/components/Rail.test.tsx`, `src/client/AppFrame.test.tsx`

**Interfaces:**
- Consumes: `overviewSignal`, `RAIL_SIGNAL*`, `MENU_BADGE` (Task 5), `OVERVIEW_ROUTE`/`SITES_ROUTE` (Task 7).

Changes:
- Remove the site rows' dot span, the `Count` component and its four uses, the top bar's `data-count="all"` slot, and the `health unavailable` line.
- Before the `Sites` nav, add `<nav aria-label="Overview" className="flex flex-col gap-0.5">` holding `<RailLink href={OVERVIEW_ROUTE} className={`${RAIL_ROW} justify-between`} aria-current={…"overview"}>overview{signal}</RailLink>`.
  - The signal is `<span data-signal="" aria-hidden="true" className={RAIL_SIGNAL}><span className={RAIL_SIGNAL_DOT[tone]} />{count}</span><span className="sr-only">{spoken}</span>`.
  - When `overviewSignal` returns null there is nothing at all.
- The `sites` heading links to `SITES_ROUTE`. `current` marks `overview` on `OVERVIEW_ROUTE` and `sites` on `SITES_ROUTE`.
- The top bar's menu button gets the class `relative`.
  - With a signal, it holds `<span data-signal="" aria-hidden="true" className={MENU_BADGE[tone]}>●{count === null ? "" : ` ${count}`}</span>`, and its `aria-label` becomes `` `Open navigation${spoken}` ``.
  - Without a signal, its markup is unchanged.
- `TopBar` no longer needs `hostnames`, because the signal counts the payload's own sites.
- Find is untouched. `FindPanel` still receives `health={live}`.
- Redesign entries (`since: "2026-10-28"`, why: `The rail is navigation plus one whole-host signal on overview (spec 2026-10-28-overview-page).`):
  - `rail-no-count`: `/\s*<span data-count="[a-z]+"><\/span>/g` becomes `""`. The anchor is `<span data-count="`.
  - `rail-no-dot`: the exact hollow-dot span from the fixtures (`<span class="inline-block size-2 shrink-0 rounded-full border border-stone-600 bg-transparent" data-dot="" aria-hidden="true"></span>`) becomes `""`. The anchor is `data-dot=""`.
  - `rail-sites-href`: the sites heading's `<a href="/" class="flex items-center justify-between font-mono text-[0.75rem]` prefix becomes the same with `href="/sites"`. The anchor is that prefix.
  - `rail-overview-row`: `<nav aria-label="Sites"` becomes the overview nav markup React renders with `health: null`, followed by `<nav aria-label="Sites"`. Copy the class strings from the rendered output. The anchor is `<nav aria-label="Sites"`.

- [ ] **Step 1: Write the failing tests** in `Rail.test.tsx`. Replace every test that asserts dots, count chips, the top-bar count or the unavailable line (the current tests at lines 156–230 and 293–414) with the tests below. Keep the parity tests (`the seeded sites`, `an unreadable Caddyfile`, `a missing inventory`, `every current marker`, `before any health, React's top bar is the server's`), which now compare through the declared redesigns.
  - `"site rows carry no dot"`: no `[data-dot]` with any health payload.
  - `"host links carry no count"`: no `[data-count]` anywhere.
  - `"overview sits above sites and links to /"`.
  - `"sites links to /sites"`.
  - `"before the first answer the overview row has no signal"`.
  - `"bad: a Scorch dot and the bad count, spoken as need attention"`: 5 bad and 3 unknown give visible `5`, the `bg-red-300` dot, and an accessible name `overview, 5 need attention`.
  - `"unknown only: a neutral dot and the unknown count"`: `overview, 3 couldn't be read`.
  - `"clean: nothing"`: no `[data-signal]`, and the accessible name `overview`.
  - `"a failed poll: a neutral dot and no number, even with old data"`: `healthError` true with a bad payload gives `bg-stone-400`, no digit, and `overview, health unavailable`.
  - `"the menu button carries the same signal"`: the badge text `● 5`, and `aria-label` `Open navigation, 5 need attention`. Clean gives the label `Open navigation` and no badge.
  - `"overview is current on /, sites on /sites"`, inside a memory router.

  Update `AppFrame.test.tsx` wherever it asserts the old marks.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/client/components/Rail.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement the rail changes and the redesign entries.**

- [ ] **Step 4: Verify.** Run `npm run typecheck && npm test`. Expected: PASS, including `AppFrameParity.test.tsx` and `redesigns.test.ts`. No fixture file has changed (`git status src/dev/fixtures` is clean).

- [ ] **Step 5: Run the detector.** Run it over `src/views src/client` as in Task 6. Expected: no new findings.

- [ ] **Step 6: Commit.** `git commit -m "feat: the rail carries one whole-host signal, on overview"`

### Task 9: Dev seed for history

**Files:**
- Modify: `src/dev/seed.ts` (`SEEDED_AUDIT_LOG`, `SEEDED_EVENTS`; `applySeed` writes them to `config.logFile` and `EVENTS_PATH`)
- Modify: `src/dev/seed.test.ts`

**Interfaces:**
- Consumes: `EVENTS_PATH`, `parseReconcilerEvents`, `readAuditTail`, `buildActivity`.
- Produces: the seeded history that `npm run dev:mock` shows.

Times are relative to process start, as `SEEDED_INVENTORY.generated` is, through a local `ago(minutes)` helper. The content agrees with the seed's inventory:
- `swee` (open): `added`, then `deployed v2.10.0 → v2.11.4`, then `blocked ci-failed`.
- `broken-lychee-land`: `added`, then `failed` with the inventory's `failed_step`.
- `lychee-notes`: `blocked ci-pending`, then `recovered` and `deployed 1.3.0 → 1.4.0` sharing one `at`. That is the two-in-one-tick case and the recovery.
- `gone-lychee-land`: `deployed → 0.4.2`, then `down from 0.4.2`.
- `preview-lychee-land`: `awaiting-image`.
- `lychee-docs`: `stopped`.
- `app-lychee-land`: `deployed 0.1.0 → 0.2.0`.
- One closed lifetime, `old-lychee-land`: `added` … `removed`, with `removed_at` set.

The audit log holds `add-site blog.lychee.land`, `remove-site-failed legacy.lychee.land`, `deploy-service broken-lychee-land` with `detail: "0.1.0"`, a `host-action` (`caller: "operator"`, `unit: "palworld-palchuds"`, `hostAction: "restart"`, `outcome: "started"`) and `refused-cross-site`.

- [ ] **Step 1: Write the failing tests** in `seed.test.ts`:
  - `"the seeded feed parses and holds every event type"`: the set of `type`s across lifetimes equals all nine.
  - `"the seeded feed has a closed lifetime and a shared tick"`.
  - `"the seeded audit log reads back in full"`: `readAuditTail` gives 5 lines.
  - `"seeded activity has both sources and fills the page"`: `buildActivity(..., 8)` has length 8 and includes both `who` values.

- [ ] **Step 2: Run the tests and check they fail.** Run `npx tsx --tsconfig tsconfig.test.json --test src/dev/seed.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the seed.**

- [ ] **Step 4: Verify.** Run `npm test`. Expected: PASS, including `addSiteAnswers.test.ts`. Its re-recording from the dev app must not change, because the add page does not read history. If it does change, stop and report.

- [ ] **Step 5: Look at the page.** Run `npm run build`, then load `http://127.0.0.1:8787/` with basic auth `dev`/`dev` (the dev:mock server, restarted). Check the strip, the attention list and an 8-row table at 1440×900 and 760×900, and the drawer's badge at 760. Fix anything off in one batch.

- [ ] **Step 6: Commit.** `git commit -m "feat: seeded history for dev mode"`

### Task 10: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**, as listed under the spec's Docs section:
  - Stack: `/` is the overview, the list is at `/sites`, `GET /api/activity`, `generated` on `/api/health`, the rail's single signal, and find unchanged. Also update the routes list and the `?removed=` notice path.
  - Core v1 feature flow: in the rail paragraph, the list's URL and the remove chain's landing (`/sites?removed=<host>`). In the "Every page renders inside the same frame" paragraph, replace the dots-and-chips description with the `overview` row and its signal states, and drop the `health unavailable` line.
  - Observability: replace "There is no run-history UI" with a pointer to the overview's activity table, which reads `events.json` (A-HIST-1) and the audit log.
- [ ] **Step 2: Verify.** Run `npm run typecheck && npm run lint && npm test && npm run build`. Expected: all pass.
- [ ] **Step 3: Commit.** `git commit -m "docs: the overview page in CLAUDE.md"`

After the whole-branch review, the main session runs `/impeccable document` as a scoped refresh. It adds the strip rule, the signal and the kind tag to `DESIGN.md`, and re-derives the sidecar's rule bodies. That step is not a subagent task, because it needs the user's refresh/overwrite/merge answer.
