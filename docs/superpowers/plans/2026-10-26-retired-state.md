# Retired State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a retired, unpruned declaration visible. It gets a neutral `retired` status word everywhere site status shows, and a notice card with Prune directly under the site page's header.

**Architecture:**
- **Status.** A new `SiteStatus` kind, `retired`, is returned by `resolveNextjsSite` wherever it now returns `detached: true`. Every status reader inherits the new kind.
- **Page.** The page gains a `RetiredNotice` card above the request path. Runbook step 3 keeps a shortened warning without its own Prune.
- **Docs.** DESIGN.md, its sidecar, PRODUCT.md and CLAUDE.md record the new word and component.

**Tech Stack:** Express + TypeScript; React 19 + TanStack Query 5; `node:test` via `tsx`, `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-26-retired-state-design.md`

## Global Constraints

- **Edit/Write only.** Edit `src/views`, `src/client` and every test file with the Edit and Write tools only, never with sed, perl, python or scripts.
- **No fourth tone.** `retired` is `neutral`, so it renders the existing neutral pill and dot classes and nothing new.
- **Exact copy:**
  - pill: `retired`
  - last hop: `retired · not pruned`
  - notice sentence: `` `<name>.yml` is retired (`state: absent`). Attaching a repository is refused until it is pruned. ``
  - step-3 warning: `` Attaching is refused while `<name>.yml` is retired. Prune it above; pressing Attach checks again. ``
  - Machine facts (`<name>.yml`, `state: absent`) are mono runs. The sentences are sans.
- **Prune control.** The notice card uses the existing `PruneLine` with `emphasis="primary"`, unchanged, caption included.
  - Ruling R1: the spec's reworded caption is not used. `PruneLine`'s caption, "· once its container is confirmed down", already states what the route checks without claiming it. It is shared with the board, whose frozen fixtures pin it.
- **Prune appears exactly once on the page.** Visit stays secondary. Attach stays `BUTTON_SECONDARY` while detached.
- **Card order is unchanged:** request path, Manual steps, From a repository, Danger. The notice card sits between the header and the request path.
- **Unchanged:** the services board, Attach, Prune, every endpoint's behaviour, and every frozen fixture except `src/dev/fixtures/detail/gone-detached.html`. That one is retired, never edited or regenerated.
- **Test hygiene:**
  - waits use `{ timeout: 5000 }`;
  - assert absence with `assert.ok(!node)`;
  - never `assert.equal` DOM nodes; use `assert.ok(a === b)` instead;
  - test QueryClients use `mutations: { gcTime: 0 }`;
  - test servers use `listen(0, "127.0.0.1")`;
  - tests must not assume `public/client` exists, because CI runs the tests before the build.
- **Before every commit:** run `npm run typecheck && npm run lint && npm test && npm run build` chained, plus the detector on `src/views src/client`.

## Review Focus

1. **A retired site whose declaration is pruned by hand on GitHub while its page is open.** The next re-read shows `not deployed`, the notice card disappears, and nothing throws. This is pinned in Task 2.
2. **The clone is unreadable (`readDeclarations` returns null) while the inventory still lists the site.** It must not read `retired`, because `detached` can't be known. It stays what `resolveNextjsSite` returns today. This is pinned in Task 1.
3. **A retired site that is also health-checked by the rail.** The rail dot stays neutral, the attention counts don't change, and find shows `retired`, never an alarm. This is pinned in Task 1.
4. **Prune refused (409) from the notice card.** The card and the step-3 warning stay, the toast shows the server's reason, and the button re-enables. This is pinned in Task 2.
5. **Narrow width (390px).** The notice card wraps the sentence and the Prune line without horizontal scroll. This is checked in the browser after Task 3.

---

### Task 1: `retired` as a canonical status

**Files:**
- Modify:
  - `src/lib/siteDisplay.ts`: add the `SiteStatus` kind and a `describeStatus` case.
  - `src/routes/sites.ts`: in `resolveNextjsSite`, return `{ kind: "retired" }` as the status wherever it returns `detached: true`.
  - Every other switch that TypeScript flags as non-exhaustive.
- Test: `src/lib/siteDisplay.test.ts`, `src/routes/sites.test.ts` (or `apiSites.test.ts`), `src/client/components/SiteList*.test.tsx`, `src/client/components/Rail.test.tsx`, `src/client/find.test.ts`

**Interfaces:**
- Produces:
  - `SiteStatus` includes `{ kind: "retired" }`;
  - `describeStatus({ kind: "retired" })` returns `{ pill: "retired", hop: "retired · not pruned", tone: "neutral" }`;
  - `resolveNextjsSite(...)` returns `{ status: { kind: "retired" }, detached: true }` for an absent declaration.

- [ ] **Step 1: Write the failing tests.**
  - `describeStatus` returns the triple above.
  - `resolveNextjsSite`, through `GET /api/sites` on the seeded app:
    - `statuses["gone.lychee.land"]` deep-equals `{ kind: "retired" }`;
    - `statuses["legacy.lychee.land"]` deep-equals `{ kind: "container", state: "not-created" }`.
  - `GET /api/sites/gone.lychee.land`: `status` is `{ kind: "retired" }` and `detached` is `true`.
  - **RF2:** with `readDeclarations` returning `null` and an inventory entry for `gone-lychee-land`, `gone`'s status is not `retired`. It equals what the code returns today; record the value in the test.
  - **List:** the `SiteList` row for `gone` has a pill with text `retired` and the neutral pill classes, and `legacy`'s reads `not deployed`.
  - **RF3, rail:** with health where `gone` is retired, `gone`'s dot class equals `RAIL_DOT.neutral`. Its screen-reader text includes `retired`. `attentionCounts` is unchanged from the same health with `gone` as `not deployed`.
  - **RF3, find:** `gone` appears with label `retired`, and it is not in the attention-first group.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Let TypeScript's exhaustiveness errors (`npm run typecheck`) list every switch to extend. Each new case returns the neutral/`retired` behaviour.
- [ ] **Step 4: Run** the full check. Expected: PASS.
  - If a frozen board, sites, shell or rail fixture now differs, that is a defect: stop and report it. They don't carry `gone`'s status.
  - The `gone-detached` detail fixture may now fail. Leave it failing only if its own test is the one failing, and record that. Task 2 retires it.
- [ ] **Step 5: Commit** `feat: retired is a canonical, neutral site status`

### Task 2: The retired notice card on the site page

**Files:**
- Modify:
  - `src/client/components/SiteDetail.tsx`: render `<RetiredNotice>` between the header and the request path when `payload.detached`.
  - `src/client/components/RepositoryCard.tsx`: the step-3 warning becomes the shortened copy, and its `PruneLine` goes. `#attach-warning` and Attach's `aria-describedby` stay.
- Create: `src/client/components/RetiredNotice.tsx`
- Retire: `src/dev/fixtures/detail/gone-detached.html`, plus its cases in `SiteDetailParity.test.tsx` and `SiteDetailMarkup.test.tsx`. The every-fixture-read checks must still pass. Update the comment in `BoardMarkup.test.tsx` around line 584 that names it.
- Test: `src/client/components/RetiredNotice.test.tsx` (or a `describe` in `SiteDetailRules.test.tsx`), plus `src/client/siteWrites.test.tsx` for the prune flows.

**Interfaces:**
- Consumes: `PruneLine` (`src/client/components/DeployLines.tsx`), the page's `SiteWrites`, and the card class constants used by the page's other cards (`src/views/shared.ts` or `siteDetailModel.ts`).
- Produces: `RetiredNotice({ name, writes }: { name: string; writes?: SiteWrites })`. It is a `<section>` with the card treatment at detail width, holding the sentence `<p>` and `<PruneLine name={name} emphasis="primary" controls={writes} />`.

- [ ] **Step 1: Write the failing tests.**
  - **Position:** on `gone.lychee.land`, the notice section's `compareDocumentPosition` puts it after the header's `h2` and before the request-path section.
  - **Copy:** the notice text equals the exact sentence. `gone-lychee-land.yml` and `state: absent` are mono runs.
  - **One Prune:** exactly one `[data-prune]` on the page, with `BUTTON_PRIMARY_COMPACT`. Visit's class is the secondary one.
  - **Step 3:**
    - `#attach-warning` has the exact shortened copy;
    - Attach's `aria-describedby` contains `attach-warning`;
    - step 3 contains no `[data-prune]`.
  - **Absent on non-retired sites:** `legacy`, `app` and `lychee.land` render no notice section.
  - **Success:** after a 200 prune and a re-read showing the site no longer detached, there is no notice, no `#attach-warning`, and focus is on the repository card heading.
  - **RF4:** a 409 prune leaves the card and the warning, the toast shows `gone-lychee-land.yml was not pruned: <reason>`, and the button re-enables.
  - **RF1:** a poll re-read that returns `detached: false` with status `not deployed` removes the card without a throw.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Retire the fixture and its parity cases in the same commit. Add a one-line comment in each parity file naming the superseding spec.
- [ ] **Step 4: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 5: Commit** `feat: a retired site's notice and Prune sit under its header`

### Task 3: Record the word and the component

**Files:**
- Modify:
  - `DESIGN.md`:
    - in the Three-Tone Status Rule, add `retired` to the neutral list, with the reason that being deliberately taken down is not a failure;
    - in the Smoke Light colour entry, add `retired` to the words it carries;
    - add a "Retired notice" component entry: a page-level state notice holding one action, in the card treatment, under the header, with Prune as compact primary;
    - in the Repository Card ordering text, note that order is unchanged for retired sites.
  - `.impeccable/design.json`: re-derive `narrative.rules` bodies from the amended prose with CLAUDE.md's transform. Strip `**bold**` and backticks. Each body runs from a rule's bolded header to the next rule header or heading.
  - `PRODUCT.md`: add `retired` to the canonical status vocabulary.
  - `CLAUDE.md`:
    - the status vocabulary sentence;
    - the retired-site page description (the notice card, and step 3's shortened warning);
    - the fixtures paragraph (`gone-detached` was retired by this redesign).

- [ ] **Step 1: Edit** with the Edit tool only.
- [ ] **Step 2: Verify the sidecar.** Run a one-off check that every `narrative.rules` body equals the transform of its DESIGN.md rule. Expected: equal for all rules. Delete the check afterwards, or keep it as a test only if one already exists.
- [ ] **Step 3: Run** the full check and the detector. Expected: PASS, `[]`.
- [ ] **Step 4: Commit** `docs: retired joins the status vocabulary; the retired notice`

After Task 3, the controller runs the browser check against `npm run dev:mock`:
- `/` and `/sites/gone.lychee.land` at 1280 and 390px, compared with the artifact's 01 and 03 mocks;
- the narrow-width wrapping (RF5);
- an end-to-end Prune of `gone`;
- running `/impeccable document` as a scoped refresh if DESIGN.md's component list needs re-deriving.
