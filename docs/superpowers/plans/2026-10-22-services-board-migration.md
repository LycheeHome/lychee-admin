# Services Board Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/services` and `/reconciler` to React with output parity. Then join all three board pages under React Router, make the board refresh itself, and retire the server-rendered board.

**Architecture:**
- **Server:** it gains a 5-second shared `loadBoardPage` cache, a fuller `/api/services` payload, and client-shell responses for the two remaining board URLs.
- **Client:** it becomes one React root on a shell-provided mount node. That root owns React Router and the `QueryClient`, and it renders the rail and the page through portals.
- **Board writes:** the controls (Deploy, Prune, host actions) are React components calling the existing endpoints. Host-action polling uses a typed port of `public/actionPoll.js`.

**Tech Stack:** Express, TypeScript, React 19, TanStack Query 5, `react-router` (current major, data mode), Vite, `node:test` via `tsx`, `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-22-services-board-migration-design.md`

## Global Constraints

- **Edit/Write only:** files under `src/views`, `src/client` and `public` are edited with the Edit and Write tools only, never through a shell command.
- **Output parity:** same elements, ids, classes and text as `renderServicesPage` for the board area, compared with the foundation's `canonical()` normaliser. No visual or copy change to the board.
- **Polling:**
  - board `refetchInterval` is `3_000` while any row is in progress and `15_000` otherwise;
  - `refetchIntervalInBackground: false`;
  - `refetchOnWindowFocus: true`.
- **Shared cache:** `loadBoardPage` caches for `5_000` ms, shared by `/api/health` and `/api/services`, with concurrent callers sharing one in-flight read. Every write route clears it before answering.
- **Writes:**
  - same endpoints, same server-side guards;
  - Deploy never sends a tag; the server reads it from the inventory;
  - write copy comes from `public/app.js` verbatim (toast messages, prune refusal format).
- **Failed refetch:** keeps the last good board and shows `role="alert"` with "Couldn't refresh the services board: <reason>"; it clears on success. A failed first load shows the alert alone.
- **Missing client bundle:** `/services`, `/reconciler` and `/infrastructure` answer `500` "client bundle missing; run npm run build".
- **`react-router`:** goes in `devDependencies`, like React, and is pinned to an exact version at least two weeks old.
- **Client tests:** every `findBy*` and `waitFor` takes `{ timeout: 5000 }`.
- **Before every commit:** run `npm run typecheck && npm run lint && npm test && npm run build`, plus the detector on `src/views src/client`.
- **Do not change** safety properties, middleware order, the URLs, or any mutating route's behaviour on the host.

**Spec correction (binding):** spec §7 lists `[data-deploy]` and `[data-prune]` among the `app.js` handlers to delete. They must stay. The site detail page, which is still server-rendered, uses both (`renderOfferLine`, `renderPruneControl` and the `data-requested-template` swap). Retire only what is board-only:
- `renderServicesPage`;
- `renderServiceRow`;
- `renderHostActions`, plus any helper that only these use;
- the `[data-host-actions]` block in `app.js`, with its `ageSince`, `ACTION_RUNNING_WORD` and `ACTION_POLL_MS`;
- `public/actionPoll.js` and its `<script>` tag.

## Review Focus

1. **A Deploy clicked twice, or clicked while a refetch replaces the row.** One POST goes out, and the button stays disabled until the re-fetched row shows the requested line or the request fails. Pinned in Task 3.
2. **Navigating away mid host action.** Moving to another board page while an action's poll runs stops that poll: no timer keeps firing after its component unmounts, and the destination page shows the run's state from the board data. Pinned in Task 4.
3. **The router on a server page.** On `/sites/x`, clicking the rail's `services` link does a full page load. A client navigation there would leave the server's page body on screen. Pinned in Task 5.
4. **Cache coherence after a write.** A Deploy immediately followed by a board refetch reads fresh data, not the cached pre-write board. Pinned in Task 1.
5. **A board-only unit name with URL-special characters** (for example `palworld-palchuds`, or names containing `.`). Mutation URLs encode the name with `encodeURIComponent`, as `app.js` does. Pinned in Tasks 3 and 4.

---

### Task 1: Server: shared board cache and the full payload

**Files:**
- Modify: `src/routes/services.ts`. Add the cache in `loadBoardPage`. `/api/services` returns the full payload. Each write route (`POST /services/:name/deploy`, `POST /resources/:name/prune`, `POST /services/:name/actions/:action`) calls `clearBoardCache()` before responding.
- Modify: `src/shared/board.ts`. Add the payload fields and re-export `ActionState` as a type.
- Test: `src/routes/services.test.ts`

**Interfaces:**
- Produces:
  - `clearBoardCache(): void`, exported from `services.ts`.
  - `BoardPayload = { board: ServiceBoard; boardEmpty: boolean; now: string; prunable: string[]; managed: string[]; requested: Record<string, string>; lastRuns: Record<string, ActionState> }`, exported from `src/shared/board.ts`.
  - `loadBoardPage(deps, opts?: { now?: () => number })`, which returns the cached `BoardPageData` when it is less than 5,000 ms old.

- [ ] **Step 1: Write failing tests:**
  - "one host read serves both endpoints within 5s": count `readUnitStates` calls through the fake. `GET /api/health` then `GET /api/services?group=service` within the window makes 1 call.
  - "a read after 5s refreshes": with an injected clock, 2 calls.
  - "a write clears the cache" (Review Focus 4): read, `POST /services/swee/deploy`, read again gives 2 calls, and the second payload shows the new requested tag.
  - "the payload carries prunable, managed, requested and lastRuns": seed values. `gone-lychee-land` is in `prunable`, `requested` matches `pendingTag`, and `lastRuns` has `palworld-palchuds`.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test src/routes/services.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The cache is a module-level `{ at: number; promise: Promise<BoardPageData> } | null`, keyed by `deps`, using a `WeakMap<Deps, …>` so tests stay isolated.
  - Sets serialise as arrays and Maps as records.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: one shared board read every 5s, and /api/services carries what the rows' controls need`

---

### Task 2: React board rows for the service and reconciler groups (render-only, parity)

**Files:**
- Modify: `src/client/components/BoardRows.tsx`. `ServiceRow` gains the offer line, requested line, prune line, host-action strip (at rest, mid-confirm and mid-run, as server markup), run fact and log disclosure, unknown line, and site links via `managed`. Add a `Board({ payload, group })` component that renders the group eyebrow, the freshness line, the rows and the empty and unavailable explanations, for any group. `InfrastructureBoard` becomes `Board` with `group="infrastructure"`.
- Create: `src/client/board.ts`. Add the pure function `boardInProgress(p: BoardPayload): boolean`: true when any row satisfies `isApplying`, or has a `requested` tag that its `version` doesn't show, or has a `lastRuns` entry whose state is active (match `renderHostActions`' notion of running).
- Test: `src/client/pages/BoardParity.test.tsx` and `src/client/board.test.ts`

**Interfaces:**
- Consumes: `BoardPayload` (Task 1); `summarizeRow`, `rowLabels` and `isApplying` (`src/views/boardFacts.ts`); `TONE_PILL` and other constants from `src/views/shared.ts`.
- Produces:
  - `Board({ payload: BoardPayload; group: ServiceGroup; controls?: BoardControls })`. `controls` is the hook point Tasks 3 and 4 fill. With it absent, the buttons render as inert markup identical to the server's.
  - `boardInProgress(p: BoardPayload): boolean`.

- [ ] **Step 1: Write the failing parity tests.** For each fixture, React `Board` equals the board area of `renderServicesPage` for the same group, after `canonical()`. Fixtures:
  - a row offering a newer tag;
  - a requested-but-not-applied tag;
  - a blocked deploy;
  - a failed deploy;
  - a prunable site row;
  - a host-action strip at rest;
  - a failed last run with its log;
  - an unknown unit state;
  - an unavailable inventory;
  - an empty group.

  Add one negative case where a mismatch is caught. Run them for both `service` and `reconciler`.
- [ ] **Step 2: Write `boardInProgress` tests:** false on a settled board; true with an applying row; true with an active run.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement.** Extract any server-only class string or row logic the React side needs into the node-free modules (`boardFacts.ts` and `shared.ts`) instead of copying it, as the foundation did. The existing infrastructure parity test must still pass.
- [ ] **Step 5: Run** the full check. Expected: PASS.
- [ ] **Step 6: Commit** `feat: the React board renders every row control the server board does`

---

### Task 3: Deploy and Prune as React mutations, plus the toast helper

**Files:**
- Create: `src/client/toast.ts`, exporting `showToast(message: string, kind: "info" | "success" | "error", action?: { label: string; run: () => void }): void` and `hideToast(): void`. They reproduce `showBanner`/`hideBanner` in `public/app.js` exactly: same element (`#flash-banner`), same class toggles, same `textContent` writes, same timing.
- Create: `src/client/mutations.ts`, exporting `useDeploy()` and `usePrune()` (TanStack `useMutation`). Each posts to its endpoint with `encodeURIComponent(name)` and invalidates the board and health queries on success.
- Modify: `BoardRows.tsx`. Wire `controls` for the offer line and the prune line.
- Test: `src/client/mutations.test.tsx` and `src/client/toast.test.ts`

**Interfaces:**
- Consumes: `Board` and its `controls` hook (Task 2); `HEALTH_QUERY` (`src/client/health.ts`).
- Produces: `BoardControls` gains `deploy` and `prune`. `showToast` and `hideToast` are used by Task 4.

- [ ] **Step 1: Write the failing tests.** Stub `fetch`.
  - **Deploy:**
    - the button disables at click and exactly one POST goes to `/services/app-lychee-land/deploy` with no body (Review Focus 1);
    - the toast reads `Requesting 0.3.0 for app-lychee-land…`;
    - on `{ok:true}` the board query refetches, and the re-fetched row renders the requested line in place of the offer;
    - on a refusal the toast shows `body.reason`, the offer is unchanged and the button re-enables;
    - on a network failure it shows `Could not reach the server to request 0.3.0 for app-lychee-land.`
  - **Prune:**
    - success refetches and the prune line disappears;
    - a `409` shows `gone-lychee-land.yml was not pruned: <reason>`.
  - **Toast:** the banner's markup and classes after `showToast(...)` equal what `app.js`'s `showBanner` produces for the same arguments. Load `public/app.js` into happy-dom as `appCopy.test.tsx` does, and compare.
  - **Encoding:** a name containing `.` reaches the URL encoded (Review Focus 5).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Deploy and Prune on the React board`

---

### Task 4: Host actions, with the typed poll

**Files:**
- Create: `src/client/actionPoll.ts`, exporting `decidePoll(outcome, memo, now, clickedAt): { next: "continue" | "update" | "reload"; memo }`. It is a typed port of `public/actionPoll.js` with the same constants (`POLL_GIVE_UP_MS = 60000`, `STALE_SLACK_MS = 30000`, `STALE_POLLS = 5`).
- Create: `src/client/actionPoll.test.ts`. Port every case in `src/views/actionPoll.test.ts` to the new module. Do not delete the old test until Task 6.
- Create: `src/client/components/HostActions.tsx`. The strip, the inline confirmations, the busy state, the run fact and the log disclosure, matching `renderHostActions` markup. Behaviour and copy come from the `[data-host-actions]` block in `public/app.js`:
  - Start posts at once.
  - Stop, Restart and Update open their confirmation, with focus on its Cancel. Esc or Cancel closes it and refocuses the opener.
  - After a `202`, the strip polls `GET /services/:name/actions/:action/state` every `2000` ms (`ACTION_POLL_MS`), with `decidePoll`.
  - `"reload"` becomes a board re-fetch.
- Modify: `BoardRows.tsx`. Wire `controls.hostActions`.
- Test: `src/client/components/HostActions.test.tsx`

**Interfaces:**
- Consumes: `showToast` (Task 3); `Board` and `controls` (Task 2).
- Produces: `HostActions({ row, run, now, onSettled })`.

- [ ] **Step 1: Port the `decidePoll` tests** to the new module. Run them. Expected: FAIL, because the module is missing.
- [ ] **Step 2: Write the failing strip tests:**
  - Start posts once.
  - Stop opens the confirmation, focus lands on Cancel, Esc closes it and focus returns to Stop.
  - Confirming posts `/services/palworld-palchuds/actions/stop`.
  - While polling, the pill reads the running word (`stopping`) and every button is disabled.
  - A settled state triggers the board re-fetch.
  - 60 s of failed polls ends the poll with the same toast `app.js` shows.
  - **Unmount mid-poll** (Review Focus 2): no further fetch fires after unmount. Use fake timers.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** The parity fixtures from Task 2 for the strip states must still pass.
- [ ] **Step 5: Run** the full check. Expected: PASS.
- [ ] **Step 6: Commit** `feat: host actions on the React board, with the poll that always ends`

---

### Task 5: One root, React Router, live board, and the switch

**Files:**
- Modify: `package.json`. Add `react-router` at an exact pinned version.
- Modify: `src/views/shell.ts` and `src/views/clientShell.ts`.
  - `layout()` always emits an empty `<div id="react-root"></div>` before the bundle tags.
  - `renderClientPage` is used for `/services` and `/reconciler` too. Its page names are `services`, `reconciler` and `infrastructure`, with the server titles `Services`, `Reconciler` and `Infrastructure`. Check the existing titles and use them verbatim.
- Modify: `src/routes/services.ts`. `/services` and `/reconciler` serve the client shell (or `500` without assets), and the HTML route loop no longer serves them.
- Create: `src/client/router.tsx`:
  - `BOARD_ROUTES: Record<"/services" | "/reconciler" | "/infrastructure", ServiceGroup>`;
  - `isClientRoute(path: string): boolean`;
  - `createAppRouter(client)`, which builds one layout route (rail portal, plus an `<Outlet/>` portalled into `#app-root` when it exists), the three board routes, and a `*` route that renders nothing.
- Create: `src/client/pages/BoardPage.tsx`:
  - It reads its group from the route and uses the board query.
  - `refetchInterval: (q) => q.state.data && boardInProgress(q.state.data) ? 3_000 : 15_000`.
  - The failed-refetch rule from Global Constraints applies.
  - On mount it sets `document.title` and focuses the page heading (the group eyebrow, given `tabIndex={-1}`).
  - It replaces `InfrastructurePage`.
- Modify: `src/client/main.tsx`. Mount one root on `#react-root` that renders `RouterProvider`. The rail island becomes a component rendered by the layout route through `createPortal` into `#rail`. Delete `mountRailIsland`'s separate `createRoot`.
- Modify: `src/client/components/Rail.tsx` and `src/client/components/FindPanel.tsx`.
  - Rail links go through a `RailLink` component. It renders a router `<Link>` only when both the current location and the target satisfy `isClientRoute`, and a plain `<a href>` otherwise (Review Focus 3).
  - Find navigation uses the router's `navigate` under the same condition, and `location.assign` otherwise.
  - The rail's `aria-current` follows the router's location on client routes.
- Test: `src/client/router.test.tsx`, plus updated `RailIsland`/`Rail` tests, `services.test.ts` route tests and the parity tests.

**Interfaces:**
- Consumes: everything above.
- Produces: `createAppRouter`, `isClientRoute` and `BoardPage`.

- [ ] **Step 1: Write the failing tests.**
  - **Router:**
    - from `/services`, clicking the rail's `reconciler` link changes the content without a document load, and `#find` keeps its focus and typed text;
    - the title and `aria-current` update, and the heading receives focus;
    - `history.back()` returns to `/services`;
    - on a `/sites/broken.lychee.land` document, the rail's `services` link is a plain anchor (Review Focus 3).
  - **Live:**
    - with a settled board the interval is 15,000;
    - with an applying row it is 3,000;
    - when the next payload settles, it goes back to 15,000.
  - **Failed refetch:** after a good load, a failing refetch keeps the rows and shows the alert, and the next success clears it.
  - **Routes:**
    - `GET /services` and `GET /reconciler` serve `#app-root` with their page names and the right rail `aria-current`;
    - with no assets, all three answer 500 with the message;
    - without credentials, 401.
  - **Rail parity:** the server rail and the client rail still match, unchanged.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Install the dependency and implement.** Pin `react-router` with `npm install -D react-router@<exact>`, choosing a version published at least two weeks ago.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Manual check.** Run `npm run build` and `PORT=8794 npx tsx src/dev/server.ts` (dev/dev). On `/services`:
  - click `reconciler`, then `infrastructure`, then back;
  - confirm there is no reload and the board data is shown;
  - Deploy the offered tag on `app-lychee-land` and watch the requested line appear and the poll switch to 3 s.

  Stop only the server you started.
- [ ] **Step 6: Commit** `feat: one React root with React Router; the whole services board is live`

---

### Task 6: Retire the server board, and docs

**Files:**
- Modify: `src/views/html.ts`. Delete `renderServicesPage`, `renderServiceRow`, `renderHostActions` and any helper that only these used. Keep `renderOfferLine`, `renderRequestedLine`, `renderPruneControl` and everything the site detail page uses.
- Modify: `src/routes/services.ts`. Delete `BOARD_PAGES`, the HTML route loop and `renderBoardPage`.
- Modify: `public/app.js`. Delete the `[data-host-actions]` block, `ageSince`, `ACTION_RUNNING_WORD` and `ACTION_POLL_MS`. Keep `[data-deploy]` and `[data-prune]`, which the site detail page uses.
- Delete: `public/actionPoll.js` and `src/views/actionPoll.test.ts`. Remove the `<script src="/actionPoll.js">` tag from `layout()`.
- Modify: the parity tests from Task 2. With the server renderer gone, convert them to assertions against committed expected markup.
  1. Before deleting anything, generate each fixture's server markup.
  2. Save it under `src/client/test/fixtures/board/*.html`.
  3. Then compare React's output against those files.
- Modify: `CLAUDE.md`. Cover:
  - the board on React;
  - React Router and the single root;
  - live polling (15 s and 3 s) and the 5 s shared read;
  - the retired `actionPoll.js` and the host-action block;
  - the failed-refetch behaviour.

  Edit minimally. Change `PRODUCT.md` only where it names the board's rendering.
- Test: grep checks, and the full suite.

- [ ] **Step 1: Generate the fixture files** from the still-present renderer, and switch the parity tests to read them. Run them. Expected: PASS against the files.
- [ ] **Step 2: Delete the retired code.** Then:
  - `grep -rn "renderServicesPage\|actionPoll\|data-host-actions\|BOARD_PAGES" src public` returns only the client modules and their tests;
  - `grep -n "data-deploy\|data-prune" public/app.js` still finds both handlers.
- [ ] **Step 3: Run** the full check. Expected: PASS. A site detail page's Deploy and Prune still work, shown by the existing site route tests.
- [ ] **Step 4: Update the docs.**
- [ ] **Step 5: Commit** `refactor: retire the server-rendered services board and actionPoll.js; docs`

After Task 6, the controller runs the spec's browser check against `npm run dev:mock`:
- each board page compared pixel-for-pixel with `main` at 1280 and 390px;
- one Deploy end to end;
- one host action end to end.
