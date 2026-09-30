# swee identity separation — design

> **SUPERSEDED the same day by `2026-09-29-service-identities-and-game-layout-design.md`.**
> Its central mechanism was wrong: this document treats `PalWorldSettings.ini` as
> a read and designs an ACL granting traversal, but `/config set` **writes** that
> file, and the ACL would have broken it. It also cites `steam`'s `sudo` group
> membership as the strongest argument for separation; that membership is inert,
> because the account's password is locked. And it was written before
> `palsave-api` was found to be a third tenant of the same identity.
>
> Kept rather than deleted, because the reasoning is the record of how the ACL
> approach was reached and why it failed — and because the enumeration of what
> swee actually needs is still correct and still load-bearing in its replacement.


Date: 2026-09-29
Status: design approved; spec pending review
Implements slice 1b of `2026-09-25-managed-services-design.md`, and corrects
three claims in it and in `2026-09-28-versioning-design.md`

## Problem

`swee` runs as `User=steam` out of `/home/steam/swee` — the Palworld server's
own account and home directory. Two unrelated programs share one identity.

The versioning spec described this as a mutual-inheritance problem: a compromise
of a network-exposed game server running mods inherits swee's Discord token, bot
admin powers and GitHub token, and the converse. That is true, and investigation
made it worse in one respect and much better in another.

**Worse: `steam` is in the `sudo` group.** `id steam` reports
`groups=1001(steam),4(adm),27(sudo)`. So swee's credentials do not merely sit
beside a game server's — they sit in an account with a path to root. Not directly
exploitable by a non-interactive process with no password, but it reframes the
separation from tidiness to something worth doing.

**Better: the coupling is almost entirely incidental.** The versioning spec
asserted that running as `steam` "is what lets it restart the palworld unit, run
`steamcmd` against the game install, and read `PalWorldSettings.ini`", and
concluded that a dedicated user "needs each of those granted back explicitly".
Enumerating what swee actually touches shows six of seven needs are a group, a
sudoers line, or a file mode:

| need | actual requirement |
|---|---|
| `journalctl -u palworld-palchuds` | `adm` group |
| `/var/log/unattended-upgrades/*` | `adm` group |
| `sudo systemctl …` the game unit | a sudoers line naming the user |
| `/proc/stat`, `/proc/meminfo` | nothing — world-readable |
| the five state files | relative paths; they follow the working directory |
| `PalWorldSettings.ini` | read access — see the traversal problem below |
| `steamcmd` against `PALWORLD_INSTALL_DIR` | **write access to the game install** |

Only the last is genuinely entangled with being `steam`, and this design does not
grant it back.

### A defect found while enumerating: `/update` is broken

`/etc/sudoers.d/swee-palworld-restart` contains exactly one line:

```
steam ALL=(root) NOPASSWD: /usr/bin/systemctl restart palworld-palchuds
```

`restart` only. But `swee/server_update.py` calls `sudo systemctl stop` and
`sudo systemctl start`. A non-interactive process with no tty cannot satisfy
sudo's password prompt, so both fail — and `proc.wait()` does not check the
return code. The `/update` flow therefore:

1. saves the world — works
2. **fails to stop the server, silently**
3. runs `steamcmd +app_update … validate` **against a running server**, rewriting
   files it holds open
4. fails to start it, silently — it never stopped
5. polls for the server coming online, which succeeds immediately, and reports
   the update as successful

This design fixes it, because it is already rewriting that grant and that code
path, and migrating a grant known to be too narrow into a new user would be
knowingly shipping the bug forward.

### The traversal problem

`PalWorldSettings.ini` is mode `664` — world-readable. But it lives under
`/home/steam`, which is `750 steam:steam`. A permissive file behind a
non-traversable path is unreachable, so a new user outside the `steam` group
cannot read it, and restart-cause detection plus every `/config` slash command
would degrade silently.

The obvious fix is the wrong one. Adding the new user to the `steam` group grants
traversal, but `/home/steam/palworld` and `pal-chuds` are both `775` —
**group-writable** — so it would also grant write access to the entire game
install, which is exactly what this design exists to remove.

## Goals

1. **The shared identity is itself the defect.** Not a directional threat model:
   two unrelated programs sharing one account is wrong regardless of which
   direction an attack is imagined to run, and arguing direction is how a
   separation ends up half-done.
2. **Consistency with the `/opt` convention** established by `lyly-admin`.

Explicitly not a goal: systemd sandboxing of the unit. It was considered and
declined for this slice — `NoNewPrivileges` in particular fights the sudo calls
swee makes, so it is not the free addition it appears to be while the unit is
already being rewritten.

## Decisions

### 1. Code in `/opt/swee`, state in `/var/lib/swee`

Mirrors `lyly-admin`'s split. The five state files use **relative paths**, so
they follow the unit's `WorkingDirectory`; setting it to `/var/lib/swee` moves
them with **no change to swee's code**.

That works because `load_dotenv()` is called with no argument from
`swee/config.py`, and python-dotenv searches from the calling module's directory
rather than the process's working directory. Verified by probe rather than
assumed, including the edge that makes it interesting: the search falls back to
the working directory when `__main__` has no file, as under `python -c`. swee is
launched as `python /opt/swee/main.py`, a real file, so the caller-relative path
applies. If that ever changes, the failure is loud — required variables missing
at import.

The alternative of leaving state in the checkout was rejected because
`player_history.json` is accumulated, irreplaceable history, and the checkout is
a directory the reconciler runs `git reset --hard` over on every deploy. It
survives that today, since reset does not remove untracked files, but a
`git clean` or a recovery re-clone would destroy it silently. The deploy markers
(`.deployed-tag`, `.deployed-sha`, `.failed-tag`) stay in `/opt/swee`, because
they are recreatable and because `lyly_admin_app` keeps its equivalent in
`app_install_dir`.

### 2. `steamcmd` runs behind a no-argument wrapper

`/usr/local/sbin/swee-update-palworld`, root-owned `0700`, declared by
`lychee-ops`. It takes **no arguments** and runs the hardcoded command as `steam`:

```
steamcmd +force_install_dir <dir> +login anonymous +app_update <app id> validate +quit
```

Every argument in swee's invocation already comes from configuration rather than
from Discord input, so the wrapper can hardcode all of it and the sudo grant can
be `NOPASSWD: /usr/local/sbin/swee-update-palworld` — no wildcards, nothing
attacker-influenced. Identical in shape to the three wrappers `lyly-admin`
already uses.

swee changes one call, from `create_subprocess_exec(STEAMCMD_PATH, …)` to
invoking the wrapper through sudo. Output still reaches Discord, since sudo
passes stdout through.

Two alternatives were considered and rejected. A wrapper reached through
`STEAMCMD_PATH` that validates the arguments it is handed avoids the code change,
but duplicates the install directory and app ID between swee's `.env` and the
wrapper, leaving an assertion as the only thing keeping them honest. Deferring
`steamcmd` and granting the new user group write access to the install as a
stopgap re-couples precisely what this design separates, and stopgaps of that
kind become the arrangement.

The cost is real and accepted: a swee code change now means a feature PR, a
release PR, and a pin bump in `lychee-ops` — three merges before the migration
can begin. It buys the only option where swee's own source says what swee does.

### 3. Read access comes from an ACL, not a group

```
setfacl -m u:swee:x /home/steam
```

Traversal for one named user — execute without read, so swee can reach a known
path but cannot enumerate the directory. Everything below is already `775` and
the file is `664`, so swee reads it directly: no sudo, no latency, and no audit
entry per `/config` invocation.

Rejected alternatives: the `steam` group grants write on a `775` install;
loosening `/home/steam` to `0751` grants traversal to every account on the host
rather than one; a wrapper that reads the file for swee puts a privilege
escalation on an interactive command path, since `config_commands.py` reads it on
every `/config`.

`ansible.posix` is already declared in `requirements.yml`, so the ACL is
declarable by the reconciler rather than being something a human did once.

### 4. The human migrates; the reconciler declares the steady state

Following the precedent that the reconciler does not create `/opt/lyly-admin` or
its `.env`, because it cannot bootstrap its own preconditions. A one-time
migration inside a loop that runs every five minutes would need a guard that
cannot misfire, and the failure mode is losing accumulated history — the same
shape as the block `when:` re-evaluation that has already produced a Critical in
this project.

## The end state

**A `swee` system user**: `nologin`, own primary group, home `/opt/swee`. Its
only supplementary membership is `adm`. Not `sudo`. Not `steam`.

| path | contents | owner, mode |
|---|---|---|
| `/opt/swee` | checkout, `.venv`, `.env`, deploy markers | `swee:swee`, `0750` |
| `/var/lib/swee` | the five state files, `deploy-status.json` | `swee:swee`, `0750` |

Tighter than `/opt/lyly-admin`'s `2775 lyly-admin:webdeploy`, which is
group-writable because four principals need it. Nothing shares swee's directory.

### Most of the ops change is three variables

The roles were written parameterised, which makes the migration much smaller than
it sounds. `swee_host`'s unit template already renders `User={{ swee_user }}` and
`WorkingDirectory={{ swee_dir }}`, and `swee_app` references `swee_dir`,
`swee_user` and `swee_group` twenty-four times without hardcoding any of them. So
changing `swee_user: steam → swee`, `swee_group: steam → swee` and
`swee_dir: /home/steam/swee → /opt/swee` in `group_vars` moves the deploy, the
unit's identity, the fetch, the marker files and the status file's ownership all
at once.

What that does **not** cover, and must be added:

- **A new `swee_state_dir` variable**, because `WorkingDirectory` must now point
  somewhere other than `swee_dir` — that separation is the whole point, and the
  template currently renders them as the same value.
- The wrapper, the two sudoers drop-ins, the `adm` membership and the ACL, none of
  which exist yet.
- `PIP_CACHE_DIR` on the pip task.

**Declared by the reconciler**, and therefore self-correcting: the unit, both
sudoers drop-ins, the `adm` membership, the ACL, the wrapper, the deploy into
`/opt/swee`, and an absent-declaration for the old drop-in naming `steam`.

**Manual, once**: the user, both directories, the initial clone, the venv, and
`.env`.

### The venv cannot be moved

`python3 -m venv` bakes absolute paths into the scripts it generates, so
`/home/steam/swee/.venv` copied to `/opt/swee/.venv` yields a venv whose shebangs
point at a directory that no longer exists. It must be recreated. This matters
because `swee_app`'s `Install dependencies` task installs into a venv, it does
not create one — the venv is a precondition of the deploy, not a product of it.

### `PIP_CACHE_DIR`

The new user has no populated home and `pip install` wants a cache under `$HOME`.
`lyly_admin_app` already solves the npm form of this with
`npm_config_cache=/var/lib/lychee-ops/.npm` on every npm task, and this project's
CLAUDE.md is explicit that the mitigation is the environment variable and not the
directory — recorded after someone created `/home/lyly-admin` by hand as
belt-and-braces. `swee_app`'s pip task gets `PIP_CACHE_DIR` on the same reasoning.

## Sequencing

The order is forced, and reversing any of it leaves `/update` broken in a new way.

1. **`lychee-ops` declares the wrapper and the new grants**, while swee still runs
   as `steam`. Inert — nothing calls the wrapper yet. **Both** drop-ins must name
   `steam` and the new user during this window: the wrapper grant, so swee can
   call it the moment step 2 ships, and the systemctl grant, because swee is still
   running as `steam` and still needs to stop and start the game server.
2. **swee's code change** — call the wrapper; check the stop's return code and
   abort rather than proceeding to `steamcmd` against a live server. Feature PR →
   release PR → pin bump. The reconciler deploys it to the old location, still as
   `steam`, where it works because of the dual grant.
3. **The migration** — user, directories, venv, `.env`, state files, ACL, unit.
4. **The cleanup** — drop `steam` from the grants, declare the old drop-in absent,
   and after a soak, delete `/home/steam/swee`.

`/update` works at every step: step 1 grants before anything needs it, step 4
revokes after nothing does.

## Scope of the implementation plan

The plan that follows this spec covers the code in both repositories — sequencing
steps 1, 2 and 4. **Step 3, the migration itself, is operator steps**, the same
shape the previous slice used: written out, run by a human, verified against the
matrix below.

`swee`'s `deploy/setup.sh` is untouched. It derives `SWEE_USER` from `whoami` and
installs the palworld grant for whoever runs it, which remains correct for a
standalone install by someone who is not running this reconciler.

## Migration and verification

**Copy, never move.** `/home/steam/swee` stays intact throughout, so rollback is
reverting one `lychee-ops` commit rather than restoring from a backup. It is
deleted after a soak, not during.

Expect a full redeploy during the migration: `/opt/swee` has no `.deployed-tag`,
so the reconciler reads `installed_tag: none`, concludes the pin has moved, and
performs a complete install including the Discord readiness check. That is
desirable — it proves the deploy path works against the new location rather than
assuming it.

Each grant fails independently, so verification is a matrix rather than a single
smoke test:

| check | proves |
|---|---|
| `systemctl show -p User swee` → `swee` | the unit took |
| bot reaches Discord | venv and `.env` |
| join/leave relay posts | `adm` — journal tailing |
| `/config` returns settings | **the ACL** — traversal into `/home/steam` |
| `/restart` | the systemctl grant |
| `/update` | the wrapper and its grant |
| timestamps advance on `/var/lib/swee/*.json` | `WorkingDirectory`, state writable |

`/config` is the likeliest to fail, because the ACL is the newest mechanism and
the least visible — `ls -l` shows only a `+`. `/update` genuinely stops the game
server, so it wants a quiet moment.

## Corrections to earlier documents

- **`2026-09-28-versioning-design.md`** states that running as `steam` "is what
  lets it restart the palworld unit, run `steamcmd` against the game install, and
  read `PalWorldSettings.ini`" and that a dedicated user "needs each of those
  granted back explicitly". Two of those three are a sudoers line and a file
  already at mode `664`; only the `steamcmd` write is real, and this design does
  not grant it back at all.
- That spec also lists the state files as something the move "must carry",
  without noting that the venv **cannot** be carried and must be rebuilt.
- Neither spec recorded that `steam` is in the `sudo` group, which is the
  strongest argument for the separation.

## What this does not do

- **No systemd sandboxing.** Declined for this slice; `NoNewPrivileges` conflicts
  with swee's sudo calls.
- **No user or group declarations in the reconciler.** Creating users remains
  manual, consistent with `lyly-admin`. That belongs to the later slice CLAUDE.md
  already anticipates.
- **No change to what swee does.** The only code change is how it invokes
  `steamcmd` and that it checks a return code it was ignoring.
- **`/home/steam/swee` is not deleted** by this work — only after a soak, as a
  separate deliberate step.
