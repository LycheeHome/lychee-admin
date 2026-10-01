# palsave-api identity, and retiring `steam`'s blanket root — design

**Status:** approved, not yet implemented.
**Supersedes nothing.** Extends `2026-09-29-service-identities-and-game-layout-design.md`,
whose slice 2 section this replaces with a full design. Slices 1b and 1c are complete
and verified on the host; this is the last of the three services.

## Problem

`palsave-api` is the third and last tenant of the `steam` identity. It runs as `steam`
out of `/home/steam/palsave-api`, which means it shares a user with the Palworld
dedicated server — and with a sudoers drop-in nobody had looked at.

### `steam` has passwordless root

```
/etc/sudoers.d/steam-nopasswd:  steam ALL=(ALL) NOPASSWD: ALL
```

Not the `sudo` group. `steam` is in that too, but its password is locked (`passwd -S
steam` returns `L`), which is why an earlier pass dismissed the membership as inert —
true of the group, and the wrong question. `NOPASSWD` makes a locked password
irrelevant: any process running as `steam` reaches root with no authentication.

The game server runs as `steam` on a public Cloudflare tunnel. `palsave-api` runs as
`steam`. Until 2026-10-01 `swee` did too, which means the four-command grant slice 1c
built for it was decorative until the identity moved — and moving it is what made that
grant mean anything. `palsave-api` is the last one holding the shortcut in place.

### `palsave-api`'s state lives inside its own checkout

`config.py` sets `ARCHIVE_DIR = Path("snapshots")` and `STATE_PATH = Path("state.json")`
— **relative paths**, so they resolve against the process's working directory, which
today is the checkout. Any deploy that syncs the repo over that directory destroys the
snapshot archive and the watcher's position in the backup rotation.

This is the identical shape slice 1c found in `swee`'s five state files, and it has the
identical fix.

### A native artifact that is not in git

`ooz/bin/libooz.so` is built on the host; only `ooz/bin/.gitkeep` is tracked. Without it
Oodle-compressed (`PlM`) saves cannot be decompressed — zlib (`PlZ`) ones still work, so
the service degrades rather than failing. A deploy that force-checks-out the repo would
delete it, and nothing would rebuild it.

## What investigation established

Recorded because several of these reversed an assumption, and the reversals are the
load-bearing part.

**`palsave-api` needs no privilege whatsoever.** A grep across the repo for
`subprocess`, `sudo`, `systemctl` and `journalctl` finds hits only inside
`deploy/setup.sh`. The service itself never shells out. It is the first of the three
services to need no sudoers entry at all.

**It reads the save tree and never writes to it.** `watcher.py`'s `archive_snapshot`
does `shutil.copy2(sav_path, dest)` — reads the game's backup, writes into its own
archive. `prune_snapshots` globs and unlinks only within `archive_dir`. So read-only
access is sufficient, and the earlier sketch's "read on saves" is correct for a reason
now checked rather than assumed.

**The permission chain blocks at five fixed directories, and only those.**

```
drwxr-sr-x steam palworld  Saved                 ← slice 1b's declarations end here
drwxr-xr-x steam steam     SaveGames             ← group reverted to steam, no setgid
drwx------ steam steam     0
drwx------ steam steam     <world-guid>
drwx------ steam steam     backup
drwx------ steam steam     world
drwxr-xr-x steam steam     2026.10.01-14.59.41   ← the hourly rotation: already 0755
-rw-r--r-- steam steam     Level.sav             ← already 0644
```

The first read of this was alarming and wrong: a `sudo ls -ld .../world/*/` returned "No
such file or directory", suggesting the backup rotation was empty. The glob was expanded
by the invoking user's shell, which cannot traverse `world` at `0700`, so it matched
nothing and was passed through literally. The rotation is healthy and hourly.

What that means: `UMask=0022` on the game server's unit **is** being honoured for
everything created on rotation. Only the five fixed components — created once at world
setup in July — are `0700`, which the game sets explicitly rather than inheriting. So
this is a **one-time** fix to five directories, not an ongoing battle with a live writer.
No `UMask=` change on the game server, and no ACLs.

**Nothing at runtime has ever used `steam`'s blanket root.** Every `sudo` invocation by
`steam` in the journal, which retains to 2026-07-14 — before either service was
installed — is either one of the palworld `systemctl` commands (13, all swee, all now
granted to `swee` explicitly), the wrapper (1, slice 1c's first `/update`), or the July
bootstrap: `visudo -cf`, `install -m 440 … /etc/sudoers.d/`, `tee … .service`,
`systemctl enable`, `daemon-reload`. Plus a human reading files once.

The blanket grant exists to bootstrap itself. `deploy/setup.sh` needed root to install
the sudoers file that grants root, so it was given root to grant itself root, and the
shortcut outlived the bootstrap by two months.

**`/etc/sudoers.d/palsave-api-self-restart` has never been used.** It grants `steam` one
command, `systemctl restart palsave-api`, for `setup.sh:107`'s CI-deploy path. That
runner was deleted on 2026-09-28. The command appears zero times in the journal.

**There are no releases.** The pinned-tag model slice 1a built, and `swee` now uses,
needs release tooling added to `palsave-api` before it can be pointed at anything.

## Goals

- `palsave-api` runs as its own user, with read on the saves and nothing else.
- Its state and its native artifact survive a deploy by construction, not by a flag.
- One deploy model on this host, not two.
- `steam` ends with **no sudo at all**.

## Decisions

### 1. `palsave-api` gets its own user, and no sudo

A `palsave-api` system user: `nologin`, own primary group, supplementary membership in
`palworld` only. Not `adm` — it reads no journals. Not `sudo`. **No sudoers drop-in is
created for it**, because it needs none, which makes it the cleanest of the three
services and is worth stating rather than leaving as an absence.

| path | contents | owner, mode |
|---|---|---|
| `/opt/palsave-api` | checkout, `.venv`, `.env`, deploy markers | `palsave-api:palsave-api`, `0750` |
| `/var/lib/palsave-api` | `snapshots/`, `state.json`, `lib/libooz.so` | `palsave-api:palsave-api`, `0750` |

`WorkingDirectory=/var/lib/palsave-api` and `ExecStart` reading from `/opt/palsave-api`,
exactly as `swee` now does. The relative paths in `config.py` then resolve into the state
directory with **no code change**, and the reconciler can rewrite the install directory on
every pin bump without touching the archive.

### 2. `libooz.so` moves out of the deploy tree

`decompress.py` takes an absolute path — `/var/lib/palsave-api/lib/libooz.so` — from
configuration rather than resolving relative to the repo.

The alternatives were considered and rejected. Excluding `ooz/bin` from the sync makes
the artifact's survival a property of an Ansible flag rather than of the layout: it holds
until someone edits the task, and no test would notice. Committing the built `.so` puts an
opaque binary in git and ties the repo to one architecture. Building it during deploy is
reproducible but needs a toolchain on the host and lets a build failure block a service
that would otherwise run fine on zlib saves.

Putting it beside the state is the same reasoning that puts the state where it is: the
things that must survive a deploy live somewhere the deploy does not write.

### 3. The permission chain gets declared, five rows deeper and two rows higher

`palworld_host`'s existing loop extends to cover `SaveGames`, `0`, `<world-guid>`,
`backup` and `world` as `steam:palworld` with setgid and group read+execute — and, at the
other end, `/srv/games` and `/srv/games/palworld`, which slice 1b's migration left as
`root:root 0755` from an operator's `mkdir -p` with nothing enforcing them.

The world GUID is pinned in `group_vars` the way `palworld_instance` is. **This pins the
declaration to one world**: a new world would create a fresh `0700` GUID directory that
nothing covers, and `palsave-api` would stop seeing backups with no error — it polls a
directory, and an empty directory is indistinguishable from a quiet one. That limitation
is accepted rather than solved, and is recorded here so it is recognisable.

### 4. Deployment moves to the pinned-release model

Add `release-please` and a CI job named `test` to `palsave-api`, then pin
`palsave_api_version` in `lychee-ops` `group_vars`, gated on that job exactly as `swee` is.
Promotion is a commit; rollback is a revert.

The alternative of pinning a commit SHA needs no release tooling but loses the
human-readable version and the changelog, and diverges from `swee` for no reason beyond
avoiding setup. Tracking `main` deploys on merge, which is the model slice 1a deliberately
moved `swee` away from.

The job name `test` is load-bearing for the same reason it is in the other two repos: the
gate matches a **job** name, and a rename silently stops every deploy while reporting
`no job named test`, which reads like CI never ran.

### 5. The port moves off 8787

`lyly-admin` listens on the LAN interface at `8787`; `palsave-api` on `127.0.0.1:8787`.
They coexist because the addresses differ, and `lyly-admin`'s CLAUDE.md records the
hazard: if its `HOST` ever fell back to loopback, its health check would hit
`palsave-api`, get a `404`, and report a failed deploy for a perfectly healthy app. It
fails in the safe direction and diagnoses terribly.

`PALSAVE_API_PORT` is already an environment variable with a default, and `swee` addresses
the service through `PALFEED_SERVICE_URL` in its own `.env` — so this costs two `.env`
lines and a restart. **No swee release and no pin bump**, which is the fact that made
doing it here rather than later the cheap option.

### 6. Both `steam` drop-ins are declared absent

Once the reconciler owns `palsave-api`'s unit, nothing on this host runs `setup.sh`, and
`steam-nopasswd` has no remaining caller. `palsave-api-self-restart` already has none.

Declared absent rather than deleted once, for the reason slice 1c's retirement of
`/etc/sudoers.d/swee-palworld-restart` gives: deleting an example from a source repo does
nothing to a host that already has the file installed.

`steam` should end with nothing. The game server is a systemd unit that needs no privilege
of its own. If that proves wrong, the grant is written narrow and declared, never restored
as a blanket.

## Decomposition

Four phases. The ordering is forced by one requirement — **`palsave-api` keeps serving
`/events/new-pals` at every step** — and by the rule slice 1c established: separate "did
the deploy mechanism work" from "did the identity change work", so a failure points at one
thing.

### A — `palsave-api` repo

Absolute `libooz.so` path, port from configuration, `release-please`, a `test` CI job. Cut
a release. No host impact; nothing deployed yet.

### B — `lychee-ops` declares, without changing identity

The unit, the pinned tag, and the permission chain — **while `palsave-api` still runs as
`steam` from `/home/steam/palsave-api`**. Deployment moves to the reconciler; the identity
does not change.

Declaring the permission chain here rather than in C is deliberate: it means a `palworld`
member's ability to read the backups can be tested while the service is still running as
the owner, so a wrong answer costs nothing.

### C — the migration

Create the user and directories, move code and state, rebuild the venv, place
`libooz.so`. Then `lychee-ops` switches identity and port, and `swee`'s `.env` gets the new
URL. This is the slice's risky step and it is alone in its phase.

### D — retirement

`steam-nopasswd` and `palsave-api-self-restart` declared absent.

## Migration and verification

Two preconditions to establish in phase B, before anything moves:

- **Can a `palworld` member read the backups?** `sudo -u swee cat <newest>/Level.sav >
  /dev/null` — `swee` is already a `palworld` member and already has its own identity, so
  it is a free stand-in for the user that does not exist yet. A failure here means the
  chain declaration is wrong, discovered while nothing depends on it.
- **Does `libooz.so` exist, and where did it come from?** It was built by hand in July.
  The migration moves it; if it cannot be found, it must be rebuilt before phase C, and
  `decompress.py`'s module docstring carries the command.

**Verification matrix** — each row fails separately:

| check | proves |
|---|---|
| `systemctl show palsave-api -p User,WorkingDirectory` | the identity and the state directory |
| `ps -o user=,cmd= -C python \| grep palsave` | it is really running as `palsave-api`, not merely declared to |
| `curl -s localhost:<new-port>/events/new-pals?since=0&limit=1` | it serves, on the new port |
| swee's palfeed posts a catch | **the whole chain** — swee's `.env`, the port, the read path, the diff |
| `sudo ls -la /var/lib/palsave-api/snapshots/ \| tail` | the archive is being written in the new location |
| `sudo cat /var/lib/palsave-api/state.json` | the watcher's position survived the move |
| a new rotation folder appears and is processed within ~60s | reading the game tree as a non-owner works |
| `sudo -u steam sudo -n -l` | **nothing listed** — the blanket root is gone |

The palfeed row is the one to watch. Everything else can pass while the service quietly
reads an empty directory, because polling a directory cannot distinguish "nothing new"
from "cannot see anything". Waiting for a real catch to appear is the only check that
exercises the full path.

**Rollback**, at any point: stop the service, restore `/etc/systemd/system/palsave-api.service`
from the copy taken in phase C step 0, revert the `lychee-ops` commit, apply, start.
`/home/steam/palsave-api` is copied rather than moved and stays intact throughout, the way
`/home/steam/swee` did.

## Corrections to earlier documents

- **`2026-09-29-service-identities-and-game-layout-design.md`**'s slice 2 section says
  `palsave-api`'s needs are "read on saves, no wrapper, no game-config write". Correct,
  and it omits that `palworld` membership alone does **not** grant that read today: five
  directories between `Saved` and the backup rotation are `0700 steam:steam`, so the
  service reads them only by being the owner.
- That document also records the blanket-root finding but describes the fix as blocked
  only by `palsave-api`'s unit being hand-managed. Also true, and incomplete: the port
  collision and the permission chain are both in the same blast radius and are cheaper to
  do together than separately.

## What this does not do

- **No container work.** `2026-09-25-managed-services-design.md` anticipates
  `palsave-api` becoming a container service. That remains a later change; this slice is
  identity and deployment only.
- **No change to what `palsave-api` does.** The watcher interval, the diff logic and the
  API surface are untouched.
- **No second-world support.** The declaration pins one world GUID. See Decision 3.
- **`/home/steam/palsave-api` is not deleted.** It is the rollback, and its removal is a
  separate deliberate act — as `/home/steam/swee`'s still is.
