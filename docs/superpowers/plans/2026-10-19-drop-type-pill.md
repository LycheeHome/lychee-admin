# Drop the Site Type Pill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `static` / `proxy` type pill from the site list and the site detail header, so the list's only red-family pills are real failures.

**Architecture:** Server-rendered string changes in `src/views/html.ts` (`renderSiteList`, `renderDetailHeader`) and deletion of three class constants; then `DESIGN.md`, its sidecar and one `CLAUDE.md` sentence stop describing the pill.

**Tech Stack:** TypeScript, Express server-rendered HTML, Tailwind v4 classes, Node's built-in test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-drop-type-pill-design.md`

## Global Constraints

- No type pill anywhere: no rendered `>static<` / `>proxy<` pill span, and no `rose-950` on the site list.
- A row's accessible text: proxy `"<host>, <address>, <status>"`; static `"<host>, <address>"` — no `, ,`, no trailing comma.
- `STATUS_SLOT` becomes `flex justify-end`; the element keeps `data-status-slot`.
- A site with no status renders no pill row in the detail header (no empty `mt-3` container).
- Delete `TYPE_PILL_STATIC`, `TYPE_PILL_PROXY` (`src/views/shared.ts`) and `TYPE_PILL_BASE` (`src/views/html.ts`) with their imports.
- Out of scope: add-site's checked reverse-proxy option, flash banner / page notice, status pill colours.
- Edit `src/views/*.ts` only with the Edit/Write tools, never via shell, sed or a script (the design-detector hook only sees Edit/Write).
- Verification commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **The apex static site** (`lychee.land`, no dimmed suffix) — its row and header must also lose the pill and read `"lychee.land, /var/www/lychee.land"`. → Task 1, test "the apex row reads host then address".
2. **A proxy site whose status could not be read** (no status entry → no pill) — row reads `"<host>, <address>"` with no trailing comma, and the header renders no pill row. → Task 1, test "a proxy row with no status ends after its address".
3. **A Next.js row** — the framework still shows after the middot in the address line, which is now the only type cue. → Task 1, existing "a framework proxy row still names its framework" must keep passing; no new test.
4. **The `?created=1` page notice** on a new static site — still renders above a header that now has no pill row. → Task 1, test "a created static site's notice still renders with no pill row".
5. **The hostname switcher** — unaffected, and still free of `bg-rose-950`. → existing "marks the current row…" test keeps passing; rename only.

---

### Task 1: Remove the type pill from the views

**Files:**
- Modify: `src/views/html.ts` — imports (~30-31), `TYPE_PILL_BASE` (~72-74), `STATUS_SLOT` + comment (~76-89), `SPOKEN_COMMA` comment (~91-100), `renderSiteList` row (~135-150), `renderDetailHeader` (~1019-1024)
- Modify: `src/views/shared.ts:53-54`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no exported symbols; `TYPE_PILL_STATIC` and `TYPE_PILL_PROXY` stop existing (Task 2 documents their absence).

- [ ] **Step 1: Rewrite the pill tests and add the new ones**

In `src/views/html.test.ts`, drop `TYPE_PILL_PROXY` from the `./shared` import (L6) and:

- "a static site gets a type pill and no state pill" (~218) → rename "a static site's header has no pills"; assert `doesNotMatch(html, />static</)`, `doesNotMatch(html, /data-state-pill/)`, and that the header has no pill row: `doesNotMatch(html, /<div class="flex items-center gap-2 mt-3/)`.
- New, in the same describe: "a proxy site's header shows its status pill and no type pill" — `renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } })`; assert `/data-state-pill>[\s\S]*not responding/` and `doesNotMatch(html, />proxy</)`.
- "a status-less row still reserves the status column so the pills align" (~1061) and "the reserved status column starts at the sm floor, not below it" (~1075) → replace both with "every row keeps a right-aligned status slot": static and proxy rows both match `/data-status-slot/`, the slot's class is exactly `flex justify-end` (match `/class="flex justify-end" data-status-slot/`), and neither row matches `/min-w-\[9rem\]/`. Delete the comments above them that explain the reservation.
- "both pills share one right-hand group…" (~1083) → rename "the right half holds the status pill alone"; assert `side` matches `/data-status-slot/` and does not match `/>proxy<|>static<|rose-950/`.
- "a proxy row's four facts are separated…" (~1116) → rename "a proxy row's three facts are separated rather than run together"; expect `"api.lychee.land, localhost:4000, responding"`. Update the comment above (~1112) to the three-fact example.
- "a status-less row ends after its type…" (~1124) → rename "a static row ends after its address, with no trailing separator"; expect `"blog.lychee.land, /var/www/blog.lychee.land"`.
- New (Review Focus 1), "the apex row reads host then address": `rowFor(renderSiteList([APEX_SITE], {}, "lychee.land"), "lychee.land")` → `accessibleName` equals `"lychee.land, /var/www/lychee.land"`.
- New (Review Focus 2), "a proxy row with no status ends after its address": `renderSiteList([PROXY_SITE], {}, "lychee.land")` → `"api.lychee.land, localhost:4000"`; and `renderSiteDetail(PROXY_SITE, OPTS)` (no status) has no `data-state-pill` and no pill row.
- New (Review Focus 4), "a created static site's notice still renders with no pill row": `renderSiteDetail(STATIC_SITE, { ...OPTS, created: true })` matches `/id="page-notice"/` and has no pill row.
- New, "the list carries no type pill and no ember fill": render `renderSiteList(SITES, { [PROXY_SITE.hostname]: { kind: "tcp", responding: false } }, "lychee.land")`; assert no `/>static<\/span>|>proxy<\/span>/` and no `/rose-950/`.
- "marks the current row without the proxy pill's ember fill" (~296) → rename "marks the current row without an ember fill"; assertion unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -40`
Expected: the rewritten and new tests fail (pills and the 9rem slot still render; accessible names still include the type word).

- [ ] **Step 3: Implement**

- `renderSiteList`: delete the type-pill span and the `SPOKEN_COMMA` that opens `data-row-side` (the comma that separated address from type); the comma inside the status slot, before the status pill, stays and now separates address from status.
- `STATUS_SLOT = "flex justify-end"`; replace its comment with one line saying the slot right-aligns the status pill so the column lines up, and a static row leaves it empty.
- `SPOKEN_COMMA` comment: example becomes `"api.lychee.land localhost:4000 not responding"`.
- `renderDetailHeader`: delete the type-pill span; render the `flex items-center gap-2 mt-3 flex-wrap` container only when `labels` is set.
- Delete `TYPE_PILL_BASE` and its comment; delete `TYPE_PILL_STATIC`, `TYPE_PILL_PROXY` from `shared.ts` and from `html.ts`'s import.
- Leave any `SITE_ROW` / row comment that mentions the type pill accurate (update wording if it names it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -15` → Expected: 0 failures.
Run: `npm run typecheck && npm run lint && npm run build` → Expected: clean.
Run: `grep -rn "TYPE_PILL" src/` → Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/shared.ts src/views/html.test.ts
git commit -m "feat: drop the site type pill from the list and the detail header"
```

---

### Task 2: Stop the docs describing the pill, then verify

**Files:**
- Modify: `DESIGN.md` — Ember Light / Ember Deep / Hairline / Hairline Strong role entries (~262-290), The Ember Is Interactive Rule (~327-332), the list-row paragraph (~469-475), small-label list (~564), Site row behaviour (~677-684), Pills (~720-725), header nav note (~748-751)
- Modify: `.impeccable/design.json` — the Ember Is Interactive Rule's `narrative.rules` body; the "Site Row" component description (~315)
- Modify: `CLAUDE.md:121` — the nav sentence

**Interfaces:**
- Consumes: Task 1's shipped behaviour (read `src/views/html.ts`, not this plan, for exact wording).
- Produces: nothing code-facing.

- [ ] **Step 1: Amend `DESIGN.md`**

Per the spec's "Design system" section:
- Ember Is Interactive Rule: remove "— plus the one label that means 'something else runs here' (the `proxy` pill)".
- Ember Light: "Ember's hover state on filled buttons." Ember Deep: drop "the `proxy` pill". Hairline: drop "the fill of the `static` type pill". Hairline Strong: drop "the `static` pill's edge".
- Pills: replace the type-pill bullet with one sentence: there is no type pill — the type is already in each row's address and in the detail page's last hop, and a coloured type label competed with the status pills beside it.
- List-row paragraph and Site row behaviour: the right half is the status pill alone, right-aligned; delete the 9rem reservation and its rationale.
- Small-label list and header nav note: drop the type-pill mentions ("— deliberately not the `proxy` pill's Ember fill, so a nav item and a type pill never look alike" goes).
- Then: `grep -n "type pill\|proxy\` pill\|static\` pill" DESIGN.md` → Expected: no output.

- [ ] **Step 2: Re-derive the sidecar**

Set the Ember Is Interactive Rule's `narrative.rules[*].body` to the amended prose (from its bolded header to the next rule header or heading) with `**bold**` and backticks stripped; rewrite the "Site Row" description to match the amended Site row behaviour (status pill alone on the right, no reserved column, no type pill). Change nothing else.

Run: `node -e 'const d=require("./.impeccable/design.json"); const r=d.narrative.rules.find(r=>/Ember Is Interactive/.test(r.name)); console.log(r.body); console.log(/proxy|\*\*|`/.test(r.body))'`
Expected: the new body, then `false`.

- [ ] **Step 3: Amend `CLAUDE.md:121`**

Remove "— deliberately not the `proxy` pill's ember fill, so a nav item and a type pill never look alike" from the nav sentence; nothing else in the file.

- [ ] **Step 4: Detector and screenshots**

Run: `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` → Expected: `[]`.
Start `PORT=8799 npm run dev:mock` in the background; full-page screenshots at 1280px of `/`, `/sites/api.lychee.land`, `/sites/blog.lychee.land` to `.playwright-mcp/after-pill-<name>.png`. Expected: the list's only red-family pills are `api` (not responding) and `broken` (failed); api's header shows only its status pill; blog's header has no pill row. Stop the server.

- [ ] **Step 5: Final checks and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build` → Expected: all pass.

```bash
git add DESIGN.md .impeccable/design.json CLAUDE.md
git commit -m "docs: no type pill in DESIGN.md, its sidecar and CLAUDE.md"
```
