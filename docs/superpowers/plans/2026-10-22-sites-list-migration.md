# Sites List Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `GET /` to React with output parity and a 15s live refresh, as a client route under the existing router, then retire `renderSiteList`.

**Architecture:**
- **Server.** A new `/api/sites` endpoint, sharing the board's 5s in-process read (generalised into one helper), feeds a React `SiteList`.
- **Client.** `/` joins the router's client routes.
- **Removed notice.** It stays server-rendered and the client cleans it up.
- **Errors.** Two server error fallbacks get a dedicated `renderErrorPage`.

**Tech Stack:**
- Express and TypeScript;
- React 19 with React Router 8.4.0 (data mode) and TanStack Query 5;
- `node:test` via `tsx`, with `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-22-sites-list-migration-design.md`

## Global Constraints

- **Edit/Write only.** Edit `src/views`, `src/client` and `public` with the Edit and Write tools only, never shell commands. Generated fixture files under `src/dev/fixtures` may be written by a one-off script.
- **Output parity** with `renderSiteList`: same elements, ids, classes and text, compared with `canonical()`.
  - Any phrase the server writes as one text node must be one text node in React. Build such phrases as single template strings.
  - The one sanctioned exception is the error pages in spec §5.
- **The list query:**
  - `refetchInterval: 15_000`
  - `refetchIntervalInBackground: false`
  - `refetchOnWindowFocus: true`
  - no fast mode.
- **The shared read:**
  - 5,000 ms, keyed per `deps.fs`;
  - concurrent callers share one in-flight read, and a rejected read is evicted;
  - `clearBoardCache()` clears it.
- **Failed refetch:** keep the last good list and show `role="alert"` reading "Couldn't refresh the sites list: <reason>", which clears on success. A failed first load shows the alert alone.
- **Unreadable Caddyfile:** `/api/sites` answers `200` with `caddyfileError` set to the message `GET /` shows today (`CommandError` message + `\n` + stderr, or `String(error)`).
- **Missing client bundle:** `/` answers `500` "client bundle missing; run npm run build".
- **Test hygiene:**
  - client tests use `{ timeout: 5000 }` on waits, `assert.ok(!node)` for absence and `assert.ok(a === b)` for node identity;
  - test QueryClients set `mutations: { gcTime: 0 }`.
- **Before every commit:** `npm run typecheck && npm run lint && npm test && npm run build`, plus the detector on `src/views src/client`. The suite must finish well under a minute.
- **Do not change** safety properties, middleware order, URLs, or any mutating route's behaviour.

## Review Focus

1. **A hostname with HTML-special characters, or a very long one.** It is escaped and wraps exactly as the server does, and is never injected as markup. Pinned in Task 3.
2. **A site removed in another tab while `/` is open.** The next refresh drops its row without moving focus or rebuilding the list. Pinned in Task 4.
3. **`/?removed=<host>` with characters that need encoding.** The notice shows the server-escaped text, and stripping `removed` keeps any other query parameters. Pinned in Task 4.
4. **The status cache returns a stale empty set after a site is added.** Adding a site (a write) clears it, so the new site's pill appears on the next read. Pinned in Task 1.
5. **Navigating `/` → `/services` → back.** The list shows from cache at once, then refreshes. The `#page-notice` from the first load stays gone. Pinned in Task 4.

---

### Task 1: The shared read helper, and `GET /api/sites`

**Files:**
- Create: `src/routes/readCache.ts`, which generalises the board's cache.
- Modify:
  - `src/routes/services.ts`: `loadBoardPage` uses the helper; `clearBoardCache` stays exported and clears all helper entries.
  - `src/routes/sites.ts`: add `cachedStatuses` and `cachedHostUnitStates`, and a `GET /api/sites` route.
  - `src/routes/health.ts`: use `cachedStatuses`.
  - `src/shared/board.ts`, or a new `src/shared/sites.ts`: add the payload types.
- Test: `src/routes/sites.test.ts`, `src/routes/readCache.test.ts`, and `src/routes/health.test.ts` where it asserts read counts.

**Interfaces:**
- Produces:
  - `cachedRead<T>(name: string, deps: Deps, read: () => Promise<T>, now?: () => number): Promise<T>` and `clearReadCaches(): void` in `readCache.ts`.
    - Entries are keyed by `(deps.fs, name)` and last 5,000 ms. Concurrent callers share the in-flight promise. A rejected promise is evicted.
    - `clearBoardCache()` calls `clearReadCaches()`.
  - `cachedStatuses(sites: Site[], deps: Deps): Promise<Record<string, SiteStatus>>`, cached under the name `"site-statuses"`. The cached value is computed for the full managed-site list, so callers must pass the same list.
  - `SiteSummary = { hostname: string; type: "static" | "reverse-proxy"; target: string; framework?: string }` and `SitesPayload = { sites: SiteSummary[]; statuses: Record<string, SiteStatus>; problems: HostProblem[]; domain: string; caddyfileError: string | null }`, both in `src/shared/`, types only.
  - `GET /api/sites` answers `ApiOk<SitesPayload>` and always `200`.

- [ ] **Step 1: Write failing tests:**
  - **readCache:** one read for two calls within 5 s; a fresh read after 5 s (injected clock); a rejected read is evicted; `clearReadCaches()` forces a new read; two different `fs` objects don't share.
  - **`/api/sites`:**
    - the seed payload has the managed sites in Caddyfile order and no `lychee.local`;
    - `statuses` matches what `GET /` shows today for api, app, preview, broken and gone;
    - `problems` is empty with a healthy seed and holds one line when `caddy.service` reads `failed`;
    - an unreadable Caddyfile gives `200` with `caddyfileError` set and empty arrays;
    - `401` without credentials.
  - **Shared read:** `GET /api/health` then `GET /api/sites` within 5 s makes one `computeStatuses` pass, counted through the fake's status-check calls.
  - **Review Focus 4:** read `/api/sites`, `POST /sites` adding a site, read again. The new site is present with its status.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Move the board cache onto `cachedRead` without changing its behaviour; the existing board-cache tests must still pass unchanged.
- [ ] **Step 4: Run the full check.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: one shared 5s read for site status, and /api/sites`

---

### Task 2: A dedicated server error page

**Files:**
- Modify: `src/views/html.ts`, to add `renderErrorPage`.
- Modify: `src/routes/sites.ts`. The `/sites/new` and `/sites/:hostname` Caddyfile-unreadable fallbacks use it, with current `null`. `GET /` keeps `renderSiteList` until Task 4.
- Test: `src/views/html.test.ts` and `src/routes/sites.test.ts`.

**Interfaces:**
- Produces: `renderErrorPage(title: string, message: string, shell: ShellData): string`. It renders the shell plus the list's existing red error-box markup and classes, unchanged, around the escaped message, and a link `<a href="/">← sites</a>` styled like the add-site page's breadcrumb link.

- [ ] **Step 1: Write failing tests:**
  - `renderErrorPage` escapes the message.
  - It uses the same error-box classes `renderSiteList` uses for its `error`.
  - It contains no `Sites` heading and no `#empty-state`.
  - With an unreadable Caddyfile, `GET /sites/new` and `GET /sites/api.lychee.land` answer `500` with the message and the link, and the rail marks nothing as current.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full check.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: a dedicated error page for the site routes' 500s`

---

### Task 3: The React `SiteList` (render-only, parity)

**Files:**
- Create: `src/client/components/SiteList.tsx`. It renders the heading row (with Ember Add site when sites exist), the host-trouble block, the rows (hostname split, address, `· Next.js`, pill) and the empty state. When `caddyfileError` is set, it renders the error box followed by the empty state, as `renderSiteList([], {}, domain, message, …)` does today.
- Modify: node-free modules (`src/views/shared.ts`, or a new `src/views/siteListModel.ts`). Move into them any class string or row logic the React side needs that today lives only in `html.ts`. `html.ts` output must stay byte-identical; `html.test.ts` passes unchanged.
- Test: `src/client/components/SiteListParity.test.tsx`

**Interfaces:**
- Consumes: `SitesPayload` (Task 1); `describeStatus`, `splitHostnameForDisplay` and `statePhrase`.
- Produces: `SiteList({ payload: SitesPayload })`.

- [ ] **Step 1: Write the failing parity tests.** For each fixture, React `SiteList` equals the body region of `renderSiteList` after `canonical()`. Fixtures:
  - a static row;
  - reverse proxy, responding and not responding;
  - Next.js: running, awaiting image, failed, not deployed;
  - an unknown status;
  - a row with no status entry;
  - a host-trouble block with one line, and with several;
  - an empty list;
  - a Caddyfile error;
  - a hostname containing `<`, `&` and `"` (Review Focus 1), plus a 63-character label.

  Add one negative case where a mismatch is caught.
- [ ] **Step 2: Write the failing single-text-node test.** Render live (`createRoot` + `flushSync`) and walk every element. Wherever the server markup has a text node, React must have exactly one text node with the same value at that position. Compare the child-node shapes of both DOMs.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run the full check.** Expected: PASS.
- [ ] **Step 6: Commit** `feat: the React sites list renders every row the server list does`

---

### Task 4: `/` as a live client route, with the notice handling

**Files:**
- Create: `src/client/pages/SitesPage.tsx`. It uses the list query (`sitesQueryKey()`, `fetchSites()`), the failed-refetch rule, and the heading focus on client navigation under the board's rule (not when focus is in a wide-screen `#find`). On mount it sets `document.title = "Sites"`.
- Modify: `src/client/api.ts`, to add `sitesQueryKey` and `fetchSites`.
- Modify: `src/client/clientNav.tsx`. `/` becomes a client route (`isClientRoute("/")` is true), and the rail's `sites` heading `aria-current` follows the route.
- Modify: `src/client/router.tsx`, to add the `/` route with a loader that primes the query and `ScrollRestoration` coverage like the board routes.
- Modify: `src/routes/sites.ts`. `GET /` serves `renderClientPage("Sites", "sites", { page: "sites" }, assets)`, or `500` without assets. It also keeps passing the `?removed` notice banner, so the server still renders `#page-notice` with today's markup.
- Modify: `src/views/clientShell.ts`, if `renderClientPage` needs a banner parameter. Add it with no change to existing callers' output.
- Modify: `src/client/main.tsx` or the router layout. On load, remove `removed` from the URL with `history.replaceState`, keeping other parameters and the hash. On the first client navigation away from `/`, remove `#page-notice` from the DOM.
- Test: `src/client/pages/SitesPage.test.tsx`, `src/client/router.test.tsx` and `src/routes/sites.test.ts`.

**Interfaces:**
- Consumes: `SiteList` (Task 3), `SitesPayload` and `/api/sites` (Task 1), and the existing router, `ClientNav` and `RailLink`.
- Produces: the `SitesPage` component and the `/` client route.

- [ ] **Step 1: Write the failing tests:**
  - **Route:**
    - `GET /` answers the shell with `data-page="sites"`, title `Sites`, the rail's `sites` heading current, and `500` without assets;
    - `GET /?removed=blog.lychee.land` includes `#page-notice` with "Removed blog.lychee.land. Remember to remove the DNS record in Cloudflare manually.";
    - `401` without credentials.
  - **Live:**
    - the interval is 15,000;
    - a failed refetch keeps the rows and shows the alert, and the next success clears it;
    - a refresh that drops `gone.lychee.land` removes only that row, with focus unchanged (Review Focus 2).
  - **Router:**
    - `/` → `/services` → back makes no document load, and the list shows at once from cache (Review Focus 5);
    - the title and `aria-current` follow;
    - links to `/sites/<host>` and `/sites/new` are plain anchors.
  - **Notice:**
    - on load `?removed=a%26b.lychee.land&x=1#h` becomes `?x=1#h` (Review Focus 3);
    - after a client navigation to `/services`, `#page-notice` is gone;
    - returning to `/` doesn't bring it back.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full check.** Expected: PASS. Rail and board parity are unchanged.
- [ ] **Step 5: Manual check.** Run `npm run build`, then `PORT=8794 npx tsx src/dev/server.ts` (dev/dev).
  - Move `/` → `services` → `/` without a reload.
  - Watch the list refresh.
  - Remove a site from its page and land on `/` with the notice; reload and it is gone.

  Stop only the server you started.
- [ ] **Step 6: Commit** `feat: the sites list is a live client route`

---

### Task 5: Retire `renderSiteList`, and docs

**Files:**
- Create: `src/dev/fixtures/sites/*.html`, generated from `renderSiteList` before deletion, one per Task 3 parity fixture.
- Modify:
  - `src/client/components/SiteListParity.test.tsx`, to read the fixtures;
  - `src/views/html.ts`, to delete `renderSiteList` and helpers only it used, keeping every helper another page or `SiteList` imports;
  - `src/routes/sites.ts`, to delete the dead `GET /` HTML path;
  - `src/styles/tailwind.css`, to add an `@source not` for `src/dev/fixtures/sites` if the fixtures sit under an `@source`. `public/style.css` must stay byte-identical.
- Move: the `html.test.ts` and `sites.test.ts` tests that rendered the list. Each goes to the layer that now owns its behaviour (React `SiteList`, `/api/sites` JSON, or the frozen fixtures), with none dropped silently.
- Modify: `CLAUDE.md`. It must cover:
  - the list on React;
  - `/api/sites`;
  - the shared read now covering site status;
  - the error pages;
  - the notice handling;
  - the fixtures.

  Correct every sentence about `renderSiteList` or the server-rendered list. Change `PRODUCT.md` only where it names how the list is rendered.

- [ ] **Step 1: Generate the fixtures and switch the parity tests.** Expected: PASS against the files, before anything is deleted.
- [ ] **Step 2: Delete and move.** `grep -rn "renderSiteList" src` returns nothing. Site detail and add-site tests still pass.
- [ ] **Step 3: Run the full check.** Expected: PASS. The detector returns `[]` on `src/views src/client`.
- [ ] **Step 4: Update the docs.**
- [ ] **Step 5: Commit** `refactor: retire the server-rendered sites list; docs`

After Task 5, the controller runs the browser check against `npm run dev:mock`:
- `/`, with sites and empty, compared pixel for pixel against `main` at 1280 and 390px;
- a real remove ending on `/` with the notice;
- a reload that drops the notice.
