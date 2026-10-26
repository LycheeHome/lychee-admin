# Retired on the Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A services-board row whose site declaration is `state: absent` reads `retired` with Prune once its container is confirmed down, and keeps its live pill with a `retiring` line and no Prune until then.

**Architecture:** One node-free rule, `confirmedDown(entry, declaration)` in `src/lib/siteResource.ts`, used by both the prune route and `loadBoardPage`. The board payload splits retired site declarations into `prunable` (confirmed down) and a new `retiring`. The row's decision is `retiredRow` in `src/views/boardRowModel.ts`, and `ServiceRow` renders from it.

**Tech Stack:** TypeScript, Express, React 19, TanStack Query, Node test runner via `tsx`, `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-26-board-retired-design.md`

## Global Constraints

- The retiring line's text is exactly `retiring · Prune follows once the reconciler confirms the container down`, with the dot and `retiring` in `TONE_TEXT.neutral` and the reason in `text-stone-400`.
- The confirmed-down pill is exactly `retired`, in `TONE_PILL.neutral`.
- The prune route's refusals keep today's status, body and audit entry: `409`, `{ ok: false, reason: CONFIRM_DOWN_REASON }`, one `prune-declaration-refused`.
- The writer keeps `requireTagless: entry.result === "awaiting-image"`.
- No change to the site page, the rail, find or health.
- Frozen fixtures are retired, never edited or regenerated.
- Edit files under `src/views` and `src/client` with Edit/Write, not shell commands, so the design-detector hook sees them.

## Review Focus

1. **A down that failed** (no version, `result: failed`): the row is `retiring`, keeping its `failed` Scorch pill with the retiring line and no Prune. It must not read `retired`. Pinned in Task 1 (`confirmedDown`) and Task 3 (row).
2. **Confirmed down but an odd live status** (`exited`, `unknown`): the pill is still `retired`. Pinned in Task 3.
3. **A retired declaration with no inventory entry yet:** it goes to `retiring`; the board has no row for it, and nothing throws. Pinned in Task 2.
4. **`awaiting-image` with a declaration that is tagged in the local clone:** the route answers the 409 without calling the writer. Pinned in Task 1.
5. **A non-site absent declaration** (`palsave-api`): it is in neither set, and its row is unchanged. Pinned in Task 2 and Task 3.

---

### Task 1: `imageTag`, `confirmedDown`, and the route uses them

**Files:**
- Modify: `src/lib/siteResource.ts` (around `declaredTag`, line 79)
- Modify: `src/routes/services.ts` (the prune route's entry check, around line 262)
- Test: `src/lib/siteResource.test.ts`, `src/routes/services.test.ts` (`describe("POST /resources/:name/prune")`)

**Interfaces:**
- Produces:
  - `imageTag(image: string): string | null`
  - `confirmedDown(entry: ContainerEntry | undefined, declaration: DeclarationSummary | undefined): boolean` (`ContainerEntry` from `./serviceInventory`, imported as a type)

- [ ] **Step 1: Write the failing tests** in `siteResource.test.ts`:
  - `describe("imageTag")`: the same cases `declaredTag`'s tests use, without a declaration: `"ghcr.io/lycheehome/app:0.3.0"` → `"0.3.0"`; `"host:5000/app:1.2.0"` → `"1.2.0"`; `"ghcr.io/lycheehome/app"`, `"host:5000/app"`, `"ghcr.io/lycheehome/app:"` and `"ghcr.io/lycheehome/app@sha256:abc"` → `null`.
  - `describe("confirmedDown")`, with `entry(over)` = `{ name: "gone-lychee-land", kind: "container", container: "gone-lychee-land", group: "service", reconciled: true, ...over }` and `decl(image)` = `{ name: "gone-lychee-land", port: 3400, state: "absent", image }`:
    - `deployed`, no version → `true`;
    - `awaiting-image` with a tagless image → `true`;
    - `awaiting-image` with `":0.1.0"` → `false`;
    - `awaiting-image` with no declaration → `false`;
    - `version: "0.1.0"` with `deployed` → `false`;
    - `result: "failed"` → `false` (Review Focus 1);
    - no `result` → `false`;
    - `undefined` entry → `false`.
  - The route (Review Focus 4): `"awaiting-image with a declaration tagged in the clone is the 409 and never reaches the writer"`. It uses `readDeclarations` answering `[{ ...DECL[0], image: "ghcr.io/lycheehome/x:0.1.0" }]` and inventory `[{ ...DOWN, result: "awaiting-image" }]`, then asserts `409`, the body `{ ok: false, reason: CONFIRM_REASON }`, and `calls.length === 0`.

- [ ] **Step 2: Run them to watch them fail**
  Run: `npx tsx --tsconfig tsconfig.test.json --test src/lib/siteResource.test.ts src/routes/services.test.ts`
  Expected: FAIL. `imageTag` and `confirmedDown` are not exported, and the route test gets `200` (the writer is called).

- [ ] **Step 3: Implement.**
  - `imageTag` holds `declaredTag`'s parsing; `declaredTag` keeps its `!decl || decl.state === "absent"` guard and returns `imageTag(decl.image)`.
  - `confirmedDown` follows the spec's rule exactly.
  - In the route, replace the inline `!entry || entry.version || …` condition with `!confirmedDown(entry, declarations.find((d) => d.name === name))`. `entry` must be narrowed to a container entry: one whose `kind` is not `"container"` is `undefined` for the rule. Keep `requireTagless: entry.result === "awaiting-image"`.

- [ ] **Step 4: Run the tests to see them pass**
  Run: the command in Step 2.
  Expected: PASS, including every existing prune test, unchanged.

- [ ] **Step 5: Commit**
  `git commit -m "feat: one rule for a retired container confirmed down"` (siteResource and services, with their tests).

### Task 2: The board sorts retired declarations into `prunable` and `retiring`

**Files:**
- Modify: `src/routes/services.ts` (`BoardPage` type around line 34, `loadBoardPage` around line 97, the `/api/services` payload around line 145)
- Modify: `src/shared/board.ts` (`BoardPayload`: add `retiring: string[]` after `prunable`)
- Modify: `src/client/api.ts` (line 67: map `retiring: body.retiring`)
- Test: `src/routes/services.test.ts`

**Interfaces:**
- Consumes: `confirmedDown` (Task 1).
- Produces: `BoardPage.retiring: Set<string>` and `BoardPayload.retiring: string[]`. `prunable` now means "absent site declaration, confirmed down".

- [ ] **Step 1: Write the failing tests**
  - Extend `"the payload carries prunable, managed, domain, requested and lastRuns"`, renaming it to `"… prunable, retiring, managed, …"`:
    - add `{ name: "up-lychee-land", kind: "container", container: "up-lychee-land", group: "service", reconciled: true, version: "0.2.1", result: "deployed" }` to the inventory;
    - add absent declarations for `up-lychee-land`, for `ghost-lychee-land` (no inventory entry, Review Focus 3) and for `palsave-api` (Review Focus 5) to `readDeclarations`;
    - assert `body.prunable` is `["gone-lychee-land"]` and `body.retiring.sort()` is `["ghost-lychee-land", "up-lychee-land"]`.
  - New: `"an unreadable clone gives both sets empty"`. `readDeclarations` answers `null`; assert `prunable` and `retiring` are both `[]`.
  - Update the cache test's detach assertion. The just-detached `test-lychee-land` has no inventory entry, so it is now `retiring`: assert `(await board()).retiring` is `["test-lychee-land"]` and `prunable` is `[]`, with the message `"detach: the retired declaration is retiring until the reconciler confirms it down"`. Add `retiring: string[]` to that test's `Board` type.

- [ ] **Step 2: Run them to watch them fail**
  Run: `npx tsx --tsconfig tsconfig.test.json --test src/routes/services.test.ts`
  Expected: FAIL. `retiring` is undefined, and `up-lychee-land` and `ghost-lychee-land` are in `prunable`.

- [ ] **Step 3: Implement.** In `loadBoardPage`, for each declaration with `state === "absent"` and `isSiteName(name, config.domain)`, find its container entry in `inventory.entries` and push the name into `prunable` if `confirmedDown(entry, d)`, otherwise into `retiring`. Return both, and serialize both in the payload. Update `src/client/components/BoardMarkup.test.tsx`'s payload builder (around line 53) and any other `BoardPayload` literal that typecheck flags, adding `retiring: []`.

- [ ] **Step 4: Run the tests and typecheck to see them pass**
  Run: `npx tsx --tsconfig tsconfig.test.json --test src/routes/services.test.ts && npm run typecheck`
  Expected: PASS, typecheck exit 0.

- [ ] **Step 5: Commit**
  `git commit -m "feat: the board sorts retired declarations into prunable and retiring"`.

### Task 3: The row: `retired` once down, a retiring line until then

**Files:**
- Modify: `src/views/boardRowModel.ts` (beside `showsPrune`, line 103)
- Modify: `src/client/components/BoardRows.tsx` (`RowContext`, `ServiceRow`, and the ctx built around line 170)
- Create: `src/client/components/BoardRetired.test.tsx`
- Modify: `src/client/pages/BoardParity.test.tsx` (the `prunable-and-links` case, around line 174)
- Delete (`git rm`): `src/dev/fixtures/board/service-prunable-and-links.html`, `reconciler-prunable-and-links.html`, `infrastructure-prunable-and-links.html`

**Interfaces:**
- Consumes: `BoardPayload.retiring` (Task 2).
- Produces: `retiredRow(name: string, prunable: ReadonlySet<string>, retiring: ReadonlySet<string>, domain: string): "down" | "retiring" | null`, and `RowContext.retiring: ReadonlySet<string>`. `showsPrune` is kept; it is now true exactly when `retiredRow(...) === "down"`.

- [ ] **Step 1: Write the failing tests** in `BoardRetired.test.tsx`. They render `Board` from a `BoardPayload` built the way `BoardMarkup.test.tsx` builds one, with group `service`.
  - `"confirmed down: the pill is retired, neutral, with Prune and no retiring line"`. The row is `gone-lychee-land`, `result: "deployed"`, `status: "not-created"`, in `prunable`. Assert that the row's `[data-row-pill] span` has class `TONE_PILL.neutral` and text `● retired`, that `[data-prune="gone-lychee-land"]` exists, and that there is no `[data-retiring]`.
  - `"confirmed down with an exited or unknown live status still reads retired"` (Review Focus 2): the same row with `status: "exited"`, then `"unknown"`.
  - `"retiring: the live pill, the exact line, no Prune"`. The row has `version: "0.2.1"`, `result: "deployed"`, `status: "running"`, and is in `retiring`. Assert:
    - the pill text is `● running` with `TONE_PILL.ok`;
    - `[data-retiring]`'s `textContent` is `"● retiring · Prune follows once the reconciler confirms the container down"`;
    - its first span has `TONE_TEXT.neutral`;
    - there is no `[data-prune]`;
    - `[data-retiring]` follows the facts line in document order.
  - `"a down that failed is retiring under its failed pill"` (Review Focus 1). `version` is empty, `result: "failed"`, `target: "0.1.0"`, `status: "exited"`, in `retiring`. The pill is `● failed` with `TONE_PILL.bad`, `[data-retiring]` is present, and there is no `[data-prune]`.
  - `"a non-site name in either set gets neither treatment"` (Review Focus 5). `palsave-api` is in `prunable` and in `retiring`; it has no `[data-retiring]`, no `[data-prune]`, and its pill is unchanged from a payload where it is in neither set.
  - `"site names are linked only while managed"`. This moves out of the retired parity case: `app-lychee-land` with `managed: ["app.lychee.land"]` has `a[href="/sites/app.lychee.land"]`, and `other-lychee-land` has no link.
  - In `BoardParity.test.tsx`, replace the `prunable-and-links` case with a comment saying its fixtures were retired on 2026-10-26, when `retired` on the board redesigned that case, and that `BoardRetired.test.tsx` holds the new markup. Then `git rm` the three fixture files. The every-fixture-read check must still pass.

- [ ] **Step 2: Run them to watch them fail**
  Run: `npx tsx --tsconfig tsconfig.test.json --test src/client/components/BoardRetired.test.tsx src/client/pages/BoardParity.test.tsx`
  Expected: the down cases FAIL (the pill is `not deployed`) and the retiring cases FAIL (no `[data-retiring]`). The links test and the parity file pass.

- [ ] **Step 3: Implement.**
  - `retiredRow` returns `null` unless `isSiteName(name, domain)`, then `"down"` for `prunable` and `"retiring"` for `retiring`.
  - In `ServiceRow`, when `retiredRow` gives `"down"`, the pill's `labels` are `{ pill: "retired", tone: "neutral" }`.
  - When it gives `"retiring"`, render after the facts line:
    `<p className="font-mono text-[0.8rem] leading-relaxed m-0" data-retiring=""><span className={TONE_TEXT.neutral}><Dot />{" retiring"}</span>{" "}<span className="text-stone-400">· Prune follows once the reconciler confirms the container down</span></p>`
    The dot and word are one text node after the `Dot`, as the trouble line writes them.
  - Prune renders only for `"down"`.
  - Add `retiring: new Set(payload.retiring)` where the ctx is built.

- [ ] **Step 4: Run the tests to see them pass**
  Run: `npm test > /tmp/x 2>&1; tail -5 /tmp/x`, then the detector: `<impeccable-skill-dir>/scripts/impeccable detect --json src/views src/client`
  Expected: all pass, and the detector prints `[]`.

- [ ] **Step 5: Commit**
  `git commit -m "feat: a retired board row reads retired once down, retiring until then"`.

### Task 4: Docs

**Files:** `CLAUDE.md`, `DESIGN.md`, `.impeccable/design.json`, `PRODUCT.md`

- [ ] **Step 1: Update the prose.**
  - **`CLAUDE.md`:**
    - In Reverse-proxy sites, the Prune bullet's board clause ("on a services-board row whose site declaration is `absent`") becomes a row whose site declaration is `absent` and whose container the reconciler has confirmed down (`confirmedDown`, `src/lib/siteResource.ts`, the rule the route checks too). Until then the row keeps its live pill under a `retiring` line, with no Prune.
    - Add `retired` to the board vocabulary sentence in Core v1 feature flow.
    - In the Stack paragraph's fixtures sentence, note that the board's `*-prunable-and-links` fixtures were retired on 2026-10-26.
  - **`DESIGN.md`:** next to the deploy-trouble line's entry, add a `retiring` line entry with the exact text, and add `retired` on a board row whose container is confirmed down.
  - **`PRODUCT.md`:** the board paragraph's Prune sentence.
- [ ] **Step 2: Re-derive the sidecar if any rule's prose changed.** Run the derivation script (rule header to the next rule header or heading, `**` and backticks stripped, whitespace joined) and compare it with `.impeccable/design.json`.
  Expected: no rule differs, or the changed bodies are rewritten.
- [ ] **Step 3: Run the full check**
  Run: `npm run typecheck && npm run lint && npm test`
  Expected: all exit 0.
- [ ] **Step 4: Commit**
  `git commit -m "docs: retired and retiring on the services board"`.
