# Reconciler and Fetch-Key Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `lyly-reconcile.*`, its notify script, its lock and root's app-fetch key to `lychee-…` names, without a tick killing itself or two reconciles overlapping.

**Architecture:** Three PRs.
- **PR 1 (lychee-ops):** installs and starts `lychee-reconcile.*` and disables only the old timer, from inside the old service. Both units share the old lock path. A guarded step copies root's fetch key to its new name before the app fetch.
- **PR 2 (lychee-admin):** updates the copyable journal command, the dev seed and CLAUDE.md.
- **PR 3 (lychee-ops):** moves the lock to its new path and removes the old units, refusing while the old service is active.

**Tech Stack:**
- **lychee-ops:** Ansible (ansible-core 2.20.1 pinned, don't bump). Suite `./tests/run.sh </dev/null` (6–40 min, foreground). Syntax `ANSIBLE_COLLECTIONS_PATH=$PWD/tests/.collections tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml </dev/null`.
- **lychee-admin:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-11-reconciler-rename-design.md` (lychee-admin)

## Global Constraints

- **New names:**
  - `lychee-reconcile.service`, `lychee-reconcile.timer`, `lychee-reconcile-notify.service`;
  - `/usr/local/sbin/lychee-reconcile-notify`;
  - the inventory entry `lychee-reconcile-timer` / `lychee-reconcile.timer`;
  - the key `/root/.ssh/id_lychee_admin`.
- **The lock:** **`/run/lyly-reconcile.lock` through PR 1 and PR 2**, then `/run/lychee-reconcile.lock` from PR 3 on.
- **PR 1 never stops, disables or removes `lyly-reconcile.service`.** It disables and stops only `lyly-reconcile.timer`.
- **PR 1 leaves the old service, notify unit and notify script on disk.** PR 3 removes them, failing the tick if `lyly-reconcile.service` is active.
- **The key copy (the spec's guarded `cp -p`, done as Ansible `copy` with `remote_src: true`, `force: false`) runs only when the old key exists and the new one doesn't. It never overwrites,** and it keeps the old file. Root:root `0600`.
- **Branches:** PR 1 is `feat/rename-reconciler` (lychee-ops). PR 2 is `feat/rename-reconciler` (lychee-admin, cut from `docs/reconciler-rename-spec`). PR 3 is `chore/retire-lyly-reconcile` (lychee-ops, cut from PR 1's branch, rebased onto main after PR 1 merges). Never push from a task.
- **lychee-admin is public:** no uids, gids, tailnet address or tokens.

## Review Focus

1. **The switchover tick fails after the new timer is enabled but before the old timer is disabled:** both timers fire until a later tick finishes the switch. The shared lock keeps their runs apart, and the next completed tick disables the old timer. The order must be: enable the new timer, then disable the old one. *(Task 2: task order, plus a comment. Host-only.)*
2. **A fresh host, or a `--check` run, where `lyly-reconcile.timer` doesn't exist:** disabling it must not fail. Guard it with a `stat` of the old unit file (`check_mode: false`). *(Task 2.)*
3. **A new key that already exists and differs from the old one** (the operator placed it): skip, never overwrite. *(Task 1 test.)*
4. **PR 3's tick while `lyly-reconcile.service` is somehow active:** fail and remove nothing. *(Task 4. Host-only; the guard reads `systemctl is-active` with `check_mode: false`.)*
5. **The app's failure line offers `journalctl -u lychee-reconcile`.** *(Task 3 test.)*

---

## PR 1: lychee-ops (`feat/rename-reconciler`)

### Task 1: Copy root's fetch key, then point the app fetch at it

**Files:**
- Create `roles/lychee_admin_app/tasks/decide_key_copy.yml` (pure).
- Modify `roles/lychee_admin_app/tasks/main.yml`. Before "Fetch the app repo":
  - `stat` the old and new key (`follow: false`, `check_mode: false`);
  - import the decision;
  - `copy` with `remote_src: true` and `force: false` from old to new, mode `0600`, root:root, when the decision says so and not in check mode.
- Modify `roles/lychee_admin_app/defaults/main.yml`:
  - `lychee_admin_app_deploy_key: /root/.ssh/id_lychee_admin`;
  - a new `lychee_admin_app_deploy_key_previous: /root/.ssh/id_lyly_admin`, commented as there only for the one-time copy.
- Test: `tests/test_key_copy.yml`, appended to `run.sh`'s final `exec` line.

**Interfaces:**
- Consumes `lychee_admin_app_key_old_exists` and `lychee_admin_app_key_new_exists` (bools).
- Produces `lychee_admin_app_copy_key` (bool).

- [ ] **Step 1: Failing plays:**
  - old only → `copy_key` true;
  - old and new → false;
  - new only → false;
  - neither → false.
- [ ] **Step 2: Run the file.** Expected: FAIL (the decision file is missing).
- [ ] **Step 3: Implement.** Comment that the copy keeps the old file (the operator deletes it) and never overwrites (`force: false` as well as the decision).
- [ ] **Step 4:** Run the file, then the syntax check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: copy the app fetch key to id_lychee_admin and use it`.

### Task 2: Rename the units; switch over from inside the old service

**Files:**
- **`git mv` the templates:**
  - `lyly-reconcile.service.j2` → `lychee-reconcile.service.j2`;
  - `lyly-reconcile.timer.j2` → `lychee-reconcile.timer.j2`;
  - `lyly-reconcile-notify.service.j2` → `lychee-reconcile-notify.service.j2`.
- **Edit:**
  - `OnFailure=lychee-reconcile-notify.service`;
  - the notify unit's `ExecStart=/usr/local/sbin/lychee-reconcile-notify` and its Description;
  - **keep `/run/lyly-reconcile.lock`** in `ExecStart`, with a comment that PR 3 renames it and why it's shared.
- **Modify `roles/reconciler/tasks/main.yml`:**
  - the notify script's dest becomes `/usr/local/sbin/lychee-reconcile-notify`;
  - the unit loop installs the three new units;
  - "Enable the reconcile timer" starts `lychee-reconcile.timer` (with `daemon_reload`). **Then** a `stat` of `/etc/systemd/system/lyly-reconcile.timer` (`check_mode: false`), and `systemd: name=lyly-reconcile.timer enabled=false state=stopped` when it exists and not in check mode;
  - **no task touches `lyly-reconcile.service`**;
  - a block comment explaining the switchover (Review Focus #1, #2).
- **Modify:**
  - `roles/inventory/defaults/main.yml`: the entry becomes `lychee-reconcile-timer` / `lychee-reconcile.timer`;
  - `roles/resources_reconcile/defaults/main.yml`: `resources_reconcile_notify: /usr/local/sbin/lychee-reconcile-notify`, plus the `notify_recovery.yml` default;
  - `bootstrap.sh`: the unit names in its echoes. **The lock path stays.**
- **Modify docs:** README.md and HOST.md, with current names and a dated note that the journal from before the rename is under `-u lyly-reconcile`. Comments elsewhere that name the units become the new names, except dated history.
- **Tests:** `tests/run.sh` renders the three templates with Ansible's own templating against the real `group_vars` (as it does for the other wrappers). It asserts:
  - the service contains `OnFailure=lychee-reconcile-notify.service` and `flock -n -E 0 /run/lyly-reconcile.lock`;
  - the notify unit contains `ExecStart=/usr/local/sbin/lychee-reconcile-notify`;
  - none of the three contains `lyly-reconcile.service` or `lyly-reconcile-notify`.

  The inventory test and any fixture naming the timer move to the new name.

- [ ] **Step 1:** Add the `run.sh` render checks and move the fixtures. Run. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:**
  - Run `./tests/run.sh </dev/null` and the syntax check. Expected: PASS.
  - `git grep -nE "lyly-reconcile" -- roles group_vars playbook.yml bootstrap.sh` lists only: the lock path, the old-timer disable task and its `stat`, and dated history. Report each.
- [ ] **Step 4: Commit** `feat: lychee-reconcile units, switched over from inside the old service`.

---

## PR 2: lychee-admin (`feat/rename-reconciler`)

### Task 3: The app's copy, seed and CLAUDE.md

**Files:**
- `src/views/html.ts:~847`: the command becomes `journalctl -u lychee-reconcile`. **Edit with the Edit tool only**, then run the design detector on `src/views`.
- The test that asserts the command, in `src/views/html.test.ts` (find it by the old string).
- `src/dev/seed.ts:~131, ~206`: `lychee-reconcile-timer` / `lychee-reconcile.timer`.
- **CLAUDE.md:**
  - current-state mentions of `lyly-reconcile.*` and `lyly-reconcile-notify` become the new names;
  - a dated note that the journal from before the rename is under `journalctl -u lyly-reconcile`;
  - the lock-path mention stays `/run/lyly-reconcile.lock` until PR 3, and says so;
  - the "not renamed" sentences about the reconciler and root's key are updated: the key is now `id_lychee_admin`, and the old file is deleted by hand.

- [ ] **Step 1:** Update the test to expect `journalctl -u lychee-reconcile`. Run `npm test`. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:**
  - Run `npm test && npm run typecheck && npm run lint && npm run build`. Expected: PASS.
  - The detector reports 0 findings.
  - `git grep -nE "lyly-reconcile" -- src CLAUDE.md` lists only history and the transitional lock path.
- [ ] **Step 4: Commit** `feat: name lychee-reconcile in the app and its docs`.

---

## PR 3: lychee-ops (`chore/retire-lyly-reconcile`, merge after PR 1 has run several ticks)

### Task 4: The new lock path; remove the old units

**Files:**
- `roles/reconciler/templates/lychee-reconcile.service.j2`: the lock becomes `/run/lychee-reconcile.lock`, with a comment on why that's safe now (the old timer is disabled, so nothing takes the old lock).
- `bootstrap.sh`: the by-hand command's lock path.
- **`roles/reconciler/tasks/main.yml`,** after the new units are enabled:
  - `command: systemctl is-active lyly-reconcile.service` (`check_mode: false`, `failed_when: false`, `changed_when: false`);
  - `fail` if its stdout is `active` or `activating`, with a message saying to wait for it to finish;
  - then `file: state=absent` for `/etc/systemd/system/lyly-reconcile.service`, `…/lyly-reconcile.timer`, `…/lyly-reconcile-notify.service` and `/usr/local/sbin/lyly-reconcile-notify`;
  - then `systemd: daemon_reload: true` when any of them changed, and not in check mode.
- **Remove** the old-timer disable task and its `stat` from PR 1, since the old timer file is now declared absent.
- **`run.sh`:** the render check now asserts `/run/lychee-reconcile.lock` and that no rendered unit contains `lyly-reconcile`.
- **Docs:** README and HOST.md (the lock path, the old units gone, and "don't start a by-hand run around this merge").

- [ ] **Step 1:** Update the `run.sh` assertions. Run. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:**
  - Run `./tests/run.sh </dev/null` and the syntax check. Expected: PASS.
  - `git grep -nE "lyly-reconcile" -- roles group_vars playbook.yml bootstrap.sh` lists only the absent-declarations, the guard, and dated history.
- [ ] **Step 4: Commit** `chore: lychee-reconcile.lock; remove the old reconcile units`.

---

## Operator sequence

The spec's verification steps, done by the controller with the operator:
1. **Merge PR 1.** Verify after its tick and the first `lychee-reconcile` run.
2. **Merge PR 2.**
3. **By hand:** the key and alias steps.
4. **After several ticks, merge PR 3.** Verify.
