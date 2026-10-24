# Add Site Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/sites/new` to React with output and behaviour parity, proven by running the real `public/app.js` alongside it. Then delete `app.js`, `renderAddSite`, `renderErrorPage` and `src/views/html.ts`.

**Architecture:**
- **Data.** A read endpoint, `GET /api/sites/new`, feeds `AddSitePage`. The route loader sends `?refresh=1`, so arrival pulls the clone, as today's GET does.
- **Logic.** `app.js`'s decisions move into a node-free `addSiteModel.ts`.
- **Parity.** A dual-run harness drives the real `app.js` on the server's markup and the React page through one script of steps, comparing them after each step. Its reference snapshots are then frozen.
- **Shared code.** Copy, notice-close and toast-close move into the client bundle.

**Tech Stack:** Express and TypeScript; React 19, React Router 8.4.0 in data mode, TanStack Query 5; `node:test` via `tsx`, and `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-23-add-site-migration-design.md`

## Global Constraints

- **Edit/Write only.** Edit `src/views`, `src/client` and `public` with the Edit and Write tools only, never shell commands or scripts. That includes test files. Generated fixture files under `src/dev/fixtures` may come from a one-off script, deleted afterwards.
- **Parity:** same elements, ids, classes, attributes, inline styles and text as `renderAddSite` + `app.js` produce, step for step. Compare with `canonical()` and with `canonical(html, { inlineWhitespace: true })` (`src/client/test/canonical.ts`). Any phrase the server writes as one text node must be one text node in React.
- **Copy is unchanged.** Every string is copied verbatim from `public/app.js` or `renderAddSite`. That covers the toast `Adding <host> — reloading Caddy and restarting cloudflared-sites…`, `Enter a hostname.`, `Failed to add site` and `Fix the problem above and the block appears here.`
- **Endpoints are unchanged.** `POST /sites/preview` and `POST /sites` keep the same bodies, which are URL-encoded `hostname` (composed), `type`, `port`, `framework` and `healthcheckPath`, trimmed. Their responses and status codes are unchanged too.
- **Timing:**
  - the preview debounce is `250` ms;
  - the copy reset is `1500` ms;
  - the toast's success dismissal is `4000` ms.
- **Success navigation:** a full document load of `/sites/<encodeURIComponent(hostname)>?created=1`, never a router move.
- **API errors** use `{ ok: false, reason }`. An unreadable Caddyfile answers `200` with `caddyfileError` (`CommandError` message + `\n` + stderr, or `String(error)`).
- **Missing client bundle:** `/sites/new` answers `500` with `client bundle missing; run npm run build`.
- **Test hygiene:**
  - waits use `{ timeout: 5000 }`;
  - check absence with `assert.ok(!node)`;
  - never `assert.equal` DOM nodes, because a failing one hangs the runner; use `assert.ok(a === b)`;
  - test QueryClients use `mutations: { gcTime: 0 }`;
  - test servers use `listen(0, "127.0.0.1")`.
- **Before every commit**, run `npm run typecheck && npm run lint && npm test && npm run build` (chained, so any failure stops the commit), plus the detector on `src/views src/client`.
- **Do not change** safety properties, middleware order, URLs, or any mutating route's behaviour.

## Review Focus

1. **Typing fast, then submitting before the 250 ms preview fires.** The submit uses the field's current value, a stale preview answer arriving later never re-blocks it, and exactly one `POST /sites` is sent. Pinned in Task 4.
2. **A hostname typed with the domain already on it, a trailing dot, or capitals** (`Blog.Lychee.Land.`). The headline, the preview body and the submit body all use one `composeHostname` result, the same one `app.js` computes. Pinned in Task 2 and the dual run.
3. **Moving from `/sites/new` to another page while a preview or submit request is in flight.** Nothing throws, no toast or state lands on the next page, and no request is sent after leaving. Pinned in Task 5.
4. **Clicking a copy button twice within 1.5 s.** The label and icons still end in their resting state, and `#copy-status` clears. Pinned in Task 6.
5. **Returning to `/sites/new` via back after a failed submit** (bfcache `pageshow` with `persisted`). The button is enabled, the toast hidden, and the preview re-run. Pinned in the dual run (step 11) and Task 4.

---

### Task 1: `GET /api/sites/new`

**Files:**
- Create: `src/shared/addSite.ts`, `src/routes/apiAddSite.test.ts`
- Modify: `src/routes/sites.ts`

**Interfaces:**
- Produces, in `src/shared/addSite.ts`:
  ```ts
  export type AddSitePayload = {
    domain: string;
    portOwners: Record<string, string>;
    paths: { caddyfilePath: string; tunnelConfigPath: string };
    steps: { id: string; label: string }[];
    caddyfileError: string | null;
  };
  ```
- `GET /api/sites/new` is registered after `GET /api/sites` and **before** `GET /api/sites/:hostname`, so `new` is never taken for a hostname.

- [ ] **Step 1: Write the failing tests** in `apiAddSite.test.ts`, on a seeded dev app as `apiSiteDetail.test.ts` builds one:
  - `answers the seed's domain, port owners, paths and steps`: `portOwners` deep-equals `computePortOwners` over the seed (export it for the test if it isn't exported), and `steps` deep-equals `ADD_STEPS` mapped to `{ id, label }`.
  - `an unreadable Caddyfile answers 200 with caddyfileError`.
  - `?refresh=1 pulls once and a plain read never pulls`: count `refreshDeclarations`. Two plain reads give 0; one refresh read gives 1.
  - `401 without credentials`.
  - `/api/sites/new is not read as a hostname`: the body has `portOwners`, not a 404 `reason`.
- [ ] **Step 2: Run** `npx tsx --tsconfig tsconfig.test.json --test src/routes/apiAddSite.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route.
- [ ] **Step 4: Run** the file, then the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: /api/sites/new, the add page's facts`

### Task 2: `addSiteModel.ts`, the add page's decisions

**Files:**
- Create: `src/client/addSiteModel.ts`, `src/client/addSiteModel.test.ts`

**Interfaces:**
- Produces (node-free, no DOM):
  - `composeHostname(label: string, domain: string): string`. Same algorithm as `app.js`: trim, strip trailing dots, append `.<domain>` unless the value (case-insensitively) is the domain or ends with `.<domain>`.
  - `headlineParts(hostname: string, domain: string): { label: string; suffix: string } | { whole: string } | null`, where `null` means "Add a site".
  - `portMessage(port: string, owners: Record<string, string>): string | null`.
  - `fieldVisibility(type: "static" | "reverse-proxy", framework: string): { port: boolean; healthcheck: boolean; nextjsDescription: boolean }`.
  - `previewSections(preview: SitePreview): { path: string; lines: string[]; contextAfter: string | null }[]`, using the preview type `buildSitePreview` returns (type-only import).
  - `skipMarks(steps: { id: string; willRun: boolean }[])` and `resultMarks(steps: { id: string; status: string }[])`. Both return `Record<id, { text: string; className: string }>` with `app.js`'s `STEP_MARKS` and `STEP_MARK_CLASSES` values exactly.

- [ ] **Step 1: Write the failing tests**, one `describe` per function:
  - **`composeHostname`:**
    - `"blog"` → `"blog.lychee.land"`;
    - `"Blog.Lychee.Land."` → `"Blog.Lychee.Land"`;
    - `"lychee.land"` → `"lychee.land"`;
    - `"  "` → `""`.
  - **`headlineParts`:**
    - `"blog.lychee.land"` → `{ label: "blog", suffix: ".lychee.land" }`;
    - `""` → `null`.
  - **`portMessage`:** the seed owner sentence for a claimed port, and `null` for a free one.
  - **`fieldVisibility`:** all four combinations.
  - **`previewSections`:**
    - a static preview gives three sections, the files one last;
    - a proxy preview gives two;
    - the tunnel section keeps `contextAfter`.
  - **Marks:** `skipMarks` gives `—` with `text-stone-400` for `willRun: false`, and `""` otherwise. `resultMarks` gives `✓`/`✗`/`—`/`·` with their classes.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full check. `grep -n "node:\|document\|window" src/client/addSiteModel.ts` returns nothing.
- [ ] **Step 5: Commit** `feat: the add page's decisions in a node-free model`

### Task 3: The dual-run harness, with `app.js` as reference

**Files:**
- Create: `src/client/test/addSiteDualRun.ts` (the harness), `src/client/pages/AddSiteReference.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  type Step = { name: string; act: (d: Driver) => Promise<void> };
  type Snapshot = { main: string; toast: string; submit: string; fetches: string[]; focus: string };
  export const ADD_SITE_STEPS: Step[];   // the spec's 11 steps, in order
  export function referenceRun(payload: AddSitePayload, answers: StubAnswers): Promise<Snapshot[]>;
  export function candidateRun(render: () => void, answers: StubAnswers): Promise<Snapshot[]>;
  ```
  - `Driver` exposes `type(selector, text)`, `select(selector, value)`, `check(selector)`, `submit()`, `tick(ms)`, `pageshow(persisted)` and `resolvePending(index)`. `resolvePending` releases a held stubbed `fetch` answer, which is how the stale-answer step lands out of order.
  - `StubAnswers` maps each recorded `POST /sites/preview` and `POST /sites` request body to its response.
  - Snapshot fields:
    - `fetches` lists `METHOD URL body`;
    - `focus` is the active element's id, or its tag;
    - `submit` is the `#add-site-submit` outerHTML;
    - `main` is the `<main>` innerHTML;
    - `toast` is the `#flash-banner` outerHTML.
- **`referenceRun`:**
  1. Write `renderAddSite(...)`'s full document body into happy-dom, built from the payload with `testShell()`.
  2. Stub `fetch` and `navigator.clipboard`.
  3. Evaluate `public/app.js` once, wrapped as `(0, eval)("(function(){" + source + "\n})()")`. A fresh function scope is needed, because its top-level `const`s cannot be redeclared by a second eval.
  4. Run the steps, using timer mocks for the 250 ms debounce.
- **`candidateRun`** does the same around a render callback. Task 4 supplies the callback.
- Answers are recorded from the dev app (`POST /sites/preview` and `POST /sites` against the seeded fakes), saved as JSON beside the harness. For the failed-submit step, use a hostname that collides with the seed (`blog.lychee.land`), so the server's real 400 `steps` are used.

- [ ] **Step 1: Write the reference tests** in `AddSiteReference.test.tsx`. These assert the harness reaches every branch on the **reference** side, before any React exists:
  - **Step 2:** `#composed-hostname` reads `blog` + `.lychee.land`.
  - **Step 4:** `.port-input` has `style="display: flex;"`.
  - **Step 5:** `#port-error` shows the seed's owner sentence.
  - **Step 6:** `#healthcheck-field-wrapper` is shown, and the proxy radio's `aria-describedby` is `type-proxy-description-nextjs`.
  - **Step 7:** submit has `aria-disabled="true"`, and focus is `preview-error` after the blocked submit.
  - **Step 8:** `#add-site-error` reads `Enter a hostname.`.
  - **Step 9:** the step marks show `✓` and `✗` from the 400 response, and the toast is hidden.
  - **Step 10:** the stale answer did not overwrite the newer panel.
  - **Step 11:** submit is enabled again.
- [ ] **Step 2: Run** them, which brings up the harness iteratively. Expected: PASS on the reference side. If some step cannot run under happy-dom, follow the spec's Risk: capture that step's reference in a real browser with Playwright, store it, and name the gap in the report.
- [ ] **Step 3: Commit** `test: a dual-run harness that drives app.js on the add page`

### Task 4: React `AddSitePage` body, dual-run parity

**Files:**
- Create:
  - `src/client/pages/AddSitePage.tsx`
  - `src/client/components/AddSiteForm.tsx`
  - `src/client/components/AddSitePreview.tsx`
  - `src/client/pages/AddSiteParity.test.tsx`

**Interfaces:**
- Consumes: Task 2's model, Task 3's harness, `AddSitePayload`, `showToast`/`hideToast` (`src/client/toast.ts`) and `CaddyfileError` (`src/client/components/SiteDetail.tsx`).
- Produces: `AddSiteBody({ payload, headingRef, go? })`, where `go` defaults to `window.location.assign`. Task 5 wraps it in the routed page.

- [ ] **Step 1: Write the failing parity test.**
  - For each of the 11 steps, `candidateRun` and `referenceRun` must give equal snapshots:
    - `main` under both `canonical` modes;
    - `toast`, `submit`, `fetches` and `focus` exactly.
  - Add the Review Focus tests:
    - **RF1:** type, then submit within 100 ms → exactly one `POST /sites`, carrying the typed hostname. A later preview answer leaves submit unblocked.
    - **RF5:** after a failed submit, `pageshow` with `persisted` → the button is enabled, the toast hidden, and one new preview request sent.
  - Add: a success response calls `go("/sites/blog2.lychee.land?created=1")`, and with `caddyfileError` set, `CaddyfileError` renders.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The in-flight guard is a ref, so it holds synchronously.
  - Preview requests carry a sequence number held in a ref.
  - Inline `style={{ display }}` is used where `app.js` sets `style.display`.
  - The `pageshow` listener lives in an effect, removed on unmount.
- [ ] **Step 4: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 5: Commit** `feat: the React add page, held to app.js step for step`

### Task 5: `/sites/new` as a client route

**Files:**
- Modify:
  - `src/client/clientNav.tsx`: `ADD_SITE_ROUTE = "/sites/new"`, and `isClientRoute` includes it. `siteOf` still rejects `new`.
  - `src/client/router.tsx`: the route, with a loader that fetches `/api/sites/new?refresh=1` into `addSiteQuery()` (`staleTime: Infinity`, no interval, no focus refetch). It replaces the `Nothing` route.
  - `src/client/api.ts`: `fetchAddSite(refresh: boolean)` and `addSiteQueryKey()`.
  - `src/client/components/SiteList.tsx`: the two `/sites/new` anchors become `RailLink`.
  - `src/views/clientShell.ts`: `ClientPage` adds `"add-site"`.
  - `src/routes/sites.ts`: `GET /sites/new` answers `renderClientPage("Add a site", "add-site", loadShell(deps, null))`, or the 500 bundle text. Its old body, which pulled the clone and rendered HTML, is removed. The pull now lives in the API's `?refresh=1`.
  - `src/routes/sites.test.ts`: the GET's HTML assertions become shell assertions.
- Create: `src/client/pages/AddSiteRoutes.test.tsx`

- [ ] **Step 1: Write the failing tests.**
  - **Routes:**
    - list → `/sites/new` (the Add site button) and the empty state's CTA → `/sites/new` make no document load (`window.location.assign` is never called);
    - Cancel and the breadcrumb return to `/` in-app;
    - the title is `Add a site`, and the headline has focus unless focus was in `#find`;
    - no rail row is `aria-current`;
    - the loader's fetch carries `?refresh=1`.
  - **RF3:** start a preview and leave during the 250 ms window → no `POST /sites/preview` after leaving. Then start a submit, leave, and resolve it → no throw, and `go` is never called after unmount.
  - **`sites.test.ts`:**
    - `GET /sites/new` → 200 with `data-page="add-site"`;
    - an unreadable Caddyfile → 200;
    - no bundle → 500 with the text;
    - `/sites/new` is still not taken for a hostname.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Follow `SiteDetailPage`'s title, focus and document-load patterns.
- [ ] **Step 4: Run** the full check and the detector.
- [ ] **Step 5: Commit** `feat: the add page is a client route`

### Task 6: Copy, notice-close and toast-close move into the client

**Files:**
- Create: `src/client/sharedBindings.ts`, `src/client/sharedBindings.test.ts`
- Modify:
  - `src/client/router.tsx`: `mountApp` calls `installSharedBindings(doc)` once.
  - `src/client/toast.ts` and `src/client/toast.test.ts`: the toast tests stop evaluating `app.js` and test `showToast`/`hideToast` directly. They cover:
    - each tone's classes;
    - the progress dot for `info` only;
    - close shown only for `error`;
    - the 4000 ms success dismissal;
    - the action button set and cleared.
  - `public/app.js`: delete its copy block, its `#page-notice-close` binding and its `#flash-banner-close` binding in the same commit, so no document ever has two listeners.

**Interfaces:**
- Produces: `installSharedBindings(doc: Document): () => void`. It returns an uninstaller for tests.

- [ ] **Step 1: Write the failing tests:**
  - copy success sets `aria-label="Copied!"`, `#copy-status` reads `Copied to clipboard`, the idle icon hides and the copied icon shows, and after 1500 ms all four are back;
  - copy failure selects the target's text, and sets `Press Ctrl+C to copy` and `Text selected — press Ctrl+C to copy`;
  - **RF4:** two clicks 500 ms apart → resting state at 1500 ms after the second;
  - `#page-notice-close` removes `#page-notice`;
  - `#flash-banner-close` hides the toast.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Copy the logic from `app.js` with its strings verbatim.
- [ ] **Step 4: Run** the full check. The site page's copy tests still pass.
- [ ] **Step 5: Commit** `refactor: copy, notice and toast close are the client's`

### Task 7: Retire the server add page and `app.js`; docs

**Files:**
- Create: `src/dev/fixtures/add-site/<NN-step>.html`, one per dual-run step, holding the reference `main` snapshot, plus `src/dev/fixtures/add-site/meta.json` with each step's `toast`, `submit`, `fetches` and `focus`. All are generated from `referenceRun` and checked byte-equal before any deletion.
- Modify:
  - `AddSiteParity.test.tsx` compares `candidateRun` with the fixtures, and ends with the every-fixture-read check.
  - Delete `AddSiteReference.test.tsx` and `referenceRun`, since they need `app.js`.
- Delete:
  - `public/app.js`;
  - `src/views/html.ts`, along with `renderAddSite` and `renderErrorPage`;
  - `html.test.ts`'s add-page and error-page tests, moved to the owning layer and listed in the report;
  - the `<script src="/app.js">` in `src/views/shell.ts`;
  - every `app.js` reference in `shell.test.ts`, `clientShell.test.ts` and `src/views/shell.ts` comments.
- Modify `src/styles/tailwind.css`. Rewrite the `public/` comment, and keep or narrow the `public` `@source` so that `public/style.css` builds byte-identical to before this task. Show `cmp` evidence, or explain every difference.
- Modify `CLAUDE.md`:
  - the add page is on React;
  - `/api/sites/new`;
  - there is no `app.js`, and every page needs the bundle;
  - the add-site fixtures;
  - what the server still renders: `layout()`, the rail and the top bar only.

  Correct every sentence that names `app.js`, `renderAddSite`, `renderErrorPage`, `html.ts` or a server-rendered add page. Change `PRODUCT.md` only where it names these.

- [ ] **Step 1: Generate the fixtures and switch the parity test.** Expected: PASS against the files, before anything is deleted.
- [ ] **Step 2: Delete and move.** `grep -rn "app\.js\|renderAddSite\|renderErrorPage\|views/html" src public CLAUDE.md` finds only historical mentions in CLAUDE.md, each one marked retired.
- [ ] **Step 3: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 4: Update the docs.**
- [ ] **Step 5: Commit** `refactor: retire the server add page and app.js; docs`

After Task 7, the controller runs the browser check against `npm run dev:mock`:
- `/sites/new` compared pixel for pixel against a `main` worktree at 1280 and 390px, three ways: at rest, with a static preview (`blog2`), and with a Next.js preview (`next2`, port 3500);
- end-to-end adds of a static site and a Next.js site, each ending on its page with the notice;
- a copy button and the notice's close on a site page.
