# Managed services — design

Date: 2026-09-25
Status: shape and decisions approved; decomposition pending sign-off
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

> **Superseded 2026-09-28.** The runner was retired once `swee` came off it. The
> claim below that scaffolded sites blocked this was wrong: the runner was
> org-scoped, so repositories outside `LycheeHome` could never reach it. Goal 2
> and slice 5 survive as a correctness fix to generated output, not as a security
> blocker. The original text is kept because the reasoning it contains about fork
> pull requests is still correct and still the reason the deploy job had to go.

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

## Two categories, not one runtime

The first draft of this design assumed every long-lived process on `lychee`
could become a container. Checking the code before planning showed that is
false, and the distinction it exposes is more useful than the uniformity it
cost.

**`swee` is a host agent, not a portable service.** It runs
`sudo systemctl restart palworld` (`swee/restart.py:41`), reads `/proc/meminfo`
(`swee/ram.py:5`), shells out to `steamcmd` against `PALWORLD_INSTALL_DIR`, and
reads `PalWorldSettings.ini` under `/home/steam`. Containerising it would need
host PID namespace, `/proc`, a route to the host's `systemctl`, and bind mounts
into another user's home — at which point the container boundary is decorative,
and the security argument this whole design rests on collapses, because a
container that can `systemctl restart` on the host has arbitrary root by another
road.

**`palsave-api` is a portable service.** It reads a backup directory and writes
`snapshots/` and `state.json` (`config.py:8-12`). No subprocess, no `systemctl`,
no `/proc`. One read-only bind mount and one volume.

So the managed surface splits in two, and each half gets the mechanism that fits:

| | examples | declared in | runtime | `lyly-admin` can |
|---|---|---|---|---|
| **Host agents** | `lyly-admin`, `swee` | `lychee-ops` | systemd unit | **observe** |
| **Application services** | `palsave-api`, scaffolded sites | `lychee-services` | container | **observe and manage** |

This is a better answer than the one it replaces. Host agents are few, change
rarely, and are intrinsically privileged — they belong in the root-owned repo
that already declares `lyly-admin` itself, reviewed as code. Application services
are the ones that multiply, and they are exactly the ones a bounded declaration
can safely describe.

It also means "`lyly-admin` knows what runs on `lychee`" resolves differently per
category: it *sees* everything, and *changes* only the things it is safe to
change through a schema. That is a sharper product statement than "manages
services", and it does not require the app to hold privileges over the agents
that manage the host.

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

**`image` must be constrained to a trusted namespace, enforced by the
reconciler.** This is as load-bearing as the absent `command:` field, and it is
easy to miss. If a compromised `lyly-admin` could write an arbitrary `image`, it
could exfiltrate every secret on the host regardless of how they are stored —
point a service at an attacker-controlled image, the reconciler injects the
decrypted environment by design, and the container posts it anywhere. Encryption
at rest is irrelevant to that path, because secrets are decrypted at the moment
of use. With the namespace pinned to `ghcr.io/lycheehome/*`, the worst a
compromised UI achieves is running a wrong or stale version of your own
images.

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

## Decisions

### Secrets — SOPS with `age`

Secrets are encrypted in `lychee-services` alongside the declarations, decrypted
by the reconciler at apply time. `lyly-admin` holds the **public** key; `lychee`
holds the **private** key.

`age` is asymmetric, and that asymmetry is the whole point: encryption needs only
the public key, so the app can *write* a new secret and cannot *read* any
existing one. A symmetric scheme — Ansible Vault, which would otherwise be the
natural choice since the reconciler is already Ansible — cannot do this. One
password both encrypts and decrypts, so an app able to write secrets can read
them all.

Rejected: letting `lyly-admin` write plaintext secrets to the host, which turns
the app into a secrets store and makes one compromise leak every service's
credentials at once. Today the app holds exactly one secret — its own bcrypt
hash, which it only ever compares against — and that is worth preserving.

Also rejected: plain `.env` files placed by hand, which is what most homelabs do
and is perfectly defensible. It avoids the dependency entirely, at the cost of
secrets that are unversioned, unbacked-up, and gone when the host is rebuilt —
on a host whose rebuildability is a stated goal of `lychee-ops`.

The declaration still names which keys a service requires:

```yaml
env_keys: [DISCORD_TOKEN, ANTHROPIC_API_KEY]   # names only, never values
```

so the reconciler can fail loudly on a service declared without its secrets,
rather than starting a container that crash-loops on a missing variable. The
result lands in the status file `lyly-admin` already reads, so the UI can say
exactly which key is missing without ever holding its value.

**Honest cost:** one more tool to understand, and losing the private key means
losing every secret. It must be backed up somewhere that is not `lychee`.

### Registry — `ghcr.io`, private, one read-only token

CI builds on GitHub-hosted runners and pushes; the host only pulls. The host
needs one credential scoped to `read:packages`, regardless of how many services
exist.

The alternative — building on the host from a git checkout, which is what both
the current Next.js scaffold and `lyly-admin`'s own deploy do — needs a deploy
key **per app repository**. One credential versus N, plus every build's load on
the box.

Private rather than public images: `swee` and `palsave-api` are public repos, so
public images would leak nothing new for them. But it would not generalise to
scaffolded sites, which belong to other people and may be private. One mechanism
that covers both is worth more than saving a credential.

### Deletion — state is declared, never implied by absence

```yaml
state: running    # default
state: stopped    # container down, everything kept
state: absent     # container removed, named volumes preserved
```

**Deleting the file does nothing.** A running container with no declaration is
reported as drift, not acted on. A bad merge or a mis-click cannot stop a
service, because stopping one requires someone to write the word `stopped`.

Purging volumes is a separate, deliberate action, unreachable from editing a
declaration.

This follows the precedent already in the codebase rather than inventing a new
rule: CLAUDE.md requires that removing a site be two *separate* requests, so a
failed config change can never cascade into deleted data. The cost is that
`absent` entries accumulate as cruft, which is the right trade against a
mechanism whose failure mode would otherwise be "a file vanished and a service
died."

### Migrating already-deployed scaffolded sites

Still open, and not a code decision. Changing the generator does not change
workflows already running in other people's repositories. Retiring the runner
requires migrating those too, and that is a conversation with their owners.

## Decomposition

Each sub-project produces something that works on its own.

1. **`swee` deployed by `lychee-ops`.** A role mirroring `lyly_admin_app`: fetch
   the repo, gate on CI, build the venv, restart the unit. No containers, no
   declarations — `swee` is a host agent. **At the end of this `swee` is off the
   self-hosted runner**, which is the security payoff, and the pattern is already
   proven in production by `lyly-admin`'s own role.
2. **Container service reconciliation**, proven with `palsave-api`. The
   `lychee-services` repo, the schema, root-owned templates, SOPS/`age`, the
   `image` allowlist, deletion semantics. Hand-written declaration, no UI yet.
   `palsave-api` is a better first case than `swee` would have been: it was never
   designed around this schema, so it tests it honestly.
3. **`lyly-admin` observes.** Read-only inventory of both categories — host
   agents from `lychee-ops`' status output, services from `docker compose ps`,
   which the app already reads through an existing sudo-pinned wrapper. No new
   privilege, no `PRODUCT.md` change, and it delivers "knows what runs on
   `lychee`" on its own.
4. **`lyly-admin` manages services.** Writes declarations, commits them, and
   represents "requested but not yet applied" — a state the app has no concept of
   today. This is the `PRODUCT.md` change and the largest piece.
5. **The scaffold emits declarations.** `frameworkScaffold.ts` stops generating a
   self-hosted-runner workflow. **The actual goal**, and only after it — plus
   migrating sites already deployed in other people's repositories — can the
   runner be retired.

Note that 3 was previously folded into 4. Separating them matters: observation is
the whole of the stated goal, needs no new privilege, and can ship long before
anyone decides whether the app should mutate anything.

## What this does not fix

The runner exposure remains live throughout. The org's fork-PR approval policy
(`all_external_contributors`, set 2026-09-21) is the mitigation in force
meanwhile, and it is a human gate: it depends on nobody approving a fork PR
whose `runs-on:` they did not read.
