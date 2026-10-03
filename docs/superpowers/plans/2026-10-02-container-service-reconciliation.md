# Container Service Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `palsave-api` as a container reconciled from a bounded declaration, so that `lyly-admin` can later write such declarations without ever gaining the ability to execute a command as root.

**Architecture:** A new private `lychee-services` repo holds one declaration per service and is read-only to the reconciler. `lychee-ops` owns a Python validator, a mount vocabulary, and a compose template — everything that determines privilege. Four fields come from the declaration; the rest comes from root-owned templates. `lyly-admin` reads live container state through a new sudo-pinned wrapper, reusing the `containerStatus.ts` parser it already has.

**Tech Stack:** Ansible (core 2.20.1, pinned to the host), Python 3 stdlib + PyYAML for the validator, `unittest` for its tests (no new dependency — the same reasoning that chose Node's built-in runner for `lyly-admin`), Docker Compose, TypeScript/`node:test` in `lyly-admin`.

**Spec:** `docs/superpowers/specs/2026-10-02-container-service-reconciliation-design.md`

## Global Constraints

- `image` must match `ghcr.io/lycheehome/*` and carry an explicit tag. `:latest` and untagged names are refused.
- `bind` allowlist is `127.0.0.1` only.
- Reserved ports, refused: `8787` (lyly-admin), `2019` (Caddy admin API).
- Declaration fields, exhaustive: `name`, `image`, `state`, `port`, `bind`, `mounts`, `state_volume`. Anything else is **rejected, not ignored** — including the reserved-for-later `env_from` and `env_keys`.
- `state` enum: `running` | `stopped` | `absent`. Default `running`.
- `absent` runs `docker compose down` and **never** `-v`. No step in this plan may purge a named volume.
- Deleting a declaration file does nothing. A running container with no declaration is reported as drift, never acted on.
- Validate every declaration before applying any. A tick that cannot validate the whole set applies none of it.
- Ansible pin is `ansible-core==2.20.1`, tracking the host. Do not bump it as part of this work.
- `lyly-admin` gains **no new privilege** beyond one narrowly-pinned status wrapper.
- Nothing in `palsave-api`'s CI may use a self-hosted runner.

## Review Focus

These are the input classes the spec implies but no task's happy path exercises. Each has its test placed in the task that owns the code.

1. **Version skew between the reconciler and `lyly-admin`.** They deploy independently from separate repos, so an inventory emitting `kind` will meet an app that predates it, and an app expecting `kind` will meet an inventory without it. Both directions must degrade to a rendered row, never a thrown parse. *(Task 7)*
2. **A declaration that is not valid YAML at all.** Not a schema violation — a parse error. It must fail that one service loudly and leave the others reconcilable on a later tick, not abort the play. *(Task 2)*
3. **Two declarations claiming the same port.** Each is individually valid; the pair is not. Nothing in a per-file schema check catches it. *(Task 2)*
4. **`docker compose ps --format json` shape drift.** `containerStatus.ts` already documents that compose versions differ here; the service path must inherit that tolerance rather than reimplement parsing. *(Task 7)*
5. **A resolved mount source that exists but is empty.** Passes every existence check and produces the exact symptom — healthy container, no snapshots — that three separate defects share. *(Task 4)*

---

### Task 1: `palsave-api` image and publishing CI

**Repo:** `LycheeHome/palsave-api`

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `.github/workflows/` — add image build/push on release
- Test: `tests/test_image.py`

**Interfaces:**
- Produces: a pullable `ghcr.io/lycheehome/palsave-api:<semver>` whose entrypoint runs `main.py`, whose `PALSAVE_API_OOZ_LIB_PATH` default points inside the image, and which runs as a non-root uid/gid matching the host's `992:979`.

- [ ] **Step 1: Write the failing test**

`tests/test_image.py`, skipped when `docker` is absent so the suite stays runnable off-host:

```python
def test_image_runs_as_nonroot_with_ooz_available():
    # docker build -t palsave-api:test .
    # docker run --rm palsave-api:test id -u          -> "992"
    # docker run --rm palsave-api:test python -c "import decompress"
    #   with no PALSAVE_API_OOZ_LIB_PATH set -> exits 0

def test_image_carries_no_build_toolchain():
    # docker run --rm palsave-api:test sh -c "command -v gcc || true" -> empty
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_image.py -v` (or the repo's existing runner)
Expected: FAIL — no `Dockerfile`.

- [ ] **Step 3: Write the `Dockerfile`**

Multi-stage. Final stage: a slim Python base whose libc matches what `ooz/bin/libooz.so` was built against, `requirements.txt` installed, `ooz/` copied in, `USER 992:979`, and `ENV PALSAVE_API_OOZ_LIB_PATH` set to the in-image path. No compiler in the final layer. `.dockerignore` excludes `.git`, `.venv`, `tests`, `docs`, `.idea`, `__pycache__`.

The libc match is the risk the spec names as most likely to fail first. If the slim base cannot load the library, record which base does in a comment rather than silently switching to a fat image.

- [ ] **Step 4: Run the tests to verify they pass**

Run: the repo's test command
Expected: PASS.

- [ ] **Step 5: Add the publishing workflow**

A job triggered on release publication — `permissions: packages: write`, `runs-on: ubuntu-latest`, login to `ghcr.io` with `GITHUB_TOKEN`, build and push tagged with the release's semver. Do not tag `latest`; the validator refuses it, and a tag nothing can reference is a trap.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore .github/workflows tests/test_image.py
git commit -m "feat: publish a container image"
```

---

### Task 2: the declaration validator

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Create: `roles/services_host/files/validate_declarations.py`
- Create: `tests/test_validate_declarations.py`
- Modify: `tests/run.sh` — run the Python suite alongside the Ansible one

**Interfaces:**
- Produces: `validate(declarations: dict[str, dict], vocabulary: dict[str, dict]) -> tuple[list[dict], list[dict]]` returning `(valid, errors)`. Each error is `{"name": str, "field": str, "message": str}` — `field` is what makes a rejection actionable, and the spec requires the rejection to name it. Each valid entry is the declaration plus a resolved `mounts` list of `{"source", "target", "mode", "group"}`.
- Invoked as a script: reads a directory of `*.yml` and a vocabulary file, writes the `(valid, errors)` pair as JSON to stdout. Ansible consumes that.

- [ ] **Step 1: Write the failing tests**

`tests/test_validate_declarations.py`, using `unittest`. One test per rule, each asserting the error's `field`:

```python
def test_rejects_unknown_field()                  # field == "command"
def test_rejects_reserved_env_fields()            # env_from, env_keys
def test_rejects_image_outside_namespace()        # docker.io/evil/x:1
def test_rejects_floating_tag()                   # ...:latest, and untagged
def test_rejects_reserved_port()                  # 8787, 2019
def test_rejects_non_loopback_bind()              # 0.0.0.0
def test_rejects_unknown_mount_alias()
def test_rejects_name_not_matching_filename_stem()
def test_rejects_state_outside_enum()
def test_accepts_the_palsave_api_declaration()    # resolves mounts
def test_malformed_yaml_fails_only_that_service() # Review Focus 2
def test_duplicate_port_across_declarations()     # Review Focus 3
```

`test_malformed_yaml_fails_only_that_service` asserts a second, well-formed declaration in the same directory still appears in `valid`. `test_duplicate_port_across_declarations` asserts both are rejected rather than one arbitrarily winning — the pair is the defect, and picking a winner hides it.

- [ ] **Step 1b: Write the failing state-table tests**

The spec's success criteria pin behaviour no per-field check covers. These belong with the validator because they decide *what action a declaration selects*, before any Docker call:

```python
def test_running_selects_up()
def test_stopped_selects_stop()
def test_absent_selects_down_without_volume_flag()   # asserts no "-v"
def test_missing_state_defaults_to_running()
def test_a_project_with_no_declaration_is_reported_as_drift_not_stopped()
```

`test_absent_selects_down_without_volume_flag` is the one that must never regress: `-v` destroys a named volume, and nothing else in this plan is irreversible.

- [ ] **Step 2: Run them to verify they fail**

Run: `python3 -m unittest tests.test_validate_declarations -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

`validate_declarations.py`. Stdlib plus `yaml` (present in the harness venv via ansible-core). Unknown-field rejection is a set difference against the exhaustive field list in Global Constraints, computed once — never a per-field allowlist that a new field could be added to without thought. Cross-declaration checks (the port pair) run after per-file checks, over the set that passed them.

- [ ] **Step 4: Run them to verify they pass**

Run: `python3 -m unittest tests.test_validate_declarations -v`
Expected: PASS, 17 tests.

- [ ] **Step 5: Wire it into `tests/run.sh`**

Add the `unittest` invocation before the `exec` line — `exec` replaces the process image, so anything after it never runs. The existing file documents this trap for its own cleanup; the same applies here.

- [ ] **Step 6: Commit**

```bash
git add roles/services_host/files/validate_declarations.py tests/test_validate_declarations.py tests/run.sh
git commit -m "feat: validate service declarations, rejecting unknown fields"
```

---

### Task 3: mount vocabulary, compose template, and the variables they need

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Create: `roles/services_host/files/mounts.yml`
- Create: `roles/services_host/templates/docker-compose.yml.j2`
- Modify: `group_vars/all.yml` — add `palworld_backup_dir`, `palworld_gid`, `lychee_services_dir`
- Test: `tests/test_services_render.yml`

**Interfaces:**
- Consumes: the resolved-mount shape from Task 2's `validate()`.
- Produces: a rendered `docker-compose.yml` per service at `{{ lychee_services_dir }}/<name>/docker-compose.yml`.

- [ ] **Step 1: Write the failing render test**

`tests/test_services_render.yml`, following the existing render-test idiom in `tests/test_swee_decide.yml` (one play per case, `lookup('template', ...)` against real `group_vars/all.yml`). Assert the rendered output for the `palsave-api` declaration:

- contains `group_add` carrying the `palworld` gid — **the mount is unreadable without it, and the failure is silent**
- `working_dir: /state`
- `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`
- `ports` binds `127.0.0.1` only
- `PALSAVE_API_BACKUP_DIR` is the container-side target `/saves`, never a host path
- contains no `command:`, `entrypoint:`, `privileged:` or `cap_add:`

- [ ] **Step 2: Run it to verify it fails**

Run: `tests/run.sh tests/test_services_render.yml`
Expected: FAIL — template missing.

- [ ] **Step 3: Add the variables**

In `group_vars/all.yml`, composed from what is already declared rather than restated: `palworld_backup_dir` from `palworld_install_dir` plus `palworld_world_guid`, and `palworld_gid` resolved rather than hardcoded. Comment why the GUID is load-bearing, pointing at the existing `palworld_world_guid` comment rather than repeating it.

- [ ] **Step 4: Write `mounts.yml` and the compose template**

`mounts.yml` carries `palworld_saves` and `site_files` exactly as the spec's Mount vocabulary section gives them, each with `source`, `target`, `mode`, `group`. The template takes one validated declaration plus its resolved mounts and emits the compose file in the spec's "What gets rendered" shape. `user:` and `group_add:` come from the template and the vocabulary, never from the declaration.

- [ ] **Step 5: Run the test to verify it passes**

Run: `tests/run.sh tests/test_services_render.yml`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add roles/services_host group_vars/all.yml tests/test_services_render.yml
git commit -m "feat: mount vocabulary and the service compose template"
```

---

### Task 4: the reconcile role, the declarations repo, and the first declaration

**Repo:** `LycheeHome/lychee-ops`, plus a new `LycheeHome/lychee-services`

**Files:**
- Create: `LycheeHome/lychee-services` (**private**) with `palsave-api.yml` and a `README.md`
- Create: `roles/services_reconcile/tasks/main.yml`
- Create: `roles/services_reconcile/tasks/apply_state.yml`
- Modify: `playbook.yml` — add the role after the existing app roles
- Test: extend `tests/test_services_render.yml`

**Interfaces:**
- Consumes: Task 2's validator script and Task 3's template and vocabulary.
- Produces: `/var/lib/lychee-inventory/` gains nothing yet; this task's output is running containers plus a per-service result recorded for Task 6 to publish.

- [ ] **Step 1: Create `lychee-services` and its first declaration**

Private repo. `palsave-api.yml` exactly as the spec's "The declaration" section gives it, pinned to the tag Task 1 published. The `README.md` states the two properties a reader must not have to infer: deleting a file does nothing, and the reconciler can only read this repo.

- [ ] **Step 2: Write the failing precondition test**

Add to `tests/test_services_render.yml` a case asserting the role **refuses to render** when a resolved mount source does not exist, and a second asserting it refuses when the source exists but is empty (**Review Focus 5**). Empty is the case that otherwise produces a healthy container and no snapshots.

- [ ] **Step 3: Run it to verify it fails**

Run: `tests/run.sh tests/test_services_render.yml`
Expected: FAIL — no such tasks.

- [ ] **Step 4: Implement `tasks/main.yml`**

In order: fetch `lychee-services` read-only using `/root/.ssh/id_lychee_services` → run the validator over the checkout → **fail the whole play before any apply if any declaration is invalid** → `stat` every resolved mount source and refuse a missing, non-directory, or empty one → render each compose file → include `apply_state.yml` per service.

Never let Docker create a missing bind source; that is what turns a config error into a clean start.

- [ ] **Step 5: Implement `tasks/apply_state.yml`**

The three-row state table from Global Constraints. Drift detection lists compose projects under `lychee_services_dir` with no declaration and **records** them without acting.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `tests/run.sh`
Expected: PASS, including the Task 2 and Task 3 suites.

- [ ] **Step 7: Commit**

```bash
git add roles/services_reconcile playbook.yml tests/test_services_render.yml
git commit -m "feat: reconcile container services from declarations"
```

---

### Task 5: the service-status wrapper and its sudoers pin

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Create: `roles/lyly_admin_host/files/lyly-admin-service-status.sh`
- Modify: `roles/lyly_admin_host/files/sudoers.example`
- Modify: `roles/lyly_admin_host/tasks/main.yml` — install it root:root `0700`

**Interfaces:**
- Produces: `sudo /usr/local/sbin/lyly-admin-service-status <name>` emitting `docker compose ps --all --format json` for `{{ lychee_services_dir }}/<name>/docker-compose.yml`, or exiting 0 with empty output when there is no compose file there.

- [ ] **Step 1: Write the wrapper**

A sibling of `lyly-admin-docker-status.sh`, not an extension of it. That script hardcodes `/var/www/$hostname` and refuses non-`.lyly.dev` names; a single wrapper serving two trees would need validation that distinguishes two namespaces, which is where this class of thing goes wrong. Each wrapper owns one prefix and is pinned separately.

Validate the service name against a strict charset — no `/`, no leading `.`, no `..` — and hardcode the `lychee_services_dir` prefix in the script, as the sibling does.

- [ ] **Step 2: Pin it in `sudoers.example`**

Alongside the existing entries, in the same style. Note in the comment that its argument is a service name, not a hostname, so the two wrappers are not interchangeable.

- [ ] **Step 3: Verify the sudoers file still parses**

Run: `visudo -csf roles/lyly_admin_host/files/sudoers.example`
Expected: parses clean. `tests/run.sh` runs this same check.

- [ ] **Step 4: Verify the wrapper is valid shell**

Run: `sh -n roles/lyly_admin_host/files/lyly-admin-service-status.sh`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add roles/lyly_admin_host
git commit -m "feat: a status wrapper for declared service containers"
```

---

### Task 6: the inventory learns `kind`

**Repo:** `LycheeHome/lychee-ops`

**Files:**
- Modify: `roles/inventory/templates/services.json.j2:4` — stop hardcoding `'unit': s.unit`
- Modify: `roles/inventory/defaults/main.yml` — support a `container:` key
- Test: extend the existing inventory render test

**Interfaces:**
- Produces: each entry carries `kind: "unit" | "container"`, plus `unit` **or** `container`. For `kind: "container"`, `version` is the image tag from the declaration.

**`palsave-api` stays a `unit` entry in this task.** Declaring it a container before one runs would put the board's grey row there deliberately — the exact failure this work exists to avoid. Task 8 flips it at cut-over.

- [ ] **Step 1: Write the failing render test**

Assert a `unit`-kind entry still emits `unit` and now also `kind: "unit"`, and that a `container`-kind entry emits `container` and `kind: "container"` and no `unit` key.

- [ ] **Step 2: Run it to verify it fails**

Run: `tests/run.sh`
Expected: FAIL — no `kind` in the output.

- [ ] **Step 3: Implement the template change**

The base dict becomes conditional on which key the entry carries. Keep the existing `reconciled` semantics unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `tests/run.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add roles/inventory tests/
git commit -m "feat: inventory entries carry kind"
```

---

### Task 7: `lyly-admin` renders container rows

**Repo:** `LycheeHome/lyly-admin`

**Files:**
- Modify: `src/lib/serviceInventory.ts:19-36` — `InventoryEntry` becomes a discriminated union
- Modify: `src/lib/serviceBoard.ts:27-60` — `findTimerUnit`, `buildBoard`
- Modify: `src/lib/systemCommands.ts:146-160` — add the service-status reader
- Modify: `src/routes/services.ts` — fetch container states concurrently
- Test: `src/lib/serviceInventory.test.ts`, `src/lib/serviceBoard.test.ts`, `src/routes/services.test.ts`

**Interfaces:**
- Consumes: Task 6's `kind` field and Task 5's wrapper.
- Produces: `type InventoryEntry = UnitEntry | ContainerEntry`, both extending a common base with `name`, `group`, `reconciled` and the optional deploy fields. `UnitEntry` has `kind: "unit"; unit: string`; `ContainerEntry` has `kind: "container"; container: string`. `buildBoard(inv, states, schedule, containerStates)` where `containerStates: Record<string, UnitStatus>` is keyed by compose project name.

Deliberately `UnitStatus` and not `UnitState`: `UnitState` carries `since`, and `docker compose ps` reports elapsed text ("Up 2 hours"), not a start timestamp. A container row therefore has `since: null`, which is honest. Do not synthesise a timestamp by parsing that text.

A union rather than optional fields, so the compiler names every site that reads `.unit` without narrowing. That list is the migration.

- [ ] **Step 1: Write the failing tests**

```ts
test("an entry with kind container parses and keeps its project name")
test("an entry with kind unit is unchanged")
test("an entry with no kind is read as a unit")              // Review Focus 1
test("an entry with kind container but no container field is dropped")
test("a container row with no live state reads unknown, not exited")
test("findTimerUnit ignores container entries")
test("the board renders unit and container rows in the same groups")
test("a failed container status read degrades to unknown, not a 500")
test("container status is parsed by containerStatus.ts, not a second parser") // Review Focus 4
```

`test("an entry with no kind is read as a unit")` is the version-skew direction that matters most: a new app meeting an old inventory. The other direction — old app, new inventory — needs no code here, but **confirm by inspection** that today's shipped parser drops an unknown-shaped entry rather than throwing, and record the finding in the task's report.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL.

- [ ] **Step 3: Implement the union in `serviceInventory.ts`**

`toEntry` branches on `kind`, defaulting to `"unit"` when absent. Keep `UNIT_NAME` applied to unit entries only; validate a container project name against its own charset. Preserve degrade-never-throw: an unrecognised entry returns `null` as today.

- [ ] **Step 4: Implement the board and the reader**

`findTimerUnit` narrows to `kind === "unit"` before touching `.unit`. `buildBoard` takes the container map and looks each row up by its own identifier. In `systemCommands.ts`, add the wrapper call and map its output through the **existing** `containerStatus.ts` parser rather than a second one — that parser already absorbs compose version differences.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all clean.

- [ ] **Step 6: Run the design detector**

Run: `node <impeccable-skill-dir>/scripts/detect.mjs --json src/views`
Expected: `[]`. The hook is configured but not firing (CLAUDE.md), so this is run by hand.

- [ ] **Step 7: Commit**

```bash
git add src/
git commit -m "feat: render container services on the board"
```

---

### Task 8: cut-over

**Operator-run on `lychee`.** Not an implementation task — the agent prepares the commits and the runbook; the human runs the privileged steps.

**Files:**
- Modify: `lychee-services/palsave-api.yml` — none, it already exists
- Modify: `lychee-ops` `roles/inventory/defaults/main.yml` — `palsave-api` becomes a `container` entry
- Modify: `lychee-ops` `roles/palsave_api_host/tasks/main.yml` — the unit declared **absent**

- [ ] **Step 1: Place the two host credentials**

`/root/.ssh/id_lychee_services` plus its `Host` alias block, and the `read:packages` token for `ghcr.io`. Neither can be bootstrapped by the reconciler.

- [ ] **Step 2: Stop the reconcile timer**

```bash
sudo systemctl stop lyly-reconcile.timer
```

At step 2, not step 7. The reconciler races hand-migrations.

- [ ] **Step 3: Confirm the image pulls**

```bash
sudo docker pull ghcr.io/lycheehome/palsave-api:<tag>
```

First private `ghcr.io` pull on this host, so this is the step that proves the credential, separately from everything else.

- [ ] **Step 4: Run one reconcile by hand and inspect the rendered compose**

Confirm `group_add`, `working_dir: /state`, and a `/saves` source that exists and is **non-empty** before anything starts.

- [ ] **Step 5: Disable the unit and start the container**

```bash
sudo systemctl disable --now palsave-api
sudo docker compose -f /etc/lychee-services/palsave-api/docker-compose.yml up -d
```

- [ ] **Step 6: Verify by positive read, not liveness**

The API answers on `127.0.0.1:8788`; the container lists a non-zero number of backup files it can open; a new snapshot is written; `state.json` grows. A healthy container seeing an empty directory is the expected symptom of three separate defects, so an answering endpoint proves nothing on its own.

- [ ] **Step 7: Restart the timer and confirm the board**

```bash
sudo systemctl start lyly-reconcile.timer
```

`/services` shows `palsave-api` with live container state and a version matching the image tag.

- [ ] **Step 8: Leave the old installation in place**

`/opt/palsave-api`, its venv and `/var/lib/palsave-api` are **not** deleted. That is what makes rollback a revert of the two commits rather than a rebuild. Purging them is a separate, later, deliberate action.

---

# Cut-over watchlist

Produced by the whole-branch review, after all seven tasks were implemented and
reviewed. **Nothing below can be proved by a test** — these are the properties
that exist only on the host. Ordered.

1. **Confirm the image tag exists** in `ghcr.io/lycheehome/palsave-api` *before*
   `lychee-services` gains a remote. Nothing downstream can detect a fictional
   tag: the validator requires an explicit tag and cannot know it is imaginary.
2. Place `/root/.docker/config.json` (`read:packages`) and
   `/root/.ssh/id_lychee_services` plus its `Host` alias block. Confirm **as
   root** that `docker pull <the exact tag>` succeeds. This is the host's first
   private GHCR package, and nothing in the repo creates that credential.
3. **Stop `lyly-reconcile.timer` first** — step 0, not step 8. The reconciler
   races hand migrations.
4. Run the play by hand with the declaration at `state: stopped`, then **read
   the rendered compose file with your eyes**: `user: "992:979"`;
   `group_add: ["1004"]` quoted and **not** `["None"]`; the mount ending
   `/backup/world:/saves:ro` (world, not backup); `working_dir: /state`;
   `read_only: true`; `cap_drop: [ALL]`; and **no `/app/ooz` anywhere** in
   `environment`.
5. Confirm both `getent` assertions ran and passed — the only host-only logic in
   `main.yml` besides the fetch. `id palsave-api` must still report
   `uid=992 gid=979 groups=979,1004(palworld)`.
6. **Verify the mount is readable as the container's credentials.** The
   reconciler checks the leaf only, so an unreadable *ancestor* still hides a
   readable leaf: `sudo -u palsave-api ls <backup/world>` must list timestamp
   folders, each containing a readable `Level.sav`.
7. **Flip the declaration to `running` and let a tick apply it BEFORE restarting
   the timer.** Order matters: hand-starting the container while the declaration
   still reads `stopped` means the first tick after the timer returns stops it
   again, which presents as "the container died on its own".
8. **Positive read, extended past the spec's.** Not "a snapshot was written" —
   that passes even when Oodle decompression is broken, because the archive is
   written before the parse. Require: no `failed to load/parse` lines in
   `docker compose logs`, **and** `/events/new-pals` non-empty after two backup
   rotations.
9. Watch logs a few minutes for `read_only: true` fallout. Nothing writes
   outside `/state` and `PYTHONDONTWRITEBYTECODE=1` is baked in, but a
   dependency wanting a cache would crash-loop here and it is untested.
10. Only then flip the inventory entry. Check `/services` shows a live container
    row with the image tag as its version — and if `lyly-admin` has not
    redeployed yet, check the old board too: the row must be **absent**, not grey.
11. Watch `journalctl -u lyly-reconcile.service` across three ticks for `ok` with
    no `changed`. A permanently-`changed` task is how an idempotence bug hides,
    and only the host can confirm the `changed_when` words.
12. Record the real volume name from `docker volume ls` — expect
    `palsave-api_palsave-api_state`, since Compose prefixes the project. Know it
    before you need to back it up.

**Do not tidy `/opt/palsave-api`, its venv, or `/var/lib/palsave-api`.** The
revert path depends on them; that is what makes rollback a revert of two commits
rather than a rebuild.
