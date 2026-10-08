# Prune Retired Declarations — Reconciler Plan (1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a retired site's declaration is deleted, the reconciler removes its rendered project and status file on proof that nothing runs, then deletes its system account on proof that the account owns nothing.

**Architecture:** All in `LycheeHome/lychee-ops`. A cleanup step in `reconcile.yml` (testable, uses the existing docker stand-in) removes directories before drift is computed. Account deletion lives in host-only `main.yml` after the reconcile import, driven by a pure candidate expression in its own task file that the suite can import.

**Tech Stack:** Ansible (core 2.20.1, pinned — do not bump), Docker Compose. Tests: `./tests/run.sh </dev/null` (6–40 minutes; slow, not hung).

**Spec:** `lyly-admin/docs/superpowers/specs/2026-10-08-prune-retired-declarations-design.md`

## Global Constraints

- Directory cleanup requires **both**: last `status.json` shows (`action: down`, `result: deployed`, `installed_tag: none`) or (`result: awaiting-image`, `installed_tag: none`); **and** `docker compose -p <name> ps -a -q` prints nothing.
- A name with a valid declaration this tick is never cleaned and never an account candidate.
- Names are filtered by the existing fullmatch name rule `[a-z0-9][a-z0-9-]{0,62}` before any path is built; account candidates additionally match the site pattern `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-lyly-dev`.
- Account deletion requires: no declaration, no remaining project or status directory, `pgrep -u <uid>` finds nothing, and `timeout 120 find / -xdev \( -uid <uid> -o -gid <gid> \) -not -path '/proc/*' -not -path '/sys/*' -not -path '/run/*' -print -quit` prints nothing and exits 0. Then `userdel <name>`.
- At most **one** account deletion attempt per tick. Any failure keeps the account, logs why, and never fails the tick.
- `down` never carries `-v`; `palsave-api` and every declared resource are untouched; drift reporting is otherwise unchanged.

## Review Focus

1. **A status file that is malformed JSON or missing** for an undeclared project — must be kept as drift, never cleaned, never raise. *(Task 1)*
2. **A docker stand-in that errors** (compose ps non-zero) — treat as "cannot prove", keep as drift. *(Task 1)*
3. **An account that shares the site name but is not a site's** (e.g. someone hand-created `x-lyly-dev` with a home) — still only deleted on proof; the find proof covers its home. Candidate selection must not care about home/shell. *(Task 2: covered by the proof, test that selection picks it and the proofs are what gate it — host-verified)*
4. **A re-added site in the same tick its account is a candidate** — the valid-set check must exclude it. *(Task 2)*
5. **Two orphaned accounts** — exactly one candidate per tick, deterministically (sorted). *(Task 2)*

---

### Task 1: Clean up undeclared, proven-down projects

**Files:**
- Create: `roles/resources_reconcile/tasks/cleanup_retired.yml`
- Modify: `roles/resources_reconcile/tasks/reconcile.yml` (inside "Apply the declared set", before "Find rendered projects")
- Test: `tests/test_resources_render.yml` (new plays) — or `tests/test_cleanup_retired.yml` appended to `tests/run.sh`'s final `exec` line

**Interfaces:**
- Consumes: `resources_reconcile_valid` (validated declarations), `lychee_resources_dir`, `resources_reconcile_status_dir`, `resources_reconcile_docker`.
- Produces: fact `resources_reconcile_cleaned` — sorted list of names whose directories were removed this tick.

- [ ] **Step 1: Write failing plays** (temp dirs for both roots, docker stand-in as existing tests use):
  - undeclared `old-lyly-dev` with status `{action: down, result: deployed, installed_tag: none}` and stand-in `ps -a -q` printing nothing → both dirs removed, `old-lyly-dev` in `resources_reconcile_cleaned`, absent from `drift.json`;
  - undeclared `never-lyly-dev` with `{result: awaiting-image, installed_tag: none}`, no project dir → status dir removed, cleaned;
  - undeclared with `{action: up, result: deployed, installed_tag: 0.1.0}` → kept, listed in drift;
  - undeclared, status proves down, but stand-in `ps` prints an id → kept, in drift;
  - undeclared, stand-in `ps` exits non-zero → kept, in drift;
  - undeclared, status file malformed JSON → kept, in drift, tick does not fail;
  - declared `palsave-api` → untouched.
- [ ] **Step 2: Run** `./tests/run.sh </dev/null` — Expected: new plays FAIL.
- [ ] **Step 3: Implement** `cleanup_retired.yml`: candidates = (names of dirs under both roots, name-rule filtered) − valid names; per candidate in a `block`/`rescue` that records nothing on failure: read status (slurp, `from_json` inside the block), run compose `ps -a -q` (`failed_when: false`, require rc 0 and empty stdout), then `file: state=absent` on both dirs. Include it from `reconcile.yml` before drift detection. Comment the two-proof rule and why failure keeps drift.
- [ ] **Step 4: Run** `./tests/run.sh </dev/null` and the syntax check (`tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml`, `ANSIBLE_COLLECTIONS_PATH=$PWD/tests/.collections`) — Expected: PASS.
- [ ] **Step 5: Commit** `feat: clean up retired resources proven down`

---

### Task 2: Delete a pruned site's account on proof

**Files:**
- Create: `roles/resources_reconcile/tasks/select_account_candidate.yml` (pure; imported by tests)
- Create: `roles/resources_reconcile/tasks/delete_site_account.yml` (host-only steps)
- Modify: `roles/resources_reconcile/tasks/main.yml` (after the "Reconcile" import)
- Test: new plays importing `select_account_candidate.yml`

**Interfaces:**
- Consumes: `resources_reconcile_valid`, `resources_reconcile_passwd` (getent: name → [pw, uid, gid, ...]), directory listings of both roots.
- Produces: fact `resources_reconcile_account_candidate` — a name or `''`.

- [ ] **Step 1: Write failing plays** for `select_account_candidate.yml`:
  - passwd has `old-lyly-dev`, no declaration, no dirs → candidate `old-lyly-dev`;
  - same but a declaration `old-lyly-dev` in the valid set → `''`;
  - same but `/etc/lychee-resources/old-lyly-dev` still exists → `''`;
  - passwd has `palsave-api`, `byron`, `steam` with no declarations → `''`;
  - passwd has `b-lyly-dev` and `a-lyly-dev`, both eligible → `a-lyly-dev` (sorted, exactly one);
  - a name failing the site pattern (`A-lyly-dev`) → `''`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** `select_account_candidate.yml` (pure `set_fact`). Implement `delete_site_account.yml` for one candidate in a `block`/`rescue` that logs and never fails: `pgrep -u <uid>` (rc 1 = none; any match → skip), the `timeout 120 find …` from Global Constraints (`failed_when: false`; proceed only on rc 0 and empty stdout; rc 124 = timeout → skip with that reason), then `ansible.builtin.user: name=<n> state=absent remove=false`. In `main.yml`, after the reconcile import: re-read `getent passwd`, include `select_account_candidate.yml`, then `delete_site_account.yml` when the candidate is non-empty. Comment why accounts may be deleted now and exactly what proves it (the github-runner lesson), and that this replaces the old "never delete" comment near account creation — update that comment too.
- [ ] **Step 4: Run** suite + syntax check — Expected: PASS.
- [ ] **Step 5: Commit** `feat: delete a pruned site's account once it owns nothing`

---

## After merge (operator, on lychee)

Verification is plan 2's end-to-end step (retire, prune, watch). Before it, one tick after merge: `journalctl -u lyly-reconcile -n 100` clean; `drift.json` `[]`; palsave-api `deployed 0.3.0`; test-lyly-dev unchanged.
