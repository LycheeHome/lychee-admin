# lychee-admin built in CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI builds, signs and publishes lychee-admin's runtime tree as an image; lychee verifies it, unpacks it into a root-owned release directory, swaps a `current` symlink, health-checks and rolls back on failure — and never runs `npm`.

**Architecture:** lychee-contract records the new job, image and gate codes. lychee-admin's `ci.yml` gains a `release` job that assembles the tree with `--ignore-scripts`, smoke-tests bcrypt on an older glibc, pushes a `FROM scratch` image tagged `sha-<sha>` and attests it. lychee-ops gains one root-run Python program, `lychee-admin-release`, that does guard → pull → verify → unpack → swap → health → rollback → prune and prints one JSON verdict; the `lychee_admin_app` role keeps its gate, env check, retry counting and status file around it, and `lychee_admin_host` seeds the legacy release and switches the unit.

**Tech Stack:** JSON + Markdown (lychee-contract); GitHub Actions, Bash, Node 22, Docker (lychee-admin); Ansible 2.20 + Jinja, Python 3 stdlib + unittest (lychee-ops); `gh attestation verify`.

**Spec:** `docs/superpowers/specs/2026-10-15-ci-built-release-design.md` (lychee-admin, branch `docs/ci-built-release`).

## Global Constraints

- Contract release **v1.5.0** (additive). New `constants.json` keys exactly: `release_job: "release"`, `release_image: "ghcr.io/lycheehome/lychee-admin"`, `release_tag_format: "sha-{commit}"`, `release_signer_workflow: ".github/workflows/ci.yml"`, `paths.app_release_root: "/usr/local/lib/lychee-admin"`. `gate_codes` gains `image-unavailable`, `provenance-failed`, `host-pending`.
- Image tag: `sha-` + 40 lowercase hex. No `latest`, no other tag. Platform `linux/amd64` only. Tree at `/app`; entry point `/app/dist/server.js`.
- Runtime tree contents: `dist/`, `public/`, `package.json`, `package-lock.json`, `node_modules/` from `npm ci --omit=dev --ignore-scripts`. Nothing else.
- Smoke image: `node:22-bookworm-slim`.
- Release root `/usr/local/lib/lychee-admin`, `root:root 0755`; `releases/<sha>/` and `current -> releases/<sha>` (relative link target). Trees `chown -R root:root`, `chmod -R u=rwX,go=rX`.
- Swap is `symlink current.tmp` + `rename` over `current` (`mv -T` semantics). Never `ln -sfn`, never unlink-then-link.
- Keep 3 releases; never prune the target of `current`, the release rolled back from, or `legacy`.
- Markers: `/var/lib/lychee-ops/lychee-admin/.deployed-sha`, `/var/lib/lychee-ops/lychee-admin/.failed-sha`, in a directory the role creates `root:root 0700`; each is read only if a non-following `stat` shows a regular file owned by uid 0. Retry cap 3, unchanged. The install's unit guard reads the loaded unit (`systemctl show lychee-admin -p ExecStart -p NeedDaemonReload`), not the unit file.
- `gh attestation verify` flags, exactly: `oci://ghcr.io/lycheehome/lychee-admin@sha256:<digest> --bundle-from-oci --repo LycheeHome/lychee-admin --signer-workflow LycheeHome/lychee-admin/.github/workflows/ci.yml --source-ref refs/heads/main --source-digest <sha> --deny-self-hosted-runners`. Env for `gh`: `GH_TOKEN` (when `github_api_token` is set), `DOCKER_CONFIG=/root/.docker`, `XDG_CACHE_HOME`/`XDG_CONFIG_HOME`/`XDG_STATE_HOME` under `/var/lib/lychee-ops/gh`.
- Health check unchanged: `GET http://<HOST>:<PORT>/` answers `401`, 5 tries, 2 s apart.
- `failed_step` wording, exactly: `health check; rolled back to <prev>`, `health check; rollback to <prev> also failed`, `health check; no previous release to roll back to`, `unpack: <reason>`; `<prev>` is the first 8 hex of the previous sha, or `legacy`.
- lychee-contract is public: no host values beyond what `constants.json` already carries.
- No `npm` anywhere in `roles/lychee_admin_app`.
- Branches: `feat/ci-built-release` from `origin/main` in lychee-contract, lychee-admin and lychee-ops (lychee-admin continues on `docs/ci-built-release`, which holds the spec and this plan). Nothing is pushed, tagged or merged by a task. Commit trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Until v1.5.0 is tagged, develop against `LYCHEE_CONTRACT_DIR=~/WebstormProjects/personal/lychee-contract`; `contract.lock` bumps happen in Task 8.

## Review Focus

1. **A leftover unpack container** from a run killed mid-unpack (`lychee-admin-unpack-<sha8>` already exists): the next run must not fail on the name clash. → Task 3 test `test_unpack_removes_stale_container_first`.
2. **`current` points at a release directory that no longer exists** (pruned or deleted by hand): rollback must report it plainly, not crash. → Task 4 test `test_rollback_without_previous_dir`.
3. **`gh` cannot find root's registry credential or a writable cache** under systemd's minimal environment: verification fails as `provenance-failed` on every run while looking like a signature problem. → Task 3 test `test_verify_env` asserts `DOCKER_CONFIG` and the three `XDG_*` variables are passed.
4. **A release whose files lost their exec/read bits** (`docker cp` preserves image modes; a mode-0600 file would be unreadable by `lychee-admin`): the service fails at runtime. → Task 3 test `test_unpack_normalises_owner_and_modes`.
5. **An app run against a host whose unit still runs `/opt/lychee-admin`**: the health check would pass against the old tree and record the new sha as deployed. → Task 3 test `test_guard_blocks_when_unit_not_switched`.

---

### Task 1: lychee-contract v1.5.0

**Files:** Modify `constants.json`, `AGREEMENTS.md`, `README.md` (the constants bullet). Branch `feat/ci-built-release`.

**Interfaces — Produces:** the constants and gate codes in Global Constraints; agreements **A-CI-2** and **A-BUILD-2**; three new A-GATE-1 rows.

- [ ] **Step 1:** Add the five constants and three gate codes to `constants.json` (keep key order: new release keys after `ci_job`, `app_release_root` last in `paths`).
- [ ] **Step 2:** In `AGREEMENTS.md`, add after A-CI-1:
  - **A-CI-2 The release job is named `release`, and the deploy gate requires it green** — lychee-admin's CI has a job named exactly `constants.json` `release_job`; lychee-ops' gate applies A-CI-1's rule to it as well; the job runs only on pushes to `main`, after `test`. Same note as A-CI-1 on `name:` overrides.
  - and after A-BUILD-1, **A-BUILD-2 lychee-admin's release artifact** — image `release_image`, tag `release_tag_format` with `{commit}` the 40-hex lowercase sha, `linux/amd64`, tree at `/app` holding exactly the runtime tree of Global Constraints, entry `dist/server.js`; build provenance signed by `release_signer_workflow` on `refs/heads/main` and pushed to the registry; lychee-ops verifies it before unpacking and installs under `paths.app_release_root` as `releases/<commit>` with a `current` symlink. A-BUILD-1 stays until lychee-ops stops building (a later release removes it under A-GROW-1).
- [ ] **Step 3:** Add A-GATE-1 rows:
  - `lychee_admin_app | could not pull <ref>: … (blocked) | image-unavailable`
  - `lychee_admin_app | provenance check failed: … (blocked) | provenance-failed`
  - `lychee_admin_app | lychee-admin.service does not run from <root>/current yet … (blocked) | host-pending`
  - and widen the two CI rows' producer text from `job test concluded:` to `job test concluded:` or `job release concluded:` (lychee_admin_app only for `release`).
- [ ] **Step 4: Verify.** Run: `python -m unittest declarations.test_validate_declarations && python tools/check_examples.py && python -c "import json;json.load(open('constants.json'))"` — Expected: all pass.
- [ ] **Step 5: Commit** `feat: release job, release artifact and three gate codes (v1.5)`.

---

### Task 2: lychee-admin `release` job

**Files:** Create `scripts/assemble-release.sh`, `scripts/smoke-release.cjs`, `release.Dockerfile`. Modify `.github/workflows/ci.yml`, `src/lib/contractAgreements.test.ts`. Branch `docs/ci-built-release`.

**Interfaces — Produces:** `scripts/assemble-release.sh <out-dir>` (exit 0 with the tree in `<out-dir>`, non-zero naming the missing file); `scripts/smoke-release.cjs`, run as `node /smoke.cjs /app` (exit 0 or a message); job `release`.

- [ ] **Step 1: Write the failing test** in `contractAgreements.test.ts`:

```ts
test("ci.yml has the contract's release job, gated on test and on pushes to main", () => {
  const c = loadContractJson<{ ci_job: string; release_job: string; release_image: string }>("constants.json");
  const wf = yaml.load(fs.readFileSync(".github/workflows/ci.yml", "utf8")) as any;
  const job = wf.jobs[c.release_job];
  assert.ok(job, "release job missing");
  assert.equal(job.name, undefined); // a name: override replaces the reported name
  assert.deepEqual([job.needs].flat(), [c.ci_job]);
  assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.deepEqual(job.permissions, { contents: "read", packages: "write", "id-token": "write", attestations: "write" });
  assert.deepEqual(wf.permissions, { contents: "read" });
  assert.ok(JSON.stringify(job.steps).includes(c.release_image));
});
```

- [ ] **Step 2:** Run `LYCHEE_CONTRACT_DIR=~/WebstormProjects/personal/lychee-contract ./scripts/fetch-contract.sh && npx tsx --test src/lib/contractAgreements.test.ts` — Expected: FAIL, "release job missing".
- [ ] **Step 3: `scripts/assemble-release.sh`** (`set -euo pipefail`): requires `dist/server.js` and `public/style.css` to exist (run after `npm run build`); `rm -rf` then creates `<out-dir>`; copies the four entries of the runtime tree; runs `npm ci --omit=dev --ignore-scripts` in it; fails if `node_modules/bcrypt/prebuilds/linux-x64/bcrypt.glibc.node` is absent.
- [ ] **Step 4: `scripts/smoke-release.cjs`**: `process.chdir(argv[2])`; `require(<tree>/node_modules/bcrypt).compareSync("lychee-smoke", HASH)` must be `true`, where `HASH` is a cost-4 bcrypt hash of `lychee-smoke` generated once and committed as a constant; then `require(<tree>/dist/app)` must not throw. Prints `smoke ok`.
- [ ] **Step 5: `release.Dockerfile`**: `FROM scratch` / `COPY release/ /app/` / `LABEL org.opencontainers.image.source=https://github.com/LycheeHome/lychee-admin`.
- [ ] **Step 6: `ci.yml` job `release`** with the needs/if/permissions of Step 1 and steps: `actions/checkout@v7`; `actions/setup-node@v7` (22); `npm ci`; `npm run build`; `scripts/assemble-release.sh release`; `docker run --rm -v "$PWD/release:/app:ro" -v "$PWD/scripts/smoke-release.cjs:/smoke.cjs:ro" node:22-bookworm-slim node /smoke.cjs /app`; `docker/login-action@v3` to ghcr with `GITHUB_TOKEN`; `docker/build-push-action@v6` with `file: release.Dockerfile`, `context: .`, `platforms: linux/amd64`, `push: true`, `tags: ghcr.io/lycheehome/lychee-admin:sha-${{ github.sha }}`, `id: push`; `actions/attest-build-provenance` (current major) with `subject-name: ghcr.io/lycheehome/lychee-admin`, `subject-digest: ${{ steps.push.outputs.digest }}`, `push-to-registry: true`. Add a comment above the job stating why its name is load-bearing (A-CI-2), mirroring the `test` comment.
- [ ] **Step 7:** Run the test from Step 2 — Expected: PASS. Then `npm run typecheck && npm run lint && npm test`.
- [ ] **Step 8: Local smoke.** `npm run build && scripts/assemble-release.sh "$CLAUDE_JOB_DIR/tmp/release" && docker run --rm -v "$CLAUDE_JOB_DIR/tmp/release:/app:ro" -v "$PWD/scripts/smoke-release.cjs:/smoke.cjs:ro" --platform linux/amd64 node:22-bookworm-slim node /smoke.cjs /app` — Expected: `smoke ok`. (If Docker is unavailable on the dev machine, say so in the report; CI is then the first run.)
- [ ] **Step 9: Commit** `feat: CI builds, signs and publishes the release image`.

---

### Task 3: `lychee-admin-release` — guard, pull, verify, unpack, swap, health, seed

**Files:** Create `roles/lychee_admin_app/files/lychee-admin-release.py`, `tests/test_lychee_admin_release.py`. Modify `tests/run.sh` (add the module to the `unittest` line next to `tests.test_lychee_watch`). lychee-ops branch `feat/ci-built-release`.

**Interfaces — Produces** (Tasks 4, 6, 7 consume):

```python
@dataclass(frozen=True)
class Config:
    root: Path; image: str; sha: str; repo: str; signer_workflow: str
    health_url: str; gh: str; gh_env: dict[str, str]; unit_file: Path; keep: int = 3

Run = Callable[[list[str], dict[str, str] | None], subprocess.CompletedProcess]

def seed(root: Path, legacy: Path) -> bool            # True if it created current
def swap(root: Path, target: str) -> None             # target is "releases/<x>"
def check_health(url: str, tries: int = 5, delay: float = 2.0, sleep=time.sleep, urlopen=None) -> bool
def install(cfg: Config, run: Run, health=check_health) -> dict
```

`install` returns `{"result": "deployed"|"blocked"|"failed", "gate_code": str, "gate": str, "failed_step": str, "running": str}` where `running` is the basename `current` resolves to at return (a sha or `legacy`). CLI: `lychee-admin-release seed --root R --legacy L` and `lychee-admin-release install --root R --image I --sha S --repo O/R --signer-workflow W --health-url U --gh PATH --unit-file F [--keep N]` (gh env from the process env: `GH_TOKEN`, `DOCKER_CONFIG`, `XDG_*`); `install` prints the dict as one JSON line and exits 0; usage errors exit 2.

Outcomes (exact gate strings): unit guard → `blocked`/`host-pending`/`lychee-admin.service does not run from <root>/current yet; waiting for a full run`; pull failure → `blocked`/`image-unavailable`/`could not pull <image>:sha-<sha>: <last stderr line>`; verify failure → `blocked`/`provenance-failed`/`provenance check failed: <last output line>`; unpack failure → `failed`/`ok`/`ok` + `failed_step` `unpack: <reason>`; success → `deployed`/`ok`/`ok`. Health failure is Task 4's; in this task a failed health check returns `failed` with `failed_step` `health check` and no rollback.

- [ ] **Step 1: Write the failing tests** (a `FakeRun` records argv/env and answers by argv prefix; filesystem in a `tempfile.TemporaryDirectory`; the fake `docker cp` materialises a tree with `dist/server.js` and `node_modules/bcrypt/` at the destination, mode 0600 on one file):
  - `test_seed_creates_legacy_and_current` — `current` resolves to `<root>/releases/legacy` → `legacy`; second call returns False and changes nothing.
  - `test_guard_blocks_when_unit_not_switched` — unit file says `ExecStart=/usr/bin/node /opt/lychee-admin/dist/server.js` → `host-pending`, and `FakeRun` saw no `docker` call.
  - `test_pull_failure_blocks` — `docker pull` exits 1 → `image-unavailable`; no `releases/<sha>`.
  - `test_digest_used_after_pull` — `docker image inspect --format {{index .RepoDigests 0}}` answers `ghcr.io/lycheehome/lychee-admin@sha256:abc…`; every later docker/gh argv names that digest reference and none names the tag.
  - `test_verify_argv` — gh argv equals exactly the Global Constraints flag list with the digest and sha substituted.
  - `test_verify_env` — the env passed to gh includes `DOCKER_CONFIG` and the three `XDG_*` keys from `cfg.gh_env`.
  - `test_verify_failure_blocks_and_unpacks_nothing` — gh exits 1 → `provenance-failed`; no `docker create` seen; no `releases/<sha>*`.
  - `test_unpack_removes_stale_container_first` — `docker rm -f lychee-admin-unpack-<sha8>` precedes `docker create --name lychee-admin-unpack-<sha8> <digest-ref> /nonexistent`.
  - `test_unpack_missing_server_fails_and_leaves_nothing` — fake cp omits `dist/server.js` → `failed`, `unpack: dist/server.js missing`; neither `releases/<sha>` nor `.tmp` exists; `docker rm` of the container still ran.
  - `test_unpack_normalises_owner_and_modes` — every file in `releases/<sha>` has mode `0644` (or `0755` if it had any exec bit), every dir `0755` (ownership asserted only when running as root; skip otherwise).
  - `test_existing_release_is_reused` — `releases/<sha>` present → no `docker create`, still verifies first.
  - `test_swap_is_atomic` — patch `os.rename`/`os.replace` to record calls: `current.tmp` is created then renamed onto `current`; `os.unlink` never called on `current`.
  - `test_success` — health stub True → `deployed`, `running == sha`, `systemctl restart lychee-admin` called once.
  - `test_health_failure_without_rollback` — health stub False → `failed`, `failed_step == "health check"` (Task 4 changes this).
  - `test_check_health_wants_401` — a local `http.server` answering 401 → True; answering 200 → False after `tries` attempts with `sleep` stubbed.
- [ ] **Step 2:** Run `tests/.venv/bin/python -m unittest tests.test_lychee_admin_release -v` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the module with the interfaces above; stdlib only; shebang `#!/usr/bin/python3`. Unpack sequence: `docker rm -f` (ignore exit) → `docker create` → `docker cp <c>:/app <root>/releases/<sha>.tmp` → `docker rm` (in `finally`) → normalise owner/modes → existence checks for `dist/server.js` and `node_modules/bcrypt` → `os.rename` to `releases/<sha>`. On any unpack failure `shutil.rmtree` the `.tmp`.
- [ ] **Step 4:** Run Step 2's command — Expected: all PASS.
- [ ] **Step 5: Commit** `feat: lychee-admin-release installs a verified release`.

---

### Task 4: `lychee-admin-release` — rollback, prune, image cleanup

**Files:** Modify `roles/lychee_admin_app/files/lychee-admin-release.py`, `tests/test_lychee_admin_release.py`.

**Interfaces — Consumes:** Task 3. **Produces:** `prune(root: Path, keep: int, protect: set[str]) -> list[str]` (names removed); `install`'s health-failure branch per Global Constraints wording.

- [ ] **Step 1: Write the failing tests:**
  - `test_rollback_restores_previous` — `current` → `releases/<old>`; health False then True → `failed`, `failed_step == f"health check; rolled back to {old[:8]}"`, `running == old`, two restarts.
  - `test_rollback_to_legacy_wording` — previous is `legacy` → `health check; rolled back to legacy`.
  - `test_rollback_also_fails` — health False, False → `health check; rollback to <old8> also failed`, `running == old`.
  - `test_rollback_without_previous_dir` — `current` → `releases/<gone>` that does not exist → `health check; no previous release to roll back to`, `running == sha`, one restart, no exception.
  - `test_no_previous_on_fresh_root` — no `current` before install → same "no previous" wording.
  - `test_prune_keeps_newest_three_and_protected` — five releases with staged mtimes plus `legacy`; `prune(keep=3, protect={a, b})` removes only the oldest unprotected beyond three; never `legacy`; ignores `*.tmp`.
  - `test_prune_runs_after_success_and_after_rollback` — the rolled-back-from release survives a prune after rollback.
  - `test_prune_failure_does_not_change_verdict` — `shutil.rmtree` raising → verdict still `deployed`.
  - `test_image_removed_by_digest` — `docker image rm <digest-ref>` called once after unpack; its failure is ignored.
- [ ] **Step 2:** Run `tests/.venv/bin/python -m unittest tests.test_lychee_admin_release -v` — Expected: the new tests FAIL; `test_health_failure_without_rollback` is deleted in this step (replaced by the rollback tests).
- [ ] **Step 3: Implement** rollback (record `previous` from `os.readlink` before the swap; roll back only if `previous` exists and differs from the target), `prune` (by `st_mtime` of the entry, `lstat` for `legacy` never consulted because it is excluded by name), image removal.
- [ ] **Step 4:** Run Step 2's command — Expected: all PASS.
- [ ] **Step 5: Commit** `feat: lychee-admin-release rolls back and prunes`.

---

### Task 5: the gate requires `test` and `release`

**Files:** Modify `group_vars/all.yml` (`release_job: release` beside `required_check`), `roles/lychee_admin_app/tasks/decide_gate.yml`, `tests/test_lychee_admin_decide_env.yml` (new plays), `tests/test_gate_code.py`, `tests/test_contract.py`.

**Interfaces — Consumes:** `release_job` constant. **Produces:** `lychee_admin_app_gate_conclusions` becomes a dict `{test: [...], release: [...]}`; gate reason names the first failing job in the order `test`, `release`: `job <name> concluded: <list>` with the same `missing` / `in_progress` rendering; `lychee_admin_app_gate_code` `ci-pending` iff every non-success conclusion across both jobs is `in_progress` or missing, else `ci-failed`.

- [ ] **Step 1: Write the failing tests** (plays in `test_lychee_admin_decide_env.yml`, inputs as hand-written `lychee_admin_app_run_jobs`):
  - test success + release missing → blocked, `job release concluded: missing`, `ci-pending`.
  - test success + release in_progress → `ci-pending`.
  - test success + release failure → `job release concluded: failure`, `ci-failed`.
  - test failure + release missing → reason names `test`, `ci-failed`.
  - both success → passes, `ok`.
  - `test_contract.py`: `gv["release_job"] == constants()["release_job"]`.
  - `test_gate_code.py`: widen the frozen reference's prefix check to accept `job release concluded: ` alongside `job test concluded: ` (record in the report that the frozen rule was widened, and why: the producer now emits a second job's reason with the same meaning), and add equivalence fixtures for the release cases above.
- [ ] **Step 2:** Run `mkdir -p tests/.rendered && LYCHEE_CONTRACT_DIR=~/WebstormProjects/personal/lychee-contract tests/.venv/bin/ansible-playbook -i localhost, --connection=local -e ansible_become=false tests/test_lychee_admin_decide_env.yml` and `tests/.venv/bin/python -m unittest tests.test_gate_code tests.test_contract` — Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** in `decide_gate.yml`, keeping the existing comments' guarantees (gather jobs from every run, never `| first`; `.results | default([], true)`).
- [ ] **Step 4:** Re-run Step 2's commands — Expected: PASS, existing plays unchanged.
- [ ] **Step 5: Commit** `feat: the lychee-admin gate requires the release job too`.

---

### Task 6: `lychee_admin_app` installs releases, without npm

**Files:** Modify `roles/lychee_admin_app/tasks/main.yml`, `roles/lychee_admin_app/defaults/main.yml`, `group_vars/all.yml`, `roles/lychee_admin_app/tasks/count_failure.yml` (paths only), `README.md` (recovery: `sudo rm /var/lib/lychee-admin/.failed-sha`; the deploy steps). Create `roles/lychee_admin_app/tasks/decide_release.yml`, `tests/test_lychee_admin_release_role.yml`, `tests/test_lychee_admin_app_static.py`. Add both tests to `tests/run.sh`.

**Interfaces — Consumes:** Task 3/4 CLI and JSON; Task 5 gate facts. **Produces:** group_vars `app_release_root: /usr/local/lib/lychee-admin`, `app_release_image: ghcr.io/lycheehome/lychee-admin`, `app_release_signer_workflow: .github/workflows/ci.yml`, `app_state_dir: /var/lib/lychee-admin`, `gh_version`, `gh_sha256`, `gh_root: /var/lib/lychee-ops/gh`, `lychee_admin_release_bin: /usr/local/lib/lychee-ops/lychee-admin-release`. `decide_release.yml`: consumes `lychee_admin_app_release_out` (the script's parsed JSON) and sets `lychee_admin_app_deploy_result`, `lychee_admin_app_deploy_failed_step`, and — only for `blocked` — `lychee_admin_app_gate_reason`/`lychee_admin_app_gate_code` from the JSON's `gate`/`gate_code`.

- [ ] **Step 1: Write the failing tests:**
  - `test_lychee_admin_app_static.py`: no file under `roles/lychee_admin_app/` contains the token `npm` (word match), `synchronize`, `build_dir` or `src_dir`; `main.yml` contains `git ls-remote` with the deploy key; `.deployed-sha` and `.failed-sha` paths are under `app_state_dir`; the release task passes `--unit-file /etc/systemd/system/lychee-admin.service`; the gh task sets `DOCKER_CONFIG` and the three `XDG_*` from `gh_root`; the `get_url` for gh uses `checksum: "sha256:{{ gh_sha256 }}"`.
  - `test_lychee_admin_release_role.yml`: plays feeding `decide_release.yml` each verdict shape (deployed; blocked image-unavailable; blocked provenance-failed; blocked host-pending; failed with each `failed_step` wording) and asserting the facts; a `blocked` verdict carries its `gate_code` through and is classified by `test_gate_code.py`'s structural check (the reason and code are set in the same mapping).
- [ ] **Step 2:** Run both (commands as in Task 5 Step 2, plus `python -m unittest tests.test_lychee_admin_app_static`) — Expected: FAIL.
- [ ] **Step 3: Implement** `main.yml`, in this order: target via `git ls-remote <app_repo_url> refs/heads/main` (`GIT_SSH_COMMAND` with `-i {{ lychee_admin_app_deploy_key }} -o IdentitiesOnly=yes`), markers read from `app_state_dir`, retry-cap and gate-needed facts (unchanged logic), the two CI queries (unchanged), env read and `decide_env.yml`, `decide_gate.yml`; then when the gate passed and the target is new and not capped: ensure `gh_root` and `{{ gh_root }}/{{ gh_version }}`, `get_url` the `gh_{{ gh_version }}_linux_amd64.tar.gz` release asset with the checksum, `unarchive` it, copy `lychee-admin-release.py` to `lychee_admin_release_bin` (`root:root 0755`), run `install` (`changed_when: true`, `when: not ansible_check_mode`, env as Global Constraints, `--health-url http://{{ lychee_admin_app_env_host }}:{{ lychee_admin_app_env_port }}/`), parse stdout, `decide_release.yml`; write `.deployed-sha` on `deployed`; `count_failure.yml` + write `.failed-sha` on `failed`; clear `.failed-sha` on `deployed`. Keep the no-op/retry-cap/status-write tasks as they are. `gh_version` is the latest `cli/cli` release at implementation time, and `gh_sha256` is that release's `gh_<v>_linux_amd64.tar.gz` line from its published `gh_<v>_checksums.txt`; the comment beside them says how to bump both.
- [ ] **Step 4:** Re-run Step 2's commands, then the whole suite `tests/run.sh tests/test_lychee_admin_release_role.yml` locally only for the focused files (full suite runs in CI) — Expected: PASS, and `ansible-playbook --syntax-check -i inventory.yml playbook.yml` passes.
- [ ] **Step 5: Commit** `feat: lychee_admin_app installs CI-built releases; no npm on the host`.

---

### Task 7: `lychee_admin_host` seeds `current` and switches the unit

**Files:** Modify `roles/lychee_admin_host/tasks/main.yml`, `roles/lychee_admin_host/files/lychee-admin.service`, `tests/test_lychee_admin_app_static.py` (host assertions; rename the class, not the file).

**Interfaces — Consumes:** Task 3's `seed` CLI; `app_release_root`, `lychee_admin_release_bin`.

- [ ] **Step 1: Write the failing tests** (static, on the task list order and the unit text):
  - the unit's `WorkingDirectory=/usr/local/lib/lychee-admin/current` and `ExecStart=/usr/bin/node /usr/local/lib/lychee-admin/current/dist/server.js`; `EnvironmentFile=/opt/lychee-admin/.env` unchanged.
  - in `lychee_admin_host/tasks/main.yml`, the tasks "Ensure the release root exists", "Install lychee-admin-release" and "Seed the legacy release" appear **before** "Install lychee-admin systemd unit".
  - the seed task runs `lychee-admin-release seed --root {{ app_release_root }} --legacy {{ app_install_dir }}` with `changed_when` on the script's output and `when: not ansible_check_mode`.
- [ ] **Step 2:** Run `tests/.venv/bin/python -m unittest tests.test_lychee_admin_app_static -v` — Expected: FAIL.
- [ ] **Step 3: Implement.** `seed` prints `seeded` when it created `current`, nothing otherwise. The release-root task creates `{{ app_release_root }}` and `releases/`, `root:root 0755`. Installing the script here as well as in Task 6's role is intended: a full run reaches the host role first.
- [ ] **Step 4:** Re-run Step 2, `--syntax-check`, and the `--list-tasks` checks in `tests/run.sh` (app run vs full run task lists) — Expected: PASS.
- [ ] **Step 5: Commit** `feat: lychee-admin runs from the release root; the old tree seeds it`.

---

### Task 8: release, verify, observe (operator-gated)

Every step here is outward or on the host; each needs the operator's go-ahead.

- [ ] **Step 1:** lychee-contract PR → merge → tag `v1.5.0`.
- [ ] **Step 2:** lychee-admin: bump `contract.lock` to v1.5.0, PR (spec + plan + release job), merge. Watch the `release` job; then from the dev machine run `gh attestation verify` with the exact Global Constraints flags against the pushed digest — Expected: `✓ Verification succeeded`. Confirm the host still deployed the merge the old way (`deploy-status.json` `deployed`).
- [ ] **Step 3:** lychee-ops: bump `contract.lock`, PR, CI green, merge. After the next full run, read-only on lychee: `readlink /usr/local/lib/lychee-admin/current` (expect `releases/<sha of main>` — or `releases/legacy` until a new lychee-admin commit lands, in which case merge a trivial lychee-admin docs commit to exercise it), `stat -c '%U:%G %a' /usr/local/lib/lychee-admin/releases/*`, `cat /var/lib/lychee-admin/deploy-status.json`, `journalctl -u lychee-reconcile-app.service --since -1h | grep -c npm` (expect `0`), `curl -s -o /dev/null -w '%{http_code}' http://<HOST>:8787/` (expect `401`).
- [ ] **Step 4:** Update memory (`swee-off-sudo-phase1.md` pattern: one file for this sub-project) with what was verified.

---

### Task 9: lychee-admin docs

**Files:** Modify `CLAUDE.md` (Deployment: the reconciler paragraph's build steps, "Builds run as `lychee-admin`", the `.failed-sha` recovery path, the rsync exclusion list; add the release job, provenance check, release root and rollback), `docs/superpowers/specs/2026-10-12-platform-roadmap-design.md` (sub-project 4 done, with date).

- [ ] **Step 1:** Edit; every changed sentence describes what Task 8 verified, not what the plan intended.
- [ ] **Step 2:** `npm run lint` — Expected: pass.
- [ ] **Step 3: Commit** `docs: lychee-admin is built in CI and installed as a verified release`.

---

### Task 10 (later, after a few days of clean deploys): cleanup

- [ ] lychee-ops: a task in `lychee_admin_host` that, only when `readlink current` is `releases/<sha>` and that sha equals `/var/lib/lychee-admin/.deployed-sha`, removes `releases/legacy`, every entry of `/opt/lychee-admin` except `.env`, `build_dir`, `src_dir` and `/var/lib/lychee-ops/.npm`; tests for both the refuse and the act paths (static + a playbook play against a temp root).
- [ ] lychee-contract: remove A-BUILD-1 (v1.6.0 under A-GROW-1, or v2.0.0 if a consumer still reads it); lychee-admin and lychee-ops bump their pins.
- [ ] Host check: `ls -A /opt/lychee-admin` shows only `.env`; `/var/lib/lychee-ops/.npm`, `build` and `src/lychee-admin` absent.
