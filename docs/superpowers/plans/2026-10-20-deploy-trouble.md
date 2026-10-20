# Deploy Trouble on the Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A services-board row whose deploy needs the operator shows `● deploy blocked · <reason>` (Scorch state words) under its name; a deploy that is only waiting shows the same line in Smoke; the health pill is unchanged.

**Architecture:** Parse the contract's `gate_code` into `gateCode`; a pure `deployTrouble(entry)` in `src/lib/siteDisplay.ts` classifies by `result` and `gateCode`; `renderServiceRow` renders the line and drops the duplicate `result` fact; then docs.

**Tech Stack:** TypeScript, server-rendered HTML, Node's built-in test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-deploy-trouble-design.md`

## Global Constraints

- Classification table, verbatim (spec §2). `result: "failed"` → `{ tone: "bad", word: "failed", reason: "deploy failed" }`. Everything not listed → `null`, including `blocked` with no code.
- Never classify from the `gate` sentence — only `result` and `gateCode` (A-GATE-1).
- No deploy line when `undeployedStatus(row)` is non-null.
- Line markup: `data-deploy-state`; dot `aria-hidden`; `deploy <word>` in `TONE_TEXT[tone]`; `· <reason>` in `text-stone-400`; mono `text-[0.8rem]`; directly under the name.
- A row with the line omits its `result` word from the facts line; nothing else on the row changes; a running host action does not hide the line.
- Edit `src/views/*.ts` only with Edit/Write — never shell, sed or a script.
- Verification: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **A `failed` result with an installed version** (a redeploy that failed while the old version runs) — the spec's reason for `failed` is "deploy failed", the same as the state words, so the line must read `● deploy failed`, not `● deploy failed · deploy failed`. → Task 2 renders `· <reason>` only when the reason differs from `deploy <word>`; test "an installed failed row reads deploy failed once".
2. **`gate_code` present but empty string** (`""`) — treated as no code → `null`. → Task 1 test "an empty gate_code is no code".
3. **A unit row with deploy state** (lychee-admin is a unit-shaped app entry in some inventories) — the rule is by `result`/`gateCode`, not by kind, so units get the line too. → Task 2 test "a unit row with ci-failed shows the line".
4. **An unrecognised `result`** (`unknown`) with a trouble code — `null` (only `blocked`/`failed` produce a line). → Task 1 test "an unknown result never produces a line".
5. **The facts line when `result` is the only fact** — removing it must not leave an empty `<p>`. → Task 2 test "a row whose only fact was the result renders no empty facts line".

---

### Task 1: Read `gate_code` and classify deploy state

**Files:**
- Modify: `src/lib/serviceInventory.ts` (entry type ~line 30-45; parse ~160-170), `src/dev/seed.ts` (inventory entries ~130-210), `src/lib/siteDisplay.ts`
- Test: `src/lib/serviceInventory.test.ts`, `src/lib/siteDisplay.test.ts` (`src/dev/seed.test.ts` already validates the seed)

**Interfaces:**
- Produces: `gateCode?: string` on `InventoryEntry`; `export interface DeployTrouble { tone: "bad" | "neutral"; word: "blocked" | "failed" | "waiting"; reason: string }` and `export function deployTrouble(entry: { result?: string; gateCode?: string }): DeployTrouble | null` in `src/lib/siteDisplay.ts`.

- [ ] **Step 1: Write the failing tests**

`serviceInventory.test.ts`:
- "gate_code is read into gateCode" — entry with `gate_code: "ci-failed"` → `gateCode === "ci-failed"`.
- "a missing or non-string gate_code leaves gateCode absent" — absent field and `gate_code: 3` → `gateCode === undefined`.

`siteDisplay.test.ts`, describe "deployTrouble":
- Table-driven over all 12 rows of the spec's table with `result: "blocked"`: each `gateCode` → the exact `{ tone, word, reason }`.
- `{ result: "failed" }` and `{ result: "failed", gateCode: "ok" }` → `{ tone: "bad", word: "failed", reason: "deploy failed" }`.
- `null` for `blocked` with `ok`, `up-to-date`, `awaiting-image`, `unknown`, `"made-up"`, and no `gateCode`.
- `null` for `{ result: "skipped", gateCode: "up-to-date" }` and `{ result: "deployed", gateCode: "ok" }`.
- Review Focus 2, "an empty gate_code is no code" — `{ result: "blocked", gateCode: "" }` → `null`.
- Review Focus 4, "an unknown result never produces a line" — `{ result: "unknown", gateCode: "ci-failed" }` → `null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -30` → Expected: `deployTrouble` not exported; `gateCode` undefined.

- [ ] **Step 3: Implement**

- `InventoryEntry.gateCode?: string`; parse with `if (typeof raw.gate_code === "string") entry.gateCode = raw.gate_code;` beside `result`.
- `deployTrouble`: a const lookup table keyed by code for the 12 `blocked` rows; `failed` handled first.
- Seed: add `gate_code` to the reconciled entries per spec §1 (`swee` `ci-failed`, `swee-staging` `retry-capped`, `palsave-api` `not-applied`, `lychee-admin`/`lychee-notes`/`app-lychee-land` `up-to-date`, `preview-lychee-land` `awaiting-image`, `broken-lychee-land`/`gone-lychee-land` `ok`). Leave unreconciled entries without it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -15` → 0 failures (including `src/dev/seed.test.ts`'s schema validation). Run: `npm run typecheck && npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/serviceInventory.ts src/lib/serviceInventory.test.ts src/lib/siteDisplay.ts src/lib/siteDisplay.test.ts src/dev/seed.ts
git commit -m "feat: read gate_code and classify deploy trouble from it"
```

---

### Task 2: Render the deploy line on the board

**Files:**
- Modify: `src/views/html.ts` (`renderServiceRow`, facts ~1365-1375 and the name line)
- Test: `src/views/html.test.ts` (board describe; reuse `offerBoard(...)` with overrides as the existing board tests do)

**Interfaces:**
- Consumes: `deployTrouble`, `DeployTrouble`, `gateCode` (Task 1); `undeployedStatus` (existing).

- [ ] **Step 1: Write the failing tests**

- "a ci-failed row shows the deploy line in the bad tone" — `{ version: "v2.11.4", result: "blocked", gateCode: "ci-failed", status: "running" }` → row has `data-deploy-state`; the line contains `deploy blocked` inside an element with `TONE_TEXT.bad` and `· CI failed`; pill still `running`.
- "the facts line drops the result word when the line shows" — same row: facts line (`SERVICE_DETAIL` paragraph after the name/line) contains `v2.11.4` and not `blocked`.
- "a ci-pending row shows the line in the neutral tone" — `gateCode: "ci-pending"` → `deploy waiting` with `TONE_TEXT.neutral`, and no `TONE_TEXT.bad` on the line.
- "an undeployed failed row has no deploy line" — `{ version: "", result: "failed", status: "exited" }` → no `data-deploy-state`.
- "a blocked row with no gate code has no line and keeps blocked in its facts" — `{ version: "v1", result: "blocked", status: "running" }` (no `gateCode`) → no `data-deploy-state`; facts contain `blocked`.
- "a running host action does not hide the deploy line" — unit row with actions, `result: "blocked"`, `gateCode: "retry-capped"`, a running `ActionState` → `data-deploy-state` present with `retry limit reached`.
- Review Focus 1, "an installed failed row reads deploy failed once" — `{ version: "0.1.0", target: "0.2.0", result: "failed", status: "running" }` → the line's text (tags stripped) is exactly `● deploy failed`, with no `· deploy failed` suffix.
- Review Focus 3, "a unit row with ci-failed shows the line" — `kind: "unit"`, `result: "blocked"`, `gateCode: "ci-failed"` → `data-deploy-state`.
- Review Focus 5, "a row whose only fact was the result renders no empty facts line" — `{ result: "blocked", gateCode: "ci-failed" }` with no version, no attempts, no `since` → no empty `SERVICE_DETAIL` paragraph (`<p class="${SERVICE_DETAIL}"></p>` absent).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -30` → Expected: no `data-deploy-state` rendered.

- [ ] **Step 3: Implement**

In `renderServiceRow`:
- `const trouble = row.kind === "container" && undeployedStatus(row) ? null : deployTrouble(row);` — the undeployed check matches Task 1 of the previous plan's container-only rule.
- Push `row.result` into `facts` only when `trouble` is null.
- After the `SERVICE_NAME` paragraph, when `trouble`: `<p class="font-mono text-[0.8rem] leading-relaxed m-0" data-deploy-state><span class="${TONE_TEXT[trouble.tone]}"><span aria-hidden="true">&#9679;</span> deploy ${trouble.word}</span>${reasonPart}</p>`, where `reasonPart` is ` <span class="text-stone-400">· ${escapeHtml(reason)}</span>` unless `reason === \`deploy ${word}\`` (then empty). One comment on why the pill stays health and the deploy gets its own line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -15` → 0 failures. Run: `npm run typecheck && npm run lint && npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "feat: deploy trouble gets its own line on the services board"
```

---

### Task 3: Docs, then verify

**Files:**
- Modify: `DESIGN.md` (Service Row entry), `.impeccable/design.json` (Service Row description), `CLAUDE.md` (services-board description)

**Interfaces:**
- Consumes: Tasks 1-2's shipped behaviour (read the code for exact wording).

- [ ] **Step 1: Amend the docs**

- `DESIGN.md` Service Row: the deploy line (`● deploy <word> · <reason>`), Scorch for trouble and Smoke for waiting, colour on the state words only, decided by `gate_code` (never the sentence), absent on an undeployed row and when the inventory carries no code; the facts line drops the `result` word on such a row. No named rule's prose changes.
- Sidecar: the Service Row description gains the same facts.
- `CLAUDE.md`: one sentence in the services-board description that the board reads `gate_code` (A-GATE-1) to tell deploy trouble from waiting.

Run: `node -e 'require("./.impeccable/design.json")'` → parses.

- [ ] **Step 2: Detector and screenshot**

Run: `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` → `[]`.
`PORT=8799 npm run dev:mock` in the background; full-page 1280px screenshot of `/services` to `.playwright-mcp/after-deploy-services.png`. Expected: `swee`, `swee-staging`, `palsave-api` show red `deploy blocked` lines with their reasons; `broken-lychee-land` has none (its pill is FAILED); settled rows are unchanged. Stop the server.

- [ ] **Step 3: Final checks and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build` → all pass.

```bash
git add DESIGN.md .impeccable/design.json CLAUDE.md
git commit -m "docs: the deploy line on the services board"
```
