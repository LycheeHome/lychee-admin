# Sites list migration: sub-project 4 of the SPA migration

Date: 2026-10-22

## Decision record

Three decisions came out of brainstorming. The design sections were then approved one at a time in conversation.

- **Parity plus live updates.** The list moves to React with output parity and live updates, as the services board did (#110). The critique's P1 item, retired sites being invisible, gets its own design pass afterwards.
- **A new endpoint.** The list reads a new `/api/sites` endpoint. Its status and host-unit reads share the board's 5-second in-process read with `/api/health`.
- **A dedicated error page.** The server's two 500 fallbacks that borrow the list (`/sites/new` and `/sites/:hostname` when the Caddyfile cannot be read) get a dedicated error page, and `renderSiteList` is deleted.

## Why

`GET /` is the five-second glance: is every site up, and is the host healthy beneath them. It is the last read-only page still rendered on the server.

Moving it gives it the live refresh the board already has. It also joins it to the router, so `/` and the board pages move without reloads, and it removes one more server renderer.

## Goal

- `/` is rendered by React with output identical to today's list, refreshes itself every 15 seconds, and is a client route alongside `/services`, `/reconciler` and `/infrastructure`.
- `renderSiteList` is retired, replaced for errors by `renderErrorPage`.

## Non-goals

- **Any visual or copy change to the list.** The one exception is the two error pages under §5.
- **Showing retired sites.** That has its own design pass.
- **Migrating site detail, add site or the remove flow.** These stay server-rendered, and links to them stay full loads.
- **A fast-poll mode.** The list has no write of its own in flight.

## Decisions

### 1. Route

- `/` joins `BOARD_ROUTES`'s neighbours as a client route (`isClientRoute("/")` is true), rendered by a `SitesPage`.
- Express answers `GET /` with the client shell and mount point (`data-page="sites"`, title `Sites`), exactly as the board URLs are answered.
- Without client assets, `/` answers `500` "client bundle missing; run npm run build".
- Rail links and find navigation between `/` and the board pages are router navigations. Links from the list to `/sites/<hostname>` and `/sites/new` stay plain anchors, because those pages are server pages.
- On each client navigation to `/`:
  - the title becomes `Sites`;
  - the rail's `sites` heading carries `aria-current="page"`;
  - focus moves to the page heading, under the same rule the board uses: not when focus is in a wide-screen `#find`.

### 2. `GET /api/sites`

The endpoint returns `ApiOk<SitesPayload>`:

```
{ sites: SiteSummary[], statuses: Record<hostname, SiteStatus>,
  problems: HostProblem[], domain: string, caddyfileError: string | null }
```

`SiteSummary` is `{ hostname, type, target, framework? }`. It carries the managed sites in Caddyfile order, filtered exactly as `GET /` filters them today.

- `statuses` comes from `computeStatuses`, the same function `GET /` and `/api/health` use.
- `problems` comes from `hostProblems(readUnitStates(hostProblemUnits(inventory)), inventory)`, and carries its wording from the server.
- An unreadable Caddyfile answers `200`, with `caddyfileError` set to the same message the server list shows today (`CommandError` message plus stderr, or `String(error)`). In that case `sites`, `statuses` and `problems` are empty.
- The endpoint is behind basic auth like every route, and answers `401` without credentials.

### 3. One host read for three readers

`computeStatuses(sites, deps)` and the host-unit read gain the same in-process cache `loadBoardPage` has:

- 5 seconds;
- keyed per filesystem (`deps.fs`), so `/api/health`'s per-request deps wrapper still shares it;
- concurrent callers share one in-flight read;
- a rejected read is evicted.

`clearBoardCache()` clears it too, so every write route that already clears the board cache also clears this one. That covers the board's writes, the site page's writes, and an action's `/state` once a run settles.

On the list page, the rail's health poll and the list's poll therefore cost one host read per 15 seconds.

### 4. Live behaviour

- The list query refetches every **15,000 ms**, with `refetchIntervalInBackground: false` and `refetchOnWindowFocus: true`.
- Rows are keyed by hostname. A refresh updates pills and the host-trouble block in place, never rebuilds the list, and never moves focus.
- **When a refetch fails,** the last good list stays on screen. Above it, a `role="alert"` line reads "Couldn't refresh the sites list: <reason>", in the board's treatment, and it clears on the next success. A failed first load shows the alert alone.
- **The removed notice.**
  - The server keeps rendering `#page-notice` for `GET /?removed=<host>`, with today's markup and position, outside the React content area. Its close button keeps working through `app.js`.
  - On load, the client removes `removed` from the URL with `history.replaceState`, so a reload does not repeat the notice.
  - On the first client navigation away from `/`, the client removes `#page-notice`.

### 5. Error pages

- `renderErrorPage(title: string, message: string, shell: ShellData): string` in `src/views/html.ts` renders the shell plus the list's existing red error box (same classes) containing the exact message, and a plain `← sites` link to `/`.
- `/sites/new` and `/sites/:hostname` use it for their Caddyfile-unreadable `500`s. The current rail item is `null`, as now.
- They no longer show an empty `Sites` heading and empty state.

### 6. Retiring `renderSiteList`

The last task does the following, in order:

1. Generates frozen fixtures from `renderSiteList` into `src/dev/fixtures/sites/*.html`.
2. Switches the parity tests to them.
3. Deletes `renderSiteList` and the helpers only it uses, plus the `GET /` HTML path.

These helpers are shared with other pages and must stay: `splitHostnameForDisplay`, `describeStatus`, `statePhrase` and the row and pill class constants.

## Scope

- **Server:**
  - `GET /api/sites` (new);
  - the status and unit cache;
  - `GET /` serves the client shell;
  - `renderErrorPage`, and its use in the two fallbacks;
  - the retirement of `renderSiteList` (last task).
- **Client:**
  - `SitesPage` with the list query;
  - the `SiteList` component (rows, pills, host-trouble block, empty state, Add site, Caddyfile error);
  - the `/` route;
  - the `?removed` and `#page-notice` handling.
- **Shared:** class strings and row logic both renderers need move into node-free modules, as on the board.
- **Docs:** CLAUDE.md (the list on React, `/api/sites`, the error pages, the shared read). DESIGN.md is unchanged.

## Testing

- **Parity:** React's `SiteList` matches `renderSiteList` for:
  - a static row;
  - reverse-proxy rows, responding and not responding;
  - Next.js rows: running, awaiting image, failed and not deployed;
  - an unknown status;
  - a row with no status;
  - the host-trouble block, with one line and with several;
  - the empty state;
  - the Caddyfile error.

  Then frozen into fixtures before deletion. A live-render test asserts that every multi-part phrase the server writes as one text node is one text node in React. That is the subpixel bug found on the board.
- **API:**
  - the payload matches the seed, and unmanaged `lychee.local` is excluded;
  - an unreadable Caddyfile gives `200` with `caddyfileError`;
  - `401` without credentials;
  - `/api/health` and `/api/sites` within 5 seconds make one `computeStatuses` read;
  - a write clears it.
- **Router:**
  - `/` ↔ `/services` makes no document load;
  - the title, `aria-current` and heading focus follow;
  - a deep link to `/` and to `/?removed=x` works;
  - `removed` is stripped from the URL, and `#page-notice` is removed on the first client navigation away.
- **Live:**
  - the interval is 15,000;
  - a failed refetch keeps the rows and shows the alert, which clears on success;
  - a refresh doesn't move focus.
- **Error pages:** with an unreadable Caddyfile, `/sites/new` and `/sites/:hostname` answer `500` with the message, a link to `/`, and no rail item current.
- **Browser check** against `npm run dev:mock`:
  - `/` with sites and empty, compared pixel for pixel against `main` at 1280 and 390px;
  - a real remove on a site page ends on `/` with the notice shown, and a reload drops it.
- **Commands:** run `npm run typecheck`, `lint`, `test` and `build`, plus the detector on `src/views src/client`.

## Risks

- **The notice straddles two renderers.** The server renders it and the client removes it. The tests for both halves are what keep that honest.
- **The cache now covers site status as well.** A status change appears up to 5 seconds later than today on the list. That is acceptable for a 15-second glance, and every write still reads fresh.
