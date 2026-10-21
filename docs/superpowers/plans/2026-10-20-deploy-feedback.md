# Deploy Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Deploy, the row and the card show `<tag> requested · applies on the next run` in place of the offer, live and after a reload, until the reconciler's inventory catches up.

**Architecture:**
- Pure helpers in `src/lib/siteResource.ts` derive a pending tag from the local clone's declaration and the inventory entry.
- The routes pass it to the views.
- One renderer in `src/views/html.ts` draws the requested line in the offer's place.
- A server-rendered `<template>` lets `public/app.js` swap it in on success without a second copy of the markup.

**Tech Stack:** TypeScript, Express, server-rendered views, vanilla JS, `node:test` via `tsx --test`, Playwright (controller) for the client check.

**Spec:** `docs/superpowers/specs/2026-10-20-deploy-feedback-design.md`

## Global Constraints

- Edit `src/views/*` and `public/*` **only with the Edit/Write tools**, never sed, heredocs or scripts, test files included.
- Requested line text, exact: `<tag> requested · applies on the next run`. The tag and `requested` are in `font-mono text-[0.8rem] text-stone-50`, and ` · applies on the next run` is in `text-stone-400`. It is a `<p data-requested role="status" tabindex="-1">` with the offer line's position and flex classes (`m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5`), and it has no button.
- The requested line replaces an offer only when the pending tag **equals** the offered tag. A pending tag with no offer to replace renders nothing extra. The pill and every other row line are unchanged.
- `declaredTag` returns null for an undefined declaration, `state: "absent"`, a digest image (contains `@`), or no `:` in the image's last path segment. Otherwise it returns the text after the last `:` of the last segment.
- `pendingTag(entry, declared)` returns `declared` iff it is non-null and differs from both `entry.target` and `entry.version`.
- The template element is `<template data-requested-template>` wrapping `renderRequestedLine("TAG")`, exactly once on every page that renders at least one `data-offer` line, and on no other page.
- The services board and site card offers keep `renderOfferLine` as their single offer renderer.
- Run `npm run typecheck && npm run lint && npm test && npm run build` before each commit; all must pass.

## Review Focus

1. **A pending tag different from the offered one** (a newer tag was published after the request) keeps the offer: the operator can still deploy the newest. Pinned in Task 2.
2. **An unreadable clone** (`readDeclarations` returns null or throws) renders the offer as today on both pages; the page never errors. Pinned in Task 3.
3. **A request for a tag that is already the installed version** is not pending, so no requested line appears, even though the declaration and inventory disagree on target. Pinned in Task 1.
4. **A page with no offer** carries no template, so a page without Deploy gains no dead markup. Pinned in Task 2.
5. **A Deploy that errors after a successful one on another row** must not swap the failing row. The swap happens only on that button's own success. Pinned in Task 4 (the Playwright check, plus a read of the code).

---

### Task 1: Pending-tag helpers

**Files:**
- Modify: `src/lib/siteResource.ts`
- Test: `src/lib/siteResource.test.ts`

**Interfaces:**
- Produces:
  - `export function declaredTag(decl: DeclarationSummary | undefined): string | null`
  - `export function pendingTag(entry: { version?: string; target?: string }, declared: string | null): string | null`

- [ ] **Step 1: Write the failing tests.**
  - `declaredTag` with `{ name:"x", port:3000, state:"present", image }`:

    | image | expected |
    |---|---|
    | `ghcr.io/lycheehome/app:0.3.0` | `"0.3.0"` |
    | `ghcr.io/lycheehome/app` | `null` |
    | `ghcr.io/lycheehome/app@sha256:abc` | `null` |
    | `host:5000/app` | `null` |
    | `host:5000/app:1.2.0` | `"1.2.0"` |

    Also `null` for the first image with `state:"absent"`, and `null` for `undefined`.
  - `pendingTag`:
    - `({target:"0.3.0"}, "0.3.0")` → `null`
    - `({version:"0.3.0"}, "0.3.0")` → `null`
    - `({version:"0.2.0"}, null)` → `null`
    - `({version:"0.2.0", target:"0.2.0"}, "0.3.0")` → `"0.3.0"`
    - `({}, "0.1.0")` → `"0.1.0"`
- [ ] **Step 2: Run** `npx tsx --test src/lib/siteResource.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** per Global Constraints, with doc comments: why the declaration (the app's own commit) is ahead of the inventory, and why a registry port is never read as a tag.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read a requested tag from the declaration before the reconciler sees it`.

---

### Task 2: The requested line in the views

**Files:**
- Modify: `src/views/html.ts`:
  - `renderOfferLine` area (~1331)
  - `renderServiceRow` and `renderServicesPage` (~1632)
  - `firstDeploy` (~968-1001)
  - `renderRepositoryCard` (~1029-1050)
  - `SiteResourceView` (~735)
  - `renderSiteDetail` output
- Test: `src/views/html.test.ts`

**Interfaces:**
- Produces:
  - `function renderRequestedLine(tag: string): string`. Export it so Task 4's template and the tests can use it.
  - `SiteResourceView.requestedTag?: string`.
  - `renderServicesPage(board, now, prunable, domain, lastRuns = {}, group = "service", managed = new Set(), requested: ReadonlyMap<string, string> = new Map())`.

- [ ] **Step 1: Write the failing tests:**
  - `renderRequestedLine("0.3.0")`:
    - contains `data-requested`, `role="status"` and `tabindex="-1"`;
    - its text, with tags stripped and whitespace collapsed, equals `0.3.0 requested · applies on the next run`;
    - contains no `<button`.
  - Board: `offerBoard`-style row with `available:"0.3.0"`, `version:"0.2.0"`, rendered via `renderServicesPage` with `requested: new Map([["<row name>","0.3.0"]])`:
    - contains `data-requested`, and no `data-deploy="` for that row;
    - with the map empty, the offer renders as today;
    - with `requested` mapping to `"0.2.5"` (≠ available), the offer still renders.
  - Site card:
    - `NEXT_SITE` + `resource: {...RESOURCE, result:"awaiting-image", available:"0.1.0", requestedTag:"0.1.0"}` + `status:{kind:"awaiting-image"}`: the repository card has `data-requested` and no `data-deploy`.
    - `RUNNING_RESOURCE` + `available:"0.3.0"` + `requestedTag:"0.3.0"`: the card has `data-requested` and no `data-deploy`.
  - Template:
    - A site page with an offer and a board page with an offer each contain exactly one `data-requested-template`.
    - `renderSiteDetail(STATIC_SITE, OPTS)` contains none, and neither does a board with no offer.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - `renderRequestedLine` per Global Constraints.
  - At each offer call site (board row, the two `firstDeploy` calls, the installed card), render `renderRequestedLine(tag)` instead of `renderOfferLine(...)` when the pending tag for that resource equals the offered tag. On the board that's `requested.get(row.name)`; on the card it's `resource.requestedTag`.
  - Append `<template data-requested-template>${renderRequestedLine("TAG")}</template>` exactly once to the page body when the rendered body contains `data-offer`. Do this in `renderServicesPage` and `renderSiteDetail`. A single helper is fine.
  - Rewrite the comments that describe the offer as the only thing at that spot.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: a requested tag replaces its offer on the board and the site card`.

---

### Task 3: Routes pass the pending tag

**Files:**
- Modify: `src/routes/services.ts`, the board GET (~60-85).
- Modify: `src/routes/sites.ts`, `resolveNextjsSite` (~124-145).
- Test: `src/routes/services.test.ts`, `src/routes/sites.test.ts`. Use the existing helpers in `src/dev/testHelpers.ts` and the fakes; the fakes' `writeDeclarationTag` rewrites the declaration's tag.

**Interfaces:**
- Consumes: `declaredTag`, `pendingTag` (Task 1); `renderServicesPage`'s `requested` parameter and `SiteResourceView.requestedTag` (Task 2).

- [ ] **Step 1: Write the failing tests:**
  - **Board.** Seed or arrange a container entry whose declaration image tag is ahead of the inventory's `target`/`version` and equals its `available`. One way: call the fake `writeDeclarationTag(name, available)` before the GET. Then a GET of the board page containing that row renders `data-requested` for it.
  - **Board, unreadable clone.** With `readDeclarations` throwing or returning null, the same row renders its offer.
  - **Site page.** After `writeDeclarationTag("app-lychee-land", "0.3.0")` (seed: running 0.2.0, 0.3.0 available), `GET /sites/app.lychee.land` renders `data-requested` and no `data-deploy="app-lychee-land"`.
- [ ] **Step 2: Run** `npx tsx --test src/routes/services.test.ts src/routes/sites.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **services.ts:** from the `declarations` it already reads (null-safe), build `requested`: a map from each board row's name to `pendingTag(row, declaredTag(decl))`, keeping only non-null values. Pass it as the new trailing argument.
  - **sites.ts:** in `resolveNextjsSite`, set `requestedTag` on the resource view when `pendingTag(entry ?? {}, declaredTag(declaration))` is non-null.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the board and site page read a pending Deploy from the clone`.

---

### Task 4: In-place swap on success

**Files:**
- Modify: `public/app.js`, the `[data-deploy]` handler (~883-906) and its comment.

**Interfaces:**
- Consumes: the page's `<template data-requested-template>` (Task 2), whose line's first span text starts with `TAG`.

- [ ] **Step 1: Implement.** On `response.ok && body.ok`:
  1. Find `document.querySelector("template[data-requested-template]")`. If it is missing, keep today's success toast and the disabled button, and return.
  2. Otherwise clone `template.content.firstElementChild`.
  3. In its first `span`, replace the literal `TAG` with `button.dataset.deployTag`. Set the text with `textContent`; never insert it as HTML.
  4. Replace `button.closest("[data-offer]")` with the clone.
  5. Call `hideBanner()`, then focus the clone.

  Errors are unchanged: toast, and the button is re-enabled. The comment explains why the line, not a toast, is the feedback, and why the template, not a JS copy, holds the markup.
- [ ] **Step 2: Run** the full check. Expected: PASS. `app.js` has no unit harness; the controller runs the Playwright check after the commit. List in the report the exact behaviours to check: the swap, the focus, no toast, the text, and that the line persists after a reload.
- [ ] **Step 3: Commit** `feat: Deploy swaps its offer for the requested line in place`.

---

### Task 5: Documentation

**Files:**
- Modify: `DESIGN.md`, the offer line entry (grep `offer line`) and the services-board row paragraph if it describes the after-Deploy state.
- Modify: `.impeccable/design.json`, the matching component descriptions.
- Modify: `CLAUDE.md`, the repository-card passage ("Step 4 states, rather than offers, a tag that is already requested…") and the board's offer description. Change only what this work made false.

- [ ] **Step 1:** DESIGN.md gains the requested line. It sits in the offer's position with no control; the tag and `requested` are mono Chalk and the rest is Smoke. On success it is swapped in from a server-rendered template, and the server renders it from the declaration until the reconciler's inventory catches up.
- [ ] **Step 2:** Mirror the change in the sidecar. If any edited DESIGN.md text sits inside a named rule, re-derive `narrative.rules` (strip `**` and backticks; header to next rule header or heading). Either way, run the drift checker in the scratchpad and print `N rules, 0 drift`.
- [ ] **Step 3:** Make the minimal CLAUDE.md edits.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `docs: a Deploy request stays on the page`.
