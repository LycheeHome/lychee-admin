# Site detail migration: sub-project 5 of the SPA migration

Date: 2026-10-23

## Decision record

Four decisions came out of brainstorming. The design sections were then approved one at a time in conversation.

- **Scope A, the whole page with all its writes.** The page moves together with Attach, Change repository, Deploy, Prune and the remove dialog's chain, which folds the planned "remove flow" sub-project into this one.
  - **Why not B.** Keeping the danger zone server-drawn would have forced site-to-site moves to stay full loads, the pain the navigation shell set out to fix.
  - **Why not C.** A read-only page first would have shipped buttons nothing handles, because `app.js` binds its handlers at load, before React renders.
- **Live, with the clone refreshed only on arrival.** Polls read the clone as it stands, like the board. Only arrival pulls.
- **A successful remove ends in a full load of `/?removed=<host>`.** The DNS-reminder notice keeps one owner, the server.
- **Facts over the wire, logic shared.** The endpoint returns the facts the server renderer already takes (`SiteDetailOptions`). The derived logic moves into a node-free model both renderers import until the server one is retired, the same pattern as the board.

## Why

The site page is where the operator answers "which hop broke", and where every site-level write starts. It is the last server page reached from the rail on every visit. Until it moves, every move to or between sites is a full load, and the rail's health and find state restart.

## Goal

- `/sites/:hostname` is rendered by React with output identical to today's page, refreshes itself, and is a client route alongside `/`, `/services`, `/reconciler` and `/infrastructure`.
- All of its writes are React mutations on the same endpoints.
- `renderSiteDetail`, `renderSiteNotFound` and `app.js`'s detail handlers are retired.

## Non-goals

- **Any visual or copy change to the page, the dialog or the toasts.**
- **Migrating add site (`/sites/new`).** It and its links stay full loads.
- **A client-drawn removed notice.** The server keeps drawing it.
- **Changing any write endpoint's request, response or order.**

## Decisions

### 1. Route

- `/sites/:hostname` becomes a client route, rendered by `SiteDetailPage`.
- **Express's answer.**
  - It answers with the client shell: `data-page="site"`, title the hostname, the site's rail row marked current.
  - An unknown hostname gets the same shell with HTTP `404` and no rail row current.
  - An unreadable Caddyfile gets the shell with `200`, and the page shows the error, as `/` does.
  - Without client assets the route answers `500` "client bundle missing; run npm run build".
- **Which moves are router moves.** Moves between `/`, the board pages and any site's page are router moves. `/sites/new` stays a full load.
- **On each client move to a site's page:**
  - the title becomes the hostname;
  - `aria-current` moves to that site's rail row (no row for an unknown hostname);
  - focus moves to the page's hostname heading, under the board's rule: not when focus is in a wide-screen `#find`.

### 2. `GET /api/sites/:hostname`

The endpoint returns `ApiOk<SiteDetailPayload>`:

```
{ site: Site, ...SiteDetailOptions without `created`, filesPath: string | null, caddyfileError: string | null }
```

- `filesPath` is `computeFilesPath(site, sitesRoot)`, precomputed so the client never needs `node:path`.
- The facts are exactly what today's GET passes to `renderSiteDetail`, gathered the same way (`resolveNextjsSite`, `checkPortOpen` with the out-of-range-port guard, `readUnitStates` for `caddy.service` and `cloudflared-sites.service` degrading to `{}`, `readTunnelId` degrading to `""`, the scaffold commands and files).
- **An unknown hostname** answers `404` `{ ok: false, error }`.
- **An unreadable Caddyfile** answers `200` with `caddyfileError` set to the message today's 500 page shows (`CommandError` message plus stderr, or `String(error)`). In that case `site` is absent.
- Behind basic auth (`401` without credentials) and `sameOrigin`, like every route.

**The clone refresh on arrival.**
- `?refresh=1` makes the endpoint run `refreshDeclarations` first, and only for a Next.js site, exactly as today's GET does.
- The route's loader sends it. The loader runs on a document load and on every in-app move to the page.
- Polls never send it.

### 3. The shared read

- Everything one site's page reads from the host goes through `cachedRead("site-detail:<hostname>", deps, …)`: the status or resource resolution, `detached`, and the two unit states.
- It is kept 5s per filesystem, with the in-flight sharing and rejection eviction of `cachedRead`.
- A `?refresh=1` request evicts that one entry after its pull, so arrival always reads fresh.
- `clearBoardCache()` already clears every `cachedRead` entry, so every write route clears it.
- It stays separate from the list's `site-statuses` entry, which holds statuses only.

### 4. Live behaviour

- **Rate.** The page's query refetches every **15,000 ms**, and every **3,000 ms** while either:
  - the payload's `resource.requestedTag` is set;
  - a write of the page's own is pending.
- **Visibility.** `refetchIntervalInBackground: false`, `refetchOnWindowFocus: true`.
- **No refetch:**
  - while a write of the page's own is in flight (each success triggers exactly one re-read);
  - while the remove dialog is open.
- **A failed refetch** keeps the last good page under a `role="alert"` line, "Couldn't refresh <hostname>: <reason>", in the board's treatment. It clears on the next success.
- **A failed first load** shows the alert alone.
- **A refetch answering `404`** (the site was removed elsewhere) swaps the page to the not-found body.
- **`?created=1`.**
  - The server keeps drawing `#page-notice` above `#app-root`, with today's markup.
  - On load the client removes `created` from the URL with `history.replaceState`, keeping other parameters and the hash. That is `stripRemovedParam`'s pattern, extended to `created`.
  - On the first client move away the client removes `#page-notice`.
  - `app.js`'s own `created` strip, which drops every parameter, is deleted.

### 5. Writes

Every write keeps its endpoint, request body, copy and step order. Toasts go through `src/client/toast.ts`.

- **Deploy.**
  - It uses the board's `useDeploy` on `/services/:name/deploy`.
  - On success the offer is replaced by the requested line, which takes focus, and the page re-reads.
  - The requested line is one `RequestedLine` component shared with the board, and `<template data-requested-template>` is deleted.
  - Failure shows today's error toast and re-enables the button.
- **Prune.**
  - It uses `usePrune` on `/resources/:name/prune`, with the info toast "Pruning <name>.yml from lychee-resources…".
  - On success it re-reads instead of reloading, and focus moves to the repository card's heading.
  - A refusal shows "<name>.yml was not pruned: <reason>".
- **Attach and Change repository.**
  - Same forms and the same empty-input message, "Enter the repository's name.", sent without a request.
  - Same info toasts.
  - Errors go in `#attach-error` or `#change-repo-error` (`role="alert"`), made visible before their text is written.
  - Success re-reads instead of loading the path, and focus moves to the repository card's heading.
  - The form stays disabled until the re-read lands.
- **Remove.** A React port of the dialog and its chain.
  - **The dialog.**
    - A native `<dialog>` opened with `showModal`, with the focus trap.
    - Escape and backdrop clicks are blocked while a request is in flight.
    - `removalSettled` keeps Confirm disabled after a partial success.
    - The step list is marked from the server's `steps`.
    - The outcome region keeps its progress dot, and its failure text includes `hostStateMessage`'s explanation.
  - **The chain.** `/delete`, then `/detach` for an attached site, then `/delete-files` when the box was checked. Each runs only if the one before it succeeded.
  - **A failed `/detach`** closes the dialog and shows the error toast with Retry, which resumes the chain where it stopped.
  - **A failed delete-files** shows `filesFailureMessage`'s text.
  - **Success** is a full load of `/?removed=<host>`.
  - **What it lists** (`attached`, the delete-files checkbox) is fixed by the payload it opened with.

### 6. Shared logic

The page's derived decisions move from `src/views/html.ts` into a node-free `src/views/siteDetailModel.ts`, imported by both renderers until the server one is retired:
- which hops get "What to check" entries, and their commands;
- each runbook step's done flag and whether it folds;
- `canChangeRepository`;
- offer or requested;
- the card order for attached sites;
- the remove dialog's step list.

Class constants stay in `src/views/shared.ts` or move beside the model. Neither file imports Node.

### 7. Retiring the server page

The last tasks do the following, in order:

1. Generate frozen fixtures from `renderSiteDetail` and `renderSiteNotFound` into `src/dev/fixtures/detail/*.html`, checked byte-equal to the live renderers and excluded from Tailwind's sources.
2. Switch the parity tests to them.
3. Delete both renderers, the helpers only they use, and the server's HTML path for `/sites/:hostname`.
4. Delete from `public/app.js`:
   - `[data-deploy]`, `[data-prune]`, `form[data-attach]` and `form[data-change-repository]`;
   - the remove dialog's state, chain and helpers (`retireDeclaration`, `deleteSiteFiles`, `offerDeclarationRetry`, `isRemovalSettled`, `hostStateMessage`, `setOutcome`, `setRemoveBusy`);
   - the generic `[data-open-dialog]`, `[data-close-dialog]` and `dialog.modal` code, which only the remove dialog uses;
   - the `created` strip.

   `markSteps` and `resetSteps` stay for add site.

`html.ts` then holds `renderAddSite` and `renderErrorPage`.

## Scope

- **Server:**
  - `GET /api/sites/:hostname`;
  - the per-site shared read;
  - `GET /sites/:hostname` serves the client shell;
  - the retirement (last task).
- **Client:**
  - `SiteDetailPage` and its query;
  - the `SiteDetail` components: header, request path and "What to check", repository card (runbook and installed), manual steps, danger zone, remove dialog, not-found;
  - the route and loader;
  - the `created` handling;
  - the write hooks.
- **Shared:** `siteDetailModel.ts` and the `RequestedLine` component.
- **Docs:** CLAUDE.md (the page on React, `/api/sites/:hostname`, the per-site read, the remove chain's new home). DESIGN.md is unchanged.

## Testing

- **Parity.** React matches `renderSiteDetail` under `canonical()` for:
  - **Static:** `lychee.land`, with and without its directory.
  - **Plain proxy:** `api.lychee.land`, responding and not responding.
  - **Next.js:**
    - `legacy` (unattached, legacy files);
    - `preview` (awaiting image, with Change repository);
    - `app` (installed, with an offer, and with a requested tag);
    - `broken` (failed first deploy);
    - `gone` (detached, with Prune).
  - **Hop states:** bad tunnel and bad Caddy units.
  - **Lines:** a blocked gate line.
  - **No tunnel ID:** the dashboard-only DNS step.
  - **The remove dialog:** attached and plain.

  It also matches `renderSiteNotFound`'s body. A live-render test asserts that every phrase the server writes as one text node is one text node in React. Copy buttons keep their ids.
- **API:**
  - the payload for each seed site;
  - `404` for an unknown hostname;
  - `200` with `caddyfileError`;
  - `401` without credentials;
  - `?refresh=1` pulls once, and a plain read never pulls;
  - two reads within 5s make one host read;
  - a write clears it.
- **Router:**
  - list → site, site → site and site → board make no document load;
  - the title, `aria-current` and heading focus follow;
  - deep links to a site, to an unknown site (`404`, not-found body), and to `?created=1` (stripped, other params kept);
  - the notice is removed on the first move away.
- **Live:**
  - the intervals are 15,000 and 3,000 (while a tag is requested);
  - a failed refetch keeps the page and shows the alert, which clears on success;
  - a mid-poll `404` swaps to not-found;
  - no refetch while the dialog is open or a write is in flight.
- **Writes:** for each of Deploy, Prune, Attach and Change repository, the success, refusal and network-failure paths, with the toast text and the focus target.
- **Remove chain:**
  - a failed `/delete`, rolled back and not rolled back;
  - a partial success keeping Confirm disabled;
  - a failed `/detach` closing the dialog with Retry, and Retry resuming into delete-files;
  - a failed delete-files;
  - Escape and backdrop clicks blocked while in flight;
  - the final full load.
- **Browser check** against `npm run dev:mock`:
  - pixel comparisons against `main` at 1280 and 390px for `app`, `preview`, `broken`, `gone` and `lychee.land`;
  - end-to-end runs of Attach, Change repository, Deploy (until the requested line becomes the installed state), Prune, and a remove of an attached site with files.
- **Commands:** run `npm run typecheck`, `lint`, `test` and `build`, plus the detector on `src/views src/client`.

## Risks

- **The remove chain is the app's one destructive client flow.** Every branch has a test, and the end-to-end run deletes files against the fake filesystem.
- **Size.** This is the largest migration so far. The plan should keep the remove dialog in its own task.
- **Polling during writes.** A poll landing between a write and its re-read could briefly show the pre-write page. Pausing refetches during the page's own writes is what prevents it, and it has a test.
