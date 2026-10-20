# Status Consistency, Links and `unknown` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A site resource shows the same status word on its site page and on the services board; a site page and its board row link to each other; a board row reading `unknown` says why.

**Architecture:** A shared pure rule (`undeployedStatus`) in `src/lib/siteDisplay.ts` used by both `resolveNextjsSite` and `renderServiceRow`; a name-inverse (`hostnameForResource`) in `src/lib/siteResource.ts`; the board route passes a set of managed hostnames to `renderServicesPage`; view changes in `src/views/html.ts`; then docs.

**Tech Stack:** TypeScript, Express server-rendered HTML, Node's built-in test runner via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-status-consistency-design.md`

## Global Constraints

- `undeployedStatus` applies only when nothing is installed (`version` empty/absent): `failed` → `{ kind: "failed" }`, `awaiting-image` → `{ kind: "awaiting-image" }`, else `null`. Installed → `null`.
- Board: only **container** rows change; unit rows and installed container rows keep their live state. A running host action and `applying` keep their current precedence.
- `resolveNextjsSite`'s behaviour is unchanged (nothing installed and `null` → still `awaiting-image`).
- Anchors: every board row gets `id="service-<name>"`; a site page's `resource` row links to `/services#service-<name>`.
- Board → site link only when `hostnameForResource(name, domain)` is in the managed-hostname set; unreadable Caddyfile → empty set → no links, never an error.
- Link style = breadcrumb convention: text keeps its colour, `hover:underline`, `FOCUS_RING`.
- `unknown` sentences, verbatim: unit "lychee-admin couldn't read this unit's state from systemd."; container "lychee-admin couldn't read this container's state." Not shown while a host action runs.
- Edit `src/views/*.ts` only with Edit/Write — never shell, sed or a script.
- Verification: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Review Focus

1. **A site row on the board whose declaration was retired** (`gone`: nothing installed, last result `deployed`) — keeps its live state word (no `failed`/`awaiting image`), and still links to its site while the site exists. → Task 1 test "an undeployed row with another result keeps its live state"; Task 2 covers the link.
2. **A non-site container with nothing installed and `failed`** (e.g. a hand-declared resource) — the rule applies to any container row, so it also reads `failed`; that is intended (same meaning). → Task 1 test "a non-site undeployed failed container reads failed".
3. **The apex domain** — `hostnameForResource` must not map anything to `lychee.land` (resources are `<label>-lychee-land`; the apex has no label). → Task 2 test "no resource name maps to the apex".
4. **A resource name that merely ends with the domain suffix but isn't a site** (`foo-lychee-land` where `foo.lychee.land` is not managed) — no link. → covered by Task 2's "not in the managed set" test.
5. **Board route with an unreadable Caddyfile** — page still renders, no links. → Task 2 route test "an unreadable Caddyfile renders the board without site links".

---

### Task 1: One status rule for an undeployed site resource

**Files:**
- Modify: `src/lib/siteDisplay.ts`, `src/routes/sites.ts` (`resolveNextjsSite`, ~144-146), `src/views/html.ts` (`renderServiceRow`, ~1327-1350)
- Test: `src/lib/siteDisplay.test.ts`, `src/views/html.test.ts`

**Interfaces:**
- Produces: `export function undeployedStatus(entry: { version?: string; result?: string }): { kind: "failed" } | { kind: "awaiting-image" } | null` in `src/lib/siteDisplay.ts`.

- [ ] **Step 1: Write the failing tests**

`src/lib/siteDisplay.test.ts`, describe "undeployedStatus":
- `{ version: "", result: "failed" }` → `{ kind: "failed" }`; `{ result: "failed" }` → same.
- `{ version: "", result: "awaiting-image" }` → `{ kind: "awaiting-image" }`.
- `{ version: "", result: "deployed" }` → `null`; `{}` → `null`.
- `{ version: "0.1.0", result: "failed" }` → `null`.

`src/views/html.test.ts`, in the services-board describe (use the file's existing board-construction helper for a single container row; read how the failed-row tests build theirs):
- "an undeployed failed container reads failed, not its live state" — container row `{ version: "", target: "0.1.0", result: "failed", status: "exited" }` → pill text `failed` with the bad-tone class (`TONE_PILL.bad`), and not `exited`.
- "an undeployed awaiting-image container reads awaiting image" — `{ version: "", result: "awaiting-image", status: "not-created" }` → `awaiting image`, neutral.
- Review Focus 1, "an undeployed row with another result keeps its live state" — `{ version: "", result: "deployed", status: "not-created" }` → `not deployed`.
- Review Focus 2, "a non-site undeployed failed container reads failed" — row named `palsave-api` with `{ version: "", result: "failed", status: "exited" }` → `failed`.
- "an installed container still shows its live state" — `{ version: "0.2.0", result: "failed", status: "running" }` → `running`.
- "a unit row is unaffected" — unit row with `result: "failed"`, `status: "running"` → `running`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -30` → Expected: `undeployedStatus` is not exported; board tests show `exited`.

- [ ] **Step 3: Implement**

- `undeployedStatus` per the Global Constraints.
- `resolveNextjsSite`: replace the inline `resource.result === "failed" ? "failed" : "awaiting-image"` with `undeployedStatus(resource) ?? { kind: "awaiting-image" }` inside the existing `!resource.version` branch (behaviour unchanged).
- `renderServiceRow`: compute `live` as `describeStatus(undeployed)` when `row.kind === "container"` and `undeployedStatus(row)` is non-null, else `rowLabels(row.status)` as today; the running-action and `applying` precedence below it is unchanged. Comment why (the site page decides the same way; the container is not asked about a version that was never installed).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -15` → 0 failures. Run: `npm run typecheck && npm run lint` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/siteDisplay.ts src/lib/siteDisplay.test.ts src/routes/sites.ts src/views/html.ts src/views/html.test.ts
git commit -m "feat: an undeployed site resource reads the same word on its page and the board"
```

---

### Task 2: Site ↔ board links and the `unknown` explanation

**Files:**
- Modify: `src/lib/siteResource.ts`, `src/routes/services.ts` (board page handler ~35-70), `src/views/html.ts` (`renderRequestPath` detail rows ~449-480, `renderServiceRow`, `renderServicesPage` ~1442)
- Test: `src/lib/siteResource.test.ts`, `src/views/html.test.ts`, `src/routes/services.test.ts`

**Interfaces:**
- Consumes: Task 1's board pill logic (unchanged here).
- Produces:
  - `export function hostnameForResource(name: string, domain: string): string | null` in `src/lib/siteResource.ts`.
  - `renderServicesPage(board, now, prunable, domain, lastRuns = {}, group = "service", managed: ReadonlySet<string> = new Set())` — new last positional parameter, the managed hostnames.

- [ ] **Step 1: Write the failing tests**

`src/lib/siteResource.test.ts`:
- "hostnameForResource inverts resourceNameFor" — for `test.lychee.land`, `a-b.lychee.land`: `hostnameForResource(resourceNameFor(h, "lychee.land")!, "lychee.land") === h`.
- "a non-site name maps to nothing" — `palsave-api` → `null`.
- Review Focus 3, "no resource name maps to the apex" — `lychee-land` → `null`.

`src/views/html.test.ts`:
- "every board row carries an anchor" — rows render `id="service-<name>"`.
- "a site page's resource row links to its board row" — `renderSiteDetail(NEXT_SITE, { ...OPTS, resource: RUNNING_RESOURCE, status: { kind: "container", state: "running" } })` contains `href="/services#service-app-lychee-land"`.
- "a managed site's board row links to its site" — row `app-lychee-land`, managed set `{"app.lychee.land"}` → `href="/sites/app.lychee.land"` around the name.
- Review Focus 4, "a site row not in the managed set stays plain text" — same row, empty set → no `href="/sites/`.
- "a non-site row never links" — `palsave-api` with any set → no `href="/sites/`.
- "an unknown unit row explains itself" — unit row `status: "unknown"` → "lychee-admin couldn't read this unit's state from systemd."
- "an unknown container row explains itself" — container row `status: "unknown"` (installed) → "lychee-admin couldn't read this container's state."
- "a known row has no unknown sentence" — `running` → neither sentence.
- "a running host action suppresses the unknown sentence" — unit row with actions, `status: "unknown"`, a running `ActionState` → neither sentence.

`src/routes/services.test.ts` (follow how existing tests build deps and fakes):
- "the board links a managed site's row" — fake Caddyfile containing `app.lychee.land`, inventory with `app-lychee-land` → response contains `href="/sites/app.lychee.land"`.
- Review Focus 5, "an unreadable Caddyfile renders the board without site links" — fake fs throws on the Caddyfile read → 200, no `href="/sites/`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test 2>&1 | tail -30` → Expected: failures for the new export, anchors, links and sentences.

- [ ] **Step 3: Implement**

- `hostnameForResource`: strip the `-<domain with . → ->` suffix; `null` if the suffix is absent or the remaining label is empty; return `<label>.<domain>`.
- Board route: read `config.caddyfilePath` through `deps.fs.readFile`, `caddyfile.parseSites(...)`, keep `isManagedHostname` matches, build a `Set` of hostnames; wrap in try/catch → empty set; pass it as `managed`. Read it alongside the existing parallel reads.
- `renderServiceRow`: `id="service-<name>"` (escaped) on the `<li>`; the name links to `/sites/<hostname>` when `hostnameForResource(row.name, domain)` is in `managed` (thread `managed` from `renderServicesPage`), styled `text-stone-50 no-underline hover:underline ${FOCUS_RING}` inside the existing `SERVICE_NAME` element; the `unknown` line as a `SERVICE_DETAIL` paragraph after the facts line when the displayed pill is `unknown` and no action is running.
- `renderRequestPath`: render the `resource` detail value as `<a href="/services#service-<name>" class="text-stone-50 no-underline hover:underline ${FOCUS_RING}">` (the row's other values stay plain spans).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -15` → 0 failures. Run: `npm run typecheck && npm run lint && npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/siteResource.ts src/lib/siteResource.test.ts src/routes/services.ts src/routes/services.test.ts src/views/html.ts src/views/html.test.ts
git commit -m "feat: link a site and its board row; explain unknown on the board"
```

---

### Task 3: Docs, then verify

**Files:**
- Modify: `DESIGN.md` (Service Row entry; wherever the board pill is described as live container state), `CLAUDE.md` (services-board description), `.impeccable/design.json` (Service Row component entry, if it describes the pill or the name)

**Interfaces:**
- Consumes: Tasks 1-2's shipped behaviour (read the code for exact wording).

- [ ] **Step 1: Amend the docs**

- `DESIGN.md` Service Row: a site resource's name links to its site while the site exists; a row reading `unknown` carries one Smoke line saying the state couldn't be read; a container row with nothing installed shows the same word its site page does (`failed` / `awaiting image`). Re-derive a named rule's `narrative.rules` body only if you change that rule's prose (strip `**bold**` and backticks; header to next rule header or heading).
- `CLAUDE.md`: in the services-board description, one sentence that site status and board status share one rule for an undeployed resource (`undeployedStatus`), and one that the site page's `resource` row and the board row link to each other. Nothing else.
- Sidecar: update the Service Row component description (and snippet, if it shows the name or pill) to match.

Run: `node -e 'require("./.impeccable/design.json")'` → no error.

- [ ] **Step 2: Detector and screenshots**

Run: `/Users/byroncustodio/.claude/plugins/cache/impeccable/impeccable/4.5.0/skills/impeccable/scripts/impeccable detect --json src/views` → `[]`.
`PORT=8799 npm run dev:mock` in the background; full-page 1280px screenshots of `/services` and `/sites/broken.lychee.land` to `.playwright-mcp/after-status-<name>.png`. Expected: `broken-lychee-land` reads `failed`, `preview-lychee-land` `awaiting image`; site rows' names link; `unknown` rows show their sentence; the broken page's `resource` row links to the board. Stop the server.

- [ ] **Step 3: Final checks and commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build` → all pass.

```bash
git add DESIGN.md CLAUDE.md .impeccable/design.json
git commit -m "docs: shared undeployed status rule, site-board links, unknown line"
```
