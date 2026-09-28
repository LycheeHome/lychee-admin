# Versioning and release selection — design

Date: 2026-09-28
Status: design approved; spec pending review
Amends `2026-09-25-managed-services-design.md` — see "Relationship to the
managed-services spec"

## Problem

The reconciler on `lychee` has three different answers to "what should be
running?", and none of them is written down anywhere the host can see.

- `lyly_admin_app` deploys **the tip of `main`**. The repo has zero tags and no
  release tooling. `installed_commit` in the status file is a raw SHA.
- `swee_app` (in flight, not yet cut over) deploys **whatever `releases/latest`
  returns at tick time**.
- The managed-services spec's declaration schema pins **an explicit image tag**
  in a committed file.

Two of those are *discovery*: the host's state depends on a pointer that moves
outside the host's control. One is *declaration*. They are opposite models, and
the project is currently building both.

Three consequences.

**There is no rollback lever.** If a deploy breaks the box, the only recovery is
to revert in the app repo, wait for CI, and wait for a tick — or, for a commit
that failed its health check three times, `sudo rm /opt/lyly-admin/.failed-sha`
over SSH. Nothing lets you say "go back to the version that worked."

**Every merge deploys.** CLAUDE.md already records this as a known cost of
retiring the path gate: a docs-only merge to `main` rebuilds and restarts the
service within five minutes. The path gate was retired because its predicate was
fragile, not because the property it bought was unwanted.

**Nothing in git says what should be running.** `git log` on `lychee-ops`
describes the reconciler's rules, not the host's state. Answering "what version
is `lychee` supposed to be on?" requires asking GitHub.

There is a fourth consequence, smaller and worth recording because it is what
surfaced the rest: with `swee_app` added, the two roles make 6 API calls per
tick unconditionally — 72 an hour against an anonymous limit of 60 per source
IP — so the deploy loop acquires a hard dependency on a PAT that must be
rotated. Discovery is what makes those calls unconditional: *finding out whether
the target moved is itself the API call*.

## Goals

Chosen deliberately, and one was deliberately not chosen.

1. **A rollback lever.** Say "go back to v2.11.1" and have it applied within five
   minutes, without touching the app repo.
2. **Decouple merge from deploy.** Deploys happen when something is deliberately
   released, not when anything merges.
3. **One model across the board.** Host agents and container services select
   targets the same way, with a readable history in one place.

Explicitly **not** a goal: minimising moving parts. This design buys capability
and accepts the machinery that comes with it. Where a trade-off is available
between fewer dependencies and more control, it takes control.

## Decisions

### 1. A pin is a release tag in `lychee-ops`

`group_vars/all.yml` names the exact release of each app that should be running:

```yaml
swee_version:       v2.11.2
lyly_admin_version: v0.2.0
```

One shape, no special values — not a SHA, not `latest`, not `main`. Promotion is
a commit to `lychee-ops`; the reconciler applies it within five minutes. Rollback
is `git revert` on that commit, or an edit to an older tag. Same mechanism, no
distinct code path.

`latest` was rejected specifically because it is itself a moving pointer — the
property that made discovery unsatisfying. Under it, nothing in git can answer
"what should `lychee` be running?" without asking GitHub.

An auto-PR bot that bumps pins on release was considered and deferred. It is the
fullest expression of all three goals, but `lychee-ops` is private and applied as
root, so the bot needs a credential with write access to the repository the
reconciler trusts absolutely. That is a meaningful attack surface bought for
convenience, and the friction data should come before the machinery.

### 2. `lyly-admin` is not exempt

It adopts release-please and is pinned like everything else. Its commits are
already conventional (`docs:`, `ci:`, `feat:`), so this costs a workflow job and
a config file, not a change in how commits are written.

`main` as a legal pin value was considered as an escape hatch for active
development and rejected: while engaged it gives up goal 2 entirely, and an
escape hatch that is never closed becomes the default. With release-please,
cutting a release is one click on a PR it wrote — the friction is two clicks and
a commit, not a hand-written changelog.

### 3. Host agents keep the CI gate; container services will use image existence

Bumping a pin is a claim, not proof. A human promoting a version from memory is
exactly the case the gate catches, and CLAUDE.md records that branch
protection's guarantee "moved rather than vanished" — it moved into this gate.

Under pinning the gate only fires when the pin has moved, so the steady state is
zero API calls and the PAT drops from required to convenient.

For container services (managed-services slice 2), an image existing at
`ghcr.io/lycheehome/<app>:<version>` already proves CI passed, provided the push
job is `needs: test`. An artifact instead of a query: it cannot 403, it needs no
permission beyond the `read:packages` credential that spec already commits to,
and it cannot be fooled by a renamed job. **Recorded here as input to that slice,
not built by this one.**

### 4. The rollback horizon is accepted

Pinning plus a CI gate means **you can only roll back to versions released after
the gated job existed**. Verified live: `v2.11.2` (2026-07-24) has exactly one
completed run, containing `release-please` and `deploy` — the `test` job did not
exist until PR #68 in September. Pinning it blocks.

Per-app gate overrides and backfilling CI on old tags were both considered.
Accepted instead: old releases age out of rollback range, because in practice a
rollback goes back one or two versions, which are always recent enough. The cost
is paid in legibility, addressed by the gate-string split below.

## The model

Each role carries three facts per tick:

| fact | source |
|---|---|
| target version | `<app>_version` in group_vars — free, local |
| installed version | `.deployed-version` on disk, beside `.deployed-sha` |
| target SHA | resolved **only** when the pin has moved |

The skip decision compares **versions, not SHAs** — two local strings. That is
what makes the steady state genuinely free:

| | `swee_app` | `lyly_admin_app` |
|---|---|---|
| pin unchanged | 0 calls | 0 calls |
| pin moved | 3 (tag→SHA, then 2 gate calls) | 2 (gate only) |

`lyly_admin_app` needs no tag→SHA call because it fetches into a *build*
directory and reads `.after` — the fetch yields the SHA. `swee_app` keeps that
call because it fetches straight into `/home/steam/swee`, the live tree, so it
must gate *before* fetching. That asymmetry is deliberate; making swee fetch to a
staging directory is a separate concern from versioning.

**What comparing versions gives up:** a tag moved to a different commit after
deploy would go unnoticed, where a SHA comparison would catch it. In a
single-maintainer org with release-please cutting the tags, that is not worth a
call every five minutes. It is the reason `.deployed-sha` stays on disk beside
the version rather than being replaced by it, so the answer is recoverable by
hand.

## Role changes

### `swee_app`

1. Delete `Query the latest release` and the `swee_app_release` fact. The tag
   comes from `swee_version`.
2. Add a read of `{{ swee_dir }}/.deployed-version`, mirroring the existing
   `.deployed-sha` slurp with the same `failed_when: false` and `| default('')`
   guards. Absent means `none` — the first-deploy case.
3. Guard the tag→SHA resolution, **its lightweight-tag assertion**, and both
   gate calls on `swee_app_pin_moved`. The assertion reads
   `swee_app_tag_ref.json`, so leaving it unguarded raises on every skipped
   tick.
4. Write `.deployed-version` beside `.deployed-sha` on a successful deploy.

The lightweight-tag assertion stays, and is worth more under pinning: a
hand-pushed annotated tag is now something deliberately typed into `group_vars`,
and failing loudly beats gating a tag object's SHA as if it were a commit.

### `lyly_admin_app`

- `app_branch: main` becomes `lyly_admin_version`, and the `ansible.builtin.git`
  task's `version:` takes the pin. The deploy key and `accept_newhostkey` are
  untouched.
- The same `.deployed-version` read and write, at
  `{{ app_install_dir }}/.deployed-version`.
- **The fetch itself is guarded.** Today it runs every tick; under pinning an
  unchanged pin means not even cloning. Behavior change worth naming: the build
  directory stops being re-synced every five minutes, so drift there is no longer
  self-healing. `.deployed-version` on disk becomes the record of truth.

### release-please for `lyly-admin`

- `release-please-config.json` with `release-type: node`. It bumps
  `package.json` (currently `0.1.0`); `private: true` means version, changelog and
  tag are managed without attempting to publish.
- `.release-please-manifest.json` seeded at `0.1.0`.
- A `release-please` job in `ci.yml` carrying swee's
  `if: github.event_name == 'push'` guard verbatim, including its comment. The
  reasoning transfers exactly: the job needs `contents: write` and
  `pull-requests: write`, which a fork PR's token cannot grant whatever the block
  says, so without the guard every external contributor sees a failing check
  unrelated to their change.
- **The `test` job keeps its exact name.** CLAUDE.md flags this as load-bearing:
  the gate matches a job named `test`, and a `name:` override replaces what the
  API reports. Adding a sibling job does not threaten it, but it is the moment
  someone is most likely to tidy the workflow and break deploys silently.

### The constraint this design inherits

`*_pin_moved` must be computed **once, up front**, from values nothing later
mutates, and `.deployed-version` must be written only at the very end of the
install block.

This is the exact defect that already hit `lyly_admin_app`: `Mark the deploy
successful` set `installed_sha = target_sha`, flipping the enclosing block's
`when:` to false, so `Clear the failure memory` silently never ran again. A
block's `when:` is re-evaluated **per task**, so a fact the condition depends on
must not be reassigned inside the block.

Second-order: when the pin has not moved, `*_target_sha` is never set. Every
downstream reference needs a default or its own guard, or the play dies on an
undefined variable in a role with no rescue.

## Failure behavior and observability

### Status file

`target_version` and `installed_version` join `target_commit` and
`installed_commit`. The SHAs stay — they are what the gate verified — but the
version answers "what is running?"

`installed_version` follows `installed_commit`'s existing reporting rule in
`deploy-status.json.j2` — it reports the target only when this run's result is
`deployed`, and the previously installed value otherwise.

Existing semantics carry over unchanged: `installed_commit` is *the last commit
that passed a health check*, not what is on disk, so after a failed deploy the
new code is installed and running while the field names the old one. Pinning
does not fix that, but it makes it legible by accident — `target_version: v1.3.0`
beside `installed_version: v1.2.0` reads as a discrepancy where two SHAs read as
noise.

### One split in the gate string

Every non-green outcome currently collapses into `job test concluded: missing`.
Both lists are already in hand, so separating them is nearly free:

- `no completed CI runs for <tag>` → CI has not finished, or never started
- `no job named test in N completed run(s) for <tag>` → the job was renamed,
  *or the pinned release predates the job's existence*

A green run keeps the existing `deployed` path; a `test` job that concluded
anything other than `success` keeps reporting its conclusion verbatim.

The second string is what makes the accepted rollback horizon recognisable rather
than mystifying: the difference between "why is this stuck" and "that release is
from July".

### The skip path must never touch the gate

`swee_app`'s `Record a no-op run` currently reads:

```yaml
{{ 'blocked' if not swee_app_deploy_gate_passed else 'skipped' }}
```

Under pinning the most common tick is "pin unchanged", where the gate never runs
and `swee_app_deploy_gate_passed` is **undefined** — so that expression raises,
in a top-level task with no rescue. The result needs three states: `skipped`
(pin unchanged, gate never evaluated), `blocked` (pin moved, gate said no), and
the existing `deployed` / `failed`.

The comment above it goes stale in the same edit. It reads *"the only reason
nothing installs is the CI gate itself"* — true today, false the moment a pin can
be unchanged. It is fixed in the same commit or not at all.

### `swee_app` gains the retry cap

`roles/swee_app/tasks/main.yml:322` records that it has none. `lyly_admin_app`
abandons a commit after three failed health checks via `.failed-sha`; `swee_app`
has nothing, so a pinned version whose install fails would rebuild and restart the
bot every five minutes indefinitely, with a Discord alert each time. Pinning is
what makes that loop reachable by a one-line commit, so the mechanism is ported
across as part of this work.

### What gets better

**Recovery stops needing host access.** Reverting the pin commit yields a
*different* version, so the retry cap does not apply — a fresh start from a
laptop, applied within five minutes. The cap stays as a backstop but stops being
the only lever.

**Deploy history exists.** `git log group_vars/all.yml` says what was promoted,
when, and why. CLAUDE.md currently records that nothing renders a list of deploys
anywhere; this is that, without a UI.

**The token drops to optional.** Steady state is zero API calls, so a missing or
expired PAT slows a promotion burst instead of breaking the loop.

## Relationship to the managed-services spec

This **amends** `2026-09-25-managed-services-design.md` rather than renumbering
it. That spec's slice 1 grows a pin; its slices 2–5 are untouched, except that
decision 3 above is recorded as input to its slice 2.

Two corrections to that document, found while writing this one:

- Its declaration example (line ~179) illustrates the schema with
  `image: ghcr.io/lycheehome/swee:2.11.2`, while its decomposition correctly
  classifies `swee` as a **host agent**. Verified this session: `swee` tails
  `journalctl -u palworld`, calls `sudo systemctl stop|start|restart palworld`,
  runs `steamcmd`, and reads `/proc/stat`. It cannot become a container without a
  journal socket mount, host PID namespace and a sudo path back out — which
  defeats every property the container model buys. The example should use
  `palsave-api`.
- `swee` runs as `User=steam` from `/home/steam/swee` — the Palworld server's own
  user. Its Discord token, bot permissions and `sudo systemctl restart palworld`
  grant all belong to `steam`, so compromising a network-exposed game server
  running mods inherits all of it, and the converse. It should move to `/opt/swee`
  under a dedicated `swee` system user. **Sequenced after slice 1**, because
  moving a service and changing how it is deployed in one step gives two suspects
  when it breaks. The move must carry `player_history`, session, last-release and
  palfeed state files, journal read access, and the sudoers grant. It does not
  interact with this design: `swee_dir` and `swee_user` are already `group_vars`
  variables.

## Slicing

**The implementation plan that follows this spec covers slice 1a only.** 1b and
2 get their own plans, for the reason 1a's own rule states: one cutover, one
suspect.

### Slice 1a — fold into the in-flight cutover

`swee_app` only: the pin variable, deleting `Query the latest release`,
`.deployed-version`, the `pin_moved` guards, the three-state no-op result and its
comment, the gate-string split, and the `.failed-sha` retry cap.

**Rule for this slice: do not touch `lyly_admin_app`.** It is live, healthy, and
unrelated to getting `swee` off the runner. Changing both roles during one
cutover gives two suspects when something breaks. Its copy of the gate-string
split waits for slice 2.

### Slice 1b — relocate `swee`

`/opt/swee` under a dedicated user, per the correction above.

### Slice 2 — `lyly-admin` versioning

A hard ordering constraint with a gap in the middle:

1. Add `release-please-config.json`, the manifest, and the `release-please` job.
   Merge to `main`.
2. **Wait for release-please to cut a release.** Merging its PR produces the tag.
3. *Only then* change `lyly_admin_app` to pin that tag and retire `app_branch`.

Doing 3 before 2 points `ansible.builtin.git` at a `version:` that does not
exist, and the fetch fails every tick.

## Verification

There is no test suite for the reconciler — it is live infrastructure — so
verification is observational, in this order:

1. `--check --diff --skip-tags app` dry run.
2. Apply with the timer stopped.
3. **The first tick blocks, and that is the pass condition.** Pinned at
   `v2.11.2`, expect the new string — *runs exist, no job named `test`* — not the
   old `missing`. That tick proves the pin is read, the gate still runs, and the
   horizon is legible.
4. Cut a real swee release, bump the pin, apply. Expect `deployed`, and the bot
   back on Discord.
5. **Unset the token and run a no-change tick.** It must succeed. This is a direct
   proof of the zero-API-calls claim rather than an inference from reading the
   guards, and it is the test least worth skipping: a subtly wrong guard looks
   identical to a correct one until the rate limit runs out.
6. Restart the timer; confirm an unattended tick reports `skipped`.

**The retry cap is the least-verified piece, and this says so rather than
pretending otherwise.** Testing it honestly means making a swee deploy fail its
Discord health check three times, which means deliberately breaking the bot.
Verification is code review against `lyly_admin_app`'s proven version, plus the
counter file appearing on any real failure.

## Documentation that moves with it

- `lyly-admin`'s CLAUDE.md — the Deployment section describes the gate, the
  status file fields, and `.failed-sha` recovery. All three change.
- `lychee-ops`' README — bootstrap and recovery notes.
- The secrets template in `lychee-ops/bootstrap.sh`, which currently describes the
  PAT as required.

## What this does not do

- **No auto-promotion.** A release sits unpinned until someone promotes it.
  Deliberate (decision 1); revisit with friction data, not before.
- **No UI.** `lyly-admin` gains no view of pins or deploy history. Observation is
  managed-services slice 3.
- **No change to container services.** Decision 3 records the image-existence gate
  for that spec's slice 2; nothing here implements it.
- **No versioning for `palsave-api`.** It arrives with managed-services slice 2,
  as a container, under that spec's schema.
