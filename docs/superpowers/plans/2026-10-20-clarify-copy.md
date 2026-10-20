# Clarify Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Services-board rows stop printing the reconciler's raw words and contradicting their pills, and the site page's DNS and Danger sentences say only what the app actually does.

**Architecture:** One pure helper, `troubleGate`, in `src/lib/siteDisplay.ts` decides when a gate sentence shows, branching on `result`. `renderServiceRow` and `gateLine` in `src/views/html.ts` render through it, and the facts line drops the result word. The DNS step string changes in place. `renderDangerZone` takes the two flags the remove dialog already computes.

**Tech Stack:** TypeScript, Express server-rendered views, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-clarify-copy-design.md` (read §2 as amended: the rule branches on `result`)

## Global Constraints

- Edit `src/views/*` and `public/*` **only with the Edit/Write tools**, never sed, heredocs or scripts (the design-detector hook only sees Edit/Write), test files included.
- Never branch on gate text (contract A-GATE-1). Branch on `result` and `gate_code` (through `deployTrouble`) only.
- `troubleGate(entry)` returns `entry.gate` iff `entry.result` is `"blocked"` or `"failed"` and `entry.gate` is a non-empty string; otherwise `null`.
- DNS sentence, exact: `Until it exists, the site can't be reached from the internet even while every check on this page passes: lychee-admin checks lychee itself, never Cloudflare.`
- Danger sentences, exact, in order (2 and 3 conditional):
  1. `Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the sites tunnel.`
  2. *(attached)* `It then retires the site's declaration, which stops its container.`
  3. *(deletableFiles)* `The site's files stay unless you tick the box when you confirm.`
  4. `lychee-admin never touches the DNS record; delete it in Cloudflare afterwards.`
- Run `npm run typecheck && npm run lint && npm test && npm run build` before each commit; all must pass.

## Review Focus

1. **A blocked row whose code is unknown or missing** must still say it's blocked (the `blocked` fact plus its gate). Pinned in Task 2.
2. **The retry-capped gate's recovery command** (`rm …/.failed-tag`) must still render in full. Pinned in Task 2.
3. **A failed row with a gate**, such as lychee-admin's own row with no target, keeps its gate; a failed first deploy with an empty gate shows no empty `data-gate` line. Pinned in Task 2.
4. **The apex site** (`lychee.land`, record name `@`) and the **dashboard-only fallback** (no tunnel ID) both get the new DNS sentence. Pinned in Task 3.
5. **A Next.js site that predates site resources** and has both a declaration and a leftover directory gets both Danger sentences 2 and 3. Pinned in Task 3 (the "both" case).

---

### Task 1: `troubleGate`

**Files:**
- Modify: `src/lib/siteDisplay.ts` (beside `deployTrouble`)
- Test: `src/lib/siteDisplay.test.ts`

**Interfaces:**
- Produces: `export function troubleGate(entry: { result?: string; gateCode?: string; gate?: string }): string | null`

- [ ] **Step 1: Write the failing tests** in `describe("troubleGate", …)`:
  - Returns `"G"` for each of these (each with `gate: "G"`):
    - `{result:"blocked", gateCode:"retry-capped"}`
    - `{result:"blocked", gateCode:"not-applied"}`
    - `{result:"blocked", gateCode:"ci-pending"}`
    - `{result:"blocked", gateCode:"some-new-code"}`
    - `{result:"blocked"}` (no code)
    - `{result:"failed"}`
  - Returns `null` for each of these:
    - `{result:"blocked", gateCode:"ci-failed", gate:""}`
    - `{result:"failed", gate:""}`
    - `{result:"skipped", gateCode:"up-to-date", gate:"pin unchanged (1.4.0)"}`
    - `{result:"deployed", gateCode:"ok", gate:"ok"}`
    - `{result:"awaiting-image", gateCode:"awaiting-image", gate:"no tag yet"}`
    - `{gate:"G"}`
- [ ] **Step 2: Run** `npx tsx --test src/lib/siteDisplay.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement** per Global Constraints. The doc comment states the A-GATE-1 reason and why unclassified blocks keep their gate (a new code must not go silent).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: decide when a reconciler gate sentence is worth showing`.

---

### Task 2: Board rows and the repository card

**Files:**
- Modify: `src/views/html.ts`:
  - `renderServiceRow`: the facts block (~line 1497-1503), the deploy-line span (~1540), the `data-gate` line (~1545).
  - `gateLine` (~929).
- Test: `src/views/html.test.ts`, in the board describe blocks around lines 1600-1910 and the repository-card tests around 2660-2680.

**Interfaces:**
- Consumes: `troubleGate` (Task 1); the existing `deployTrouble`.

- [ ] **Step 1: Update and write the failing tests.** Reuse the file's `offerBoard`, `deployLine` and `factsLine` helpers.
  - For each of these, `factsLine(html)` contains none of `skipped`, `deployed`, `failed`, `awaiting-image`, `blocked`:
    - `{version:"v1.4.0", result:"skipped", gateCode:"up-to-date", gate:"pin unchanged (1.4.0)"}`
    - `{result:"deployed", gateCode:"ok"}`
    - `{result:"awaiting-image", gateCode:"awaiting-image"}`
    - `{version:"v1.4.0", result:"failed", failedAttempts:1}`
    - `{version:"v2.11.4", result:"blocked", gateCode:"ci-failed", gate:"job test concluded: failure"}`
  - The up-to-date row above has no `data-gate`.
  - `{result:"blocked", gateCode:"retry-capped", gate:"v0.2.0 failed 3 times; not retrying (promote another tag, or rm /opt/x/.failed-tag)"}`:
    - `deployLine` equals `● deploy blocked` exactly.
    - The `data-gate` line contains the full gate string.
  - `{result:"blocked", gateCode:"not-applied"}` (no gate): `deployLine` equals `● deploy blocked · not applied`.
  - `{version:"v0.2.0", result:"blocked", gate:"job test concluded: failure"}` (no code):
    - No `data-deploy-state`.
    - `factsLine` includes `blocked`.
    - The `data-gate` line contains the gate.
  - `{version:"v1.4.0", result:"failed", gate:"health check failed after install"}` keeps its `data-gate` line.
  - `{result:"failed", gate:""}` has no `data-gate`.
  - Update existing tests whose expectations this changes, keeping their intent:
    - "the facts line drops the result word when the line shows" (~1754): still true.
    - "a blocked row with no gate code has no line and keeps blocked in its facts" (~1774): still true.
    - The ci-failed row test (~1748) asserts `· CI failed` with no gate given: still true.
    - Any test asserting a raw result word in facts, or a gate on a skipped/deployed row, gets updated to the new rule.
  - Repository card:
    - A running site with `resource: {...RUNNING_RESOURCE, result:"skipped", gateCode:"up-to-date", gate:"pin unchanged (0.2.0)", available:"0.3.0"}` has no `data-gate`.
    - The existing "blocked shows its gate and no failure line" (~2662) still passes.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts`. Expected: the new and changed tests FAIL.
- [ ] **Step 3: Implement:**
  - Facts: push `row.result` only when it is `"blocked"` and `deployTrouble(row)` is null.
  - Deploy line: omit the `· reason` span when `troubleGate(row)` is non-null. Otherwise keep the existing rule, where the reason is omitted when it equals `deploy <word>`.
  - `data-gate`: render `troubleGate(row)`.
  - `gateLine(resource)`: render `troubleGate(resource)`.
  - Update the comments beside each change so they describe the new rule.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: board rows stop printing raw reconciler words`.

---

### Task 3: DNS step and Danger card copy

**Files:**
- Modify: `src/views/html.ts`:
  - `renderManualSteps`: both DNS-step strings (~662, ~678).
  - `renderDangerZone` (~706-716) and its doc comment.
  - Its call in `renderSiteDetail` (~1202).
- Test: `src/views/html.test.ts`

**Interfaces:**
- Produces: `function renderDangerZone(opts: { attached: boolean; deletableFiles: boolean }): string`. `attached` = `attachedName !== null`, `deletableFiles` = `Boolean(filesPath && opts.filesExist)`; both locals already exist in `renderSiteDetail`.

- [ ] **Step 1: Write the failing tests:**
  - The DNS sentence, exact per Global Constraints, appears for:
    - `STATIC_SITE` with `OPTS` (has a tunnel ID)
    - `APEX_SITE`
    - `STATIC_SITE` with `{...OPTS, tunnelId: ""}` (fallback; use whatever value the fallback branch takes, checking `opts.tunnelId` truthiness)
  - None of those pages contains `still reports the site running`.
  - Helper `danger(html)` extracts the Danger card's `<p>`. Then:
    - `STATIC_SITE` with `filesExist: true`: sentences 1, 3 and 4.
    - `PROXY_SITE`: sentences 1 and 4 only.
    - `NEXT_SITE` with `resource: RESOURCE`, no `filesExist`: sentences 1, 2 and 4.
    - `NEXT_SITE` with `resource: RESOURCE, filesExist: true`: 1, 2, 3, 4 in that order.
  - No Danger paragraph contains `unless you ask otherwise`.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with the exact strings. Keep the paragraph's existing classes; join the sentences with single spaces.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `fix: DNS and Danger copy say only what lychee-admin does`.

---

### Task 4: Documentation

**Files:**
- Modify: `DESIGN.md`: the services-board row paragraph (grep `gate string on its own line` and `drops the result word`).
- Modify: `.impeccable/design.json`: the Service Row component description, the same sentences.
- Modify: `CLAUDE.md`: grep `gate string`, `result word`, `its gate string, in full`. Change only sentences this work made false.

**Interfaces:** none.

- [ ] **Step 1:** Update DESIGN.md:
  - The gate string shows, in full on its own line, only for a blocked or failed run.
  - When a deploy line shows with a gate, the line drops its short reason.
  - The facts line carries no result word, except `blocked` on a row whose code this app can't classify.
- [ ] **Step 2:** Mirror those sentences in the sidecar's Service Row description. If any edited DESIGN.md text sits inside a named rule (`**The … Rule.**`), re-derive `narrative.rules` bodies (strip `**` and backticks; header to next rule header or heading) with a scratchpad node script, and print `N rules, 0 drift`.
- [ ] **Step 3:** CLAUDE.md minimal edits.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `docs: board rows and site copy say what the app knows`.
