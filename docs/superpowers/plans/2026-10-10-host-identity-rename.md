# Host Identity Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app's host identity and the names it writes into data from `lyly-admin` to `lychee-admin`, in three independently safe PRs.

**Architecture:**
- **PR 1 (lychee-ops):** a guarded, reconciler-run migration renames the account in place (uid and gid kept), moves the directories, and leaves old-path symlinks plus old sudo grants as a bridge. Everything else in lychee-ops switches to the new names.
- **PR 2 (lychee-admin):** the app switches to the new paths and data names. Its Caddyfile parser accepts both marker forms.
- **PR 3 (lychee-ops):** removes the bridge and keeps the old names absent.

**Tech Stack:**
- lychee-ops: Ansible (ansible-core 2.20.1 pinned, don't bump). Suite: `./tests/run.sh </dev/null` (6–40 min, foreground). Syntax: `ANSIBLE_COLLECTIONS_PATH=$PWD/tests/.collections tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml </dev/null`.
- lychee-admin: TypeScript. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

**Spec:** `docs/superpowers/specs/2026-10-10-host-identity-rename-design.md` (lychee-admin)

## Global Constraints

- **Names:**
  - from `lyly-admin` to `lychee-admin`;
  - the service `lychee-admin.service`;
  - the directories `/opt/lychee-admin`, `/var/lib/lychee-admin`, `/etc/lychee-admin`, `/var/log/lychee-admin`;
  - the home `/home/lychee-admin`;
  - sudoers `/etc/sudoers.d/lychee-admin`;
  - the wrappers `/usr/local/sbin/lychee-admin-write-config`, `lychee-admin-create-site-dir`, `lychee-admin-resource-status`;
  - root's fetch key `/root/.ssh/id_lychee_admin`;
  - lychee-ops' clone `{{ ops_root }}/src/lychee-admin`.
- **The uid and gid never change, and nothing is `chown`ed.** The rename is `usermod -l … -d … -m` plus `groupmod -n`.
- **Every migration and bridge step is guarded by the state of its own path or account,** so a partial run resumes on the next tick. A conflict (old and new both real) fails the tick and changes nothing.
- **`identity_migration_from: lyly-admin` and `identity_migration_to: lychee-admin`** in `group_vars`. Every migration step reads only these two variables; rollback is swapping them.
- **Not renamed:** the `lyly-reconcile` units, the `lyly.admin` wordmark, `webdeploy`.
- **The public repo (lychee-admin) carries no uids, gids, tailnet address or tokens.**
- **Branches:** PR 1 is `feat/rename-host-identity` (lychee-ops); PR 2 is `feat/rename-host-identity` (lychee-admin, cut from `docs/host-rename-spec`); PR 3 is `chore/remove-rename-bridge` (lychee-ops, cut from PR 1's branch, **merged only after PR 2 has deployed**). Never push from a task.

## Review Focus

1. **A migration interrupted after the account rename but before the directory moves:** the next tick must still move the directories, even though the account check now reads "new user exists". Directory moves are decided per path, not by the account decision. *(Task 2 test.)*
2. **Old and new path both real directories:** fail the tick, move nothing, name the path. *(Task 2 test.)*
3. **Both the old and the new user exist:** fail the tick, change nothing. *(Task 2 test.)*
4. **A `--check` dry run on a host mid-migration:** no change, and no undefined reads. Every decision input is read with `check_mode: false`, and every changing step is skipped. *(Task 3, verified with `--syntax-check`, and on the host by the operator's dry run if wanted.)*
5. **The old app between PR 1 and PR 2,** writing old Caddyfile markers: the PR 2 parser reads them. *(Task 4 test.)*

---

## PR 1: lychee-ops (`feat/rename-host-identity`)

### Task 1: Rename the roles and their variables (no behaviour change)

**Files:**
- `git mv roles/lyly_admin_app roles/lychee_admin_app` and `git mv roles/lyly_admin_host roles/lychee_admin_host`.
- Every `lyly_admin_app` / `lyly_admin_host` reference in `playbook.yml`, `roles/**`, `tests/**`, `group_vars/all.yml`, `README.md`, `HOST.md` and `bootstrap.sh`.
- Every variable prefixed `lyly_admin_` → `lychee_admin_` (e.g. `lyly_admin_app_deploy_result`, `lyly_admin_host_passwd`), including the test fixtures.

**Not in this task:** file names inside the roles (`lyly-admin.service`, the `lyly-admin-*.sh` wrappers), host paths, and `group_vars` values. Those are Task 3.

- [ ] **Step 1:** Rename, then check `git grep -nE "lyly_admin_" -- . ':!tests/.venv' ':!tests/.collections'`. Expected: no hits, or only dated historical prose, each listed in the report.
- [ ] **Step 2:** Syntax check and `./tests/run.sh </dev/null`. Expected: PASS, with the same play count as before the rename (`ok=` within ±0 of the baseline, which you record first on `main`).
- [ ] **Step 3: Commit** `refactor: lychee_admin_* roles and variables`.

### Task 2: The migration's decision file (pure)

**Files:**
- Create `roles/lychee_admin_host/tasks/decide_identity_migration.yml`.
- Test `tests/test_identity_migration.yml`, appended to `run.sh`'s final `exec` line.

**Interfaces:**
- **Consumes:**
  - `identity_migration_from` and `identity_migration_to`;
  - `identity_migration_passwd` (`getent passwd` mapping);
  - `identity_migration_paths`, a list of `{old, new, old_is_dir, old_is_link, new_exists}` built by Task 3 from `stat` results.
- **Produces:**
  - `identity_migration_rename_account`: bool, true only when from-user exists and to-user doesn't;
  - `identity_migration_moves`: the `{old, new}` entries to move, where old is a real directory (not a link) and new doesn't exist;
  - `identity_migration_conflicts`: sentences, e.g. `both /opt/lyly-admin and /opt/lychee-admin exist as real directories` and `both users lyly-admin and lychee-admin exist`.

- [ ] **Step 1: Write failing plays:**
  - **Accounts:** the four account rows from the spec table. Old only → rename true. New only → false. Both → a conflict naming both users. Neither → false.
  - **Paths:**
    - old real dir, new absent → moved;
    - old is a link, new exists → not moved, no conflict (already bridged);
    - old absent → nothing;
    - old real dir **and** new exists → conflict, naming both paths.
  - **Review Focus #1:** the new user exists, the old is gone, and `/opt/lyly-admin` is still a real directory with the new path absent → `rename_account` false **and** the move is listed.
- [ ] **Step 2:** Run the file. Expected: FAIL (file missing).
- [ ] **Step 3: Implement** as a pure `set_fact`, with a header listing what it consumes and produces, in the style of `decide_accounts.yml`.
- [ ] **Step 4:** Run the file, then the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: decide the identity migration from account and path state`.

### Task 3: Migrate, bridge, and switch lychee-ops to the new names

**Files:**
- **Create:** `roles/lychee_admin_host/tasks/migrate_identity.yml`, imported **first** in `roles/lychee_admin_host/tasks/main.yml`, before `accounts.yml`.
- **Create:** `roles/lychee_admin_host/tasks/bridge.yml`, imported **after** the wrapper and resource-status installs.
- **Modify `group_vars/all.yml`:**
  - `identity_migration_from: lyly-admin`, `identity_migration_to: lychee-admin`;
  - `src_dir: "{{ ops_root }}/src/lychee-admin"`;
  - `app_install_dir: /opt/lychee-admin`, `app_user: lychee-admin`;
  - `status_file: /var/lib/lychee-admin/deploy-status.json`;
  - `host_accounts`: rename the `lyly-admin` group and user entries to `lychee-admin`, with the same numbers and home `/home/lychee-admin`.
- **Modify:** `roles/lychee_admin_app/defaults/main.yml` (`lychee_admin_app_deploy_key: /root/.ssh/id_lychee_admin`).
- **Rename and edit:** `files/lyly-admin.service` → `files/lychee-admin.service`:
  - `Description`, `User`, `WorkingDirectory`, `EnvironmentFile` and `ExecStart` under `/opt/lychee-admin`;
  - `ReadWritePaths` with `/etc/lychee-admin/backups`, `/var/lib/lychee-admin`, `/var/log/lychee-admin`;
  - comments updated.
- **Rename:** `files/lyly-admin-write-config.sh` → `files/lychee-admin-write-config.sh`; `templates/lyly-admin-create-site-dir.sh.j2` and `templates/lyly-admin-resource-status.sh.j2` → `lychee-admin-…`. Their install `dest`s become `/usr/local/sbin/lychee-admin-*`; internal messages naming themselves follow.
- **Modify `files/sudoers.example`:**
  - user `lychee-admin`;
  - the alias renamed `LYCHEE_ADMIN_CMDS`;
  - the new wrapper paths **and** the three old ones, with the write-config pins on both;
  - a comment saying the old paths are PR 3's to remove.
- **Modify:** the role's install task `dest`s (`/etc/systemd/system/lychee-admin.service`, `/etc/sudoers.d/lychee-admin`); handlers and app-role tasks that name the unit; `roles/inventory/defaults/main.yml:53` (`unit: lychee-admin.service`).
- **The restart handler** is renamed `Restart lychee-admin` (`systemd: name=lychee-admin state=restarted enabled=true`), and the new unit's install task notifies it. **This is what starts the service on PR 1's tick:** the app's commit doesn't change on that tick, so the app role doesn't restart anything. The handler is flushed by the role's existing "Flush host handlers" task, which runs before the app role.
- **Modify `README.md` and `HOST.md`:** new paths and names, and a dated note on the rename.

**`migrate_identity.yml`, in order:**
1. **Read inputs, with `check_mode: false`:** `getent passwd`; and `stat` of the four directory pairs `/opt`, `/var/lib`, `/etc` and `/var/log` `/<from>` vs `/<to>`, plus `/root/.ssh/id_<from with - as _>` vs `…<to>` and `{{ ops_root }}/src/<from>` vs `…<to>`. Then build `identity_migration_paths` and `import_tasks: decide_identity_migration.yml`.
2. **`fail`** when `identity_migration_conflicts` is non-empty, listing them, before anything changes.
3. **When `identity_migration_rename_account`:**
   - `systemd` stop and disable `<from>.service`;
   - `command: usermod -l <to> -d /home/<to> -m <from>`;
   - `command: groupmod -n <to> <from>`.

   Each runs with `when` on the decision, `changed_when: true`, and is skipped in check mode (the module's default for `command`).
4. **For each of `identity_migration_moves`:** `command: mv <old> <new>`, skipped in check mode.
5. **Old unit and sudoers files:** declare `/etc/systemd/system/<from>.service` and `/etc/sudoers.d/<from>` absent, then `systemd: daemon_reload: true` when either changed.

**`bridge.yml`:**
- **Directory symlinks:** for the four old directory paths, `file: state=link src=<new> dest=<old>`, **only when** `<old>` is not a real directory (stat). Step 2 already refuses the conflicting case.
- **Wrapper symlinks:** for the three old wrapper paths, `file: state=link src=/usr/local/sbin/lychee-admin-X dest=/usr/local/sbin/lyly-admin-X force=true`. The old path is a regular file today, and `force` replaces it.
- **Header comment:** this file exists only until PR 3; the app between PR 1 and PR 2 reaches everything through it.

- [ ] **Step 1:** Extend `tests/run.sh`'s static checks:
  - `visudo -csf` the new sudoers file;
  - assert it contains both `/usr/local/sbin/lychee-admin-create-site-dir` and `/usr/local/sbin/lyly-admin-create-site-dir`, and the user line `lychee-admin ALL=(root) NOPASSWD: LYCHEE_ADMIN_CMDS`;
  - assert `files/lychee-admin.service` has `User=lychee-admin` and no `lyly`.

  Run. Expected: FAIL.
- [ ] **Step 2:** Implement everything above.
- [ ] **Step 3:**
  - Syntax check, then `./tests/run.sh </dev/null`. Expected: PASS.
  - `git grep -nE "lyly-admin" -- roles group_vars playbook.yml` lists only: `identity_migration_from`, `bridge.yml`'s old paths, sudoers' old wrapper paths, and dated historical comments. List them in the report.
- [ ] **Step 4: Commit** `feat: rename the host identity to lychee-admin, with a bridge for the old paths`.

---

## PR 2: lychee-admin (`feat/rename-host-identity`)

### Task 4: Paths, markers, identity and strings

**Files:**
- `src/config.ts`: `backupDir` / `logFile` defaults.
- `src/lib/declarationWriter.ts`:
  - `RESOURCES_CLONE`, `RESOURCES_KEY`, `RESOURCES_KNOWN_HOSTS`;
  - the git `user.name` / `user.email` (`lychee-admin`, `lychee-admin@lychee.local`);
  - the header `# Written by lychee-admin for <hostname>.`;
  - the reserved-port message.
- `src/lib/systemCommands.ts`: the three wrapper paths and the `lychee-admin-write-config exited …` message.
- `src/lib/caddyfile.ts`:
  - **The parser** accepts `#\s*(?:lyly|lychee)-admin-framework:` and `…-healthcheck:`.
  - **The writer** emits `lychee-admin-…`.
- `src/middleware/auth.ts`: realm `lychee-admin`.
- `src/routes/sites.ts`: placeholder text and the `reserved (lychee-admin itself)` label.
- `src/server.ts`, `src/dev/server.ts`: startup log lines.
- `src/lib/siteValidation.ts`: comment and message.
- `src/lib/serviceInventory.ts`: comment.
- `src/dev/seed.ts`:
  - the services unit `lychee-admin.service`;
  - markers in the new form, **except one block kept in the old form**, so dev mode exercises the legacy parse.
- `package.json` / `package-lock.json` `"name"`.
- Tests that assert any of these.

- [ ] **Step 1: Write failing tests:**
  - **Old and new markers parse identically:** `parseSites` on a block with `# lyly-admin-framework: nextjs` / `# lyly-admin-healthcheck: /api/health` and on one with `lychee-admin-…` yields the same `framework` / `healthcheckPath`.
  - **The writer emits only the new form:** `appendSite` output contains `# lychee-admin-framework:` and not `lyly-admin`.
  - **The writer's commit config:** contains `user.email=lychee-admin@lychee.local`.
  - **The realm:** the auth middleware sends `Basic realm="lychee-admin"`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. **`src/views` is edited with Edit/Write only, if at all** (the design hook watches those tools).
- [ ] **Step 4:**
  - `npm test && npm run typecheck && npm run lint && npm run build`. Expected: PASS.
  - `git grep -nE "lyly-admin" -- src public package.json` lists only the parser's legacy marker alternative, the seed's deliberate old-form block, and historical comments; list them.
  - Run the design detector by hand on `src/views` (`<impeccable>/scripts/impeccable detect --json src/views`). Expected: no new findings versus `main`.
- [ ] **Step 5: Commit** `feat: the app uses the lychee-admin host names`.

### Task 5: Docs

**Files:**
- **`CLAUDE.md`:**
  - **Purpose:** "the app is still `lyly-admin`" becomes the dated history of the rename. The repo and the app are now both `lychee-admin`, and the reconciler's own `lyly-reconcile` units are still to come.
  - **Host paths, user, unit and wrapper names** in prose move to the new names, with history kept.
  - **The markers paragraph** says both forms are read and only the new one is written.
- `PRODUCT.md`, `README.md`.

**No uids or gids in any of it** (public repo).

- [ ] **Step 1:** Edit.
- [ ] **Step 2:**
  - `npm run lint`.
  - `git grep -nE "lyly-admin" -- '*.md' ':!docs'`: every remaining hit is history or the legacy marker; list them.
  - search the changed docs for any uid/gid number from lychee-ops' `host_accounts` and for the tailnet address (both taken from lychee-ops, not written here); no hits.
- [ ] **Step 3: Commit** `docs: lychee-admin is the app's host identity`.

---

## PR 3: lychee-ops (`chore/remove-rename-bridge`, merge only after PR 2 deploys)

### Task 6: Remove the bridge; keep the old names absent

**Files:**
- **Delete** `roles/lychee_admin_host/tasks/bridge.yml` and its import.
- **Create** `roles/lychee_admin_host/tasks/retire_old_identity.yml`, imported after the wrapper installs:
  - for the seven old paths: `stat`; `file: state=absent` **only when** the stat says it is a link; a `fail` naming any old path that is a real directory or regular file (nothing deleted);
  - `getent` and a `fail` if a user or group named `identity_migration_from` exists. It never deletes.
- **Modify `sudoers.example`:** remove the three old wrapper paths and their comment.
- **Modify `run.sh`:** the sudoers checks now assert the old path is **absent**.
- **Modify `HOST.md` / `README.md`:** the bridge is gone.

**Keep:** `migrate_identity.yml` (a no-op from now on, and the rollback mechanism).

- [ ] **Step 1:** Update the `run.sh` sudoers checks (old path must be absent). Run. Expected: FAIL.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Syntax check, then `./tests/run.sh </dev/null`. Expected: PASS.
- [ ] **Step 4: Commit** `chore: remove the lyly-admin bridge; keep the old names absent`.

---

## Operator sequence

The spec's "Verification on lychee" steps, run by the controller with the operator:
1. **Merge PR 1.** Verify after its tick.
2. **Merge PR 2.** Verify after its deploy.
3. **Merge PR 3.** Verify after its tick.

The next PR is never merged until the previous one's checks pass.
