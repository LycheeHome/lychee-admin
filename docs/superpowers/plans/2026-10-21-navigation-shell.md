# Navigation Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the header band with a rail shell on every page: a fixed left rail that lists every site with a live dot, the three host sections with attention counts, a ⌘K find panel, and Add site.

**Architecture:**
- **Server side.** The server renders the rail on every page, with no health and hollow dots, from a cheap `loadShell(deps, current)`, which does filesystem reads only. That data reaches `layout()` through one required `shell` option.
- **Client side.** The client bundle now loads on every page. A React `RailIsland` takes over the rail with markup that matches the server's exactly (a parity test pins this). It polls `GET /api/health` every 15s and fills in dots and counts. A `FindPanel` combobox opens on ⌘K.
- **Shared logic.** Node-free logic (tones, the attention rule, the counting rule, class strings) lives in one module that both renderers import.

**Tech Stack:**
- Express;
- TypeScript template-string views;
- React 19 and TanStack Query 5 on Vite;
- the `node:test` runner via `tsx`;
- `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-21-navigation-shell-design.md`

## Global Constraints

- **Edit/Write only.** Edit files under `src/views`, `src/client` and `public` with the Edit and Write tools only, never through a shell command, so the design-detector hook sees every change.
- **DESIGN.md is normative.**
  - Use existing tokens and class constants (`src/views/shared.ts`).
  - Use exactly three status tones: `ok`, `bad` and `neutral`. Static sites get a hollow dot ("none").
  - Mono for machine facts (hostnames, unit names, counts, hints); sans for sentences.
- **Current item.** `aria-current="page"` gets today's treatment: Chalk on Hairline with a 2px Ember Edge left rule.
- **One Ember action per view.** In the rail that is Add site.
- **Polling.**
  - `refetchInterval: 15_000`
  - `refetchIntervalInBackground: false`
  - `refetchOnWindowFocus: true`
  - An errored poll never shows a remembered green.
- **Test waits.** Every `findBy*` or `waitFor` in a client test carries `{ timeout: 5000 }`.
- **Copy, verbatim from the spec:**
  - `health unavailable · last read <relative time>`
  - `Can't read the Caddyfile`
  - `Inventory unavailable`
  - `Nothing needs attention.`
  - `No site matches “<q>”.`, and the same shape per unit group: `No services match “<q>”.`, `No reconciler units match “<q>”.`, `No infrastructure units match “<q>”.`
  - the find hint `⌘K` on Apple platforms, `Ctrl K` elsewhere
- **Never change:** safety properties, URLs, or middleware order (auth, then `sameOrigin`, then static, then routers). `/api/health` is behind auth.
- **Verification.** After every task, run `npm run typecheck && npm run lint && npm test && npm run build`, plus `impeccable detect --json src/views src/client`, before committing.

## Review Focus

1. **Regex characters in a find query.** A query like `a.l` or `(` must match literally and never throw. Pinned in Task 4.
2. **Health and rail disagree.** A site in the rail but missing from the health payload stays hollow. A health entry for a site the rail doesn't list (just removed) is ignored. Pinned in Task 3.
3. **A 63-character hostname label.** It wraps inside the 250px rail instead of overflowing it. The rail row's hostname span carries `min-w-0 break-all`. Pinned in Task 2.
4. **⌘K while typing in the add-site form.** It still opens find, and Esc returns focus to that exact input. Pinned in Task 4.
5. **Units unavailable while sites are known.** With `units: null`, the sites count still shows, the host counts hide, and find lists only sites. Pinned in Tasks 3 and 4.

---

### Task 1: The health model and `GET /api/health`

**Files:**
- Create: `src/shared/health.ts` (types only)
- Create: `src/views/railModel.ts` (node-free: tones, attention, counting rule, unit hrefs, and the rail class strings Tasks 2 and 3 share)
- Create: `src/routes/health.ts`
- Modify: `src/app.ts`, to mount `createHealthRouter(deps)` after the services router
- Modify: `src/routes/sites.ts`, to export `computeStatuses`
- Test: `src/views/railModel.test.ts`, `src/routes/health.test.ts`

**Interfaces:**
- Consumes:
  - `computeStatuses(sites, deps)` (sites.ts, newly exported)
  - `loadBoardPage(deps): Promise<BoardPageData>` (services.ts)
  - `describeStatus`, `deployTrouble` (lib/siteDisplay)
  - `rowLabels` (views/boardFacts)
  - `resourceNameFor(hostname, domain)` (lib/siteResource)
- Produces (in `src/shared/health.ts`):
  - `type Tone = "ok" | "bad" | "neutral" | "none"`
  - `interface SiteHealth { hostname: string; tone: Tone; label: string; attention: boolean }`
  - `interface UnitHealth { name: string; group: ServiceGroup; tone: Exclude<Tone, "none">; label: string; trouble: "blocked" | "failed" | null; href: string; attention: boolean }`
  - `interface HealthPayload { sites: SiteHealth[]; units: UnitHealth[] | null; now: string }`
- Produces (in `railModel.ts`):
  - `siteHealth(site: Site, status: SiteStatus | undefined): SiteHealth`
  - `unitHealth(row: BoardRow, group: ServiceGroup): UnitHealth`
  - `buildHealth(sites: Site[], statuses: Record<string, SiteStatus>, board: ServiceBoard, domain: string, now: Date): HealthPayload`
  - `attentionCounts(h: HealthPayload): { sites: number; service: number | null; reconciler: number | null; infrastructure: number | null }`, which is null per group when `units` is null
  - class constants `RAIL_ROW`, `RAIL_HEADING`, `RAIL_DOT: Record<Tone, string>`, `RAIL_COUNT_BAD`, `RAIL_COUNT_ZERO`
- Produces (in `routes/health.ts`):
  - `createHealthRouter(deps): Router`, serving `GET /api/health` → `ApiOk<HealthPayload> | ApiError`

- [ ] **Step 1: Write the failing model tests** in `railModel.test.ts`:
  - `siteHealth` of a static site is `{ tone: "none", attention: false }`.
  - A `{kind:"tcp", responding:false}` status is `{ tone: "bad", label: "not responding", attention: true }`.
  - An awaiting-image status is `neutral`, with `attention: false`.
  - `unitHealth` of a `running` row with `result:"blocked"` and a known gate code is `{ tone: "ok", trouble: "blocked", attention: true }`.
  - The same row with `gateCode: "ci-pending"` gives `trouble: null`, `attention: false`. Use whichever code `deployTrouble` treats as waiting; read the `BLOCKED_TROUBLE` table.
  - The hrefs are `/services#service-swee`, `/reconciler#service-lychee-watch-timer` and `/infrastructure#service-caddy`.
  - `buildHealth` excludes the board row `broken-lychee-land` when the site `broken.lychee.land` is in `sites`.
  - `attentionCounts` with `units: null` returns `{ sites: n, service: null, reconciler: null, infrastructure: null }`.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test src/views/railModel.test.ts`. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `src/shared/health.ts` and `railModel.ts`.**
  - The site's label is `describeStatus(status).pill`.
  - A unit's tone and label come from `rowLabels(row.status)`.
  - `buildHealth` returns `units: null` when `board.inventoryAvailable` is false.
  - Class strings: copy the current-item treatment from `HEADER_ITEM` in `shell.ts`. The hollow dot is `border border-stone-600 bg-transparent`.
- [ ] **Step 4: Run** the model tests. Expected: PASS.
- [ ] **Step 5: Write the failing route tests** in `health.test.ts`, using the fakes and seed the way `services.test.ts`'s `serve` does:
  - With the seed, `api.lychee.land` is `bad`, `app.lychee.land` is `ok`, `preview.lychee.land` is `neutral` and `lychee.land` is `none`.
  - `units` contains `swee` with `trouble: "blocked"`, and does not contain `broken-lychee-land`.
  - A missing inventory file gives `units: null`.
  - With no Authorization header, the status is `401`.
- [ ] **Step 6: Run** the route tests. Expected: FAIL, with a 404 on `/api/health`.
- [ ] **Step 7: Implement `createHealthRouter` and mount it.**
  - It parses the Caddyfile for managed sites.
  - It runs `computeStatuses` and `loadBoardPage` together under `Promise.all`, then calls `buildHealth`.
  - A thrown read answers a `500` with `{ ok: false, reason }`.
  - It never refreshes the clone.
- [ ] **Step 8: Run** the full check from Global Constraints. Expected: PASS.
- [ ] **Step 9: Commit:** `feat: /api/health, one batched read of site and unit health`

---

### Task 2: The server rail replaces the header band

**Files:**
- Create: `src/views/rail.ts`
- Modify: `src/views/shell.ts`. It gains `ShellData`, `RailData`, `RailCurrent` and `loadShell`. `layout()` takes a required `shell` option, and the header band is deleted.
- Modify: `src/views/html.ts` and `src/views/clientShell.ts`. Every page renderer takes `shell: ShellData` as its last parameter, and the `#hostname-switcher` dropdown and its constants are deleted. The sites list's Add site button renders only in the empty state, which it already does through `#empty-state-cta`, so the header-row button goes.
- Modify: `src/routes/sites.ts` and `src/routes/services.ts`. Every page response builds `shell` with `loadShell(deps, current)`.
- Modify: `public/app.js`. Delete the `#hostname-switcher` block, and update the add-site comment that names "the breadcrumb switcher" to name the rail.
- Modify: `src/dev/testHelpers.ts`. Add `testShell(overrides?)`, and rename `withoutHeader` to `withoutShell` so it strips the rail.
- Test: `src/views/rail.test.ts`, plus the updated callers in `html.test.ts`, `sites.test.ts` and `services.test.ts`.

**Interfaces:**
- Consumes: the `RAIL_*` constants (Task 1) and `readClientManifest` (clientShell).
- Produces:
  - `type RailCurrent = { page: "sites" | "new" | "services" | "reconciler" | "infrastructure" } | { site: string } | null`
  - `interface RailData { sites: Array<{ hostname: string; hint: string }> | null; hostAvailable: boolean; current: RailCurrent; domain: string }`, where `hint` is `static` or `:<port>`
  - `interface ShellData { rail: RailData; assets: ClientAssets | null }`
  - `loadShell(deps: Deps, current: RailCurrent): ShellData`, which does filesystem reads only (the Caddyfile and the inventory file) and never throws
  - `renderRail(rail: RailData): string` in `rail.ts`. The root is `<aside id="rail" data-rail …>`. It contains `<input id="find" …>` with the hint, a sites list with `data-site="<hostname>"` and a dot `data-dot` per row, and host links with `data-count="service|reconciler|infrastructure"`. Sites carry `data-count="sites"`.
  - `layout(title, body, { shell, banner?, head?, bodyEnd? })` now emits the client bundle's tags on **every** page whenever `shell.assets` is non-null, and the `Nav` type is deleted.

- [ ] **Step 1: Write the failing rail tests** in `rail.test.ts`:
  - `renderRail` lists the seeded sites in Caddyfile order. Each row links to `/sites/<hostname>` and carries a hollow dot.
  - `{ site: "broken.lychee.land" }` puts `aria-current="page"` on that row only.
  - `{ page: "new" }` marks Add site.
  - `sites: null` renders `Can't read the Caddyfile`.
  - `hostAvailable: false` renders `Inventory unavailable` and no `data-count` values for the host groups.
  - The hostname span carries `min-w-0 break-all` (Review Focus 3).
  - Add site is the only element with the `BUTTON_PRIMARY` classes.
  - The find hint reads `⌘K`.
- [ ] **Step 2: Run** the rail tests. Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `renderRail` and `loadShell`.**
  - `loadShell` takes `assets` from `deps.clientAssets`, read per call, which keeps the dev getter working.
  - The server cannot know the platform, so it always prints `⌘K`. The island corrects it to `Ctrl K` (Task 3).
- [ ] **Step 4: Thread `shell` through `layout()`, every renderer and every route.**
  - Layout: a two-column grid at `min-[900px]:` widths, with a 250px rail and the content column holding today's `<main>` contents and widths. Below 900px, a top bar with the wordmark and a `<button id="rail-menu" aria-label="Open navigation">`.
  - The site detail breadcrumb becomes plain text: `sites / <hostname>`.
- [ ] **Step 5: Update the existing page tests.**
  - Every `html.test.ts` call passes `testShell()`. Replace `withoutHeader` with `withoutShell`.
  - Add assertions that no page contains `id="site-header"` or `hostname-switcher`.
  - Each page type has the right `aria-current`: the list marks the sites heading, `/sites/new` marks Add site, a site page marks its row, the boards mark their links, and the not-found page marks nothing.
  - The list page with sites has no header-row Add site button.
- [ ] **Step 6: Run** the full check. Expected: PASS. A grep for `hostname-switcher` across `src` and `public` returns nothing.
- [ ] **Step 7: Commit:** `feat: every page renders the rail in place of the header band`

---

### Task 3: The rail island takes over and fills in live health

**Files:**
- Create: `src/client/components/Rail.tsx`, a pure component `Rail({ rail, health, healthError, lastRead })` mirroring `renderRail`
- Create: `src/client/RailIsland.tsx`, which reads the server's `RailData` and runs the health query
- Create: `src/client/health.ts`, with `fetchHealth(): Promise<HealthPayload>` modelled on `fetchBoard`, and `useHealth()`, which wraps `useQuery` with the Global Constraints' polling values
- Modify: `src/views/rail.ts`. Embed the rail data as `<script type="application/json" id="rail-data">…</script>`, JSON with `<` escaped as `<`.
- Modify: `src/client/main.tsx`. Always mount `RailIsland` onto `#rail`, and the page component only where `#app-root` names one, sharing one `QueryClient`.
- Test: `src/client/components/Rail.test.tsx`, `src/client/RailIsland.test.tsx`

**Interfaces:**
- Consumes:
  - `RailData`, `renderRail` (Task 2)
  - `HealthPayload`, `attentionCounts`, `RAIL_*` (Task 1)
  - `createQueryClient` (foundation)
- Produces:
  - `useHealth(): UseQueryResult<HealthPayload>`
  - `Rail` props: `{ rail: RailData; health: HealthPayload | null; healthError: boolean; lastRead: string | null; onOpenFind?: () => void }`. With `health: null` and `healthError: false`, its render equals `renderRail(rail)`.

- [ ] **Step 1: Write the failing parity test.** For the seeded `RailData`, `sites: null` and `hostAvailable: false`, React's `Rail` with `health: null` equals `renderRail`, after the same normalisation the infrastructure parity test uses.
- [ ] **Step 2: Write the failing behaviour tests:**
  - **Health fills in.** A payload turns `api.lychee.land`'s dot `bad` and `app.lychee.land`'s dot `ok`. The sites count shows `2`, the services count shows `3`, and the zero groups render the quiet zero class.
  - **Error state.** `healthError: true` renders every non-static dot neutral, hides all counts, and shows `health unavailable · last read 2 minutes ago` (give it a `lastRead` 2 minutes before a fixed `now`).
  - **Disagreement (Review Focus 2).** A health payload missing `legacy.lychee.land` leaves its dot hollow, and an entry for `removed.lychee.land` adds no row.
  - **Units unavailable (Review Focus 5).** With `units: null`, the sites count shows and the host counts are absent.
  - **The island.**
    - Rendered over server markup with `fetch` stubbed to the seed payload, it shows the bad dot within `{ timeout: 5000 }`.
    - With `navigator.platform` set to a non-Apple value, the hint reads `Ctrl K`.
- [ ] **Step 3: Run** both files. Expected: FAIL, because the modules are missing.
- [ ] **Step 4: Implement `Rail`, `health.ts`, `RailIsland` and the `main.tsx` change.**
  - The island reads `#rail-data`, then calls `createRoot(#rail).render(…)`.
  - `lastRead` is `dataUpdatedAt` when non-zero. The relative time comes from `formatAge(lastRead, now)` in `src/views/shared.ts`, the helper the boards already use, never a second formatter.
  - When `isError` is true, the rail renders the error state even though TanStack keeps the old data.
- [ ] **Step 5: Run** the full check. Expected: PASS. Then reload a page on `npm run dev:mock` and confirm the dots fill within one poll.
- [ ] **Step 6: Commit:** `feat: the rail goes live: one health poll fills dots and counts on every page`

---

### Task 4: The ⌘K find panel

**Files:**
- Create: `src/client/components/FindPanel.tsx`
- Create: `src/client/find.ts`. This is pure: `findResults(query: string, health: HealthPayload | null, railSites: RailData["sites"]): FindGroups` and `attentionResults(health): FindGroups`.
- Modify: `src/client/components/Rail.tsx`. Replace the input with a `FindPanel` anchored to it.
- Modify: `src/client/RailIsland.tsx`. Add a document-level ⌘K/Ctrl+K handler that calls `preventDefault`, remembers `document.activeElement` and focuses `#find`.
- Test: `src/client/find.test.ts`, `src/client/components/FindPanel.test.tsx`

**Interfaces:**
- Consumes: `HealthPayload`, `UnitHealth`, `SiteHealth` (Task 1), and `Rail` (Task 3).
- Produces:
  - `type FindItem = { kind: "site"; hostname: string; tone; label: string | null; href: string } | { kind: "unit"; name: string; group; tone; label: string; trouble; href: string }`
  - `type FindGroups = Array<{ key: "sites" | ServiceGroup; items: FindItem[] }>`, always in the order sites, service, reconciler, infrastructure
  - `FindPanel` props: `{ health: HealthPayload | null; railSites: RailData["sites"]; navigate?: (href: string) => void }`, where `navigate` defaults to `location.assign`

- [ ] **Step 1: Write the failing pure tests** in `find.test.ts`:
  - `attentionResults` on the seed lists `api` and `broken` under sites, and `swee`, `swee-staging` and `palsave-api` under services.
  - With nothing needing attention, every group is empty.
  - `findResults("sw", …)` returns no sites and two services.
  - `findResults("a.l", …)` and `findResults("(", …)` don't throw and match literally (Review Focus 1).
  - With `health: null`, sites are matched from `railSites` with `label: null`, and there are no unit groups.
  - With `units: null`, only sites are listed (Review Focus 5).
  - Matching is case-insensitive.
- [ ] **Step 2: Write the failing panel tests:**
  - Focusing the empty input lists the attention items. With none, it shows `Nothing needs attention.`
  - Typing `sw` shows `No site matches “sw”.` under Sites.
  - ArrowDown crosses groups. Enter calls `navigate("/services#service-swee")` for swee and `navigate("/sites/broken.lychee.land")` for broken.
  - Esc closes the panel and restores focus to the previously focused element (Review Focus 4: focus a `<textarea>`, press Meta+K, then Escape).
  - The input has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`. The list is `role="listbox"` with `role="option"` rows.
  - No row is an action: no text contains "Remove" or "Deploy".
- [ ] **Step 3: Run** both files. Expected: FAIL, because the modules are missing.
- [ ] **Step 4: Implement them.**
  - Match with `String.prototype.includes` on lowercased strings. No `RegExp`.
  - The panel is absolutely positioned beside the rail, at most 420px wide, scrolling internally with `max-h-[calc(100vh-…)]`.
  - Group headings use `role="presentation"`.
  - A group with no match shows its own empty sentence, from Global Constraints.
- [ ] **Step 5: Run** the full check. Expected: PASS.
- [ ] **Step 6: Commit:** `feat: ⌘K find over every site and unit, attention first`

---

### Task 5: Narrow screens and the docs

**Files:**
- Modify: `src/client/components/Rail.tsx` and `src/client/RailIsland.tsx`. Below 900px, `#rail-menu` opens a modal `<dialog>` holding the rail, which closes on Esc or a scrim click. The top bar shows the overall attention count (sites plus units) and a find icon button that focuses find.
- Modify: `src/views/rail.ts`. Below 900px the server markup is the top bar, with the wordmark linking to `/`. Without the bundle, that leaves a link home, a known limit to record in the docs.
- Modify: `CLAUDE.md`:
  - the shell paragraph (the rail, the island on every page, `/api/health`);
  - the dropdown and status-check paragraph (the dropdown is retired, and the poll's cost is accepted: one batched read every 15s, paused when hidden);
  - the two banner elements in the rail layout.
- Modify: `PRODUCT.md`: the "Surfaces today" sentence about the header band.
- Test: `src/client/components/Rail.test.tsx` (drawer)

- [ ] **Step 1: Write the failing drawer tests:**
  - Clicking `#rail-menu` opens a `dialog` that contains the site rows.
  - Escape closes it.
  - A click on the backdrop closes it. Use the bounding-rect check `public/app.js` already uses for its modal.
  - The top bar's count equals the sum of `attentionCounts`.
- [ ] **Step 2: Run** the drawer tests. Expected: FAIL.
- [ ] **Step 3: Implement the drawer and the top-bar markup.**
- [ ] **Step 4: Update CLAUDE.md and PRODUCT.md** as listed above. Edit minimally: change only what this work made false.
- [ ] **Step 5: Run** the full check. Expected: PASS.
- [ ] **Step 6: Commit:** `feat: the rail collapses to a top bar and drawer below 900px; docs describe the rail`

After Task 5, the controller runs the spec's browser check against `npm run dev:mock`:
- the sites list, a site page, a board page and `/sites/new`, at 1280px and 390px;
- ⌘K from a server page and from `/infrastructure`;
- a dot updating after a seeded state change within one poll.

`/impeccable document` runs as a scoped refresh after merge, per the spec.
