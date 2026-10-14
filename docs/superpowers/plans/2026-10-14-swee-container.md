# swee as a container Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** swee runs as a reconciler-managed container from a ghcr image, its host account loses `adm`, and releasing it is a tag plus Deploy.

**Architecture:** The contract and lychee-ops gain four declaration capabilities (`env:`, `secrets_file`, `network: host`, four swee-only mount aliases including the first read-write one) and a root forwarder that copies only the game unit's journal lines to a file. swee gains an image, a publish job, a file-based log tailer and a heartbeat. A single ordered reconcile run retires the host unit, migrates state into the volume and starts the container.

**Tech Stack:** JSON Schema + Python (lychee-contract), Ansible + Jinja + Python validator (lychee-ops), YAML data (lychee-resources), Python 3.14 + Docker + GitHub Actions (swee).

**Spec:** `docs/superpowers/specs/2026-10-14-swee-container-design.md` (lychee-admin, branch `docs/swee-container`).

## Global Constraints

- Contract release **v1.4.0** (additive). lychee-contract is public: host paths appear only as `group_vars` variable names, never literal (as `palworld_saves` does).
- `env:` keys `^[A-Z][A-Z0-9_]*$`, values strings. `secrets_file: true` → `env_file: /etc/lychee-secrets/<name>.env`, required `0600 root:root`; deploy refused otherwise; prune never deletes it.
- `network: host` → `network_mode: host`; allowed only for resources the vocabulary lists (`swee`); `port` optional exactly when `network: host` is set, required otherwise.
- Aliases (all `allowed_resources: [swee]`): `palworld_events` ro → `/palworld-events`, group `palworld-events`; `palworld_config` **rw** (`mode: rw`) → `/palworld-config`, group `palworld`; `unattended_upgrades_log` ro → `/var/log/unattended-upgrades`, group `adm`; `host_ops_socket` ro → `/run/lychee-admin/clients/swee`, group `swee-api`. A read-write alias requires `mode: rw` and exactly one allowed resource.
- Forwarder: `palworld-events.service`, root, `journalctl -u <palworld_service> -f -n 0 -o json --output-fields=MESSAGE,__REALTIME_TIMESTAMP` → `/var/log/palworld-events/palworld.jsonl`; dir `0750 root:palworld-events`; `Restart=on-failure`; logrotate daily, `rotate 3`, `copytruncate`, `missingok`, `notifempty`. Group `palworld-events` holds exactly `swee`.
- palsave-api's rendered compose file stays **byte-identical** through every step.
- swee image: `FROM python:3.14-slim`, `USER 993:980`, `ENTRYPOINT ["python", "main.py"]`, `HEALTHCHECK` on `/state/heartbeat` (rewritten every 30 s after login; unhealthy if older than 90 s). Image `ghcr.io/lycheehome/swee:X.Y.Z` (tag without `v`), label `org.opencontainers.image.source`.
- Cutover order in one run: swee host unit stopped and disabled **before** the container starts; `/var/lib/swee/*.json` copied into volume `swee_swee_state` once, only if empty. `/opt/swee` and `/var/lib/swee` stay on disk.
- Branches: each repo `feat/swee-container` from `origin/main` (lychee-ops: two branches — `feat/swee-container-capabilities` for PR A, `feat/swee-container-cutover` for PR B). Nothing pushed by a task. Commit trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; swee uses Conventional Commit titles.

## Review Focus

1. **A second swee instance** (host unit still running when the container starts, or a rollback that re-enables the unit while the container runs): two bots on one token double-post every event. → Task 5 test `the host unit is stopped before resources_reconcile starts swee`; Task 5 asserts the container declaration and the host unit can never both be enabled by the same run.
2. **The forwarder restarts or the file rotates** while swee tails it: swee must not replay old joins (start at end, reopen on shrink/replace) and must not stop relaying. → Task 4 test `test_tailer_reopens_after_copytruncate` and `test_tailer_starts_at_end`.
3. **A missing or loose secrets file** (absent, 0644, owned by a user): the container must not start half-configured. → Task 3 test: deploy refused, status names the file.
4. **palsave-api changes behaviour** because the template's hard-coded env moved to declarations. → Task 3 asserts byte-identical rendering with and without the declaration's new `env:` during the transition.
5. **The read-only root filesystem** breaks a library that writes to `/tmp` or `$HOME`. → Task 4's CI smoke run starts the image read-only with dummy settings; if it fails, Task 3's `tmpfs: /tmp` option is required and Task 4 records it.

---

### Task 1: lychee-contract v1.4.0

**Files:** Modify `declarations/validate_declarations.py`, `declarations/vocabulary.yml`, `declarations/test_validate_declarations.py`, `AGREEMENTS.md` (the declarations agreement and A-OPS-1's socket note), `README.md`; add examples under `examples/declarations/` (valid/invalid layout as existing).

**Interfaces — Produces:** declaration fields `env` (map), `secrets_file` (bool), `network` (`"host"` only); vocabulary alias fields `mode` (`ro` default | `rw`), plus a top-level `network_host_allowed: [swee]`; the four aliases per Global Constraints with `source` as a `group_vars` variable name.

- [ ] **Step 1: Tests first** in `test_validate_declarations.py`: valid `swee.yml` with all four aliases, `network: host`, no `port`, `env`, `secrets_file`; invalid: lowercase env key, non-string env value, `network: host` for `palsave-api`, `network: bridge`, `port` missing without `network: host`, `palworld_config` on palsave-api, a vocabulary rw alias without `mode: rw` or with two allowed resources. Existing palsave-api example still valid.
- [ ] **Step 2:** run the repo's tests → fail.
- [ ] **Step 3:** implement; document in `AGREEMENTS.md`.
- [ ] **Step 4:** tests and `tools/check_examples.py` pass.
- [ ] **Step 5:** Commit `feat: env, secrets_file, network: host and swee's mount aliases (v1.4)`.

### Task 2: swee's identity and the forwarder (lychee-ops, PR A branch)

**Files:** Create role `roles/palworld_events/` (tasks, templates `palworld-events.service.j2`, logrotate template); Modify `playbook.yml` (host role, before `resources_reconcile`), `group_vars/all.yml` (`service_identities.swee` with swee's existing uid/gid; the group's name and members), `group_vars`/`watch_files` per the existing convention; tests `tests/test_palworld_events.yml` added to `tests/run.sh`.

**Interfaces — Produces:** `/var/log/palworld-events/palworld.jsonl`; group `palworld-events` = `{swee}` exactly (enforced like `<client>-api`, never touching swee's other groups); `service_identities.swee`.

- [ ] **Step 1: Tests first**: the unit renders with exactly the Global Constraints command, `User=` absent (root), `Restart=on-failure`; the logrotate rule renders exactly; the directory is `0750 root:palworld-events`; group membership task adds swee with `append: true` and removes any other member; `service_identities.swee` present.
- [ ] **Step 2:** focused run → fails.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** focused runs pass (`tests/test_palworld_events.yml`, `tests/test_host_operations.yml`).
- [ ] **Step 5:** Commit `feat: a forwarder for the game server's journal lines, readable by swee alone`.

### Task 3: Declaration capabilities in the reconciler (lychee-ops, PR A branch)

**Files:** Modify `roles/resources_host/files/validate_declarations.py` and `mounts.yml` (kept identical to the contract's copies — the existing test that compares them must pass), `roles/resources_host/templates/docker-compose.yml.j2`, `roles/resources_reconcile/tasks/` (`render_one.yml`/`apply_state.yml`: the secrets-file check), `contract.lock` → local v1.4 commit; tests `tests/test_resources_render.yml`.

**Interfaces — Consumes:** Task 1's fields and vocabulary; Task 2's identity. **Produces:** compose output with `environment:` from `env:`, `env_file:`, `network_mode: host` (and no `ports:`), alias volumes with `:ro`/`:rw`, `group_add` from alias groups; status `failed` with a gate naming `/etc/lychee-secrets/<name>.env` when the file is missing or not `0600 root:root`.

- [ ] **Step 1: Tests first**: render a swee declaration and assert each element; render palsave-api with and without an `env:` equal to today's three and assert the compose file is byte-identical to today's in both cases (transition: the template renders `env:` when declared, else the three palsave-api variables — removed in Task 5); secrets file missing / `0644` / non-root owner → refused with the named gate, compose never invoked; `tmpfs: /tmp` emitted only if Task 4 needs it (leave a flag defaulting off, tested both ways).
- [ ] **Step 2:** focused run → fails.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** `tests/test_resources_render.yml`, `tests.test_contract` pass.
- [ ] **Step 5:** Commit `feat: resources declare env, a secrets file, host networking and swee's mounts`.

### Task 4: swee's image (swee)

**Files:** Create `Dockerfile`, `.dockerignore`, `swee/heartbeat.py`; Modify `swee/log_tailer.py`, `swee/config.py` (`PALWORLD_EVENTS_FILE`, `UNATTENDED_UPGRADES_LOG`), `swee/cause_detection.py` (use the setting), `swee/restart.py`/`main.py` (drop `systemctl show`), `.github/workflows/ci.yml` (image build + read-only smoke run on PRs; `publish-image` job gated on release-please's `release_created`), `.env.example`, `README.md`/`docs/deployment.md`; tests.

**Interfaces — Produces:** image runnable read-only as `993:980` with `/state` writable; `PALWORLD_EVENTS_FILE` default `/palworld-events/palworld.jsonl`.

- [ ] **Step 1: Tests first**: `test_tailer_starts_at_end` (pre-existing lines not emitted); `test_tailer_follows_appends`; `test_tailer_reopens_after_copytruncate` (file truncated then appended → new lines emitted once); `test_tailer_reopens_after_replace` (new inode); `test_heartbeat_written_only_after_login`; `test_no_systemctl_anywhere` (no `"systemctl"` string constant in `swee/*.py` or `main.py`).
- [ ] **Step 2:** `pytest` → fails.
- [ ] **Step 3:** implement; tailer keeps the JSON line parse unchanged (`MESSAGE`, `__REALTIME_TIMESTAMP`).
- [ ] **Step 4:** `pytest` passes; `docker build .` succeeds; `docker run --read-only --tmpfs /tmp`-free smoke with dummy env reaches the point where it would log in (or exits only on the dummy token) — record whether `/tmp` was needed and tell Task 3's flag.
- [ ] **Step 5:** Commit `feat: swee ships as an image and reads the game server's events from a file`.

### Task 5: The cutover (lychee-ops PR B branch, lychee-resources)

**Files (lychee-ops):** `roles/swee_host/` and `roles/swee_app/` become retirement roles (stop, disable, remove the unit and its handlers; keep `/opt/swee`, `/var/lib/swee`), modelled on `roles/palsave_api_host`; a state-migration task (docker volume `swee_swee_state`: create if absent, copy `/var/lib/swee/*.json` only when the volume is empty, files owned `993:980`) running after the unit stops and before `resources_reconcile`; remove `adm` from swee (`gpasswd -d`, guarded); `group_vars/all.yml` drops `swee_version` and swee_app vars; `roles/inventory/defaults/main.yml` swee entry → container; the template's palsave-api env fallback removed; `playbook.yml` order comments. **Files (lychee-resources, branch `feat/swee`):** `swee.yml` per the spec; `palsave-api.yml` gains its three `env:` entries (lands with PR A's release, before PR B).

- [ ] **Step 1: Tests first**: playbook order puts the unit stop and the migration before `resources_reconcile`; migration copies only into an empty volume (non-empty → no copy, logged); no task adds `adm`, one removes it; `swee_version` absent; inventory swee entry is `kind: container`; palsave-api renders byte-identical with its declared `env:` and no fallback; the swee declaration validates and renders.
- [ ] **Step 2:** focused runs → fail.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** focused runs pass.
- [ ] **Step 5:** Commits `feat: swee runs as a container; its host roles retire` (lychee-ops) and `feat: swee, and palsave-api's env made explicit` (lychee-resources).

## Release stop (operator)

1. lychee-contract PR → merge commit → tag `v1.4.0` → re-point locks.
2. lychee-ops PR A (Tasks 2–3) + lychee-resources `palsave-api.yml` env → merge; check palsave-api unchanged, forwarder writing, `id swee` gains `palworld-events`.
3. swee PR (Task 4) → release v2.13.0 → image on ghcr; lychee-ops `swee_version: v2.13.0` (host service) → relay works from the forwarder file.
4. Operator places `/etc/lychee-secrets/swee.env`.
5. lychee-ops PR B + lychee-resources `swee.yml` → merge; check: host unit inactive, container healthy, `id swee` without `adm`, a join relayed, chat answered, `/restart`, `/config set`, `/update`.
