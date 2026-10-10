# Rename the app's host identity from lyly-admin to lychee-admin: design

**Date:** 2026-10-10
**Repos:** `LycheeHome/lychee-ops` (PR 1 and PR 3), `LycheeHome/lychee-admin` (PR 2)
**Status:** approved in conversation, section by section
**Follow-up, separate:** rename the reconciler's own `lyly-reconcile` units (scope C).

## Goal

Make the host stop saying `lyly`. The repository is already `lychee-admin`
(2026-10-09), and the app's host identity and every name it writes into data
now follow it. Nothing gains functionally, so the bar is safety:
- no downtime beyond service restarts;
- no file left owned by a stale uid;
- no tick where the reconciler and the host disagree about names.

## Scope (option A)

**Renamed:**
- **Host identity:**
  - user and group `lyly-admin` → `lychee-admin`;
  - `lyly-admin.service` → `lychee-admin.service`;
  - `/opt/lyly-admin`, `/var/lib/lyly-admin`, `/etc/lyly-admin`, `/var/log/lyly-admin` → `…/lychee-admin`;
  - home `/home/lyly-admin` → `/home/lychee-admin`;
  - `/etc/sudoers.d/lyly-admin` → `…/lychee-admin`;
  - wrappers `/usr/local/sbin/lyly-admin-{write-config,create-site-dir,resource-status}` → `lychee-admin-…`;
  - root's app-fetch key `/root/.ssh/id_lyly_admin` → `id_lychee_admin`;
  - lychee-ops' app clone `…/src/lyly-admin` → `…/src/lychee-admin`.
- **Names the app writes into data:**
  - Caddyfile markers `# lyly-admin-framework:` and `# lyly-admin-healthcheck:`;
  - the git commit identity;
  - the declaration header comment;
  - the Basic-auth realm;
  - `package.json`'s name.
- **lychee-ops internals:** the roles `lyly_admin_app` / `lyly_admin_host` → `lychee_admin_*`, and their `lyly_admin_*` variables.

**Not renamed here:**
- the reconciler's own units (`lyly-reconcile.*`, `lyly-reconcile-notify`): scope C, a separate follow-up;
- the `lyly.admin` UI wordmark: a design decision for impeccable;
- the `webdeploy` group, which is not named after the app.

## Approach: rename in place, reconciler-run, with a temporary bridge

**Rejected alternatives:**
- **A by-hand runbook:** it races the reconciler, as every earlier hand migration did, and nothing records it.
- **A new account with a new uid, plus migration:** every file would need re-owning. Renaming keeps the uid, which makes that unnecessary.

**Why a bridge:** the app's code hardcodes host paths and wrapper paths, and sudo pins wrapper paths exactly. So the host and the app must agree at every moment. Three PRs, each safe on its own, in this order:
1. **lychee-ops renames the host** and leaves the old paths working as symlinks, with sudo granting the old wrapper paths too.
2. **lychee-admin switches** to the new names.
3. **lychee-ops removes the bridge.**

## PR 1: lychee-ops renames the host

**Migration task file** (e.g. `roles/lychee_admin_host/tasks/migrate_identity.yml`):
- **Where it runs:** first in the host role, before the account declarations.
- **Inputs:** `identity_migration_from` (`lyly-admin`) and `identity_migration_to` (`lychee-admin`) in `group_vars`. Swapping them is the rollback; see below.
- **When it runs:** a pure decision file, `decide_identity_migration.yml`, tested off-host, rules from `getent`:

  | old user exists | new user exists | action |
  |---|---|---|
  | yes | no | migrate |
  | no | yes | skip (already done, or a fresh host) |
  | yes | yes | fail the tick with a clear message; change nothing |
  | no | no | skip (a fresh host; the declarations create the new user) |

**Steps, each guarded so a partial run resumes on the next tick:**
1. **Stop and disable** the old service. `usermod` refuses to rename a user with running processes.
2. **Rename the account:** `usermod -l <to> -d /home/<to> -m <from>`, then `groupmod -n <to> <from>`. The uid and gid are unchanged, so every file keeps its owner. No `chown` anywhere.
3. **Move the four directories:** `/opt`, `/var/lib`, `/etc` and `/var/log` `<from>` → `<to>`. Each move happens only when the old path is a real directory and the new path is absent. `.env`, `.deployed-sha`, `.failed-sha`, the backups, the write key, `known_hosts` and the declarations clone all move with them. The same applies to root's fetch key and lychee-ops' clone directory.
4. **Leave symlinks at the old paths** pointing to the new ones: the four directories and the three wrapper paths. The unchanged app keeps working through them.

**The rest of the role then runs under the new names:**
- **Accounts:** `host_accounts` names `lychee-admin` (same uid and gid as before), and `app_user` is `lychee-admin`. The account check confirms the numbers.
- **The unit:** `lychee-admin.service`, with `ReadWritePaths` covering the new directories. The old unit file is declared absent, followed by a daemon-reload.
- **sudo:** `/etc/sudoers.d/lychee-admin` for user `lychee-admin` grants the new wrapper paths **and the old ones**, installed through `visudo -csf`. The old sudoers file names the old user and is declared absent.
- **The wrappers:** installed at the new paths.
- **Inventory:** the services board lists `lychee-admin.service`.
- **The app role** starts and health-checks `lychee-admin.service` as on any deploy.

**Failure handling:** if the migration fails partway, the app stays down and the tick fails and alerts. The next tick resumes from the first unfinished step.

**lychee-ops internals:** roles and variables are renamed (`lychee_admin_app`, `lychee_admin_host`, `lychee_admin_*`).

**Tests:**
- `decide_identity_migration.yml`: all four rows of the table.
- The rendered unit and sudoers files, the latter via `visudo -csf`, including the old wrapper paths.
- The full suite and the syntax check.

## PR 2: lychee-admin switches to the new names

**Paths:**
- **`config.ts` defaults:** `/etc/lychee-admin/backups`, `/var/log/lychee-admin/actions.log`.
- **`declarationWriter.ts`:** clone, key and `known_hosts` under `/var/lib/lychee-admin` and `/etc/lychee-admin`.
- **`systemCommands.ts`:** `/usr/local/sbin/lychee-admin-*`.

**Data:**
- **Caddyfile markers:** writes `# lychee-admin-framework:` and `# lychee-admin-healthcheck:`. **The parser reads both old and new markers, permanently.** The old app may write old markers between PR 1 and PR 2, and old backups carry them.
- **Git:** commits authored `lychee-admin <lychee-admin@lychee.local>`.
- **Declaration headers:** `# Written by lychee-admin for <hostname>.` Existing headers stay as they are; they're only comments.
- **Login:** the Basic-auth realm is `lychee-admin`, so browsers re-prompt once.
- **`package.json` / lockfile name:** `lychee-admin`.
- **App text:** user-facing and log strings, and the placeholder `index.html` text.

**Docs:** CLAUDE.md's "the app is still `lyly-admin`" passage becomes history, and host paths in prose, PRODUCT.md, README and the dev seed's service list move.

**Tests:**
- markers parse in both forms, and only the new form is written;
- the writer's commit identity and the declaration header;
- path and realm assertions move to the new values;
- the full suite, typecheck, lint and build;
- the design detector run by hand on `src/views`.

## PR 3: lychee-ops removes the bridge

**Merge it only after PR 2 has deployed.** It then:
- **Removes the seven old-path symlinks,** each only if it is a symlink. A real directory at an old path fails the tick and nothing is deleted.
- **Drops the old wrapper paths** from sudoers.
- **Keeps the old names absent from now on:** the old unit and sudoers files and the wrapper paths. It also checks that no `lyly-admin` user or group exists; that check only reports, it never deletes.

## Verification on lychee

1. **After PR 1:**
   - **The migration:** ran once, `id lychee-admin` shows the unchanged uid and gid, the directories and the key moved, the old paths are symlinks, and the old unit and sudoers files are gone.
   - **The app:** `lychee-admin.service` is active and answers `401`.
   - **The operator** runs `sudo -l -U lychee-admin` (both path sets listed) and adds and removes a static site.
   - **The next tick:** skips the migration.
2. **After PR 2:**
   - **Deploy:** installed at `/opt/lychee-admin` with `gate: ok`.
   - **Login:** the browser re-prompts once.
   - **Static site:** add and remove one, through the new wrappers.
   - **Next.js:** a site page or `/sites/new` pulls with the moved key.
   - **Optional:** an attach-and-prune cycle shows commits authored by `lychee-admin`.
3. **After PR 3:**
   - **Old names gone:** no `lyly-admin` paths, and no `lyly-admin` user or group.
   - **sudo:** lists only the new paths.
   - **The app:** still answers `401`, and add/remove works.
   - **`https://admin.lychee.land`** still returns `401`.

## Rollback

Not a plain revert. Reverting PR 1 would have the account declarations try to create `lyly-admin` with a uid `lychee-admin` already holds, so the check fails the tick.

Rolling back means swapping `identity_migration_from` and `identity_migration_to` and reverting PR 1's other changes. The same guarded steps then run in reverse. Fixing forward is expected; each step's guard also means a half-finished migration resumes rather than needing to be undone.
