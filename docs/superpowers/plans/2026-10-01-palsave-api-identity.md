# palsave-api identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `palsave-api` off the shared `steam` identity onto its own user, bring its deployment under the reconciler, and retire `steam`'s blanket root — which nothing will need once this lands.

**Architecture:** Four phases whose order is forced by one requirement: `palsave-api` keeps serving `/events/new-pals` at every step. The repo gains a configurable library path and release tooling; `lychee-ops` then declares the unit, the permission chain and a pinned tag **while the service still runs as `steam`**; the human migrates; and only then do the two `steam` drop-ins go.

**Tech Stack:** Python 3.14 / FastAPI / uvicorn, Ansible (`ansible-core` 2.20.1 pinned in `tests/run.sh`), systemd, release-please.

**Spec:** `docs/superpowers/specs/2026-10-01-palsave-api-identity-design.md`

## Global Constraints

- **`palsave-api` gets no sudo.** It has no `subprocess`, no `sudo`, no `journalctl` call sites — verified by grep across the repo, where every hit is inside its own `deploy/setup.sh`. If an implementation finds itself adding a sudoers entry, something is wrong with the implementation.
- **Read-only on the game tree.** `watcher.py`'s `archive_snapshot` copies out with `shutil.copy2`; `prune_snapshots` unlinks only within its own `archive_dir`. Nothing writes into the save tree and nothing should start.
- **`palsave-api` user:** `nologin`, own primary group, supplementary `palworld` only. Not `adm`, not `sudo`, not `steam`.
- **`/opt/palsave-api`** holds the checkout, `.venv`, `.env` and deploy markers, `0750`. **`/var/lib/palsave-api`** holds `snapshots/`, `state.json` and `lib/libooz.so`, `0750`. `WorkingDirectory` points at the second.
- **`ARCHIVE_DIR` and `STATE_PATH` in `config.py` are relative** (`Path("snapshots")`, `Path("state.json")`), so they resolve against `WorkingDirectory`. This is why the split works with no code change, and why nothing may make them absolute.
- **`decompress.py` is self-contained** by design, and must stay so. `config.py` requires `PALSAVE_API_BACKUP_DIR` at import, so importing config from `decompress` would make every decompression test depend on an env var it has no business needing.
- **The CI job must be named exactly `test`.** The reconciler's gate matches a *job* name; a rename silently stops every deploy while reporting `no job named test`, which reads like CI never ran.
- The world GUID on this host is `193A17D5712D4FCAB5C3ADD97C905006`. `UMask=0022` on `palworld-palchuds`; rotation folders are already `0755` and `Level.sav` `0644`.

## Review Focus

Five failure modes the spec implies that no task's tests would otherwise exercise, most likely first.

1. **`palsave-api` reads an empty directory and reports healthy.** It polls; an empty directory and an unreadable one are indistinguishable from a `200` on `/events/new-pals`. Every verification row but one can pass while the service sees nothing. Pinned to the Phase B precondition and the Phase C matrix's palfeed row.
2. **The snapshot archive or `state.json` is lost in the move**, so the watcher restarts from zero and re-announces catches swee already posted. Pinned to Phase C steps 4 and 6 — the copy, and the ownership assertion that must come *after* the last copy rather than before the first — and to the matrix rows that read both back.

   This is no longer hypothetical. An earlier draft had Phase B point `WorkingDirectory` at `palsave_api_state_dir` while the service still ran from `palsave_api_dir`, which would have produced exactly this: the watcher starting from zero in an empty directory, swee re-announcing the whole rotation window, and step 4 then copying a stale `state.json` over what it had written since. It would also have failed the restart outright, because that directory did not exist — see Task 6 Step 2. **Moving `WorkingDirectory` is moving the state**, and the two belong in one commit.
3. **`libooz.so` is not where the new config says**, so Oodle saves fail while zlib ones keep working — a partial failure that looks like nothing at all. Pinned to Task 1's test and the Phase C matrix.
4. **The permission chain is declared but the service still cannot read**, because a link was missed or the GUID is wrong. Pinned to Task 4 and the Phase B precondition, which tests it with `swee` as a stand-in before anything depends on it.
5. **A new world GUID appears** and the declaration covers nothing. No test can catch this; it is recorded in the spec and in Task 4's comment so it is recognisable.

---

## File Structure

**`palsave-api`** (phase A):
- Modify `decompress.py` — library path from the environment, self-contained.
- Modify `tests/test_decompress.py` — cover the override and the default.
- Create `.github/workflows/ci.yml` — job named `test`.
- Create `release-please-config.json`, `.release-please-manifest.json`.

**`lychee-ops`** (phases B–D):
- Modify `group_vars/all.yml` — identity, paths, pin, world GUID.
- Modify `roles/palworld_host/tasks/main.yml` — the permission chain, two rows higher and five deeper.
- Create `roles/palsave_api_host/` — the unit.
- Create `roles/palsave_api_app/` — the pinned deploy.
- Modify `playbook.yml`, `tests/test_swee_decide.yml`.

---

## Phase A — the `palsave-api` repo

Nothing here touches the host.

### Task 1: The Oodle library path comes from configuration

**Files:**
- Modify: `palsave-api/decompress.py:21`
- Test: `palsave-api/tests/test_decompress.py`

**Interfaces:**
- Produces: `PALSAVE_API_OOZ_LIB_PATH`, an optional environment variable. Task 6's migration sets it.

- [ ] **Step 1: Write the failing test**

```python
def test_ooz_path_defaults_to_the_repo_copy(monkeypatch):
    monkeypatch.delenv("PALSAVE_API_OOZ_LIB_PATH", raising=False)
    importlib.reload(decompress)
    assert decompress.OOZ_DLL_PATH.name == "libooz.so"
    assert decompress.OOZ_DLL_PATH.parent.parent.name == "ooz"


def test_ooz_path_honours_the_environment(monkeypatch, tmp_path):
    override = tmp_path / "lib" / "libooz.so"
    monkeypatch.setenv("PALSAVE_API_OOZ_LIB_PATH", str(override))
    importlib.reload(decompress)
    assert decompress.OOZ_DLL_PATH == override
```

Match the file's existing idiom — check whether `tests/` uses `unittest.TestCase` or pytest functions before writing, and follow what is there rather than this sketch's shape.

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_decompress.py -q`
Expected: FAIL on the second test — the path is currently computed from `__file__` and ignores the environment.

- [ ] **Step 3: Make it pass**

`decompress.py:21`, replacing the current line:

```python
# Absolute by configuration, repo-relative by default. The deployed service
# keeps this outside the install directory (/var/lib/palsave-api/lib), so its
# survival is a property of the layout rather than of which deploy module is
# in use: today's force-fetch leaves gitignored files alone (probed), but an
# rsync-style sync or a later clean: true would take it. Read from the
# environment rather than from config.py deliberately: this module is
# self-contained by design, and config.py requires PALSAVE_API_BACKUP_DIR at
# import, which would make every decompression test depend on an env var it
# has no business needing.
OOZ_DLL_PATH = Path(
    os.environ.get("PALSAVE_API_OOZ_LIB_PATH")
    or Path(__file__).with_name("ooz") / "bin" / "libooz.so"
)
```

Add `import os` if absent. Leave the `_get_ooz_lib()` error message intact — it already names `OOZ_DLL_PATH`, so it stays correct and now reports the configured path.

- [ ] **Step 4: Run the full suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS, output pristine. Report the exact count.

- [ ] **Step 5: Commit**

```bash
git add decompress.py tests/test_decompress.py
git commit -m "feat: the Oodle library path comes from configuration"
```

### Task 2: CI and release tooling

**Files:**
- Create: `palsave-api/.github/workflows/ci.yml`
- Create: `palsave-api/release-please-config.json`
- Create: `palsave-api/.release-please-manifest.json`

**Interfaces:**
- Produces: a workflow job named exactly `test`, which `lychee-ops`' gate matches by name.

- [ ] **Step 1: Copy swee's shape, do not invent one**

Read `swee/.github/workflows/ci.yml` and mirror it: a `test` job on `ubuntu-latest` running `pip install -r requirements.txt -r requirements-dev.txt` then `pytest tests/ -q`, plus the `release-please` job guarded on `github.event_name == 'push'`.

That guard is not optional and swee's copy explains why: without it, release-please runs on pull requests, where it asks for `contents:write` and `pull-requests:write` that a fork PR's token cannot grant — so every external contributor sees a failed check unrelated to their change.

`palsave-api` has no `requirements-dev.txt`; check before copying the install line, and add one containing `pytest` if it is missing.

- [ ] **Step 2: Add the entrypoint import check**

swee's CI gained this after a commit shipped a module that could not be imported while `pytest tests/ -q` reported green, because no test imported it. `palsave-api` has the same gap: `main.py` is imported by no test.

Add a step after pytest that imports it with the env vars `config.py` requires. **Verify it fails on a broken import before committing it** — break one temporarily, show the step exits non-zero, restore.

- [ ] **Step 3: release-please config**

`release-type: simple`, `changelog-path: CHANGELOG.md`, matching swee's. The manifest starts at the current version — there are no releases, so `"." : "0.1.0"` unless the repo says otherwise. Check `CLAUDE.md` and any existing version marker first.

- [ ] **Step 4: Verify locally**

Run: `python3 -m pytest tests/ -q`
Expected: unchanged from Task 1.

Run the import check by hand exactly as the workflow will.
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add .github release-please-config.json .release-please-manifest.json requirements-dev.txt
git commit -m "ci: add a test job and release tooling"
```

### Operator: cut the first release

Not a task. Merge the Phase A PR; release-please opens a release PR; merge that too. **Read the tag it cuts** rather than predicting it — this is the repo's first release, so the version comes from the manifest, not from commit types.

---

## Phase B — `lychee-ops` declares, without changing identity

### Task 3: Identity and path variables

**Files:**
- Modify: `lychee-ops/group_vars/all.yml`

- [ ] **Step 1: Add the variables**

```yaml
# palsave-api: watches the Palworld backup rotation, parses each new Level.sav
# and serves newly-acquired pals as an events feed that swee consumes.
#
# Still runs as steam at this point, from its own home directory — phase C
# moves it. These paths are declared now so the unit and the deploy can be
# brought under the reconciler first, which separates "did the deploy
# mechanism work" from "did the identity change work".
palsave_api_repo_slug: LycheeHome/palsave-api
palsave_api_repo_url: https://github.com/LycheeHome/palsave-api.git
palsave_api_version: ""        # set by the phase A release; empty blocks rather than guesses

palsave_api_user: steam        # becomes palsave-api in phase C
palsave_api_group: steam       # becomes palsave-api in phase C
palsave_api_dir: /home/steam/palsave-api   # becomes /opt/palsave-api in phase C

# Split from palsave_api_dir for the reason swee_state_dir is split from
# swee_dir: config.py's ARCHIVE_DIR and STATE_PATH are RELATIVE paths, so they
# resolve against WorkingDirectory. The reconciler rewrites the install
# directory on every pin bump; the snapshot archive and the watcher's position
# in the rotation must not be inside it.
palsave_api_state_dir: /var/lib/palsave-api

# Outside the install directory, and the reason is narrower than it first
# looks. ooz/bin/libooz.so is built on the host and is not in git — but
# ansible.builtin.git's force: true only resets TRACKED files; it never runs
# git clean, so today's fetch would leave it. Probed against tests/.venv, not
# inferred: a gitignored file and directory both survived a force-fetch to a
# different tag while the tracked file changed. What the split actually buys
# is independence from the deploy mechanism — an rsync-style sync, or this
# task gaining clean: true, would take it, and nothing rebuilds it.
palsave_api_ooz_lib: "{{ palsave_api_state_dir }}/lib/libooz.so"

# Moved off 8787, which lyly-admin also binds (on the LAN interface rather than
# loopback, so they coexist). The hazard is lyly-admin's health check: if its
# HOST ever fell back to loopback it would hit this service, get a 404, and
# report a failed deploy for a healthy app.
palsave_api_port: 8788

# The world whose backups palsave-api reads. Pinned, like palworld_instance —
# a NEW world creates a fresh 0700 GUID directory that these declarations do
# not cover, and palsave-api would stop seeing backups with no error, because
# it polls a directory and an empty one looks like a quiet one.
palworld_world_guid: 193A17D5712D4FCAB5C3ADD97C905006
```

- [ ] **Step 2: Collision check**

Run: `grep -rn 'palsave_api_\|palworld_world_guid' --exclude-dir=.git .`
Expected: hits only in `group_vars/all.yml`. Anything else is a collision.

- [ ] **Step 3: Syntax check and commit**

Run: `./tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml`
Expected: exit 0.

```bash
git add group_vars/all.yml
git commit -m "feat: name the pieces of palsave-api's identity"
```

### Task 4: Extend the permission chain

**Files:**
- Modify: `lychee-ops/roles/palworld_host/tasks/main.yml`

- [ ] **Step 1: Add seven rows to the existing loop**

Two above the install root and five below `Saved`, in depth order so the mode column reads straight down:

```yaml
    - { path: "{{ games_root }}", group: root, owner: root, mode: "0755" }
    - { path: "{{ palworld_root }}", group: root, owner: root, mode: "0755" }
```

and, after the existing `Pal/Saved` row:

```yaml
    - { path: "{{ palworld_install_dir }}/Pal/Saved/SaveGames", group: "{{ palworld_group }}", mode: "2755" }
    - { path: "{{ palworld_install_dir }}/Pal/Saved/SaveGames/0", group: "{{ palworld_group }}", mode: "2750" }
    - { path: "{{ palworld_install_dir }}/Pal/Saved/SaveGames/0/{{ palworld_world_guid }}", group: "{{ palworld_group }}", mode: "2750" }
    - { path: "{{ palworld_install_dir }}/Pal/Saved/SaveGames/0/{{ palworld_world_guid }}/backup", group: "{{ palworld_group }}", mode: "2750" }
    - { path: "{{ palworld_install_dir }}/Pal/Saved/SaveGames/0/{{ palworld_world_guid }}/backup/world", group: "{{ palworld_group }}", mode: "2750" }
```

The existing loop's `owner` is `{{ steam_user }}`; the two `games_root` rows need `owner: root`, so check whether the loop's `owner` is per-item or fixed and adjust rather than silently changing the owner of two root-owned directories.

- [ ] **Step 2: Comment why these five, and why only once**

These are the only directories between `Saved` and the backup rotation, and they are `0700 steam:steam` — created once at world setup, explicitly, not inherited from a umask. Everything the game creates **on rotation** is already group-accessible: `UMask=0022` is honoured there, rotation folders are `0755` and `Level.sav` is `0644`. So this is a one-time fix to a fixed path, not an ongoing battle with a live writer, and it needs no `UMask=` change on the game server and no ACLs.

Say in the comment that the world GUID is pinned and what a new world would cost, per Review Focus #5.

- [ ] **Step 3: Run the suite**

Run: `./tests/run.sh`
Expected: green, pristine. Report the exact counts; the loop's items are not individually asserted, so expect no change.

- [ ] **Step 4: Commit**

```bash
git add roles/palworld_host/tasks/main.yml
git commit -m "fix: the path to the backups was declared only halfway down"
```

### Task 5: The unit, and the pinned deploy

**Files:**
- Create: `lychee-ops/roles/palsave_api_host/templates/palsave-api.service.j2`
- Create: `lychee-ops/roles/palsave_api_host/tasks/main.yml`
- Create: `lychee-ops/roles/palsave_api_host/handlers/main.yml`
- Create: `lychee-ops/roles/palsave_api_app/` (tasks, defaults)
- Modify: `lychee-ops/playbook.yml`, `lychee-ops/tests/test_swee_decide.yml`

- [ ] **Step 1: The unit template**

Start from the unit the repo already ships — `palsave-api/deploy/palsave-api.service` — and substitute rather than invent, the way `palworld_host` did. `ansible.builtin.template` writes wholesale, so anything live but unrecorded is silently dropped with no symptom until the next restart.

`WorkingDirectory={{ palsave_api_state_dir }}`, `ExecStart={{ palsave_api_dir }}/.venv/bin/python {{ palsave_api_dir }}/main.py`, `User={{ palsave_api_user }}`, and an `Environment=` line setting `PALSAVE_API_OOZ_LIB_PATH={{ palsave_api_ooz_lib }}`.

Comment why `WorkingDirectory` and the install directory differ, in the unit itself where someone reading the installed file on the host will find it.

- [ ] **Step 2: The role, with a restart handler**

Unlike `palworld_host`, restarting this service is cheap — it is a watcher with no connected users, and it re-reads its position from `state.json`. So it gets `Reload systemd` and `Restart palsave-api` handlers, the `swee_host` shape rather than the `palworld_host` one, with `enabled: true` as a **task** and not on the restart handler, for the reason `palworld_host`'s comment gives: a handler only asserts enablement when the unit's bytes change.

Flush handlers at the end of the role, not at end of play — `swee_host`'s comment explains the defect that makes this necessary.

- [ ] **Step 3: The app role**

Mirror `roles/swee_app`: read the installed tag, decide whether the pin moved, resolve the tag, gate on the `test` job, fetch, install dependencies, restart, health-check, write a status file, with the retry cap.

**This is a third near-copy of a role that already exists twice.** Do not consolidate the three as part of this task — `swee_app` and `lyly_admin_app` are both working and reconciling a live host, and refactoring them is a change with its own risk that deserves its own slice. Record the duplication in the role's own comment so the next person sees it was noticed rather than missed.

`PIP_CACHE_DIR` on the install task, with the directory **declared** — `lyly_admin_app` declares `{{ ops_root }}/.npm` and `swee_app` now declares `{{ ops_root }}/.pip`; an environment variable without the directory disables the cache rather than relocating it.

The health check is an HTTP GET against `/events/new-pals` on `{{ palsave_api_port }}`, expecting `200`. Note in a comment what that does and does not prove: it proves the process bound its port and the API answers, and proves **nothing** about whether the watcher can read the backups — see Review Focus #1.

- [ ] **Step 4: Wire it into the playbook**

`palsave_api_host` beside the other `_host` roles, `palsave_api_app` beside the other `app`-tagged ones. Verify with `grep -n 'roles:\|- .*_host\|- {.*role' playbook.yml` and confirm placement; do not use `-A8`, whose output cannot contain an app-tagged role.

- [ ] **Step 5: Render test**

Add a play to `tests/test_swee_decide.yml` mirroring the `swee.service.j2` one: **synthetic** fixture values for every interpolation, a **whole-body** compare against an expected literal, and negative assertions that neither the production paths nor `/home/steam` leak in.

Synthetic values are the point — fixtures equal to `group_vars` would let a template that hardcoded a real path render identically and pass. The whole-body compare catches an unreviewed **addition** as well as a deletion, which a set of substring checks cannot.

- [ ] **Step 6: Prove it bites**

Delete one literal line from the template, run the suite, show it FAILS naming that assertion, restore, show green. Paste both.

- [ ] **Step 7: Run the suite and commit**

Run: `./tests/run.sh` and `--syntax-check`.
Expected: green, exit 0.

```bash
git add roles/palsave_api_host roles/palsave_api_app playbook.yml tests/
git commit -m "feat: bring palsave-api's unit and deployment under the reconciler"
```

### Operator: Phase B — capture the live unit BEFORE merging

Phase B is the phase that first replaces `/etc/systemd/system/palsave-api.service`, and `ansible.builtin.template` has no inverse. Phase C has a step 0 for exactly this reason; Phase B needs one too, and it is more urgent here: the rendered unit's comment header differs from the one `setup.sh` installed, so the template is **certain** to report `changed` on the first tick, which means the restart handler is **certain** to fire.

```bash
sudo systemctl cat palsave-api | sudo tee /root/palsave-api.service.pre-reconciler
```

Then read it against the rendered body before merging. The directives were verified to match `palsave-api`'s own `deploy/palsave-api.service`, which is what installed the live file — but not against the live file itself. A hand-edit on the host (an added `Environment=`, an `EnvironmentFile=`, a `Group=`) would be dropped silently and would surface only at that restart.

`palsave_api_host` is the **last** host role, so a failed restart there skips all three app roles together and repeats every five minutes.

### Operator: Phase B verification, after merging, before Phase C

Merge, let a tick land, then — **this is the precondition the whole design rests on**:

```bash
NEWEST=$(sudo ls -d /srv/games/palworld/pal-chuds/Pal/Saved/SaveGames/0/*/backup/world/*/ | tail -1)
sudo -u swee cat "$NEWEST/Level.sav" > /dev/null && echo "a palworld member CAN read the backups"
```

`swee` is already a `palworld` member with its own identity, so it is a free stand-in for the user that does not exist yet. A failure here means the chain declaration is wrong — discovered while `palsave-api` is still running as the owner and nothing depends on it.

Note the `sudo ls -d` wraps the glob in a root-run command. A bare `sudo ls -d /path/*/` expands the glob in the *invoking* shell, which cannot traverse `0700` directories, matches nothing, and passes the literal through — which reads as "the directory is empty". That mistake was made twice while designing this slice.

Also check: `sudo cat /var/lib/palsave-api/deploy-status.json` reports `deployed` — **not `failed`, and not `blocked`**. A `failed` here means the health check could not reach the service, which is the shape a wrong `palsave_api_port` produces; a `blocked` naming the retry cap means it has already failed three times and will not retry until `/home/steam/palsave-api/.failed-tag` is removed.

And `systemctl show palsave-api -p User,WorkingDirectory` should be **unchanged** — `steam` and the old directory — because Phase B does not move anything. If either has changed, something from Phase C leaked into Phase B.

---

## Phase C — the migration

Run by hand. `palsave-api` is down for the duration; the game server is not touched.

**This runbook has been executed once, and three of its steps were in the wrong order.** They are corrected below, and what went wrong is recorded after the steps — the ordering constraints are not obvious, and two of the three fail silently.

0. **Stop the reconciler, then copy the unit aside.**
   ```
   sudo systemctl stop lyly-reconcile.timer
   sudo cp /etc/systemd/system/palsave-api.service /root/palsave-api.service.pre-identity
   ```
   The timer stops **first**, before anything else. `ansible-pull` runs every five minutes and re-declares ownership from whatever is on `main` — which, until step 9 merges, still says `steam`. A tick landing mid-migration silently reverts the `chown` in step 6. The copy is because `ansible.builtin.template` has no inverse, so the rollback has nothing to restore from without it.

   Two reads worth doing here, while the service is still up and a bad answer costs nothing:
   ```
   sudo /home/steam/palsave-api/.venv/bin/python --version   # must match:
   python3 --version                                          # step 7 rebuilds with this one
   sudo ls -l /home/steam/palsave-api/ooz/bin/libooz.so       # step 5 needs this to exist
   ```
   If the Python versions differ, pin step 7 to the known-good interpreter rather than letting an identity migration quietly carry a runtime upgrade — otherwise anything the new interpreter breaks gets blamed on the move. If `libooz.so` is missing, rebuild it now, not at step 5.
1. **Create the user.**
   ```
   sudo useradd --system --user-group --shell /usr/sbin/nologin --home-dir /opt/palsave-api --no-create-home palsave-api
   sudo usermod -aG palworld palsave-api
   id palsave-api
   ```
   `palworld` only. No `adm` — it reads no journals. One line, not a backslash continuation: the wrapped form mangles on paste.

   Check `id` before going further. The service is still up, so a missing `palworld` membership costs nothing to fix here — and if it is wrong, the end state is a service that starts, answers `200`, and reads a save directory it cannot see.
2. **Stop it.** `sudo systemctl stop palsave-api`
3. **Create `/opt/palsave-api`; take ownership of `/var/lib/palsave-api`.**
   ```
   sudo mkdir -p /opt/palsave-api /var/lib/palsave-api/lib
   sudo chown -R palsave-api:palsave-api /opt/palsave-api /var/lib/palsave-api
   sudo chmod 0750 /opt/palsave-api /var/lib/palsave-api
   ```
   **`/var/lib/palsave-api` already exists by this point**, created in Phase B as a side effect: `palsave_api_app_status_file` is `{{ palsave_api_state_dir }}/deploy-status.json`, so the app role has been declaring that directory since the pin landed — as `steam:steam 0750`, because that is what the variables said then. The `chown` here is what hands it over, and the next tick's app role re-declares it under the new values. Only `lib/` is genuinely new.

   This `chown` does not survive step 4. Step 6 is what makes it stick; this one exists so the directories are not root-owned in between.
4. **Move code and state separately.**
   ```
   sudo rsync -a --exclude='.venv' --exclude='snapshots' --exclude='state.json' /home/steam/palsave-api/ /opt/palsave-api/
   sudo cp -a /home/steam/palsave-api/snapshots /var/lib/palsave-api/
   sudo cp /home/steam/palsave-api/state.json /var/lib/palsave-api/
   ```
   Copy, never move: `/home/steam/palsave-api` stays intact as the rollback.
5. **Place the native library.**
   ```
   sudo cp /home/steam/palsave-api/ooz/bin/libooz.so /var/lib/palsave-api/lib/
   ```
   If it is absent, rebuild it before continuing — `decompress.py`'s `_get_ooz_lib()` error message carries the exact command. Without it, Oodle saves fail while zlib ones keep working, which looks like nothing being wrong.
6. **Fix ownership. After the last copy, before anything writes as the service account.**
   ```
   sudo chown -R palsave-api:palsave-api /opt/palsave-api /var/lib/palsave-api
   sudo chmod 0750 /opt/palsave-api /var/lib/palsave-api
   ```
   `rsync -a` run as root preserves source ownership, and with a trailing-slash source it applies the source directory's owner **and mode** to the destination directory itself — so step 4 reverts step 3 entirely, handing `/opt/palsave-api` back to `steam`. The `chmod` is here too for that reason, not only the `chown`.

   This has to precede step 7, not follow it: creating a venv **is** a write as `palsave-api`, so it fails against a `steam`-owned directory. Nothing after this step runs as root into these trees, so one assertion here is enough.
7. **Rebuild the venv.** It cannot be moved; `python3 -m venv` bakes absolute paths into its scripts.
   ```
   sudo -u palsave-api python3 -m venv /opt/palsave-api/.venv
   sudo -u palsave-api /opt/palsave-api/.venv/bin/pip install -q -r /opt/palsave-api/requirements.txt
   ```
   A pip warning about disabling its cache is expected and harmless: `sudo -u` may leave `HOME` pointing at the invoking user's home, which `palsave-api` cannot write. The reconciler avoids it with `PIP_CACHE_DIR`; a one-off hand run does not need to.
8. **Set the port in the `.env`.**
   ```
   sudo chmod 0600 /opt/palsave-api/.env
   sudo sed -i 's/^PALSAVE_API_PORT=.*/PALSAVE_API_PORT=8788/' /opt/palsave-api/.env
   sudo grep -n '^PALSAVE_API_PORT=' /opt/palsave-api/.env
   ```
   The last line prints the result rather than testing it. Exactly one `PALSAVE_API_PORT=8788` is correct; nothing means the key was absent and needs appending; two means something went wrong.

   Deliberately **not** `grep -q … || echo … | sudo tee -a`. That `grep` runs as the invoking user against a file this step just made `0600 palsave-api`, so it cannot distinguish "key absent" from "cannot read" from "file does not exist" — and appends a duplicate on any of the three. Looking at the line beats a conditional that cannot tell its own failure modes apart.
9. **Merge the Phase C `lychee-ops` PR** (Task 6), then apply:
   ```
   sudo flock /run/lyly-reconcile.lock ansible-pull -U git@github.com:LycheeHome/lychee-ops.git -d /var/lib/lychee-ops/ops -i inventory.yml --checkout main playbook.yml
   ```
   The timer is already stopped, from step 0. Blocking `flock`, not `-n -E 0`: the timer's invocation uses the latter so ticks do not pile up, but for a hand run it exits 0 silently on a contended lock and reports a no-op as success.
10. **Point swee at the new port, restart it, and restart the reconciler.**
    ```
    sudo sed -i 's#^PALFEED_SERVICE_URL=.*#PALFEED_SERVICE_URL=http://127.0.0.1:8788#' /opt/swee/.env
    sudo systemctl restart swee
    sudo systemctl start lyly-reconcile.timer
    systemctl is-active lyly-reconcile.timer
    ```
    **The timer restart is not optional and nothing else does it.** Step 9's play has an "Enable the reconcile timer" task which may restart it as a side effect — that is luck, not design, and leaving it to chance means a run where it does not fire leaves reconciliation dead for *all three* services, with deploys silently not happening. `systemctl status` on a stopped timer does not look like an incident. Confirm it is `active`.

### What went wrong when this was run

Recorded because two of the three failed silently, and the third's warning was already written into the step that caused it.

- **The venv was created before ownership was asserted**, and failed with `Permission denied: '/opt/palsave-api/.venv'`. The old step 7 carried the correct warning — "ownership is asserted after the last copy, not before the first" — and then scheduled the remedy one step *after* the first thing that needed it. Diagnosing the hazard is not the same as sequencing the fix.
- **The reconcile timer was left running**, and a tick at 02:19:50 re-declared `/var/lib/palsave-api` as `steam:steam` between two steps. The old runbook stopped it at step 8. The revert looks like operator error rather than a competing writer, because nothing announces the tick; it is visible only by correlating `systemctl show lyly-reconcile.service -p ExecMainStartTimestamp` against the directory's mtime.
- **Nothing restarted the timer.** The old step 8 stopped it, step 9 did not start it, and neither did anything after. It survived only because step 9's play happened to re-enable it.

The general shape, which outlives this runbook: an ordering constraint that is *documented* is not thereby *satisfied*, and a step that turns something off owns turning it back on.

### Task 6: Switch the declared identity

**Files:**
- Modify: `lychee-ops/group_vars/all.yml`
- Modify: `lychee-ops/roles/palsave_api_host/templates/palsave-api.service.j2` — this task changes the template, not only the variables. See Step 2.
- Modify: `lychee-ops/tests/test_swee_decide.yml`

- [ ] **Step 1: Flip the identity variables**

`palsave_api_user: palsave-api`, `palsave_api_group: palsave-api`, `palsave_api_dir: /opt/palsave-api`. Rewrite the comment above them — it explains that the service still runs as `steam` from its home directory, which goes false the moment this lands.

- [ ] **Step 2: Change the unit template — two lines Phase B deliberately left alone**

Phase B declared the unit **the service already had**, so the template still reads `WorkingDirectory={{ palsave_api_dir }}` and carries no `Environment=` line. Both change here, in the same commit as the state move, and **they cannot be separated from it**:

```
WorkingDirectory={{ palsave_api_state_dir }}
...
Environment=PALSAVE_API_OOZ_LIB_PATH={{ palsave_api_ooz_lib }}
```

**And `palsave_api_port: 8787` becomes `8788` here**, in `group_vars`, for the same reason. The service listens on `8787` until step 8 of the migration seds its `.env` — verified on the host, where `127.0.0.1:8787` answers `200` and nothing is bound to `8788`. Leaving `8788` live in Phase B points `palsave_api_app`'s health check at a port nothing listens on, so every tick fails it, `.deployed-tag` is never written, three alerts fire, and the pin wedges at the retry cap. Worse, `.failed-tag` then rides step 4's `rsync` into `/opt/palsave-api` and blocks Phase C's first tick too, with nothing here telling you to remove it.

Why Phase B could not do this, recorded because it was tried and would have been serious: `/var/lib/palsave-api` did not exist when Phase B was written, and systemd cannot start a unit whose `WorkingDirectory` is missing — so the restart handler fails, a failed handler fails the host, and every role after `palsave_api_host` is skipped, **including the app role that creates that directory**. It does not self-heal; it repeats every five minutes with palsave-api down and the other two services no longer deploying.

And even with the directory present it would have been wrong. `ARCHIVE_DIR` and `STATE_PATH` are relative, so moving `WorkingDirectory` moves the watcher's position: it restarts from zero, swee re-announces every catch in the rotation window, and step 4's copy then puts the old `state.json` back over whatever it wrote in between.

The `Environment=` line waits for the same reason — until the library is at `palsave_api_ooz_lib`, `decompress.py`'s own repo-relative default is the only path that finds it.

- [ ] **Step 3: The render test's expected literal moves, for both changes**

The whole-body compare fails until it does — that is the assertion working. Update the template and the literal in the same commit.

**Do not regenerate the literal from the template.** Doing so makes the two agree by construction and the assertion cannot catch an error in the edit. If you do regenerate it, say so and re-prove the assertion bites afterwards by deleting a line and watching it fail — the proof is what makes it trustworthy, not the green suite. (This happened during Phase B's fix; the proof is why it is still trusted.)

- [ ] **Step 4: Run the suite and commit**

Run: `./tests/run.sh`
Expected: green.

```bash
git add group_vars/all.yml roles/palsave_api_host/templates/ tests/
git commit -m "feat: palsave-api runs as itself"
```

### Verification matrix

| check | proves |
|---|---|
| `systemctl show palsave-api -p User,WorkingDirectory` | the identity and the state directory |
| `ps -o user=,cmd= -C python \| grep palsave` | it really runs as `palsave-api`, not merely declared to |
| `curl -s 'localhost:8788/events/new-pals?since=0&limit=1'` | it serves, on the new port |
| `sudo ls -la /var/lib/palsave-api/snapshots/ \| tail` | the archive is in the new location |
| `sudo cat /var/lib/palsave-api/state.json` | the watcher's position survived |
| **a new rotation folder is processed within ~60s** | **reading the game tree as a non-owner works** |
| **swee's palfeed posts a catch** | **the whole chain** |
| `sudo ls -l /var/lib/palsave-api/lib/libooz.so` | Oodle saves can still be decompressed |

The last two are the ones that matter. Everything above them can pass while the service quietly reads an empty or unreadable directory, because polling cannot distinguish "nothing new" from "cannot see anything".

**Rollback:** stop the service, `sudo cp /root/palsave-api.service.pre-identity /etc/systemd/system/palsave-api.service`, `daemon-reload`, revert the `lychee-ops` commit, apply, restore swee's `.env` port, start. `/home/steam/palsave-api` is untouched throughout.

---

## Phase D — retirement

### Task 7: Declare both `steam` drop-ins absent

**Files:**
- Modify: `lychee-ops/roles/palworld_host/tasks/main.yml` (or a new `steam_host` role — decide and say why)

- [ ] **Step 1: Declare them absent**

```yaml
- name: Remove steam's blanket root and the superseded palsave-api restart grant
  ansible.builtin.file:
    path: "{{ item }}"
    state: absent
  loop:
    - /etc/sudoers.d/steam-nopasswd
    - /etc/sudoers.d/palsave-api-self-restart
```

Comment what the journal showed: `steam-nopasswd` was used only by `deploy/setup.sh`'s July bootstrap — it needed root to install the sudoers file that grants root — and nothing at runtime, across a journal retaining to before either service existed. `palsave-api-self-restart` was never used at all; it existed for a CI runner deleted on 2026-09-28.

Declared absent rather than deleted once, because removing an example from a source repo does nothing to a host that already has the file installed.

- [ ] **Step 2: Decide where it lives**

`palworld_host` is about the game server, not about `steam`'s privileges, so this may belong in a small `steam_host` role instead. Pick one and justify it in the commit message; do not leave it somewhere that makes the role's name a lie.

- [ ] **Step 3: Run the suite and commit**

```bash
git add roles/ tests/
git commit -m "chore: steam needs no sudo at all"
```

- [ ] **Step 4: Verify after the tick**

```bash
sudo ls -l /etc/sudoers.d/
sudo -u steam sudo -n -l
sudo visudo -c
```

`sudo -n -l` as `steam` should now list **nothing** — or fail outright, which is the same answer. If it still lists something, read where it comes from before concluding the removal failed: `steam` is also in the `sudo` group, whose `%sudo ALL=(ALL:ALL) ALL` requires a password the locked account cannot supply.

---

## What this plan does not do

- **No container work.** `2026-09-25-managed-services-design.md` anticipates `palsave-api` becoming a container service; that is a later change.
- **No consolidation of the three app roles**, now that there are three near-copies. Recorded in Task 5 and deserving its own slice.
- **No second-world support.** The GUID is pinned. See Review Focus #5.
- **`/home/steam/palsave-api` is not deleted**, for the same reason `/home/steam/swee` still exists: it is the rollback, and its removal is a separate deliberate act.
