# Pull-based deploy — design

Date: 2026-09-18
Status: approved, ready for implementation planning
Slice: 1 — see "Follow-on slices"

## Problem

`lyly-admin` deploys via `.github/workflows/deploy.yml`'s `deploy` job, which runs
on a self-hosted GitHub Actions runner named `lychee` — the same host the app
administers. That is safe only while the repo is private. The goal is to make the
repo public, and a public repo plus a self-hosted runner is a remote code
execution path: for a `pull_request` event GitHub runs the workflow file **from
the PR head commit**, so a fork supplies its own `runs-on:`. The `deploy` job's
`if:` guards do not help, because an attacker adds their own job rather than
using the guarded one.

The runner's job user, `github-runner`, is a `webdeploy` member with write access
to `/opt/lyly-admin` (the directory the systemd service runs from) and NOPASSWD
sudo for `systemctl restart lyly-admin`. One fork-PR job is enough to plant a
persistent backdoor inside the app that rewrites the Caddyfile and tunnel
ingress.

### This exposure is already live

Investigation on 2026-09-15 found the org already has a public repo using this
runner:

- `LycheeHome/swee` is public (`allow_forking: true`) and its `ci.yml` has a
  `deploy` job with `runs-on: self-hosted`.
- That job's most recent run completed successfully on `runner_name: lychee`,
  `runner_group_name: default`.

A job cannot schedule on a runner group that denies public repositories, so the
`default` group **already permits them**. `swee` also has a `pull_request`-
triggered workflow, so fork PRs do fire there. The only thing standing in the way
is the fork-PR approval policy, which could not be read (it needs `admin:org`;
the available token has `read:org`). `swee` has 0 forks and every PR to date came
from inside the org, so nothing appears to have happened.

Because `swee` legitimately uses the runner to deploy itself, denying public
repositories on the runner group is not a free fix — it breaks `swee` too. Both
apps must migrate before the group can be locked.

## Goals

1. Remove `lyly-admin`'s dependency on the self-hosted runner, so the repo can be
   made public without exposing `lychee`.
2. Preserve the property that broken code never reaches the host. Today that is
   `needs: test`; it must survive the migration.
3. Declare the host setup that CLAUDE.md currently records only as prose, so it
   is enforced rather than documented.
4. Lay an Ansible foundation that later slices extend rather than replace.

## Non-goals

- Making the repo public. That is GitHub configuration, done after this lands.
- Migrating `swee`. Its own slice.
- Declaring the rest of `lychee`. Slice 2.
- Any change to how `lyly-admin` persists site config. The "app commits to a
  config repo instead of writing `/etc`" idea was raised and deliberately
  deferred — it is an app redesign, and `PRODUCT.md` should get a say.

## Architecture

Two repos and one reconcile loop.

```
  lyly-admin (public)                 lychee-ops (private)
  ───────────────────                 ────────────────────
  src/, public/                       playbook.yml
  package.json, tsconfig              inventory
  .github/workflows/ci.yml            roles/lyly_admin_host/
                                      roles/lyly_admin_app/
                                      files/deploy/  (moved from lyly-admin)
          │ anonymous HTTPS                   │ read-only deploy key
          ▼                                   ▼
  ┌──────────────────── lychee ─────────────────────┐
  │  lyly-reconcile.timer → lyly-reconcile.service  │
  │        → ansible-pull (root)                    │
  │             ├─ role lyly_admin_host             │
  │             └─ role lyly_admin_app              │
  └─────────────────────────────────────────────────┘
```

### Why two repos

`ansible-pull` executes the ops repo's playbook as root. Keeping that repo
private means the public repo structurally cannot root the host — a property
that holds without relying on signing discipline. This matters because there is
no commit signing set up today: `user.signingkey` is unset, `commit.gpgsign` is
unset, and gpg is not installed, so `ansible-pull --verify-commit` would be a
from-scratch workflow change. With the split it is an optional hardening rather
than load-bearing.

### Why `deploy/` moves

The six host files the playbook installs are all root-equivalent artifacts: a
unit file with `User=root`, or a sudoers line granting `ALL`, is as complete a
compromise as a malicious playbook. If they were installed from the public repo,
push access to the public repo would still mean root on `lychee`, and the
split-repo property would be false.

Keeping two copies — public `deploy/` as reference, private ops repo as
authoritative — is rejected for the reason CLAUDE.md already documents about the
`.impeccable` sidecar: a second independent copy of the same content drifts
silently, with no test, detector or build failing.

So `deploy/` moves wholesale into the ops repo. This is mechanically cheap:
nothing reads `deploy/` at build or runtime, and `src/` invokes the wrapper
scripts by their installed path (`/usr/local/sbin/...`), never the repo path.
Every in-repo reference is a comment.

Side benefit: it removes the sudo-layout disclosure that publishing the repo
would otherwise cause.

### Privilege inside a run

The playbook runs as root, but does not build as root. `npm ci` and
`npm run build` execute under `become_user: lyly-admin` in the build directory.
Only installation steps use root: unit files, `/etc/sudoers.d`,
`/usr/local/sbin`, and the sync into `/opt/lyly-admin`. Untrusted npm dependency
code therefore never runs with privilege — the same reasoning that keeps the
Express process off root today.

## Role: `lyly_admin_host`

Declares six files. The seventh, `sudoers-github-runner.example`, is deleted
rather than declared: `github-runner` no longer deploys anything.

| Target | Source | Owner/mode | Handler |
|---|---|---|---|
| `/etc/systemd/system/lyly-admin.service` | `files/deploy/lyly-admin.service` | root:root 0644 | `daemon-reload`, restart `lyly-admin` |
| `/etc/systemd/system/cloudflared-sites.service` | `files/deploy/cloudflared-sites.service` | root:root 0644 | `daemon-reload`, restart `cloudflared-sites` |
| `/etc/sudoers.d/lyly-admin` | `files/deploy/sudoers.example` | root:root 0440 | none |
| `/usr/local/sbin/lyly-admin-write-config` | `files/deploy/lyly-admin-write-config.sh` | root:root 0700 | none |
| `/usr/local/sbin/lyly-admin-create-site-dir` | `files/deploy/lyly-admin-create-site-dir.sh` | root:root 0700 | none |
| `/usr/local/sbin/lyly-admin-docker-status` | `files/deploy/lyly-admin-docker-status.sh` | root:root 0700 | none |

The sudoers task uses `validate: 'visudo -cf %s'`, so a syntactically broken file
is refused rather than installed. Note this does not protect against a
syntactically valid file with wrong content.

Restarting `cloudflared-sites` on unit change causes a brief interruption to site
traffic. That is accepted and deliberate; it only fires when the unit file
actually changes.

**This role never touches `cloudflared.service` or `/etc/cloudflared/config.yml`.**
Those belong to the `lychee-ssh` tunnel carrying `ssh.lyly.dev`. CLAUDE.md states
`lyly-admin` must never touch them, and restarting that tunnel could remove
remote access to the host. They are out of scope for slice 1; slice 2 may declare
them, carefully.

## Role: `lyly_admin_app`

Each tick, in order:

1. Fetch the app repo into `/var/lib/lychee-ops/src/lyly-admin`, resolving
   `origin/main` to a commit SHA.
2. **Gate**: query that commit's check runs via the GitHub API and require the
   `test` check to have concluded `success`. If not, stop — leave the running
   service untouched — and record the reason in the status file. This preserves
   what `needs: test` does today: a red `main` leaves `lychee` on the last good
   build.
3. If the resolved SHA equals the currently installed SHA, stop. The role is a
   no-op on most ticks.
4. Build under `become_user: lyly-admin` in `/var/lib/lychee-ops/build`:
   `npm ci`, `npm run build`.
5. Sync into `/opt/lyly-admin`, excluding `.git`, `.env`, `node_modules`,
   `src/dev`, `*.test.ts` — the same exclusion set the current workflow uses.
6. `npm ci --omit=dev` in `/opt/lyly-admin`.
7. Restart `lyly-admin`.
8. Health check: expect HTTP `401` from `http://${HOST}:${PORT}/`, reading `HOST`
   and `PORT` from `/opt/lyly-admin/.env`. A `401` proves Express bound its port
   and basic-auth middleware ran; `systemctl is-active` alone does not. Same
   check the current workflow performs.
9. Write the status file.

### The gate's credential

While the repo is still private, the check-runs query needs a read-only token,
stored in the ops repo's Ansible Vault or as a file on the host. Once the repo is
public the call can be anonymous. Keeping the token afterwards is optional and
buys rate-limit headroom (5000/hr authenticated versus 60/hr per IP anonymous);
at a 5-minute interval, 12 calls/hr, anonymous is sufficient.

### Failure behaviour

Any step failing stops the run without half-installing. The service keeps running
whatever it was running. `OnFailure=` on the reconcile service fires a
notification; the status file records the failing commit and step.

## Observability

There is no run history or live view for `ansible-pull` — this is a genuine
regression from the Actions UI, accepted deliberately. What exists:

- `journalctl -u lyly-reconcile.service` — full output per run, live or historical
- `systemctl list-timers lyly-reconcile.timer` — last run, next run
- `ansible --diff` output showing exactly which files changed each tick

Two additions, both in scope for slice 1:

- **`OnFailure=` notification.** A Discord webhook, matching the channel the
  `swee` bot already uses. This closes the dangerous failure mode: a silent
  reconciler failure means `lychee` quietly serves stale code, the same
  invisible-failure class `deploy-needed.sh`'s header is written to avoid.
- **Status file** at `/var/lib/lyly-admin/deploy-status.json`, recording last run
  timestamp, target commit, installed commit, result, and failing step if any.

A later, deliberately out-of-scope idea: `lyly-admin` already renders status pills
and could surface its own deploy state by reading that file. That is an app
feature and needs `PRODUCT.md` input.

## Changes to the `lyly-admin` repo

**Deleted:**

- `deploy/` — all seven files, moved to the ops repo
- `.github/scripts/deploy-needed.sh` and `deploy-needed.test.sh` — they exist only
  to path-gate the deploy job. The `.github/scripts/` directory becomes empty and
  is removed.
- the `deploy` job in `.github/workflows/deploy.yml`

**`.github/workflows/deploy.yml` → `.github/workflows/ci.yml`**, `name: CI`.
The file and workflow names would otherwise both be lying. With the deploy job
gone, several things collapse with it:

- `outputs.deploy_needed` and the two steps computing it
- `fetch-depth: 0`, needed only to diff against `github.event.before`; reverts to
  the default shallow clone
- the `test` job's concurrency rule. It currently refuses to cancel in-progress
  runs on `main` because a cancelled test would take its dependent deploy with
  it. With no deploy job, that constraint is gone and it can cancel
  unconditionally.

What remains: checkout → setup-node → `npm ci` → typecheck → lint → test →
build, on `ubuntu-latest`. The public repo then runs only untrusted-safe work on
GitHub-hosted runners.

**Documentation:**

- CLAUDE.md's Deployment section is rewritten for the new mechanism, including
  the fact that branch protection becomes available once the repo is public.
- The six comments in `src/` referencing `deploy/...` are repointed at
  the ops repo. Affected: `src/config.ts`, `src/lib/systemCommands.ts`.

## Cutover

Ordered to avoid a window where neither mechanism works.

1. Build the ops repo. Run `ansible-pull --check --diff` until it is a clean
   no-op against the host as it currently exists.
2. Run it for real once, manually, with a second root shell open.
   `/etc/sudoers.d` is the step that can lock the app out of its own commands.
3. Verify: push a trivial commit to `main`, confirm it lands within one tick and
   the health check passes.
4. Only then, delete the `deploy` job and `deploy/` from this repo.
5. `swee` migrates — its own slice.
6. Only once both apps are off the runner, deny public repositories on the
   `default` runner group.

Rollback at any point before step 4: `systemctl disable --now lyly-reconcile.timer`.
The Actions deploy job is still present and still works.

Independent of this work and recommended immediately: set the org's fork-PR
approval policy to "require approval for all outside collaborators". One setting,
breaks nothing, and narrows the live `swee` exposure while the real fix is built.

## Verification

`ansible-pull --check --diff` is the primary tool. A clean run proves the
playbook describes the host as it already is — which is also how places where
CLAUDE.md's prose was already wrong get discovered.

Molecule and a throwaway VM were considered and rejected for slice 1: for six
files and one service they cost more than they return. Slice 2, which declares
users, packages and firewall rules, may justify revisiting that.

The app role verifies itself through the `401` health check and the status file.

## Decisions

Recorded so implementation does not reopen them.

| Decision | Value |
|---|---|
| Ops repo | `LycheeHome/lychee-ops`, private |
| Timer interval | 5 minutes |
| Build directory | `/var/lib/lychee-ops/build` |
| App checkout | `/var/lib/lychee-ops/src/lyly-admin` |
| Status file | `/var/lib/lyly-admin/deploy-status.json` |
| Reconcile units | `lyly-reconcile.timer`, `lyly-reconcile.service` |
| Commit signing | Not required; the private ops repo carries the property instead |
| Notification channel | Discord webhook |

## Follow-on slices

- **Slice 2** — the rest of `lychee` as Ansible roles: users and groups
  (`lyly-admin`, `web`, `webdeploy` membership), base packages, the `lychee-ssh`
  tunnel's config and unit, firewall, unattended-upgrades, the Palworld and
  `swee` units. Declaring the SSH tunnel's files turns "lyly-admin must never
  touch this" from an invariant enforced by app correctness into one enforced
  from outside the app.
- **`swee` migration** — its deploy moves off the runner, reusing this
  foundation. `swee` is already containerized, so its role is simpler than this
  one.
- **Going public** — GitHub configuration only: runner group lockdown, fork-PR
  approval policy, branch protection once available.
