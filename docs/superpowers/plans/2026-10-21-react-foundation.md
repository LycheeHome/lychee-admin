# React Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React 19 and TypeScript run end to end in lychee-admin: built in CI, shipped in the signed image, served behind the existing auth, fed by a typed JSON API, and tested. This is proven by `/infrastructure` rendering in React with output identical to today's.

**Architecture:**
- Express keeps the document shell (`layout()`), and React renders only into an `#app-root` mount point on migrated URLs.
- Vite builds `src/client` to `public/client` with a manifest Express reads at startup.
- The board's data assembly is extracted so `/services`, `/reconciler`, `/api/services` and the React page all build rows the same way.
- Types shared by server and client live in `src/shared`.

**Tech Stack:** React 19, react-dom 19, @tanstack/react-query, Vite, @vitejs/plugin-react, @tailwindcss/vite, TypeScript, `node:test` via `tsx`, @testing-library/react, happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-21-react-foundation-design.md`

## Global Constraints

- **No visible UI change anywhere.** `/infrastructure` must render identical elements, ids, classes and text to today's server render.
- **Middleware order stays** basic auth, then `sameOrigin`, then static, then routers. `/api/*` and `/client/*` are behind auth, and `/` still answers `401` unauthenticated.
- **Builds stay separate.** Server code stays CommonJS under `tsconfig.build.json`, and `src/client` is excluded from it. `src/shared` holds types only (no runtime code).
- **React and the client toolchain are `devDependencies`.** The release tree's `npm ci --omit=dev` must not grow.
- **The manifest** is read from `public/client/.vite/manifest.json`. Missing manifest → the migrated route answers `500` with body `client bundle missing; run npm run build`.
- **API envelope:** `{ ok: true, ... }` on success and `{ ok: false, reason: string }` on error. An unknown group → `400`.
- **QueryClient defaults:** `staleTime: 0`, `refetchOnWindowFocus: true`, `retry: 1`, no persistence.
- **Edit/Write only:** `src/views/*`, `src/client/*` and `public/*` are edited only with the Edit/Write tools, never sed, heredocs or scripts.
- **Full check before each commit:** run `npm run typecheck && npm run lint && npm test && npm run build`; all must pass.

## Review Focus

1. **The release tree.** `assemble-release.sh` copies `public/` including `public/client/`, its production `npm ci` is unchanged, and the CI smoke test still passes. Pinned in Task 1 (assemble check) and verified by the controller running the script locally.
2. **Unauthenticated asset requests** (`/client/assets/*.js`, `/api/services`) get `401`, not the file. Pinned in Task 2 and Task 3 tests.
3. **The `.tsx` test discovery.** `npm test` (`tsx --test`) must actually run `*.test.tsx`, or the component tests silently never run. Task 1 pins this with a canary test, and the count must rise.
4. **An unavailable or empty inventory, and a failed fetch, on `/infrastructure`** render the same explanation as today, or the alert. Pinned in Task 4's parity fixtures and error test.
5. **Stale client caching.** A second visit must not show a cached board as current; `staleTime: 0`. Pinned in Task 4 (assert the QueryClient's defaults).

---

### Task 1: Toolchain, client skeleton and test harness

**Files:**
- Modify: `package.json`:
  - deps: `react@^19`, `react-dom@^19`, `@tanstack/react-query@^5`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `@types/react`, `@types/react-dom`, `@testing-library/react`, `happy-dom`, `eslint-plugin-react-hooks`, all under `devDependencies`;
  - scripts per the spec §3.
- Create: `tsconfig.client.json`, `vite.config.ts`, `src/client/main.tsx`, `src/client/test/setup.ts`, `src/client/canary.test.tsx`.
- Modify: `tsconfig.json`: add `"jsx": "react-jsx"` and exclude `src/client` and `vite.config.ts`.
- Modify: `tsconfig.build.json`: exclude `src/client`.
- Modify: `.gitignore`: add `public/client/`.
- Modify: `eslint.config.js`: React Hooks rules for `src/client/**/*.tsx`.
- Modify: `scripts/assemble-release.sh`: also require `public/client/.vite/manifest.json`.

**Interfaces:**
- Produces:
  - `npm run build:client` writes `public/client/.vite/manifest.json` with an entry `src/client/main.tsx`;
  - `src/client/test/setup.ts` registers happy-dom globals when imported first by any client test.

- [ ] **Step 1: Write the canary test** `src/client/canary.test.tsx`. It imports `./test/setup`, renders `<p>canary</p>` with `@testing-library/react`'s `render`, and asserts `screen.getByText("canary")` exists.
- [ ] **Step 2: Run** `npm test 2>&1 | grep -c canary`. Expected: it fails (missing modules) or reports 0. If `tsx --test` does not discover `.tsx`, change the `test` script to pass explicit globs that include `src/**/*.test.ts` and `src/**/*.test.tsx`, and record the change as a ruling.
- [ ] **Step 3: Implement:**
  - install the deps;
  - the configs per the spec §3:
    - `vite.config.ts`: `root` is the repo, `build.outDir` is `public/client`, `build.manifest: true`, `build.rollupOptions.input` is `src/client/main.tsx`, `base` is `/client/`, plugins `react()` and `tailwindcss()`;
    - `tsconfig.client.json`: `module` `ESNext`, `moduleResolution` `Bundler`, `jsx` `react-jsx`, `lib` `["ES2022","DOM"]`, `include` `["src/client","src/shared"]`, `noEmit`;
  - `main.tsx` imports `../styles/tailwind.css` and, if `#app-root` exists, mounts nothing yet (Task 4 fills it);
  - `typecheck` runs both `tsc --noEmit` and `tsc -p tsconfig.client.json`;
  - lint covers `.tsx`.
- [ ] **Step 4: Run** the full check. Expected:
  - PASS;
  - the canary test runs and passes;
  - `public/client/.vite/manifest.json` exists after `npm run build`;
  - `sh scripts/assemble-release.sh /tmp/rel-check` succeeds, and `/tmp/rel-check/public/client` exists.
- [ ] **Step 5: Commit** `feat: Vite + React toolchain, client skeleton and test harness`.

---

### Task 2: Shared types, board data extraction and `GET /api/services`

**Files:**
- Create: `src/shared/board.ts`, which re-exports the types `BoardRow`, `ServiceBoard` and `ServiceGroup` with `export type` from their current modules, and defines `ApiOk<T> = { ok: true } & T` and `ApiError = { ok: false; reason: string }`.
- Modify: `src/routes/services.ts`. Extract `renderBoardPage`'s data assembly into `export async function loadBoardPage(deps: Deps, group: ServiceGroup): Promise<BoardPageData>`, returning `{ board, prunable, managed, requested, lastRuns, now }`. Both the HTML route and the new `GET /api/services` call it.
- Test: `src/routes/services.test.ts`

**Interfaces:**
- Produces:
  - `loadBoardPage(deps, group)` and `type BoardPageData`;
  - `GET /api/services?group=<g>` returns `{ ok: true, board: ServiceBoard, now: string }`, where `board` holds only that group's rows and `now` is ISO.

- [ ] **Step 1: Write the failing tests:**
  - `GET /api/services?group=infrastructure` with credentials returns `200`, JSON with `ok: true`, and `board.groups` holding exactly the infrastructure rows from the fakes (names `caddy` and `cloudflared-sites`).
  - `?group=nope` returns `400` with `{ ok: false, reason }`.
  - With no credentials it returns `401`.
  - With the inventory unavailable (the existing helper for that), it returns `200` with `board.inventoryAvailable === false`.
  - The HTML `/services` and `/reconciler` pages are unchanged; the existing tests still pass.
- [ ] **Step 2: Run** `npx tsx --test src/routes/services.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces. `renderBoardPage` becomes `loadBoardPage` followed by `renderServicesPage(...)`. The JSON route filters `board.groups` to the requested group in the same way `renderServicesPage` does.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: one board data path for the HTML board and /api/services`.

---

### Task 3: The shell mount and the manifest

**Files:**
- Modify: `src/views/shell.ts`. `LayoutOptions` gains `head?: string` (inserted before `</head>`) and `bodyEnd?: string` (inserted before the existing `<script>` tags).
- Create: `src/views/clientShell.ts` with:
  - `export function readClientManifest(publicDir: string): ClientAssets | null`;
  - `export function renderClientPage(title: string, page: string, nav: Nav, assets: ClientAssets): string`. It calls `layout(title, '<div id="app-root" data-page="<page>"></div>', { nav, head: <css links>, bodyEnd: '<script type="module" src="/client/<file>"></script>' })`.
- Modify: `src/routes/services.ts`. Remove `["/infrastructure", "infrastructure"]` from `BOARD_PAGES`, and add `GET /infrastructure`, which serves `renderClientPage("Infrastructure", "infrastructure", <the nav value the old page used>, assets)`, or `500` with the exact body from Global Constraints when the manifest is null.
- Modify: `src/app.ts`. Read the manifest once at startup and pass it through `Deps` (add an optional `clientAssets?: ClientAssets | null` to `Deps`, and set it from `src/server.ts` and `src/dev/server.ts`).
- Test: `src/views/clientShell.test.ts`, `src/routes/services.test.ts`

**Interfaces:**
- Consumes: Task 1's manifest layout (entry key `src/client/main.tsx`, with `file` and `css[]`).
- Produces:
  - `type ClientAssets = { script: string; styles: string[] }`;
  - the `#app-root[data-page]` mount contract that Task 4 reads.

- [ ] **Step 1: Write the failing tests:**
  - **`readClientManifest`:**
    - on a temp dir with a sample manifest, returns `{ script: "assets/main-abc.js", styles: ["assets/main-def.css"] }`;
    - with no manifest, returns `null`.
  - **`renderClientPage`:**
    - contains `id="app-root" data-page="infrastructure"`;
    - contains `<script type="module" src="/client/assets/main-abc.js">`;
    - contains the CSS `<link>`;
    - contains the nav with `aria-current="page"` on infrastructure.
  - **Route:**
    - `GET /infrastructure` with `clientAssets` set returns `200` and that markup;
    - with `clientAssets: null` it returns `500` and the exact body;
    - unauthenticated it returns `401`.
  - Every other page's HTML is unchanged; the existing shell tests still pass.
- [ ] **Step 2: Run** `npx tsx --test src/views/clientShell.test.ts src/routes/services.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: serve migrated URLs as the shared shell plus a React mount point`.

---

### Task 4: `/infrastructure` in React, with parity

**Files:**
- Create:
  - `src/client/queryClient.ts`, exporting `createQueryClient(): QueryClient` with the Global Constraints defaults;
  - `src/client/api.ts`, exporting `fetchBoard(group: ServiceGroup): Promise<ServiceBoard & { now: string }>`, which throws `Error(reason ?? "HTTP <status>")` on a non-ok response;
  - `src/client/pages/InfrastructurePage.tsx`;
  - `src/client/components/BoardRows.tsx`.
- Modify: `src/client/main.tsx`. When `#app-root[data-page="infrastructure"]` exists, mount `<QueryClientProvider><InfrastructurePage/></QueryClientProvider>`.
- Test: `src/client/pages/InfrastructurePage.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/services` (Task 2);
  - the mount contract (Task 3);
  - class constants and `formatAge` from `src/views/shared.ts`.

- [ ] **Step 1: Write the failing tests:**
  - **Parity.** For three fixture boards (two healthy infrastructure rows; one row with status `unknown`; `inventoryAvailable: false`), the board region of `renderServicesPage(board, NOW, new Set(), "lychee.land", {}, "infrastructure")` equals the HTML of `<InfrastructureBoard board={board} now={NOW} />`, the pure presentational component the page renders. Extract the region with the same start and end markers in both. Before comparing, collapse whitespace between tags.
  - **Error.** `InfrastructurePage` with a fetch mocked to `500 { ok:false, reason:"boom" }` renders a `role="alert"` containing `boom`.
  - **Defaults.** `createQueryClient().getDefaultOptions().queries` has `staleTime: 0`, `refetchOnWindowFocus: true` and `retry: 1`.
  - **Actions.** A row with `actions: ["restart"]` renders without throwing and with no action strip.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `InfrastructureBoard` renders exactly the markup `renderServicesPage` produces for the group's board area: eyebrow, freshness line, rows, and the empty and unavailable explanations. It uses the same `shared.ts` constants.
  - `InfrastructurePage` uses `useQuery({ queryKey: ["board","infrastructure"], queryFn: () => fetchBoard("infrastructure") })`, renders nothing while loading, renders the alert on error, and renders `InfrastructureBoard` on success.
  - Where server markup is a raw string helper, mirror its structure in JSX. Don't `dangerouslySetInnerHTML` server HTML.
- [ ] **Step 4: Run** the full check. Expected: PASS. Run the detector on `src/views` and `src/client`. Expected: `[]`.
- [ ] **Step 5: Commit** `feat: /infrastructure renders in React with output identical to the server page`.

---

### Task 5: Documentation

**Files:**
- Modify: `CLAUDE.md`. Edit minimally; change only what this work made false or newly true:
  - the Stack section: the shell plus React content area, `/api/*`, `src/client`, `src/shared`, and the migration rule (a page moves only with output parity unless its sub-project is the one redesigning it);
  - the release-tree sentence: add `public/client`;
  - the Tailwind sources paragraph: `src/client` is covered by `src`;
  - the manual detector scope: `src/views src/client`;
  - the scripts: `build:client`, and `dev:mock`'s third process.

- [ ] **Step 1:** Make the edits.
- [ ] **Step 2: Run** the full check. Expected: PASS.
- [ ] **Step 3: Commit** `docs: CLAUDE.md describes the React foundation`.

After Task 5, the controller runs:
- a Playwright screenshot compare of `/infrastructure` on this branch against `main`, both against `npm run dev:mock`;
- the navigation check `/services` → `/infrastructure` → `/sites`.
