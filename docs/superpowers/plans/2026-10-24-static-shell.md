# Static Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve every client route as one Vite-built static `index.html` and have React render the whole body, then retire `layout()`, `clientShell.ts`, `rail.ts`, `loadShell.ts` and `RailPortal` behind frozen fixtures.

**Architecture:**
- **Freeze first.** Snapshot the server shell's and rail's output as fixtures before changing anything.
- **Build alongside.** Add `GET /api/rail` and a React `AppFrame` that reproduces `layout()`'s body, held to those fixtures.
- **Switch over.** Point Express and `mountApp` at the static document.
- **Retire.** Delete the server renderers.

**Tech Stack:** Express and TypeScript; React 19, React Router 8.4.0 (data mode), TanStack Query 5, Vite; `node:test` via `tsx`, with `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-24-static-shell-design.md`

## Global Constraints

- **Edit/Write only.** Edit `src/views`, `src/client`, `public`, `index.html` and every test file with the Edit and Write tools only, never shell commands, `sed`, `perl` or `python`. Generated fixture files under `src/dev/fixtures` may be written by a one-off script, which is then deleted.
- **Parity after load:** the same elements, ids, classes, attributes and text as `layout()` produces, compared with `canonical()` and `canonical(html, { inlineWhitespace: true })` (`src/client/test/canonical.ts`). Anything the server writes as one text node is one text node in React.
- **Copy is unchanged.** The removed notice is `Removed <host>. Remember to remove the DNS record in Cloudflare manually.`; the created notice is `addedNotice(site)` from `src/views/siteDetailModel.ts`; the pre-bundle title is `lychee admin`.
- **Statuses:**
  - `/sites/:hostname` answers `404` only when the Caddyfile is readable and has no such managed site.
  - Every client route answers `500` with `client bundle missing; run npm run build` when the static document is absent.
  - Otherwise every route answers `200`.
- **`/api/rail`** answers `ApiOk<RailPayload>` and always `200`. It runs no status checks.
- **Unchanged:** every other `/api/*` endpoint, every write route, focus rules, polling cadences, the `created`/`removed` URLs, safety properties and middleware order.
- **Test hygiene:**
  - waits use `{ timeout: 5000 }`;
  - assert absence with `assert.ok(!node)`;
  - never `assert.equal` DOM nodes (a failing one hangs the runner); use `assert.ok(a === b)`;
  - test QueryClients set `mutations: { gcTime: 0 }`;
  - test servers use `listen(0, "127.0.0.1")`.
- **Before every commit:** `npm run typecheck && npm run lint && npm test && npm run build` (chained, so any failure stops the commit), plus the detector on `src/views src/client`.

## Review Focus

1. **`/api/rail` itself fails** (network error or 5xx). The rail keeps its fixed parts, shows no rows and no error line, never throws, and fills the rows on the next successful read (focus refetch or invalidation). Pinned in Task 3.
2. **A cold deep link to a site page.** The title is the hostname, and once `/api/rail` answers, that site's rail row is `aria-current="page"`. An unknown site gets HTTP 404, the not-found body and the title `Site not found`. Pinned in Task 4.
3. **The narrow drawer opened before `/api/rail` answers.** It shows the fixed parts, gains the rows in place when they arrive, and stays open. Pinned in Task 3.
4. **A toast showing while the frame re-renders** (a rail refetch after a write, a health poll). The toast's message, tone and visibility are untouched. Pinned in Task 3.
5. **Deep paths load their assets.** `/sites/app.lychee.land` and `/sites/new` load the bundle from absolute `/client/assets/...` URLs. Pinned in Task 4.

---

### Task 1: Freeze the shell and rail output

**Files:**
- Create: `src/dev/fixtures/shell/*.html` and `src/dev/fixtures/rail/*.html`, written by a one-off generator that is deleted after the run.
- Create: `src/views/shellFixtures.test.ts`, which asserts each fixture equals the live renderer's output today. Task 5 deletes it along with the renderers.

**Interfaces:**
- Produces: the shell fixtures are `layout()`'s body from just after `<body ...>` up to (not including) `<div id="react-root">`, generated with `testShell()` plus the seed rail.
  - `sites.html`, `sites-removed.html`;
  - `services.html`, `reconciler.html`, `infrastructure.html`;
  - `site-static.html`, `site-static-created.html`, `site-next-created.html`;
  - `add-site.html`, `site-unknown.html`;
  - `caddyfile-unreadable.html`, `inventory-unavailable.html`.

  The rail fixtures are `renderRail(rail)` and `renderTopBar()` for every case `src/views/rail.test.ts` and `src/client/components/Rail.test.tsx` already build. Name each one after its case.
- Each fixture's page body is the server's empty `#app-root` (`data-page`) div as `renderClientPage` emits it. Task 3 compares the frame around it, not the page content, which earlier sub-projects already pinned.

- [ ] **Step 1:** Write the generator, run it once, then delete it.
- [ ] **Step 2:** Write `shellFixtures.test.ts`: each fixture is `===` the live output, and every fixture file is read.
- [ ] **Step 3:** Run it, then the full check. Expected: PASS. No source file changes in this task.
- [ ] **Step 4:** Commit `test: freeze the server shell and rail output`.

### Task 2: `GET /api/rail`

**Files:**
- Create: `src/shared/rail.ts`, `src/routes/apiRail.test.ts`
- Modify: `src/routes/sites.ts` (or a new `src/routes/rail.ts` mounted beside `health.ts`), `src/routes/loadShell.ts`

**Interfaces:**
- Produces:
  - `export type RailPayload = { sites: { hostname: string; hint: string }[] | null; hostAvailable: boolean; domain: string }` in `src/shared/rail.ts`.
  - `readRail(deps): RailPayload`, which is `loadShell()`'s body. `loadShell` calls it until Task 5 deletes `loadShell`.

- [ ] **Step 1: Write the failing tests** on a seeded dev app:
  - `lists the seed's managed sites in Caddyfile order with static or :port hints, excluding lychee.local`.
  - `an unreadable Caddyfile answers 200 with sites: null`.
  - `an unavailable inventory answers 200 with hostAvailable: false`.
  - `runs no status check`: the counts of `readUnitStates` and `checkPortOpen`/resource-status calls are 0.
  - `401 without credentials`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check.
- [ ] **Step 5: Commit** `feat: /api/rail, the rail's rows without a status check`.

### Task 3: `AppFrame`, React's whole body

**Files:**
- Create:
  - `src/client/AppFrame.tsx`, `src/client/rail.ts` (`useRail`, `railQuery`);
  - `src/client/components/PageNotice.tsx`;
  - `src/client/AppFrame.test.tsx`, `src/client/AppFrameParity.test.tsx`.
- Modify:
  - `src/client/api.ts`: `fetchRail()`, `RAIL_QUERY_KEY = ["rail"]`.
  - `src/client/mutations.ts`: `refresh()` also invalidates `RAIL_QUERY_KEY`.
  - The page components, so they set `document.title` on a document load as well: `SitesPage`, `BoardPage`, `SiteDetailPage`, `AddSitePage`.

**Interfaces:**
- Consumes: `RailPayload`, `Rail` (`src/client/components/Rail.tsx`), `RailIsland`'s current props logic, `addedNotice`, and `stripNoticeParams` (`src/client/router.tsx`).
- Produces:
  - `AppFrame({ notice, children })`. It renders the top bar, the rail, and `div.min-w-0.px-6.pb-16 > main` holding the toast host, `#copy-status`, `<PageNotice>`, then `children`. Every class string is `layout()`'s.
  - `readInitialNotice(win: Window): { kind: "removed"; host: string } | { kind: "created" } | null`, called once before `stripNoticeParams`.
  - The toast host is a memoised component with no props, so it never re-renders.

- [ ] **Step 1: Write the failing parity tests** (`AppFrameParity.test.tsx`):
  - For each shell fixture, render `AppFrame` with the same `RailPayload`, no health and the same notice. Put an empty `<div id="app-root" class="contents" data-page="…">` in as `children`, which isolates the frame from the pages. Compare under both canonical modes. Normalisation: unwrap the test container only.
  - For each rail fixture, render `Rail` health-free and compare.
  - End with the every-fixture-read check.
- [ ] **Step 2: Write the failing behaviour tests** (`AppFrame.test.tsx`):
  - **Before data:** before `/api/rail` answers, the rail shows the wordmark, find, the `sites` heading and the host links, with no site rows and no error line. After it answers, the rows appear.
  - **Health fails:** with a 500 from `/api/health` and an OK `/api/rail`, the rows are listed with neutral dots and `health unavailable`.
  - **RF1:** a failed `/api/rail` raises no error, keeps the fixed parts, and a later successful refetch fills the rows.
  - **RF3:** open the narrow drawer before `/api/rail` answers, then resolve it. The drawer is still open and contains the rows.
  - **RF4:** `showToast("x", "error")`, then trigger a frame re-render (a rail refetch and a health poll). `#flash-banner` still shows `x`, red tone and close button visible.
  - **Notices:**
    - `?removed=x.lychee.land` renders the removed notice;
    - `?created=1` on a site page renders `addedNotice(site)` once the site payload is in;
    - the notice's close removes it;
    - the first in-app move away removes it, and returning does not bring it back.
  - **Writes:** after a successful in-app write (Attach), `/api/rail` is fetched again.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** `AppFrame` is not mounted yet; Task 4 switches to it. Keep `RailPortal` working until then.
- [ ] **Step 5: Run** the full check and the detector.
- [ ] **Step 6: Commit** `feat: AppFrame, the shell in React`.

### Task 4: Serve the static document and mount `AppFrame`

**Files:**
- Create: `index.html` at the repo root, the Vite input.
- Modify:
  - `vite.config.ts`: `rollupOptions.input: "index.html"`, with the entry `<script type="module" src="/src/client/main.tsx">` inside it. Keep `manifest: true`, `base: "/client/"` and `outDir: "public/client"`.
  - `src/deps.ts`: `clientDocument?: string | null` replaces `clientAssets`.
  - `src/server.ts`: read it once.
  - `src/dev/server.ts`: re-read it on every request, through the same getter pattern it uses for `clientAssets`.
  - `src/routes/sites.ts`, `src/routes/services.ts`: every client route sends `deps.clientDocument` with the spec's statuses.
  - `src/client/router.tsx`: `mountApp` renders `<AppFrame notice={readInitialNotice(window)}>` around the routes into `#react-root`, and `RailPortal` and the `#rail`/`#top-bar`/`#app-root` lookups go.
  - `scripts/assemble-release.sh`: also require `public/client/index.html`.
- Tests: `src/routes/staticShell.test.ts`, plus updates to `sites.test.ts`, `services.test.ts` and the router tests.

**Interfaces:**
- `index.html`:
  - `<html lang="en" class="[color-scheme:dark]">`;
  - the `<head>` of `layout()`, with the same metas, font preconnects, the fonts stylesheet, and `<link rel="stylesheet" href="/style.css">`;
  - `<title>lychee admin</title>`;
  - `<body>` with `layout()`'s body classes, holding only `<div id="react-root" class="contents"></div>` and the entry script.
- Ruling carried from the spec: `#react-root` is `class="contents"`, so `AppFrame`'s children are the body grid's items, as `layout()`'s were.

- [ ] **Step 1: Write the failing tests:**
  - every client route answers 200 with the built `index.html` body (stub `deps.clientDocument` with a marker string);
  - `/sites/unknown.lychee.land` answers 404 with the same body, and an unreadable Caddyfile answers 200;
  - with `clientDocument: null`, every client route answers 500 with the text;
  - `/api/sites` and a write route are unaffected;
  - **RF5:** in a real `npm run build` output, which a test reads when it exists and skips with a logged reason when it doesn't, every `<script>` and stylesheet URL starts with `/client/assets/` or is `/style.css`, so a deep path loads them;
  - `index.html` carries the fonts link, `/style.css` and `[color-scheme:dark]`;
  - **RF2 (router tests):**
    - mounting on a body that has only `#react-root` at `/sites/app.lychee.land` sets the title to `app.lychee.land`, and once `/api/rail` answers the `app.lychee.land` rail row has `aria-current="page"`;
    - at an unknown host, the title is `Site not found` and the not-found body shows.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check, `npm run build`, and `ls public/client/index.html`. Expected: PASS, and the file exists.
- [ ] **Step 5: Commit** `feat: every page is one static document React renders`.

### Task 5: Retire the server shell; docs

**Files:**
- Delete:
  - `src/views/shell.ts`'s `layout()` and everything only it uses, or the whole file if nothing else imports it;
  - `src/views/clientShell.ts`;
  - `src/views/rail.ts`, `src/views/rail.test.ts`;
  - `src/routes/loadShell.ts`, `src/routes/loadShell.test.ts`;
  - `src/views/shell.test.ts` and `src/views/clientShell.test.ts`: move what still applies to the static document or `AppFrame` tests, and list every move;
  - `RailPortal` and `RailIsland`'s `#rail-data` reader;
  - `src/client/RailIsland.test.tsx` cases that render the server rail. They move to `AppFrame` tests, or are dropped where a fixture covers them, and each is listed;
  - `src/views/shellFixtures.test.ts`, since the fixtures are now read only by `AppFrameParity`;
  - `testShell()` and every other helper in `src/dev/testHelpers.ts` that only served `layout()`.
- Modify:
  - `src/client/components/Rail.test.tsx`: compare against the rail fixtures instead of `renderRail`.
  - `CLAUDE.md`:
    - the static document and `/api/rail`;
    - React renders the whole body;
    - the shell and rail fixtures;
    - remove every passage about a server-rendered shell, `layout()`, `rail.ts`, `RailPortal`, two rail renderers, `loadShell` and `renderClientPage`.

    Correct the frontend paragraph's opening ("mid-migration…"), because the migration is complete.

- [ ] **Step 1: Delete and move.** `git grep -n "layout(\|renderClientPage\|renderRail\|loadShell\|RailPortal\|clientAssets\|readClientManifest" src scripts` returns nothing.
- [ ] **Step 2: Run** the full check and the detector. Expected: PASS, `[]`. `public/style.css` builds byte-identical to before this task, with `cmp` evidence.
- [ ] **Step 3: Update the docs.**
- [ ] **Step 4: Commit** `refactor: retire the server shell; the SPA migration is complete`.

After Task 5, the controller runs the browser check against `npm run dev:mock`:
- **Pixel comparison against `main`** at 1280 and 390px, after load: `/`, `/services`, a site page, `/sites/new`, an unknown site, `/?removed=`, and a site page with `?created=1`.
- **Interactions:** the narrow drawer and ⌘K find; toast, copy and notice close.
- **End to end:** an add, a remove and a Deploy.
