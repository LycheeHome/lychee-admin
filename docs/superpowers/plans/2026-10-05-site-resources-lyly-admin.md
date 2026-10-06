# Site Resources in lyly-admin — Implementation Plan (2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js site added in `lyly-admin` gets a repository-ready scaffold, can be attached to a `LycheeHome` repository (writing a tagless declaration), shows `awaiting image` until its first release, and deploys through the existing offer.

**Architecture:** One new pure module (`siteResource.ts`) owns the hostname→resource mapping and input checks. `declarationWriter.ts` gains three writes on shared git plumbing; `SystemCommands` exposes them plus two reads (local declarations, a resource's container status). The scaffold emits a GitHub-hosted release workflow instead of a compose file. The detail page, add-site and remove-site consume these. UI shape is decided by a design-variants pass before any markup.

**Tech Stack:** TypeScript, Express, server-rendered HTML, vanilla JS (`public/app.js`), `node:test` via `tsx --test`, `js-yaml` (already a dependency). Verify with `npm run typecheck && npm run lint && npm test && npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-05-scaffold-emits-declarations-design.md`
**Depends on:** plan 1, `docs/superpowers/plans/2026-10-05-site-resources-reconciler.md`, **merged and observed live on `lychee`**. This branch may be built in parallel but must not merge first.

## Global Constraints

- Resource name = `<label>-lyly-dev`, lowercased, from a single-label `*.lyly.dev` hostname; label over 54 characters refused.
- Repository input: lowercased, must fullmatch `[a-z0-9]+(?:[._-][a-z0-9]+)*`; image is `ghcr.io/lycheehome/<repo>`.
- A site declaration is exactly (comments aside) `name`, `image` (tagless), `state: running`, `port`, `bind: 127.0.0.1`. No other field is ever written.
- Every write: never throws, never force-pushes, resets to `@{upstream}` on a rejected push (existing `writeDeclarationTag` contract).
- `createSiteDeclaration` refuses, **after a fresh pull and before writing**, if the file exists or any declaration claims the port.
- A tag write still cannot change registry or repository.
- Remove-site's declaration write is a **separate request** after the Caddy/tunnel removal succeeds, never part of it.
- The release workflow: `runs-on: ubuntu-latest` only; permissions `contents: read`, `packages: write`; trigger tag `v*.*.*`; image tag is plain `X.Y.Z`; names nothing about `lychee`; no third-party actions.
- `awaiting image` is a **neutral** status.
- `lyly-admin` gains no new privilege: no new sudo command; all writes are git pushes with the existing deploy key.

## Review Focus

1. **Attaching a site whose `absent` declaration still exists** (removed, then re-added with the same hostname). Must refuse with a message saying the old declaration must be pruned first, not a generic "exists". *(Task 2)*
2. **Attaching before the reconciler has ticked**, then reloading the page. The page must show the site as attached (`awaiting image`), not offer Attach again. *(Task 6)*
3. **Two browser tabs attaching different repos to one site.** The second must be refused by the fresh-pull existence check, and nothing must be pushed. *(Task 2)*
4. **A hostname with uppercase** (`Test.lyly.dev` is accepted by the case-insensitive validator). Resource name must be `test-lyly-dev`. *(Task 1)*
5. **Remove when the declaration write fails** (push rejected). Caddy/tunnel removal has already succeeded; the client must report that the container is still declared running and name the retry, not report success. *(Task 7)*

---

### Task 1: `siteResource.ts`

**Files:**
- Create: `src/lib/siteResource.ts`
- Test: `src/lib/siteResource.test.ts`

**Interfaces:**
- Produces:
  - `export const SITE_SUFFIX = "-lyly-dev";`
  - `export function resourceNameFor(hostname: string, domain: string): string | null` — `null` when not a single-label managed hostname or label > 54.
  - `export function normalizeRepo(input: string): { ok: true; repo: string } | { ok: false; reason: string }`
  - `export interface DeclarationSummary { name: string; port: number | null; state: string; image: string }`
  - `export function parseDeclaration(name: string, content: string): DeclarationSummary | null` — `js-yaml` `load`, `null` on parse error or non-mapping.
  - `export function claimedPorts(decls: DeclarationSummary[]): Map<number, string>` — port → name, every state counted.

- [ ] **Step 1: Write the failing tests**

```ts
test("maps a hostname to its resource name", () => {
  assert.equal(resourceNameFor("test.lyly.dev", "lyly.dev"), "test-lyly-dev");
  assert.equal(resourceNameFor("Test.lyly.dev", "lyly.dev"), "test-lyly-dev");
  assert.equal(resourceNameFor("a.b.lyly.dev", "lyly.dev"), null);
  assert.equal(resourceNameFor("x".repeat(55) + ".lyly.dev", "lyly.dev"), null);
  assert.equal(resourceNameFor("x".repeat(54) + ".lyly.dev", "lyly.dev")?.length, 63);
});
test("normalizes a repository name", () => {
  assert.deepEqual(normalizeRepo(" Test-Site "), { ok: true, repo: "test-site" });
  for (const bad of ["", "a/b", "../x", "x:1", "ghcr.io/lycheehome/x", "-x", "x-"]) {
    assert.equal(normalizeRepo(bad).ok, false, bad);
  }
});
test("claimedPorts counts absent declarations too", () => {
  const m = claimedPorts([
    { name: "palsave-api", port: 8788, state: "running", image: "" },
    { name: "old-lyly-dev", port: 3000, state: "absent", image: "" },
  ]);
  assert.equal(m.get(3000), "old-lyly-dev");
});
test("parseDeclaration tolerates garbage", () => {
  assert.equal(parseDeclaration("x", ": : :"), null);
});
```

- [ ] **Step 2: Run** `npx tsx --test src/lib/siteResource.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above. `resourceNameFor` reuses `isValidHostname` from `siteValidation.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: map a site hostname to its resource name`

---

### Task 2: Declaration writes and reads

**Files:**
- Modify: `src/lib/declarationWriter.ts`, `src/lib/declarationWriter.test.ts`
- Modify: `src/lib/systemCommands.ts`, `src/dev/fakes.ts`

**Interfaces:**
- Consumes: Task 1's `DeclarationSummary`, `parseDeclaration`, `claimedPorts`.
- Produces (in `declarationWriter.ts`, same `WriterOptions`):
  - `createSiteDeclaration(name: string, repo: string, port: number, opts): Promise<WriteResult>`
  - `setDeclarationState(name: string, state: "absent", opts): Promise<WriteResult>`
  - `writeDeclarationTag` — unchanged signature; now also completes a tagless `image:` line.
  - `readDeclarations(clonePath = RESOURCES_CLONE): DeclarationSummary[]` — sync, reads the local clone only (no git), `[]` when absent.
- Produces (on `SystemCommands`, real + fake): `createSiteDeclaration(name, repo, port)`, `setDeclarationState(name, "absent")`, `readDeclarations(): Promise<DeclarationSummary[]>`, `checkResourceContainerStatus(project: string): Promise<ContainerStatus>` (the existing resource-status wrapper through `parseComposePsOutput`; `readResourceStatus` becomes `toRowStatus` of it). Fakes keep an in-memory `Map<string, DeclarationSummary>` so attach/remove round-trip in dev and tests.

- [ ] **Step 1: Write the failing tests** against the existing fake-git harness in `declarationWriter.test.ts`:
  - `createSiteDeclaration("test-lyly-dev", "test-site", 3000)` writes a file whose parsed YAML equals `{name, image: "ghcr.io/lycheehome/test-site", state: "running", port: 3000, bind: "127.0.0.1"}`, commits `test-lyly-dev: attach ghcr.io/lycheehome/test-site`, pushes.
  - Refuses (`ok: false`, nothing committed) when `test-lyly-dev.yml` exists; when it exists with `state: absent`, `reason` contains `prune`.
  - Refuses when another declaration claims port 3000; `reason` names it.
  - Refuses a name not ending `-lyly-dev` or a repo failing `normalizeRepo`.
  - `writeDeclarationTag("test-lyly-dev", "0.1.0")` on a tagless file yields `image: ghcr.io/lycheehome/test-site:0.1.0`, keeping any trailing comment; on a tagged file behaves as before.
  - `setDeclarationState("test-lyly-dev", "absent")` rewrites only the `state:` line, keeps its comment, refuses when there is not exactly one `state:` line.
  - Rejected push on each write resets to `@{upstream}`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/declarationWriter.test.ts` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Extract `withClone(opts, (clonePath) => Promise<{ file: string; message: string } | WriteResult>)` holding the ssh env, healthy-clone check, pull, add/commit/push and reset — `writeDeclarationTag`'s existing comments move with the code they explain. Tagless line pattern: `^(\s*image:\s*["']?ghcr\.io\/[^\s"'#:]+)(["']?)(.*)$` → `${head}:${tag}${quote}${rest}`; exactly one line across both patterns. The created file opens with a two-line comment: written by lyly-admin for `<hostname>`, tagless until the first Deploy.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: create, tag and retire site declarations`

---

### Task 3: Scaffold emits a release workflow, not a compose file

**Files:**
- Modify: `src/lib/frameworkScaffold.ts`, `src/lib/frameworkScaffold.test.ts`

**Interfaces:**
- Produces: `Scaffold` loses `compose`, gains `workflow: string`. `getScaffoldFiles` returns `Dockerfile`, `.dockerignore`, `.github/workflows/release.yml`, in that order. `getFrameworkScaffold`'s `port` parameter is removed (the container port is fixed at 3000); callers updated.

- [ ] **Step 1: Write the failing tests:**
  - file names are exactly the three above;
  - the workflow parses as YAML; `on.push.tags` is `["v*.*.*"]`; the only `runs-on` value is `ubuntu-latest`; `permissions` deep-equals `{contents: "read", "packages": "write"}`; no step has `uses:` other than `actions/checkout@…`;
  - workflow text contains `${GITHUB_REF_NAME#v}`, `${GITHUB_REPOSITORY,,}`, and `org.opencontainers.image.source`;
  - nothing generated contains `self-hosted`, `lychee`, or `docker-compose` (replaces the existing "no `runs-on`" assertion);
  - `.dockerignore` no longer lists `docker-compose.yml`, and lists `.github`.
- [ ] **Step 2: Run** `npx tsx --test src/lib/frameworkScaffold.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Workflow steps: checkout; `echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin` (env `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`); compute `IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}` and `VERSION=${GITHUB_REF_NAME#v}`; `docker build --label org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY -t "$IMAGE:$VERSION" .`; `docker push "$IMAGE:$VERSION"`. A header comment says: plain X.Y.Z is what lychee's reconciler recognises; the label links the package to the repo so its access is inherited.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS (fix callers the type change breaks).
- [ ] **Step 5: Commit** `feat: scaffold a GitHub-hosted release workflow instead of a compose file`

---

### Task 4: Add-site — no site directory for Next.js; declared ports conflict

**Files:**
- Modify: `src/lib/siteValidation.ts` (+ test), `src/routes/sites.ts` (+ `sites.test.ts`), `src/lib/sitePreview.ts` (+ test)
- Modify: `src/lib/fileSystem.ts`, `src/dev/fakes.ts` — add `exists(path: string): boolean`

**Interfaces:**
- Consumes: `SystemCommands.readDeclarations`, `claimedPorts`.
- Produces: `validateAgainstExisting(input, caddyfileContent, env, declaredPorts: Map<number, string>)` — new fourth parameter; both `POST /sites` and `POST /sites/preview` pass it.

- [ ] **Step 1: Write the failing tests:**
  - `validateAgainstExisting` rejects port 8788 when `declaredPorts` has `8788 → palsave-api`, with an error naming `palsave-api` and `lychee-resources`;
  - route: adding a Next.js site writes no file under `config.sitesRoot` and does not call `createSiteDirectory`; a static site still does;
  - preview for a Next.js site lists the three Task 3 files as "to copy into your repository", not as written to `/var/www`;
  - preview and submit reject the same declared-port conflict.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement.** In `sites.ts`, read `declaredPorts` once per request from `deps.commands.readDeclarations()` (degrade to empty on throw). Remove the Next.js branch that creates the directory and writes scaffold files.
- [ ] **Step 4: Run** `npm run typecheck && npm test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: stop writing Next.js scaffolds to the host; refuse declared ports`

---

### Task 5: Design pass (gate — no markup before it)

**Files:** none in `src/`. Output: an Artifact URL and the user's choices, recorded in Task 6's and 7's commits and in `DESIGN.md` later.

- [ ] **Step 1:** Invoke the `comparing-design-variants` skill (inside `/impeccable`'s direction stage, per CLAUDE.md) for the four decisions this plan leaves open, each with a labelled control from the current detail page:
  1. how the scaffold-to-copy is presented on the detail page (three files, one of them a path under `.github/`);
  2. the **Attach repository** control (input + submit; what it says about the `LycheeHome` requirement and the first `v0.1.0` tag);
  3. the `awaiting image` state on the request path's last hop and in the header pill;
  4. where the newer-tag offer and Deploy sit on the detail page.
- [ ] **Step 2:** Present; **stop for the user's choice**. Record it verbatim for Task 6.

---

### Task 6: Detail page — scaffold, attach, status, deploy

**Files:**
- Modify: `src/routes/sites.ts` (+ test), `src/views/html.ts` (+ `html.test.ts`), `src/lib/siteDisplay.ts` (+ test), `public/app.js`

**Interfaces:**
- Consumes: Tasks 1–5. Deploy reuses `POST /services/:name/deploy` with `name = resourceNameFor(hostname)`.
- Produces:
  - `SiteStatus` gains `{ kind: "awaiting-image" }`; `describeStatus` → `{ pill: "awaiting image", hop: "awaiting first image", tone: "neutral" }`.
  - `SiteDetailOptions` gains `resource?: { name: string; repo: string | null; available?: string; version?: string; result?: string }` (absent ⇒ not attached) and `scaffoldFiles?: { name: string; content: string }[]`; `scaffold` keeps `buildCommand`/`runCommand`.
  - `POST /sites/:hostname/attach` (form field `repo`) → JSON `{ ok: true }` or `{ ok: false, reason }`; 404 for unknown/non-Next.js site; 400 for a bad repo; 502 for a refused write. Logs `attach-site` / `attach-site-failed`.

- [ ] **Step 1: Write the failing tests:**
  - `describeStatus({kind:"awaiting-image"})` is neutral;
  - GET for a Next.js site with no declaration renders the three scaffold files and the attach control, and no `docker compose up` command;
  - GET when `readDeclarations` has `test-lyly-dev` but the inventory has no entry (pre-tick) renders `awaiting image` and no attach control (Review Focus 2);
  - GET when the inventory entry has `result: "awaiting-image", available: "0.1.0"` renders the offer and a Deploy control posting to `/services/test-lyly-dev/deploy`;
  - GET when the inventory entry has a `version` reads the last hop from `checkResourceContainerStatus("test-lyly-dev")`, not `checkContainerStatus`;
  - legacy: a Next.js site with no declaration still renders the attach control (test.lyly.dev's case);
  - POST attach: success calls `createSiteDeclaration("test-lyly-dev", "test-site", 3000)`; bad repo → 400 without calling it; refused write → 502 with the reason.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** per Task 5's chosen variants, then run `node <impeccable-skill-dir>/scripts/detect.mjs --json src/views` and fix what it reports.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm test && npm run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: attach a repository to a site and show its resource state`

---

### Task 7: Remove-site retires the declaration

**Files:**
- Modify: `src/routes/sites.ts` (+ test), `src/views/html.ts` (+ test), `public/app.js`

**Interfaces:**
- Produces: `POST /sites/:hostname/detach` → `setDeclarationState(name, "absent")`; JSON `{ ok: true }` / `{ ok: false, reason }` (502). Logs `detach-site` / `detach-site-failed`. The confirm-remove modal carries `data-attached="true"` when a declaration exists, lists the extra step ("retire the container declaration"), and shows the delete-files checkbox only when `deps.fs.exists(<sitesRoot>/<hostname>)`.

- [ ] **Step 1: Write the failing tests:**
  - detach calls `setDeclarationState("test-lyly-dev", "absent")` and **works after the Caddy block is gone** (it requires a declaration in `readDeclarations()`, not a site in the Caddyfile — that is what makes the retry possible);
  - detach with no declaration → 404, nothing called;
  - modal for an attached site lists five steps, the declaration step fifth, after the `cloudflared-sites` restart; for an unattached site, the existing four;
  - a Next.js site with no directory renders no delete-files checkbox; `test.lyly.dev`'s legacy directory still gets one.
- [ ] **Step 2: Run** `npm test` — Expected: FAIL.
- [ ] **Step 3: Implement** in `app.js`: after `/delete` succeeds and only then, if `data-attached`, `POST /detach`; on its failure show the toast "Site removed, but its container is still declared running: <reason>" with a **Retry** action that re-posts `/detach`, and do **not** proceed to delete-files; otherwise continue to delete-files as today.
- [ ] **Step 4: Run** full verify — Expected: PASS.
- [ ] **Step 5: Commit** `feat: retire a site's declaration when the site is removed`

---

### Task 8: Seed, docs, design record

**Files:**
- Modify: `src/dev/seed.ts`, `src/dev/fakes.ts` — one attached site awaiting `0.1.0` (`preview.lyly.dev`, port 3100) and one running (`app.lyly.dev`, port 3200, version `0.2.0`), each with a matching inventory entry
- Modify: `CLAUDE.md` (Core v1 feature flow items 2–3; Reverse-proxy sites section; site detail paragraph's Deploy-card description), `PRODUCT.md` (check "never invokes Docker" still reads true; amend managed-surface text for site resources)
- Run: `/impeccable document` (scoped refresh) for the `awaiting image` tone and the attach/scaffold components; keep `.impeccable/design.json`'s `narrative.rules` derived (strip `**bold**` and backticks from each rule's full prose).

- [ ] **Step 1:** `npm run dev:mock`; both seeded sites render per Task 5's design; attach and remove round-trip against the fakes.
- [ ] **Step 2:** Docs edits; `/impeccable document`; re-derive sidecar rule bodies; run the detector on `src/views`.
- [ ] **Step 3:** Full verify — Expected: PASS.
- [ ] **Step 4: Commit** `docs: record site resources in CLAUDE.md, PRODUCT.md and DESIGN.md`

---

## End to end on `lychee` (operator; after both plans are live)

1. Create `LycheeHome/test-site`; commit a Next.js app plus the three files from `test.lyly.dev`'s page; push tag `v0.1.0`; confirm the package `ghcr.io/lycheehome/test-site:0.1.0` exists.
2. **ghcr access check (spec §2):** on `lychee`, `sudo docker pull ghcr.io/lycheehome/test-site:0.1.0`. If denied, grant the host token's account read on the package, and add that step to the attach control's copy.
3. Attach `test-site` on `test.lyly.dev`'s page. Within a tick: `/var/lib/lychee-resources/test-lyly-dev/status.json` reads `awaiting-image`, `available_tag: 0.1.0`; `getent passwd test-lyly-dev` shows a `nologin` account.
4. Deploy `0.1.0`. Next tick: container `running · healthy`; `https://test.lyly.dev` serves; `palsave-api` unaffected.
