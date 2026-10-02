# Service observability — design

Date: 2026-10-02
Status: approved in conversation; written spec pending review
Implements step 3 of `2026-09-25-managed-services-design.md`, and corrects an
assumption in it

## Problem

`lyly-admin` does not know what runs on the host it administers. It knows about
sites, because it created them. It has no idea `swee`, `palsave-api`, or the
Palworld server exist, and it cannot say whether Caddy or the sites tunnel are
up — even though its own site detail page draws both as hops in the request
chain.

That makes it a partial answer to the question its detail page is built around:
which hop broke.

Three things changed recently that make this worth building now rather than
alongside the larger managed-services work:

- All three reconciler-deployed services (`lyly-admin`, `swee`, `palsave-api`)
  now write a `deploy-status.json` on every tick, in nearly the same shape.
  Before the identity slices they were deployed three different ways and had no
  common surface at all.
- Each has its own systemd unit declared by `lychee-ops`, so "what should be
  running" is now a question with a written answer.
- `palsave-api` moved off `127.0.0.1:8787`, so the one genuinely confusing
  overlap on the box is gone.

## Relationship to the managed-services design

That design decomposes into five steps. This spec is **step 3**, deliberately
separated from step 4 there on the grounds that observation needs no new
privilege and can ship long before anyone decides whether the app should mutate
anything. That separation holds and this spec does not reopen it.

**It does correct one claim.** Step 3 states that observation needs no new
privilege because the app "already reads `docker compose ps` through an existing
sudo-pinned wrapper". That is true for container services and **false for host
agents**: there was no read path to `lychee-ops`' status output at all. Verified
on the host 2026-10-02 — `/var/lib/swee` and `/var/lib/palsave-api` are `0750`
owned by their own service users, and `lyly-admin` is a member of `webdeploy`
only. It can read neither. This spec supplies that path.

The correction does not change step 3's conclusion, only its reasoning: the read
path added here is a published file, not a privilege.

## Goals

1. One page answering "what runs on `lychee`, and is it up".
2. Surface the reconciler failure modes that `CLAUDE.md` documents as invisible
   — a dead reconciler, and a deploy wedged at its retry cap.
3. Complete the request chain on the site detail page, which names Caddy and the
   tunnel but cannot report on them.
4. Gain no new privilege.

## Non-goals

- **Managing anything.** No start, stop, restart, redeploy, pin change, or
  retry-cap clear. Every one of those needs privilege this app does not have,
  and deciding which are worth that cost is a later slice informed by using
  this one.
- **Game-server lifecycle.** `palworld` appears as one liveness row, identical
  in shape to every other row. `steamcmd`, save handling, player counts and
  server settings belong to `swee` and stay there. A liveness row is not a
  foothold for that domain, because the boundary is the sudo grant and this
  slice adds none.
- **Replacing Discord alerting.** The reconciler's `OnFailure=` webhook remains
  how a failure reaches you. This page is where you look once you know, or
  while browsing. It is not a monitor and nothing should be built to assume it
  is being watched.
- **Showing site containers.** They already have status pills on the site list
  and the last hop of the detail page. A container exists to serve one hostname,
  so it has an obvious home; adding a second place to look adds no information.
- **Cloudflare DNS.** Hop 1 of the request chain stays annotated-but-static.
  Tier 1 scope is explicit that the app does not touch DNS, so it has no way to
  know and should not imply otherwise.

## What goes on the page, and why

Three groups, each answering a different question.

```
RECONCILER                    what deploys things, and is it alive
SERVICES                      what runs, and what version
INFRASTRUCTURE                what carries traffic
```

| group | members | basis |
|---|---|---|
| Reconciler | `lyly-reconcile.timer` / `.service` | the machinery, with failure modes unlike a service's |
| Services | `lyly-admin`, `swee`, `palsave-api`, `palworld-palchuds` | long-lived, no hostname, nowhere else to appear |
| Infrastructure | `caddy`, `cloudflared-sites` | shared by every site, so no single site to live under |

### Why the reconciler is its own group, not a fourth service row

Its failure modes do not resemble "is it running". A tick that loses the `flock`
exits 0 with no output and is indistinguishable in `systemctl` from a clean
reconcile. A commit wedged at the retry cap leaves the play succeeding and the
alerts stopped while the service is down. Neither is expressible as a status
pill, and flattening them into one would undersell both.

### Why infrastructure appears here *and* on the hop chain

This reverses an earlier position in the conversation and the reasoning is worth
keeping, because the earlier rule was nearly right.

The rule was: a thing appears where its purpose lives. That correctly keeps site
containers on site pages — a container serves one hostname, so it has one home.
But Caddy and the tunnel are shared by *every* site, so they have no single site
to live under. Omitting them would leave a board that shows four green rows
while the most impactful outage on the box is in progress.

They appear in both places, from one source, answering two different questions:
on the board, "is the box healthy"; on the hop chain, "which hop broke for this
site". There is no second source, so nothing can drift.

### Why `palworld` is included

`palsave-api` reads palworld's save backups. If it stops producing events, the
first question is whether `palsave-api` is broken or the game server is down — a
board that omits palworld cannot answer its own question.

The objection is that `swee` already reports palworld status to Discord. True in
the normal case, and backwards in the case that matters: if `swee` is down,
Discord says nothing, and that is exactly when one page showing both `swee` down
and palworld's actual state earns its place.

## Data path

Two sources, with different freshness, and the page is honest about which is
which.

### Liveness — `systemctl`, no privilege

**Verified on the host, 2026-10-02:**

```
sudo -u lyly-admin systemctl is-active swee palsave-api palworld-palchuds caddy
active
active
active
active
```

Unit state queries are world-readable. The app reads all units in **one**
invocation — `systemctl show <units...> -p ActiveState,SubState,ActiveEnterTimestamp`
— so cost is one subprocess per page render regardless of how many units are
listed. This matters: the hostname dropdown deliberately does not status-check
because it would cost N checks per page view, and this stays at one.

Note the distinction that explains the existing sudoers entry: `systemctl status`
renders recent journal lines and therefore needs journal access, which is why
`systemctl status caddy --no-pager` is one of the app's eight pinned commands.
`is-active` and `show` need nothing. **Do not reach for `status` here** — it
would turn a free read into a privilege question.

### Deploy state — a published inventory

**The reconciler writes one normalised file at the end of every tick**, after
all three app roles have run, so it reflects that tick's outcome rather than the
previous one.

Path: `/var/lib/lychee-inventory/services.json`, `root:root 0644`, in a
`root:root 0755` directory.

A dedicated location, not inside `/var/lib/lyly-admin/`: this is data *about*
all services, and housing it in one service's directory implies an ownership
that is not real. **The per-service `deploy-status.json` files do not move**, so
every recovery path `CLAUDE.md` documents continues to work.

#### Why published rather than read live

Deploy state only changes when the reconciler writes it. Its freshness is
therefore bounded by the tick **by construction** — no read mechanism can make
it fresher than the last write. A sudo-pinned wrapper reading the same files as
root would buy privilege and no freshness, which is why that option was
rejected.

#### Why one combined file rather than per-service files

Normalisation belongs in the producer. The three status files are not the same
shape: `swee` and `palsave-api` carry `target_tag`/`installed_tag` and
`failed_attempts`; `lyly-admin` has neither, because it tracks tip-of-main
rather than a pin. Per-service files would push that difference into the app and
couple service changes to app releases. With one assembled file, adding a fourth
service later is a reconciler change and no app change at all.

#### The contract

```json
{
  "generated": "2026-10-02T04:58:02Z",
  "services": [
    {
      "name": "swee",
      "unit": "swee.service",
      "reconciled": true,
      "version": "v2.11.4",
      "commit": "af22c56",
      "result": "skipped",
      "gate": "pin unchanged (v2.11.4)",
      "last_run": "2026-10-02T04:58:02Z",
      "failed_attempts": 0
    },
    {
      "name": "palworld",
      "unit": "palworld-palchuds.service",
      "reconciled": false
    }
  ]
}
```

Three properties shape it:

**`version` is a display string; `commit` is the precise one.** A tag where
there is one, a short SHA otherwise. The app does not branch on which deploy
model a service uses — the producer resolves it.

**`reconciled: false` is a state, not a missing field.** `palworld` is declared
by `lychee-ops` but not deployed by it. The page says "running, and nothing
deploys this" rather than rendering blanks.

**`generated` is load-bearing, not metadata.** If the reconciler dies the
inventory freezes, and `CLAUDE.md` already warns that a dead reconciler looks
exactly like a quiet one — the real liveness signal being a status file's
`last_run`, which nothing currently surfaces. Rendering this as an **age**
("inventory written 3 hours ago") rather than a timestamp makes that visible at
a glance.

**The inventory lists the declared set.** It is what *should* be running. Paired
with live unit state it produces the cases neither source can report alone.

## States

Status uses the **existing canonical vocabulary** shared by the header pill and
the request chain, with `starting` and `unknown` deliberately neutral rather
than red. systemd's states map onto it; they do not replace it.

| systemd `ActiveState`/`SubState` | shown as |
|---|---|
| `active` / `running` | `running` |
| `activating` | `starting` (neutral) |
| `failed` | `exited` |
| `inactive` | `exited` |
| `deactivating`, `reloading` | `restarting` |
| query failed or unit unknown | `unknown` (neutral) |

### The pairings worth seeing

- **Declared, not running** — in the inventory, unit dead. The case a pure
  liveness check cannot frame, because it has no way to know the service was
  supposed to exist.
- **Running, not declared** — drift. `palworld` is the legitimate instance
  (`reconciled: false`); anything else is a finding.
- **Retry cap engaged** — `result: failed` with `failed_attempts: 3`.
  `CLAUDE.md` documents this as the state that looks like success: the play
  succeeds, the notifications stop, the service stays down. It has no UI
  anywhere today and should appear loudest here.
- **Blocked by the gate** — `result: blocked`, with the `gate` string naming
  why. Currently visible only by reading a file over SSH.

### Degradation

Each failure degrades rather than erroring the page, following the precedent of
`readTunnelId()` degrading to dashboard instructions rather than failing a site
page.

- **Inventory missing** — `lychee-ops` has not shipped the change, or the
  reconciler has never run. The page shows liveness only and says so.
- **Inventory stale** — shown as an age in the reconciler block. This is a
  feature, not an error state.
- **`systemctl` unreadable** — affected rows show `unknown`; deploy state still
  renders.

### Freshness is two different things

Liveness is read at page load. Deploy state is as of `generated`. The page must
not imply one freshness for both; the reconciler block's "inventory written Xm
ago" covers the second, and is the only place a time needs to appear.

## Changes to the site detail page

Hops 2 and 3 of the request chain already name `cloudflared-sites` and Caddy and
carry no live state. They gain it from the same single `systemctl show` call.

Hop 1 (Cloudflare DNS) is unchanged and stays static, per the non-goal above.
Hop 4 is unchanged.

## Routing and navigation

A new page. The header currently carries `sites` and `add site`, and a header
item's destination never changes with location — so a third item fits the
existing rule without exception.

Route and label are left to implementation; `/services` is the obvious default.

## Visual design

**Deferred to `impeccable`, deliberately.** This is a new surface, which per
`CLAUDE.md` routes through plain `/impeccable` rather than a scoped command, and
`DESIGN.md` stays normative throughout. Where a layout question has more than one
reasonable answer, the project skill `comparing-design-variants` produces the
rendered comparison.

What this spec does fix, because they are not visual decisions:

- the three groups and their order
- the existing status vocabulary, including `starting`/`unknown` as neutral
- staleness rendered as an age, not a timestamp
- deploy state subordinate to liveness, per the agreed purpose

Everything else — typography, density, pill treatment, grouping headers, empty
and degraded states — is `impeccable`'s.

## Security properties

Unchanged from today, and this is the point of the slice:

- **No new sudo scope.** The app's eight pinned commands are untouched.
- **No new group membership.** `lyly-admin` stays in `webdeploy` only.
- **No write path.** The app reads a file and queries unit state. It cannot
  start, stop, or alter anything on this page.
- **No access to `lychee-ops`.** The inventory is a published artifact; the app
  never reads the repo that produces it.
- **The inventory carries no secrets** — commit SHAs, tags, timestamps, result
  strings and gate messages. It is `0644` deliberately, and nothing that is not
  already derivable from a public repository should ever be added to it.

## Open questions

1. **Does the reconciler block show per-service gate strings, or only the run
   summary?** Four services with gate strings is dense; the services rows may be
   the better home for each service's own gate. An `impeccable` question.
2. **Should a stale inventory have a threshold?** "Written 3 hours ago" is
   clearly wrong, "written 6 minutes ago" is normal drift past a 5-minute tick.
   A threshold would need to be chosen rather than derived, and choosing it
   without having watched the number is guessing.

## Decomposition sketch

Offered for `writing-plans`, not binding.

1. **`lychee-ops` publishes the inventory.** The directory, the assembly task,
   the schema, the declared-services list. Verifiable on the host with
   `cat /var/lib/lychee-inventory/services.json` and no app change at all.
2. **`lyly-admin` reads it.** Parser, types, the `systemctl show` call, the
   state mapping, degradation. Pure modules with tests against the fakes, no
   page yet.
3. **The page.** Routing, header item, the three groups — through `impeccable`.
4. **The hop chain.** Live state on hops 2 and 3 of the site detail page.
