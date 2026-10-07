# `lyly-admin` Writes Declarations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lyly-admin` can change a resource's pinned image tag by writing to `lychee-resources`, and the board shows honestly whether that write took effect yet.

**Architecture:** `lychee-ops` gains the bound (`allowed_resources` in the root-owned vocabulary), publishes two new inventory fields (`target`, `available`), and declares where the app's key lives. `lyly-admin` gains a git write path and one control. Everything that decides what is *possible* stays in the repo the app cannot write.

**Tech Stack:** Ansible core 2.20.1 (pinned to the host), Python 3 stdlib + PyYAML for the validator, `unittest`, TypeScript with `node:test` via `tsx`, Express 4, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-04-lyly-admin-writes-declarations-design.md`

## Global Constraints

- The app writes **`lychee-resources` only**. Never `lychee-ops`, never the vocabulary, never a file other than one declaration per write.
- **Never force-push.** A rejected push is retried on the next attempt.
- The key is `/etc/lyly-admin/id_lychee_resources`, `lyly-admin:lyly-admin`, mode `0600`, hand-placed. **Never `/opt/lyly-admin`** — `caddy` is in `webdeploy` and could read it there.
- A declaration naming a mount alias it is not entitled to is **rejected**, and the rejection **names the field** — matching every existing rejection.
- The canonical status vocabulary is shared, not parallel. **`starting` and `unknown` are neutral, never red.**
- `serviceInventory.ts` keeps **degrade-never-throw**: an unreadable or unrecognised entry becomes `unknown` or is dropped, never an exception.
- Container rows carry **no `since`**. Do not synthesise one.
- The vocabulary binds **`service_name`**, not `resource_name` — a loose end of the 2026-10-04 rename. Use what the code uses.
- `lyly-admin` gate is `npm run typecheck && npm run lint && npm test && npm run build`, currently 371/371. `lychee-ops` is `tests/run.sh`, currently ok=644.
- Any UI change goes through the project's `impeccable` skill, and the design detector is run **by hand** (`node <impeccable-skill-dir>/scripts/detect.mjs --json src/views`) — the hook is configured but not firing.

## Review Focus

Input classes the spec implies but no happy path exercises. Each has its test placed in the task that owns the code.

1. **Two writers at once.** The reconciler pulls while the app pushes, or Deploy is clicked twice. A rejected push must retry, never force, and never leave the clone in a state the next write cannot recover from. *(Task 6)*
2. **GHCR unreachable or refusing.** Rate limit, expired credential, network. `available` must degrade to absent and leave the row readable — not break the inventory for every other service. *(Task 3)*
3. **A tag that vanished between discovery and Deploy.** The app offers `0.4.0`, it is deleted, the click writes a pin to nothing. The write succeeds and the *apply* fails; the board must show that rather than claiming success. *(Task 7)*
4. **The app writes a declaration the validator rejects.** Entirely possible — the app does not run the validator. The rejection must reach the page with its field named, not vanish into a failed tick. *(Task 7)*
5. **`allowed_resources` absent from an alias.** An entry without the key must reject **every** resource, with the message naming the alias and the missing key. Fail-closed: a new alias is how a sensitive path gets added, and forgetting the key there would otherwise be a silent widening on exactly the careless path. *(Task 1)*

---

### Task 1: `allowed_resources` in the vocabulary and the validator

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Modify: `roles/resources_host/files/mounts.yml`
- Modify: `roles/resources_host/files/validate_declarations.py`
- Test: `tests/test_validate_declarations.py`

**Interfaces:**
- Produces: a vocabulary entry carries `allowed_resources: [<pattern>, …]`. A pattern is either an exact name or a `*`-prefixed suffix match (`"*.lyly.dev"`). An entry **without** the key rejects every resource — see Step 1.

**Fail-closed, deliberately, and this was reversed during review.** The first draft had an absent key permit anyone, justified by a window that does not exist: `mounts.yml` and `validate_declarations.py` ship in the same commit and are installed by the same role in the same tick, so the validator never enforces against a vocabulary that lacks the keys. What the default actually governs is the *next* alias someone adds. Forgetting the key under fail-open silently grants every resource access to whatever that alias points at; under fail-closed it rejects loudly and is fixed in one commit. Everything else in this design chose loud over silent for the same reason — `mandatory()` on identities, unknown-field rejection, the no-verdict gate.
- `validate()`'s error for a violation uses `field: "mounts"` and names the alias in the message.

- [ ] **Step 1: Write the failing tests**

```python
def test_rejects_an_alias_the_resource_is_not_entitled_to()   # field == "mounts"
def test_allows_an_exactly_named_resource()                   # palsave-api + palworld_saves
def test_allows_a_suffix_pattern()                            # blog.lyly.dev + site_files
def test_rejects_a_suffix_pattern_that_does_not_match()       # evil.example.com + site_files
def test_an_alias_without_allowed_resources_rejects_everyone()  # Review Focus 5
```

`test_an_alias_without_allowed_resources_rejects_everyone` asserts the rejection names **both** the alias and the missing key, so the fix is obvious from the error rather than requiring someone to read the validator. It is the case most likely to be hit by a future change rather than by this one — Step 3 gives both existing aliases their key, so nothing in the current vocabulary exercises it.

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_validate_declarations -v`
Expected: FAIL — no entitlement check exists.

- [ ] **Step 3: Add `allowed_resources` to both vocabulary entries**

`palworld_saves` gets `[palsave-api]`; `site_files` gets `["*.lyly.dev"]`. Record in the comment that the key is **required** — an entry without one grants nothing — and that this is deliberate because a new alias is how a sensitive path gets added.

- [ ] **Step 4: Implement the check in `_check_one`**

Beside the existing alias-exists check (`validate_declarations.py` around line 183). The entitlement test runs only for an alias that exists in the vocabulary — an unknown alias is already its own rejection and must not change message.

- [ ] **Step 5: Run the tests and `tests/run.sh`**

Expected: the new tests pass; the suite stays at ok=644 or above.

- [ ] **Step 6: Mutate to confirm each new test can fail**

Remove the entitlement check and confirm the four rejection tests fail; restore and confirm green. Record what was mutated.

- [ ] **Step 7: Commit**

```bash
git add roles/resources_host tests/test_validate_declarations.py
git commit -m "feat: bound which resources may name a mount alias"
```

---

### Task 2: the inventory publishes `target`

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Modify: `roles/inventory/templates/services.json.j2:12-23`
- Test: `tests/test_swee_decide.yml` (the inventory render plays)

**Interfaces:**
- Produces: a reconciled entry carries `target`, the tag the declaration pins, from `status.json`'s `target_tag`. Absent — not empty — when there is no status file, matching how `version` already behaves.

- [ ] **Step 1: Write the failing render test**

Assert a reconciled container entry emits `target` equal to the fixture's `target_tag`, and that an entry with no status file carries no `target` key at all. Extend the existing whole-dict equality assertion so a stray key fails.

- [ ] **Step 2: Run it to verify it fails**

Run: `tests/run.sh`
Expected: FAIL — no `target` in the output.

- [ ] **Step 3: Emit `target` in the template**

Alongside `version`, applying the same `'none'` → absent convention the surrounding lines already use for `installed_tag` and `installed_commit`.

- [ ] **Step 4: Run `tests/run.sh`**

Expected: PASS.

- [ ] **Step 5: Commit**

---

### Task 3: resolve and publish `available`

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Create: `roles/resources_reconcile/tasks/resolve_available.yml`
- Modify: `roles/resources_reconcile/tasks/reconcile.yml` — call it after the verdict is read
- Modify: `roles/resources_reconcile/tasks/write_status.yml` — record the resolved tag
- Modify: `roles/inventory/templates/services.json.j2` — emit `available`
- Test: `tests/test_resources_render.yml`

**Interfaces:**
- Produces: `status.json` gains `available_tag`, the newest tag published for the declaration's own image repository, or `""` when it could not be determined. The inventory emits it as `available`, absent when `""`.

- [ ] **Step 1: Write the failing tests**

```yaml
# a stand-in registry responder, as the docker stand-in already works
- name: the newest published tag is recorded as available_tag
- name: a registry that errors leaves available_tag empty and the tick succeeds   # Review Focus 2
- name: a registry that returns no tags leaves available_tag empty
```

The error case is the one that matters: a GHCR failure must not fail the tick or block other resources. The reconciler's existing record-never-raise convention applies — this is discovery, not reconciliation, and nothing downstream depends on it.

- [ ] **Step 2: Run them to verify they fail**

Run: `tests/run.sh`
Expected: FAIL — no such tasks.

- [ ] **Step 3: Implement `resolve_available.yml`**

GHCR needs a token exchange before the tags list: `GET https://ghcr.io/token?scope=repository:<ns>/<name>:pull` with basic auth from `/root/.docker/config.json`, then `GET https://ghcr.io/v2/<ns>/<name>/tags/list` with that bearer. Use `ansible.builtin.uri`. Wrap both in a block whose rescue sets `available_tag` to `""` — never `fail:`, per the role's stated convention.

"Newest" is the highest semver among tags that parse as semver; ignore any that do not. The declaration pins explicit tags only, so a non-semver tag is not a candidate.

- [ ] **Step 4: Record it in `write_status.yml` and emit it from the inventory template**

- [ ] **Step 5: Run `tests/run.sh`**

Expected: PASS, suite at or above its prior count.

- [ ] **Step 6: Mutate to confirm the error path is real**

Point the stand-in at a responder that 500s and confirm the tick still succeeds with `available_tag: ""`. Record it.

- [ ] **Step 7: Commit**

---

### Task 4: declare where the app's key lives

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Modify: `roles/lyly_admin_host/tasks/main.yml`

**Interfaces:**
- Produces: `/etc/lyly-admin/` exists, `lyly-admin:lyly-admin`, mode `0700`. The key file inside it is **hand-placed and never written by Ansible**, exactly as the deploy keys and `.env` are.

- [ ] **Step 1: Declare the directory**

With a comment recording why it is not `/opt/lyly-admin`: that directory is `2775 lyly-admin:webdeploy` and `caddy` is in `webdeploy`, so a write credential there would be readable by the process terminating tunnel traffic. Name the file that belongs in it and state that nothing automated creates it.

- [ ] **Step 2: Run `tests/run.sh`**

Expected: unchanged.

- [ ] **Step 3: Commit**

---

### Task 5: `lyly-admin` parses `target` and `available`

**Repo:** `LycheeHome/lyly-admin`

**Files:**
- Modify: `src/lib/serviceInventory.ts:19-36` — `InventoryEntryBase`
- Modify: `src/dev/seed.ts` — give the seeded container row a newer `available`
- Test: `src/lib/serviceInventory.test.ts`

**Interfaces:**
- Produces: `InventoryEntryBase` gains `target?: string` and `available?: string`, normalised through the existing `knownString` so `""` becomes `undefined`.

- [ ] **Step 1: Write the failing tests**

```ts
test("target and available are parsed when present")
test("an empty target or available normalises to undefined")
test("an entry with neither still parses")        // old inventory, new app
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Add the fields and seed an upgradeable row**

The seeded container row should carry `version` behind `available`, so `npm run dev:mock` shows the Deploy affordance rather than only the settled state.

- [ ] **Step 4: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`

- [ ] **Step 5: Commit**

---

### Task 6: the write path

**Repo:** `LycheeHome/lyly-admin`

**Files:**
- Create: `src/lib/declarationWriter.ts`
- Modify: `src/lib/systemCommands.ts` — add the command to the `SystemCommands` interface and the real implementation
- Modify: `src/dev/fakes.ts` — an in-memory fake
- Test: `src/lib/declarationWriter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `writeDeclarationTag(name: string, tag: string): Promise<WriteResult>` on `SystemCommands`, where `WriteResult` is `{ ok: true } | { ok: false; reason: string }`. It never throws.
- The clone lives at `/var/lib/lyly-admin/lychee-resources`; the key at `/etc/lyly-admin/id_lychee_resources` is passed with `GIT_SSH_COMMAND` carrying both `-i` and `-o IdentitiesOnly=yes`.

**`IdentitiesOnly=yes` is not optional.** `/root/.ssh/config` has a `Host github.com` block, and without it another valid deploy key can be offered and GitHub answers `Repository not found` — which reads as a missing repo rather than a wrong key. This is documented on the reconciler's own fetch for the same reason.

- [ ] **Step 1: Write the failing tests**

```ts
test("writes only the named declaration's tag, leaving other fields byte-identical")
test("a rejected push is reported, not forced")                  // Review Focus 1
test("a missing key returns ok:false with a stated reason")
test("an unreadable clone is re-cloned rather than failing")
test("never invokes git with --force or +refspec")               // argv assertion
test("every git invocation runs inside the resources clone, nowhere else")
```

The last two are exact-argv assertions, in the shape the reconciler's
`down`-without-`-v` test already uses. Force-pushing is the one action that
turns a bounded capability into an unbounded one, and the cwd assertion is the
only executable form of the spec's claim that the app cannot write
`lychee-ops` — everything else asserting that is prose.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `writeDeclarationTag`**

Pull, rewrite only the `image:` tag portion of the named file, commit, push. Preserve the rest of the file byte-for-byte — the declarations carry long explanatory comments that must survive a write. Prefer a targeted line rewrite over a YAML round-trip, which would reformat and strip them.

- [ ] **Step 4: Run the full gate**

- [ ] **Step 5: Mutate to confirm the force-push assertion can fail**

Add `--force` to the push argv and confirm that test alone fails. Record it.

- [ ] **Step 6: Commit**

---

### Task 7: the Deploy control and pending rendering

**Repo:** `LycheeHome/lyly-admin`

**Files:**
- Modify: `src/views/html.ts:814-860` — `rowLabels`, `renderServiceRow`
- Modify: `src/routes/services.ts` — a POST that calls `writeDeclarationTag`
- Test: `src/views/html.test.ts`, `src/routes/services.test.ts`

**Interfaces:**
- Consumes: Task 5's `target`/`available`; Task 6's `writeDeclarationTag`.

**`serviceBoard.ts` needs no change.** `BoardRow` is `InventoryEntry & { status, since }` — an intersection — so Task 5's fields arrive on every row for free. Do not add them again.

**This is a UI change: invoke the project's `impeccable` skill before writing markup**, and run the design detector by hand afterwards.

- [ ] **Step 1: Write the failing tests**

```ts
test("target equal to version renders as running")
test("target different from version renders as applying, showing both")
test("an available newer than version offers Deploy")
test("no available, or available equal to version, offers nothing")
test("a failed result shows the failed step, not a Deploy button")
test("applying is neutral, never red")
test("a write failure renders the reason, not a 500")             // Review Focus 4
test("Deploy for a tag that no longer exists reports the apply failure")  // Review Focus 3
```

`test("applying is neutral, never red")` guards the property most likely to regress: a five-minute window is normal operation, and painting it as a failure makes the board cry wolf on every deploy.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`

- [ ] **Step 3: Implement the board fields, the row rendering and the POST**

The POST is one resource and one tag, returns JSON, and renders the result through the existing flash-banner path rather than a new mechanism. A write failure is a stated reason, never a 500 — matching how `readResourceStatus` already degrades.

- [ ] **Step 4: Run the full gate and the design detector**

Run: `npm run typecheck && npm run lint && npm test && npm run build`, then
`node <impeccable-skill-dir>/scripts/detect.mjs --json src/views`
Expected: all clean, detector `[]`.

- [ ] **Step 5: Screenshot `/services` in `npm run dev:mock`**

The seeded row from Task 5 should show the Deploy affordance beside a container row. Confirm `applying` reads neutral next to a `running` row.

- [ ] **Step 6: Commit**

---

### Task 8: cut-over

**Operator-run on `lychee`.** The agent prepares; the human runs the privileged steps.

- [ ] **Step 1: Generate the write key on the host and register it**

`ssh-keygen` into `/etc/lyly-admin/id_lychee_resources`, `lyly-admin:lyly-admin` `0600`. Register the public half on `lychee-resources` as a deploy key **with write access**, titled in the established convention (`lychee (root) — …` becomes `lychee (lyly-admin) — declaration writes`).

This is the first **writable** key on the host. Every existing one is read-only.

- [ ] **Step 2: Verify the app user can push, before trusting the UI**

As `lyly-admin`, with the identity pinned, push a no-op commit to a scratch branch and delete it. A failure here is a permissions or `IdentitiesOnly` problem, and finding it by clicking Deploy is worse.

- [ ] **Step 3: Confirm `available` appears**

After one tick, `palsave-api`'s inventory row should carry `available`. If GHCR holds only `0.3.0`, no Deploy is offered and that is correct — publish a `0.3.1` to exercise it.

- [ ] **Step 4: Deploy, and watch the window**

Click Deploy. The row should read **applying** with both versions, then settle to the new version within one tick. That transition is the whole slice.

- [ ] **Step 5: Roll back by the same control**

Deploy the older tag. Rollback using the same path as deploy is the property worth proving once, deliberately, while you are watching.
