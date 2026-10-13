# Platform roadmap: lychee-admin as the control plane

Date: 2026-10-12. Status: approved roadmap. Each sub-project below gets its own
spec, plan, review and PRs; nothing is built from this document directly.

## Why

The three repos work, but lychee-ops knows too much about individual apps:

- Releasing swee is a lychee-ops commit: its version is pinned in lychee-ops'
  `group_vars` (`swee_version`), and an 863-line `swee_app` role builds it on
  the host.
- lychee-admin is also built on the host, by its own 762-line role
  (`lychee_admin_app`), so `npm ci` runs dependency lifecycle scripts on
  `lychee`.
- swee holds root grants (stop, start and restart the Palworld unit, plus the
  update wrapper) and `adm` membership, so it cannot be an ordinary container.
- The interfaces the repos share — the declaration schema, the inventory and
  status file shapes, the CI job name `test`, the `.env` keys, site naming —
  are recorded in comments in whichever repo noticed them. Breaking one fails
  quietly. lychee-resources has no CI at all, so a bad hand edit is found by
  the reconciler, where one rejected declaration stops every resource from
  being applied that run.

palsave-api already has the target shape: an image built in CI, one file in
lychee-resources, and no app code in lychee-ops.

**Scope assumption:** one operator, deploying mostly what exists today (swee,
palsave-api, the sites). This roadmap is a cleanup of responsibilities, not a
feature build-out; the Vercel-style features are listed under Deferred.

## End state

Three layers, each depending only on the one below it, through a written
contract:

| Layer | Repo | Role | Vercel analogy |
|---|---|---|---|
| Control plane | lychee-admin | where anything is operated: by the operator in the browser, by other apps through a scoped API | the dashboard and API |
| Desired state | lychee-resources | what should run, at which version, for every app | project settings |
| Runtime and host | lychee-ops | makes it so; owns the host itself | the infrastructure |

- **lychee-ops** knows each host service's unit and which actions it may be
  asked to perform. It knows nothing about any app's code, build or version.
  What remains in it: host configuration, the watcher and the resources
  engine, Caddy and the tunnel, Palworld and `steam`, and lychee-admin's own
  install — the platform's own install, the one app-specific role left.
- **lychee-resources** declares every app.
- **lychee-admin** operates everything.

Success, as one sentence: **releasing a new version of any existing service
needs no lychee-ops commit, nothing is built on lychee, and the three repos
check one written contract.**

## Sub-projects

### 1. A written contract between the three repos

- **Goal:** every shared interface is written in one place, and each repo has
  a test that checks its half. The interfaces: the declaration schema, the
  inventory and status file shapes, the CI job name, the `.env` keys the
  reconciler reads, and naming (`<label>-lychee-land`, the
  `ghcr.io/lycheehome/` image prefix).
- lychee-resources gets CI that runs the validator on every pull request. The
  host keeps its own trusted, root-owned copy; the repo's copy is a check, not
  the authority.
- **Decided in its spec:** where the contract document lives, and how
  lychee-resources' CI reaches a validator that today lives in the private
  lychee-ops.
- **Done when:** changing a shared shape in one repo fails a test in that
  repo, and a bad hand edit to lychee-resources fails before it merges.

### 2. Host operations in lychee-admin

- **Goal:** lychee-ops declares, per unit, which actions are allowed — `start`,
  `stop`, `restart`, and named wrappers such as Palworld's `update`. The
  sudoers lines are generated from that same declaration, so what the board
  offers and what sudo grants cannot drift apart.
- lychee-admin shows the allowed actions on the services board and runs them
  as background jobs that can be checked on, logging each one like every other
  mutating action.
- A local-only API with scoped tokens: a token grants a listed set of
  (unit, action) pairs and nothing else, so another app can call an action
  without the operator's login.
- General, not Palworld-specific: the next game server or bot opts in through
  lychee-ops' declaration and needs no lychee-admin code.
- **Done when:** Palworld can be restarted and updated from the board, and
  through the API with a token that can do nothing else.

### 3. swee becomes a container

- **Goal:** swee calls lychee-admin's API instead of sudo.
- Its other host reads move too. What swee reads today, and where it goes:

  | Today | After |
  |---|---|
  | `sudo systemctl stop/start/restart` the Palworld unit; `sudo swee-update-palworld` | lychee-admin's API |
  | `journalctl -u <palworld unit> -f` through `adm` | a stream from lychee-admin, or the journal mounted read-only (decided in its spec) |
  | `/var/log/unattended-upgrades/unattended-upgrades.log` | a read-only mount |
  | the game server and palsave-api on the host's own address | host networking |

- Declared in lychee-resources like palsave-api, released with a tag and
  Deploy on the board.
- `swee_host` and `swee_app` are retired from lychee-ops — the old unit
  declared absent, as `palsave_api_host` does for palsave-api's — and
  `swee_version` leaves `group_vars`.
- **Done when:** swee's account has no sudo grant and no `adm` membership, and
  releasing swee is a tag plus Deploy.

### 4. lychee-admin built in CI

- **Goal:** CI produces lychee-admin's release artifact; the host fetches it,
  verifies it, installs it and restarts the service. It stays a host service
  installed by lychee-ops.
- **Decided in its spec:** the artifact's form, and how it is built for the
  host's architecture with any native modules.
- **Done when:** no `npm ci` or build runs on lychee, so no dependency
  lifecycle script runs on the host.

## Order and dependencies

**1 → 2 → 3 → 4.**

```
1 contract ──► 2 host operations ──► 3 swee as a container
     └─────────────────────────────► 4 lychee-admin built in CI
```

- **2 depends on 1:** a unit's allowed actions are a new inventory field, a
  contract change.
- **3 depends on 1 and 2:** it needs 2's API, and its container needs
  declaration fields that do not exist yet — host networking, mounts for the
  journal and the unattended-upgrades log — which are contract changes.
- **4 depends only on 1.** It is last because it changes nothing the operator
  sees, while 2 and 3 deliver the swee change. It can move to second if
  keeping lifecycle scripts off the host becomes the priority.

## Rules for every sub-project

- **The pull model stays.** Nothing in GitHub holds a credential that can
  reach lychee. 2's API binds only where lychee-admin already binds, and is
  never reachable through the Cloudflare Tunnel.
- **Root grants stay enumerated.** From 2 on, sudoers lines are generated from
  the same declaration as the allowed actions.
- **Add, verify on the host, then remove** — the shape the 2026-10-11 rename
  used. 3 is the exception: two copies of swee cannot share a Discord token,
  so its cutover is by hand, with `lychee-watch.timer` and
  `lychee-reconcile.timer` stopped first.
- **Each sub-project has its own spec, plan, review and PRs**, in the repo it
  changes most. 2 also gets a security review before merge: it adds the first
  credential besides the operator's.

## Risks

- **2 carries most of the risk:** it adds a credential and new root-backed
  actions to lychee-admin. Its spec starts from the security model — what a
  leaked token can do, and what it cannot.
- **3's cutover** takes swee offline briefly, on purpose.
- **4 depends on an artifact that runs on lychee:** architecture and native
  modules are checked in its spec, before anything else.

## Deferred

Off this roadmap until there is something new to deploy that needs them:

- **Environment variables and secrets for apps.** Nothing current needs them:
  swee and palsave-api take their configuration from the host.
- **Attaching any container from lychee-admin**, not just Next.js sites.
  palsave-api and swee are declared by hand, which is fine at this scale.
- **Build visibility, deploy history and rollback, preview deploys.**
- **A logs view.** If 3 builds a log stream in lychee-admin, it is the
  natural starting point.
- **Stateful resources:** databases, queues, persistent storage.

## Rejected alternatives

- **A self-hosted platform** (Coolify, Dokploy, Dokku). It would replace the
  resources engine and most of the watcher, but it runs as root with the
  Docker socket and brings its own UI, which overlaps lychee-admin.
- **Push deploys from CI** (Kamal, Actions over SSH or Tailscale). It removes
  the watcher but puts a credential that can reach lychee in GitHub — the
  exposure retired with the self-hosted runner on 2026-09-28.
- **swee as a container reaching sudo through a mounted wrapper.** Uniform,
  but a container that can stop the game server has root reach that is harder
  to audit than a sudoers line.
- **A "host service" declaration type for swee** (its version in
  lychee-resources, its unit and grant in lychee-ops). Superseded by moving
  Palworld control into lychee-admin, which removes swee's privileges instead
  of relocating its version pin.
