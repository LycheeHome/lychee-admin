# Static shell: sub-project 7, the end of the SPA migration

Date: 2026-10-24

## Decision record

Two decisions came out of brainstorming. The design sections were then approved one at a time in conversation.

- **End state A: one static `index.html`, built by Vite.**
  - Express serves this one file for every client route and still decides the status code.
  - React draws everything:
    - the rail and the top bar;
    - the toast host and `#copy-status`;
    - the page notices;
    - the title;
    - every page.
  - `layout()`, `rail.ts`, `loadShell()`, `renderClientPage` and the rail's parity test against its server twin are retired.
  - We considered keeping a minimal server template with inline rail data, which would have meant no fetch before the first rail paint. We rejected it because the server would still template every page.
- **The rail's rows come from a cheap `GET /api/rail`, and health only fills in the dots.**
  - The endpoint reads exactly what `loadShell()` reads today: the Caddyfile and the inventory file. It runs no status checks.
  - The rail therefore still lists every site when health fails, and it keeps its two distinct error lines.
  - We rejected taking the rows from `/api/health` (it is slow, and when health fails the rail would be empty) and caching them in `localStorage` (the app deliberately never shows stale state as current).

## Why

Every page's content is React's since #113. The server still draws a shell React then partly replaces through a portal, which means two rail renderers held together by a parity test, and a Caddyfile read on every page request just to draw a rail React redraws. Finishing the migration removes the second renderer and the per-request templating.

## Goal

- Every client route is served as one static document. React renders the whole body.
- After load, every page looks exactly as it does on `main`.
- Retire `src/views/shell.ts`'s `layout()`, `src/views/clientShell.ts`, `src/views/rail.ts`, `src/routes/loadShell.ts` and `RailPortal`, behind frozen fixtures.

## Non-goals

- **Any visual or copy change after load.**
- **Changing an `/api/*` endpoint other than adding `/api/rail`, or any write route.**
- **Changing focus rules, routes, polling cadences or the `created`/`removed` URLs.**
- **Rendering anything before the bundle runs.** The first moment is an empty body, which is accepted.

## Decisions

### 1. Serving

- **The static document.** `index.html` becomes a Vite build input, and the build writes `public/client/index.html` with the hashed script and CSS tags in place.
  - Its `<head>` reproduces what `layout()` writes today:
    - `lang="en"` and `class="[color-scheme:dark]"` on `<html>`;
    - the charset and viewport metas;
    - the Google Fonts preconnects and stylesheet;
    - `/style.css`.
  - Its `<title>` is `lychee admin`.
  - Its `<body>` has today's classes and one empty mount point, `#react-root`.
- **Express.**
  - It reads `public/client/index.html` once at startup, as it reads the manifest today.
  - It sends that file, behind basic auth and `sameOrigin`, for `/`, `/services`, `/reconciler`, `/infrastructure`, `/sites/new` and `/sites/:hostname`.
  - `/sites/:hostname` answers `404` when the Caddyfile is readable and has no such managed site. Otherwise every route answers `200`.
  - When the file is absent, every client route answers `500` with `client bundle missing; run npm run build`.
- **`GET /api/rail`.**
  - It returns `ApiOk<RailPayload>`, where `RailPayload` is `{ sites: { hostname: string; hint: string }[] | null; hostAvailable: boolean; domain: string }`.
  - The data is exactly `loadShell()`'s: managed sites in Caddyfile order, with hint `static` or `:<port>`. An unreadable Caddyfile gives `sites: null`, and an unavailable inventory gives `hostAvailable: false`.
  - It always answers `200`, sits behind basic auth, and runs no status checks.

### 2. The React shell

- **The frame.** `mountApp` renders `AppFrame` into `#react-root`.
  - `AppFrame` reproduces `layout()`'s body, with the same elements, classes and ids in the same order:
    1. the narrow-screen top bar;
    2. the rail;
    3. the content column `div`, holding `<main>`, which holds the toast host (`#flash-banner` with its message, progress dot, action and close), `#copy-status`, the page-notice slot, and the routed page.
  - `RailPortal`, and the `#rail`, `#top-bar` and `#app-root` slots, are removed.
- **The toast host renders once and never re-renders.** `toast.ts` and `installSharedBindings` keep working by id, and React never overwrites the classes `toast.ts` sets.
- **Rail data.**
  - `useRail()` reads `GET /api/rail` once per document load and feeds `Rail` the props `renderRailData` used to feed it. `["rail"]` is invalidated together with health after every in-app write.
  - Until the first answer, the rail shows its fixed parts (wordmark, find, the `sites` heading, host links), with no site rows and no error line.
  - Health keeps its 15 s poll and its error behaviour.
- **Notices.** Both keep today's markup, position (above the page, inside `<main>`) and close button.
  - `?removed=<host>` gives "Removed <host>. Remember to remove the DNS record in Cloudflare manually."
  - `?created=1` on a site page gives `addedNotice(site)`, drawn once that site's payload is in.
  - Both are read once, before `stripNoticeParams`, and removed on the first in-app move away.
- **Title.** Every page sets `document.title` on a document load as well as on in-app moves: `Sites`, the board group labels, the hostname, `Site not found`, `Add a site`.
- **Focus.** Focus rules are unchanged, and a document load still takes no focus.

### 3. Retirement

1. **Freeze the shell.** Store the full `layout()` body for each page type in `src/dev/fixtures/shell/`. A body runs from `<body>` to `#react-root`, with the server-drawn rail and top bar, and each fixture is checked byte-equal against the live renderer. The page types:
   - `/` and `/?removed=x`;
   - the three boards;
   - a static site, a static site with `?created=1`, and a Next.js site with `?created=1`;
   - `/sites/new` and an unknown site;
   - an unreadable Caddyfile and an unavailable inventory.
2. **Freeze the rail.** Store `rail.ts`'s output for the existing rail parity cases in `src/dev/fixtures/rail/`.
3. **Switch the parity tests to the fixtures.** The React side is `AppFrame` with the same data, compared in its health-free state using `canonical()` and `canonical(html, { inlineWhitespace: true })`. Each parity file ends with an every-fixture-read check.
4. **Delete** `layout()`, `clientShell.ts`, `rail.ts`, `renderRailData`, `loadShell.ts`, `RailPortal`, the slot plumbing, and the manifest-to-tags code that only `layout()` used. The node-free modules React uses stay (`railModel.ts`, `shared.ts` and the rest).

## Scope

- **Server:**
  - static serving and statuses;
  - `GET /api/rail`;
  - removing `layout()`, `clientShell.ts`, `rail.ts` and `loadShell.ts`;
  - the Vite input.
- **Client:**
  - `AppFrame`;
  - `useRail()`;
  - the notice slot;
  - titles on document load;
  - removing the portal.
- **Docs:** CLAUDE.md covers the static document, `/api/rail`, and the end of the server shell. Every passage about server-rendered shells, `layout()`, `rail.ts`, `RailPortal` and the rail's two renderers goes. DESIGN.md is unchanged.

## Testing

- **API:** `/api/rail` returns:
  - the seed's sites and hints;
  - `sites: null` for an unreadable Caddyfile;
  - `hostAvailable: false` for an unavailable inventory;
  - `401` without credentials.
- **Express:**
  - every client route serves `index.html` with `200`;
  - an unknown site answers `404`, and a known one `200`;
  - with no build, every client route answers `500` with the text;
  - `/api/*` and the write routes are unaffected;
  - `index.html`'s `<head>` carries today's fonts, `style.css` and `color-scheme`.
- **Frame:**
  - parity against the shell and rail fixtures;
  - the rail's fixed parts show before `/api/rail` answers, then the rows;
  - the rail lists sites when health fails;
  - both notices render from the query, and are removed on the first move away;
  - `["rail"]` is re-read after an in-app write;
  - the toast host never re-renders under `toast.ts`'s class changes.
- **Browser check** against `npm run dev:mock`. Compare pixel for pixel against `main` at 1280 and 390 px, after load:
  - `/`;
  - a board;
  - a site page;
  - `/sites/new`;
  - an unknown site;
  - the `created` and `removed` notices.

  Then exercise:
  - the narrow drawer and ⌘K find;
  - toast, copy and notice close;
  - an end-to-end add, remove and Deploy.
- **Commands:** `npm run typecheck`, `lint`, `test` and `build`, plus the detector on `src/views src/client`.

## Risks

- **First paint.** On a cold full load the body is empty until the bundle runs, and the site rows are missing until `/api/rail` answers. Moves within the app are unchanged.
- **The toast host.** It must never re-render under `toast.ts`'s imperative class changes. A test pins this.
- **The `created` notice timing.** The notice now waits for the site payload rather than arriving with the document.
