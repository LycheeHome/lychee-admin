# Add-Site Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The add-site page says only true things about Next.js, and a port conflict reads as one sentence naming its one owner, identical in the field and the preview panel.

**Architecture:**
- A pure `portConflictMessage` in `src/lib/siteValidation.ts` is the only source of port-conflict wording.
- `SiteEnv.reservedPorts` becomes a labelled map, so the validator can name the owner.
- The route sends the client finished sentences.
- The Next.js copy is server-rendered, and `app.js` only toggles which description is visible.

**Tech Stack:** TypeScript, Express, server-rendered views, vanilla JS, `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-21-add-site-copy-design.md`

## Global Constraints

- Edit `src/views/*` and `public/*` **only with the Edit/Write tools**, never sed, heredocs or scripts, test files included.
- `portConflictMessage` sentences, exact:
  - `Port <port> is reserved for <who>.`
  - `Port <port> is already used by <hostname>.`
  - `Port <port> is already claimed by <name> in lychee-resources.`
- The reserved owners, exact: `"Caddy's admin API"` for each of `RESERVED_PORTS`, and `"lychee-admin itself"` for `config.port`. The app's own port wins on a collision.
- The Next.js option, exact: `Next.js — built from its own repository; the reconciler runs it`
- The Next.js description, exact: `Routes to a container the reconciler runs on this port, built from the site's own repository. After you add it, the site's page has the steps to attach and deploy.`
- The original reverse-proxy description text is unchanged.
- The client composes no port-conflict wording: it shows the server's sentence exactly.
- Run `npm run typecheck && npm run lint && npm test && npm run build` before each commit; all must pass.

## Review Focus

1. **The app's own port** (`config.port`, 8787 on lychee; whatever dev:mock uses) must name lychee-admin, not Caddy, in both field and panel. Pinned in Task 1's validator and route tests.
2. **A port typed before switching to Reverse proxy** still shows the sentence when you switch back: `syncPortField` re-runs `validatePortField`. Covered by the controller's Playwright check after Task 2.
3. **Switching the framework back to None** restores the plain-proxy description and its `aria-describedby`. Task 2's Playwright check.
4. **HTML escaping:** a hostname reaches the page inside a JSON `<script>` (`port-owners-data`), and the sentence is set with `textContent`, never `innerHTML`. Task 1 keeps both.
5. **The Attach route's reserved-port refusal** still refuses after the type change (`.has`, not `.includes`). Task 1's route test.

---

### Task 1: One port sentence, one source

**Files:**
- Modify: `src/lib/siteValidation.ts`: the `SiteEnv.reservedPorts` type (~24), `validateAgainstExisting` (~126-160), and the new `PortOwner` type and `portConflictMessage`.
- Modify: `src/routes/sites.ts`: `SITE_ENV` (~42), `computePortOwners` (~52-59), and the Attach route's reserved-port check (~580).
- Modify: `public/app.js`, `validatePortField` (~374-390).
- Test: `src/lib/siteValidation.test.ts`, `src/routes/sites.test.ts`. Update any test or helper (including `src/dev/testHelpers.ts`) that builds a `SiteEnv` with an array.

**Interfaces:**
- Produces:
  - `export type PortOwner = { kind: "reserved"; who: string } | { kind: "site"; hostname: string } | { kind: "declared"; name: string }`
  - `export function portConflictMessage(port: number, owner: PortOwner): string`
  - `SiteEnv.reservedPorts: ReadonlyMap<number, string>`

- [ ] **Step 1: Write the failing tests:**
  - **`portConflictMessage`:**
    - `(2019, {kind:"reserved", who:"Caddy's admin API"})` → `Port 2019 is reserved for Caddy's admin API.`
    - `(4000, {kind:"site", hostname:"api.lychee.land"})` → `Port 4000 is already used by api.lychee.land.`
    - `(3400, {kind:"declared", name:"gone-lychee-land"})` → `Port 3400 is already claimed by gone-lychee-land in lychee-resources.`
  - **`validateAgainstExisting`**, with `reservedPorts: new Map([[2019, "Caddy's admin API"], [8787, "lychee-admin itself"]])`:
    - a proxy on 2019 → error `Port 2019 is reserved for Caddy's admin API.`
    - a proxy on 8787 → error `Port 8787 is reserved for lychee-admin itself.`
    - a port used by an existing proxy site → `Port <port> is already used by <hostname>.`
    - a declared claim → the declared sentence
  - **Route:**
    - `GET /sites/new` embeds `port-owners-data` JSON in which `"2019"` maps to `Port 2019 is reserved for Caddy's admin API.`, and a seeded proxy's port maps to `Port <port> is already used by <hostname>.`
    - The app's own port maps to `… reserved for lychee-admin itself.`
    - The Attach route still refuses a site whose port is reserved.
- [ ] **Step 2: Run** `npx tsx --test src/lib/siteValidation.test.ts src/routes/sites.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - `portConflictMessage` per Global Constraints.
  - The `SiteEnv` type change.
  - `SITE_ENV.reservedPorts` built as a `Map`: each `RESERVED_PORTS` entry → `"Caddy's admin API"`, then `config.port` → `"lychee-admin itself"`.
  - The validator's three port checks return `portConflictMessage(...)`.
  - `computePortOwners` maps each port to the finished sentence. Build it from the same reserved map plus the parsed proxy sites.
  - The Attach check uses `.has`.
  - In `app.js`, `validatePortField` sets `setCustomValidity(owner)` and `portError.textContent = owner`, where `owner` is the map value, now the sentence. Rename the variable to `sentence`.
  - Update the comment above `computePortOwners`.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `fix: a port conflict reads as one sentence naming its one owner`.

---

### Task 2: Next.js copy that matches what happens

**Files:**
- Modify: `src/views/html.ts`, `renderAddSite`: the framework `<option>` (~265) and a new description span after `#type-proxy-description` (~250).
- Modify: `public/app.js`, `syncFrameworkFields` (~362-368).
- Test: `src/views/html.test.ts`

- [ ] **Step 1: Write the failing tests**, using `renderAddSite(SITES, "lychee.land", {}, PATHS)`:
  - The page contains `<option value="nextjs">Next.js — built from its own repository; the reconciler runs it</option>`.
  - The page contains no `docker-compose`.
  - The `#type-proxy-description` text is unchanged.
  - `#type-proxy-description-nextjs` exists (use the file's `tagById`): its classes include `hidden`, and its text is exactly the Next.js description from Global Constraints.
- [ ] **Step 2: Run** `npx tsx --test src/views/html.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - In `renderAddSite`, set the option text and add the hidden span with the same classes as `#type-proxy-description`, plus `hidden`.
  - In `syncFrameworkFields`, when `frameworkField.value === "nextjs"`:
    - show the Next.js description (remove `hidden`);
    - hide the original (add `hidden`);
    - set the reverse-proxy radio's `aria-describedby` to `type-proxy-description-nextjs`.
  - Otherwise do the reverse, restoring `aria-describedby="type-proxy-description"`.
  - Find the radio with `input[name="type"][value="reverse-proxy"]`.
  - The comment names why: the plain-proxy sentence ("won't start… that process") is false for Next.js, where the reconciler runs the container.
- [ ] **Step 4: Run** the full check. Expected: PASS.
- [ ] **Step 5: Commit** `fix: the add-site page describes Next.js as it actually works`.

---

### Task 3: Commit the critique snapshots

**Files:**
- Add: `.impeccable/critique/2026-10-20T22-33-23Z__src-views.md` and `.impeccable/critique/2026-10-21T09-41-09Z__src-views.md`, unchanged.

- [ ] **Step 1:** `git add` both files. Run `git diff --cached --stat`. Expected: exactly those two files.
- [ ] **Step 2: Commit** `chore: keep the 2026-10-20 and 2026-10-21 critique snapshots`.

After Task 3, the controller runs the Playwright check from the spec's Testing section against `npm run dev:mock`.
