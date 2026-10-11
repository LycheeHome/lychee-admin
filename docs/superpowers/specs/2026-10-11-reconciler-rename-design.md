# Rename the reconciler's units and root's fetch key — design

**Date:** 2026-10-11
**Repos:** `LycheeHome/lychee-ops` (PR 1, PR 3), `LycheeHome/lychee-admin` (PR 2)
**Status:** approved in conversation, section by section
**Follows:** `2026-10-10-host-identity-rename-design.md`, which left these two
behind on purpose (its "follow-up C").

## Goal

The last `lyly` names on the host:
- **The reconciler's own units:** `lyly-reconcile.service`, `lyly-reconcile.timer`,
  `lyly-reconcile-notify.service` and `/usr/local/sbin/lyly-reconcile-notify`
  become `lychee-reconcile…`.
- **The lock** `/run/lyly-reconcile.lock` becomes `/run/lychee-reconcile.lock`.
- **Root's app-fetch key** `/root/.ssh/id_lyly_admin` becomes `/root/.ssh/id_lychee_admin`.

The bar is the same as the host rename: no gap in reconciling, no two
reconciles running at once, and no tick that kills itself.

**Not in scope:** the `lyly.admin` UI wordmark (a design decision for
impeccable).

## The constraint that shapes it

The rename is applied **by the reconciler, from inside
`lyly-reconcile.service`**. So the switchover tick:
- **must not stop that service;**
- **may** disable and stop the old *timer*, which doesn't touch the running
  service;
- **must keep mutual exclusion** between the last old run and the first new
  run. `flock -n -E 0` on a lock file is the only thing preventing two
  reconciles on the same install directory.

## Decisions

- **The lock is shared during the transition (option A).** The new service
  keeps `/run/lyly-reconcile.lock` until PR 3, so old and new runs exclude each
  other. Rejected:
  - **A neutral lock name on the switchover tick:** the already-running old
    service still holds the old lock, so the window isn't covered.
  - **Delaying the new timer's first run past `TimeoutStartSec` (15 min):**
    it relies on timing instead of a lock, and pauses reconciling for 15
    minutes.
- **The reconciler copies the key (option A).** A guarded `cp -p` runs
  earlier in the same tick as the variable switch, so the fetch never sees a
  missing key. The old file stays until the operator deletes it. Rejected:
  - **Operator-first:** if the order slips, every fetch fails.
  - **Keeping the old name forever.**

## PR 1: lychee-ops switchover

- **Templates renamed:**
  - `lychee-reconcile.service`, `lychee-reconcile.timer` and
    `lychee-reconcile-notify.service`;
  - notify script dest `/usr/local/sbin/lychee-reconcile-notify`;
  - the new service's `OnFailure=lychee-reconcile-notify.service`;
  - **its lock still `/run/lyly-reconcile.lock`**, commented as renamed by PR 3.
- **Switchover steps in the reconciler role,** in order:
  1. install the new notify script and the three new units;
  2. `daemon-reload`, then enable and start `lychee-reconcile.timer`. Its
     first run is `OnActiveSec=2min` later; if the old run is still going, the
     shared lock makes the new run exit 0, and the next tick reconciles;
  3. disable and stop `lyly-reconcile.timer` only. Nothing in this PR stops,
     disables or removes `lyly-reconcile.service`, the unit this run is in;
  4. leave the old service, the old notify unit and the old notify script on
     disk. The running old service's `OnFailure=` still points at them, so a
     failure on the switchover tick still alerts.
- **Everything else switches:**
  - **Services board:** the inventory's timer entry becomes
    `lychee-reconcile-timer` / `lychee-reconcile.timer`.
  - **Recovery alerts:** `resources_reconcile_notify` becomes
    `/usr/local/sbin/lychee-reconcile-notify`.
  - **Docs:** `bootstrap.sh`'s by-hand command (lock path unchanged until PR 3),
    README and HOST.md.
- **The key:**
  - **The copy:** a guarded step before the app fetch. When the old key file
    exists and the new one doesn't, `cp -p` it (root:root `0600`). The decision
    is a pure task file, tested off-host: old only → copy; new present → skip;
    neither → skip, and the fetch fails as it would today.
  - **The variable:** `lychee_admin_app_deploy_key` becomes
    `/root/.ssh/id_lychee_admin`.
- **Tests:**
  - the rendered units: new names, the old lock path, `OnFailure` on the new
    notify unit;
  - the key-copy decision;
  - the full suite and the syntax check.

## PR 2: lychee-admin

- **The failure line:** its copyable command becomes `journalctl -u lychee-reconcile`.
  It's a one-word copy swap in `src/views/html.ts`, edited with Edit, with the
  detector run afterwards; the test asserting it changes too.
- **Dev seed:** the timer entry becomes `lychee-reconcile-timer` / `lychee-reconcile.timer`.
- **CLAUDE.md:**
  - current-state mentions of the reconciler's units use the new names;
  - a dated note that the journal from before the rename is under
    `journalctl -u lyly-reconcile`;
  - the "not renamed" list loses the reconciler and the key.
- **Merge timing:** any time after PR 1 is verified.

## PR 3: lychee-ops cleanup

**Merge it after PR 1 has run for several ticks.**
- **The lock:** `/run/lychee-reconcile.lock`, in the new service and in
  `bootstrap.sh`. Safe because the old timer is disabled, so nothing takes the
  old lock anymore. **Don't start a by-hand run around the merge:** the tick
  that installs the change runs under the old lock, and the next tick under the
  new one.
- **Old files declared absent:** `lyly-reconcile.service`,
  `lyly-reconcile.timer` and `lyly-reconcile-notify.service` (then
  `daemon-reload`), and `/usr/local/sbin/lyly-reconcile-notify`. A guard first
  fails the tick if `lyly-reconcile.service` is active, rather than removing a
  running unit.
- **The key-copy step stays** as a no-op.

## Operator steps (any time after PR 1 is verified)

1. **Delete the old key:** `sudo rm /root/.ssh/id_lyly_admin`.
2. **Remove the alias:** first `sudo grep -rn github-lyly-admin /root /etc 2>/dev/null`
   to confirm nothing uses it, then remove the `github-lyly-admin` block from
   `/root/.ssh/config`. The app fetch passes the key file explicitly to
   `git@github.com`, so the alias is very likely unused.
3. **Optional:** rename the deploy key's title on GitHub.

## Verification on lychee

- **After PR 1:**
  - **The switchover tick:** `lychee-reconcile.timer` is enabled and active,
    `lyly-reconcile.timer` disabled and inactive, and `/root/.ssh/id_lychee_admin`
    exists.
  - **The first run under the new name** succeeds, including the app fetch, and
    its log is under `journalctl -u lychee-reconcile`.
  - **The old service** never runs again.
- **After PR 2:** the deploy succeeds, and the failure-line copy names `lychee-reconcile`.
- **After PR 3:**
  - none of the old unit files or the old notify script remain;
  - the next ticks run under `/run/lychee-reconcile.lock`;
  - nothing on the host is named `lyly-reconcile` or `id_lyly_admin`
    (after operator step 1).

## Rollback

PR 1 reverts cleanly. The old timer is only disabled, so the revert
re-enables it, and the old key is still on disk. A revert does not know about the
new timer, though, so both timers would keep firing. The shared lock keeps
their runs from overlapping, but disable the new one by hand after reverting:
`sudo systemctl disable --now lychee-reconcile.timer`. After PR 3 and operator step
1, rolling back means re-creating those files, so give PR 1 a few days before
PR 3 if that margin matters.
