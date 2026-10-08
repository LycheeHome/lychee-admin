# Prune Retired Declarations — lyly-admin Plan (2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A retired, confirmed-down site declaration can be pruned from the site page's detached warning or from the services board, in one guarded write.

**Architecture:** A new writer `pruneSiteDeclaration` on the existing serialized git path; a route that checks the inventory for a confirmed down before calling it; one shared button rendered on two surfaces; a dev seed for the retired state.

**Tech Stack:** TypeScript, Express 4, server-rendered HTML, vanilla JS, `node:test` via `tsx`. Verify with `npm run typecheck && npm run lint && npm test && npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-08-prune-retired-declarations-design.md`
**Depends on:** plan 1 (`2026-10-08-prune-reconciler.md`) merged first is preferred, not required.

## Global Constraints

- Site names only: `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-lyly-dev`.
- Writer deletes only a file whose **parsed** `state` is `absent`, checked **after** its fresh pull; never forces; resets to `@{upstream}` on failure; commit message `<name>: prune retired declaration`.
- Route `POST /resources/:name/prune`: `404` no such declaration; `409` not confirmed down (inventory `version` non-empty, or `result` not in {`deployed`, `awaiting-image`}, or no inventory entry) or writer reports not absent; `502` other refused write; `200` `{ ok: true }`. Whole async body in try/catch. Log `prune-declaration` / `prune-declaration-failed`.
- 409 reason text: "the container hasn't been confirmed down yet; try after the next reconcile".
- Button label **Prune old declaration**, secondary style, no modal; shown only when the declaration is `absent`.

## Review Focus

1. **Inventory missing the entry entirely** (reconciler never ran for it, or inventory unreadable) — must be `409`, never a prune. *(Task 2)*
2. **Declaration flipped back to running between page load and click** (re-attached in another tab) — writer's post-pull parsed check refuses; route answers `409`. *(Tasks 1–2)*
3. **Clone unreadable (`readDeclarations` → null)** — no button anywhere; route answers `502` rather than `404`. *(Tasks 2–3)*
4. **Double click** — second request finds the file gone after the first's push: `404`, not `502`. *(Task 2)*
5. **A non-site absent declaration on the board** (hand-retired `palsave-api`) — no button. *(Task 3)*

---

### Task 1: Writer `pruneSiteDeclaration`

**Files:** Modify `src/lib/declarationWriter.ts`, `src/lib/declarationWriter.test.ts`, `src/lib/systemCommands.ts`, `src/dev/fakes.ts`

**Interfaces:**
- Produces: `pruneSiteDeclaration(name: string, opts: WriterOptions): Promise<WriteResult>` where a refusal for "not absent" carries `code: "not-absent"` and "no such file" carries `code: "missing"`; `SystemCommands.pruneSiteDeclaration(name): Promise<WriteResult>`; fakes delete from the in-memory declarations map under the same rules.

- [ ] **Step 1: Failing tests** (existing fake-git harness): absent file → deleted, one commit with the exact message, pushed; `state: running` → `{ok:false, code:"not-absent"}`, nothing committed; quoted/commented `state: "absent" # retired` → allowed (parsed check); non-site name → refused before any git call; missing file → `code: "missing"`; rejected push → reset to upstream and the file is back; deletes exactly one file (other declarations untouched).
- [ ] **Step 2: Run** `npx tsx --test src/lib/declarationWriter.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** on `withClone`; use the module's existing parsed-YAML helper for the state check; `git rm -- <file>` then commit/push via the shared plumbing.
- [ ] **Step 4: Run** full verify — Expected: PASS.
- [ ] **Step 5: Commit** `feat: prune a retired site declaration`

---

### Task 2: Route `POST /resources/:name/prune`

**Files:** Modify `src/routes/services.ts`, `src/routes/services.test.ts`; `src/lib/logger.ts` if actions are a union.

**Interfaces:**
- Consumes: `readInventory(deps.fs)`, `deps.commands.readDeclarations()` (null = unreadable), `deps.commands.pruneSiteDeclaration`.

- [ ] **Step 1: Failing tests:** confirmed down (inventory `{result:"deployed", version: undefined}`, declaration absent) → 200, writer called with the name; `{result:"awaiting-image"}` → 200; `version` set → 409 with the exact reason, writer not called; no inventory entry → 409; declarations `null` → 502; no declaration → 404; writer `code:"not-absent"` → 409; writer `code:"missing"` → 404; other refusal → 502; non-site name → 404 without reading anything else.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** beside the deploy route, same try/catch and logging pattern.
- [ ] **Step 4: Run** full verify — Expected: PASS.
- [ ] **Step 5: Commit** `feat: add the prune route`

---

### Task 3: The button on both surfaces, seed, docs

**Files:** Modify `src/views/html.ts` (`attachForm` detached warning ~line 721; `renderServiceRow` ~line 1173), `src/views/html.test.ts`, `src/routes/services.ts` (pass which rows are absent site declarations), `public/app.js`, `src/dev/seed.ts`, `.claude/skills/comparing-design-variants/SKILL.md`, `CLAUDE.md`, `DESIGN.md` (+ sidecar only if rule text changes).

**Interfaces:**
- Produces: `renderPruneControl(name: string): string` — one markup for both surfaces, a `data-prune="<name>"` secondary button labelled **Prune old declaration**; app.js binds `[data-prune]` → POST `/resources/<name>/prune`, disables while in flight, shows the reason via the existing banner (`textContent`), reloads on 200.

- [ ] **Step 1: Failing tests:** detached site page renders the control (and no longer says only "prune it before re-attaching"); attached/awaiting/running pages render none; board row whose site declaration is absent renders it; a non-site absent row (`palsave-api`) and every non-absent row render none; clone unreadable → no control on either surface.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** via `impeccable:impeccable` (scoped); the detached copy becomes: the old declaration is retired, prune it to re-attach, plus the control. Run `node <skill-dir>/scripts/detect.mjs --json src/views`. Add a retired, confirmed-down seed site (e.g. `gone.lyly.dev`, port 3400, declaration `state: absent`, inventory `{result:"deployed"}` with nothing installed) and list it in the skill's seed list. CLAUDE.md: remove-site passage and Reverse-proxy sites say Prune exists, its guards, and that the reconciler then cleans the directories and the account.
- [ ] **Step 4: Run** full verify + detector; check both surfaces in `npm run dev:mock` (check port 8787 first; stop only your own server by PID).
- [ ] **Step 5: Commit** `feat: offer Prune on retired site declarations`

---

## End to end on lychee (operator; after both plans are live)

Remove test.lyly.dev in the app → wait for the down (board shows it retired) → Prune → within a tick or two: `/etc/lychee-resources/test-lyly-dev` and `/var/lib/lychee-resources/test-lyly-dev` gone; `drift.json` empty; board row gone; `getent passwd test-lyly-dev` and `getent group test-lyly-dev` empty; journal shows the clean scan before `userdel`. Then re-add and attach to confirm a fresh account. Delete the test.lyly.dev DNS record afterwards if not re-adding.
