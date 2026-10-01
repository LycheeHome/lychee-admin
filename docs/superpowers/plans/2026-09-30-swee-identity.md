# swee identity separation (slice 1c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give swee its own system user, its own install and state directories, a mediated path to `steamcmd`, and a working `/update` — removing it from the `steam` identity it currently shares with the game server and `palsave-api`.

**Architecture:** Four phases whose order is forced by one requirement: `/update` works at every step. `lychee-ops` declares the wrapper and a sudoers drop-in naming **both** `steam` and `swee` while swee still runs as `steam`; swee's code change then ships through a release and a pin bump; then the human migrates; then the grants narrow to `swee` alone. No step leaves the bot unable to do the thing the grant exists for.

**Tech Stack:** Ansible (`ansible-core` 2.20.1, pinned in `tests/run.sh`), Python 3.14, systemd, sudo, release-please.

**Spec:** `docs/superpowers/specs/2026-09-29-service-identities-and-game-layout-design.md` — Decisions 4, 5, 6 and 7, plus the `1c — swee's identity` decomposition section. Slice 1b's outcome is recorded in *What the 1b migration turned up*; this plan assumes that state.

## Global Constraints

- **swee never runs as root**, and never gains write on the game install. The wrapper is the only path by which it can update the server, and that is deliberate: updating is the one capability that genuinely requires being `steam`, so it is mediated rather than granted.
- **`/update` works at every step.** This is what forces the ordering. A grant narrowed before the process it serves has changed identity breaks the bot; a code change shipped before the wrapper exists breaks it too.
- **The wrapper takes no arguments.** Every value in swee's current `steamcmd` invocation already comes from configuration rather than Discord input, so the wrapper hardcodes all of it and the grant needs no wildcards. `/usr/local/sbin/swee-update-palworld`, `root:root`, mode `0700`.
- **The venv cannot be moved.** `python3 -m venv` bakes absolute paths into its scripts. `swee_app`'s `Install dependencies` runs `{{ swee_dir }}/.venv/bin/pip` — it installs into a venv, it does not create one. The migration creates it.
- **`PIP_CACHE_DIR` is set on the install task**, for the reason CLAUDE.md records about `npm_config_cache`: the mitigation is the environment variable, not a home directory someone created by hand.
- **`swee` is a supplementary member of `adm` and `palworld`.** Not `sudo`, not `steam`. `adm` is load-bearing and its absence fails silently — see Review Focus.
- **The reconciler does not create users or groups.** The human creates `swee`, consistent with `/opt/lyly-admin` and its `.env`. Decision 7.
- **The five state files use relative paths** — `player_history.json`, `session_state.json`, `last_palworld_settings.json`, `last_release.json`, `palfeed_state.json` — so they follow the unit's `WorkingDirectory`. Pointing it at `/var/lib/swee` moves them with no change to swee's code.
- Values already settled in `lychee-ops` `group_vars/all.yml`: `palworld_install_dir` is `/srv/games/palworld/pal-chuds`, `palworld_service` is `palworld-palchuds`, `swee_repo_slug` is `LycheeHome/swee`.
- Palworld's Steam app id is `2394010` (`swee/server_update.py:14`).

## Review Focus

Five failure modes the spec implies but no task's tests would otherwise exercise, most likely first. Each has its test pinned to the task that owns the code.

1. **Journal tailing stops silently after the identity switch.** swee shells out to `journalctl -u palworld-palchuds -f` (`swee/log_tailer.py:64-66`). This works today *only because* swee and the game server share the `steam` UID — systemd grants a user their own unit's journal with no group membership at all. A separate UID needs `adm` (or `systemd-journal`). Missing it produces no error swee surfaces: the relay just stops posting. Pinned to the Phase 3 verification matrix, which is the only place it can be checked — no off-host test can observe a journal permission.
2. **The venv is missing after the migration**, so `swee_app`'s `Install dependencies` fails on the first tick. The failure lands in the deploy, not in the migration that caused it, and the status file will name a pip error rather than a missing venv. Pinned to Phase 3 step 5, which creates it, and to the matrix row that reads the status file afterwards.
3. **`/update` breaks in the window between narrowing and restart.** If the sudoers drop-in names only `swee` while the running process is still `steam`, every `sudo` in the bot fails. Pinned to Task 3's dual-name assertion and Task 7's inverted assertion.
4. **State files silently start empty.** If `/var/lib/swee` exists but the five `.json` files were not copied, swee starts cleanly and reports nothing — it just loses player history, the release marker and palfeed state, and re-announces things it already announced. There is no error path here, which is what makes it dangerous. Pinned to the Phase 3 matrix rows for a history-backed command and for `ls -la /var/lib/swee`.
5. **The wrapper runs `steamcmd` as root.** `sudo` runs the wrapper as root; the wrapper must drop to `steam` before invoking `steamcmd`, or the update rewrites the install as root and the game server can no longer write its own files. Pinned to Task 2.

---

## File Structure

**`lychee-ops`** (the declarations):

- Create `roles/swee_host/files/swee-update-palworld.sh` — the no-argument wrapper. Runs `steamcmd` as `steam` against the pinned install dir.
- Create `roles/swee_host/files/sudoers-swee.example` — the drop-in installed to `/etc/sudoers.d/swee`. Names both principals in phase 1, narrows in phase 4.
- Modify `roles/swee_host/tasks/main.yml` — install both of the above; later declare the old hand-made drop-in absent.
- Modify `roles/swee_host/templates/swee.service.j2` — `WorkingDirectory` splits from `swee_dir`.
- Modify `group_vars/all.yml` — new identity variables; `swee_user`/`swee_dir` change in phase 4.
- Modify `roles/swee_app/tasks/main.yml` — `PIP_CACHE_DIR` on the install task.
- Modify `tests/test_swee_decide.yml` — render assertions for the changed unit template.

**`swee`** (the behaviour):

- Modify `swee/server_update.py` — invoke the wrapper; check return codes; abort on a failed stop.
- Modify `swee/config.py` — drop `PALWORLD_INSTALL_DIR` and `STEAMCMD_PATH`, which the wrapper makes dead.
- Modify `.env.example`, `README.md`, `CLAUDE.md` — drop the dead variables; correct the pre-rename org name.
- Modify `tests/` — the three files that `setdefault` the dropped variables, plus new tests for the update flow.

---

## Phase 1 — `lychee-ops` declares the wrapper and dual-named grants

**The wrapper is inert in this phase. The stop/start grants are not.** swee runs as `steam` throughout and nothing invokes the wrapper until phase 2 ships — but the drop-in also grants `steam` `systemctl stop` and `systemctl start`, and the **deployed** v2.11.3 already calls both (`swee/server_update.py:38` and `:63`). They fail today only because the hand-made `/etc/sudoers.d/swee-palworld-restart` grants `restart` alone — that silent failure *is* the `/update` bug. So from the first tick after this merges, `/update` on the unchanged bot will genuinely stop the server, run `steamcmd` directly against the stopped install, and start it again.

That is the correct behaviour arriving a phase early rather than a regression, and it is strictly better than running `steamcmd validate` against a live server. But it is a live change to a running game server with no swee release involved, so it is a thing to know before merging rather than to discover from a `/update`. An earlier draft of this plan asserted the opposite — that nothing in this phase changes swee's behaviour — which was wrong, and wrong in the direction that skips the analysis.

### Task 1: Identity variables in `group_vars`

**Files:**
- Modify: `lychee-ops/group_vars/all.yml`

**Interfaces:**
- Produces: `swee_state_dir`, `swee_update_wrapper`, `palworld_steam_app_id`, `steamcmd_path`. Tasks 2, 3 and 7 consume these.

- [ ] **Step 1: Add the new variables**

Add beside the existing swee block, with comments in this repo's idiom — say *why*, not *what*:

```yaml
# Where swee's five state files live once it has its own identity. Split
# from swee_dir deliberately: the code checkout is replaceable and the
# reconciler rewrites it on every pin bump, while these five files are the
# bot's memory and must survive that. They use relative paths in swee's
# code, so they follow the unit's WorkingDirectory and move with no code
# change. Until slice 1c's migration this is unused — swee still runs with
# WorkingDirectory=swee_dir.
swee_state_dir: /var/lib/swee

# The one path by which swee can update the game install. swee is NOT in
# the palworld group's write set for the install root (0755 steam:steam),
# so this wrapper is a capability, not a convenience: updating is the only
# thing that genuinely requires being steam, and it is mediated rather
# than granted. No arguments — every value is hardcoded inside it, so the
# sudoers entry needs no wildcard.
swee_update_wrapper: /usr/local/sbin/swee-update-palworld

# Palworld's Steam application id, from swee/server_update.py. Named here
# because the wrapper is rendered from this repo and the value would
# otherwise exist only inside a shell script nobody greps.
palworld_steam_app_id: "2394010"

# Ubuntu's steamcmd package installs here. swee defaulted to this path
# with an env-var override that nothing set; the wrapper hardcodes it.
steamcmd_path: /usr/games/steamcmd
```

- [ ] **Step 2: Verify nothing else consumes the names**

Run: `grep -rn 'swee_state_dir\|swee_update_wrapper\|palworld_steam_app_id\|steamcmd_path' --exclude-dir=.git --exclude-dir=tests .`
Expected: hits only in `group_vars/all.yml`. Anything else is a collision to resolve before proceeding.

- [ ] **Step 3: Syntax check**

Run: `./tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add group_vars/all.yml
git commit -m "feat: name the pieces of swee's own identity"
```

### Task 2: The `steamcmd` wrapper

**Files:**
- Create: `lychee-ops/roles/swee_host/files/swee-update-palworld.sh`
- Modify: `lychee-ops/roles/swee_host/tasks/main.yml`

**Interfaces:**
- Consumes: `palworld_install_dir`, `palworld_steam_app_id`, `steamcmd_path`, `swee_update_wrapper` from Task 1.
- Produces: `/usr/local/sbin/swee-update-palworld`, root-owned `0700`, invoked as `sudo /usr/local/sbin/swee-update-palworld` with no arguments.

**A note on why this is a `files/` copy and not a `template/`.** The three `lyly-admin` wrappers are static `files/`, and this one is too — but it needs `palworld_install_dir` interpolated, which a static file cannot do. Use `ansible.builtin.template` with the script under `templates/`, and say so in the comment, because it diverges from the pattern it otherwise copies.

- [ ] **Step 1: Write the wrapper**

Create `roles/swee_host/templates/swee-update-palworld.sh.j2`:

```bash
#!/bin/bash
# Declared by lychee-ops. Do not edit on the host — the next reconcile tick
# overwrites it.
#
# Invoked as: sudo /usr/local/sbin/swee-update-palworld   (no arguments)
#
# NO ARGUMENTS, deliberately. Every value below already came from swee's
# configuration rather than from Discord input, so hardcoding them here
# lets the sudoers entry be an exact command with no wildcard. sudo's
# wildcard argument matching is not available on every build and is
# bypassable where it is.
#
# runuser to steam is the point of the script, not an implementation
# detail: sudo runs this as ROOT, and steamcmd writes into the install
# tree. Running it as root would leave root-owned files inside a tree the
# game server must write, and the game server would stop being able to
# update its own state — the failure would appear later, as the server
# failing to save, rather than here.
set -euo pipefail

exec runuser -u {{ steam_user }} -- \
  {{ steamcmd_path }} \
  +force_install_dir {{ palworld_install_dir }} \
  +login anonymous \
  +app_update {{ palworld_steam_app_id }} validate \
  +quit
```

- [ ] **Step 2: Declare it**

Add to `roles/swee_host/tasks/main.yml`, above the retired-drop-in removal:

```yaml
# A template rather than a files/ copy, unlike lyly_admin_host's three
# wrappers: this one interpolates palworld_install_dir so the install path
# has exactly one source of truth, group_vars, rather than a second copy
# inside a shell script that nothing compares.
- name: Install the swee steamcmd wrapper
  ansible.builtin.template:
    src: swee-update-palworld.sh.j2
    dest: "{{ swee_update_wrapper }}"
    owner: root
    group: root
    mode: "0700"
```

- [ ] **Step 3: Syntax check and commit**

Run: `./tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml`
Expected: exit 0.

```bash
git add roles/swee_host/
git commit -m "feat: mediate swee's access to steamcmd through a wrapper"
```

### Task 3: The sudoers drop-in, naming both principals

**Files:**
- Create: `lychee-ops/roles/swee_host/files/sudoers-swee.example`
- Modify: `lychee-ops/roles/swee_host/tasks/main.yml`

**Interfaces:**
- Produces: `/etc/sudoers.d/swee`, mode `0440`, installed through `validate: visudo -cf %s`.

- [ ] **Step 1: Write the drop-in**

```
# Installed by lychee-ops to /etc/sudoers.d/swee. Do not edit on the host.
#
# Grants exactly what swee shells out to and nothing else. Do not broaden
# any of these to ALL.
#
# BOTH steam and swee are named, and that is temporary but not optional.
# During slice 1c swee still RUNS as steam until the migration; naming only
# swee would break every sudo call the bot makes, including /restart, the
# moment this file lands — five minutes after the commit, with no
# deployment to correlate it with. The steam line is removed in the same
# slice, after the migration, once nothing runs as steam any more.
#
# stop and start are here because /update needs them and the drop-in this
# replaces granted only restart. server_update.py called stop and start
# anyway and discarded both return codes, so the update ran steamcmd
# against a LIVE server and then reported success. Migrating a grant known
# to be too narrow into a new identity would have shipped that bug forward.

Cmnd_Alias SWEE_CMDS = \
    /usr/bin/systemctl stop palworld-palchuds, \
    /usr/bin/systemctl start palworld-palchuds, \
    /usr/bin/systemctl restart palworld-palchuds, \
    /usr/local/sbin/swee-update-palworld

steam ALL=(root) NOPASSWD: SWEE_CMDS
swee ALL=(root) NOPASSWD: SWEE_CMDS
```

- [ ] **Step 2: Declare it**

```yaml
# validate: visudo -cf %s checks the candidate file before it replaces the
# live one, so a syntactically broken drop-in is refused rather than
# installed. It does not catch a valid file with the wrong content in it —
# which is why the dual-naming above is commented where it is written.
- name: Install the swee sudoers drop-in
  ansible.builtin.copy:
    src: sudoers-swee.example
    dest: /etc/sudoers.d/swee
    owner: root
    group: root
    mode: "0440"
    validate: visudo -cf %s
```

- [ ] **Step 3: Assert both principals are named, and that this is checkable**

Add to `tests/test_swee_decide.yml`, as its own play:

```yaml
- name: The swee sudoers drop-in names both principals during the transition
  hosts: localhost
  gather_facts: false
  tasks:
    - name: Read the drop-in
      ansible.builtin.set_fact:
        sudoers_swee: "{{ lookup('file', '../roles/swee_host/files/sudoers-swee.example') }}"

    # Both lines must be present while swee runs as steam. Task 7 removes
    # the steam line and inverts the second assertion — which is the point
    # of asserting it now: the removal then has to be deliberate, because
    # this test fails until someone edits it.
    - name: Assert both principals are granted
      ansible.builtin.assert:
        that:
          - "'steam ALL=(root) NOPASSWD: SWEE_CMDS' in sudoers_swee"
          - "'swee ALL=(root) NOPASSWD: SWEE_CMDS' in sudoers_swee"
          - "'/usr/local/sbin/swee-update-palworld' in sudoers_swee"
          - "'systemctl stop palworld-palchuds' in sudoers_swee"
          - "'systemctl start palworld-palchuds' in sudoers_swee"
        fail_msg: >-
          The swee sudoers drop-in does not grant what slice 1c requires.
          Contents:

          {{ sudoers_swee }}
```

- [ ] **Step 4: Run the suite**

Run: `./tests/run.sh`
Expected: PASS, one new play green, output pristine. Report the counts observed rather than predicting them.

- [ ] **Step 5: Commit**

```bash
git add roles/swee_host/ tests/
git commit -m "feat: grant swee what /update actually needs"
```

**What Task 3's review changed, recorded because later tasks read this section.** The task as built differs from the steps above in four ways, all from its review: `validate:` is `visudo -csf %s`, not `-cf` — `-cf` prints "Cmnd_Alias referenced but not defined" to stderr and *then* prints "parsed OK" and exits 0, so it would install a drop-in granting nothing, and the test's substring assertions survive a mistyped alias block too, meaning validator and test shared one blind spot. The same flag was corrected in `roles/lyly_admin_host/tasks/main.yml`, which had the identical hole in a file already live on the host. The wrapper entry ends `""`, which pins it to zero arguments — without it sudoers permits *any* arguments, and the no-argument safety would be a property of the shell script rather than of the grant. And the play carries two assertions beyond the five written above: one comparing the restart grant against `palworld_service` read from `group_vars`, and one comparing the whole grant block.

**Phase 1 lands as one PR.** Merge it and let a tick apply it before starting phase 2. Then correct `lyly-admin`'s `CLAUDE.md`, which states that `/etc/sudoers.d/lyly-admin` is installed through `validate: visudo -cf %s` — true until this branch merges and false afterwards. Nothing detects that drift, which is why it is written here as a step rather than left to be noticed. Verify on the host:

```bash
sudo ls -l /usr/local/sbin/swee-update-palworld /etc/sudoers.d/swee

# The grant that stays unused this phase
sudo -u steam sudo -n -l /usr/local/sbin/swee-update-palworld

# The grants that go LIVE this phase — these are the ones that change behaviour
sudo -u steam sudo -n -l /usr/bin/systemctl stop palworld-palchuds
sudo -u steam sudo -n -l /usr/bin/systemctl start palworld-palchuds

# The merged policy, which `validate:` cannot check
sudo visudo -c

# Smoke-test the privilege drop without touching the install
sudo runuser -u steam -- /usr/games/steamcmd +quit
```

These ask sudo directly whether `steam` may run each command without a password, which is exactly what swee asks. A `sudo: a password is required` means the drop-in is wrong, and finding that out here is much cheaper than from a failed `/update`.

Three of them are not obvious and each covers a gap nothing else does:

**The stop/start checks cover the only grants that change behaviour this phase.** Checking the wrapper alone verifies the grant that stays unused while leaving the two that go live untested.

**`visudo -c` checks the merged policy.** `validate: visudo -csf %s` parses the candidate *in isolation* — it cannot see that `/etc/sudoers.d/swee` now sits beside the hand-made `/etc/sudoers.d/swee-palworld-restart` in one concatenated policy. A collision, most plausibly a duplicate `Cmnd_Alias` name, would install cleanly and break `sudo` for every user on the box.

**The `runuser` smoke test proves what no test can.** It exercises the privilege drop, `/usr/games/steamcmd` existing at that path, `runuser` resolving, `HOME=/home/steam`, and the `cd /` working directory — all in one command that downloads nothing and touches no install. Otherwise the first execution of that whole chain is a phase-2 `/update` with the server already stopped, which is the worst possible place to learn any of it is wrong. **Do not run the wrapper itself here** — `+app_update validate` against a running server is precisely what this slice exists to prevent.

One thing to check before the first `/update` in the window between this merge and the v2.12.0 pin, because v2.11.3 calls `steamcmd` directly with a path from its own config: `sudo grep PALWORLD_INSTALL_DIR /home/steam/swee/.env` should read `/srv/games/palworld/pal-chuds`. It was corrected and verified during slice 1b's migration, so this is a confirmation rather than an expected fix. A stale value would have `steamcmd` download a fresh 9.7 GB copy into the old path while the real server is down.

---

## Phase 2 — swee's code change, shipped through a release

### Task 4: Drop the config the wrapper made dead

**Files:**
- Modify: `swee/swee/config.py`
- Modify: `swee/.env.example`, `swee/README.md`, `swee/CLAUDE.md`
- Modify: `swee/tests/test_assistant.py`, `test_releases.py`, `test_player_history.py`

**Interfaces:**
- Produces: `SWEE_UPDATE_WRAPPER`, consumed by Task 5.

**This task comes first for a reason.** Task 5 imports `SWEE_UPDATE_WRAPPER` from `config.py`; done the other way round, Task 5's new tests fail at import with `ImportError` rather than on the behaviour they are written to check, and a red test that is red for the wrong reason teaches nothing.

- [ ] **Step 1: Swap the variables**

In `swee/config.py`, remove lines 30-31 and add:

```python
# The wrapper lychee-ops installs, invoked through sudo with no arguments.
# PALWORLD_INSTALL_DIR and STEAMCMD_PATH used to live here and are gone:
# both are now baked into that wrapper, which is rendered from lychee-ops'
# group_vars. Keeping them would have left two required environment
# variables that nothing reads — exactly the shape that let GITHUB_REPO sit
# stale through an org rename with nothing detecting it.
SWEE_UPDATE_WRAPPER = os.environ.get("SWEE_UPDATE_WRAPPER", "/usr/local/sbin/swee-update-palworld")
```

- [ ] **Step 2: Remove the dead `setdefault` lines from the three test files**

`tests/test_assistant.py:20`, `tests/test_releases.py:21`, `tests/test_player_history.py:21` — delete the `PALWORLD_INSTALL_DIR` line from each. Leave `PALWORLD_SETTINGS_INI_PATH`, which is still required.

- [ ] **Step 3: Correct the pre-rename org name**

Run: `grep -rn 'lychee-home' --exclude-dir=.git --exclude-dir=.venv .`
Expected: hits in `.env.example` and documentation. Replace each with `LycheeHome`. This is the same staleness found on the host during slice 1b's migration, where swee's live `.env` still named the old org and its release ticker had been raising `301 Moved Permanently` every cycle with nothing detecting it. `group_vars`' `swee_repo_slug` is already correct; these copies are not.

- [ ] **Step 4: Prove nothing still reads the removed names**

Run: `grep -rn 'PALWORLD_INSTALL_DIR\|STEAMCMD_PATH' --exclude-dir=.git --exclude-dir=.venv .`
Expected: **no output at all.** Any hit is either a missed call site or a doc that now lies.

- [ ] **Step 5: Run the suite and commit**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS.

```bash
git add -A
git commit -m "refactor: drop the config the wrapper made dead"
```

### Task 5: `/update` invokes the wrapper and checks its return codes

**Files:**
- Modify: `swee/swee/server_update.py`
- Test: `swee/tests/test_server_update.py` (create)

**Interfaces:**
- Consumes: `SWEE_UPDATE_WRAPPER` from Task 4, `/usr/local/sbin/swee-update-palworld` from Task 2, and the grants from Task 3.
- Produces: an `update_palworld()` that aborts on a failed stop rather than proceeding.

**Follow the pattern already in the repo.** `swee/restart.py:27-32` runs `sudo -n -l <cmd>` as a preflight and returns a clear error when the grant is missing. `server_update.py` has no equivalent, which is half of why the bug was invisible. Mirror `restart.py`; do not invent a second shape.

**To be precise about where**, because this was ambiguous enough to be read the other way during execution: the preflight belongs **inside `update_palworld()`**, at the top, before the warning broadcast. It does *not* belong in `restart.py`'s `check_palworld_service()`, whose only caller is `main.py:57` — `if not check_palworld_service(): raise SystemExit(1)` — so adding `/update`-only grants there would take the whole bot down (relay, stats, `/restart`, `/config`) over a capability none of them use.

Without a preflight in the flow, a missing grant is still *safe* — sudo exits non-zero, the stop's return-code check fires, and the abort holds — but the bot broadcasts the update warning to Discord, announces the restart in-game, sleeps `RAM_RESTART_WARNING_SEC`, and saves the world before discovering it was never permitted to stop anything. Phase 4 removes `steam` from the grant and uses `/update` as the verification, so that is exactly the path this lands on.

Use `asyncio.create_subprocess_exec` rather than `restart.py`'s `subprocess.run`: that one runs at startup in a sync context, while this one would block the event loop. And name the specific missing grant — "sudo not configured" sends someone to the wrong file; "no NOPASSWD grant for `systemctl stop palworld-palchuds`" sends them to the right one.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_server_update.py`:

```python
import asyncio
import os

os.environ.setdefault("PALWORLD_SETTINGS_INI_PATH", "/tmp/x")
os.environ.setdefault("PALWORLD_SERVICE_NAME", "palworld-test")

import swee.server_update as server_update


class FakeProc:
    def __init__(self, returncode, output=b""):
        self.returncode = returncode
        self._output = output

    async def wait(self):
        return self.returncode

    async def communicate(self):
        return self._output, None


def test_failed_stop_aborts_before_steamcmd(monkeypatch):
    """A stop that fails must not be followed by an update against a live server."""
    calls = []

    async def fake_exec(*args, **kwargs):
        calls.append(args)
        if "stop" in args:
            return FakeProc(1)
        return FakeProc(0, b"ok")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(server_update.rest, "save", _noop)
    monkeypatch.setattr(server_update, "warn_and_wait", _noop)

    embed = asyncio.run(server_update.update_palworld())

    assert not any("swee-update-palworld" in " ".join(c) for c in calls), \
        "steamcmd ran after a failed stop"
    assert "Update failed" in embed.title


def test_successful_flow_invokes_the_wrapper(monkeypatch):
    """The update path goes through the wrapper, not steamcmd directly."""
    calls = []

    async def fake_exec(*args, **kwargs):
        calls.append(args)
        return FakeProc(0, b"Success! App '2394010' fully installed.")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(server_update.rest, "save", _noop)
    monkeypatch.setattr(server_update, "warn_and_wait", _noop)
    monkeypatch.setattr(server_update.rest, "info", _noop)

    asyncio.run(server_update.update_palworld())

    flat = [" ".join(c) for c in calls]
    assert any("swee-update-palworld" in c for c in flat)
    assert not any("steamcmd" in c for c in flat), "steamcmd was invoked directly"


async def _noop(*args, **kwargs):
    return None
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ~/WebstormProjects/personal/swee && .venv/bin/python -m pytest tests/test_server_update.py -v`
Expected: FAIL — `test_failed_stop_aborts_before_steamcmd` fails because the current code proceeds regardless, and `test_successful_flow_invokes_the_wrapper` fails because `STEAMCMD_PATH` is invoked directly.

- [ ] **Step 3: Change the code**

In `swee/server_update.py`, replace the stop block and the steamcmd block:

```python
        if on_progress:
            await on_progress("Stopping server…")
        proc = await asyncio.create_subprocess_exec("sudo", "systemctl", "stop", PALWORLD_SERVICE_NAME)
        stop_rc = await proc.wait()
        if stop_rc != 0:
            # Abort rather than continue. Running steamcmd +app_update
            # validate against a LIVE server is the dangerous half of this
            # flow, and until this check existed a silently-failed stop led
            # straight into it — then polled a server that had never gone
            # down, found it up, and reported success.
            log.error("server update: stop failed with rc=%s, aborting", stop_rc)
            embed = discord.Embed(title="Update failed", color=COLOR_LEAVE)
            embed.add_field(
                name="Status",
                value=f"Could not stop {PALWORLD_SERVICE_NAME} (exit {stop_rc}). "
                      f"Nothing was updated and the server was not restarted — "
                      f"check `systemctl status {PALWORLD_SERVICE_NAME}`.",
                inline=False,
            )
            return embed

        if on_progress:
            await on_progress("Updating via steamcmd… this can take a few minutes")
        steamcmd_ok = False
        steamcmd_output = ""
        try:
            steamcmd_proc = await asyncio.create_subprocess_exec(
                "sudo", SWEE_UPDATE_WRAPPER,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await steamcmd_proc.communicate()
            steamcmd_ok = steamcmd_proc.returncode == 0
            steamcmd_output = stdout.decode(errors="replace").strip()
        except Exception as e:
            log.exception("server update: failed to run the update wrapper")
            steamcmd_output = str(e)
```

and check the start too, since the existing code discards that return code as well:

```python
        if on_progress:
            await on_progress("Starting server…")
        start_proc = await asyncio.create_subprocess_exec("sudo", "systemctl", "start", PALWORLD_SERVICE_NAME)
        start_rc = await start_proc.wait()
        if start_rc != 0:
            log.error("server update: start failed with rc=%s", start_rc)
```

A failed start is not fatal here — the liveness poll below already catches a server that does not come back, and reports "Update timed out". Logging it turns a 120-second mystery into one line. Make the later "Server was still restarted with the existing install" field conditional on `start_rc == 0` while you are here: once the return code is captured, printing that claim unconditionally is stating something the code now knows may be false.

Update the import at line 8 to drop `PALWORLD_INSTALL_DIR` and `STEAMCMD_PATH` and add `SWEE_UPDATE_WRAPPER`.

- [ ] **Step 4: Run the tests**

Run: `.venv/bin/python -m pytest tests/test_server_update.py -v`
Expected: PASS, both tests.

- [ ] **Step 5: Run the whole suite**

Run: `.venv/bin/python -m pytest -q`
Expected: PASS, no warnings.

- [ ] **Step 6: Commit**

```bash
git add swee/server_update.py tests/test_server_update.py
git commit -m "fix: /update ran steamcmd against a live server"
```

### Operator: cut the release and move the pin

Not a task — two commits and a wait, in this order:

1. **Merge the swee PR.** `fix:` is releasable, so release-please opens a release PR on its own. Merge that too.

   **Read the tag it cut; do not predict it.** An earlier draft of this plan said `v2.12.0`, and that was wrong: every commit in this phase is `fix:`, `refactor:`, `test:` or `docs:` with no `feat:`, and release-please maps `fix:` to a **patch** bump — so from `v2.11.3` it cuts `v2.11.4`. Squash-merging means the PR *title* becomes the commit subject, so the title's conventional-commit prefix is what decides this. Do not retitle to `feat:` to force a minor version; this is a bug fix and the version should say so.
2. **Bump the pin** in `lychee-ops` `group_vars/all.yml` to whatever tag step 1 actually produced: `swee_version: v2.11.4`. Merge. A pin naming a tag that does not exist is caught — slice 1a's gate reports an unresolvable pin and blocks rather than killing the play — but it costs a cycle to notice.
3. **Watch one tick.** `sudo cat /var/lib/swee/deploy-status.json`. Expect `result: deployed` and `deployed_tag` matching the tag from step 1. Note that `/var/lib/swee` **already exists** — `swee_app_status_file` (`roles/swee_app/defaults/main.yml:15`) has always written there, created by `Ensure the swee status directory exists`. Phase 3 does not create that directory; it changes its ownership and adds the five state files beside the status file already in it.
4. **Exercise `/update` in Discord, while swee still runs as `steam`.** The preflight added in Task 5 means a missing grant now aborts immediately with the grant named, before any broadcast — so a failure here is diagnostic rather than a 60-second wait followed by a mystery. This is the whole reason for the ordering. It proves the wrapper, the grants and the code change all work *before* identity is added as a variable. If `/update` is broken here, it is broken for a reason that has nothing to do with the migration, and that is worth knowing separately.

---

## Phase 3 — the migration

Run by hand. swee is down for the duration; the game server is not touched.

0. **Copy the current unit aside.** `sudo cp /etc/systemd/system/swee.service /root/swee.service.pre-identity`
   Same reason slice 1b needed it: `ansible.builtin.template` has no inverse, so a rollback has nothing to restore from unless a copy is taken first.
1. **Create the user.** `sudo useradd --system --shell /usr/sbin/nologin --home-dir /opt/swee --no-create-home swee`
   Then `sudo usermod -aG adm,palworld swee`, and verify with `id swee`. Both supplementary groups matter: `palworld` for the settings file, `adm` for the journal.
2. **Stop swee.** `sudo systemctl stop swee`
3. **Create `/opt/swee`, and take ownership of `/var/lib/swee`.**
   ```
   sudo mkdir -p /opt/swee
   sudo chown swee:swee /opt/swee /var/lib/swee
   sudo chmod 0750 /opt/swee /var/lib/swee
   ```
   `/var/lib/swee` is **not new** — `swee_app` has always written `deploy-status.json` into it (`roles/swee_app/defaults/main.yml:15`), as root. Root ignores the mode, so handing the directory to `swee` does not stop the reconciler writing its status file there; it lets swee write its own five files beside it.
4. **Move the checkout, and the state files separately.**
   ```
   sudo rsync -a --exclude='.venv' --exclude='*.json' /home/steam/swee/ /opt/swee/
   sudo cp /home/steam/swee/*.json /var/lib/swee/
   sudo chown -R swee:swee /opt/swee /var/lib/swee
   ```
   The `.venv` exclusion is deliberate — see step 5. The five `.json` files go to `/var/lib/swee` because that becomes `WorkingDirectory`; copy rather than move, so the originals survive a rollback.
5. **Recreate the venv.** It cannot be moved: `python3 -m venv` bakes absolute paths into its scripts, and `swee_app`'s `Install dependencies` installs into a venv it does not create.
   ```
   sudo -u swee python3 -m venv /opt/swee/.venv
   sudo -u swee /opt/swee/.venv/bin/pip install -q -r /opt/swee/requirements.txt
   ```
6. **Copy `.env`, drop the dead line, and tighten it.**
   ```
   sudo cp /home/steam/swee/.env /opt/swee/.env
   sudo sed -i '/^PALWORLD_INSTALL_DIR=/d' /opt/swee/.env
   sudo chown swee:swee /opt/swee/.env && sudo chmod 0600 /opt/swee/.env
   ```
   Phase 2 removed `PALWORLD_INSTALL_DIR` from swee's code — the wrapper owns the install path now. Copying it forward would carry a variable nothing reads into the new home permanently, and the next person to read that file would have two apparent sources of truth for the install directory with no way to tell which wins. `STEAMCMD_PATH` was commented out in the shipped `.env.example` and is unlikely to be present, but delete it too if it is.
7. **Merge the phase-3 `lychee-ops` PR** (Task 6), then apply:
   ```
   sudo systemctl stop lyly-reconcile.timer
   sudo flock /run/lyly-reconcile.lock ansible-pull -U git@github.com:LycheeHome/lychee-ops.git \
     -d /var/lib/lychee-ops/ops -i inventory.yml --checkout main playbook.yml
   ```
   Blocking `flock`, not `-n -E 0` — the timer's invocation uses the latter so ticks do not pile up, but a hand run would exit 0 silently on a contended lock and report a no-op as success.
8. **Start swee.** `sudo systemctl start swee`

**Verification matrix** — each row fails separately:

| check | proves |
|---|---|
| `systemctl show swee -p User,WorkingDirectory` | the identity and the state directory |
| `ps -o user= -C python \| sort -u` | it is really running as `swee`, not merely declared to |
| `systemctl is-enabled swee` | it survives a reboot |
| join/leave relay posts in Discord | **`adm` membership and journal access under a new UID** |
| `/stats` or any history-backed command | the five state files came across and are being read |
| `/config get` | `palworld` membership and the settings file |
| `/config set`, then `stat -c '%U:%G %a' …/PalWorldSettings.ini` | group write still works from the new identity — expect `steam:palworld 664` |
| `/restart` | the sudoers drop-in under the new principal |
| `/update` | **the wrapper, the stop/start grants, and the return-code fix together** |
| `sudo ls -la /var/lib/swee` | the five `.json` files are being written here, not in `/opt/swee` |

That row needs `sudo` and the one above it does not, which is new as of Task 6: `swee_app` now declares `/var/lib/swee` as `0750 swee:swee`, so `byron` cannot list it. Before that change the directory was `0755` and the reconciler quietly reverted the migration's `chmod` on every tick — the mode the spec, this plan and the wrapper's own comment all asserted was the one thing nothing enforced.

The relay and `/update` are the two to watch. The relay is the one that fails *silently* — swee will start cleanly, log nothing unusual, and simply never post a join again.

**Rollback**, at any point:

```
sudo systemctl stop swee
sudo cp /root/swee.service.pre-identity /etc/systemd/system/swee.service
sudo systemctl daemon-reload
# revert the lychee-ops commit, apply
sudo systemctl start swee
```

`/home/steam/swee` is untouched by the migration — step 4 copies rather than moves — so the old install is intact and the rollback is a unit restore plus a revert. Do not delete `/home/steam/swee` until the new identity has run for long enough to trust, and delete it as its own deliberate step, not as part of this procedure.

### Task 6: Switch the declared identity

**Files:**
- Modify: `lychee-ops/group_vars/all.yml`
- Modify: `lychee-ops/roles/swee_host/templates/swee.service.j2`
- Modify: `lychee-ops/roles/swee_host/templates/swee-update-palworld.sh.j2` — its `cd /` comment says the inherited cwd is "today `/home/steam/swee`", which stops being true here
- Modify: `lychee-ops/roles/swee_app/tasks/main.yml`
- Modify: `lychee-ops/tests/test_swee_decide.yml` — **two** expected literals move, not one: the unit body and the wrapper body, both whole-body compares that fail until their literal is updated in the same commit

- [ ] **Step 1: Change the identity variables**

```yaml
swee_dir: /opt/swee
swee_user: swee
swee_group: swee
```

Replace the comment above them — it currently explains that swee runs as `steam` inside the game server's home, and records that this was verified on the host during the 2026-09-28 cutover. That justification is now historical, and leaving it would have the file explaining why the opposite of what it declares is correct.

- [ ] **Step 2: Split `WorkingDirectory` from `swee_dir` in the unit template**

```
WorkingDirectory={{ swee_state_dir }}
ExecStart={{ swee_dir }}/.venv/bin/python {{ swee_dir }}/main.py
```

with a comment saying why the two differ: swee's five state files use relative paths, so `WorkingDirectory` is what decides where the bot's memory lives, while the code is read from `swee_dir` by absolute path. The reconciler rewrites `swee_dir` on every pin bump; `swee_state_dir` must survive that.

- [ ] **Step 3: Add `PIP_CACHE_DIR` to the install task**

On `Install dependencies` in `roles/swee_app/tasks/main.yml`:

```yaml
      environment:
        PIP_CACHE_DIR: /var/lib/lychee-ops/.pip
```

Comment it with the reason CLAUDE.md gives for `npm_config_cache`: the `swee` user is created with `--no-create-home`, so `$HOME` points at a directory that does not exist, and pip wants a cache under it. The mitigation is the environment variable, not a home directory someone creates by hand — do not drop it later on the strength of `/opt/swee` existing.

- [ ] **Step 4: Update the unit render test**

The whole-body compare in `tests/test_swee_decide.yml` will fail, which is the point — it fails on any change to the unit, reviewed or not. Update the expected literal to match, and add `swee_state_dir` to that play's fixture vars using a synthetic value (`/rendertest/state`) so a template that hardcoded `/var/lib/swee` could not pass. Add a negative assertion: `'/home/steam' not in swee_unit`.

- [ ] **Step 5: Run the suite**

Run: `./tests/run.sh`
Expected: PASS, output pristine.

- [ ] **Step 6: Commit**

```bash
git add group_vars/all.yml roles/ tests/
git commit -m "feat: swee runs as itself"
```

---

## Phase 4 — narrow the grants

Merge this only after the phase-3 verification matrix is clean. It is deliberately a separate commit from the identity switch, so reverting the narrowing cannot also revert the identity.

**A precondition, closed in Phase 2 rather than here.** This narrowing rewrites `/etc/sudoers.d/swee` **under a running bot**, with no restart — which is exactly the window `restart.py`'s `check_palworld_service()` startup guard cannot see. Until Phase 2, `/restart` discarded its own return code: a failed `sudo systemctl restart` left the server running, so the liveness poll succeeded on the first try and the embed read "Back online after 0s". A mis-narrowed grant would therefore have made `/update` abort honestly while `/restart` lied — and since `/update` is this phase's verification step, nobody would have looked at `/restart`. Phase 2 fixes that return code for the same reason it fixed `/update`'s.

### Task 7: Remove `steam` from the grant, and declare the old drop-in absent

**Files:**
- Modify: `lychee-ops/roles/swee_host/files/sudoers-swee.example`
- Modify: `lychee-ops/roles/swee_host/tasks/main.yml`
- Modify: `lychee-ops/tests/test_swee_decide.yml`

- [ ] **Step 1: Drop the `steam` line**

Remove `steam ALL=(root) NOPASSWD: SWEE_CMDS` and rewrite the comment above it: it currently explains why both are named, and that reasoning expires here. Replace it with why only `swee` is named now, and note that `steam` held these grants until the 1c migration.

- [ ] **Step 2: Declare the hand-made drop-in absent**

```yaml
# The drop-in this replaces. It was never declared by this repo — it was
# made by hand and granted steam exactly `systemctl restart
# palworld-palchuds`, which is why /update's stop and start both failed
# silently. Declaring it absent rather than deleting it once: removing the
# example from a source repo does nothing to a host that already has the
# file installed, the same reasoning as lyly_admin_host's github-runner
# drop-in.
- name: Remove the superseded swee restart drop-in
  ansible.builtin.file:
    path: /etc/sudoers.d/swee-palworld-restart
    state: absent
```

Note this task must be **added to the same loop that already removes the two retired CI drop-ins**, or added beside it — but the existing loop's comment explicitly says this file must NOT be removed. Update that comment in the same commit, or it will contradict the task directly below it.

- [ ] **Step 3: Invert the test assertion — in both places it now lives**

Task 3's play asserted both principals. Change it to assert `swee` is granted and `steam` is **not**:

```yaml
          - "'swee ALL=(root) NOPASSWD: SWEE_CMDS' in sudoers_swee"
          - "'steam ALL=' not in sudoers_swee"
```

The negative assertion is the one that matters, and it is why Task 3 asserted the positive: the removal cannot happen accidentally, because a test fails until someone edits it deliberately.

**That play grew during Task 3's review, so there is a second edit here the original plan did not anticipate.** It now also holds `Assert the grant block is exactly what slice 1c intends`, comparing the drop-in's non-comment lines as a list against `sudoers_swee_grants_expected`. Remove the `steam ALL=(root) NOPASSWD: SWEE_CMDS` element from that expected list too. If you miss it the suite goes red rather than silently passing — which is the assertion working — but the failure names a list mismatch rather than the narrowing you meant to make, so do both edits together.

Why that assertion exists, since it changes how this step should be checked: every other assertion in the play is a substring check, and a substring check cannot see an **added** line at all. A fifth command in the `Cmnd_Alias` or a third principal satisfies all of them. It also cannot see an appended suffix — proven during Task 3's own fix round, where renaming the unit to `palworld-palchuds-WRONGNAME` left the suite green, because the wrong name is a superstring of the right one.

- [ ] **Step 4: Run the suite and commit**

Run: `./tests/run.sh`
Expected: PASS.

```bash
git add roles/ tests/
git commit -m "chore: steam no longer needs swee's grants"
```

- [ ] **Step 5: Verify on the host after the tick**

```bash
sudo ls -l /etc/sudoers.d/ | grep swee

# steam must now be REFUSED all three — that is the narrowing working
sudo -u steam sudo -n -l /usr/local/sbin/swee-update-palworld 2>&1 | head -2
sudo -u steam sudo -n -l /usr/bin/systemctl stop palworld-palchuds 2>&1 | head -2

# swee must still have all three, not just the wrapper
sudo -u swee sudo -n -l /usr/local/sbin/swee-update-palworld
sudo -u swee sudo -n -l /usr/bin/systemctl stop palworld-palchuds
sudo -u swee sudo -n -l /usr/bin/systemctl start palworld-palchuds
sudo visudo -c
```

Checking the wrapper alone verifies one grant of three, and `/update`'s preflight needs all of them — a narrowing that dropped `stop` would pass a wrapper-only check and then abort on the first real `/update`. Same reasoning as Phase 1's checklist.

The middle command must now **fail** — that is the narrowing working. The third must succeed. Then run `/update` in Discord once more: it exercises the grant that just changed, under the identity that just became its only holder.

---

## What this plan does not do

- **Does not delete `/home/steam/swee`.** It stays as the rollback, and its removal is a separate deliberate act once the new identity has been trusted for a while.
- **Does not touch `palsave-api`**, which is still the third tenant of the `steam` identity. That is slice 2.
- **Does not declare `/srv/games` or `/srv/games/palworld`**, which slice 1b's migration found undeclared. Also slice 2, where `games_root` stops being single-tenant.
- **Does not add reconciler-managed users or groups.** The `swee` user is created by hand, consistent with `/opt/lyly-admin` and the `palworld` group before it.
