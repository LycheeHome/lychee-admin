# Service identities and game data layout — design

Date: 2026-09-29
Status: design approved; spec pending review
Supersedes `2026-09-29-swee-identity-separation-design.md`, which was written
before investigation showed its central mechanism was wrong
Replaces slice 1b of `2026-09-25-managed-services-design.md` and re-sequences it

## Problem

**Three programs share the `steam` account**, and its home directory is doing
duty as a service data root:

| tenant | size | what it is |
|---|---|---|
| `palworld/pal-chuds` | 9.7 GB | the game server, `User=steam` |
| `swee` | 70 MB | a Discord bot managing that server |
| `palsave-api` | 596 MB | a FastAPI service over the game's saves |

Plus 5 GB of SteamCMD's own state under `.local/share`, which is the one thing in
there that genuinely belongs in a home directory.

Any one of those three can read and write everything the others own. swee holds a
Discord bot token and a GitHub token in its `.env`; palsave-api holds whatever its
config holds; the game server is network-exposed and takes untrusted player input.
A compromise of any one is a compromise of all three.

### What investigation removed from the argument

Two things initially cited as evidence turned out not to be, and are recorded
because the reasoning that dissolved them is reusable.

**`steam` is in the `sudo` group, and it means nothing.** `passwd -S steam`
returns `L` — the password is locked, so `sudo` as `steam` prompts for something
that can never be supplied. The NOPASSWD drop-in works because it needs no
password. The group grants nothing. The superseded spec called this "the
strongest argument for the separation"; it is not an argument at all, only a
misleading signal worth removing so the next reader does not draw the same
conclusion.

**A private GitHub SSH key sat in `/home/steam/.ssh`**, readable by all three
tenants. That one was real. It served exactly one thing — `palsave-api`'s manual
`git pull` — whose remote was `git@github.com:Lychee-Home/palsave-api.git`, SSH,
and carrying the pre-rename org name. Since `palsave-api` is a public repository,
the remote was switched to HTTPS, the key deleted and revoked. **Removed rather
than migrated**, which is strictly better: migrating a secret to a narrower
account still leaves a secret.

What remains is the argument that survives: three programs share an account, so a
compromise of any one has the filesystem access of all three. That is sufficient,
and it is now the only claim being made.

### The coupling is mostly incidental, and one part is not

Enumerating what swee actually touches:

| need | actual requirement |
|---|---|
| `journalctl -u palworld-palchuds` | `adm` group |
| `/var/log/unattended-upgrades/*` | `adm` group |
| `sudo systemctl …` the game unit | a sudoers line naming the user |
| `/proc/stat`, `/proc/meminfo` | nothing — world-readable |
| its five state files | relative paths; they follow the working directory |
| `PalWorldSettings.ini` | **read and write** — see below |
| `steamcmd` against the install | **write access to the game install** |

The first four are a group, a sudoers line, and nothing. The last two are the
design.

### `/config set` writes, and its ownership handling fails silently

The superseded spec treated `PalWorldSettings.ini` as a read. It is not.
`swee/config_commands.py`'s `/config set` calls `write_palworld_setting`, which:

1. `tempfile.mkstemp(dir=directory)` — **needs write on the containing directory**
2. writes the new content
3. `os.chown(tmp, original.st_uid, original.st_gid)` — **fails for any process
   that is neither root nor the owner**, and is wrapped in
   `except (OSError, AttributeError): pass`
4. `os.replace(tmp, path)`

So under any user other than `steam`, the chown silently fails and the file
becomes owned by the writer. With mode `664` preserved, the game server can then
only write its own config if it shares a group with the new owner.

This is why the superseded spec's ACL was wrong twice over: it granted traversal
and read, when write is required; and it would have left ownership flipping on
every `/config set` with nothing to catch it.

### The `775` install is a code-execution surface

`/home/steam/palworld/pal-chuds` is `775` — group-writable — and contains both
the game binaries and `Pal/Saved/`. Any group-based grant over that tree would let
its members **replace the executable `steam` runs**, which is code execution as
`steam`. Any solution must therefore scope write access by directory depth, not by
membership alone.

### The home directory is the root cause

`PalWorldSettings.ini` is mode `664` — world-readable — behind `/home/steam` at
`750`. A permissive file made unreachable by a restrictive path. Every workaround
considered (ACLs, group membership, loosening the home, a read wrapper) is an
attempt to negotiate around a service data tree living in a home directory.

Relocating the data removes the problem rather than working around it, and
`/home/steam` at `750` becomes correct again because nothing outside `steam`
needs anything in it.

## Product direction this serves

`lyly-admin` will eventually create and manage Discord bots. The model is **one
bot instance per game server, from one codebase with per-game adapters** — the
same shape as its Next.js site scaffolding: one generator, N deployments, each
with its own config.

Not one bot across many games. Discord's model resists it (presence is singular,
commands namespace per application, rate limits are per token), but the deciding
argument is the one this design is built on: a multi-game bot is one process with
one token needing membership in every game's group, accumulating write access to
every game's data. That is the shared-identity defect rebuilt deliberately at a
larger scale.

So the layout must make "a bot manages exactly one game" the natural arrangement,
and it does: per-game directories, per-game groups, membership as the unit of
access.

## Goals

1. **The shared identity is the defect.** Not a directional threat model.
2. **Consistency with the `/opt` convention** established by `lyly-admin`.
3. **A layout the next game and the next bot inherit** without new design.

Explicitly not goals: systemd sandboxing of the units (`NoNewPrivileges` fights
swee's sudo calls); reconciler-managed users and groups (that remains manual,
consistent with `lyly-admin`).

## Decisions

### 1. Game data relocates to a per-game root

```
/srv/games/<game>/<instance>/
```

Concretely `/srv/games/palworld/pal-chuds/`. SteamCMD's `+force_install_dir`
points wherever it is told, and the game server does not care.

`/srv` over `/opt` for two reasons, one weak and one strong. FHS describes `/srv`
as site-specific data served by this system, and explicitly contemplates it being
its own filesystem or backup unit — which suits saves, the only irreplaceable
thing on this host. More usefully, `/opt` on `lychee` already means "applications
the reconciler deploys" (`/opt/lyly-admin`, and `/opt/swee` to come), and keeping
game data out of it preserves a distinction that is currently clean.

There is no settled convention here. LinuxGSM, the dominant Linux game-server
tool, defaults to a user's home directory. The choice matters less than the three
properties it buys: not a home directory, per-game subtrees, and room to scope
permissions by depth.

**SteamCMD's own state stays in `/home/steam`.** `~/.steam` and
`~/.local/share/Steam` are per-user bookkeeping — 5 GB of it — and
`+force_install_dir` relocates the game, not the bookkeeping. The home directory
must continue to exist and be writable, the same way `lyly-admin`'s npm cache
needed a home that did not exist.

### 2. One group per game, access scoped by directory depth

```
/srv/games/palworld/pal-chuds/          steam:steam        0755
  └── Pal/Saved/                        steam:palworld     2755   group read
        └── Config/LinuxServer/         steam:palworld     2775   group write
```

Group `palworld`. Membership arrives with the slices that create the users:
`steam` in 1b, `swee` in 1c, `palsave-api` in slice 2. In 1b the group exists with
one member, which is enough — the directories are owned by `steam`, so owner
permissions cover it, and the setgid bit is what matters for what comes later.

This is the `webdeploy` pattern applied one level tighter. `/var/www` is shared by
four principals through one purpose-named group and `2775` setgid directories;
nobody is anybody else. The same shape here, except that **write is granted by
depth rather than by membership**:

- nobody but `steam` writes the binaries — closing the code-execution surface
- `palsave-api` reads saves; nothing else writes them
- `swee` writes config, and only config

The setgid bit is what makes the `/config set` ownership flip harmless. When the
chown back to `steam` fails, the replacement file inherits group `palworld` and
keeps mode `664`, so the game server can still write its own config. **The group
grants access, not the owner** — which fixes the bug rather than papering over it.

swee incidentally gains read on saves and `palsave-api` incidentally gains write
on config. Both are harmless, and splitting into two groups to prevent them would
be more machinery than the risk justifies.

### 3. The palworld unit gets declared by `lychee-ops`

The unit as captured from the host on 2026-09-29, in full, because
`ansible.builtin.template` writes the file wholesale and anything live but
unrecorded would be silently dropped — with no symptom until the next deliberate
restart, since this role has no restart handler:

```
[Unit]
Description=Palworld Dedicated Server
Wants=network-online.target
After=network-online.target

[Service]
User=steam
WorkingDirectory=/home/steam/palworld/pal-chuds
ExecStart=/home/steam/palworld/pal-chuds/PalServer.sh -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS
Restart=on-failure
RestartSec=15

[Install]
WantedBy=multi-user.target
```

No `Type=`, `Environment=`, `LimitNOFILE=`, `TimeoutStopSec=` or `ExecStartPre=`.
Everything above is carried into the template; the only lines that change are the
two paths.

Both paths change in the relocation, so the unit must be edited regardless. Edited
by hand, the new layout would exist only on the host, recorded nowhere and
self-correcting never — the condition this project's CLAUDE.md describes as
"prose is not enforcement," applied to a systemd unit.

The performance flags come from a `group_vars` variable rather than being
hardcoded, so tuning them stays a one-line change — a committed one, applied
within a tick.

**Enablement is a task, not a handler**, and this is the one place the role must
differ in shape from `swee_host`. Every other role in `lychee-ops` enables what it
declares by riding `enabled: true` on its restart handler; this role has no
restart handler to ride, and that absence is the point of it. A handler notified
by the template task fires only on a tick where the unit's bytes change, which
asserts *enabled as of the last edit* rather than *enabled*. Two routes then reach
the failure that enabling exists to prevent: someone runs `systemctl disable` and
nothing undoes it, or someone hand-edits the live unit to the relocated paths
while troubleshooting, after which the template renders byte-identical, reports
`ok`, and notifies nothing. Both leave the unit present and unenabled, which
surfaces only at a reboot the server does not come back from.

`enabled: true` carries **no `state:` key** — `state:` is the field that would
start or restart the service, and its absence is what lets enablement be
reasserted every tick without ever touching the running process. Do not model this
on `roles/reconciler`'s timer task, which carries `state: started`.

### 4. swee gets its own user, `/opt/swee` and `/var/lib/swee`

Carried forward from the superseded spec, where it remains correct.

A `swee` system user: `nologin`, own primary group, supplementary membership in
`adm` and `palworld`. Not `sudo`, not `steam`.

| path | contents | owner, mode |
|---|---|---|
| `/opt/swee` | checkout, `.venv`, `.env`, deploy markers | `swee:swee`, `0750` |
| `/var/lib/swee` | the five state files, `deploy-status.json` | `swee:swee`, `0750` |

The five state files use **relative paths**, so they follow the unit's
`WorkingDirectory`; pointing it at `/var/lib/swee` moves them with **no change to
swee's code**. That works because `load_dotenv()` searches from the calling
module's directory rather than the process's working directory — verified by
probe, including the edge that makes it interesting: it falls back to the working
directory when `__main__` has no file, as under `python -c`. swee is launched as
`python /opt/swee/main.py`, a real file.

The deploy markers stay in `/opt/swee`, because they are recreatable and because
`lyly_admin_app` keeps its equivalent in `app_install_dir`.

**The venv cannot be moved.** `python3 -m venv` bakes absolute paths into its
scripts. It must be recreated — which matters because `swee_app`'s
`Install dependencies` installs into a venv, it does not create one.

**`PIP_CACHE_DIR`** gets set on that task, for the reason CLAUDE.md already
records about `npm_config_cache`: the mitigation is the environment variable, not
a home directory someone created by hand.

### 5. `steamcmd` runs behind a no-argument wrapper

`/usr/local/sbin/swee-update-palworld`, root-owned `0700`, declared by
`lychee-ops`. No arguments; the command is hardcoded and runs as `steam`:

```
steamcmd +force_install_dir <dir> +login anonymous +app_update <app id> validate +quit
```

Every argument in swee's invocation already comes from configuration rather than
from Discord input, so the wrapper can hardcode all of it and the grant can be
`NOPASSWD: /usr/local/sbin/swee-update-palworld` — no wildcards, nothing
attacker-influenced. Identical in shape to `lyly-admin`'s three wrappers.

swee changes one call to invoke it through sudo. Output still reaches Discord;
sudo passes stdout through.

Note that the group model does **not** grant swee write on the install, so the
wrapper is the only path by which swee can update the server. That is deliberate:
it is the one capability that genuinely requires being `steam`, and it is
mediated rather than granted.

### 6. `/update` is broken today, and this fixes it

`/etc/sudoers.d/swee-palworld-restart` grants exactly one verb:

```
steam ALL=(root) NOPASSWD: /usr/bin/systemctl restart palworld-palchuds
```

But `server_update.py` calls `sudo systemctl stop` and `sudo systemctl start`.
A non-interactive process with no tty cannot satisfy sudo's prompt, so both fail,
and `proc.wait()` does not check. The flow therefore: saves the world, **fails to
stop the server silently**, runs `steamcmd +app_update validate` **against a
running server**, fails to start it silently, then polls for it coming online —
which succeeds immediately, because it never went down — and reports success.

The new grant covers `stop`, `start` and `restart`, and swee's change checks the
stop's return code and aborts rather than proceeding into the dangerous part.
Migrating a grant known to be too narrow into a new user would be knowingly
shipping the bug forward.

### 7. The human migrates; the reconciler declares the steady state

Following the precedent that the reconciler does not create `/opt/lyly-admin` or
its `.env`, because it cannot bootstrap its own preconditions. A one-time
migration inside a five-minute loop needs a guard that cannot misfire, and the
failure mode is losing irreplaceable data.

## Decomposition

Each slice leaves the host working. **The implementation plan that follows this
spec covers 1b only** — 1c and slice 2 get their own, for the reason 1b exists
separately at all: a mistake near the game saves should not share a change with an
identity migration.

### 1b — the foundation

**Complete, 2026-09-30** — see *What the 1b migration turned up* below.

Relocate Palworld to `/srv/games/palworld/pal-chuds`; create the `palworld` group
and the setgid layout; declare the unit in `lychee-ops`.

**swee and `palsave-api` keep running as `steam` throughout**, against updated
paths in their own configuration — concretely, `PALWORLD_INSTALL_DIR` and
`PALWORLD_SETTINGS_INI_PATH` in swee's `.env`, and whatever `palsave-api` uses to
find the save directory. Both are part of this slice: the relocation is not
complete until every consumer points at the new path. No identity changes. This isolates the risky
part — moving 9.7 GB including irreplaceable saves — from everything else, and it
is the slice where a mistake costs the most.

### 1c — swee's identity

The `swee` user, `/opt/swee`, `/var/lib/swee`, the `steamcmd` wrapper, the
`/update` fix, and the `group_vars` changes that follow from them. Straightforward
by this point, because the access problem was solved by layout rather than by
grants.

Ordering within it is forced: `lychee-ops` declares the wrapper and the new grants
first, naming **both** `steam` and `swee` while swee still runs as `steam`; then
swee's code change ships through a release and a pin bump; then the migration;
then the grants narrow and the old drop-in is declared absent. `/update` works at
every step.

### 2 — `palsave-api`, and retiring `steam`'s blanket root

> **Superseded by `2026-10-01-palsave-api-identity-design.md`**, which carries the full
> design. What follows is the sketch that document was written from, kept because its
> framing of the problem is still right. Two things it gets wrong, both corrected there:
> `palworld` membership alone does **not** grant read on the saves today — five
> directories between `Saved` and the backup rotation are `0700 steam:steam` — and the
> blanket-root removal is blocked by more than the hand-managed unit.

The same treatment, inheriting the pattern. `palsave-api`'s own needs are narrower:
read on saves, no wrapper, no game-config write. This is where the managed-services
spec's container-service work begins, and the layout will already be in place.

**It also has to carry a finding slice 1c surfaced on its last day**, because
`palsave-api` is the only thing still blocking it.

#### `steam` has passwordless root, and has had since July

```
/etc/sudoers.d/steam-nopasswd:  steam ALL=(ALL) NOPASSWD: ALL
```

Not the `sudo` group — `steam` is in that too, but its password is locked (`passwd -S
steam` returns `L`), which is why an earlier pass through this material dismissed the
membership as inert. That was true about the group and answered the wrong question.
This is a separate drop-in, and `NOPASSWD` makes the locked password irrelevant: any
process running as `steam` is one `sudo` away from root with no authentication.

The Palworld dedicated server runs as `steam`, on a public tunnel. So does
`palsave-api`. Until 2026-10-01 so did `swee` — which means the four-command grant
slice 1c built for it was decorative until the identity moved, and moving it is what
made that grant mean anything.

#### What actually depends on it — evidenced, not inferred

Every `sudo` invocation by `steam` in the journal, which retains back to 2026-07-14,
before either service was installed:

| | |
|---|---|
| `systemctl stop\|start\|restart palworld-palchuds` | 13 — all swee, all now granted to `swee` explicitly |
| `/usr/local/sbin/swee-update-palworld` | 1 — the first `/update` after the fix |
| `visudo -cf`, `install -m 440 … /etc/sudoers.d/`, `tee … .service`, `systemctl enable`, `daemon-reload` | the July bootstrap, `deploy/setup.sh` |
| `cat`, `nano scratch_diagnose_queenbee.py` | a human, once |

**Nothing at runtime.** No service running as `steam` has used root for anything but
those palworld commands, across the entire history of both services on this host.
A `grep` for `sudo` across `palsave-api` finds hits only inside its `deploy/setup.sh`;
the application never shells out to root.

So the blanket grant exists to bootstrap itself — `setup.sh` needed root to install
the sudoers file that grants root, so it was given root to grant itself root, and the
shortcut outlived the bootstrap by two months. The July timestamps on the two drop-ins
are minutes apart: one grants a single command, the other grants everything.

`/etc/sudoers.d/palsave-api-self-restart` is dead too. It exists for `setup.sh:107`'s
`systemctl restart palsave-api`, the CI-deploy path — and that runner was deleted on
2026-09-28. The command appears **zero** times in the journal.

#### Why this cannot be done before slice 2

`palsave-api`'s unit is still hand-managed, so `setup.sh` is still the only thing that
installs it. Removing `steam-nopasswd` means that script can no longer be run as
`steam` — and it cannot simply be run as `byron` instead, because it derives its
sudoers lines from `$USER` and would write grants for the wrong account.

Once the reconciler owns `palsave-api`'s unit and grants, nothing on this host needs
`setup.sh`, and both drop-ins get declared absent — the same move that retired
`/etc/sudoers.d/swee-palworld-restart` in slice 1c. Declared absent rather than
deleted once, because deleting an example from a source repo does nothing to a host
that already has the file installed.

#### What `steam` should end up with

Nothing, most likely. The game server is a systemd unit that needs no privilege of its
own; `swee` holds the four commands it needs under its own identity. If that proves
wrong, the grant is written narrow and declared, not restored as a blanket.

Also worth correcting while there: `steam-nopasswd` is mode `0640` where every other
drop-in on the host is `0440`, and `steam` is a member of `adm` and `sudo` as well as
`palworld`.

## Migration and verification

**Two preconditions to establish before anything moves**, because they decide
what the move even is:

- **Is `/srv` on the same filesystem as `/home`?** If it is, `mv` is a rename —
  instant, atomic, no extra space. If it is not, it is a 9.7 GB copy needing that
  much free space and a much longer window. `df /home /srv` answers it, and the
  answer changes the operator steps rather than a design decision.
- **Saves are backed up independently first.** Not as a general precaution: this
  is the only step in the whole arc that touches irreplaceable data, and a
  cross-filesystem copy that fails halfway leaves two partial trees.

**Copy, never move**, wherever the data is small enough — `/home/steam/swee` stays
intact through 1c so rollback is reverting one commit. The 9.7 GB game install is
the exception: copying needs the space and doubles the window in which two trees
could diverge. It moves, after the server is stopped and after saves are backed up
independently.

Each grant fails separately, so verification is a matrix:

| check | proves |
|---|---|
| game server starts and accepts players | the relocation and the unit |
| saves load | the data survived |
| `/config get` | group read through the new path |
| `/config set` | **group write and the setgid inheritance** |
| join/leave relay posts | `adm` — journal tailing |
| `/restart` | the systemctl grant |
| `/update` | the wrapper, after 1c |
| `palsave-api` still serves | its own read path |

`/config set` is the one to watch: it is the only check that exercises setgid
inheritance and the ownership flip together, and it is the mechanism that replaced
the ACL.

## What the 1b migration turned up (2026-09-30)

Executed and verified end to end. The guard held — `palworld_host` ticked for
roughly an hour against a host where `/srv/games/palworld/pal-chuds` did not yet
exist, and the live unit still read `/home/steam` when the operator began, which
is the inertness property no off-host test can establish. After the move: the
permission chain reads `0755 → 2755 → 2755 → 2755 → 2775` with the group-write bit
appearing exactly once; three consecutive ticks reported every task `ok` with
nothing `changed`; and a `/config set` from Discord left
`PalWorldSettings.ini` as `steam:palworld 664`. That last check is the design in
one line — swee runs as `steam`, whose primary group is `steam`, so a file it
creates would be `steam:steam` by default. The group reading `palworld` on a
brand-new inode is setgid inheritance overriding that, which is the whole
mechanism the superseded ACL design was reaching for.

Three things the migration found that this spec did not anticipate:

**`/srv/games` and `/srv/games/palworld` are undeclared.** The role declares
`palworld_install_dir` and everything below it; the two levels above are whatever
the operator's `mkdir -p` produced — `root:root 0755`. Traversal works and nothing
enforces it, so `chmod 0750 /srv/games` would break the server with no tick to
correct it. This is the same finding review raised about `Pal` and
`Pal/Saved/Config`, one level higher, and it lands in slice 2: the moment
`games_root` holds a second game, those levels stop being incidental.

**There was a second Palworld instance nobody had recorded.**
`/home/steam/palworld/sandbox`, 4.9 GB, downloaded 2026-07-15 and never started —
no `Pal/Saved`, no unit, no consumer configuration referencing it. Deleted during
the migration. It is worth recording not for its own sake but because this spec's
Problem section reasoned about `/home/steam` from a listing that included it and
treated it as one instance. The `palworld_root`/`palworld_instance` split in
`group_vars` already anticipates multiple instances; what was missing was knowing
there already were two.

**swee's `GITHUB_REPO` still named the pre-rename org.** Its release ticker had
been raising `HTTPStatusError: 301 Moved Permanently` every cycle since
`lychee-home` became `LycheeHome`, because GitHub redirects renamed orgs to a
canonical repository-ID URL and `httpx` does not follow redirects by default.
Fixed in `.env` and `.env.save`. Unrelated to the relocation and found only
because restarting swee for a different reason put the traceback at the top of the
log — the failure was silent, recurring, and had no detector. The org name is
copied into swee's `.env`, `.env.save`, `.env.example` and its documentation, with
nothing comparing them; a sweep belongs in 1c, which touches swee's configuration
anyway.

Note that the steamcmd-state question is **not** among these: Decision 1 already
settles it. `~/.steam` and `~/.local/share/Steam` stay in `/home/steam` because
`+force_install_dir` relocates the game and not the bookkeeping, and 1c inherits
that decision rather than reopening it.

## Corrections to earlier documents

- **`2026-09-28-versioning-design.md`** says running as `steam` "is what lets it
  restart the palworld unit, run `steamcmd` against the game install, and read
  `PalWorldSettings.ini`", and that a dedicated user "needs each of those granted
  back explicitly". The restart is a sudoers line; the settings file is read
  **and written**, which that text misses; and the `steamcmd` write is not granted
  back at all under this design.
- That spec also lists state files the move "must carry" without noting that the
  venv **cannot** be carried.
- **`2026-09-25-managed-services-design.md`** describes `palsave-api` as deployed
  by hand, which is true, but does not record that it shares the `steam` identity
  with two other programs.
- **This document's own superseded predecessor**, and the reasoning that produced
  it, recorded that `steam`'s membership of the `sudo` group "grants nothing"
  because `passwd -S steam` returns `L`. That is true of the **group** — `%sudo
  ALL=(ALL:ALL) ALL` needs a password the account cannot supply — and it answered
  the wrong question. Nobody looked in `/etc/sudoers.d/`, where
  `steam-nopasswd` grants `steam ALL=(ALL) NOPASSWD: ALL`, and `NOPASSWD` makes a
  locked password irrelevant. The correction was published as a correction, which
  made it read as settled: the shape to recognise is a narrow check whose negative
  result gets generalised into a broad conclusion. See slice 2 above.

## What this does not do

- **No systemd sandboxing.** Declined; `NoNewPrivileges` conflicts with the sudo
  calls.
- **No reconciler-managed users or groups.** Still manual, consistent with
  `lyly-admin`. The later slice CLAUDE.md anticipates still applies.
- **No change to what swee does**, beyond how it invokes `steamcmd` and checking a
  return code it was ignoring.
- **No `lyly-admin` bot-management UI.** The layout is designed so that work is
  possible; none of it is built here.
- **`/home/steam/swee` is not deleted** by 1c — only after a soak.
