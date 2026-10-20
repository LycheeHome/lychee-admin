# Button Emphasis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page carries at most one Ember action, always one that will work in the current state: Visit is Primary only while the site is serving, the page's next runbook step takes the Ember, Prune leads on a retired declaration, and Add site is blocked (focusably) by an explicit preview rejection.

**Architecture:** A pure `visitIsForward(status)` in `src/lib/siteDisplay.ts` decides Visit's class. View functions in `src/views/html.ts` gain emphasis parameters (`renderOfferLine`, `renderPruneControl`) so shared renderers stay shared. A new derived constant `BUTTON_PRIMARY_COMPACT` in `src/views/shared.ts`. Add-site blocking is client-side in `public/app.js` with `aria-disabled`.

**Tech Stack:** TypeScript, Express server-rendered HTML, Tailwind v4, vanilla JS, `node:test` via `tsx --test`, Playwright (MCP) for the client check.

**Spec:** `docs/superpowers/specs/2026-10-20-button-emphasis-design.md`

## Global Constraints

- Edit `src/views/*` and `public/*` **only with the Edit/Write tools**, never sed/heredoc/scripts (the design-detector hook only sees Edit|Write). If that can't be guaranteed, run `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` and expect `[]`.
- Visit is `BUTTON_PRIMARY` only when `status` is `undefined` or `describeStatus(status).pill` is `running` or `responding`; otherwise `BUTTON_SECONDARY`. Never removed, never disabled.
- `BUTTON_PRIMARY_COMPACT` = `BUTTON_PRIMARY.replace("text-sm", "text-[0.8rem]").replace("min-h-10 px-4 py-2.5", "min-h-8 px-3 py-1.5")`, mirroring `BUTTON_SECONDARY_COMPACT`.
- `BUTTON_PRIMARY` gains exactly: `aria-disabled:cursor-not-allowed aria-disabled:text-stone-500 aria-disabled:bg-rose-400/40 aria-disabled:hover:bg-rose-400/40`.
- Services board emphasis is unchanged: offers stay `BUTTON_OFFER`, Prune stays `BUTTON_SECONDARY_COMPACT`.
- Attach on a retired declaration stays enabled (no `disabled` attribute).
- A failed preview read (`!response.ok` or a throw) never blocks Add site. The native `disabled` attribute keeps its in-flight job only.
- Run `npm run typecheck && npm run lint && npm test && npm run build` before each commit; all must pass.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Fix-then-Enter inside the debounce:** a rejection is showing, the user corrects the hostname and presses Enter within 250ms. The submit must go through (block cleared on input), not be swallowed. Pinned in Task 4's Playwright step.
2. **Out-of-order preview responses:** an older rejection resolving after a newer `ready` must not re-block. The block may only be set after the existing `sequence !== previewSequence` checks. Pinned in Task 4 (code placement, reviewed) and its Playwright step.
3. **Preview endpoint failing while a rejection was showing:** the block must clear. Pinned in Task 4's Playwright step (route the preview request to a 500).
4. **`running` with no health (pre-HEALTHCHECK image) vs `running · health check starting`:** the first keeps Visit Primary, the second demotes it. Pinned in Task 1's tests.
5. **bfcache restore of `/sites/new`:** a page restored with `aria-disabled` set from a stale rejection must not stay blocked against a valid field. The `pageshow` handler re-runs `refreshPreview()`. Pinned in Task 4 (code) and reviewed.

---

### Task 1: `visitIsForward`

**Files:**
- Modify: `src/lib/siteDisplay.ts` (after `describeStatus`)
- Test: `src/lib/siteDisplay.test.ts`

**Interfaces:**
- Produces: `export function visitIsForward(status: SiteStatus | undefined): boolean`

- [ ] **Step 1: Write the failing tests** in a new `describe("visitIsForward", …)`:

```ts
test("no status (a static site, or no status entry) keeps Visit forward", () => {
  assert.equal(visitIsForward(undefined), true);
});
test("serving states keep Visit forward", () => {
  assert.equal(visitIsForward({ kind: "tcp", responding: true }), true);
  assert.equal(visitIsForward({ kind: "container", state: "running" }), true);
  assert.equal(visitIsForward({ kind: "container", state: "running", health: "healthy" }), true);
});
test("every other state demotes Visit, neutral ones included", () => {
  const demoted: SiteStatus[] = [
    { kind: "failed" }, { kind: "awaiting-image" }, { kind: "tcp", responding: false },
    { kind: "container", state: "running", health: "unhealthy" },
    { kind: "container", state: "running", health: "starting" },
    { kind: "container", state: "exited" }, { kind: "container", state: "restarting" },
    { kind: "container", state: "paused" }, { kind: "container", state: "not-created" },
    { kind: "container", state: "unknown" },
  ];
  for (const s of demoted) assert.equal(visitIsForward(s), false, JSON.stringify(s));
});
```

Import `visitIsForward` and `type SiteStatus` from `./siteDisplay`.

- [ ] **Step 2: Run** `npx tsx --test src/lib/siteDisplay.test.ts` — expected FAIL (`visitIsForward` is not exported).
- [ ] **Step 3: Implement** via `describeStatus(status).pill`, with a doc comment saying a demoted Visit is emphasis only and does not change any tone (The Three-Tone Status Rule).
- [ ] **Step 4: Run** the same command — expected PASS.
- [ ] **Step 5: Commit** `feat: decide when Visit is a site page's forward action`.

---

### Task 2: Compact primary, aria-disabled look, Visit follows state

**Files:**
- Modify: `src/views/shared.ts` (`BUTTON_PRIMARY`; add `BUTTON_PRIMARY_COMPACT` after it, with a doc comment like `BUTTON_SECONDARY_COMPACT`'s)
- Modify: `src/views/html.ts` — `renderDetailHeader` (~line 1140)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `visitIsForward` (Task 1)
- Produces: `export const BUTTON_PRIMARY_COMPACT: string`

- [ ] **Step 1: Write the failing tests** (add `BUTTON_PRIMARY_COMPACT` to the `./shared` import):
  - In `describe("renderSiteDetail header")`, add a helper `visitTag(html)` returning the `<a …>Visit` opening tag (match `/<a [^>]*>Visit /`), then:
    - A static site: `class="${BUTTON_PRIMARY} no-underline shrink-0"`.
    - A proxy site with no status: Primary.
    - `{kind:"tcp",responding:true}`: Primary.
    - `NEXT_SITE` with `RUNNING_RESOURCE` and `{kind:"container",state:"running"}`: Primary.
    - Each of these renders `class="${BUTTON_SECONDARY} no-underline shrink-0"`: `{kind:"tcp",responding:false}`, `{kind:"awaiting-image"}`, `{kind:"container",state:"not-created"}`, `{kind:"container",state:"running",health:"starting"}`, `{kind:"container",state:"unknown"}`, `{kind:"failed"}`.
    - In every case the tag still has `href="https://<hostname>"`, `target="_blank"` and no `disabled`/`aria-disabled`.
  - Update the existing test "offers Visit as the primary action…" only if it now contradicts (a static site stays Primary, so it should still pass).
  - A `describe("BUTTON_PRIMARY_COMPACT")`:
    - Includes `min-h-8`, `px-3`, `py-1.5`, `text-[0.8rem]`, `bg-rose-400`, `text-stone-900`, `hover:bg-rose-300`, `focus-visible:outline-rose-400`.
    - Excludes `min-h-10`, `px-4`, `py-2.5`, `text-sm`.
  - Assert that `BUTTON_PRIMARY.split(" ")` includes each of the four `aria-disabled:` tokens from Global Constraints.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts` — expected FAIL on the new tests.
- [ ] **Step 3: Implement.** `renderDetailHeader` picks `visitIsForward(opts.status) ? BUTTON_PRIMARY : BUTTON_SECONDARY`. Add the aria-disabled tokens to `BUTTON_PRIMARY`. Add `BUTTON_PRIMARY_COMPACT` per Global Constraints.
- [ ] **Step 4: Run** the full check (`npm run typecheck && npm run lint && npm test && npm run build`) — expected PASS.
- [ ] **Step 5: Commit** `feat: Visit leads only while the site is serving`.

---

### Task 3: The next step takes the Ember in the repository card

**Files:**
- Modify: `src/views/html.ts`:
  - `renderOfferLine` (~1308) and its two calls in `firstDeploy` (~984, ~995).
  - `renderPruneControl` (~826) and its doc comment.
  - `attachForm` (~847) and its doc comment.
  - `renderRepositoryCard`'s doc comment (~1010, "keeps Visit as the header's one ember action").
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `BUTTON_PRIMARY_COMPACT` (Task 2)
- Produces: `renderOfferLine(name: string, tag: string, emphasis: "offer" | "primary" = "offer"): string`; `export function renderPruneControl(name: string, emphasis: "secondary" | "primary" = "secondary"): string`

- [ ] **Step 1: Update and write the failing tests:**
  - Line ~2422 ("awaiting image with a tag on offer…"): expect `class="${BUTTON_PRIMARY_COMPACT}" data-deploy="app-lychee-land" data-deploy-tag="0.1.0">Deploy 0.1.0</button>`. Replace the trailing "Visit stays the header's one ember control" assertion with one that the header contains no `bg-rose-400` class token.
  - New: a failed first deploy (`resource: {...RESOURCE, result:"failed", target:"0.1.0", available:"0.1.1"}`, `status:{kind:"failed"}`) offers `Deploy 0.1.1` with `BUTTON_PRIMARY_COMPACT`.
  - New: an installed version with a newer tag (`RUNNING_RESOURCE` plus `available:"0.3.0"`, status running) offers `Deploy 0.3.0` with `BUTTON_OFFER`.
  - Line ~2511 ("detached: the warning carries the Prune control"): expect `renderPruneControl("app-lychee-land", "primary")` and `class="${BUTTON_PRIMARY_COMPACT}"`.
  - New: detached Attach is `<button type="submit" class="${BUTTON_SECONDARY}" aria-describedby="attach-warning">Attach repository</button>`, with no `disabled`.
  - Keep: non-detached Attach is Primary (line ~2372).
  - Line ~1968 ("the prune button is the compact secondary on both surfaces"): rename to say the board and the default are compact secondary; assert that `renderPruneControl("gone-lychee-land")` and the board row use `BUTTON_SECONDARY_COMPACT`, and that `renderPruneControl("gone-lychee-land", "primary")` uses `BUTTON_PRIMARY_COMPACT`.
  - Keep: the board's offer stays `BUTTON_OFFER` (line ~1753).
  - New `describe("one Ember action per site page")`:
    - Helper `emberCount(html)`: count `<a`/`<button` opening tags whose `class` attribute, split on spaces, includes exactly `bg-rose-400`.
    - Assert `<= 1` on `withoutHeader(renderSiteDetail(...))` for: a static site; a proxy responding; a proxy not responding; `NEXT_SITE` unattached `{kind:"container",state:"not-created"}`; detached; awaiting image with `0.1.0` on offer; failed first deploy with `0.1.1` on offer; running with `0.3.0` on offer; `starting`; `unknown`.
    - Assert `=== 0` for: the proxy not responding, `starting`, and `unknown` with no resource.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts` — expected FAIL on the changed and new tests.
- [ ] **Step 3: Implement:**
  - `renderOfferLine`: `emphasis === "primary" ? BUTTON_PRIMARY_COMPACT : BUTTON_OFFER`. Both `firstDeploy` calls pass `"primary"`; `renderRepositoryCard` and the board keep the default.
  - `renderPruneControl`: same pattern with `BUTTON_SECONDARY_COMPACT`.
  - `attachForm`: `detached ? BUTTON_SECONDARY : BUTTON_PRIMARY`, and pass `"primary"` to `renderPruneControl`.
  - Rewrite the three doc comments so they say what is now true: Prune is secondary on the board and Primary under a site page's retired warning; the first-deploy offer is the page's Primary; Attach steps back when retired but stays enabled.
- [ ] **Step 4: Run** the full check — expected PASS.
- [ ] **Step 5: Commit** `feat: the page's next step takes the Ember; Prune leads on a retired declaration`.

---

### Task 4: Add site blocked by an explicit rejection

**Files:**
- Modify: `src/views/html.ts` — the `#preview-error` element (~line 290): add `tabindex="-1"`.
- Modify: `public/app.js` — `refreshPreview` (~535), the field listeners (~587-592), the add-site submit handler (~597), and the `pageshow` handler (~677).
- Test: `src/views/html.test.ts`; Playwright check against the mock server.

**Interfaces:**
- Consumes: the `aria-disabled:` look on `BUTTON_PRIMARY` (Task 2).
- Produces: `setSubmitBlocked(blocked: boolean)` in `app.js`. It sets or removes `aria-disabled="true"` on `#add-site-submit` and adds or removes the `preview-error` token in its `aria-describedby`, preserving any other tokens.

- [ ] **Step 1: Write the failing test:** the `#preview-error` tag (via `tagById(renderAddSite(...), "preview-error")`, using the existing `renderAddSite` call shape in the file) includes `tabindex="-1"` and still `role="status"`.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts` — expected FAIL.
- [ ] **Step 3: Implement:**
  - Add `tabindex="-1"` in `html.ts`.
  - In `app.js`, call `setSubmitBlocked`:
    - `true` only in the `result.error` branch, after both sequence checks.
    - `false` in the `result.ready` and empty-state branches, on `!response.ok` (after the sequence check), and in the `catch`.
  - Add a single `clearSubmitBlock` listener next to each `schedulePreview` registration, or make `schedulePreview` call `setSubmitBlocked(false)` first. The latter is preferred: one place.
  - At the top of the submit handler, after `preventDefault()`: if the button has `aria-disabled="true"`, focus `#preview-error` and return before anything else, so no banner and no fetch.
  - In `pageshow`, when `event.persisted`, also call `refreshPreview()`.
  - Comments explain:
    - A rejection is the server answering "no".
    - A failed read is not an answer, and never blocks.
    - `aria-disabled` keeps the button focusable so the reason can be reached.
- [ ] **Step 4: Run** the full check — expected PASS.
- [ ] **Step 5: Playwright check.**
  - Start `PORT=8799 npm run dev:mock`.
  - Open `/sites/new` in a context with `httpCredentials: {username:"dev",password:"dev"}`. Use context credentials, not an Authorization header, which also gets sent to Google Fonts and breaks them.
  - Record every POST to `/sites`. Expect each of the following:
    1. Fill `#hostname-field` with `api`, wait 700ms: `#add-site-submit` has `aria-disabled="true"`, and its `aria-describedby` includes `preview-error`.
    2. Click the submit: no POST to `/sites`, `document.activeElement.id === "preview-error"`, and `#flash-banner` is not showing.
    3. Fill `api2`, then immediately press Enter (no wait): exactly one POST to `/sites`, and the page navigates to `/sites/api2.lychee.land?created=1`.
    4. Back on `/sites/new`, `page.route("**/sites/preview", r => r.fulfill({status:500}))` after first producing a rejection with `api`. Then type `api3`: `aria-disabled` is absent.
  - Stop the server. Record the four outcomes in the report.
- [ ] **Step 6: Commit** `feat: Add site waits on an explicit preview rejection, focusably`.

---

### Task 5: Documentation

**Files:**
- Modify: `DESIGN.md`:
  - The Primary entry (~605).
  - A new Compact primary entry beside Compact secondary (~628).
  - The Ember Is Interactive Rule (~312).
  - Any sentence calling Prune Secondary.
- Modify: `.impeccable/design.json`:
  - Re-derive `narrative.rules[*].body` from DESIGN.md: strip `**` and backticks; the extract runs from a rule's bolded header to the next rule header or heading.
  - Add a Compact primary component entry shaped like the Compact secondary one.
  - Update the services-board component description's Prune sentence.
- Modify: `CLAUDE.md`:
  - "It sits in this card rather than the page header so Visit stays the header's one ember action."
  - "The UI is a secondary **Prune old declaration** button, no modal, in two places".
  - Any other sentence this change makes false: grep for `ember action`, `secondary **Prune`, and `Visit`.

**Interfaces:** none.

- [ ] **Step 1: DESIGN.md.**
  - Primary: still once per view, and it marks the action that will work now. Visit is Primary only while the site is serving (running, responding, or a static site). A page whose fix is on the host carries no Primary. A Primary blocked by an explicit rejection keeps its disabled look through `aria-disabled` and stays focusable.
  - Compact primary: Primary's colours at the offer's size, derived in `shared.ts`. Used for the runbook's first Deploy and the Prune under a site page's retired warning.
  - Ember rule: add "A control the page expects to be refused never wears it."
- [ ] **Step 2: Sidecar.**
  - Re-derive the rule bodies with a node script in the scratchpad (not in the repo).
  - Then verify zero drift: every `narrative.rules[i].body` equals the transform of its DESIGN.md extract. Print `N rules, 0 drift`.
- [ ] **Step 3: CLAUDE.md** edits as listed, with the meaning-preserving minimum.
- [ ] **Step 4: Run** the full check — expected PASS.
- [ ] **Step 5: Commit** `docs: Ember follows state; Compact primary`.

After Task 5 the controller (not a subagent) runs `/impeccable document` as a **scoped refresh** of the Components section, and commits any change it makes separately.
