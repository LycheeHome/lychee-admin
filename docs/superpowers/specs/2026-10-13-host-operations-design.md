# Host operations in lychee-admin

Date: 2026-10-13. Status: approved design. Sub-project 2 of the platform
roadmap (`docs/superpowers/specs/2026-10-12-platform-roadmap-design.md`).
Spans lychee-admin (most of the work), lychee-ops and lychee-contract.

## Why

swee holds root grants for exactly four things: stop, start and restart the
Palworld unit, and run the steamcmd update wrapper. Those grants are why swee
cannot be an ordinary container (roadmap sub-project 3). This sub-project
makes lychee-admin the one place that operates host services — for the
operator on the services board, and for other apps through a local API — so
that swee can give its grants up next.

Reading the code for this design found a gap the work makes urgent:
lychee-admin has **no cross-site request protection**. It authenticates with
Basic auth, which browsers attach automatically, so a page the operator
visits could make the browser POST to lychee-admin's LAN address with their
credentials. Today that reaches Remove, Deploy and Prune; with root-backed
actions it would reach those too. Closing it is part of this design.

## Scope

- **In:** start, stop, restart and update for `palworld-palchuds` (the unit
  named by lychee-ops' `palworld_service`), from the services board and from a
  local API; the cross-site check for every browser POST in lychee-admin.
- **Out:** moving swee onto the API and removing its grant (sub-project 3);
  any other unit. The mechanism is general — another unit opts in through
  lychee-ops' declaration with no lychee-admin code — but only Palworld is
  declared.

## Security model

**What is protected:** root-backed actions on Palworld, and lychee-admin's
existing mutating routes.

**Callers and their checks:**

| Caller | Path | Checks |
|---|---|---|
| The operator | browser → LAN address or `admin.lychee.land` | Basic auth (unchanged) and the cross-site check on every non-GET |
| An app (swee, later) | its own Unix socket only | the socket's ownership and mode, set by systemd; the caller's grants from `clients.json` |
| Anyone via the Cloudflare tunnel | — | unreachable (unchanged) |

**Layers, from the bottom:**

1. **sudo.** lychee-admin may run only
   `/usr/bin/systemctl start --no-block lychee-op-<unit>-<action>.service` for
   the actions lychee-ops declares — no argument, no unit, no command of its
   choosing. A fully compromised lychee-admin can trigger only those actions.
2. **Action services.** Each is a oneshot unit with a fixed command, a
   per-unit `flock -n` lock (two actions on one unit never overlap; the second
   fails at once) and a time limit.
3. **lychee-admin** accepts an action only if the inventory lists it for that
   unit, and only if the caller is granted it. sudo refuses anything else
   regardless; this is defence in depth and a clean error.
4. **Routers kept apart.** The `/v1` API exists only on client sockets; pages
   exist only on the network listener. Two separate Express routers in one
   process, so a route on one cannot appear on the other.
5. **Client identity is the socket.** One socket per client, created by a
   systemd `.socket` unit with `SocketUser=lychee-admin`,
   `SocketGroup=<client>-api`, `SocketMode=0660`; only the client's user is in
   that group. A request's socket names its caller. There are no tokens and no
   secret to store, rotate or leak. Revoking a client is removing it from the
   declaration.
6. **Cross-site check.** A non-GET from a browser is refused (403) unless
   `Sec-Fetch-Site` is `same-origin` or `none`, or `Origin` equals the
   request's own origin. A request carrying neither header (curl, scripts) is
   allowed: it cannot carry a browser's ambient credentials.
7. **Audit.** Every action request is written to lychee-admin's action log:
   time, caller (`operator` or `client:<name>`), unit, action, outcome
   (`started` or `refused: <reason>`). Each action service's output goes to
   its own log file, readable by lychee-admin; neither needs `adm`.

**What a compromised swee could do** (once it uses the socket): the four
Palworld actions, from inside the host. Nothing else.

**Outside this model:** an attacker with root, or with write access to the
lychee-ops repository — already the platform's trust boundary.

## lychee-ops

**One declaration** in `group_vars/all.yml`, the single source for everything
below:

```yaml
host_operations:
  units:
    "{{ palworld_service }}":
      actions: [start, stop, restart, update]
  clients:
    swee:
      user: swee
      grants:
        "{{ palworld_service }}": [start, stop, restart, update]
```

**A new role, `host_operations`, renders:**

- **Action services** `/etc/systemd/system/lychee-op-<unit>-<action>.service`,
  `Type=oneshot`, as root:
  - `start` / `stop` / `restart`: `systemctl <verb> <unit>`.
  - `update`: `systemctl stop <unit>`, then the steamcmd wrapper (this role
    takes the wrapper over from `swee_host`; swee keeps its own path to it
    until sub-project 3), then `systemctl start <unit>`.
  - Every action runs under `flock -n /run/lychee-op/<unit>.lock`.
  - `TimeoutStartSec`: 300 for start, stop and restart; 1800 for update.
  - Output: `StandardOutput=truncate:/var/lib/lychee-op/<unit>-<action>.log`
    (stderr to the same file); `/var/lib/lychee-op` is `0750 root:lychee-admin`.
  - Services for actions no longer declared are removed.
- **sudo lines** in lychee-admin's drop-in: one
  `/usr/bin/systemctl start --no-block lychee-op-<unit>-<action>.service` per
  declared action.
- **Per client:** a group `<client>-api` with the client's user as its only
  member; a socket unit `lychee-admin-client-<client>.socket` with
  `ListenStream=/run/lychee-admin/clients/<client>.sock`,
  `FileDescriptorName=<client>`, `SocketUser=lychee-admin`,
  `SocketGroup=<client>-api`, `SocketMode=0660`,
  `Service=lychee-admin.service`.
- **`/etc/lychee-admin/clients.json`** (`0640 root:lychee-admin`): each
  client's name and grants. Non-secret. lychee-admin restarts when it changes.
- **Inventory:** each declared unit's entry gains `actions`.
- **Watcher:** fingerprints the action services, the socket units and
  `clients.json`.

**Transition:** until sub-project 3, swee keeps its own sudo grant and calls
the wrapper and systemctl directly, outside the per-unit lock. Two paths, one
of them unlocked, for that window only.

## lychee-contract v1.2 (additive)

- Inventory entries may carry `actions`: a list from the closed set `start`,
  `stop`, `restart`, `update`; only on unit entries.
- New agreement `A-OPS-1`: the action-service name pattern, the generated sudo
  line, the client socket path and name, and the shape of `clients.json`.
- lychee-ops' sudoers check becomes: `sudo.json` plus exactly one generated
  line per declared action.

## lychee-admin

**`src/lib/hostOperations.ts`**, shared by both routers:

- `requestAction(unit, action, caller)`:
  1. 404 if the inventory does not list the action for the unit; 403 if the
     caller is a client not granted it.
  2. 409 "an action is already running on `<unit>`" if any
     `lychee-op-<unit>-*` service is active (the lock also enforces this).
  3. Runs the sudo command, built in `sudoCommands.ts` like every other one;
     a failure is 502 with the command's error text.
  4. Writes the audit line.
- `readActionState(unit, action)`: unprivileged `systemctl show` for
  `ActiveState`, `Result` and the start/exit timestamps, mapped to `idle`,
  `running`, `succeeded` or `failed`; plus the last 50 lines (at most 64 KB)
  of the action's log file.

**Board** (network listener; Basic auth and the cross-site check):

- `POST /services/:name/actions/:action` starts an action and redirects back.
- `GET /services/:name/actions/:action/state` returns the state as JSON; the
  page polls it while an action runs.
- Buttons appear only on rows whose inventory entry lists actions. Stop and
  update ask for confirmation. A running action shows its state; a finished
  one its result and log.
- The board's markup is a UI decision with more than one reasonable answer:
  it goes through `impeccable` and the comparing-design-variants skill before
  any markup is written. This spec fixes only the requirements above.

**Socket API** (client sockets only):

- At start, lychee-admin reads `LISTEN_FDS` / `LISTEN_FDNAMES`; each named
  descriptor whose name is a client in `clients.json` gets the `/v1` router; an
  unknown name is closed and logged, never served. About 15 lines, no new
  dependency. `dev:mock` opens its own sockets in a temp directory instead.
- `POST /v1/units/:unit/actions/:action` → `202` with the state.
- `GET /v1/units/:unit/actions/:action` → the state and log tail.
- The socket router has no pages, no Basic auth, no site or deploy routes.

**Cross-site check:** one middleware on the network router for every non-GET
route, as in the security model; a refusal is logged.

**Contract checks:** the action-service name builder against `A-OPS-1`; the
inventory reader accepts `actions`; dev fakes run actions to `succeeded` or
`failed` on a timer.

## Rollout

| # | Repo | Change | Effect on lychee |
|---|---|---|---|
| 1 | lychee-admin | The cross-site check, alone | Closes the existing gap; the app's own pages and curl unaffected |
| 2 | lychee-contract | v1.2 | None |
| 3 | lychee-ops | The `host_operations` role | Action services and sockets exist; nothing calls them |
| 4 | lychee-admin | `hostOperations`, the socket API, the board buttons | Palworld actions usable |

**After step 3 (operator's sudo where noted):** `sudo -l -U lychee-admin`
lists today's commands plus exactly four action lines; `swee.sock` is
`lychee-admin:swee-api 0660`; `swee` can connect and another user cannot.

**After step 4:** a state request on `swee.sock` as `swee` returns `idle`; one
restart from the board at a time the operator chooses (it disconnects
players); the audit line names `operator`, the action's log holds its output,
the state reads `succeeded`; a cross-origin POST gets 403.

## Testing

- **lychee-ops:** the declaration renders the expected action services,
  socket units, `clients.json` and sudo lines; sudoers equals `sudo.json` plus
  the generated lines; the watcher includes the new files; an undeclared
  action's service is removed.
- **lychee-contract:** valid examples with `actions`; invalid: an unknown
  action, `actions` on a container entry.
- **lychee-admin:** grants per caller; 404/403/409/502 paths; the cross-site
  check over every combination of `Sec-Fetch-Site` and `Origin`; `LISTEN_FDS`
  parsing including an unknown name; the two routers kept apart (no `/v1` on
  the network router, no pages on the socket router); action-service names
  against `A-OPS-1`; the dev fakes through a full cycle.

## Done when

- Palworld can be started, stopped, restarted and updated from the board, and
  through `swee.sock` by the `swee` user, and by nothing else.
- Every action request is in the audit log with its caller.
- No cross-site POST is accepted anywhere in lychee-admin.

## Rejected

- **lychee-admin running the commands itself** (sudo on `systemctl restart`
  and the wrapper, jobs in memory): a deploy restart kills a running update,
  and logs and locking would be reinvented.
- **An HTTP API on the LAN address with a bearer token:** puts host control on
  the network.
- **Tokens on the socket** (hashed file, plain copy in swee's environment, or
  systemd credentials): three copies of a secret that buy nothing over the
  socket's own permissions.
- **One socket, identifying callers by `SO_PEERCRED`:** needs a native Node
  add-on, a new dependency that complicates sub-project 4's builds.
- **The app creating its sockets** (a `0750` client directory and a `0666`
  socket): works, but systemd can set the group directly and keeps the socket
  open across restarts.
- **Every unit on the board** (Caddy, `cloudflared-sites`, lychee-admin
  itself): a wrong click takes down the edge or the app mid-action.
