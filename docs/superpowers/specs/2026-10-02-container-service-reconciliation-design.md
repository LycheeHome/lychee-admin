# Container service reconciliation — design

Date: 2026-10-02
Status: approved in conversation; written spec pending review
Implements step 2 of `2026-09-25-managed-services-design.md`, **narrowed** — see
"What this slice drops, and why" below.

## Problem

`lychee` deploys three services through the reconciler, and each one is a
near-copy of the others: `lyly_admin_app`, `swee_app`, `palsave_api_app` all
fetch a repo, gate on CI, build in place, restart a unit, and write a
`deploy-status.json`. That pattern works, and it does not generalise. It needs
a deploy key per repository, it builds on the box, and every new service is
another role.

The parent design's answer is to split the managed surface in two. **Host
agents** — `lyly-admin`, `swee` — stay systemd units declared in `lychee-ops`,
because they are intrinsically privileged and containerising them would make
the boundary decorative. **Application services** — `palsave-api`, and later
scaffolded sites — become containers described by a bounded declaration, so
that `lyly-admin` can eventually write those declarations without ever gaining
the ability to execute a command as root.

This slice builds the container half and proves it on `palsave-api`. No UI:
declarations are hand-written here. Slice 4 is where `lyly-admin` writes them,
and the security model exists entirely in anticipation of that.

## What changed since the parent design, and what it costs

The parent design was written 2026-09-25. Four things have changed since, each
verified rather than assumed, and together they reshape this slice.

**`palsave-api` has no secrets.** Its entire configuration is
`PALSAVE_API_BACKUP_DIR` (a path) and `PALSAVE_API_PORT` (a number) —
`config.py:8-12`, `.env.example`. Nothing in it is sensitive.

**And nothing else can exercise secrets either.** The parent design's own
declaration example is `swee.yml` carrying `env_from: swee`, but its
two-category table places `swee` in **host agents** — systemd, explicitly not a
container. `swee` holds the real secrets (`DISCORD_TOKEN`,
`ANTHROPIC_API_KEY`); `lyly-admin` and the Palworld server are host agents and
non-goals. So the first service that could consume SOPS/`age` is a scaffolded
site, which is **slice 5**. Building the secrets machinery here would ship the
most security-critical component of the whole design with no consumer to test
it against.

That is the shape `CLAUDE.md` already warns about twice — a dependency asserted,
carried through a spec, and gating work, without anyone checking whether it
could be reached. **SOPS/`age` is therefore deferred to its first real
consumer.** The schema reserves the field names so adding it later is additive,
not a migration.

**`palsave-api` was migrated to systemd + venv on 2026-10-01/02** — its own uid,
`/opt/palsave-api`, `/var/lib/palsave-api`, the `palsave_api_app` and
`palsave_api_host` roles, pinned-release deploys. This slice replaces that
deployment. The *identity* work survives untouched: the uid/gid and the
`palworld` group membership become the container's `user:` and its access to
the save directory. What retires is the unit, the venv, and most of the two
roles.

**The `/services` board shipped 2026-10-02**, and it is a concrete consumer of
"every service is a systemd unit" — see Observability below. The parent design
decided "no per-service systemd units" before that board existed.

Also corrected: the parent design lists `port: 8787` for `palsave-api`. It moved
to `8788` during the identity slice, to leave `8787` to `lyly-admin` alone.

### One omission in the parent design, which survives scrutiny

The parent design disqualifies `swee` partly for needing "bind mounts into
another user's home", then describes `palsave-api` as needing "one read-only
bind mount" without noting that its backup directory is *also* under
`/home/steam`. The conclusion holds anyway, and the distinction is worth
stating explicitly because it is the one carrying the security argument: a
**read-only** view of a data directory is not a route to root. `swee`'s
disqualifiers were host PID namespace, `/proc`, and a path to the host's
`systemctl` — any one of which hands a container arbitrary root by another road.
`palsave-api` needs none of them.

## What this slice drops, and why

| Parent design item | Here | Reason |
|---|---|---|
| `lychee-services` repo | **in** | |
| Declaration schema, strict rejection | **in** | |
| Root-owned compose templates | **in** | |
| `image` namespace allowlist | **in** | Load-bearing against exfiltration; cheap |
| Deletion semantics | **in** | |
| Constrained mounts | **in**, designed here | Parent said "no free-form `volumes:`" without saying what replaces it |
| SOPS/`age` secrets | **deferred** | No consumer until slice 5 |
| `lyly-admin` writes declarations | out | Slice 4 |
| Containerising `swee`/`lyly-admin` | out | Host agents, by the parent design |
| Volume purging | out | Separate deliberate action |
| Per-service systemd wrapper units | out | Parent deferred; revisit if journal integration proves worth it |

## Trust boundary and repo layout

```
 palsave-api        Dockerfile + CI building and pushing an image
                    ── on GitHub-hosted runners ──
                              │ image:tag
                              ▼
 lychee-services    private. declarations only, one file per service.
                    hand-written this slice; lyly-admin pushes in slice 4.
                    reconciler: read-only.
                              │
                              ▼
 lychee-ops         private. reconciler, validator, root-owned templates,
                    mount vocabulary. lyly-admin has NO access of any kind.
                    validate → render → docker compose up -d
                              │
                              ▼
 lychee             containers running
```

**The repo split is load-bearing, and is built now even though nothing
automated writes to `lychee-services` yet.** If `lyly-admin` could push to
`lychee-ops` it could rewrite the playbook, the sudoers file, or the templates —
all applied as root. That would be worse than granting the app systemd access
directly, because it would look like the safe design. Building the split now
means slice 4 does not have to migrate declarations between repos, and the
read-only access pattern is exercised from the first tick.

**New manual bootstrap step.** A third read-only deploy key as root,
`/root/.ssh/id_lychee_services`, plus a `Host` alias block in
`/root/.ssh/config`. Same reason the existing two need one: all three repos
clone from the same literal `git@github.com:` remote and SSH has no other way to
tell them apart. This joins the short list of things the reconciler cannot
bootstrap for itself.

## The declaration

```yaml
# lychee-services/palsave-api.yml
name:         palsave-api
image:        ghcr.io/lycheehome/palsave-api:1.4.0
state:        running          # running | stopped | absent
port:         8788
bind:         127.0.0.1
mounts:       [palworld_saves]
state_volume: true
```

### What the validator enforces

- **Unknown fields are rejected**, never ignored. Silently dropping a field an
  attacker added is how a schema becomes decorative.
- `image` must match `ghcr.io/lycheehome/*` **and** carry an explicit tag.
  `:latest` and bare names are refused. This is as load-bearing as the absent
  `command:` field: an arbitrary `image` is an exfiltration path the moment
  secrets exist, and refusing a floating tag is what makes a declaration mean
  one specific artifact.
- `bind` from an allowlist — `127.0.0.1` only today. A declaration cannot move a
  loopback service onto the LAN.
- `port` numeric and outside the reserved set (`lyly-admin`'s `8787`, Caddy's
  admin API `2019`). This mirrors the check add-site already performs.
- Every `mounts` entry must name an alias in the root-owned vocabulary.
- `name` must equal the filename stem and match a strict charset.
- `state` from the enum.

### What a declaration can never express

`command`, `entrypoint`, `user`, `privileged`, `cap_add`, free-form `volumes`,
`network_mode`, `pid`, or any host path. The template supplies everything that
determines privilege, so the bounded schema one would otherwise have to invent
falls out of the shape.

### Reserved for later

`env_from` and `env_keys` are reserved names — rejected as unknown today, so
that adding secrets in slice 5 is additive rather than a schema migration.

## Mount vocabulary

Free-form host paths in a declaration would be nearly as dangerous as a
`command:` field — a read-write mount of `/etc` or `/root` owns the box. Prefix
allowlists were rejected: traversal, symlink escapes and realpath races are
exactly where that class of check fails, and it has to be right the first time.

Instead the root-owned side defines a **vocabulary**, and a declaration can only
name an entry in it:

```yaml
# lychee-ops/roles/services_host/files/mounts.yml  — root-owned
palworld_saves:
  source: "{{ palworld_backup_dir }}"
  target: /saves
  mode:   ro
  group:  "{{ palworld_gid }}"   # supplementary group the container needs
site_files:
  source: "/var/www/{{ service_name }}"
  target: /srv
  mode:   ro
```

There is no path to parse and no mode to coerce, because neither is expressible
on the declaration side. Adding a new kind of mount is a `lychee-ops` commit,
reviewed as code — which is the intended cost. It generalises to slice 5
unchanged: a scaffolded site names `site_files`.

## What gets rendered

One compose project per service, rendered from a template the app cannot see or
modify:

```yaml
services:
  palsave-api:
    image: ghcr.io/lycheehome/palsave-api:1.4.0   # ← declaration
    restart: unless-stopped
    ports: ["127.0.0.1:8788:8788"]                 # ← declaration (bind, port)
    volumes:
      - /home/steam/…/Backup:/saves:ro             # ← resolved alias
      - palsave-api_state:/state                   # ← state_volume
    working_dir: /state                            # ← template, load-bearing
    environment:
      PALSAVE_API_BACKUP_DIR: /saves
      PALSAVE_API_PORT: "8788"
      PALSAVE_API_OOZ_LIB_PATH: /app/ooz/bin/libooz.so
    user: "992:979"                                # ← template, fixed
    group_add: ["1004"]                            # ← palworld gid; see below
    read_only: true                                # ← template, fixed
    cap_drop: [ALL]                                # ← template, fixed
    security_opt: [no-new-privileges:true]         # ← template, fixed
```

**`working_dir: /state` is load-bearing and is the containerised equivalent of
the unit's `WorkingDirectory=`.** `config.py`'s `ARCHIVE_DIR` (`"snapshots"`)
and `STATE_PATH` (`"state.json"`) are *relative*, so the working directory is
what decides where the snapshot archive and the watcher's position in the backup
rotation actually live. `palsave-api.service.j2` already carries a comment
explaining exactly this, and the same reasoning applies unchanged — the state
must not live inside anything the deploy mechanism rewrites.

Two consequences follow and are easy to miss:

- `PALSAVE_API_BACKUP_DIR` becomes `/saves`, the **container-side** target, not
  the host path that is in `.env.example` today.
- `PALSAVE_API_OOZ_LIB_PATH` points at wherever the image places `libooz.so`,
  not at a host path.

`read_only: true` applies to the root filesystem; `/state` is a volume and
`/saves` is `ro` by the vocabulary, so nothing the service legitimately writes
is affected.

**`group_add` is not optional, and omitting it fails silently.** On the host,
`id palsave-api` reports `uid=992(palsave-api) gid=979(palsave-api)
groups=979(palsave-api),1004(palworld)` — the service reads the save directory
through its **supplementary** `palworld` membership, not through its primary
group. Compose's `user:` sets uid and gid and **drops supplementary groups**, so
a container running as `992:979` alone cannot read the mount. Because the mount
is `ro` and the directory simply appears unreadable, the symptom is "no saves
found" rather than a permission error — a failure that looks like an empty
backup rotation. The vocabulary entry must therefore carry the group alongside
the source, so the template supplies it rather than each service repeating it.

## Reconciliation, and what deletion means

Each tick, after the existing work: fetch `lychee-services` with its read-only
key → **validate every declaration before applying any** → render each to
`/etc/lychee-services/<name>/docker-compose.yml` → apply by state.

| `state` | Action |
|---|---|
| `running` | `docker compose up -d`, pulling when the tag moved |
| `stopped` | `docker compose stop` |
| `absent` | `docker compose down`, **never** `-v` — named volumes preserved |

**Deleting a declaration file does nothing.** A running container with no
declaration is reported as drift, not acted on. A bad merge or a mis-click
cannot stop a service, because stopping one requires someone to write the word
`stopped`. This follows the precedent already in the codebase: `CLAUDE.md`
requires site removal to be two separate requests so a failed config change can
never cascade into deleted data. The cost is that `absent` entries accumulate,
which is the right trade against a mechanism whose failure mode would otherwise
be "a file vanished and a service died".

**Validate-all-before-apply-any** is the fail-closed ordering this repo already
requires of the Caddy flow. A tick that cannot validate the whole set applies
none of it. One service failing validation must not block the others from a
*later* clean tick, but must be loud: reported per service in the status output
rather than logged and forgotten.

## `palsave-api`'s image and CI

- **Dockerfile**: a Python base matching the runtime it is built against,
  `requirements.txt`, the `ooz` native library baked in, no build toolchain in
  the final layer, and a non-root user whose uid/gid match the host's.
- **CI**: extend the existing workflow to build and push to `ghcr.io` on each
  release-please release, tagged with the semver. GitHub-hosted runner — this
  repo has no self-hosted runner and must never need one.
- **Host credential**: one `read:packages` token, hand-placed, same shape as the
  deploy keys. Private package rather than public, per the parent design: the
  repos are public today, but scaffolded sites belong to other people and may be
  private, and one mechanism covering both is worth more than saving a
  credential.

This preserves the existing pinned-release model rather than replacing it. The
declaration pins a version, so `docs:`/`chore:` commits do not move it — the
same property the `.deployed-tag` mechanism has today.

## Observability

Cutting `palsave-api` over would otherwise make it **vanish into a permanently
grey row** on the `/services` board that shipped the day before. The inventory's
base record hardcodes `'unit': s.unit` (`services.json.j2:4`), and
`serviceInventory.ts` validates unit names against a regex requiring a
`.service`/`.timer`-shaped suffix. With the unit gone, `systemctl show` reports
`LoadState=not-found`, which maps to `unknown` — forever.

That is precisely the failure the `lyly-reconcile.service` comment in
`roles/inventory/defaults/main.yml` was written to avoid: declaring a unit whose
state publishes a permanent false reading on a healthy host.

So this slice teaches the inventory about containers:

**`lychee-ops`** — an entry carries `container: <project>` as an alternative to
`unit:`; the template emits `kind: unit|container` plus the relevant identifier
instead of hardcoding `unit`; container state is read from `docker compose ps`
and mapped to the **same canonical vocabulary** already shared by the header
pill and the request chain's last hop.

**`lyly-admin`** — `serviceInventory.ts` parses `kind` and accepts a compose
project name (the `UNIT_NAME` regex cannot apply to one); `serviceBoard.ts`
gains a container branch. Pill rendering is unchanged, because the vocabulary is
shared rather than parallel. The degrade-never-throw property of the existing
parser is preserved: an unreadable or unrecognised entry becomes `unknown`, not
an error.

This is what the parent design's slice 3 actually called for — "services from
`docker compose ps`" — which the shipped implementation did not need yet
because every declared service was a unit.

## Cut-over and rollback

Straight cut-over, accepting a short outage window:

1. Image published and confirmed pullable on the host.
2. Declaration written; validated and rendered, compose file inspected.
3. `systemctl disable --now palsave-api`; the unit declared **absent** in
   `lychee-ops`.
4. `docker compose up -d`.
5. Verify: the API answers on `8788`, `state.json` advances in the volume, and
   a snapshot is written.

**Rollback is reverting the two commits** — the next tick re-declares the unit
and restarts it. For that to be true, `/opt/palsave-api`, its venv, and
`/var/lib/palsave-api` are **deliberately not deleted in this change**, so a
revert is a revert and not a rebuild. Purging them is a separate, later,
deliberate action, on the same precedent as the two-request site removal.

The reconciler races hand-migrations, so the timer is stopped before step 3 and
restarted after step 5 — not at the end.

## Where `PALSAVE_API_BACKUP_DIR` comes from — answered

`/opt/palsave-api/.env`, mode `600`, owned by `palsave-api`, gitignored and
hand-placed. `load_dotenv()` with no arguments walks up from the calling
module's directory rather than the working directory, so `config.py` finds it
beside the deployed code, not in the state directory — which is why there is no
`.env` under `/var/lib/palsave-api/` and why the unit sets only
`PALSAVE_API_OOZ_LIB_PATH`.

**This is a recorded decision, not drift.** `group_vars/all.yml:76` places
`/opt/palsave-api` and its `.env` in the same by-hand category as
`/opt/lyly-admin` (Decision 7): the reconciler declares the steady state once a
migration has run, and does not bootstrap its own config.

The container retires that file anyway, and cheaply, because **neither value in
it is a secret**:

- The port is already declared — `palsave_api_port: 8788`, whose comment notes
  it must match "whatever the service is actually listening on" because the
  health check reads the same variable.
- The backup path is already *derivable* from declared variables.
  `palworld_install_dir` is `{{ palworld_root }}/{{ palworld_instance }}`,
  `palworld_world_guid` is pinned, and `palworld_host/tasks/main.yml:121-122`
  already walks the `Pal/Saved/SaveGames/0/<guid>/backup` chain to set its
  ownership and setgid modes.

So this slice does not introduce new knowledge about the host — it composes
`palworld_backup_dir` from facts `lychee-ops` already declares, and moves two
values out of a hand-placed file into the rendered compose. That is a real
reduction in undeclared state, achieved without needing the secrets mechanism
this slice defers.

## `libooz.so` is host state today, and that is the clearest case for the image

`PALSAVE_API_OOZ_LIB_PATH=/var/lib/palsave-api/lib/libooz.so`. The native
library lives in the **state** directory rather than beside the code, and that
placement is deliberate and well documented: `group_vars/all.yml:222-242`
records that the original justification — a force-fetch would delete it — was
*probed and disproved* (`ansible.builtin.git` with `force: true` never calls
`git clean`), and then keeps the split for a sounder reason, that state living
outside the directory the reconciler rewrites is safe under a deploy mechanism
other than the current one.

That reasoning is correct and should not be reopened. What a container changes
is the premise underneath it: **the image is the deploy mechanism**, immutable
and rebuilt rather than synced in place, so there is no directory being
rewritten for the library to need protecting from.

Baking it in converts the least-reproducible part of this service into a build
artifact and dissolves the layout question entirely, which is the strongest
standalone argument for containerising `palsave-api` at all. It is also the most
likely thing to fail first, since the image's libc must match what the library
was built against.

A consequence for the compose rendering: `PALSAVE_API_OOZ_LIB_PATH` becomes an
in-image path, and `/var/lib/palsave-api/lib/` stops being read at all. It is
preserved rather than deleted at cut-over, like the rest of the state directory,
so that a revert is a revert.

## The state directory's mode constrains the container's uid

`/var/lib/palsave-api/` is `drwxr-x---  palsave-api palsave-api` — mode 750,
with no group access beyond its own primary group. Nothing outside uid 992 can
read it, which is why the unprivileged checks above failed. If the container's
state volume is seeded from or replaces this directory, the container's uid must
match exactly; a mismatched uid gets `EACCES` on its own state, which at least
fails loudly, unlike the `group_add` case.

`state.json` is ~4.4 MB and rewritten continuously, so the named volume is
carrying real working state, not a marker file.

## The empty-directory failure mode, and why it needs a positive check

`palsave-api` polls a directory. **An empty one looks like a quiet one**, so
every way of pointing it at the wrong place produces the same symptom: a healthy
container, a responsive API, and no snapshots — indistinguishable from a server
nobody is playing on. `group_vars/all.yml:258-262` already records one cause.
Containerising adds two more, and they converge:

1. **A new world GUID.** A new world creates a fresh `0700` directory the
   declarations do not cover. Already documented; `palworld_world_guid` is
   pinned precisely because of it.
2. **A missing `group_add`.** The container reads the saves through the
   supplementary `palworld` group; `user:` alone drops it. The mount is `ro`, so
   the directory simply appears unreadable.
3. **A bind-mount source that does not exist.** Docker **creates a missing bind
   source as an empty directory owned by root** rather than refusing to start.
   A typo in `palworld_backup_dir`, or a GUID that has moved, therefore yields a
   silently empty `/saves` and a container that comes up clean.

Cause 3 is new with this slice and is the most dangerous, because it converts a
configuration error into a successful start. It is also the reason the mount
vocabulary resolves paths **root-side**: a declaration cannot introduce one.

**Required mitigations:**

- The reconciler validates that every resolved mount source **exists, is a
  directory, and is readable by the target uid/gid** *before* rendering, and
  fails the tick loudly when it is not. Never let Docker create it.
- The container's `group_add` is supplied by the vocabulary entry, not by each
  service, so it cannot be forgotten per service.
- Cut-over verification is a **positive read**, not liveness — see success
  criteria. "The API answered" proves nothing here.

The good news is that the access chain this depends on is itself declared:
`palworld_host` reconciles group ownership and setgid modes along
`Pal/Saved/SaveGames/0/<guid>/backup`, so the group the container joins is
maintained rather than incidental.

## Risks

- **Nothing declares the uid/gid, so there is no variable to derive from.**
  `palsave_api_host` installs the unit, removes a superseded sudoers drop-in and
  enables the service — it does not create the user. `992:979:1004` were
  assigned by `useradd` during the 2026-10-01 hand migration and exist only as
  host state, the same category `CLAUDE.md` already notes for the `lyly-admin`
  user and the `webdeploy` group. A rebuilt host could pick different numbers,
  and the mount would then read nothing while everything reported healthy. This
  slice must close that: either declare the user with explicit uid/gid in
  `palsave_api_host`, or resolve the numbers at render time via `getent` and
  fail the tick when they are missing. Hardcoding them in the template is the
  one option to reject.
- **`ooz` is native code.** The image's libc must match what `libooz.so` was
  built against. Baking it in is the reproducibility win that makes
  containerising worthwhile at all, and it is also the most likely thing to fail
  first.
- **First private `ghcr.io` package on this host**, so the pull credential path
  is untested end to end.
- **`docker compose ps` output shape** is the new input to the inventory, and
  an invariant about what a build or a parse reads is a property to re-check
  whenever it gains an input — not a fact that stays true on its own.

## Success criteria

- `palsave-api` serves on `127.0.0.1:8788` from a container, with `state.json`
  and `snapshots/` persisting in a named volume across a restart.
- **A positive read of the save directory**, not merely a live endpoint: the
  container lists a non-zero number of backup files it can actually open, and
  writes a new snapshot derived from one. A healthy container that sees an empty
  directory is the expected symptom of three separate defects, so liveness is
  not evidence of success.
- The reconciler refuses to start a service whose mount source is missing,
  rather than letting Docker create it empty.
- Its `/services` row reports live container state in the canonical vocabulary,
  with a version derived from the image tag.
- A declaration naming an unknown field, a non-allowlisted image, a floating
  tag, a reserved port, a non-loopback bind, or an unknown mount alias is
  **rejected**, and the rejection names the field.
- Deleting a declaration file leaves the container running and reports drift.
- `state: stopped` stops it; `state: absent` removes the container and keeps the
  volume.
- Reverting the cut-over commits restores the systemd unit within one tick.

## What this does not fix

Scaffolded sites still have no deploy path — the generator stopped emitting an
unusable workflow on 2026-10-02 and emits no replacement until slice 5, which
needs this mechanism plus the secrets half deferred here. Migrating sites
already deployed from other people's repositories remains open, and is a
conversation with their owners rather than a code decision.
