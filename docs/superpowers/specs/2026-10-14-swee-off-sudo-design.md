# swee off sudo

Date: 2026-10-14. Status: approved design (sections approved in conversation),
awaiting written-spec review. Phase 1 of roadmap sub-project 3, "swee becomes a
container" (`2026-10-12-platform-roadmap-design.md`). Spans swee and
lychee-ops; lychee-admin is unchanged.

## Why, and why a phase

swee holds root through `/etc/sudoers.d/swee`: `systemctl stop`, `start` and
`restart` on `palworld-palchuds`, and `/usr/local/sbin/swee-update-palworld`
(steamcmd as root). Host operations (sub-project 2) made lychee-admin the one
place that operates the game server, with a per-client socket for swee
(A-OPS-1). It is live and verified on `lychee`; swee does not use it yet.

Sub-project 3 as the roadmap states it also needs four contract additions that
do not exist (secrets or environment for a resource, host networking, a
read-write mount for `PalWorldSettings.ini`, journal access), an image pipeline
swee does not have, and a state migration. Those are a container question. The
privilege question is independent and small, so it goes first:

- **Phase 1 (this spec):** swee stays a host service and uses the socket for
  all four actions; its sudo grant is removed.
- **Phase 2 (its own spec):** swee becomes a container; `adm` goes, and
  `swee_host` / `swee_app` retire.

## Today (read 2026-10-14)

- swee's sudo calls: `swee/restart.py` (`sudo -n -l` startup probe;
  `sudo systemctl restart` for `/restart` and the RAM auto-restart) and
  `swee/server_update.py` (`sudo -n -l` probes for three grants; `sudo
  systemctl stop`; `sudo swee-update-palworld`; `sudo systemctl start`).
- swee exits at startup if the restart grant is missing (`main.py`).
- On `lychee`: account `swee` is in `swee`, `adm`, `palworld` and `swee-api`.
  The running process (started 2026-10-03) holds only the first three; it
  gains `swee-api` on its next restart. `/etc/sudoers.d/swee` and
  `/usr/local/sbin/swee-update-palworld` exist. `/var/log/lychee-admin/actions.log`
  has no logrotate rule.

## Design

### swee

**`swee/host_ops.py`**: HTTP over the Unix socket with httpx (already a
dependency).

- `start_action(action)` → `POST /v1/units/<unit>/actions/<action>`;
  `action_state(action)` → `GET` the same path: state (`idle`, `running`,
  `succeeded`, `failed`), `startedAt`, `finishedAt`, `logTail`.
- Every request has a **10 s timeout**.
- Refusals become a typed error carrying a sentence for Discord: 409 "an
  action is already running on the server"; 403/404 "swee is not allowed to
  do that" (a grant or inventory problem, logged with the response body); 502
  "lychee-admin could not start it" (with its error text); connection refused
  or timeout "host control is unavailable right now" (lychee-admin
  unreachable, usually for seconds during its own deploy).
- Settings: `HOST_OPS_SOCKET` (default
  `/run/lychee-admin/clients/swee/api.sock`) and `HOST_OPS_UNIT` (default
  `palworld-palchuds`, the inventory entry's name).

**`/restart` and the RAM auto-restart**: POST `restart`, poll its state every
2 s until `succeeded` or `failed`, then wait for the REST API as today (up to
120 s). Success requires `succeeded` (the guard against a false "back online
after 0s" carries over). `failed` shows the log tail. A refusal shows its
sentence and broadcasts nothing to players.

**`/update`**: the warning, the wait and the world save stay as they are. Then
POST `update` and poll every 2 s:

- The progress message reads **running · the latest log line** (e.g. `Update
  state (0x61) downloading, progress: 64.31`), edited only when that line
  changes.
- `succeeded` → wait for REST as today.
- `failed` → the last 500 characters of the log tail, as today; the server has
  already been started with the existing install by lychee-op's restart
  guard.
- A failed stop fails the run before steamcmd. swee tells it apart from a
  steamcmd failure by whether the log ever shows steamcmd, and keeps today's
  retraction (Discord and in-game: "Update cancelled — the server is staying
  up").
- swee stops polling after **35 minutes** (the update service's
  `TimeoutStartSec=1800` plus slack) and reports a timeout.
- After a `--no-block` start, a poll can briefly return the previous run's
  result (A-OPS-1): swee takes a terminal state as this run's only if its
  `startedAt` is not earlier than its own POST, less 5 s of clock slack.

**Startup**: swee starts whether or not the socket answers. It logs which, and
a command that needs host control replies "host control is unavailable right
now" while it is down. Rationale: lychee-admin restarts on every deploy, and
swee must not stop working or crash-loop because of that. The unprivileged
`systemctl show -p LoadState` check on the game unit stays.

**Removed**: every `sudo` invocation, `SWEE_UPDATE_WRAPPER`, the `sudo -n -l`
probes and `_REQUIRED_SUDO_GRANTS`.

### lychee-ops

- `swee_host` declares `/etc/sudoers.d/swee` and
  `/usr/local/sbin/swee-update-palworld` **absent**, the pattern its retired
  drop-ins already use. `palworld-update.sh.j2` stays: lychee-op's update
  service renders it under its own name.
- `adm` and `palworld` memberships stay (journal, unattended-upgrades log,
  `PalWorldSettings.ini`) until phase 2.
- **logrotate** for `/var/log/lychee-admin/actions.log`: weekly, `rotate 8`,
  `compress`, `delaycompress`, `missingok`, `notifempty`, `copytruncate`
  (lychee-admin opens the file per append, so copy-and-truncate loses
  nothing). It bounds what a refusal loop can write, the item carried from the
  host-operations reviews.

### lychee-admin

No change.

## Rollout

Each step is safe alone, in this order:

1. **swee**: PR with the swee changes; CI; release-please tag (e.g.
   `v2.12.0`).
2. **lychee-ops PR 1**: `swee_version` → that tag. swee_app deploys and
   restarts swee, which now holds `swee-api`. Check on `lychee`: swee's
   process groups include `swee-api`; its startup log says the socket
   answered; one `/restart` from Discord succeeds and lychee-admin's audit log
   records it as `client:swee`.
3. **lychee-ops PR 2**: the drop-in and wrapper absent, plus logrotate. Check:
   `sudo -l -U swee` lists nothing; the wrapper is gone; `/restart` still works.

Steps 2 and 3 are separate so the grant is removed only after swee has worked
without it, and a misbehaving swee rolls back by reverting the pin while the
grant still exists.

## Testing

**swee** (pytest, existing CI):

- `host_ops.py` against httpx's mock transport: each refusal maps to its
  error; every request sets the timeout.
- One end-to-end request over a real temporary Unix socket against a small fake
  lychee-admin.
- `/restart`: succeeded then REST answers; failed with the log tail; 409; socket
  unreachable (nothing broadcast).
- `/update`: progress edits only on a changed line; failed shows the last 500
  characters; a failed stop gives the retraction; the poll gives up at 35
  minutes (faked clock); a stale terminal state from before the POST is not
  taken as this run's.
- Startup with the socket down does not exit.
- No module starts a process named `sudo` (a test that fails if one does).
- Today's sudo-asserting tests in `test_restart.py` and `test_server_update.py`
  are rewritten against the client.

**lychee-ops** (focused run; full suite in CI): `swee_host` declares both paths
absent; no rendered sudoers grants anything to `swee`; the logrotate rule
renders exactly as specified (and passes `logrotate -d` where available);
`swee_version` points at the new tag.

**On `lychee`**: the checks in Rollout, plus a `/restart` and, when convenient,
an `/update` from Discord by the operator.

## Done when

- `sudo -l -U swee` grants nothing, and the wrapper is gone.
- `/restart`, the RAM auto-restart and `/update` work through the socket, and
  lychee-admin's audit log records them as `client:swee`.

## Out of scope (phase 2)

swee as a container: an image and its release pipeline; contract fields for
secrets or environment, host networking, a read-write mount for
`PalWorldSettings.ini` and journal access; moving swee's five state files into
a state volume; the inventory entry from unit to container; removing `adm`;
retiring `swee_host` and `swee_app` and `swee_version`.

## Rejected

- **One spec for all of sub-project 3**: sudo would stay until every container
  question was answered.
- **swee refusing to start without the socket** (today's behaviour with sudo):
  lychee-admin restarts on every deploy, so swee would crash-loop through each
  one.
- **Inferring "stopping / updating / starting" from the log**: ties swee to the
  wording of lychee-ops' update script; the latest log line carries the same
  information without that coupling.
