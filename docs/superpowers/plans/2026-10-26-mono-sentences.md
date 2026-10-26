# Sentences in Sans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explanatory sentences on the board, the site page and the add page become sans with their machine facts in mono, and the read-only offer tag leaves Ember. The frozen fixtures stay byte-for-byte, through a declared substitution table.

**Architecture:** One test-only module, `src/client/test/redesigns.ts`, holds dated substitutions that every parity file applies to frozen fixture text before comparing. A disk-reading test proves each entry still matches a fixture and that no fixture already holds the new markup. The component changes are small class and copy edits in `DeployLines.tsx`, `BoardRows.tsx` and `AddSitePage.tsx`.

**Tech Stack:** TypeScript, React 19, Node test runner via `tsx`, `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-26-mono-sentences-design.md`

## Global Constraints

- A fact inside a sans sentence is `<span class="font-mono text-stone-50">`.
- Offer label: `<span class="text-[0.8rem] text-stone-400"><span class="font-mono text-stone-50">{tag}</span> available</span>`.
- Prune caption: `<span class="text-[0.75rem] leading-snug text-stone-400">Deletes {fact `${name}.yml`} from {fact `lychee-resources`} once its container is confirmed down.</span>`.
- Unknown sentence `<p>`: `BODY`, with the text unchanged.
- Deploy and retiring lines: the `<p>` is `text-[0.8rem] leading-relaxed m-0` (no `font-mono`), and the key span's class is `font-mono ${TONE_TEXT[tone]}`.
- Error boxes: `PREVIEW_ERROR_CLASS` and the add-error class lose `font-mono` only.
- Fixture files under `src/dev/fixtures/` are never edited.
- Edit `src/views` and `src/client` with Edit/Write so the design-detector hook sees the change.

## Review Focus

1. **A substitution matches more than intended** (for example, the deploy-line pattern catching another `<p>`). The parity test would then pass against markup nothing renders. Pinned in Task 1: each entry's match count per fixture equals the number of occurrences of a narrower anchor (`data-deploy-state`, ` available</span>`, `couldn't read`, `id="preview-error"` or `id="add-site-error"`).
2. **An entry goes stale** because a later change stops rendering the old markup. Pinned in Task 1: every entry must match at least one fixture.
3. **Hidden error boxes:** the class swap must apply whether `hidden` leads the class list or not. Pinned in Task 4: an add-site step with the box visible (step 07) and one with it hidden (step 01) both pass parity.
4. **The offer label in the runbook's step 4** (the compact primary), not only on the board. Pinned in Task 2 with a site-page parity case (`preview-awaiting-first-image`).
5. **Wrapping:** the Prune caption must wrap at words without overflowing a 390px notice. This is checked in the browser after Task 3.

---

### Task 1: The substitution table and its guard

**Files:**
- Create: `src/client/test/redesigns.ts`, `src/client/test/redesigns.test.ts`
- Modify: `src/client/pages/BoardParity.test.tsx` (the fixture read, around line 77), `src/client/components/SiteDetailParity.test.tsx` (line 52), `src/client/pages/AddSiteParity.test.tsx` (line 55)
- Modify: `CLAUDE.md` (the Stack paragraph's frozen-fixture sentence: "a frozen reference is retired, never edited or regenerated, when its page is deliberately redesigned")

**Interfaces:**
- Produces:
  - `type Redesign = { id: string; since: string; why: string; from: RegExp; to: string; anchor: string }`
  - `REDESIGNS: Redesign[]`
  - `applyRedesigns(html: string): string`
  - `anchor` is a plain substring each match must contain, used by the guard.

- [ ] **Step 1: Write the failing guard test** `redesigns.test.ts`. It reads every `.html` under `src/dev/fixtures/` (recursively) and checks:
  - `"every redesign matches at least one frozen fixture"`
  - `"no fixture already holds a redesign's new markup"`, which also passes vacuously for an empty table;
  - `"every match contains its anchor, and each anchor occurrence is matched"`: per fixture, the count of `from` matches equals the count of `anchor` occurrences;
  - `"every redesign is dated and explained"`: `since` matches `/^\d{4}-\d{2}-\d{2}$/`, and `why` is non-empty.

  Add a test with a sample entry built inline: `applyRedesigns` applied with that entry rewrites it. Export `applyWith(html, entries)` for this, and have `applyRedesigns(html)` call `applyWith(html, REDESIGNS)`.
- [ ] **Step 2: Run it.**
  Run: `npx tsx --tsconfig tsconfig.test.json --test src/client/test/redesigns.test.ts`
  Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement** `redesigns.ts` with an empty `REDESIGNS`. Wrap the three parity files' fixture reads in `applyRedesigns(...)`. In CLAUDE.md, amend the sentence: a frozen reference is retired, never edited or regenerated, when its page is deliberately redesigned, unless the change is small enough to declare as an entry in `src/client/test/redesigns.ts` (dated, explained, and guarded by `redesigns.test.ts`).
- [ ] **Step 4: Run** the guard and the three parity files.
  Expected: PASS. An empty table changes nothing.
- [ ] **Step 5: Commit** `test: declared substitutions for frozen parity fixtures`.

### Task 2: Board lines (offer label, unknown sentence, deploy and retiring lines)

**Files:**
- Modify: `src/client/components/DeployLines.tsx` (`OfferLine`, line 46)
- Modify: `src/client/components/BoardRows.tsx` (the unknown `<p>`; the trouble line; the retiring line)
- Modify: `src/client/test/redesigns.ts` (three entries)
- Test: `src/client/components/BoardMarkup.test.tsx`, `src/client/components/BoardRetired.test.tsx`, and any live test asserting the old classes (find them with `git grep -n "text-rose-300\|SERVICE_DETAIL" -- 'src/**/*.test.tsx'`)

**Interfaces:**
- Consumes: `applyRedesigns` (Task 1).

- [ ] **Step 1: Write the failing tests** in a new `describe("sentences in sans")` in `BoardMarkup.test.tsx`:
  - The offer label: no `rose` class; the tag is `span.font-mono.text-stone-50`; its parent has `text-stone-400` and no `font-mono`.
  - The unknown `<p>` has class `BODY`.
  - The deploy line `<p data-deploy-state>` has no `font-mono`, and its first span's class is `font-mono ${TONE_TEXT[tone]}`.
  - In `BoardRetired.test.tsx`, the retiring `<p>` has no `font-mono`, and its first span's class is `font-mono ${TONE_TEXT.neutral}`. The existing exact-text assertion is unchanged.
- [ ] **Step 2: Run them.**
  Expected: FAIL on each class.
- [ ] **Step 3: Implement the markup per Global Constraints.** Add the three `REDESIGNS` entries, all dated `2026-10-26`:
  - **`offer-tag`:** `from: /<span class="font-mono text-\[0\.8rem\] text-rose-300">([^<]+) available<\/span>/g`, `to: '<span class="text-[0.8rem] text-stone-400"><span class="font-mono text-stone-50">$1</span> available</span>'`, `anchor: ' available</span>'`.
  - **`unknown-sentence`:** `from: /<p class="font-mono text-\[0\.8rem\] leading-relaxed text-stone-400 break-words m-0">(lychee-admin couldn't read this [^<]+)<\/p>/g`, `to: '<p class="${BODY}">$1</p>'` with `BODY`'s literal value, `anchor: "couldn't read"`.
  - **`deploy-line`:** `from: /<p class="font-mono text-\[0\.8rem\] leading-relaxed m-0" data-deploy-state><span class="([a-z0-9-]+)">/g`, `to: '<p class="text-[0.8rem] leading-relaxed m-0" data-deploy-state><span class="font-mono $1">'`, `anchor: "data-deploy-state"`.

  Update the live tests that pinned the old classes to the new ones, without loosening any.
- [ ] **Step 4: Run** `npm test`.
  Expected: all pass, including every board and site-page parity case and the guard.
- [ ] **Step 5: Commit** `feat: board explanations in sans; the offer tag leaves Ember`.

### Task 3: The Prune caption

**Files:**
- Modify: `src/client/components/DeployLines.tsx` (`PruneLine` caption, around line 118)
- Test: `src/client/components/RetiredNotice.test.tsx`, `src/client/components/BoardRetired.test.tsx`, `src/client/components/BoardMarkup.test.tsx` (any test asserting the old caption)

- [ ] **Step 1: Write the failing test** `"the prune caption is a sans sentence with its facts in mono"` in `BoardRetired.test.tsx`:
  - the caption span's `textContent` is `Deletes gone-lychee-land.yml from lychee-resources once its container is confirmed down.`;
  - its class is `text-[0.75rem] leading-snug text-stone-400`;
  - its mono spans' texts are `["gone-lychee-land.yml", "lychee-resources"]`.
- [ ] **Step 2: Run it.**
  Expected: FAIL.
- [ ] **Step 3: Implement** the caption per Global Constraints, and remove `NBSP` if it becomes unused. Update every test that pinned the old caption text.
- [ ] **Step 4: Run** `npm test`.
  Expected: all pass. Then check the 390px wrap in the browser (Review Focus 5).
- [ ] **Step 5: Commit** `feat: the prune caption is a sentence`.

### Task 4: The add page's error boxes

**Files:**
- Modify: `src/client/pages/AddSitePage.tsx` (`PREVIEW_ERROR_CLASS`, line 31, and the add-error class if separate)
- Modify: `src/client/test/redesigns.ts` (one entry)
- Test: `src/client/components/AddSiteMarkup.test.tsx`

- [ ] **Step 1: Write the failing test** `"the error boxes are sans"`: the `#preview-error` and `#add-site-error` class lists do not contain `font-mono`.
- [ ] **Step 2: Run it.**
  Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Drop `font-mono` from both classes.
  - Add the entry `error-box-sans` (2026-10-26):
    - `from: /font-mono (text-\[0\.8rem\] text-red-300 bg-red-950\/60 border border-red-400\/70 rounded-md px-3 py-2 m-0)/g`
    - `to: '$1'`
    - `anchor: 'text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0'`

    If the anchor rule rejects it (another element sharing those classes), narrow `from` to the two ids and record a ruling.
- [ ] **Step 4: Run** `npm test`.
  Expected: all pass, including the 11 add-site dual-run steps and the guard.
- [ ] **Step 5: Commit** `feat: the add page's error boxes are sans`.

### Task 5: Docs

**Files:** `DESIGN.md`, `.impeccable/design.json`

- [ ] **Step 1: Update `DESIGN.md`:**
  - The offer line: replace "the available version in Ember" with the Chalk mono version, Smoke sans `available`, and Ember on the button only.
  - The prune line's caption description and its quoted text.
  - The deploy line and the retiring line: the key in mono, the reason in sans.
  - The add page's error box: sans.
- [ ] **Step 2: Re-derive** the sidecar rule bodies (`scratchpad/derive_rules.py`).
  Expected: `differs: []`, or the changed bodies rewritten until it is.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm test` and the detector (`impeccable detect --json src/views src/client`).
  Expected: all exit 0, and the detector prints `[]`.
- [ ] **Step 4: Commit** `docs: sentences in sans, the offer tag out of Ember`.
