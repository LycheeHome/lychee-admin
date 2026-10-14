# swee off sudo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** swee operates the Palworld server only through lychee-admin's per-client socket, and its root sudo grant is removed.

**Architecture:** A small httpx client in swee speaks HTTP over `/run/lychee-admin/clients/swee/api.sock`; `/restart`, the RAM auto-restart and `/update` start an action and poll its state instead of running sudo. lychee-ops then declares swee's sudoers drop-in and update wrapper absent, and rotates lychee-admin's audit log.

**Tech Stack:** Python 3.14, httpx (already a dependency), discord.py, pytest/unittest (swee); Ansible (lychee-ops).

**Spec:** `docs/superpowers/specs/2026-10-14-swee-off-sudo-design.md` (lychee-admin, branch `docs/swee-off-sudo`).

## Global Constraints

- Socket: `HOST_OPS_SOCKET`, default `/run/lychee-admin/clients/swee/api.sock`; unit: `HOST_OPS_UNIT`, default `palworld-palchuds`.
- API (A-OPS-1): `POST /v1/units/<unit>/actions/<action>` → 202 with the state; `GET` the same path → `{"unit","action","state","startedAt","finishedAt","logTail"}`; `state` ∈ `idle|running|succeeded|failed`; errors are JSON `{"error": "..."}` with 404/403/409/502.
- Every socket request: 10 s timeout. Poll interval: 2 s. Restart REST wait: 120 s (unchanged). Update poll cap: 35 minutes. Stale-result slack: 5 s.
- Discord sentences, exact: 409 → "an action is already running on the server"; 403/404 → "swee is not allowed to do that"; 502 → "lychee-admin could not start it" (+ its error text); unreachable/timeout → "host control is unavailable right now".
- swee starts whether or not the socket answers; the `systemctl show -p LoadState` check on the game unit stays and still gates startup.
- No `sudo` anywhere in swee after Task 3; `SWEE_UPDATE_WRAPPER` removed.
- lychee-ops: `/etc/sudoers.d/swee` and `/usr/local/sbin/swee-update-palworld` absent; `adm` and `palworld` memberships untouched; logrotate `/var/log/lychee-admin/actions.log`: weekly, `rotate 8`, `compress`, `delaycompress`, `missingok`, `notifempty`, `copytruncate`.
- Branches: swee `feat/host-ops-socket` from `origin/main`; lychee-ops `feat/swee-off-sudo` from `origin/main`. Nothing is pushed by a task. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; swee commits use Conventional Commit titles (release-please; `pr-title-lint`).

## Review Focus

1. **A poll that reads the previous run's terminal state** right after the POST (A-OPS-1's `--no-block` window): it must not be taken as this run's result. → Task 1 test `test_wait_ignores_terminal_state_from_before_the_post`.
2. **lychee-admin restarting mid-action** (every deploy): the poll sees connection refused for a few seconds; the action itself keeps running, so swee must keep polling, not report failure. → Task 1 test `test_wait_survives_a_few_unreachable_polls`.
3. **A 409 because swee's own previous action is still running** (e.g. a RAM auto-restart overlapping `/restart`): reported with the 409 sentence, nothing broadcast to players. → Task 2 test `test_restart_busy_broadcasts_nothing`.
4. **An update whose stop failed**: the log never reaches steamcmd; swee must retract the warning (Discord and in-game), not report a steamcmd failure. → Task 3 test `test_update_stop_failure_retracts`.
5. **A grant or inventory mismatch on the host** (403/404): one clear sentence to Discord, the response body in the log, no crash. → Task 1 test `test_refusals_map_to_sentences`.

---

### Task 1: The host-ops client (swee)

**Files:**
- Create: `swee/host_ops.py`, `tests/test_host_ops.py`
- Modify: `swee/config.py` (add `HOST_OPS_SOCKET`, `HOST_OPS_UNIT`)

**Interfaces — Produces:**
- `class HostOpsError(Exception)` with `.sentence: str` (the exact Discord sentence) and `.detail: str` (body or exception text, for the log).
- `class ActionState` (dataclass): `state: str`, `started_at: datetime | None`, `finished_at: datetime | None`, `log_tail: str`.
- `class HostOps`: `__init__(self, socket_path: str = HOST_OPS_SOCKET, unit: str = HOST_OPS_UNIT, transport: httpx.AsyncBaseTransport | None = None)`; `async start(self, action: str) -> ActionState`; `async state(self, action: str) -> ActionState`; `async ping(self) -> bool` (a GET of `restart`'s state; True on any 2xx); `async wait(self, action: str, posted_at: datetime, timeout_s: float, on_line: Callable[[str], Awaitable[None]] | None = None) -> ActionState` — polls every 2 s until a terminal state whose `started_at >= posted_at - 5 s`, calling `on_line` with the last non-empty log line whenever it changes; tolerates `HostOpsError` with the unreachable sentence on individual polls; raises `HostOpsError("host control is unavailable right now")` if `timeout_s` passes.
- Module-level `host_ops = HostOps()`.
- Default transport: `httpx.AsyncHTTPTransport(uds=socket_path)`, base URL `http://swee`, `timeout=10.0`.

- [ ] **Step 1: Write failing tests** (unittest style, env defaults as in `tests/test_restart.py`, `httpx.MockTransport` for all but one):
  - `test_start_posts_and_returns_state` — POST `/v1/units/palworld-palchuds/actions/restart` → 202 body → `ActionState(state="running", …)`.
  - `test_refusals_map_to_sentences` — 409/403/404/502 bodies `{"error": "x"}` → `HostOpsError.sentence` exactly the Global Constraints sentence (502 sentence followed by `: x`); `.detail` contains `x`.
  - `test_unreachable_is_its_own_sentence` — transport raising `httpx.ConnectError` and `httpx.TimeoutException` → "host control is unavailable right now".
  - `test_every_request_has_a_10s_timeout` — assert `request.extensions["timeout"]` values are 10.0.
  - `test_wait_ignores_terminal_state_from_before_the_post` — first poll `succeeded` with `startedAt` 60 s before `posted_at`, then `running`, then `succeeded` after → returns the last; `asyncio.sleep` patched.
  - `test_wait_survives_a_few_unreachable_polls` — ConnectError ×3 then `succeeded` → returns succeeded.
  - `test_wait_reports_each_new_log_line_once` — tails `"a\nb"`, `"a\nb"`, `"a\nb\nc"` → `on_line` called with `"b"`, `"c"`.
  - `test_wait_gives_up_after_timeout` — clock patched past `timeout_s` → unreachable-sentence error.
  - `test_over_a_real_unix_socket` — a temp-dir socket served by `asyncio.start_unix_server` answering one HTTP/1.1 response; `HostOps(socket_path=…)` without a transport → `state("restart").state == "idle"`.
- [ ] **Step 2:** `pytest tests/test_host_ops.py -q` → fails (`ModuleNotFoundError: swee.host_ops`).
- [ ] **Step 3:** Implement per the Interfaces block; parse ISO times with `datetime.fromisoformat` (accept a trailing `Z`); an unparsable time is `None`.
- [ ] **Step 4:** `pytest tests/ -q` → all pass.
- [ ] **Step 5:** Commit `feat: a client for lychee-admin's host-operations socket`.

### Task 2: `/restart`, the RAM auto-restart and startup (swee)

**Files:** Modify `swee/restart.py`, `main.py`, `tests/test_restart.py`.

**Interfaces — Consumes:** Task 1's `host_ops`, `HostOpsError`, `ActionState`. **Produces:** `check_palworld_service() -> bool` (LoadState only); `async restart_palworld(on_progress=None) -> discord.Embed` (same signature; callers in `swee/commands.py` unchanged).

- [ ] **Step 1: Rewrite `tests/test_restart.py`** with `host_ops` patched (no `create_subprocess_exec` mocks):
  - `test_restart_succeeds_then_waits_for_rest` — start → running; wait → succeeded; `rest.info` ok → title "Server restarted".
  - `test_restart_failed_shows_log_tail` — wait → failed, tail "boom" → title "Restart failed", a field containing "boom".
  - `test_restart_busy_broadcasts_nothing` — start raises the 409 error → title "Restart failed", field equals the 409 sentence; `broadcast_embed` and `rest.announce` not called.
  - `test_restart_unreachable` — start raises the unreachable error → field equals "host control is unavailable right now".
  - `test_succeeded_but_rest_silent_times_out` — succeeded, `rest.info` always raises → "Restart timed out" (120 s via patched clock).
  - `test_check_palworld_service_needs_no_sudo` — LoadState `loaded` → True with only one subprocess call (`systemctl show …`); `not-found` → False.
  - `test_startup_does_not_exit_when_socket_down` — `main.main()`'s startup path with `host_ops.ping` → False: no `SystemExit`, a log line naming the socket; patch `bot.start` to return.
- [ ] **Step 2:** `pytest tests/test_restart.py -q` → fails.
- [ ] **Step 3:** Implement: `restart_palworld` = `posted_at=now(UTC)`, `host_ops.start("restart")`, `host_ops.wait("restart", posted_at, timeout_s=300)`, then the existing REST wait on `succeeded`; `HostOpsError` → "Restart failed" embed with `.sentence`, logged with `.detail`. `check_palworld_service` drops the sudo probe. `main()` logs `host_ops.ping()`'s result and continues.
- [ ] **Step 4:** `pytest tests/ -q` → all pass.
- [ ] **Step 5:** Commit `feat: restart the game server through lychee-admin instead of sudo`.

### Task 3: `/update` and removing sudo (swee)

**Files:** Modify `swee/server_update.py`, `swee/config.py` (remove `SWEE_UPDATE_WRAPPER`), `tests/test_server_update.py`; Create `tests/test_no_sudo.py`; Modify `.env.example`/README only where they name the wrapper or sudo.

**Interfaces — Consumes:** Task 1; Task 2's `warn_and_wait` (unchanged). **Produces:** `async update_palworld(on_progress=None) -> discord.Embed` (same signature).

- [ ] **Step 1: Rewrite `tests/test_server_update.py`** with `host_ops`, `rest`, `broadcast_embed`, `warn_and_wait` patched:
  - `test_update_progress_shows_latest_log_line` — `wait` drives `on_line("Update state (0x61) downloading, progress: 64.31")` → `on_progress` called with a message containing that line.
  - `test_update_succeeds_then_waits_for_rest` → title "Server updated".
  - `test_update_failed_shows_last_500_chars` — tail of 700 chars containing "steamcmd" → field value is "…" + last 500 chars in a code block; status says the server was restarted with the existing install.
  - `test_update_stop_failure_retracts` — failed, tail without "steamcmd" (e.g. "Failed to stop palworld-palchuds.service") → `broadcast_embed` called with "Update aborted"; `rest.announce` called with the cancellation text; title "Update failed".
  - `test_update_refused_before_anything_is_announced` — `host_ops.ping` → False → "host control is unavailable right now", `warn_and_wait` not called.
  - `test_update_poll_timeout_is_35_minutes` — `wait` called with `timeout_s=35*60`.
- [ ] **Step 2: Write `tests/test_no_sudo.py`**: `test_no_module_runs_sudo` — for every `swee/*.py` and `main.py`, parse with `ast` and fail on any string constant equal to `"sudo"`; `test_wrapper_setting_is_gone` — `swee.config` has no `SWEE_UPDATE_WRAPPER`.
- [ ] **Step 3:** `pytest tests/ -q` → fails.
- [ ] **Step 4:** Implement: check `host_ops.ping()` before warning anyone (refuse with the unreachable sentence); keep warn, save; `posted_at`, `start("update")`, `wait("update", posted_at, 35*60, on_line=…)` relaying to `on_progress`; `succeeded` → existing REST wait; `failed` → if the tail contains "steamcmd" (case-insensitive) the steamcmd-failure embed, else the stop-failure retraction path. Remove `_REQUIRED_SUDO_GRANTS`, `_missing_sudo_grant`, all subprocess code, and `SWEE_UPDATE_WRAPPER`.
- [ ] **Step 5:** `pytest tests/ -q && python -c "import main"` (CI's dummy env) → pass.
- [ ] **Step 6:** Commit `feat: update the game server through lychee-admin; swee runs no sudo`.

### Task 4: Remove the grant; rotate the audit log (lychee-ops)

**Files:** Modify `roles/swee_host/tasks/main.yml` (the sudoers install at ~:74-81 and the wrapper install at ~:51-58 become `state: absent`), `roles/swee_host/files/sudoers-swee.example` (delete), `group_vars/all.yml` (`swee_update_wrapper` stays only if still referenced; remove if not); Create the logrotate rule in the role that owns `/var/log/lychee-admin` (`roles/lychee_admin_host`), as `templates/logrotate-lychee-admin.j2` → `/etc/logrotate.d/lychee-admin` (0644 root:root); tests in `tests/test_host_operations.yml` or a new `tests/test_swee_host.yml` added to `tests/run.sh`'s list.

- [ ] **Step 1: Tests first:** `swee_host` declares `/etc/sudoers.d/swee` and `/usr/local/sbin/swee-update-palworld` absent; no task in `swee_host` installs either; no file under `roles/` renders a sudoers line granting `swee`; the logrotate file renders exactly the Global Constraints directives for `/var/log/lychee-admin/actions.log`; `/etc/logrotate.d/lychee-admin` is in `watch_files` if the watcher fingerprints other `/etc` drop-ins (follow the existing convention).
- [ ] **Step 2:** Run the focused file → fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Focused file and `tests.test_contract` → pass (the full suite runs in CI).
- [ ] **Step 5:** Commit `fix: swee holds no sudo grant; lychee-admin's audit log rotates`.

## Release stop (operator)

1. swee: push `feat/host-ops-socket`, PR, CI, merge; release-please PR → merge → tag `vX.Y.Z`.
2. lychee-ops PR 1 (`swee_version` → that tag, its own small branch), merge; check on `lychee`: swee restarted, `Groups` include 978 (`swee-api`), startup log says the socket answered; operator `/restart` from Discord → audit line `client:swee` restart started, result file `success`.
3. lychee-ops PR 2 (Task 4's branch), merge; check: `sudo -l -U swee` (operator) lists nothing; wrapper absent; `/etc/logrotate.d/lychee-admin` present and `logrotate -d` clean; operator `/restart` still works; `/update` when convenient.
