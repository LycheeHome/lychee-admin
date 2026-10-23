# Services board migration: sub-project 3 of the SPA migration

Date: 2026-10-22

## Decision record

The operator chose:

- the board moves to React **with output parity, plus live updates**; the visual redesign comes later, as its own pass against stable React code;
- the board refreshes **every 15 seconds, and every 3 seconds while something is in progress**;
- **React Router** is the client router, because it will also carry site detail and add site when they migrate.

The architecture, the write paths and the testing were each approved section by section in conversation.

## Why

`/services` and `/reconciler` are the last two pages of the services board still rendered on the server. `/infrastructure` moved to React in the foundation (#106). Today about 350 lines of `public/app.js`, plus `public/actionPoll.js`, patch the board's markup by hand:

- the Deploy offer, and the requested line that replaces it;
- Prune;
- the host-action strip, its confirmation, its run poll and its log.

That hand-managed state is where this app's client bugs came from. Moving the board also brings the operator's live-update wishes within reach: a deploy that visibly lands, and an action that finishes without a reload.

## Goal

- `/services`, `/reconciler` and `/infrastructure` are all rendered by React, at the same URLs, with output identical to today's server board.
- The board refreshes itself.
- Writes go through React with the same endpoints and the same server-side guards.
- Moving between the three board pages does not reload the page.
- The server-rendered board and its client scripts are deleted.

## Non-goals

- **Any visual or copy change to the board.** Parity holds, apart from what is named under Scope.
- **Migrating any other page.** The sites list, site detail and add site stay server-rendered, and links to them stay full page loads.
- **New board features**, such as filters or per-unit pages.
- **Any change to what a write does on the host, or to its server-side checks.**

## Decisions

### 1. One React root, with the rail as a portal

Today the rail island and the page are separate React roots. A router link only works inside the router's tree, so the client becomes **one root**. It owns the router, the `QueryClient` and the page content, and it renders the rail into the server's `<aside id="rail">` through a portal.

- The server-rendered rail, its `#rail-data` JSON and the rail parity test are unchanged.
- The one root mounts at `#app-root` when the page has one. On a server-rendered page it mounts on a node the shell provides for the client, and renders the rail portal and nothing else. One root on every page, either way.
- On a server-rendered page, the router has no matching route. Rail links render as plain `<a href>` and load the page in full.
- On a React page, rail links to the three board routes are router links: no reload, and the rail, its health state and the find panel's state persist. Links to any other URL stay plain anchors.
- `⌘K` find keeps working as it does. Choosing a board row from find navigates through the router when the target is a board route, and with `location.assign` otherwise.

### 2. React Router

- **Package:** `react-router`, current major, used in data mode (`createBrowserRouter` and `RouterProvider`). The plan pins the exact version.
- **Routes:**
  - Three routes, `/services`, `/reconciler` and `/infrastructure`, share one board layout, and each renders its group.
  - Each route's loader primes the TanStack Query cache for `/api/services?group=…`. Moving between pages shows cached data at once, then refreshes it.
  - An unknown path renders nothing. The server decides what is served, and a client route exists only where the server serves the React shell.
- **On every client navigation:**
  - the document title updates, matching the server's title for that page;
  - the rail's `aria-current` follows the route;
  - focus moves to the page heading (the group eyebrow), so screen-reader users hear the page change;
  - back and forward restore scroll position (React Router's `ScrollRestoration`).
- **The server** answers `/services` and `/reconciler` with the shell and mount point, exactly as `/infrastructure` is answered today. A deep link or a reload always works. With no client bundle, these URLs answer `500` "client bundle missing; run npm run build", as `/infrastructure` does.

### 3. The board payload

`GET /api/services?group=` grows from `{ board, boardEmpty, now }` to everything a row's controls need. The values are computed on the server, as the HTML board computes them now:

- `prunable: string[]`: the names of site rows whose declaration is `absent` and whose container is confirmed down, so the row offers Prune.
- `managed: string[]`: the hostnames that are managed sites, so a site resource's name links to `/sites/<hostname>`.
- `requested: Record<string, string>`: unit name to requested tag, from `pendingTag`. When the requested tag equals the offered one, the row shows the requested line in place of the offer.
- `lastRuns`: the last host-action run per unit, in the shape `readLastRuns` returns, for the run fact line and its log.

These are the same values `loadBoardPage` already returns, serialised. The browser never computes an offer, a prune eligibility or a pending tag itself.

### 4. One host read for two polls

`/api/health` and `/api/services` both call `loadBoardPage`. On a board page, the rail's 15-second poll and the board's 15-second poll would otherwise read the host twice.

- `loadBoardPage` gains a short in-process cache: **5 seconds**, shared by both endpoints, with concurrent callers sharing one in-flight read.
- Every write route (Deploy, Prune, a host action) clears the cache before it answers. A re-fetch after a write therefore always reads fresh.

### 5. Live updates

- The board query refetches every **15,000 ms**. While any row is **in progress**, it refetches every **3,000 ms**. A row is in progress when:
  - it has a requested tag the inventory has not yet applied, or
  - it has a host action running.
- It drops back to 15 seconds by itself once no row is in progress.
- Polling pauses while the tab is hidden, and refetches when the window regains focus, as the rail does.
- **When a refetch fails,** the last good board stays on screen. Above it, a `role="alert"` line reads "Couldn't refresh the services board: <reason>", in the add-site error treatment, and it clears on the next success. This replaces the foundation's behaviour, where a failed refetch replaced the board with the alert. A first load that fails still shows the alert alone, since there is no board to keep.

### 6. Writes

Each write keeps its endpoint and its server-side checks. React calls them as mutations.

- **Deploy**, `POST /services/:name/deploy`:
  - The server still reads the tag from the inventory, never from the request.
  - While posting, the button disables. On success, the board and health queries are invalidated.
  - The requested line comes from the re-fetched `requested` data, as a reload shows it today. The `<template data-requested-template>` swap is retired.
  - A refusal shows the server's `reason` in the toast and changes nothing.
- **Prune**, `POST /resources/:name/prune`:
  - It follows the same pattern as Deploy.
  - A `409` "the container hasn't been confirmed down yet; try after the next reconcile" shows its reason exactly as today.
- **Host actions**, `POST /services/:name/actions/:action`:
  - **Start** posts at once. **Stop**, **Restart** and **Update** open the inline confirmation in place of the strip, with focus moved to its Cancel. Esc or Cancel closes it and returns focus to the button that opened it.
  - After a confirmed post, the client polls `GET /services/:name/actions/:action/state`.
  - The poll's decisions come from `decidePoll`, ported from `public/actionPoll.js` to a typed module with its existing tests:
    - 60 seconds of consecutive failures gives up;
    - a settled state older than the click (allowing 30 seconds of slack) counts as the previous run, and five of those end the poll.
  - Where the old code reloaded the page, the new code re-fetches the board.
  - While a run is active, the pill turns neutral naming it, and every button in that row disables.
- **Toast.** A write failure, or any message that went through `showBanner` before, shows in the shell's `#flash-banner` through a small client helper. It has the same markup, tones, timing and optional action button as `showBanner(message, kind, action)` in `public/app.js`.
- **Copy buttons** keep working through `app.js`'s document-level `[data-copy-target]` delegation.

### 7. Retiring the server board

The plan's last task deletes all of the following, once the parity tests below have proven the React board matches:

- `renderServicesPage` and its private helpers that no other page uses;
- `BOARD_PAGES` and the HTML route loop;
- the board handlers in `public/app.js` (`[data-deploy]`, `[data-prune]`, the host-action strip);
- `public/actionPoll.js` and its `<script>` tag.

The React board's own tests then guard it. The shared node-free modules (`boardFacts.ts`, `shared.ts`, `railModel.ts`) stay.

## Scope

- **Server:**
  - `loadBoardPage` gains its cache, and the write routes clear it;
  - the `/api/services` payload grows;
  - the `/services` and `/reconciler` routes serve the client shell;
  - the server board and its scripts are retired (last task).
- **Client:**
  - the router and the single root;
  - the board layout and pages, and the row controls (offer, requested line, prune line, host-action strip, confirmation, run fact and log);
  - mutations, the poll module and the toast helper;
  - router-aware rail links.
- **Dependency:** `react-router`, added to `devDependencies` like React itself. It is bundled by Vite and absent from the release's runtime `node_modules`.
- **Docs:** CLAUDE.md, for the board, the client router, the retired scripts and the polling. DESIGN.md is unchanged, because there is no visual change.

## Testing

- **Parity** for `/services` and `/reconciler` against `renderServicesPage`, as `/infrastructure`'s parity test does. The fixtures cover:
  - a row offering a newer tag;
  - a requested-but-not-applied tag;
  - a blocked deploy and a failed deploy;
  - a prunable site row;
  - a host-action strip at rest, mid-confirmation and mid-run;
  - a failed last run with its log;
  - an unknown unit state;
  - an unavailable inventory;
  - an empty group.
- **Writes,** with `fetch` stubbed:
  - Deploy disables while posting, shows the requested line after the re-fetch, and on a refusal shows the reason and changes nothing.
  - Prune succeeds, and handles the `409`.
  - The host-action confirmation takes focus and gives it back on Esc or Cancel.
  - The poll ends in every case the current `actionPoll` tests cover.
  - Buttons stay disabled during a run.
- **Polling:**
  - the interval is 3,000 ms while a row is in progress and 15,000 ms otherwise;
  - one `loadBoardPage` call serves both endpoints within 5 seconds;
  - a write clears the cache.
- **Router:**
  - moving between the board pages keeps the find box's focus and text;
  - the title, `aria-current` and heading focus update on each move;
  - back and forward work;
  - links to server pages cause a full load;
  - a direct visit to each board URL works.
- **Failure:**
  - a failed refetch keeps the last board and shows the alert, which clears on success;
  - a failed write shows the toast and changes nothing;
  - a missing bundle gives `500` on all three URLs.
- **Browser check** against `npm run dev:mock`:
  - every board page is pixel-identical to `main` at 1280 and 390px;
  - one Deploy runs end to end on the mock, offer to requested line;
  - one host action runs end to end, confirm to finished.
- **Checks:** `npm run typecheck`, `lint`, `test` and `build`, and the detector on `src/views src/client`.

## Risks

- **A larger bundle.** React Router adds roughly 20 KB gzipped to a bundle every page already loads.
- **The single root takes over the rail's mounting.** The rail parity test, which compares the server rail with the client rail, must keep passing unchanged.
- **Deleting `actionPoll.js`.** It is the one piece with a hard guarantee (the poll always ends). It is ported with its tests before the original is deleted, never rewritten from memory.
