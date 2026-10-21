# React foundation: sub-project 1 of the SPA migration

Date: 2026-10-21 · Decision record: the operator chose a React single-page app plus a JSON API over server-rendered views, migrated with a strangler pattern (same URLs, page by page), with the visual redesign happening *during* the migration. The redesign is designed in a separate `/impeccable shape` pass. This sub-project changes no visible UI.

## Why

`public/app.js` has grown to 1,257 lines of hand-managed client state: in-flight flags, request sequence counters, debounce timers, back/forward-cache restore, and DOM patched by hand. That is where this round's client-side bugs came from. The operator also wants live features (a Deploy loop that closes itself, live request paths and boards) and a redesign with real navigation and loading states. A component model computed from state, with typed data shared with the server, is the chosen base for that work.

## Goal

React 19 and TypeScript are in place end to end:

- built in CI;
- shipped in the signed release image;
- served behind the existing auth;
- fed by a typed JSON API;
- covered by tests.

This is proven by moving one real page, `/infrastructure`, to React **with identical output**. Every other page, and every safety property in CLAUDE.md, is unchanged.

## Non-goals

- Any visual or IA change. That's the shape pass and later sub-projects.
- A client-side router: one page needs none, and it arrives with the second migrated page.
- Hot module reload.
- Live polling. TanStack Query is installed with ops-tool defaults so later pages have a convention, but `/infrastructure` doesn't poll.

## Decisions

### 1. Serving: the server keeps the document shell; React owns the content area

- **The shell.** A migrated URL is answered by Express with the same `layout()` from `src/views/shell.ts` that every page uses: the header band, nav, `aria-current`, flash toast, copy-status live region and page notice. Its body content is:
  - an empty `<div id="app-root" data-page="infrastructure"></div>`;
  - the client bundle's `<script type="module">` and CSS `<link>` tags, read from the Vite manifest.
- **What React owns.** React renders that page's content into `#app-root`. Moving between a server page and a React page is an ordinary full page load.
- **One header for now.** Until the whole app has migrated, there is exactly one header and nav implementation, the server's. Moving the shell into React belongs to the redesign.
- **Middleware order unchanged.** It stays basic auth, then `sameOrigin`, then static files, then routers. `/api/*` and the bundle are both behind auth, and `/` still answers `401` unauthenticated, which is what lychee-ops' health check relies on.
- **Manifest read.** Express reads `public/client/.vite/manifest.json` once at startup. If it's missing, the migrated route answers `500` with "client bundle missing; run npm run build". It never serves a page that can't load its script.

### 2. API

- **Endpoint.** `GET /api/services?group=<reconciler|service|infrastructure>` returns `{ ok: true, board, now }`, where `board` is the `ServiceBoard` for that group's rows. An unknown group returns `400 { ok: false, reason }`.
- **Same data both ways.** The board's data assembly currently lives inside `renderBoardPage` in `src/routes/services.ts`: the inventory read, unit states, timer schedule, container statuses, declarations, last runs, and the `prunable`, `managed` and `requested` sets. It moves into one exported function that both the HTML route and the JSON route call, so the two can't diverge.
- **Degradation.** An unavailable or empty inventory degrades exactly as the HTML page does today. The API returns the same `board` with `inventoryAvailable: false`, and the component renders the same explanation.
- **Shared types.** They live in `src/shared/` (types only, no runtime), imported by the route and the client: `BoardRow`, `ServiceBoard`, `ServiceGroup`, and the API response envelope `ApiOk<T> | ApiError`, where `ApiError` is `{ ok: false; reason: string }`, the same shape the existing mutating routes return.

### 3. Client build

- **Source.** `src/client/` holds `.tsx` and `.ts` files. Its own `tsconfig.client.json` uses `module: "ESNext"`, `moduleResolution: "Bundler"`, `jsx: "react-jsx"` and `lib` with `DOM`. The server's `tsconfig.json` and `tsconfig.build.json` exclude `src/client`. `src/shared` stays type-only and is consumed by both.
- **Dependencies:** `react@19`, `react-dom@19`, `@tanstack/react-query`. Dev dependencies: `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `happy-dom`, `eslint-plugin-react-hooks`. React and its siblings are runtime dependencies of the bundle only; `assemble-release.sh` installs production deps for the **server**, so they're listed under `devDependencies` and the release tree's `node_modules` doesn't grow.
- **Vite output.** Vite builds `src/client/main.tsx` to `public/client/` with `build.manifest: true`. `public/client/` is gitignored.
- **CSS.** The client entry imports `src/styles/tailwind.css`, and Vite processes it through `@tailwindcss/vite`. `src/client` is already under the entry's `@source "../../src"`, so classes and DESIGN.md tokens are identical. The CLI `build:css` to `public/style.css` stays for the server pages.
- **Shared class constants.** They're imported from `src/views/shared.ts`. It's side-effect-free string constants, so Vite bundles what's used. The React components and the server views therefore share one definition of every class string.
- **Scripts:**
  - `build:client` runs `vite build`.
  - `build` becomes `npm run build:css && npm run build:client && tsc -p tsconfig.build.json`.
  - `dev` and `dev:mock` gain `vite build --watch` as a third `concurrently` process.
  - `typecheck` also runs `tsc -p tsconfig.client.json --noEmit`.
  - `lint` lints `src` including `.tsx`, with the React Hooks rules.
- **Data layer.** TanStack Query's `QueryClient` defaults:
  - `staleTime: 0`
  - `refetchOnWindowFocus: true`
  - `retry: 1`
  - no persisted cache

  An ops tool must not show stale state as current.

### 4. The proof page: `/infrastructure`

- `src/client/pages/InfrastructurePage.tsx` fetches `/api/services?group=infrastructure` and renders the page body. Its output is the **same elements, ids, classes and text** that `renderServicesPage(..., group = "infrastructure")` produces for the board area:
  - the group eyebrow;
  - the inventory freshness line;
  - each row (pill, name, facts, unknown line, gate, failure line);
  - the empty-group and unavailable-inventory explanations.
- **While loading** (before the first response), it renders nothing inside `#app-root`. Skeletons are the redesign's call, not the foundation's.
- **A failed fetch** renders the same `role="alert"` error treatment the add-site page uses, with the server's `reason` or `HTTP <status>`.
- **The route.** `GET /infrastructure` now serves the shell plus mount point. `/services` and `/reconciler` stay server-rendered. The `infrastructure` entry leaves `BOARD_PAGES`. `renderServicesPage` stays, because the other two groups use it.
- **Out of scope here:** infrastructure rows carry no host actions, offers or Prune today, so the component needn't render those. If the inventory ever lists an action on an infrastructure unit, the component renders the row without the strip, and a test pins that it doesn't crash.

### 5. Testing

- **Component tests** run on the existing `node:test` runner via `tsx`. One runner, and CI's `test` job is unchanged. They live at `src/client/**/*.test.tsx` and use `@testing-library/react` with `happy-dom` registered once in a shared setup file under `src/client/test/`.
- **Parity test.** For three fixture boards (two healthy rows; one unknown; an unavailable inventory), the HTML `renderServicesPage` produces for the infrastructure group's board area and the React component's rendered HTML match. Compare after normalising whitespace and attribute order, and restrict the comparison to the content region.
- **API tests:**
  - `GET /api/services?group=infrastructure` returns rows matching the fakes, through the existing route-test helpers;
  - an unknown group returns `400`;
  - `/api/services` without credentials returns `401`.
- **Route tests:**
  - `GET /infrastructure` returns the shell with the nav, `aria-current` on infrastructure, `#app-root` and a `<script type="module">` whose `src` comes from the manifest;
  - with no manifest, it returns `500` and the message.
- **The release.** `assemble-release.sh` also requires `public/client/.vite/manifest.json`, and the CI smoke test stays as it is.
- **Browser check** against `npm run dev:mock`: `/infrastructure` looks pixel-identical to main today (screenshot compare), and moving `/services` → `/infrastructure` → `/sites` works.
- Run `npm run typecheck`, `lint`, `test` and `build`. Run the detector by hand on `src/views` and `src/client`.

## Documentation

- **CLAUDE.md Stack section:**
  - the server-rendered shell plus React content area;
  - `/api/*`;
  - `src/client` and `src/shared`;
  - the migration rule: a page moves only with output parity unless its sub-project is the one redesigning it;
  - the new scripts.
- **Release and Tailwind:** CLAUDE.md's release-tree sentence gains `public/client`, and the Tailwind sources note gains `src/client`.
- **Detector scope:** the guidance names `src/views src/client`.
- **DESIGN.md:** unchanged.

## Risks

- **Two rendering idioms during the migration.** The server views (template strings) and React (JSX) both render pages until the last page moves. Shared class constants keep the look consistent, and the parity test keeps the proof page honest.
- **Release size.** The bundle adds about 60 KB gzipped of static JS to `public/`. Runtime `node_modules` is unchanged.
- **A missing bundle.** The startup manifest read and the `500` keep a release without a bundle from serving a blank page. The assemble check stops it before release.
