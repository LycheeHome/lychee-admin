# Host operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Palworld can be started, stopped, restarted and updated from lychee-admin's services board and through a per-client Unix socket, each action a lychee-ops-declared oneshot service started through one pinned sudo line, and no cross-site POST is accepted anywhere in lychee-admin.

**Architecture:** lychee-ops declares units, actions and clients once; a new `host_operations` role renders the action services, the sudo lines, the client socket units and `clients.json`. lychee-admin gains one `hostOperations` module used by two routers kept apart — the board (network listener, Basic auth, cross-site check) and the `/v1` API (systemd-passed client sockets only). The contract (v1.2) carries the inventory's `actions` and agreement `A-OPS-1`.

**Tech Stack:** TypeScript/Express + `tsx --test` (lychee-admin), Ansible (lychee-ops), JSON Schema + Python (lychee-contract), systemd socket activation.

**Spec:** `docs/superpowers/specs/2026-10-13-host-operations-design.md` (this repo).

## Global Constraints

- Only `palworld-palchuds` (lychee-ops `palworld_service`) is declared; the mechanism stays general.
- Action set: exactly `start`, `stop`, `restart`, `update`.
- Action service name: `lychee-op-<unit>-<action>.service`; sudo line: `/usr/bin/systemctl start --no-block lychee-op-<unit>-<action>.service`; lock: `flock -n /run/lychee-op/<unit>.lock`; log: `/var/lib/lychee-op/<unit>-<action>.log` (dir `0750 root:lychee-admin`); `TimeoutStartSec` 300 (start/stop/restart), 1800 (update).
- Client socket: unit `lychee-admin-client-<client>.socket`, `ListenStream=/run/lychee-admin/clients/<client>.sock`, `FileDescriptorName=<client>`, `SocketUser=lychee-admin`, `SocketGroup=<client>-api`, `SocketMode=0660`, `Service=lychee-admin.service`; group `<client>-api` has only the client's user.
- `/etc/lychee-admin/clients.json`: `0640 root:lychee-admin`, `{"clients": [{"name", "grants": {"<unit>": ["<action>", ...]}}]}`, non-secret.
- No tokens. A request's socket is its caller.
- Cross-site check on every non-GET of the network app: allow when `Sec-Fetch-Site` ∈ {`same-origin`, `none`}, or `Origin`'s host equals the `Host` header, or neither header is present; else 403 and a log line.
- Errors: unknown unit/action 404; caller not granted 403; unit busy 409 `an action is already running on <unit>`; sudo failure 502 with its error text.
- Audit line per action request: time, caller (`operator` | `client:<name>`), unit, action, outcome (`started` | `refused: <reason>`).
- Board markup goes through `impeccable` and the `comparing-design-variants` skill (published comparison, operator picks) before any markup is written.
- No new runtime dependency in lychee-admin.
- Every check runs inside each repo's existing job named `test`; CI Python is "3.14".
- Contract v1.2 is built and checked locally first (`LYCHEE_CONTRACT_DIR`), published at the operator stop, then every lock is re-pointed to the merge commit.
- Outward steps (push, PR, merge, tag) are the operator's to approve.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. `gh`: prefix `GH_TOKEN="$(gh auth token -u byroncustodio)"`.
- lychee-ops: probe Ansible in `tests/.venv`; Edit/Write; full suite ~10–15 min.

## Review Focus

1. **A board POST through `https://admin.lychee.land`** (Caddy terminates TLS and proxies plain HTTP, keeping `Host`): `Origin` is `https://…` while Express sees `http`. The check must compare hosts, not schemes. → Task 1 test `same-origin POST via the HTTPS name passes`.
2. **lychee-admin restarting while an update runs** (every deploy restarts it): the action keeps running and its state is still readable afterwards. → Task 6 test `state is read from systemd, not from memory`.
3. **An action on one unit while another unit's action runs**: allowed — the lock is per unit. → Task 6 test `busy is per unit`.
4. **A socket passed by systemd whose name is not in `clients.json`** (a stale socket unit): closed and logged, never served. → Task 7 test `an unknown descriptor name is closed, not served`.
5. **A client granted an action the inventory no longer lists** (clients.json and inventory out of step for one run): 404, not 500 and not a sudo call. → Task 6 test `a grant without an inventory action is 404`.

---

## Step 1 — lychee-admin: the cross-site check (branch `fix/same-origin`, own PR)

### Task 1: Refuse cross-site non-GET requests

**Files:**
- Create: `src/middleware/sameOrigin.ts`, `src/middleware/sameOrigin.test.ts`
- Modify: `src/app.ts` (mount after `basicAuth`, before the routers); `src/lib/logger.ts` only if a new audit kind is needed for the refusal line

**Interfaces:**
- Produces: `export function sameOrigin(logger): RequestHandler` — passes GET/HEAD/OPTIONS untouched.

- [ ] **Step 1: Write failing tests** (supertest-style via the existing route test helpers in `src/dev/testHelpers.ts`): `same-origin Sec-Fetch-Site passes`, `Sec-Fetch-Site none passes`, `cross-site Sec-Fetch-Site is 403`, `same-site (another subdomain) is 403`, `Origin host equal to Host passes`, `same-origin POST via the HTTPS name passes` (`Origin: https://admin.lychee.land`, `Host: admin.lychee.land`), `Origin from another host is 403`, `Origin: null is 403`, `neither header passes`, `GET is never checked`, `a refusal writes one log line`; plus one existing mutating route (e.g. Remove) refused cross-site end to end.
- [ ] **Step 2:** Implement; `npm run typecheck && npm run lint && npm test` (with `LYCHEE_CONTRACT_DIR` unset, so the published v1.1.0 is fetched) → green; `public/app.js`'s own fetch/POSTs still pass (they are same-origin) — confirm in `npm run dev:mock` by removing a seeded site.
- [ ] **Step 3: Commit** `fix: refuse cross-site requests to every mutating route`.
- [ ] **Step 4 (STOP — operator):** push, PR (body: closes the CSRF gap; no UI change), merge on green. On lychee after deploy: the board still adds/removes from the operator's browser.

---

## Step 2 — lychee-contract v1.2 (local branch `feat/v1.2`)

### Task 2: `actions` in the inventory; `A-OPS-1`

**Files:**
- Modify: `schemas/inventory.schema.json` — unit entries may carry `actions`: array, unique items, enum `start|stop|restart|update`; container entries may not
- Modify: `constants.json` — `host_actions: ["start","stop","restart","update"]`, `op_unit_pattern: "lychee-op-{unit}-{action}.service"`, `op_sudo_argv: ["/usr/bin/systemctl","start","--no-block","{op_unit}"]`, `client_socket_path: "/run/lychee-admin/clients/{client}.sock"`, `clients_file: "/etc/lychee-admin/clients.json"`; add the keys to `CONSTANT_KEYS`
- Create: `schemas/clients.schema.json` (`{clients: [{name: ^[a-z][a-z0-9-]{0,30}$, grants: {<unit>: [action...]}}]}`, `additionalProperties: false`) with valid/invalid examples
- Modify: `AGREEMENTS.md` — `## A-OPS-1` (names, sudo line, lock, log path, socket unit fields, clients.json, "a request's socket is its caller")
- Examples: valid inventory with `actions` on the Palworld row; invalid `unknown-action.json` (`pointer: /services/0/actions/0`, `keyword: enum`), `actions-on-container.json`

- [ ] **Step 1:** Examples and the constants key check first → `tools/check_examples.py` fails; then schemas/constants/AGREEMENTS → passes; every v1.1 example still validates.
- [ ] **Step 2: Commit** `feat: actions in the inventory and the host-operations agreement (v1.2)`.

---

## Step 3 — lychee-ops: the `host_operations` role (branch `feat/host-operations`)

### Task 3: Declaration and action services

**Files:**
- Modify: `group_vars/all.yml` — the `host_operations` declaration exactly as in the spec, plus `host_operations_update_templates: { "{{ palworld_service }}": palworld-update.sh.j2 }` (an `update` action is accepted only for a unit with an update template)
- Create: `roles/host_operations/{tasks/main.yml,templates/lychee-op.service.j2,templates/palworld-update.sh.j2,defaults/main.yml}`; move `roles/swee_host/templates/swee-update-palworld.sh.j2` to `roles/host_operations/templates/palworld-update.sh.j2` and point `swee_host`'s template task at `{{ role_path }}/../host_operations/templates/palworld-update.sh.j2` (one source, two installs until sub-project 3)
- Modify: `playbook.yml` — `host_operations` after `palworld_host`, untagged (full run only)
- Test: `tests/test_host_operations.yml`

**Interfaces:**
- Produces: units `/etc/systemd/system/lychee-op-<unit>-<action>.service`; update script `/usr/local/sbin/lychee-op-<unit>-update` (0700 root); `/var/lib/lychee-op` (0750 root:lychee-admin); fact `host_operations_op_units` (list of unit file names) for Task 4.

- [ ] **Step 1: Failing render tests:** for the real declaration, exactly four services render; `start/stop/restart` ExecStart is `/usr/bin/flock -n /run/lychee-op/palworld-palchuds.lock /usr/bin/systemctl <verb> palworld-palchuds.service`; `update` runs the stop, the update script and the start under one flock (via the rendered script or `ExecStart=` lines — the plan fixes: one `ExecStart=/usr/bin/flock -n <lock> /usr/local/sbin/lychee-op-palworld-palchuds-update`, and that script does stop → steamcmd → start with `set -eu`); `TimeoutStartSec` 300/1800; `StandardOutput=truncate:/var/lib/lychee-op/<unit>-<action>.log` and `StandardError=inherit`; `RuntimeDirectory=lychee-op` with `RuntimeDirectoryPreserve=yes`; a declared `update` without a template fails the run with a clear message; a service for an action no longer declared is removed (render with a shrunk declaration into a temp dir).
- [ ] **Step 2:** Implement; the tests pass; full suite green.
- [ ] **Step 3: Commit** `feat: lychee-op action services from one declaration`.

### Task 4: Sudo lines, clients, sockets, inventory, watcher

**Files:**
- Convert: `roles/lychee_admin_host/files/sudoers.example` → `templates/sudoers.j2` (today's alias entries unchanged, plus one `/usr/bin/systemctl start --no-block lychee-op-<unit>-<action>.service` per declared action in the same `Cmnd_Alias`); `files/lychee-admin.service` → `templates/lychee-admin.service.j2` adding `Sockets=` listing every `lychee-admin-client-<client>.socket` (no line when there are no clients) and `After=` the same
- Modify: `roles/host_operations/tasks/main.yml` — per client: group `<client>-api` (members: exactly the client's user, appended, not replacing their other groups), the `.socket` unit (fields per Global Constraints, `[Install] WantedBy=sockets.target`), enabled and started; `/etc/lychee-admin/clients.json` (0640 root:lychee-admin), notify restart of lychee-admin on change; remove socket units of undeclared clients
- Modify: `roles/inventory/defaults/main.yml` or the template — the Palworld entry carries `actions` from the declaration
- Modify: `group_vars/all.yml` `watch_files` — the op services, socket units, `clients.json`
- Modify: `tests/test_contract.py` — `test_sudoers_grants_exactly_sudo_json` becomes "the rendered sudoers equals sudo.json plus one op line per declared action" (render the template with the real declaration); `clients.json` rendered validates against `.contract/schemas/clients.schema.json`; the rendered inventory row's `actions` validate (via `check_rendered.py`)
- Modify: `contract.lock` → the local v1.2 commit

- [ ] **Step 1:** Failing tests first (sudoers equality with the op lines; clients.json schema; socket unit fields; `Sockets=` present for swee and absent with no clients; group membership appended).
- [ ] **Step 2:** Implement; `visudo -csf` on the rendered sudoers in the test; full suite green.
- [ ] **Step 3: Commit** `feat: sudo lines, client sockets and clients.json from the declaration`.

---

## Step 4 — lychee-admin: host operations (branch `feat/host-operations`)

### Task 5: Inventory `actions`, op argv, contract checks

**Files:**
- Modify: `src/lib/serviceInventory.ts` — unit entries gain `actions?: HostAction[]` (`type HostAction = "start"|"stop"|"restart"|"update"`; unknown values dropped)
- Modify: `src/lib/platform.ts` — `HOST_ACTIONS`, `opUnitName(unit: string, action: HostAction): string`, `CLIENT_SOCKET_DIR`, `CLIENTS_FILE`; `src/lib/sudoCommands.ts` — `SUDO.startOp(unit, action): string[]`
- Tests: `platform.test.ts` — the new constants and `opUnitName` against `constants.json` (`op_unit_pattern`), `SUDO.startOp` against `op_sudo_argv`; `serviceInventory.test.ts` — `actions` read, unknown dropped; `contract.lock` → local v1.2

- [ ] Tests first → fail → implement → `typecheck/lint/test/test:contract` green → commit `feat: read host actions from the inventory; one checked op unit name`.

### Task 6: `hostOperations`

**Files:**
- Create: `src/lib/hostOperations.ts`, `src/lib/hostOperations.test.ts`
- Modify: `src/lib/systemCommands.ts` (`SystemCommands` gains `startHostAction(unit, action): Promise<void>` and `readOpUnits(units: string[]): Promise<Record<string, OpUnitState>>` via unprivileged `systemctl show -p ActiveState,Result,ExecMainStartTimestamp,ExecMainExitTimestamp`); `src/dev/fakes.ts` (fake op runs `running` → `succeeded`/`failed` after a configurable delay)

**Interfaces:**
- Produces: `type Caller = { kind: "operator" } | { kind: "client"; name: string; grants: Record<string, HostAction[]> }`; `type ActionResult = { ok: true; state: ActionState } | { ok: false; status: 403|404|409|502; message: string }`; `type ActionState = { unit, action, state: "idle"|"running"|"succeeded"|"failed", startedAt?, finishedAt?, logTail: string }`; `requestAction(deps, unit, action, caller): Promise<ActionResult>`; `readActionState(deps, unit, action): Promise<ActionState>`.

- [ ] **Step 1: Failing tests:** 404 unknown unit; 404 action not listed; `a grant without an inventory action is 404`; 403 client not granted; operator never 403; `busy is per unit` (409 when any `lychee-op-<unit>-*` is active; another unit's running op does not block); sudo failure 502 carrying the error text; `started` and every `refused:` reason audited with the caller label; `state is read from systemd, not from memory` (a fresh module instance reads `running`); log tail last 50 lines capped at 64 KB, missing file → `""`.
- [ ] **Step 2:** Implement; green; commit `feat: host operations — request an action, read its state`.

### Task 7: The socket API

**Files:**
- Create: `src/api/router.ts` (`createApiRouter(deps, caller)` with `POST`/`GET /v1/units/:unit/actions/:action`), `src/lib/clients.ts` (`readClients(fs): ClientConfig[]` from `clients.json`; `listenFds(env): { name: string; fd: number }[]` parsing `LISTEN_FDS`, `LISTEN_FDNAMES`, `LISTEN_PID`), tests for both
- Modify: `src/server.ts` — for each passed fd whose name is a client: `express()` with only `createApiRouter(deps, callerFor(client))`, `listen({ fd })`; unknown names: `fs.closeSync(fd)` + log; `src/dev/server.ts` — open `swee.sock` in a temp dir with dev grants

- [ ] **Step 1: Failing tests:** `listenFds` (count/names/pid mismatch → none); `an unknown descriptor name is closed, not served`; `the routers are kept apart` (the API app has no `/` page and no `/services`; `createApp` has no `/v1`); `POST` → 202 with state; `GET` → state + log tail; 403/404/409 mapped to HTTP status with `{error}`; a real `http.request` over a temp Unix socket returns 202 (end to end, no systemd).
- [ ] **Step 2:** Implement; green; commit `feat: per-client socket API on systemd-passed sockets`.

### Task 8: Board routes (no markup)

**Files:**
- Modify: `src/routes/services.ts` — `POST /services/:name/actions/:action` (operator caller; redirect 303 to `/services`, or JSON when `Accept: application/json`), `GET /services/:name/actions/:action/state` (JSON); both behind Basic auth and Task 1's check
- Test: `src/routes/services.test.ts`

- [ ] Tests first (redirect, JSON, 404/409 surfaced, cross-site refused) → implement → commit `feat: board routes for host actions`.

### Task 9 (STOP — operator choice): Board UI

- [ ] Run `comparing-design-variants` for the services-board action controls (buttons on the Palworld row; confirmation for stop/update; running state; last result and log): Mobbin references, four named variants in `DESIGN.md` tokens, the current board as labelled control, published as an Artifact. **Stop for the operator to pick.**
- [ ] Implement the chosen variant through `impeccable` (Edit/Write in `src/views` and `public`, detector hook firing), polling the Task 8 state route while running; view tests for: buttons only where `actions` exist, confirmation on stop/update, the busy message, the log disclosure.
- [ ] Commit `feat: host action controls on the services board`; run `/impeccable document` if tokens or components changed.

---

## Operator stop (after Tasks 2–9 pass locally)

- [ ] Final whole-branch review across the three repos.
- [ ] With approval: contract PR → merge (merge commit) → confirm the merged tree equals the tested commit → tag `v1.2.0` → re-point both locks → push, PRs for lychee-ops then lychee-admin.
- [ ] After lychee-ops merges (read-only + operator sudo): `sudo -l -U lychee-admin` shows the 7 commands plus exactly 4 op lines; `ls -l /run/lychee-admin/clients/swee.sock` is `lychee-admin swee-api srw-rw----`; `sudo -u swee curl --unix-socket … /v1/units/palworld-palchuds/actions/restart` answers (lychee-admin not yet updated → it may hang until the app update; acceptable) and another user is denied.
- [ ] After lychee-admin merges: as `swee`, `GET` state → `idle`; at a time the operator chooses, one restart from the board; audit line names `operator`, `/var/lib/lychee-op/palworld-palchuds-restart.log` has output, state `succeeded`; a cross-origin POST → 403.
