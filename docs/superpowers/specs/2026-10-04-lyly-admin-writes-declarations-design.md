# `lyly-admin` writes declarations — design

Date: 2026-10-04
Status: approved in conversation; written spec pending review
Implements step 4 of `2026-09-25-managed-services-design.md`. Step 5 (the
scaffold emits declarations) depends on this and is **not** in scope.

## Problem

`palsave-api` runs as a container reconciled from a declaration in
`lychee-resources`. Changing what it runs means editing a file in a private
repo by hand and waiting for a tick. That is correct and it is also the last
manual step in a system built to remove manual steps.

More pointedly, it blocks everything after it. Slice 5's model — provision a
hosting resource, attach a repo, and have publishing deploy — needs *something*
to move a declaration's pinned tag when a new image appears. Nothing can today,
because the app has no write access anywhere near `lychee-resources`.

This slice gives it exactly one new capability and bounds what that capability
can say.

## What the app gains

**One capability:** write a declaration into `lychee-resources`. Not execute,
not reach the host, not touch `lychee-ops`.

The repo split exists for this. The app writes *requests*; the thing that acts
on requests — the playbook, the compose template, the mount vocabulary, the
validator, `service_identities` — lives in a repo the app cannot read, let alone
write. Every question of the form "may this run as root, reach this path, use
this image" is answered where the app has no voice.

**One credential:** a write-scoped deploy key for `lychee-resources` only.

The app's secret count goes from one to two. Today it holds its own bcrypt hash,
which it only ever compares against. That is worth stating plainly as a cost
rather than buried.

### Where the key lives, and why not the obvious place

`/etc/lyly-admin/id_lychee_resources`, owned `lyly-admin:lyly-admin`, mode
`0600`, hand-placed and declared by `lychee-ops`.

**Deliberately not `/opt/lyly-admin`.** That directory is `2775
lyly-admin:webdeploy`, and `webdeploy`'s members are `caddy` and `lyly-admin`.
The `.env` there is `640 lyly-admin:webdeploy`. Putting a write credential
beside it would make it readable by `caddy` — a process that terminates traffic
arriving through the Cloudflare tunnel. `CLAUDE.md` already names that group as
"exactly the set that can rewrite the app's `.env`"; this would extend it to
"and can change what runs on the host."

A deploy key rather than a PAT because a deploy key is **repo-scoped** — it can
do nothing anywhere else — which matches the three read-only keys the host
already carries. A PAT is account-scoped and is a weaker shape for the same job.

## The write path

A local clone at `/var/lib/lyly-admin/lychee-resources`, owned by the app user.
That directory already holds the app's `deploy-status.json`, so it is the
established home for state the app reads and the reconciler writes; the clone
is the first thing the app itself writes there, and the plan settles its
ownership and mode. Pull, edit one declaration, commit, push to `main`. The reconciler picks it up on its next tick, within five minutes.

- **One file, one resource, per write.** The app never writes the vocabulary,
  never writes `lychee-ops`, and touches no declaration except to change a field
  it is entitled to change.
- **Never force-push.** A push rejected because the remote moved is retried on
  the next attempt. A rejected push means someone else wrote; overwriting them
  is the one thing that turns a bounded capability into an unbounded one.
- **Direct to `main`, not a pull request.** The validator and the root-owned
  templates are the guard, and they were built to be. A PR gate would make
  "attach means deploy" into "attach means open a PR", which is not what the
  product is for.

## Bounding what it can say

Direct push means a compromised app can write any declaration the schema
accepts, and the schema is permissive by design about *which* resource names
*which* mount alias. Today nothing stops a declaration named `anything` from
mounting `palworld_saves`.

**The mount vocabulary gains `allowed_resources`**, root-owned in `lychee-ops`
where the app cannot reach it:

```yaml
palworld_saves:
  source: "{{ palworld_backup_dir }}"
  target: /saves
  mode:   ro
  group:  "{{ palworld_gid }}"
  allowed_resources: [palsave-api]
site_files:
  source: "/var/www/{{ service_name }}"
  target: /srv
  mode:   ro
  allowed_resources: ["*.lyly.dev"]
```

**`service_name` is correct there, not `resource_name`.** The 2026-10-04 rename
moved the repo, the roles and the paths but left the per-service template
variable alone, so the vocabulary still binds `service_name`. Renaming it is a
loose end from that change, not work for this slice — the spec names the
variable the code actually uses so an implementer reading both does not have to
guess which is real.

The validator rejects a declaration naming an alias it is not entitled to, with
the field named in the rejection as every other rejection already is. This
closes the one real exfiltration path a write credential opens: a compromised UI
declaring a container that mounts the Palworld saves.

It is the same move the design has made at every layer — the thing that decides
what is *possible* lives where the app cannot write.

### The residual, stated rather than implied

A compromised app could still write `state: absent` on an existing resource,
taking it down. Volumes survive (`down` never carries `-v`), so this is denial of
service, not data loss, and it is recovered by reverting one file.

Bounding it would need a second root-owned list of resources the app may not
touch, which is a list that must be kept in step with reality and whose failure
mode is refusing a legitimate change for reasons recorded in another repo. The
trade is not worth it at this size. **This is a known, accepted gap.**

## Pending versus applied — a state the app does not have

The app has no concept of "requested but not yet applied". This slice creates
one: a window up to five minutes wide where the app's intent and the host's
reality differ, and the board must not lie during it.

The inventory publishes `version` (what is installed). It gains **`target`**
(what the declaration pins). The resource's row then reads:

| condition | shown as |
|---|---|
| `target == version` | running, as today |
| `target != version` | **applying**, with both versions visible |
| `result: failed` | failed, with `failed_step` named |

No new app state, no timestamps that can drift, and it survives a restart
because both facts come from the inventory rather than from memory. The window
is visible precisely because it is real.

## Discovery and the Deploy control

The reconcile tick already runs as root with a `read:packages` credential and
already publishes an inventory the app reads. For each declared resource it
resolves the newest published tag of **that resource's own image repository** —
which the declaration already names — and publishes it as **`available`**.

No "attach" concept is required for this, which means **slice A is testable on
`palsave-api` immediately** rather than being a foundation taken on faith.

The resource's page then reads:

> running `0.3.0` · `0.4.0` available · **[Deploy]**

Clicking writes the new pin. Rollback is the same control pointed at an older
tag. Discovery is as fresh as the last tick, up to five minutes.

### Why a button and not an automatic bump

The pinned-tag design was chosen over a floating reference specifically because
"a bad push deploys itself within five minutes with no human in the loop" was
unacceptable. An app that bumps the pin on sight reintroduces that property with
one extra hop.

It is also a category change: the app's mutations today are rare, deliberate and
confirmed. An automatic bump would make its first *frequent* mutation one that
changes what runs, gated only by CI in a repository this host does not control.

## Failure modes

| what fails | what happens |
|---|---|
| Push rejected, remote moved | Retry on next attempt. Never force. |
| Key missing or unreadable | Deploy control disabled with the reason shown — not a 500 |
| Declaration written, reconciler rejects it | The per-resource `status.json` already carries `gate` and `failed_step`; the page shows them |
| Local clone missing or corrupt | Re-clone rather than failing the page |
| Inventory stale or unreadable | Existing degrade-to-`unknown` behaviour, unchanged |

Every one of these degrades to a neutral or named state. None of them produces a
row that claims a resource is fine when it is not — the failure this project has
spent two slices learning to distrust.

## Not in this slice

Provisioning resources, attaching repositories, the scaffold's output, SOPS/`age`
secrets, and any change to `/var/www`. All of that is slice 5 and later.

This slice ends when the app can change one pinned tag, and show honestly
whether it took effect.

## Risks

- **A second secret.** The app has held exactly one since it was built. This is
  the first expansion of that surface, and the reason the key's placement got
  more attention than its type.
- **`caddy` is in `webdeploy`.** The key placement works around that rather than
  fixing it. Whether `caddy` still needs that membership is a real question and
  deliberately out of scope here.
- **`allowed_resources` is new validation on a path that already works.** A
  mistake in it refuses a legitimate declaration rather than permitting a bad
  one, which is the right direction — but `palsave-api` is live, so a wrong
  pattern stops its reconciliation.
- **The write path is untestable off-host in the way that matters.** The push,
  the key's permissions, and the race with a concurrent writer are all real only
  on `lychee`. Local tests can cover the decision logic and the rendering; they
  cannot cover whether the key works.

## Success criteria

- The app writes a changed tag to `lychee-resources` and the reconciler applies
  it within one tick, with no manual step.
- `palsave-api`'s row shows `running 0.3.0 · 0.4.0 available` when a newer tag
  exists, and **applying** between the write and the apply.
- Clicking Deploy on an older tag rolls back by the same path.
- A declaration naming a mount alias it is not entitled to is **rejected**, and
  the rejection names the field.
- A missing or unreadable key disables the control with a stated reason, and
  renders no 500.
- A push rejected by a moved remote is retried, never forced.
- The app still holds no capability to write `lychee-ops`, and no path to
  execute anything as root.
