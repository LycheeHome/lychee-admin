# Failing-Site Diagnosis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failing site's detail page shows, directly under its request-path chain, one "What to check" entry per red hop with the command to run; finished runbook steps fold; an attached site's DNS card moves below its repository card.

**Architecture:** All rendering is server-side string building in `src/views/html.ts`. A new pure `hopFixes(site, opts)` derives the entries from data `renderSiteDetail` already receives; `renderRequestPath` renders them; `firstDeploy` stops rendering its own copy of the failure; `renderRepositoryCard` wraps done steps in native `<details>`; `renderSiteDetail` reorders cards for an attached site. Then `DESIGN.md` and its sidecar record the two rule changes.

**Tech Stack:** TypeScript, Express server-rendered HTML, Tailwind v4 classes, Node's built-in test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-19-failing-site-diagnosis-design.md`

## Global Constraints

- No client-side JS changes; the fold is a native `<details>`, and `public/app.js` is not touched.
- No new host reads: every entry is built from `SiteDetailOptions` as it is today.
- Edit `src/views/*.ts` with the Edit/Write tools, never through a shell command (the design-detector hook only sees Edit/Write).
- Commands, verbatim: `journalctl -u cloudflared-sites -n 50`, `journalctl -u caddy -n 50`, `journalctl -u lychee-reconcile`, `docker compose -p <resource> logs`, `ss -ltn 'sport = :<port>'`.
- Command element ids: `cmd-fix-tunnel`, `cmd-fix-caddy`, `cmd-reconcile-log`, `cmd-logs`, `cmd-fix-listen`. No id may appear twice on a page.
- Entry order is request order: tunnel, caddy, your app. Hop one (Cloudflare DNS) never gets an entry.
- "Bad" means `describeStatus(...).tone === "bad"` for the last hop and `rowLabels(status).tone === "bad"` for a unit; `starting` and `unknown` are neutral and get no entry.
- Mono for machine facts, sans for sentences; status colour (`text-red-300`) goes on the hop key, never on prose.
- Verification commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **Status says failed, resource result doesn't** (the route's `failed` status and the inventory's `result` disagree after a race): the app entry must still render a failure sentence and the journal command, never an empty entry. → Task 1, test "a failed status renders the journal even when the resource's result has moved on".
2. **A failed step carrying HTML characters**, now rendered in a new place: it must stay escaped under the chain. → Task 1, test "the failed step stays escaped under the chain".
3. **No `unitStates` at all** (the route's unit read is optional): no tunnel or Caddy entry, and no crash. → Task 1, test "no unit states means no unit entries".
4. **A static site with Caddy down**: unit entries apply to every site type, not only proxies. → Task 1, test "a static site gets the Caddy entry".
5. **A detached Next.js site** (retired declaration, `detached: true`, no `resource`): keeps today's card order, because it is not attached. → Task 2, test "a detached site keeps Manual steps before the repository card".

---

### Task 1: "What to check" under the chain, one home per failure

**Files:**
- Modify: `src/views/html.ts` — `renderRequestPath` (~384-483), `failureLine` (~834), `firstDeploy` (~856-886)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: existing `describeStatus`, `rowLabels`, `failureLine(resource, extraClass, commandId)`, `commandBlock(id, value, label)`, `mono`, `BODY`, `HOP_LABEL`.
- Produces (module-private, used only in this file):
  ```ts
  interface HopFix { hop: "tunnel" | "caddy" | "your app"; body: string }
  function hopFixes(site: Site, opts: SiteDetailOptions): HopFix[]
  ```

- [ ] **Step 1: Add a test helper and write the failing tests**

Add near the other helpers:
```ts
function requestPath(html: string): string {
  const [, after] = html.split(">Request path</h3>");
  assert.ok(after, "expected a Request path card");
  return after.split("</section>")[0];
}
function whatToCheck(html: string): string {
  const [, after] = requestPath(html).split(">What to check<");
  assert.ok(after, "expected a What to check block");
  return after;
}
```

New `describe("what to check under the chain", …)` with these tests (use `NEXT_SITE`, `PROXY_SITE`, `STATIC_SITE`, `OPTS`, and the runbook block's `BASE`/`RESOURCE`; hoist those two to module scope if needed):

- "a failed first deploy: the reason and the journal sit under the chain" — `NEXT_SITE`, `{ ...BASE, resource: { ...RESOURCE, result: "failed", target: "0.1.0", available: "0.1.1", failedStep: "Start the container: exit 1" }, status: { kind: "failed" } }`. Assert `whatToCheck` matches `/your app/`, `/Deploying <span[^>]*>0\.1\.0<\/span> failed at this step:/`, `/Start the container: exit 1/`, `/id="cmd-reconcile-log"/`, `/journalctl -u lychee-reconcile/`.
- "a plain proxy not responding gets a listen check" — `PROXY_SITE`, `status: { kind: "tcp", responding: false }`. Assert `/id="cmd-fix-listen"/`, `/ss -ltn 'sport = :4000'/` (`escapeHtml` leaves apostrophes alone), `/localhost:4000/`.
- "a stopped Caddy gets its journal" — `PROXY_SITE`, `status: { kind: "tcp", responding: true }`, `unitStates: { "caddy.service": { status: "exited", since: null }, "cloudflared-sites.service": { status: "running", since: null } }`. Assert `/id="cmd-fix-caddy"/`, `/journalctl -u caddy -n 50/`, `doesNotMatch /cmd-fix-tunnel/`.
- "entries run in request order" — `PROXY_SITE`, `status: { kind: "tcp", responding: false }`, both units `exited`. Assert `indexOf("cmd-fix-tunnel") < indexOf("cmd-fix-caddy") < indexOf("cmd-fix-listen")` within `whatToCheck`, and `/journalctl -u cloudflared-sites -n 50/`.
- "an exited container keeps its logs command, now in the list" — `NEXT_SITE`, `resource: RUNNING_RESOURCE`, `status: { kind: "container", state: "exited" }`. Assert `whatToCheck` matches `/id="cmd-logs"/` and `/docker compose -p app-lychee-land logs/`.
- "a healthy site and neutral units render no block" — `PROXY_SITE`, `status: { kind: "tcp", responding: true }`, units `running` and `unknown`; also `NEXT_SITE` with `status: { kind: "awaiting-image" }`, `resource: RESOURCE`. Assert `requestPath(html)` does not match `/What to check/`.
- Review Focus 1, "a failed status renders the journal even when the resource's result has moved on" — `status: { kind: "failed" }`, `resource: { ...RESOURCE, result: "awaiting-image", target: "0.1.0" }`. Assert `whatToCheck` matches `/journalctl -u lychee-reconcile/` and `/failed/`.
- Review Focus 2, "the failed step stays escaped under the chain" — `failedStep: "Pull the image: <manifest> unknown"`. Assert `whatToCheck` includes `Pull the image: &lt;manifest&gt; unknown` and not `<manifest>`.
- Review Focus 3, "no unit states means no unit entries" — `PROXY_SITE`, `status: { kind: "tcp", responding: false }`, no `unitStates`. Assert `whatToCheck` has `cmd-fix-listen` and neither `cmd-fix-caddy` nor `cmd-fix-tunnel`.
- Review Focus 4, "a static site gets the Caddy entry" — `STATIC_SITE`, `unitStates` with Caddy `exited`. Assert `/journalctl -u caddy -n 50/` in `whatToCheck`.

Update existing tests that pinned the old home of the failure (search `data-deploy-failed` inside the "From a repository" `card(...)` assertions, ~2124-2210):
- "a failed first deploy: the Deploy step names the tag…" → rename "…: the Deploy step points up and offers nothing"; assert `card` does **not** match `/data-deploy-failed/` or `/journalctl/`, does match `/the reason is under the request path/`, still `doesNotMatch /data-deploy=/` and the pill assertion.
- "a failed deploy with no failed step still names the tag and the journal" → assert the same against `whatToCheck(html)` instead of `card`.
- "a failed first deploy with a newer tag: the failure line, then the offer" → `card` matches `/the reason is under the request path/` and the offer (`0\.1\.1 available`, `data-deploy="app-lychee-land"`, `data-deploy-tag="0\.1\.1"`), and does not match `/data-deploy-failed/`.
- "a failing container gets its logs hint beside the hop that reports it" (~413): keep, it should still pass.
- Leave the redeploy-failed tests (installed version) untouched: the failure line stays in the card there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -40`
Expected: the new tests fail on "expected a What to check block" / missing ids; the three updated card tests fail.

- [ ] **Step 3: Implement `hopFixes` and render it**

In `src/views/html.ts`:
- `hopFixes(site, opts): HopFix[]` builds, in order:
  - `tunnel` when `opts.unitStates` is set and `rowLabels(opts.unitStates["cloudflared-sites.service"]?.status ?? "unknown").tone === "bad"`: sentence "The sites tunnel isn't running, so no request reaches Caddy. Its journal says why:" + `commandBlock("cmd-fix-tunnel", "journalctl -u cloudflared-sites -n 50", "Copy journal command")`.
  - `caddy`, same test on `caddy.service`: "Caddy isn't running, which takes down every site on lychee, not just this one. Its journal says why:" + `commandBlock("cmd-fix-caddy", "journalctl -u caddy -n 50", "Copy journal command")`.
  - `your app`, first match wins:
    - `opts.status?.kind === "failed" && opts.resource` → `failureLine({ ...opts.resource, result: "failed" })` (forcing `result` covers Review Focus 1).
    - `opts.resource` and `opts.status?.kind === "container"` with bad tone → today's "Check the container's logs to see why:" + `commandBlock("cmd-logs", …)`.
    - `opts.status?.kind === "tcp" && !opts.status.responding` → `Nothing answered on ${mono(`localhost:${site.target}`)}. lychee-admin doesn't run this process, so check that it's started and listening:` + `commandBlock("cmd-fix-listen", `ss -ltn 'sport = :${site.target}'`, "Copy listen check")`.
- In `renderRequestPath`, delete the `containerIsBroken` block (and its now-unused locals and comment), and when `hopFixes` is non-empty render, before the detail rows:
  ```html
  <div class="h-px bg-stone-700 my-4"></div>
  <p class="${HOP_LABEL} mb-3">What to check</p>
  <div class="flex flex-col gap-4"> one row per entry </div>
  ```
  Row: `grid grid-cols-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5`; key `<p class="font-mono text-[0.8rem] text-red-300 m-0"><span aria-hidden="true">●</span> ${hop}</p>`; body in a `<div class="flex flex-col gap-2 min-w-0">`. When there are detail rows after it, keep the existing hairline before them.
- Move the "Remediation belongs with the hop…" comment to `hopFixes`' doc comment and extend it to say every bad hop gets one, in request order.
- In `firstDeploy`, the `result === "failed"` branch returns `<p class="${BODY}">Deploying ${mono(target)} failed; the reason is under the request path.</p>` (or "The last deploy failed; …" without a target) + `gateLine(resource)` + the offer, no `failureLine`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -20` → Expected: all pass, 0 failures.
Run: `npm run typecheck && npm run lint` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "feat: every red hop gets its fix under the request path"
```

---

### Task 2: Fold done runbook steps, reorder an attached site, cap the Danger measure

**Files:**
- Modify: `src/views/html.ts` — `runbookStep` (~698), `renderRepositoryCard` (~933-954), `renderDangerZone` (~619), `renderSiteDetail` (~1074-1081)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: Task 1's page (no new symbols from it).
- Produces: `runbookStep(n: number, done: boolean, title: string, body: string, fold?: { extra?: string }): string` — when `done && fold`, renders a `<details>` (no `open`) whose `<summary>` holds the done mark, title, `done`, and `fold.extra` as `· ${extra}` in mono Smoke; body unchanged inside. Otherwise identical to today.

- [ ] **Step 1: Write the failing tests**

In the runbook `describe` (uses `card`, `BASE`, `RESOURCE`):
- "done steps 1 and 2 fold at rest, with the file names in step 1's summary" — `resource: { ...RESOURCE, available: "0.1.0", result: "awaiting-image" }`, `status: { kind: "awaiting-image" }`. Assert `card` contains exactly two `<details` (count matches of `/<details/g`), none with `open`, the first `<summary>` contains `Dockerfile, .dockerignore, release.yml`, every `FILES[i].content` is still in `card` (in full, inside the fold), and step 3's attached line is not inside a `<details>`.
- "steps not yet done never fold" — not attached and `resource: RESOURCE` with no `available`. Assert `card` does not match `/<details/`. (The existing "not attached: every scaffold file in full, with nothing folded or scrolled" test must keep passing.)

New `describe("card order", …)`:
- "an attached site puts Manual steps after the repository card" — `NEXT_SITE`, `{ ...BASE, resource: RESOURCE, status: { kind: "awaiting-image" } }`. Assert `html.indexOf(">From a repository</h3>") < html.indexOf(">Manual steps</h3>") < html.indexOf(">Danger</h3>")`, and Request path first.
- "static, plain-proxy and unattached sites keep Manual steps second" — `STATIC_SITE`, `PROXY_SITE` and `NEXT_SITE` with `{ ...BASE, status: { kind: "container", state: "not-created" } }`. Assert Manual steps comes right after Request path (before From a repository where present).
- Review Focus 5, "a detached site keeps Manual steps before the repository card" — `NEXT_SITE`, `{ ...BASE, detached: true, status: { kind: "container", state: "not-created" } }`.
- "the Danger paragraph is held to a reading measure" — the `<p>` after `>Danger</h3>` carries `max-w-[70ch]`.
- "no id repeats on a detail page" — for each of: static; proxy not responding with both units `exited`; Next.js failed first deploy (`resource` failed, `available: "0.1.1"`, `status: { kind: "failed" }`); Next.js installed and `exited`; Next.js awaiting image with `available`. Collect `[...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])` and assert it equals its own `new Set` size.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -30` → Expected: the fold, order and measure tests fail; the id test may already pass (keep it).

- [ ] **Step 3: Implement**

- `runbookStep` gains the optional `fold`; `renderRepositoryCard` passes `{ extra: "Dockerfile, .dockerignore, release.yml" }` for step 1 and `{}` for step 2. The extra is derived from `opts.scaffoldFiles` names (basename of each, joined with `", "`), not hard-coded. Summary styling: `flex gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-md` plus `FOCUS_RING`; the folded body keeps the step's left inset (`pl-[1.95rem]` matches the done mark's width plus gap). No show/hide text toggle and no chevron animation; a quiet `icon("chevronDown")` after the summary text is enough.
- `renderSiteDetail`: `const attached = opts.resource !== undefined;` render `requestPath, repositoryCard, manualSteps` when attached, else `requestPath, manualSteps, repositoryCard`; Danger last either way. One-line comment on why (DNS is live setup until a site is attached).
- `renderDangerZone`: add `max-w-[70ch]` to the paragraph.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -20` → Expected: all pass.
Run: `npm run typecheck && npm run lint && npm run build` → Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "feat: fold finished runbook steps and move DNS below an attached site's repository"
```

---

### Task 3: Record the rules, then verify the pages

**Files:**
- Modify: `DESIGN.md` — The Show-It Rule (~502-510), Routing Hop Chain (~823-845), Don't list fold line (~1108-1110), and the detail page's composition wherever it lists the card order
- Modify: `.impeccable/design.json` — `narrative.rules` bodies for the two amended rules
- Possibly: `.impeccable/design.json` component entries if `/impeccable document` adds one

**Interfaces:**
- Consumes: the shipped behaviour of Tasks 1-2 (read the code, not this plan, for exact wording).
- Produces: nothing code-facing.

- [ ] **Step 1: Amend `DESIGN.md`**

- The Show-It Rule: after the host-action exception add a second named one — a finished runbook step folds at rest; a step that is not done never folds, so setup in progress is never behind a click.
- Routing Hop Chain: replace "When the last hop is in a `bad` tone, the remediation appears…" with: every hop in a bad tone gets an entry in a "What to check" list beneath the chain, in request order, each a Scorch mono hop key beside a sentence and a command block; hop one never does, because it has no state.
- Don't list: "The one named fold is…" → names both folds.
- Detail page composition: an attached site's order is Request path → From a repository → Manual steps → Danger; every other site keeps Manual steps second.

- [ ] **Step 2: Re-derive the sidecar rule bodies**

For each amended named rule, set its `narrative.rules[*]` body in `.impeccable/design.json` to the `DESIGN.md` prose from the rule's bolded header to the next rule header or heading, with `**bold**` markers and backticks stripped — nothing else changed.

Run: `node -e 'const d=require("./.impeccable/design.json"); for (const r of d.narrative.rules) if (/Show-It/.test(r.name)) console.log(r.body)'`
Expected: the new text, including the runbook exception, with no `**` or backticks.

- [ ] **Step 3: Scoped `/impeccable document` refresh**

Invoke `/impeccable document`; when it asks refresh / overwrite / merge, choose a scoped refresh of the Routing Hop Chain component and the two rules only. Accept nothing that rewrites other prose.

- [ ] **Step 4: Detector and screenshots**

Run: `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` → Expected: `[]`.
Run `npm run dev:mock` in the background and screenshot `/sites/broken.lychee.land`, `/sites/api.lychee.land`, `/sites/preview.lychee.land`, `/sites/blog.lychee.land` at 1280px, full page. Expected: broken shows the failure under the chain and steps 1-2 folded with DNS below; api shows the listen check; preview shows folded steps 1-2 and the 0.1.0 offer; blog unchanged apart from the Danger measure. Stop the server.

- [ ] **Step 5: Final checks and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build` → Expected: all pass.

```bash
git add DESIGN.md .impeccable/design.json
git commit -m "docs: record what-to-check and the runbook fold in DESIGN.md"
```
