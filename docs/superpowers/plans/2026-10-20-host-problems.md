# Host Problems on the Sites List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Caddy, the sites tunnel or a reconciler unit is in a bad state, the sites list says so above its rows — consequence first — and links to the board page; nothing changes when everything is healthy.

**Architecture:** A pure `hostProblems(unitStates, inventory)` in `src/lib/siteDisplay.ts`; `GET /` reads the inventory and one batch of unit states alongside its per-site checks and passes the result to `renderSiteList`, which renders the lines using #95's `statePhrase`; then docs.

**Tech Stack:** TypeScript, Express server-rendered HTML, Node's built-in test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-host-problems-design.md`

## Global Constraints

- Units considered: `caddy.service`, `cloudflared-sites.service`, plus every `kind: "unit"` inventory entry in group `infrastructure` or `reconciler`, deduplicated by unit name.
- Bad = status in `exited`, `restarting`, `paused`, `unhealthy`. `unknown`, `starting`, `running`, or absent → not a problem.
- Consequences, verbatim: infrastructure (incl. the two fixed units) "Every site is unreachable from outside"; `lychee-watch.timer` "Changes wait for the 15-minute full run"; the full-run timer (`findTimerUnit(inventory)`) "The 15-minute full run has stopped"; any other reconciler unit "Deploys may not apply".
- Names: the inventory entry's `name`; fallback `caddy` / `cloudflared-sites` for the fixed units.
- Order: infrastructure before reconciler; within each, fixed units first, then inventory order.
- Line: `<consequence> — ● <name> <statePhrase(word)> · <page> →`; consequence `text-stone-50` sans 0.85rem; `● name phrase` mono `text-red-300`, dot `aria-hidden`; link `text-stone-300` underlined, hover Chalk, `FOCUS_RING`; block `role="status" data-host-problems` with a 1px Hairline rule beneath; nothing rendered when empty.
- Per-site pills unchanged. Any read failing → fewer/no problems, never an error page.
- Edit `src/views/*.ts` only with Edit/Write — never shell, sed or a script.
- Verification: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **Both Caddy and the tunnel down** — two lines, both "Every site is unreachable from outside", Caddy first. → Task 1 test "two infrastructure problems keep fixed order".
2. **An inventory that lists `caddy` itself** (it does: group `infrastructure`) — must not produce a duplicate line. → Task 1 test "an inventory entry for a fixed unit is not counted twice".
3. **A hostile unit or name string** (inventory is host-written) — escaped in the view. → Task 2 test "problem values are escaped".
4. **The list's existing page notice** (`?removed=`) together with problems — both render. → Task 2 test "the removed notice and host problems both render".
5. **The 500 fallback path** (`renderSiteList` with an `error`) — no host-problem block there; the parameter defaults to empty. → Task 2 test "the error render has no host-problem block".

---

### Task 1: `hostProblems`

**Files:**
- Modify: `src/lib/siteDisplay.ts`
- Test: `src/lib/siteDisplay.test.ts`

**Interfaces:**
- Consumes: `UnitState` (`src/lib/unitState.ts`), `ServiceInventory` (`src/lib/serviceInventory.ts`), `findTimerUnit` (`src/lib/serviceBoard.ts`).
- Produces:
  ```ts
  export interface HostProblem { name: string; word: string; consequence: string; page: "infrastructure" | "reconciler"; href: "/infrastructure" | "/reconciler" }
  export function hostProblemUnits(inventory: ServiceInventory | null): string[]   // the unit names to read
  export function hostProblems(unitStates: Record<string, UnitState>, inventory: ServiceInventory | null): HostProblem[]
  ```

- [ ] **Step 1: Write the failing tests**

describe "hostProblems" (build `UnitState`s as `{ status, since: null }`; build an inventory with entries for `lychee-reconcile-timer` (unit `lychee-reconcile.timer`, group reconciler), `lychee-watch-timer` (`lychee-watch.timer`, reconciler), `caddy` (`caddy.service`, infrastructure), `cloudflared-sites` (`cloudflared-sites.service`, infrastructure)):
- "caddy exited is a site-down problem" → `[{ name: "caddy", word: "exited", consequence: "Every site is unreachable from outside", page: "infrastructure", href: "/infrastructure" }]`.
- "the tunnel restarting is its own problem" → name `cloudflared-sites`, word `restarting`.
- "the watcher timer stopped delays changes" → `lychee-watch-timer`, "Changes wait for the 15-minute full run", `/reconciler`.
- "the full-run timer stopped" → `lychee-reconcile-timer`, "The 15-minute full run has stopped".
- "any other reconciler unit" — extra reconciler unit `foo.service` named `foo`, `paused` → "Deploys may not apply".
- "unknown, starting, running and absent are not problems" → `[]`.
- "infrastructure precedes reconciler" — watcher exited and caddy exited → caddy first.
- Review Focus 1, "two infrastructure problems keep fixed order" — both fixed units exited → `[caddy, cloudflared-sites]`.
- Review Focus 2, "an inventory entry for a fixed unit is not counted twice" — caddy exited with the inventory above → exactly one problem.
- "no inventory falls back to the fixed units" — `inventory: null`, caddy exited → name `caddy`; watcher states ignored.
- `hostProblemUnits(null)` → `["caddy.service", "cloudflared-sites.service"]`; with the inventory above → those two plus `lychee-reconcile.timer`, `lychee-watch.timer`, no duplicates.

- [ ] **Step 2: Run to verify they fail** — `npm test 2>&1 | tail -30` → `hostProblems` not exported.

- [ ] **Step 3: Implement** per the Global Constraints. A module-level `const BAD = new Set(["exited","restarting","paused","unhealthy"])` with a comment that it mirrors the bad tone `rowLabels` gives these words. An unavailable inventory (no entries) behaves like `null`.

- [ ] **Step 4: Run to verify they pass** — `npm test 2>&1 | tail -15` → 0 failures; `npm run typecheck && npm run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/siteDisplay.ts src/lib/siteDisplay.test.ts
git commit -m "feat: decide which host units are down and what that means"
```

---

### Task 2: Read the states on `GET /` and render the lines

**Files:**
- Modify: `src/routes/sites.ts` (`GET /` ~198-215), `src/views/html.ts` (`renderSiteList` ~102-185)
- Test: `src/views/html.test.ts`, `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `hostProblems`, `hostProblemUnits`, `HostProblem` (Task 1); `statePhrase` (`src/views/html.ts`, from #95); `readInventory` (`src/lib/serviceInventory.ts`, never throws); `deps.commands.readUnitStates`.
- Produces: `renderSiteList(sites, statuses, domain, error?, nav?, notice?, problems: HostProblem[] = [])`.

- [ ] **Step 1: Write the failing tests**

`html.test.ts`:
- "no problems renders no block" — `renderSiteList(SITES, {}, "lychee.land")` has no `data-host-problems`.
- "a problem renders consequence first, red state words, a link" — one problem (caddy exited) → block has `role="status"`; text order: `Every site is unreachable from outside` before `caddy has stopped`; the consequence's element has no `text-red-` class; `caddy has stopped` is inside `text-red-300`; `href="/infrastructure"`.
- "several problems keep their order" — two problems → two lines in the given order.
- Review Focus 3, "problem values are escaped" — name `<b>x</b>` → `&lt;b&gt;x&lt;/b&gt;`, no raw `<b>`.
- Review Focus 4, "the removed notice and host problems both render" — notice text plus a problem → both present.
- Review Focus 5, "the error render has no host-problem block" — `renderSiteList([], {}, "lychee.land", "boom")` → no `data-host-problems`.

`sites.test.ts` (use `createFakes({ readUnitStates: async () => (...) })` as the existing tests pass overrides):
- "the list shows a stopped Caddy" — `readUnitStates` returns `caddy.service: exited` → `GET /` 200, contains `data-host-problems` and `caddy has stopped`.
- "a failing unit read renders the list without the block" — `readUnitStates` throws → 200, no `data-host-problems`.
- "healthy units render no block" — all `running` → 200, no `data-host-problems`.

- [ ] **Step 2: Run to verify they fail** — `npm test 2>&1 | tail -30`.

- [ ] **Step 3: Implement**

- Route: `const inventory = readInventory(deps.fs);` then run `computeStatuses(...)` and `deps.commands.readUnitStates(hostProblemUnits(inventory)).catch(() => ({}))` with `Promise.all`; pass `hostProblems(states, inventory)` as the new last argument. The error render path passes nothing.
- View: the block per Global Constraints, between the heading row and the rows; `statePhrase(problem.word)`; escape `name`, `consequence` and `page`.

- [ ] **Step 4: Run to verify they pass** — `npm test 2>&1 | tail -15` → 0 failures; `npm run typecheck && npm run lint && npm run build` clean.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sites.ts src/routes/sites.test.ts src/views/html.ts src/views/html.test.ts
git commit -m "feat: the sites list says when Caddy, the tunnel or a reconciler unit is down"
```

---

### Task 3: Docs, then verify

**Files:**
- Modify: `DESIGN.md` (list page composition), `CLAUDE.md` (Core v1 feature flow item 1 and the list status-check paragraph), `.impeccable/design.json` (list/Site Row description, only if it describes page composition)

**Interfaces:**
- Consumes: Tasks 1-2's shipped behaviour (read the code for exact wording).

- [ ] **Step 1: Amend the docs**

- `DESIGN.md`: where the list page is composed, the host-problem lines — when they appear, consequence first in Chalk, `● name phrase` in Scorch, link in Smoke Light, Hairline rule beneath, nothing when healthy, per-site pills unchanged.
- `CLAUDE.md`: in item 1 and the paragraph that says the list status-checks reverse-proxy sites only, add that the list also reads Caddy's, the tunnel's and the reconciler units' state in one unprivileged `systemctl show`, concurrent with the per-site checks, and shows a line when one is down. Nothing else.
- Sidecar: update the matching component description if one describes the list page; no named rule changes.

Run: `node -e 'require("./.impeccable/design.json")'` → parses.

- [ ] **Step 2: Detector and screenshot**

Run: `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` → `[]`.
`PORT=8799 npm run dev:mock` in the background; full-page 1280px screenshot of `/` to `.playwright-mcp/after-host-list.png`. Expected: no host-problem block (the fakes report units running); list otherwise unchanged. Stop the server.

- [ ] **Step 3: Final checks and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build` → all pass.

```bash
git add DESIGN.md CLAUDE.md .impeccable/design.json
git commit -m "docs: host problems on the sites list"
```
