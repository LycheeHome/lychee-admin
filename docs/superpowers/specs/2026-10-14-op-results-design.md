# Host-action results that outlive their unit

Date: 2026-10-14. Status: approved (operator: "go ahead and build it").
Amends `2026-10-13-host-operations-design.md`. Spans lychee-contract,
lychee-ops and lychee-admin.

## Why

Verifying host operations on `lychee` found that systemd garbage-collects a
finished, unreferenced oneshot unit. After the operator's board restart on
2026-10-14 at 15:14:58, `lychee-op-palworld-palchuds-restart.service` was absent
from `systemctl list-units --all`, and `systemctl show` loaded it afresh: an
empty `InvocationID`, every timestamp empty, `Result=success`. So:

- a **successful** action reads `idle`, never `succeeded`, and its start and
  finish times are lost;
- a **failed** one stays loaded (`failed` is not collected) and survives.

The board waits a few polls, reloads, and shows no last-run line; swee would
see `running` turn into `idle`. The host-operations spec's "the state reads
`succeeded`" is not met. No test could see it, because the dev fakes keep state
in memory.

## Design

**The action service records its own result**, so it is recorded however the
run was started: the board, swee, a future timer, or a person running
`systemctl start` by hand.

### lychee-ops

- `/usr/local/sbin/lychee-op-record` (root:root `0700`), installed by
  `host_operations`, runs as each action service's **first** `ExecStopPost`,
  prefixed `-` so its own failure cannot stop the commands after it. It takes the
  unit and the action as arguments, reads `$SERVICE_RESULT` and `$EXIT_STATUS`
  from systemd, reads its own unit's `ExecMainStartTimestamp` and
  `ExecMainExitTimestamp` (the unit is still loaded during `ExecStopPost`), and
  writes the result file atomically (a temporary file in the same directory,
  then a rename).
- The update service's existing restart guard stays and runs after the
  recorder; a killed update therefore records `failed` and still restarts
  Palworld.
- The result files are runtime state and are **not** in `watch_files`.

### The result file

`/var/lib/lychee-op/<unit>-<action>.result.json`, `0640 root:lychee-admin`:

```json
{"unit":"palworld-palchuds","action":"restart","result":"success",
 "exit_status":0,"started_at":"2026-10-14T15:14:58Z","finished_at":"2026-10-14T15:14:58Z"}
```

- `result`: systemd's `$SERVICE_RESULT` verbatim (`success`, `exit-code`,
  `timeout`, `signal`, `core-dump`, `watchdog`, `start-limit-hit`,
  `resources`, `protocol`, `oom-kill`, ...): a non-empty lowercase word.
- `exit_status`: an integer, or `null` when the process never exited normally.
- `started_at`, `finished_at`: ISO 8601 UTC, or `null` when systemd had none.

### lychee-contract v1.3.0 (additive)

- A-OPS-1 gains a **Result** entry: the path, owner and mode, that the action
  service writes it on every exit, and that a reader treats an unreadable or
  invalid file as absent.
- `schemas/op-result.schema.json`; `constants.json` gains
  `op_result_path` (`/var/lib/lychee-op/{unit}-{action}.result.json`).
- Minor, not patch: a new schema is new surface.

### lychee-admin

`readActionState` (and the batched board read):

| systemd ActiveState | result file | state |
|---|---|---|
| `activating`, `active`, `deactivating` | not read | `running` |
| otherwise | `result` is `success` | `succeeded`, with its times |
| otherwise | any other `result` | `failed`, with its times |
| `failed` | absent | `failed` |
| otherwise | absent | `idle` |

An unreadable or invalid file is absent, never an error. The board's last-run
line and the socket API both report this state.

## Known limit

If two actions race on one unit, the loser's `flock -n` fails and it records
`failed`, overwriting that action's previous result. Rare; recorded as a minor
in the host-operations review already. An append-only history would remove it,
and the file's shape is chosen so that is an extension rather than a change.

## Rollout

1. lychee-contract v1.3.0.
2. lychee-ops: recorder and `ExecStopPost`.
3. lychee-admin: the reader.
4. Operator: one board restart; the board and swee's socket read `succeeded`
   with times, and the result file exists.

lychee-admin treats an absent file as today's behaviour, so 2 and 3 may merge in
either order.

## Future uses (not built)

Run history (append instead of overwrite), failure alerting from the same hook
point, swee reporting outcomes to Discord through the API, and the reconciler
publishing each unit's last action result in the inventory.
