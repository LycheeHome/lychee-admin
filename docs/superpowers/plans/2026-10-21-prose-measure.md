# Prose Measure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Smoke sentence is capped at 25rem (about 70 characters), so no Body line runs past about 75 characters on any page, while mono content keeps its full width.

**Architecture:** One constant, `PROSE_MEASURE`, in `src/views/shared.ts`, composed into the Smoke text constants and every inline Smoke paragraph in `src/views/html.ts`. A render-wide test guards against regressions.

**Tech Stack:** TypeScript server-rendered views, Tailwind v4, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-21-prose-measure-design.md`

## Global Constraints

- Edit `src/views/*` **only with the Edit/Write tools**, never sed, heredocs or scripts, test files included.
- `PROSE_MEASURE` is exactly `"max-w-[25rem]"`.
- A Smoke paragraph is a `<p>` whose class attribute contains both `text-stone-400` and `text-[0.8rem]` and does not contain `font-mono`. Every one carries `max-w-[25rem]`.
- Never cap these: mono paragraphs; flex rows holding spans or controls (offer, requested, prune lines); code and command blocks; the request-path chain.
- The Danger paragraph's `max-w-[70ch]` is removed, not kept beside the new cap.
- Run `npm run typecheck && npm run lint && npm test && npm run build` before each commit; all must pass.

## Review Focus

1. **A Smoke paragraph built from a constant other than `BODY`/`STEP_TEXT`**, such as the board's failure line, still gets the cap. The guard test renders the board with a failed row. Task 1.
2. **Tailwind's source scan** must actually compile `max-w-[25rem]`. A class built only by string concatenation that the scanner can't see would silently do nothing. Check the built `public/style.css`. Task 1.
3. **Paragraphs inside flex rows** stay uncapped, so the offer and prune lines keep their layout. The guard's selector excludes them by construction; a render check confirms it. Task 1.
4. **The add-site preview's empty-state line**, in a 380px panel, is unaffected visually, because the cap is wider than the panel. Task 1, via the guard.
5. **DESIGN.md's Body entry** stops claiming "near 70ch", and the sidecar has no stale copy of it. Task 2.

---

### Task 1: The measure, applied and guarded

**Files:**
- Modify: `src/views/shared.ts`: add `PROSE_MEASURE` near the other width constants (`DETAIL_WIDTH` and `FRAME_WIDTH`), with the spec's comment.
- Modify: `src/views/html.ts`:
  - `STEP_TEXT` (~581) and `BODY` (~776).
  - The inline Smoke paragraphs at ~304 (add-site preview empty state), ~636 (`then.note`), ~696 ("Nothing on this page does these for you.") and ~723 (Danger, replacing `max-w-[70ch]`).
  - Any other Smoke paragraph the guard finds, such as the board's failure line or a class constant defined elsewhere.
- Test: `src/views/html.test.ts`

**Interfaces:**
- Produces: `export const PROSE_MEASURE = "max-w-[25rem]"`.

- [ ] **Step 1: Write the failing tests** in a new `describe("Smoke sentences hold a readable measure")`:
  - `PROSE_MEASURE === "max-w-[25rem]"`.
  - A helper `uncappedSmoke(html)` returns every `<p …>` opening tag whose class contains `text-stone-400` and `text-[0.8rem]`, does not contain `font-mono`, and does not contain `max-w-[25rem]`.
  - Assert `uncappedSmoke` is `[]` for each of the following, using the file's existing fixtures and helpers:
    - `renderSiteDetail(STATIC_SITE, OPTS)`
    - `PROXY_SITE` with `{kind:"tcp",responding:false}`
    - `NEXT_SITE` with `{kind:"container",state:"not-created"}` (unattached: full runbook)
    - `NEXT_SITE` awaiting image with `0.1.0` on offer
    - `NEXT_SITE` failed first deploy (`result:"failed"`, `target:"0.1.0"`, `available:"0.1.1"`, `failedStep` set)
    - `NEXT_SITE` running with `0.3.0` on offer
    - `NEXT_SITE` detached
    - a services board containing a failed row with `failedStep`
    - `renderAddSite(...)` in the shape the file already uses
  - Assert the Danger paragraph does not contain `max-w-[70ch]`.
  - Assert the offer line's `<p … data-offer>` tag does not contain `max-w-[25rem]`.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Import `PROSE_MEASURE` into `html.ts`. Compose it into `BODY` and `STEP_TEXT`. For each inline Smoke paragraph, use `BODY`/`STEP_TEXT` when the classes are otherwise identical; otherwise add `${PROSE_MEASURE}`. Remove `max-w-[70ch]`. Fix any other paragraph the guard reports.
- [ ] **Step 4: Run** the full check. Expected: PASS. Then run `grep -c 'max-w-\\\[25rem\\\]' public/style.css`. Expected: at least 1, meaning Tailwind compiled the class.
- [ ] **Step 5: Commit** `feat: Smoke sentences hold a readable measure`.

---

### Task 2: DESIGN.md and the sidecar

**Files:**
- Modify: `DESIGN.md`, the **Body** typography entry (grep `near 70ch`).
- Modify: `.impeccable/design.json`, any typography or Body text repeating the 760px/70ch claim.

- [ ] **Step 1:** Replace "Longer prose sits inside cards no wider than 760px, which keeps it near 70ch." with a sentence saying three things: every Body sentence is capped at 25rem, about 70 characters at 0.8rem; the card keeps its 760px width, with mono content beside it at full width; the cap is in rem because a `ch` is a zero's width, so `70ch` holds about 95 Nunito letters. Keep the entry's other sentences.
- [ ] **Step 2:** Mirror the change in the sidecar if it repeats the claim. If the edited text sits inside a named rule, re-derive `narrative.rules`. Either way, run `node /private/tmp/claude-501/-Users-byroncustodio-WebstormProjects-personal-lychee-admin/3bb9e893-41c3-45b7-b23a-0dc61c16f174/scratchpad/review5.mjs` from the repo root. Expected: `16 rules, 0 drift`.
- [ ] **Step 3: Run** the full check. Expected: PASS.
- [ ] **Step 4: Commit** `docs: Body states its real measure`.

After Task 2, the controller re-runs the line-length measurement against `npm run dev:mock` (spec §Testing). Every non-mono paragraph of 60 or more characters must measure 75 characters per line or fewer.
