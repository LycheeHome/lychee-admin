# swee as a container

Date: 2026-10-14. Status: approved design (sections approved in conversation),
awaiting written-spec review. Phase 2 of roadmap sub-project 3, "swee becomes a
container" (`2026-10-12-platform-roadmap-design.md`); phase 1 was
`2026-10-14-swee-off-sudo-design.md`. Spans lychee-contract, lychee-ops,
lychee-resources and swee; lychee-admin is unchanged.

## Why

After phase 1, swee holds no sudo grant and operates the game server only
through lychee-admin's socket. It is still a host service built on the host by
`swee_app` from a pinned git tag, with `adm` membership to read the game
server's journal and the unattended-upgrades log. The roadmap's done-when for
sub-project 3 is **swee's account has no `adm` membership, and releasing swee
is a tag plus Deploy.**

## What swee touches today (read 2026-10-14)

| Need | Today | How |
|---|---|---|
| Game server's output (joins, leaves, chat, shutdown, version) | `journalctl -u palworld-palchuds -f -n 0 -o json` | `adm`; reads `MESSAGE` and `__REALTIME_TIMESTAMP` |
| Why the server went down | last 100 lines of `/var/log/unattended-upgrades/unattended-upgrades.log` | `adm` (directory is `root:adm 0750`) |
| `/config` and `/config set` | read and atomically rewrite `PalWorldSettings.ini` (temp file + rename) | `palworld` group; directory `steam:palworld 2775` |
| Host actions | lychee-admin's socket `/run/lychee-admin/clients/swee/api.sock` | `swee-api` group |
| Game REST API, palsave-api | `127.0.0.1:8212`, `127.0.0.1:8788` | host loopback |
| Secrets (Discord token, REST password, optional GitHub and Anthropic keys) and plain settings | hand-placed `/opt/swee/.env` | file |
| State (five JSON files) | relative paths, working directory `/var/lib/swee` | file |
| Host CPU / RAM | `/proc/stat`, `/proc/meminfo` | already host-wide inside a container |

## Decisions

1. **Game server output: a forwarder, not the journal.** A root service writes
   only the game unit's journal lines to a file swee's container mounts
   read-only. Mounting the journal (rejected) would give the container every
   unit's logs, `adm` by another name; streaming through lychee-admin
   (rejected) would give the browser-facing app journal access.
2. **Secrets: plain settings in the declaration, secrets in a root-only host
   file.** Rejected: rendering them from `/etc/lychee-ops/secrets.yml` (mixes
   app secrets into lychee-ops' own), and Docker secrets as files (every secret
   read in swee changes).
3. **`/config set`: a read-write mount of the one config directory.** Rejected:
   moving it into lychee-admin as a typed host action (too large for this
   phase), and dropping the write (loses a feature).
4. **The unattended-upgrades log: a read-only mount with `adm` added inside the
   container.** Inside a container a group reaches only what is mounted, so this
   grants that one directory, not what `adm` grants the host account, which
   loses `adm`.

## Design

### lychee-contract v1.4.0 (additive)

- **`env:`** — map of non-secret settings, keys `^[A-Z][A-Z0-9_]*$`, values
  strings. The compose template stops hard-coding palsave-api's three variables
  and renders each resource's own `env:`; palsave-api's declaration gains those
  three explicitly.
- **`secrets_file: true`** — the compose project gets
  `env_file: /etc/lychee-secrets/<name>.env`. Hand-placed, `0600 root:root`.
  The reconciler refuses to deploy the resource if the file is missing or has
  another owner or mode. Pruning a resource never deletes it.
- **`network: host`** — `network_mode: host`. Gated like mount aliases: only a
  resource the vocabulary lists may use it (`swee`). `port` stays required
  otherwise and is optional exactly when `network: host` is set (a host-network
  container publishes no port mapping).
- **Mount aliases**, each `allowed_resources: [swee]`:

  | Alias | Host path | Target | Mode | Container group |
  |---|---|---|---|---|
  | `palworld_events` | `/var/log/palworld-events` | `/palworld-events` | ro | `palworld-events` |
  | `palworld_config` | the game's `Pal/Saved/Config/LinuxServer` | `/palworld-config` | **rw** | `palworld` |
  | `unattended_upgrades_log` | `/var/log/unattended-upgrades` | same path | ro | `adm` (container only) |
  | `host_ops_socket` | `/run/lychee-admin/clients/swee` | same path | ro (the directory; the socket stays connectable) | `swee-api` |

  A read-write alias requires an explicit `mode: rw` and exactly one allowed
  resource; `palworld_config` is the first.
- Host coordinates stay out of the public contract: the vocabulary names the
  host paths by `group_vars` variable, as `palworld_saves` already does.

### lychee-ops

- **`palworld-events.service`** (root): `journalctl -u palworld-palchuds -f -n 0
  -o json --output-fields=MESSAGE,__REALTIME_TIMESTAMP`, appending to
  `/var/log/palworld-events/palworld.jsonl`; directory `0750
  root:palworld-events`; `Restart=on-failure`. logrotate: daily, `rotate 3`,
  `copytruncate`, `missingok`, `notifempty`.
- **Group `palworld-events`**, exactly `swee` (enforced like `<client>-api`).
- **`service_identities`** gains `swee` (its existing uid/gid, recorded in the
  private `group_vars`), so the container runs as `swee`.
- The compose template renders `env:`, `env_file` for `secrets_file`,
  `network_mode: host`, the new aliases with their modes and groups, and — only
  if the image needs it (see swee) — `tmpfs: /tmp` for every resource.
- **Cutover**, in one run and in this order: stop and disable the swee host
  unit; copy `/var/lib/swee/*.json` into the swee state volume, once, only if it
  is empty; bring the container up. Two instances on one Discord token would
  each post every event, so the unit is down before the container starts.
- **Retired** (as `palsave_api_host` was): `swee_host` and `swee_app` stop,
  disable and remove the unit; `swee_version` leaves `group_vars`; the host
  account loses `adm` (keeps `palworld`, `palworld-events`, `swee-api`);
  `/opt/swee` and `/var/lib/swee` stay on disk until a later cleanup, which is
  what keeps rollback cheap.
- **Inventory**: swee's entry changes from unit to container.

### lychee-resources

`swee.yml`: `image: ghcr.io/lycheehome/swee`, `state: running`, `network:
host`, `state_volume: true`, `secrets_file: true`, `mounts:
[palworld_events, palworld_config, unattended_upgrades_log, host_ops_socket]`,
and `env:` with every non-secret setting from today's `.env` (channel and role
IDs, `REST_HOST`/`REST_PORT`, the RAM thresholds, `PALWORLD_SETTINGS_INI_PATH`
under `/palworld-config`, `HOST_OPS_SOCKET`, `PALWORLD_SERVICE_NAME`,
`GITHUB_REPO`, `PALFEED_SERVICE_URL`).

### swee

- **Image**: `Dockerfile` `FROM python:3.14-slim`, dependencies installed at
  build, `USER 993:980`, `ENTRYPOINT ["python", "main.py"]`, and a
  `HEALTHCHECK` on a heartbeat: once logged in, swee rewrites `/state/heartbeat`
  every 30 s; older than 90 s is unhealthy.
- **Release**: a `publish-image` CI job, gated on release-please's
  `release_created`, pushes `ghcr.io/lycheehome/swee:X.Y.Z` with an
  `org.opencontainers.image.source` label.
- **`log_tailer.py`** tails `PALWORLD_EVENTS_FILE` (default
  `/palworld-events/palworld.jsonl`) from its end, reopening when the file
  shrinks or is replaced; the line format and the parser are unchanged.
- **Startup** drops `systemctl show -p LoadState` (no systemctl in a
  container); the existing socket read covers a missing unit.
- **`UNATTENDED_UPGRADES_LOG`** becomes a setting with today's default.
- State files keep their relative paths; the container's working directory is
  `/state`, its state volume.
- The image runs under `read_only: true`. CI starts it with dummy settings; if
  it needs a writable `/tmp`, the template gains `tmpfs: /tmp` (above).

## Rollout

Each step is safe alone, in this order:

1. **lychee-contract v1.4.0.**
2. **lychee-ops PR A — capabilities only.** Template fields and aliases;
   palsave-api's `env:` (its rendered compose file byte-identical to today's);
   the forwarder, its logrotate rule and the `palworld-events` group with
   `swee` in it. swee is unchanged.
3. **swee v2.13.0** (image, publish job, file tailer, startup check). It also
   runs as a host service, because the host account is now in
   `palworld-events`, so it ships first the old way (`swee_version` bump) and
   proves the tailer and forwarder on the host.
4. **Operator** places `/etc/lychee-secrets/swee.env` (the secret lines of
   `/opt/swee/.env`, `0600 root:root`).
5. **Cutover — lychee-ops PR B and lychee-resources `swee.yml`.** The ordered
   run above; `adm` removed; roles retired; inventory switched.

Rollback after step 5: revert both, re-pin `swee_version`.

## Testing

- **lychee-contract**: valid and invalid examples — `env:` key case; `network:
  host` refused for a resource not allowed it; `port` optional only with it; a
  read-write alias without `mode: rw` or with more than one allowed resource.
- **lychee-ops**: each field renders; deploy refused for a missing secrets file
  or a wrong mode; palsave-api's compose file byte-identical; the forwarder unit
  and logrotate rule render; the cutover order (unit stopped before the
  container starts; state copied only into an empty volume); no role grants
  `swee` `adm`.
- **swee**: the tailer follows appended lines and reopens a rotated or
  truncated file; the heartbeat is written only after login; CI builds the
  image and starts it with dummy settings under a read-only root filesystem.
- **On `lychee`** after the cutover: `id swee` has no `adm`; the container is
  healthy; a player join is relayed to Discord; in-game chat to the assistant
  is answered; `/restart`, `/config set` and `/update` work.

## Done when

- swee's account has no `adm` membership.
- Releasing swee is a tag plus Deploy on the board.
- Everything swee does today still works.

## Out of scope

Deleting `/opt/swee` and `/var/lib/swee` (a later cleanup, once rollback is no
longer wanted); a run history for swee; moving `/config set` into lychee-admin.
