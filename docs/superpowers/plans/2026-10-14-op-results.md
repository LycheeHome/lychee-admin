# Host-action results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host action's result survives systemd unloading its unit, so a successful run reads `succeeded` with its times on the board and over the socket.

**Architecture:** Each `lychee-op-<unit>-<action>.service` runs a root recorder as its first `ExecStopPost`, writing `/var/lib/lychee-op/<unit>-<action>.result.json`; lychee-admin asks systemd only whether a run is active, and reads the file for the last result.

**Tech Stack:** JSON Schema + Python (lychee-contract), Ansible + POSIX sh (lychee-ops), TypeScript/Express + `tsx --test` (lychee-admin).

**Spec:** `docs/superpowers/specs/2026-10-14-op-results-design.md` (amends `2026-10-13-host-operations-design.md`).

## Global Constraints

- Result file: `/var/lib/lychee-op/<unit>-<action>.result.json`, `0640 root:lychee-admin`, written atomically (temp file in the same directory, then `mv`).
- Shape: `{"unit","action","result","exit_status","started_at","finished_at"}`; `result` = `$SERVICE_RESULT` verbatim (non-empty, `^[a-z][a-z-]*$`); `exit_status` integer or `null`; times ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`) or `null`.
- Recorder: `/usr/local/sbin/lychee-op-record`, root:root `0700`, arguments `<unit> <action>`; the **first** `ExecStopPost` of every op service, prefixed `-`.
- Contract release is **v1.3.0** (additive: new schema, new constant `op_result_path`, A-OPS-1 **Result** entry). lychee-contract is public: no HOST.md values.
- Result files are never in `watch_files`.
- lychee-admin: an unreadable or schema-invalid file is absent, never an error; state table is the spec's, exactly.
- Each repo on branch `feat/op-results` from its `origin/main`. Commits carry `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Nothing is pushed by a task.

## Review Focus

1. **The recorder must not break the update's restart guard**: a recorder that fails (bad JSON, full disk, systemctl missing) still lets the guard's `ExecStopPost` run. → Task 2 asserts order and the `-` prefix in every rendered service, and runs the recorder with a failing fake `systemctl`.
2. **A run killed by timeout or signal** records `result` other than `success` and `exit_status` `null` when `$EXIT_STATUS` is empty. → Task 2 runs the recorder with `SERVICE_RESULT=timeout` and no `EXIT_STATUS`.
3. **systemd prints no timestamp** (`n/a` or empty): the field is `null`, never a malformed string. → Task 2.
4. **A stale result while a new run is active**: systemd's `running` wins; the file is not read. → Task 3.
5. **A result file for another action, or garbage in it** (wrong unit/action, invalid JSON, wrong types): treated as absent. → Task 3.

---

### Task 1: lychee-contract v1.3.0 (repo lychee-contract)

**Files:** Create `schemas/op-result.schema.json`, `examples/` valid/invalid op-result cases (follow the repo's existing example layout); Modify `constants.json` (`op_result_path`), `AGREEMENTS.md` (A-OPS-1 **Result** entry), `README.md` (file list), and whatever validator/test lists schemas.

**Interfaces — Produces:** `op_result_path` = `/var/lib/lychee-op/{unit}-{action}.result.json`; the schema above with `additionalProperties: false`.

- [ ] Invalid examples first (unknown key; `result` empty or uppercase; `exit_status` a string; a time without `Z`) and valid ones (success with times; timeout with `exit_status` null and times null); run the repo's check → invalid ones must fail to be rejected (RED) → add schema/constant → GREEN.
- [ ] Commit `feat: op-result schema and A-OPS-1 Result entry (v1.3)`.

### Task 2: lychee-ops recorder (repo lychee-ops)

**Files:** Create `roles/host_operations/templates/lychee-op-record.sh.j2` (or `files/`); Modify `roles/host_operations/templates/lychee-op.service.j2` (first `ExecStopPost=-/usr/local/sbin/lychee-op-record <unit> <action>`), `roles/host_operations/tasks/main.yml` / `render.yml` (install `0700 root:root`), `contract.lock` → the local v1.3 commit (re-pointed at release), `tests/test_host_operations.yml`.

**Interfaces — Consumes:** Task 1's schema. **Produces:** the file per Global Constraints.

- [ ] Tests first in `tests/test_host_operations.yml`: every rendered op service has the recorder as its first `ExecStopPost` with `-`; the update service's guard comes after it; the recorder rendered to a temp dir and run with a fake `systemctl` (PATH) and env → for `SERVICE_RESULT=success EXIT_STATUS=0` with timestamps it writes exactly the expected JSON; for `SERVICE_RESULT=timeout` with no `EXIT_STATUS` and `n/a` timestamps it writes `exit_status: null` and times `null`; with a failing fake `systemctl` it exits non-zero and leaves any previous file intact; each output validates against the contract schema (`tests/check_rendered.py` or the contract tool); the result path is not in `watch_files`.
- [ ] Implement in POSIX sh (no jq on the host unless already declared — check); write temp then `mv`; `chown root:lychee-admin`, `chmod 0640`.
- [ ] Run `tests/test_host_operations.yml` with `LYCHEE_CONTRACT_DIR` set; commit `feat: action services record their result as they exit`.

### Task 3: lychee-admin reader (repo lychee-admin)

**Files:** Modify `src/lib/hostOperations.ts` (state from systemd + result file per the table), `src/lib/platform.ts` (`opResultPath`, validated like `opLogPath`), `src/dev/fakes.ts` (fakes write a result on finish and model unload: after finishing, the fake op unit reads as a fresh load), `contract.lock` → local v1.3 commit; tests beside each.

**Interfaces — Consumes:** Task 1's shape; `opUnitName`, `readOpUnits`, `FileSystem`. **Produces:** unchanged `ActionState` shape; `succeeded`/`failed` now carry times from the file.

- [ ] Tests first: each row of the spec's table; Review Focus 4 and 5; the fake models GC so a dev-mode run ends `succeeded`; the board's last-run line shows a succeeded run after its unit is "unloaded".
- [ ] Implement; `npm run typecheck && npm run lint && LYCHEE_CONTRACT_DIR=… npm test && npm run build`; commit `fix: host-action state survives systemd unloading the unit`.

## Release stop (operator)

Contract PR → merge commit → confirm tree → tag `v1.3.0` → re-point both locks → PRs (lychee-ops, then lychee-admin) → merges → one board restart → board and swee's socket read `succeeded` with times; the result file exists.
