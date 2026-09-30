# Game data relocation (slice 1b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Palworld's data moves out of `/home/steam` to `/srv/games/palworld/pal-chuds`, with a `palworld` group and setgid directories that grant write by depth, and its systemd unit declared by `lychee-ops` rather than hand-managed.

**Architecture:** A new `palworld_host` role in `lychee-ops`, modelled on `swee_host`. It templates the unit and declares directory ownership and modes, guarded on the install actually being present so it is inert before the operator migrates and enforcing afterwards. The harness gains the ability to render a template and assert on its output, which is the only way to catch a templating error in a unit that runs the game server before it reaches the host.

**Tech Stack:** Ansible (`ansible-core` 2.20.1, pinned to the host), Jinja2, the existing `tests/run.sh` harness.

**Spec:** `docs/superpowers/specs/2026-09-29-service-identities-and-game-layout-design.md`

## Global Constraints

- All work is in `~/WebstormProjects/personal/lychee-ops`. Nothing in this plan touches `roles/swee_app/`, `roles/swee_host/` or `roles/lyly_admin_*/`.
- **The reconciler must never restart the Palworld server.** `palworld_host` notifies `daemon-reload` only. A changed unit waits for a deliberate restart; restarting drops every connected player.
- Directory declarations are guarded on the install directory existing, so the role is inert before the migration and enforcing after. It must never create the game tree.
- Handlers flush at the end of the role, not the end of the play — a later role's terminal `fail:` would otherwise strand a notified handler while the template task reports `ok` on every subsequent tick.
- `when: not ansible_check_mode` on any `ansible.builtin.systemd` task, because the module runs `fail_if_missing()` before its own check-mode guard.
- A task that dereferences a registered result carries the same guard as the task that registers it, and a `default` filter — see `lychee-ops/CLAUDE.md`.
- Do not push. Do not run anything against the `lychee` host.

## Review Focus

Conditions the spec implies that a happy-path test would not reach. Each has a test assigned.

0. **A template that hardcodes its values rather than substituting them.** Rendering fixtures that match `group_vars` cannot see this — the output is textually identical either way. Every rendering play therefore uses **synthetic** inputs and asserts the real production paths are *absent*. *(Tasks 1 and 3)*
1. **A hardcoded `/home/steam` surviving in the rendered unit.** The whole slice is a path change; a literal left in the template defeats it and would only surface as a game server that will not start. *(Task 1)*
2. **The directory declarations running before the migration.** They must skip, not create — an empty `/srv/games/palworld/pal-chuds` would change what `mv` does. *(Task 4)*
3. **The unit rendering with an empty `palworld_server_args`.** A missing variable must not silently produce a server started with no tuning flags. *(Task 3)*
4. **setgid does nothing to files that already exist.** `PalWorldSettings.ini` is `steam:steam` today and stays that way after the directory is declared — so swee, in the `palworld` group, would be `other` on it and **still could not write**. The existing file's group has to be set explicitly. *(Task 4)*
5. **The `flush_handlers` being omitted**, which fails silently: the unit is written, the reload never runs, and every subsequent tick reports `ok` with nothing left to notify. Not reachable by the harness — a structural property of the role, so this is a **review check** rather than a test. *(Task 3, verified by review)*

---

### Task 1: Template rendering in the test harness

The harness exercises pure Jinja in `decide_*.yml`. It cannot currently catch an error in a systemd unit template — which for this slice is the highest-consequence artifact. This task adds that, and proves it against the template that already exists.

**Files:**
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the pattern later tasks copy — `lookup('template', '<relative path>')` into a fact, then `assert` on substrings of the result.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_swee_decide.yml`:

```yaml
# Rendering tests. These catch an error in a unit template before it reaches
# a host, which the decision tests above cannot: a broken unit is not a wrong
# answer, it is a service that will not start.
#
# lookup('template', …) renders with the play's own vars, so each play states
# exactly what the template is entitled to read. A variable the template uses
# but the play does not set raises here rather than rendering empty.
- name: swee's unit renders the paths it is given
  hosts: localhost
  gather_facts: false
  # SYNTHETIC values, deliberately unlike any production default. If these
  # matched group_vars, a template edited to hardcode `User=steam` instead of
  # `User={{ swee_user }}` would render identically and every assertion below
  # would still pass — the test could not tell correct substitution from no
  # substitution at all. The negative assertion is the other half: with
  # synthetic inputs, the real path appearing anywhere means something is
  # hardcoded.
  vars:
    swee_user: rendertest-user
    swee_dir: /rendertest/swee
    palworld_service: rendertest-svc
  tasks:
    - name: Render the swee unit
      ansible.builtin.set_fact:
        swee_unit: "{{ lookup('template', '../roles/swee_host/templates/swee.service.j2') }}"

    - name: Assert the rendered unit uses the given values
      ansible.builtin.assert:
        that:
          - "'User=rendertest-user' in swee_unit"
          - "'WorkingDirectory=/rendertest/swee' in swee_unit"
          - "'ExecStart=/rendertest/swee/.venv/bin/python /rendertest/swee/main.py' in swee_unit"
          - "'After=network-online.target rendertest-svc.service' in swee_unit"
          - "'/home/steam' not in swee_unit"
        fail_msg: "swee.service.j2 did not render the supplied values"
```

- [ ] **Step 2: Run to verify it passes**

Run: `python3 -c "import os; [os.set_blocking(fd, True) for fd in (0,1,2)]; os.execvp('./tests/run.sh', ['./tests/run.sh'])"`
Expected: PASS. This test characterises existing behaviour, so it should pass immediately — that is the point. It proves the mechanism works before Task 3 depends on it.

- [ ] **Step 3: Verify the test can fail**

Temporarily change one assertion to a value the template does not produce (e.g. `'User=nobody' in swee_unit`), re-run, confirm RED, then revert. A rendering test that passes because `lookup` returned something unexpected is worse than no test. Record the observed failure message in your report.

- [ ] **Step 4: Commit**

```bash
git add tests/test_swee_decide.yml
git commit -m "test: render unit templates in the harness

The harness exercised pure Jinja in decide_*.yml but could not catch an
error in a systemd unit template, which is the artifact whose failure is
most expensive — a broken unit is not a wrong answer, it is a service that
does not start.

Characterises swee.service.j2's existing behaviour, so it passes on
arrival. That is deliberate: it proves the mechanism before the next role's
unit depends on it."
```

---

### Task 2: Game layout variables

**Files:**
- Modify: `group_vars/all.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `games_root`, `palworld_root`, `palworld_instance`, `palworld_install_dir`, `steam_user`, `palworld_group`, `palworld_settings_ini`, `palworld_server_args` — eight names. Tasks 3 and 4 consume them. `palworld_service` already exists and is unchanged.

- [ ] **Step 1: Add the variables**

Insert after the existing `palworld_service` block:

```yaml
# Game data lives outside /home deliberately. A service data tree inside a
# home directory is what made PalWorldSettings.ini — mode 664, world-readable
# — unreachable to anything outside the steam group, because /home/steam is
# 750. Relocating removes that rather than negotiating around it, and
# /home/steam goes back to holding only SteamCMD's own bookkeeping, which is
# the one thing in there that belongs in a home directory.
#
# /srv rather than /opt: on this host /opt already means "applications the
# reconciler deploys", and keeping game data out of it preserves a
# distinction that is currently clean. There is no settled convention for
# game servers — LinuxGSM defaults to a home directory, which is what
# produced this situation.
games_root: /srv/games
palworld_root: "{{ games_root }}/palworld"
palworld_instance: pal-chuds
palworld_install_dir: "{{ palworld_root }}/{{ palworld_instance }}"

# The account the game server runs as. Named rather than assumed, because
# swee and palsave-api both currently run as it too and later slices change
# that for them and not for this.
steam_user: steam

# One group per game. Members arrive with the slices that create the users:
# steam in this one, swee in 1c, palsave-api in slice 2. Write is granted by
# directory depth rather than by membership — see palworld_host — so being a
# member never implies being able to replace the binaries the server runs.
palworld_group: palworld

# The settings file swee reads and /config set writes. Named here because
# palworld_host declares its group explicitly: setgid governs new files, and
# this one already exists.
palworld_settings_ini: "{{ palworld_install_dir }}/Pal/Saved/Config/LinuxServer/PalWorldSettings.ini"

# Server tuning flags, here rather than hardcoded in the unit so changing
# them stays a one-line edit. A committed one, applied within a tick.
palworld_server_args: "-useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS"
```

- [ ] **Step 2: Verify nothing else defines these names**

Run: `grep -rn "games_root\|palworld_root\|palworld_instance\|palworld_install_dir\|steam_user\|palworld_group\|palworld_settings_ini\|palworld_server_args" --include="*.yml" --include="*.j2" . | grep -v "group_vars/all.yml" | grep -v ".superpowers"`
Expected: no output. Anything returned is a collision to resolve before proceeding.

- [ ] **Step 3: Run the suite and commit**

Run the suite; expect the same play count as Task 1 left it, all green.

```bash
git add group_vars/all.yml
git commit -m "feat: declare the game data layout

Game data moves out of /home to /srv/games/<game>/<instance>. A service
data tree inside a home directory is what made a mode-664 config file
unreachable behind a mode-750 path; relocating removes the problem rather
than working around it.

Variables only — nothing consumes them yet."
```

---

### Task 3: The `palworld_host` role — the unit

**Files:**
- Create: `roles/palworld_host/templates/palworld.service.j2`
- Create: `roles/palworld_host/tasks/main.yml`
- Create: `roles/palworld_host/handlers/main.yml`
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: `steam_user`, `palworld_install_dir`, `palworld_server_args`, `palworld_service` (Task 2).
- Produces: the role. Task 4 appends directory declarations to the same `tasks/main.yml`; Task 5 wires it into `playbook.yml`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_swee_decide.yml`:

```yaml
- name: The palworld unit renders the declared paths and nothing from /home
  hosts: localhost
  gather_facts: false
  # SYNTHETIC, for the reason the swee rendering play above states: fixtures
  # that match group_vars cannot distinguish a correctly parameterised
  # template from one with the values hardcoded.
  vars:
    steam_user: rendertest-user
    palworld_install_dir: /rendertest/games/palworld/instance
    palworld_server_args: "-RenderProbeFlag"
  tasks:
    - name: Render the palworld unit
      ansible.builtin.set_fact:
        palworld_unit: "{{ lookup('template', '../roles/palworld_host/templates/palworld.service.j2') }}"

    # The two negative assertions are the ones that matter, and they catch
    # opposite mistakes. `/home/steam` absent catches a literal left over from
    # before the relocation. `/srv/games` absent catches the NEW path being
    # hardcoded rather than templated — which, with production-shaped
    # fixtures, would have looked exactly like success.
    - name: Assert the unit points at the relocated install
      ansible.builtin.assert:
        that:
          - "'User=rendertest-user' in palworld_unit"
          - "'WorkingDirectory=/rendertest/games/palworld/instance' in palworld_unit"
          - "'ExecStart=/rendertest/games/palworld/instance/PalServer.sh -RenderProbeFlag' in palworld_unit"
          - "'/home/steam' not in palworld_unit"
          - "'/srv/games' not in palworld_unit"
        fail_msg: "palworld.service.j2 rendered a path it should not have"

- name: The palworld unit refuses to render without tuning flags
  hosts: localhost
  gather_facts: false
  vars:
    steam_user: rendertest-user
    palworld_install_dir: /rendertest/games/palworld/instance
  tasks:
    - name: Render with palworld_server_args unset
      block:
        - ansible.builtin.set_fact:
            palworld_unit: "{{ lookup('template', '../roles/palworld_host/templates/palworld.service.j2') }}"
        - ansible.builtin.fail:
            msg: "rendered with no tuning flags; the server would start unflagged"
      rescue:
        - name: Assert it failed on the missing variable
          ansible.builtin.assert:
            that:
              - "'palworld_server_args' in (ansible_failed_result.msg | default(''))"
            fail_msg: >-
              expected an undefined-variable failure naming palworld_server_args,
              got {{ ansible_failed_result.msg | default('nothing') }}
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL — `Could not find or access '../roles/palworld_host/templates/palworld.service.j2'`.

- [ ] **Step 3: Create the unit template**

```jinja
# roles/palworld_host/templates/palworld.service.j2
# Declared by lychee-ops. Do not edit on the host — the next reconcile
# tick will overwrite it.
#
# Every path here comes from palworld_install_dir. The point of this file
# existing at all is that the relocation had to edit the unit, and a
# hand-edit would have left the new layout recorded only on the host.
[Unit]
Description=Palworld Dedicated Server
Wants=network-online.target
After=network-online.target

[Service]
User={{ steam_user }}
WorkingDirectory={{ palworld_install_dir }}
ExecStart={{ palworld_install_dir }}/PalServer.sh {{ palworld_server_args }}
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Create the handler**

```yaml
# roles/palworld_host/handlers/main.yml
# Reload only. NO restart handler, deliberately — and this is the one way
# this role must differ from swee_host.
#
# Restarting swee is free. Restarting the Palworld server disconnects every
# player on it, so the reconciler must never do it unprompted: a config
# change committed at 21:00 would otherwise drop a session five minutes
# later with no warning. A changed unit is written and reloaded; it takes
# effect at the next deliberate restart, via swee's /restart or by hand.
#
# when: not ansible_check_mode — ansible.builtin.systemd runs
# fail_if_missing() before its own check_mode guard, so a --check run on a
# host without the unit fails hard. That is precisely the dry run an
# operator runs first.
- name: Reload systemd for palworld
  ansible.builtin.systemd:
    daemon_reload: true
  when: not ansible_check_mode
```

- [ ] **Step 5: Create the role's tasks**

```yaml
# roles/palworld_host/tasks/main.yml
# Declares the Palworld server's unit. The game install itself is created and
# updated by SteamCMD, never by this role.
#
# This role exists because the relocation had to change the unit's paths. A
# hand-edited unit would leave the new layout recorded nowhere and
# self-correcting never, which is the condition this project's CLAUDE.md
# describes as prose not being enforcement.

- name: Install the palworld systemd unit
  ansible.builtin.template:
    src: palworld.service.j2
    dest: "/etc/systemd/system/{{ palworld_service }}.service"
    owner: root
    group: root
    mode: "0644"
  notify: Reload systemd for palworld

# Nothing may be added below this task — handlers have already run by then,
# so a notify from a later task would never fire.
#
# Flushed here rather than at end of play, for the reason swee_host
# documents: a later role ends the play in fail: on a routine outcome, and a
# handler notified here would sit unflushed while that happens. The next
# tick's template task then reports ok — no change left to detect — so the
# handler is never notified again, and a changed unit sits on disk with
# systemd running the old one, permanently.
- name: Flush palworld host handlers
  ansible.builtin.meta: flush_handlers
```

- [ ] **Step 6: Run the tests to verify they pass**

Expected: PASS, two new plays green. Report the counts you observe rather than predicting them — `ok=` counts tasks rather than plays, and the second play contributes a rescue rather than a clean `ok`, so a simple delta is not a checkable expectation.

- [ ] **Step 7: Commit**

```bash
git add roles/palworld_host tests/test_swee_decide.yml
git commit -m "feat: declare the palworld systemd unit

The relocation changes the unit's WorkingDirectory and ExecStart, so it had
to be edited regardless. Edited by hand, the new layout would exist only on
the host — recorded nowhere, self-correcting never.

No restart handler, deliberately. Restarting swee is free; restarting the
game server disconnects every player on it, so the reconciler reloads
systemd and leaves the restart to a deliberate act.

A test asserts no /home/steam literal survives in the rendered unit. That
is the failure this slice is most exposed to and the one that would surface
only as a server that does not start."
```

---

### Task 4: The `palworld_host` role — directory permissions

**Files:**
- Modify: `roles/palworld_host/tasks/main.yml`
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: `palworld_install_dir`, `palworld_group`, `steam_user` (Task 2); the role from Task 3.
- Produces: `palworld_host_install` and `palworld_host_settings` (registered `stat`s) and the guarded declarations.

- [ ] **Step 1: Write the failing tests**

These exercise the guard's predicate, not the `file` module. Append:

```yaml
- name: The directory declarations skip before the migration
  hosts: localhost
  gather_facts: false
  tasks:
    - name: Simulate a stat of an install that is not there yet
      ansible.builtin.set_fact:
        palworld_host_install: { stat: { exists: false } }

    - name: Assert the guard is false
      ansible.builtin.assert:
        that:
          - not (palworld_host_install.stat.isdir | default(false))
        fail_msg: >-
          the guard would have run before the migration, and creating an empty
          /srv/games/palworld/pal-chuds changes what mv does

- name: The directory declarations run once the install is present
  hosts: localhost
  gather_facts: false
  tasks:
    - ansible.builtin.set_fact:
        palworld_host_install: { stat: { exists: true, isdir: true } }

    - ansible.builtin.assert:
        that:
          - palworld_host_install.stat.isdir | default(false)
```

- [ ] **Step 2: Run to verify they pass**

These characterise the predicate before the tasks exist. Expect PASS. Then change `default(false)` to `default(true)` in the first assertion, re-run, confirm RED, revert — the guard defaulting the wrong way is the actual hazard, and the test must be able to see it.

- [ ] **Step 3: Add the stat, guard the template task, and add the declarations**

**The `stat` goes FIRST — above the template task, not below it — and the template task gains the same guard.** Task 3 left that task unguarded, which means the first tick after Task 5 wires the role in would rewrite the live unit to point at a directory the operator has not created yet. The no-restart design protects the *running* process, not the *next start*: `Restart=on-failure`, a reboot, or swee's `/restart` would then bring the server up against a missing `WorkingDirectory`. Guarding the template makes the role inert until the migration and self-enabling afterwards, which is better than an ordering requirement written in a procedure someone has to remember.

So `tasks/main.yml` ends up: stat → template (guarded) → directory declarations (guarded) → settings-file stat → settings-file declaration (guarded) → flush.

Add `when: palworld_host_install.stat.isdir | default(false)` to the existing template task, and insert the rest between it and the flush:

```yaml
# The guard. These tasks enforce permissions on a tree they must never
# create: ansible.builtin.file with state: directory would happily make an
# empty /srv/games/palworld/pal-chuds before the operator has moved anything,
# and `mv` into an existing directory does something different from `mv` to a
# new name. So this role is inert until the migration has happened and
# enforcing from then on.
- name: Check whether the game install has been relocated
  ansible.builtin.stat:
    path: "{{ palworld_install_dir }}"
  register: palworld_host_install

# Write is granted by DEPTH, not by membership. The install stays
# steam:steam 0755 so that being in the palworld group never implies being
# able to replace PalServer.sh — write access to a binary someone else
# executes is code execution as that user, and the pre-relocation tree was
# 775, which left exactly that open.
#
# The setgid bits are what make swee's /config set survivable. It writes via
# mkstemp-then-rename and tries to chown the result back to steam, which
# fails silently for any process that is neither root nor the owner. With
# setgid the replacement inherits the palworld group and keeps mode 664, so
# the game server can still write its own config: the GROUP grants access,
# not the owner.
- name: Declare the game data permissions
  ansible.builtin.file:
    path: "{{ item.path }}"
    state: directory
    owner: "{{ steam_user }}"
    group: "{{ item.group }}"
    mode: "{{ item.mode }}"
  loop:
    - { path: "{{ palworld_install_dir }}", group: "{{ steam_user }}", mode: "0755" }
    - { path: "{{ palworld_install_dir }}/Pal/Saved", group: "{{ palworld_group }}", mode: "2755" }
    - { path: "{{ palworld_install_dir }}/Pal/Saved/Config/LinuxServer", group: "{{ palworld_group }}", mode: "2775" }
  loop_control:
    label: "{{ item.path }}"
  when: palworld_host_install.stat.isdir | default(false)

# setgid governs files created FROM NOW ON. PalWorldSettings.ini already
# exists and is steam:steam, so declaring the directory above does nothing
# for it — swee would be `other` on that file and could not write it, and
# /config set would fail on a layout that looks correct.
#
# Declared rather than left to the migration, so it is enforced every tick
# instead of being something done once. state: file touches attributes and
# never content, which matters because the game server rewrites this file.
- name: Check whether the settings file exists yet
  ansible.builtin.stat:
    path: "{{ palworld_settings_ini }}"
  register: palworld_host_settings

- name: Declare the settings file's group
  ansible.builtin.file:
    path: "{{ palworld_settings_ini }}"
    state: file
    owner: "{{ steam_user }}"
    group: "{{ palworld_group }}"
    mode: "0664"
  when: palworld_host_settings.stat.exists | default(false)
```

- [ ] **Step 4: Run the suite and commit**

```bash
git add roles/palworld_host/tasks/main.yml tests/test_swee_decide.yml
git commit -m "feat: declare game data permissions, scoped by depth

The install stays steam:steam 0755, so membership of the palworld group
never implies being able to replace the binary the server executes. The
pre-relocation tree was 775 — group-writable over the executables — which
is a code-execution surface any group-based grant would have inherited.

Saves are group-readable and config group-writable, with setgid on both.
The setgid is what makes swee's /config set survivable: it chowns back to
steam and that silently fails for a non-owner, so the group has to be what
grants access rather than the owner.

Guarded on the install existing. These tasks must never create the tree —
an empty directory at the destination changes what mv does."
```

---

### Task 5: Wire the role in, and document the layout

**Files:**
- Modify: `playbook.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: the role from Tasks 3 and 4.
- Produces: nothing later tasks need.

- [ ] **Step 1: Add the role to the play**

In `playbook.yml`, add `palworld_host` to `roles:` **after `swee_host` and before the app roles**. Host roles run before app roles deliberately: a failing role skips every role after it, and the app roles end in `fail:` on a routine outcome.

- [ ] **Step 2: Verify ordering and syntax**

Run: `tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml`
Expected: exit 0.

Run: `grep -n 'roles:\|- .*_host\|- {.*role' playbook.yml`
Expected: `palworld_host` appears after `swee_host` and before both `app`-tagged roles. **Not `-A8`** — the eight lines after `roles:` end mid-comment, so an app-tagged role never appears in the output and half the expectation would be unfalsifiable.

- [ ] **Step 3: Document the layout in the README**

Add a section covering: where game data lives and why it is not in a home directory; the group and that write is scoped by depth rather than membership; that the unit is declared and must not be hand-edited; that the reconciler deliberately never restarts the game server, so a unit change waits for the next deliberate restart; and that SteamCMD's own state stays in `/home/steam` and is why that home must continue to exist.

- [ ] **Step 4: Run the full suite and commit**

Expected: all green, no warnings or deprecations. Confirm how you checked.

```bash
git add playbook.yml README.md
git commit -m "feat: reconcile the palworld host role

Documents the layout for an operator: why game data is not in a home
directory, that write is scoped by directory depth rather than group
membership, and that a changed unit waits for a deliberate restart because
the reconciler will not disconnect players on its own."
```

---

## Operator migration (after the plan is reviewed — not part of any task)

Run by hand. `/`, `/home` and `/srv` are one filesystem, so the move is an atomic rename rather than a copy.

0. **Copy the current unit aside.** `sudo cp /etc/systemd/system/palworld-palchuds.service /root/palworld-palchuds.service.pre-relocation`
   The pre-relocation unit is the one artifact the forward path destroys and the rollback needs. `ansible.builtin.template` has no inverse — Ansible does not un-apply a file it wrote — so without this copy there is nothing to restore from.
1. **Back up the saves independently.** This is the only step in the whole arc that touches irreplaceable data.
   `sudo tar -C /home/steam/palworld/pal-chuds/Pal -czf /root/palworld-saves-$(date +%F).tgz Saved`
2. **Create the group and add `steam`:** `sudo groupadd -f palworld && sudo gpasswd -a steam palworld`
3. **Stop the server:** `sudo systemctl stop palworld-palchuds`
4. **Create the parents and move:**
   `sudo mkdir -p /srv/games/palworld && sudo mv /home/steam/palworld/pal-chuds /srv/games/palworld/`
5. **Update the three consumers' configuration** — swee's `PALWORLD_INSTALL_DIR` and `PALWORLD_SETTINGS_INI_PATH`, and `palsave-api`'s `PALSAVE_API_BACKUP_DIR`. The relocation is not complete until every consumer points at the new path.
6. **Apply**, which writes the unit and enforces the permissions:
   `sudo flock -n -E 0 /run/lyly-reconcile.lock ansible-pull -U git@github.com:LycheeHome/lychee-ops.git -d /var/lib/lychee-ops/ops -i inventory.yml --checkout main playbook.yml`
   then `sudo systemctl stop lyly-reconcile.timer`, since the apply re-enables it.
7. **Start the server:** `sudo systemctl start palworld-palchuds`
8. **Restart the two consumers** so they pick up their new configuration.

**Verification matrix** — each grant fails separately:

| check | proves |
|---|---|
| server starts, players connect | the relocation and the unit |
| an existing world loads | the saves survived the rename |
| `/config get` in Discord | read through the new path |
| `/config set` in Discord | **group write and setgid inheritance** |
| `stat -c '%U:%G %a' …/PalWorldSettings.ini` after a `/config set` | the ownership flip is harmless — group still `palworld`, mode still 664 |
| join/leave relay posts | swee's journal tailing, unaffected |
| `palsave-api` responds | its own read path |
| `systemctl is-enabled palworld-palchuds` → `enabled` | **the unit survives a reboot** |
| `namei -m /srv/games/palworld/pal-chuds/Pal/Saved/Config/LinuxServer` | every link in the traversal chain, not just the declared ends |

The last two rows check state that has **no symptom today**, which is why they need to be rows: every other check here fails visibly the moment it is wrong, and these two stay silent until a reboot or until someone tightens a mode on an intermediate directory. `is-enabled` returning `disabled` costs nothing until the host restarts and the game server does not come back — and at that point the unit file on disk looks perfectly correct, which is the worst possible place to start diagnosing. `namei -m` prints the mode of every component, so it catches a traversal link that Ansible never declared and therefore never enforces: `ansible.builtin.file` applies modes only to directories it *creates*, so a pre-existing `Pal` or `Pal/Saved/Config` keeps whatever mode the rename carried over.

`/config set` is still the one to watch. It is the only check exercising setgid inheritance and the ownership flip together, and it is the mechanism that replaced the ACL the superseded spec proposed.

**Rollback**, at any point — and it takes one step more than it looks:

```
sudo systemctl stop palworld-palchuds
sudo mv /srv/games/palworld/pal-chuds /home/steam/palworld/
sudo cp /root/palworld-palchuds.service.pre-relocation /etc/systemd/system/palworld-palchuds.service
sudo systemctl daemon-reload
# revert the lychee-ops commit, apply, restore the consumers' configuration
sudo systemctl start palworld-palchuds
```

**The unit must be restored by hand.** Moving the data back makes `palworld_host_should_declare` false, so the template task *skips* — and reverting the commit removes the role, which also does nothing, because `ansible.builtin.template` has no inverse. Either way `/etc/systemd/system/palworld-palchuds.service` still points at `/srv/games/…`, and `start` fails. The guard that makes the forward path safe is precisely what makes the reverse path incomplete. Reverting the `lychee-ops` commit is still necessary — otherwise the next tick re-declares it — but it is not sufficient.

The rename itself is as cheap in reverse.

**Afterwards**, `/home/steam/palworld` is an empty directory and can be removed. `/home/steam` keeps `.steam` and `.local/share/Steam` — SteamCMD's own 5 GB of bookkeeping, which is the one thing there that belongs in a home directory.
