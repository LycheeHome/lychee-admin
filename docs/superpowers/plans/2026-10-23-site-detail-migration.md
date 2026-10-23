# Site Detail Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `GET /sites/:hostname` to React with output parity, a live refresh and every one of its writes as React code, then retire `renderSiteDetail`, `renderSiteNotFound` and `app.js`'s detail handlers.

**Architecture:**
- **Server.** A new `GET /api/sites/:hostname` returns the facts `renderSiteDetail` already takes, read through a per-site 5s `cachedRead`, with a clone pull only on `?refresh=1`.
- **Shared logic.** The page's derived decisions move into a node-free `siteDetailModel.ts` that both renderers import, so the React components are held to the server's output by parity tests until the server renderer is deleted.
- **Client.** `/sites/:hostname` becomes a router route whose loader sends `?refresh=1`. Writes reuse the board's mutation plumbing.

**Tech Stack:**
- Express and TypeScript;
- React 19 with React Router 8.4.0 (data mode) and TanStack Query 5;
- `node:test` via `tsx`, with `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-23-site-detail-migration-design.md`

## Global Constraints

- **Edit/Write only.** Edit `src/views`, `src/client` and `public` with the Edit and Write tools only, never shell commands. Generated fixture files under `src/dev/fixtures` may be written by a one-off script.
- **Output parity** with `renderSiteDetail` and `renderSiteNotFound`: same elements, ids, classes and text, compared with `canonical()` (`src/client/test/canonical.ts`). Any phrase the server writes as one text node must be one text node in React; build such phrases as single template strings.
- **Copy is unchanged.** Every toast, error and step string is copied verbatim from `public/app.js` or `src/views/html.ts`, never reworded.
- **Endpoints are unchanged:**
  - `/services/:name/deploy`, `/resources/:name/prune`;
  - `/sites/:hostname/attach`, `/sites/:hostname/repository`;
  - `/sites/:hostname/delete`, `/sites/:hostname/detach`, `/sites/:hostname/delete-files`.

  Same request bodies, response shapes and status codes.
- **The page query:**
  - `refetchInterval` is `15_000`, or `3_000` while `resource.requestedTag` is set;
  - `false` while a page write is in flight or the remove dialog is open;
  - `refetchIntervalInBackground: false`;
  - `refetchOnWindowFocus: true`;
  - `staleTime: 2_000`.
- **The per-site read:** `cachedRead("site-detail:<hostname>", deps, …)`, kept 5,000 ms. A `?refresh=1` request evicts that entry after its pull. `clearBoardCache()` clears it.
- **Failed refetch:** keep the last good page under `role="alert"` with the `BOARD_ALERT` class, reading `Couldn't refresh <hostname>: <reason>`, which clears on success. A failed first load shows the alert alone.
- **API errors** use the existing shape `{ ok: false, reason }` (`ApiError` in `src/shared/board.ts`).
- **Missing client bundle:** `/sites/:hostname` answers `500` with `client bundle missing; run npm run build`.
- **Test hygiene:**
  - waits use `{ timeout: 5000 }`;
  - absence is asserted with `assert.ok(!node)`;
  - test QueryClients set `mutations: { gcTime: 0 }`;
  - test servers `listen(0, "127.0.0.1")`.
- **Before every commit:** `npm run typecheck && npm run lint && npm test && npm run build`, chained with `&&` so a failure stops the commit, plus the detector on `src/views src/client`.
- **Do not change** safety properties, middleware order, URLs, or any mutating route's behaviour.

## Review Focus

1. **A hostname in the URL with capitals or percent-encoding** (`/sites/App.Lychee.Land`, `/sites/app%2Elychee.land`). It shows the same page as the canonical form, with that site's rail row current. Pinned in Task 7.
2. **Moving to another site while a write on the first is still in flight.** The write finishes without throwing and without moving focus into the new page. Its toast still reports the outcome. Pinned in Task 5.
3. **The site disappears (a poll would answer `404`) while the remove dialog is mid-chain.** The dialog is never unmounted under the chain, because polling is paused while it is open. Pinned in Task 7.
4. **Enter pressed twice quickly in Attach or Change repository.** Exactly one POST is sent. Pinned in Task 5.
5. **`/sites/<host>?created=1&x=1#hop` on a document load.** `created` is stripped, `x=1` and the hash are kept, and the notice shows once. Pinned in Task 7.

---

### Task 1: The per-site read and `GET /api/sites/:hostname`

**Files:**
- Create: `src/shared/siteDetail.ts`, `src/routes/apiSiteDetail.test.ts`
- Modify: `src/routes/sites.ts`, `src/views/html.ts` (move types only)

**Interfaces:**
- Produces:
  - `SiteDetailOptions`, `SiteResourceView` and `FailureFacts` move from `html.ts` to a new `src/views/siteDetailModel.ts` (types only in this task; `html.ts` imports them from there).
  - In `src/shared/siteDetail.ts`:
    ```ts
    export type SiteDetailFacts = Omit<SiteDetailOptions, "created">;
    export type SiteDetailPayload =
      | ({ site: Site; filesPath: string | null; caddyfileError: null } & SiteDetailFacts)
      | { caddyfileError: string; domain: string };
    ```
  - `loadSiteDetail(site: Site, deps: Deps): Promise<SiteDetailFacts>` in `sites.ts`. It holds today's GET body after the site lookup, and `GET /sites/:hostname` calls it, so the HTML page and the API cannot gather differently.
  - `cachedSiteDetail(site, deps)` wraps it in `cachedRead("site-detail:" + site.hostname, …)`.
  - `evictRead(name: string, deps: Deps): void` added to `src/routes/readCache.ts`.

- [ ] **Step 1: Write the failing tests** in `apiSiteDetail.test.ts`. Use a seeded dev app on `127.0.0.1`, as `apiSites.test.ts` does.
  - `each seed site answers 200 with its facts`:
    - `lychee.land` has `filesPath` and `filesExist: true`;
    - `app.lychee.land` has `resource.version === "0.2.0"` and `resource.available === "0.3.0"`;
    - `gone.lychee.land` has `detached: true`;
    - `api.lychee.land` has `status.kind === "tcp"`.
  - `an unknown hostname answers 404 { ok: false, reason }`.
  - `the hostname is matched case-insensitively` (`/api/sites/APP.lychee.land` → 200).
  - `an unreadable Caddyfile answers 200 with caddyfileError`, equal to the `CommandError` message + `\n` + stderr.
  - `401 without credentials`.
  - `?refresh=1 pulls once and a plain read never pulls`: count `refreshDeclarations` calls on the fakes. Two plain reads give 0; one refresh read on a Next.js site gives 1; one refresh read on a static site gives 0.
  - `two reads within 5s make one host read`: count `readUnitStates` calls → 1.
  - `a refresh read evicts and re-reads`: count goes to 2.
  - `a write clears it`: POST `/sites/app.lychee.land/attach` (or any write route) between two reads → 2 reads.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test src/routes/apiSiteDetail.test.ts`. Expected: FAIL (404s from the missing route).
- [ ] **Step 3: Implement.**
  - Extract `loadSiteDetail`, and move the types.
  - Add `evictRead`.
  - Add `GET /api/sites/:hostname`, registered after `GET /api/sites`:
    - lowercase the param;
    - an unreadable Caddyfile is the error variant;
    - an unknown site is `404`;
    - `refresh === "1"` → `refreshClone` (Next.js sites only), then `evictRead`, then `cachedSiteDetail`;
    - `filesPath` is `computeFilesPath(site, config.sitesRoot)`.
  - `GET /sites/:hostname` keeps rendering HTML in this task, through `loadSiteDetail`.
- [ ] **Step 4: Run** the file, then the full check. Expected: PASS. `html.test.ts` and `sites.test.ts` unchanged and green.
- [ ] **Step 5: Commit** `feat: /api/sites/:hostname, through one shared 5s read per site`

### Task 2: `siteDetailModel.ts`, the page's decisions without Node

**Files:**
- Modify: `src/views/siteDetailModel.ts` (created in Task 1), `src/views/html.ts`
- Create: `src/views/siteDetailModel.test.ts`

**Interfaces:**
- Produces, node-free. The module imports nothing from `node:*`, `../config` or `../lib/platform` values, only types and node-free modules:
  - `hopFixKeys(site: Site, f: SiteDetailFacts): ("tunnel" | "caddy" | "your app")[]` and `appFix(site, f): AppFix | null`, with:
    ```ts
    type AppFix =
      | { kind: "failed-first-deploy" }
      | { kind: "port"; command: string }
      | { kind: "container"; command: string };
    ```
    The commands are exactly today's strings (`ss -ltn 'sport = :<port>'`, `docker compose -p <name> logs --tail 100`).
  - `runbookSteps(site, f): { n: 1 | 2 | 3 | 4; done: boolean; folds: boolean }[]`.
  - `canChangeRepository(resource)`.
  - `offerFor(f): { name: string; tag: string; requested: boolean; emphasis: "offer" | "primary" } | null`.
  - `cardOrder(f): ("path" | "repository" | "manual" | "danger")[]`.
  - `removeSteps(f): { id: string; label: string }[]`.
  - `addedNotice(site): string` (today's `addedBanner`).
  - `manualSteps(site, f, filesPath)`, which returns today's `ManualStep[]`.
  - The class constants `html.ts` defines for the detail page (`STEP_DONE`, `CODE_FILE`, `COPY_TOP` and the rest it uses) move here, exported.
- `filesPath` is passed in, never computed here (that needs `node:path`).

- [ ] **Step 1: Write the failing tests** in `siteDetailModel.test.ts`, one `describe` per function, over the seed sites' facts. Build the facts with the helper Task 1's test used, moved to `src/dev/testHelpers.ts` as `seedSiteDetailFacts(hostname)`.
  - `broken` → `appFix.kind === "failed-first-deploy"`.
  - `api` not responding → `port` with `ss -ltn 'sport = :4000'`.
  - Bad `cloudflared-sites.service` → `hopFixKeys` starts with `"tunnel"`.
  - `preview` → steps 1 and 2 not done, 3 done; `canChangeRepository` true.
  - `app` → `offerFor` gives `{ tag: "0.3.0", requested: false, emphasis: "offer" }`; with `requestedTag: "0.3.0"`, `requested: true`.
  - Attached → `cardOrder` is `path, repository, manual, danger`; unattached → `path, manual, repository, danger`, with no repository for static sites.
  - `removeSteps` has 4 entries plain and 5 attached, the fifth labelled `<name>.yml set to state: absent`.
- [ ] **Step 2: Run** the file. Expected: FAIL (not exported).
- [ ] **Step 3: Implement**, by moving logic out of `html.ts` and making `html.ts` call it. No output change.
- [ ] **Step 4: Run** the full check. Expected: PASS, with **`html.test.ts` unchanged** (the proof `html.ts`'s output did not move). `grep -n "node:" src/views/siteDetailModel.ts` returns nothing.
- [ ] **Step 5: Commit** `refactor: the site page's decisions in a node-free model`

### Task 3: React `SiteDetail`: header, request path, manual steps, danger zone, not-found

**Files:**
- Create:
  - `src/client/components/SiteDetail.tsx`
  - `src/client/components/SiteDetailParity.test.tsx`
  - `src/client/components/SiteDetailMarkup.test.tsx`
- Modify: `src/client/components/BoardRows.tsx` (export `CopyButton`/command-block helpers if not already shared)

**Interfaces:**
- Consumes: Task 2's model and constants, and `SiteDetailPayload`.
- Produces:
  - `SiteDetail({ payload, headingRef, card })` renders the page body in `cardOrder`:
    - `payload` is the non-error variant;
    - `headingRef` is a `Ref<HTMLHeadingElement>` on the hostname heading;
    - `card` is a render slot for the repository card, defaulting to null until Task 4.
  - The danger zone renders the Remove button and the closed `<dialog id="confirm-remove-dialog">` markup only (`RemoveDialog` in Task 6 replaces the static markup).
  - `SiteNotFound({ hostname })`.
  - `CaddyfileError({ message })` renders `renderErrorPage`'s body region.

- [ ] **Step 1: Write the failing parity tests.** Compare `canonical(renderToStaticMarkup(<SiteDetail …/>))` with the `<main>` region of `renderSiteDetail(site, opts, testShell())`, sliced as `SiteListParity` slices the list. The cards Task 4 owns are compared with the repository card cut out of both sides, by its `<section>`; record the cut in the test's helper.
  - Cases:
    - `lychee.land`, with and without its directory;
    - `api` responding and not responding;
    - `legacy`;
    - bad tunnel, bad Caddy, and both;
    - an empty `tunnelId`;
    - the dialog for a plain site and for an attached one.
  - Plus `SiteNotFound` vs `renderSiteNotFound`, and `CaddyfileError` vs `renderErrorPage("Can't read the Caddyfile", …)`.
  - In `SiteDetailMarkup.test.tsx`: `every one-line phrase is one text node`. Render live with `createRoot`, and for each element whose server text is a single text node, assert `childNodes.length === 1`. Mirror `SiteListMarkup.test.tsx`.
  - Copy buttons keep their `data-copy-target` ids (`cmd-fix-tunnel`, `cmd-fix-caddy`, the DNS ids).
- [ ] **Step 2: Run** the parity file. Expected: FAIL.
- [ ] **Step 3: Implement** `SiteDetail.tsx` from `html.ts`'s detail functions, using the model.
- [ ] **Step 4: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 5: Commit** `feat: the React site page renders the server's request path, steps and danger zone`

### Task 4: React repository card (runbook and installed), with a shared offer and requested line

**Files:**
- Create: `src/client/components/RepositoryCard.tsx`, `src/client/components/DeployLines.tsx`
- Modify:
  - `src/client/components/BoardRows.tsx`, to import `OfferLine`/`RequestedLine` from `DeployLines.tsx`; board parity stays green;
  - `SiteDetail.tsx` (its `card` slot defaults to `RepositoryCard`);
  - both parity files.

**Interfaces:**
- Produces:
  - `OfferLine({ name, tag, emphasis, controls? })` and `RequestedLine({ tag, name?, controls? })` in `DeployLines.tsx`, byte-for-byte today's board twins.
  - `RepositoryCard({ payload, writes? })`, where `writes` is a `SiteWrites` object Task 5 defines; absent means inert buttons.
  - The Attach form is `form[data-attach]` with `#attach-error`; the Change repository form is `form[data-change-repository]` with `#change-repo-error`. Both keep their ids and attributes.
  - The card's heading carries the id `repository-heading`. If the server markup has no id, add none: Task 5 finds it by `section[aria-labelledby]` or the heading's existing id, and records which in the report.

- [ ] **Step 1: Write the failing parity tests,** the full page with no cut:
  - `legacy` (runbook, unattached);
  - `preview` (awaiting image, with Change repository);
  - `app` (installed, offer);
  - `app` with `requestedTag` (requested line);
  - `broken` (failed first deploy: step 4 points up, a newer tag on offer);
  - `gone` (detached warning and Prune, primary);
  - a blocked gate line;
  - an inventory-only resource (`repo: null`).

  Remove Task 3's cut helper.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The `<template data-requested-template>` is not rendered by React: compare with the server output minus that template, and note it in the helper as the one sanctioned difference (spec §5).
- [ ] **Step 4: Run** the full check, `BoardParity` included. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the React repository card, sharing the board's offer and requested line`

### Task 5: The card's writes: Deploy, Prune, Attach, Change repository

**Files:**
- Create: `src/client/siteWrites.ts`, `src/client/siteWrites.test.tsx`
- Modify:
  - `src/client/mutations.ts`: `refresh()` also invalidates `SITE_DETAIL_ROOT`; `shows()` also reads site-detail queries' `resource.requestedTag`;
  - `src/client/api.ts`: `SITE_DETAIL_ROOT = ["site"] as const` and `siteDetailQueryKey(hostname)`;
  - `RepositoryCard.tsx`.

**Interfaces:**
- Consumes: `useDeploy(onRequested)` and `usePrune()` from `mutations.ts`.
- Produces:
  - `useAttach(hostname)` and `useChangeRepository(hostname)`, each a `useMutation<void, Error, string /* repo */>` with `mutationKey: ["site-write", hostname]`.
  - `useSiteWrites(hostname): SiteWrites`.
  - `useSiteWriteInFlight(hostname): boolean`. It is true while any `["site-write", hostname]`, `["deploy"]` or `["prune"]` mutation is pending (`useIsMutating`), and Task 7 uses it to pause polling.

- [ ] **Step 1: Write the failing tests** in `siteWrites.test.tsx`, rendering `RepositoryCard` with a stubbed `fetch`.
  - **Attach.**
    - Empty repo → `#attach-error` reads `Enter the repository's name.`, the input has focus, and no fetch is sent.
    - Success → toast `Attaching r to preview.lychee.land…`, one POST with body `repo=r`, the site query invalidated, and focus on the card heading once the re-read lands.
    - Refusal → `#attach-error` shows `reason`, visible before its text is written, the toast hidden, and the button re-enabled.
    - Network failure → `Could not reach the server to attach r.`
    - Two quick submits → one POST.
  - **Change repository.** The same five cases, with `#change-repo-error` and today's strings (`Changing <hostname>'s repository to <repo>…`, `Could not change the repository to <repo> (HTTP <status>).`, `Could not reach the server to change the repository to <repo>.`).
  - **Deploy.**
    - Success → the requested line replaces the offer and has focus.
    - Refusal → error toast and the button re-enabled.
  - **Prune.**
    - Success → focus on the card heading.
    - 409 → `<name>.yml was not pruned: <reason>`.
  - **Review Focus 2.** Start Attach, unmount the page before the response, resolve it → no throw, `document.activeElement` unchanged, and the success toast still shown.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Post bodies are `URLSearchParams({ repo })`, as `app.js` sends.
  - Each mutation awaits the invalidated re-read before settling, so the form stays disabled until it lands.
  - Focus moves only when the element that had it is gone, the rule `usePrune` already uses.
- [ ] **Step 4: Run** the full check. `mutations.test.tsx` and the board tests stay green.
- [ ] **Step 5: Commit** `feat: the site page's card writes as React mutations`

### Task 6: The remove dialog and its chain

**Files:**
- Create: `src/client/components/RemoveDialog.tsx`, `src/client/removeChain.ts`, `src/client/removeChain.test.tsx`
- Modify: `SiteDetail.tsx` (replace the static dialog with `RemoveDialog`)

**Interfaces:**
- Produces:
  - `RemoveDialog({ hostname, steps, attached, deletableFiles, onOpenChange })`. Its props are read once, when it opens, and kept for as long as it is open.
  - `runRemoveChain(hostname, { attached, deleteFiles }, ui): Promise<void>` in `removeChain.ts`, ported step for step from `public/app.js` lines 100–336:
    - `retireDeclaration`, `deleteSiteFiles`, `filesFailureMessage`, `offerDeclarationRetry`, `isRemovalSettled`, `hostStateMessage`;
    - the confirm handler's order and strings.

    Its `ui` parameter supplies:
    ```ts
    { markSteps(steps), resetSteps(), setOutcome(text, isError), setBusy(busy, keepSubmitDisabled), close(), toast: showToast, go(href) }
    ```
    `go` defaults to `window.location.assign`.

- [ ] **Step 1: Write the failing tests** in `removeChain.test.tsx`, with a stubbed `fetch` and `go`:
  - a failed `/delete` that was rolled back → the outcome is the error plus `hostStateMessage`, Confirm re-enabled;
  - a failed `/delete` after Caddy reloaded → `removalSettled`, Confirm stays disabled, Cancel enabled;
  - an attached success → `/delete` then `/detach` then `go("/?removed=app.lychee.land")`, with the `declaration` step marked ok;
  - a failed `/detach` → the dialog closes, the toast reads `Site removed, but its container is still declared running: <reason>` with Retry, and Retry → `/detach` then `/delete-files` (when checked) then `go`;
  - a failed delete-files → `filesFailureMessage`'s text in the outcome;
  - Escape (`cancel` event) and a backdrop click are ignored while busy, and close it when idle;
  - Tab from the last focusable wraps to the first;
  - the checkbox shows only when `deletableFiles`, and its path text matches;
  - `onOpenChange(true)` on open and `onOpenChange(false)` on close.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `showModal()` on open. The trap and backdrop rules are ported from `app.js`'s `dialog.modal` block.
- [ ] **Step 4: Run** the full check. Expected: PASS, and parity still green with the dialog closed.
- [ ] **Step 5: Commit** `feat: the remove dialog and its chain in React`

### Task 7: `/sites/:hostname` as a live client route

**Files:**
- Create: `src/client/pages/SiteDetailPage.tsx`, `src/client/pages/SiteDetailPage.test.tsx`, `src/client/pages/SiteDetailRoutes.test.tsx`
- Modify:
  - `src/client/clientNav.tsx`: `SITE_ROUTE = "/sites/:hostname"`. `siteOf(href): string | null` returns the decoded, lowercased hostname for `/sites/<one segment>` other than `new`. `isClientRoute` adds it.
  - `src/client/components/Rail.tsx`: `current` is `{ site }` when `siteOf(nav.pathname)`.
  - `src/client/router.tsx`: the route, preceded by an explicit `{ path: "/sites/new", Component: Nothing }` so the param route can never capture it; `stripNoticeParams(win)` replaces `stripRemovedParam`, dropping both `removed` and `created`; the `#page-notice` removal runs on the first in-app move away from the page it was rendered on, any page.
  - `src/client/api.ts`: `fetchSiteDetail(hostname, refresh): Promise<{ found: true; payload: SiteDetailPayload } | { found: false }>` (a `404` is `found: false`, never a throw).
  - `SiteList.tsx` row links and `BoardRows.tsx`'s site links → `RailLink`.
  - `src/views/clientShell.ts`: `ClientPage` adds `"site"`.
  - `src/routes/sites.ts`: `GET /sites/:hostname` answers `renderClientPage(<hostname>, "site", loadShell(deps, { site }), created ? { message: addedNotice(site) } : undefined)`. An unknown site gets status `404` with the title `Site not found` and current null. An unreadable Caddyfile gets `200`, current null, no banner.
  - `src/routes/sites.test.ts`: the GET's HTML assertions move to shell assertions.
  - `public/app.js`: delete the `created` strip (lines 88–90).

**Interfaces:**
- Produces: `siteDetailQuery(hostname)`, which is `queryOptions` with the Global Constraints values. Its `refetchInterval` is a function of the data and of two flags the page passes in: `useSiteWriteInFlight` and the dialog's open state.
- The loader runs `client.fetchQuery({ queryKey: siteDetailQueryKey(h), queryFn: () => fetchSiteDetail(h, true) })`, catching to undefined.

- [ ] **Step 1: Write the failing tests.**
  - **`SiteDetailPage.test.tsx`:**
    - the intervals are 15,000, then 3,000 with `requestedTag` set, and `false` while the dialog is open or a write is in flight;
    - a failed refetch keeps the page and shows `Couldn't refresh app.lychee.land: <reason>`, which clears on success;
    - a failed first load shows the alert alone;
    - a refetch answering 404 shows `SiteNotFound`;
    - a `caddyfileError` payload shows `CaddyfileError`;
    - the title is the hostname (`Site not found` for not-found);
    - **Review Focus 3:** open the dialog, advance timers past 15s, and assert no fetch.
  - **`SiteDetailRoutes.test.tsx`**, on the `router.test.tsx` harness:
    - list → site, site → site and site → `/services` load no document (`window.location.assign` never called);
    - the site's rail row has `aria-current="page"`, and focus is on the hostname heading unless it was in `#find`;
    - `/sites/new` stays a document load;
    - the loader's fetch carries `?refresh=1` and polls do not;
    - **Review Focus 1:** `/sites/App.Lychee.Land` and `/sites/app%2Elychee.land` both mark the `app.lychee.land` row and fetch `/api/sites/app.lychee.land`;
    - **Review Focus 5:** `?created=1&x=1#hop` → URL `?x=1#hop`, the notice present, and the notice gone after the first move away and not back on return.
  - **`sites.test.ts`:**
    - a known site → 200, `data-page="site"`, its rail row current;
    - unknown → 404 with no row current;
    - an unreadable Caddyfile → 200;
    - `?created=1` → `#page-notice` with `addedNotice`'s text;
    - no bundle → the 500 text.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Focus and title follow `SitesPage.tsx`'s pattern exactly (once on in-app arrival, again on a same-page move). Lowercase the param before keying the query.
- [ ] **Step 4: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 5: Commit** `feat: the site page is a live client route`

### Task 8: Retire the server site page, and docs

**Files:**
- Create: `src/dev/fixtures/detail/*.html`, one per parity case in Tasks 3–4, generated from the live renderers and checked byte-equal before deletion. The existing `@source not "../../src/dev/fixtures"` already covers them; `public/style.css` must stay byte-identical.
- Modify:
  - the parity files, to read the fixtures, each ending with the fixture-read check `SiteListParity` has;
  - `src/views/html.ts`, to delete `renderSiteDetail`, `renderSiteNotFound`, `renderRequestedLine`, `renderPruneControl`, `withRequestedTemplate` and every helper only they used, keeping `renderAddSite`, `renderErrorPage` and what they import;
  - `src/views/html.test.ts`, moving each detail test to the layer that now owns its behaviour (a model test, a React test, or the fixtures) with none dropped silently, and listing the moves in the report;
  - `public/app.js`, deleting:
    - `[data-deploy]`, `[data-prune]`, `form[data-attach]` and `form[data-change-repository]`;
    - the remove dialog's state, chain and helpers;
    - `[data-open-dialog]`, `[data-close-dialog]` and the `dialog.modal` block.

    `markSteps`, `resetSteps`, the toast, copy and add-site code stay. Fix the comments that name the deleted code.
  - `src/client/mutations.ts` and other comments that say the site page is server-rendered;
  - `CLAUDE.md`:
    - the page on React and `/api/sites/:hostname`;
    - the per-site read;
    - `?refresh=1`;
    - the remove chain's new home (`removeChain.ts`);
    - the `created` handling;
    - the fixtures;
    - what is left in `app.js` and `html.ts`.

    Correct every sentence that says the site page, its writes or its `data-requested-template` are server-side.

- [ ] **Step 1: Generate the fixtures and switch the parity tests.** Expected: PASS against the files, before anything is deleted.
- [ ] **Step 2: Delete and move.** `grep -rn "renderSiteDetail\|renderSiteNotFound\|data-requested-template\|confirm-remove-submit" src public` matches only the React components and their tests.
- [ ] **Step 3: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 4: Update the docs.**
- [ ] **Step 5: Commit** `refactor: retire the server-rendered site page; docs`

After Task 8, the controller runs the browser check against `npm run dev:mock`:
- `app`, `preview`, `broken`, `gone` and `lychee.land` compared pixel for pixel against a `main` worktree at 1280 and 390px;
- end-to-end runs of:
  - Attach on `legacy`;
  - Change repository on `preview`;
  - Deploy on `app`, until the requested line turns into the installed state when the fake inventory applies it, or for as long as the fakes allow, saying which;
  - Prune on `gone`;
  - a remove of an attached site with files, ending on `/?removed=`.
