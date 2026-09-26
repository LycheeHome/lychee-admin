# Managed services — design

Date: 2026-09-25
Status: approved shape, decomposition pending sign-off
Supersedes a scope boundary in `PRODUCT.md` — see "Product scope change"

## Problem

`lychee` runs several long-lived processes that nothing on the box describes in
one place: `lyly-admin` itself, `swee` (a Discord bot, Python venv + systemd
unit, deployed by the self-hosted runner on release), `palsave-api` (FastAPI
under uvicorn, bound to `127.0.0.1:8787` — it has `deploy/ci-deploy.sh` and a
`.service` file but **no GitHub Actions workflow at all**, so it is deployed by
hand and is not a runner dependent), the Palworld server, two
Cloudflare tunnels, Caddy, and one Docker container per Next.js site that
`lyly-admin` scaffolded. Three of those are deployed three different ways.

Two consequences, one of them urgent.

**The self-hosted runner cannot be retired.** `swee` deploys through it, and
`src/lib/frameworkScaffold.ts:75` emits `runs-on: self-hosted` into the GitHub
Actions workflow of *every* Next.js site the app scaffolds. Those workflows are
running in other people's repositories today. Until both are off the runner, a
fork pull request against any public repo in the org can reach the host — which
is the exposure the pull-based deploy project closed for `lyly-admin` and could
not close for anything else.

**`lyly-admin` does not know what runs on the host it administers.** It knows
about sites, because it created them. It has no idea `swee` or `palsave-api`
exist, which makes it a partial answer to the question its own detail page is
built to answer: which hop broke.

## Product scope change

`PRODUCT.md` currently states, deliberately:

> **Managed surface**: Caddy site blocks, the sites tunnel's ingress rules,
> `/var/www/<hostname>/`, and service reloads/restarts. Nothing else.
>
> **Outside the app, by design**: … running whatever listens on a reverse-proxy
> port … this app never invokes Docker to start, stop, or rebuild anything.

This design reopens that on purpose. The managed surface grows to include
**long-lived services**: things with an image, no hostname requirement, and a
lifecycle the operator wants a single place to see and change.

What does **not** change, and is worth restating because it is what keeps the
expansion honest: the app still never invokes Docker to start, stop or rebuild
anything. It never gains that privilege. It writes a *request*; something else
with root acts on it. The distinction between those two is the entire security
argument below, and `PRODUCT.md` should be amended to say so rather than
quietly dropping the old sentence.

## Goals

1. `swee` and `palsave-api` stop being bespoke deployments.
2. Scaffolded sites stop needing a self-hosted runner, so the runner can be
   retired and the org's public repos stop being a path to the host.
3. `lyly-admin` can show what runs on `lychee` and change it, without gaining
   the ability to execute arbitrary code as root.
4. One runtime story for anything new, rather than a third one per language.

## Non-goals

- Managing the Palworld server, Caddy, the tunnels, or `lyly-admin` itself.
  Those are declared by `lychee-ops` or predate all of this; bringing them in is
  a separate question and mostly unnecessary.
- Multi-host anything. One box, one operator. `PRODUCT.md` is emphatic and
  nothing here should be designed as though that were temporary.
- Replacing `lychee-ops`. This extends it.

## Why containers, and why that decides the security model

The obvious reading of "let `lyly-admin` manage services" is that it writes
systemd units. **That is arbitrary code execution as root**, in two steps: a
unit has `ExecStart=`, and `User=` defaults to root. Everything the app can do
today is *configuration of two specific daemons* — neither the Caddyfile nor a
tunnel ingress rule can execute a command. Unit files are a different category,
and the app is a single-user basic-auth web UI on a LAN: whatever reaches that
UI inherits whatever it can do.

Containers dissolve the problem rather than fencing it. A declaration that
resolves to a container has **no field in which to put a command**, because the
template supplies the runtime, the user and the confinement. The bounded schema
one would otherwise have to invent for systemd falls out of the shape.

Docker specifically, not Podman/Quadlet: Docker is already installed, already
load-bearing (every scaffolded site runs under it), and
`lyly-admin-docker-status` is already one of the eight sudo-pinned commands.
Quadlet is arguably the more elegant fit for a systemd-organised host, but it
would mean a third runtime, rewriting the scaffold generator, and migrating
sites already deployed in other people's repositories. It is not *safer* for
this purpose — the property being bought is the absent `command:` field, and
Docker gives that identically.

Systemd does not disappear; it moves up one level. It supervises the Docker
daemon, and Docker supervises the services. N units become one.

## Architecture

```
 app repos            swee · palsave-api · scaffolded sites
                      Dockerfile + CI that builds and pushes an image
                      ── on GitHub-hosted runners. No self-hosted runner. ──
                                    │ image:tag
                                    ▼
 lyly-admin           writes a declaration, commits it.
                      Gains NO new privilege.
                                    │
                                    ▼
 lychee-services      private. declarations only, one file per service.
                      lyly-admin: push.  reconciler: read-only.
                                    │
                                    ▼
 lychee-ops           private. reconciler + root-owned templates.
                      lyly-admin has NO access of any kind.
                      validate → render → docker compose pull && up -d
                                    │
                                    ▼
 lychee               containers running
```

### The repo split is load-bearing

`lychee-services` must be a **separate repository from `lychee-ops`**. If
`lyly-admin` could push to `lychee-ops` it could rewrite the playbook, the
sudoers file, or the templates — all of which the reconciler applies as root.
That would be worse than granting the app systemd access directly, because it
would look like the safe design. The app must be able to write *requests* and
never *the thing that acts on requests*.

### A declaration, and what it renders to

What `lyly-admin` writes:

```yaml
# lychee-services/swee.yml
name:     swee
image:    ghcr.io/lycheehome/swee:2.11.2
restart:  unless-stopped
env_from: swee            # names a secrets file; never contains secrets
```

What the reconciler renders, from a template the app cannot see or modify:

```yaml
services:
  swee:
    image: ghcr.io/lycheehome/swee:2.11.2       # ← declaration
    restart: unless-stopped                      # ← declaration
    env_file: /etc/lychee-ops/secrets/swee.env   # ← derived from env_from
    user: "10001:10001"                          # ← template, fixed
    read_only: true                              # ← template, fixed
    cap_drop: [ALL]                              # ← template, fixed
    security_opt: [no-new-privileges:true]       # ← template, fixed
```

Four values come from the declaration. Everything that determines privilege
comes from the template. There is no `command:`, no `user:` override, no
`volumes:` free-form, no `privileged:`. **Unknown fields are rejected, not
ignored** — silently dropping a field an attacker added is how a schema becomes
decorative.

`palsave-api` adds `port: 8787` and `bind: 127.0.0.1`; the template refuses any
bind address outside a small allowlist, so a declaration cannot move a loopback
service onto the LAN.

### Supervision

Compose `restart: unless-stopped` plus the Docker daemon enabled at boot. No
per-service systemd units. This is what the existing Next.js scaffold already
relies on, so it is proven on this host.

A later addition, if systemd-level alerting proves worth it: one unit per
service wrapping compose, giving journal integration and `OnFailure=`. Still
rendered from a root-owned template, so the security property is unchanged.
Deliberately not in the first version — `lyly-admin` will be reading
`docker compose ps` for all of these anyway, which covers most of the
visibility that would buy.

## Open decisions

These are real forks, not details. Each needs answering before implementation.

**Secrets.** `swee` needs a Discord token and an Anthropic key; `palsave-api`
likely needs its own. The declaration references a secrets file and must never
contain one — but something has to put `/etc/lychee-ops/secrets/<name>.env` on
the host, and that is outside git by definition. The existing precedent is
`/etc/lychee-ops/secrets.yml`, created by `bootstrap.sh` as a `0600` template
the operator fills in. Extending that pattern is the obvious answer; whether
`lyly-admin` should be able to *tell you a secret is missing* without being able
to read it is the interesting part.

**Registry and authentication.** `ghcr.io` is the natural home. Private images
mean another credential on the host — read-only, scoped to packages, but real.
Public images would avoid it at the cost of publishing build artifacts.

**Deletion.** A declaration disappearing means "tear this service down" — a
destructive action triggered by a file vanishing from git. A bad merge or a
mis-click would stop a running service. This needs the treatment site removal
already gets: explicit confirmation, never silent, and probably a tombstone
rather than an immediate `down`.

**Migrating already-deployed scaffolded sites.** Changing the generator does not
change workflows already running in other people's repositories. Retiring the
runner requires migrating those too, and that is a conversation with their
owners, not a code change.

## Decomposition

Too large for one implementation plan. Proposed sub-projects, each producing
something that works on its own:

1. **Containerize `swee`.** Dockerfile, CI that builds and pushes to a registry
   on release. Still deployed the old way at the end of this. Smallest useful
   unit, and it makes `swee` a real test case for everything after.
2. **Service reconciliation in `lychee-ops`.** The `lychee-services` repo, the
   schema, the templates, validate/render/apply, deletion semantics. Proven
   with a hand-written declaration for `swee` — no UI yet. **At the end of this,
   `swee` is off the self-hosted runner.**
3. **`palsave-api` as the second case.** The schema's first real test against
   something it was not designed around — it binds a port, `swee` does not, and
   it is deployed by hand today rather than by CI, so it also exercises the
   "no existing pipeline" path. Expect it to find gaps; that is why it is
   separate. Note this slice buys uniformity and observability, **not** runner
   retirement: `palsave-api` was never on the runner.
4. **`lyly-admin` writes declarations.** The UI, the git push, the "requested
   but not yet applied" state the app has no concept of today. This is the
   `PRODUCT.md` change and the largest single piece.
5. **The scaffold emits declarations.** `frameworkScaffold.ts` stops generating
   a self-hosted-runner workflow. **This is the actual goal**, and only after it
   — plus migrating existing sites — can the runner be retired.

Sequencing note: 1–3 are infrastructure and can proceed without touching
`lyly-admin` at all. The security benefit is back-loaded: `swee` leaves the
runner at the end of 2, but the runner itself cannot go until 5 and the
migration of existing sites are both done.

## What this does not fix

The runner exposure remains live throughout. The org's fork-PR approval policy
(`all_external_contributors`, set 2026-09-21) is the mitigation in force
meanwhile, and it is a human gate: it depends on nobody approving a fork PR
whose `runs-on:` they did not read.
