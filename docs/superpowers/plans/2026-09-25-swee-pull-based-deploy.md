# swee Pull-Based Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `swee` stops deploying through the self-hosted GitHub Actions runner. `lychee` deploys it from `lychee-ops` on the existing 5-minute reconcile timer instead.

**Architecture:** A `swee_app` role in `lychee-ops`, mirroring the `lyly_admin_app` role already running in production. It resolves `swee`'s newest GitHub **release**, gates on that commit's `test` job being green, builds the venv as the `swee` user, restarts the unit, and confirms the bot actually reached Discord. `swee`'s own CI loses its `deploy` job and gains the `test` job the gate needs.

**Tech Stack:** Ansible (`ansible-pull`), systemd, Python venv, GitHub Actions (test only), GitHub REST API for releases and the CI gate.

**Spec:** `docs/superpowers/specs/2026-09-25-managed-services-design.md` — slice 1 of its decomposition.

## Global Constraints

- **`swee` is a host agent, not a container.** It runs `sudo systemctl restart palworld`, reads `/proc/meminfo`, shells to `steamcmd`, and reads files under `/home/steam`. Do not containerize it; the spec explains why that would be decorative.
- **Release-gated, not push-gated.** `swee` deploys today only when release-please cuts a release. Preserve that: the reconciler deploys the newest release tag, never `main`'s HEAD. Changing deploy cadence is not what this slice is for.
- **The gate must be real.** `swee` has 7 test files, no pytest config, no test dependency, and nothing in CI running them. Gating on today's CI would gate on release-please alone. Task 1 fixes that first, deliberately.
- Every role-set fact and role default takes the `swee_app_` prefix. `ansible-lint` enforces this at the `production` profile and **suppressions are forbidden** — a `# noqa` is a defect, report it.
- Secrets stay where they are. `swee`'s `.env` is hand-placed on the host and must never be written, read, or moved by this work.
- Two repos are touched: `LycheeHome/swee` and `LycheeHome/lychee-ops`. Neither is `lyly-admin`.

## Testing Note

There is no unit-test harness for a playbook. As in the `lyly-admin` deploy project, the substitutes are:

1. `ansible-playbook --syntax-check` and `ansible-lint` at the `production` profile
2. `--check --diff`, scoped away from tasks that cannot run in check mode
3. **Idempotency**: run twice for real; the second run must report `changed=0`

Ansible is **not** on the system path. Use the venv:
`/private/tmp/claude-501/-Users-byroncustodio-WebstormProjects-personal-lyly-admin/79b1f92d-89f4-41af-83be-9f22050c5424/scratchpad/ansible-venv/bin/`
**It aborts with "requires blocking IO" if output is piped** — redirect to a file and read it back.

Task 1 does have a real test suite: `pytest`.

## File Structure

### `LycheeHome/swee`

```
.github/workflows/ci.yml     test job added; deploy job deleted
requirements-dev.txt         new — pytest and nothing else
deploy/ci-deploy.sh          deleted (the runner's entry point)
deploy/swee.service          moves to lychee-ops
deploy/setup.sh              deleted or reduced; lychee-ops declares the unit now
```

### `LycheeHome/lychee-ops`

```
roles/swee_app/defaults/main.yml     github token, deploy key path
roles/swee_app/tasks/main.yml        resolve release -> gate -> build -> restart -> verify
roles/swee_host/files/swee.service   the unit, moved out of swee's repo
roles/swee_host/tasks/main.yml       declare the unit and its sudoers drop-in
group_vars/all.yml                   swee_repo_slug, swee_dir, swee_user
playbook.yml                         both roles appended
```

---

### Task 1: Give `swee` a `test` job

**Files:**
- Create: `swee/requirements-dev.txt`
- Modify: `swee/.github/workflows/ci.yml`

**Interfaces:**
- Produces: a GitHub Actions job named exactly **`test`** on every push to `main` and every pull request. Task 4's gate matches that name. A `name:` override would replace what the API reports and silently break every future deploy.

- [ ] **Step 1: Confirm the tests pass at all before wiring them into a gate**

```bash
python3 -m venv /tmp/swee-test && /tmp/swee-test/bin/pip install -q -r requirements.txt pytest
/tmp/swee-test/bin/python -m pytest tests/ -q
```

If they do not pass, **stop and report BLOCKED**. Wiring a red suite into a deploy gate would block every release, and fixing `swee`'s tests is not this plan's job.

- [ ] **Step 2: Create `requirements-dev.txt`**

```
pytest
```

Separate from `requirements.txt` so the production venv the host builds stays free of test dependencies.

- [ ] **Step 3: Add the `test` job to `.github/workflows/ci.yml`**

Add a `pull_request` trigger alongside the existing `push`, and this job. Leave `release-please` untouched.

```yaml
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: pytest tests/ -q
```

Pin the Python version to what the host runs if it differs — check `python3 --version` on `lychee` during cutover and correct this if needed.

- [ ] **Step 4: Verify**

Push the branch, open a PR, and confirm a check named exactly `test` appears and passes. Paste the check name verbatim into your report — this is the string the gate matches.

- [ ] **Step 5: Commit**

```bash
git add requirements-dev.txt .github/workflows/ci.yml
git commit -m "ci: run the test suite"
```

---

### Task 2: Move `swee`'s unit into `lychee-ops`

**Files:**
- Create: `lychee-ops/roles/swee_host/files/swee.service`
- Create: `lychee-ops/roles/swee_host/tasks/main.yml`
- Create: `lychee-ops/roles/swee_host/handlers/main.yml`
- Modify: `lychee-ops/group_vars/all.yml`
- Modify: `lychee-ops/playbook.yml`

**Interfaces:**
- Consumes: nothing
- Produces: `/etc/systemd/system/swee.service` on the host, reconciled every tick.

- [ ] **Step 1: Add variables to `group_vars/all.yml`**

```yaml
swee_repo_slug: LycheeHome/swee
swee_repo_url: git@github.com:LycheeHome/swee.git
swee_dir: /home/steam/swee
swee_user: steam
swee_group: steam
```

These are the **real** values, read from `swee`'s GitHub repo variables
(`SWEE_DIR`, `SWEE_USER`) rather than assumed — an earlier draft of this plan
guessed a dedicated `swee` user under `/opt`, and was wrong.

`swee` runs as **`steam`, the Palworld server's own user, inside its home
directory.** That is not incidental: it is what lets `swee` restart the palworld
unit, run `steamcmd` against the game install, and read `PalWorldSettings.ini`.
It is the clearest evidence for the host-agent classification in the spec, and
it means this role creates no user and no directory — both already exist and
belong to the game server.

Confirm `swee_group` on the host (Cutover Step 0); `steam` is the likely primary
group but has not been verified.

- [ ] **Step 2: Copy the unit, resolving its placeholders**

`swee`'s `deploy/swee.service` is a template with `__SWEE_USER__`, `__SWEE_DIR__` and `__PALWORLD_SERVICE__` substituted by `deploy/setup.sh`. In `lychee-ops` it becomes a Jinja template instead, with those three as variables. Create `roles/swee_host/templates/swee.service.j2`:

```ini
# Declared by lychee-ops. Do not edit on the host — the next reconcile
# tick will overwrite it.
[Unit]
Description=swee Discord bot for Palworld
After=network-online.target {{ palworld_service }}.service
Wants=network-online.target

[Service]
Type=simple
User={{ swee_user }}
WorkingDirectory={{ swee_dir }}
ExecStart={{ swee_dir }}/.venv/bin/python {{ swee_dir }}/main.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Add `palworld_service: palworld` to `group_vars/all.yml`.

- [ ] **Step 3: Write `roles/swee_host/tasks/main.yml`**

Install the template to `/etc/systemd/system/swee.service`, root:root `0644`, notifying a restart handler. Then — **critically** — end the role with:

```yaml
- name: Flush swee host handlers
  ansible.builtin.meta: flush_handlers
```

Handlers otherwise flush at end of play, and `swee_app` ends the play in `fail:` on a failed deploy. A changed unit file plus a failed deploy would leave the new file on disk with systemd running the old one, permanently — Ansible's change detection guarantees it never self-heals. This exact defect was found and fixed in `lyly_admin_host`; do not reintroduce it.

- [ ] **Step 4: Write `roles/swee_host/handlers/main.yml`**

`Reload systemd` (`daemon_reload: true`) and `Restart swee` (`state: restarted`, `enabled: true`). Put `when: not ansible_check_mode` on the restart handler — `ansible.builtin.systemd` calls `fail_if_missing()` *before* its own check-mode guard, so a notified restart aborts a dry run on a host where the unit does not yet exist.

- [ ] **Step 5: Append both roles to `playbook.yml`**

Order: `reconciler`, `lyly_admin_host`, `lyly_admin_app`, `swee_host`, `swee_app`. Tag `swee_app` with `[app]` so `bootstrap.sh`'s dry run skips it for the same reason it skips `lyly_admin_app`.

- [ ] **Step 6: Lint, syntax-check, commit**

---

### Task 3: `swee_app` — resolve the release and gate on it

**Files:**
- Create: `lychee-ops/roles/swee_app/defaults/main.yml`
- Create: `lychee-ops/roles/swee_app/tasks/main.yml`

**Interfaces:**
- Produces: `swee_app_target_tag`, `swee_app_target_sha`, `swee_app_installed_sha`, `swee_app_deploy_gate_passed` (**bool**), `swee_app_gate_reason`. Task 4 consumes all five.

- [ ] **Step 1: `defaults/main.yml`**

```yaml
# Fine-grained PAT with Actions: Read on the swee repo. NOT `Checks` —
# GitHub removed that permission from fine-grained PATs, and granting the
# wrong one fails with 403 on every tick.
swee_app_github_token: ""
swee_app_deploy_key: /root/.ssh/id_swee
```

- [ ] **Step 2: Resolve the newest release**

```yaml
- name: Query the latest release
  ansible.builtin.uri:
    url: "https://api.github.com/repos/{{ swee_repo_slug }}/releases/latest"
    headers: >-
      {{ {'Accept': 'application/vnd.github+json'}
         | combine({'Authorization': 'Bearer ' + swee_app_github_token} if swee_app_github_token else {}) }}
    status_code: [200]
  register: swee_app_release
  retries: 3
  delay: 10
  until: swee_app_release.status == 200
  no_log: "{{ swee_app_github_token | length > 0 }}"

- name: Record the target tag
  ansible.builtin.set_fact:
    swee_app_target_tag: "{{ swee_app_release.json.tag_name }}"
```

Then resolve that tag to a commit SHA via `/git/ref/tags/{{ tag }}`, handling **both** a lightweight tag (`object.type == "commit"`) and an annotated one (`object.type == "tag"`, needing a second dereference through `/git/tags/{sha}`). release-please creates annotated tags; do not assume the simple case.

- [ ] **Step 2b: Read what is currently installed**

```yaml
- name: Read the currently installed commit
  ansible.builtin.slurp:
    src: "{{ swee_dir }}/.deployed-sha"
  register: swee_app_installed_raw
  failed_when: false

- name: Record the installed commit
  ansible.builtin.set_fact:
    swee_app_installed_sha: >-
      {{ (swee_app_installed_raw.content | default('') | b64decode | trim)
         if swee_app_installed_raw.content is defined else 'none' }}
```

`failed_when: false` covers the file's absence on a first run. Note the
`| default('')` **before** `b64decode`: an empty registered result would
otherwise raise here, in a top-level task with no rescue, killing the play
before anything is recorded — the exact shape of a Critical found in
`lyly_admin_app`.

- [ ] **Step 3: Gate on that SHA's `test` job**

Reuse the two-call shape proven in `lyly_admin_app`:

```
GET /actions/runs?head_sha={sha}&status=completed&per_page=100
GET /actions/runs/{id}/jobs?filter=latest&per_page=100
```

Collect conclusions of every job named `test` across every run; require the list non-empty and containing nothing but `success`. **No `| first`** — position-dependent selection was a real defect in the equivalent code. Guard the loop source with `| default([], true)` and `selectattr('id', 'defined')`: these are top-level tasks with no rescue, and a raise kills the play before any status is recorded.

Set both facts explicitly — the boolean and the human-readable reason:

```yaml
- name: Record the gate outcome
  ansible.builtin.set_fact:
    swee_app_deploy_gate_passed: >-
      {{ swee_app_gate_conclusions | length > 0
         and swee_app_gate_conclusions | reject('equalto', 'success') | list | length == 0 }}
```

and a following task setting `swee_app_gate_reason` to `ok`, or naming the
non-success conclusion, or `missing` when the list is empty. The status file
and the operator both read that string; `blocked` with no reason is the state
that makes an operator distrust the file.

- [ ] **Step 4: Verify the gate empirically**

Feed fabricated payloads through the real `set_fact` expressions: no runs, `test` success, `test` failure, `test` null, no job named `test`, two runs with mixed conclusions in **both** orders. Confirm `swee_app_deploy_gate_passed` reports `type_debug == 'bool'` — `"{{ a and b }}"` can render the string `"False"`, which is truthy in Jinja and would invert the gate.

- [ ] **Step 5: Lint, syntax-check, commit**

---

### Task 4: `swee_app` — build, restart, verify

**Files:**
- Modify: `lychee-ops/roles/swee_app/tasks/main.yml` (append)

**Interfaces:**
- Consumes: the five facts from Task 3
- Produces: `swee_app_deploy_result` — `deployed`, `skipped`, `blocked`, or `failed`.

- [ ] **Step 1: Append the install block**

Guarded by `when:` on gate passed **and** `swee_app_target_sha != swee_app_installed_sha`.

```yaml
    - name: Fetch the release
      ansible.builtin.git:
        repo: "{{ swee_repo_url }}"
        dest: "{{ swee_dir }}"
        version: "{{ swee_app_target_tag }}"
        force: true
        key_file: "{{ swee_app_deploy_key }}"
        accept_newhostkey: true

    - name: Install dependencies
      ansible.builtin.command:
        cmd: "{{ swee_dir }}/.venv/bin/pip install -q -r requirements.txt"
        chdir: "{{ swee_dir }}"
      become: true
      become_user: "{{ swee_user }}"
      changed_when: true

    - name: Restart swee
      ansible.builtin.systemd:
        name: swee
        state: restarted
```

**Ownership note.** `lyly-admin`'s equivalent failed on the real host because
`node_modules` was owned by the old CI user and the app user could not remove
it. That is **less likely here**: `swee`'s old workflow already ran its deploy
as `SWEE_USER` (`sudo -u "$SWEE_USER" ci-deploy.sh`), so `.venv` should already
belong to `steam`. Cutover Step 0 verifies rather than assumes — the failure
mode is identical if it turns out otherwise.

Unlike `lyly_admin_app` there is **no build directory** — `swee` is interpreted, so the checkout is the deployment. That also means the window where `pip install` has removed a package and not yet replaced it is a window where the running process could crash-restart into a broken tree. Accepted for now: the unit has `Restart=on-failure`, and the next tick re-runs the same steps. Record it as a known limitation rather than solving it.

- [ ] **Step 2: Health check — the readiness marker, not the unit state**

`swee` has no HTTP endpoint, so there is no equivalent of `lyly-admin`'s `401`. `systemctl is-active` only proves systemd thinks a process exists. The real signal is that the bot reached Discord and authenticated — `main.py:52` logs `Logged in as %s` from `on_ready`.

```yaml
    - name: Wait for swee to reach Discord
      ansible.builtin.command:
        cmd: journalctl -u swee --since "{{ swee_app_restart_time }}" --no-pager
      register: swee_app_journal
      until: "'Logged in as' in swee_app_journal.stdout"
      retries: 12
      delay: 5
      changed_when: false
```

Capture `swee_app_restart_time` immediately before the restart so the search window cannot match a previous run's line. Sixty seconds total: a Discord gateway connect is normally a few seconds, but it depends on an external service.

- [ ] **Step 3: Record the deployed SHA, mark the result, rescue**

`.deployed-sha` in `{{ swee_dir }}`, written **after** the health check passes so a failed deploy retries. `rescue:` sets `swee_app_deploy_result: failed` and must contain **no `fail:`** — the terminal failure comes after the status write, for the same reason as in `lyly_admin_app`.

**Do not set `swee_app_installed_sha` here.** The block's `when:` is re-evaluated for every task inside it, so assigning it makes the condition false and silently skips every later task in the block. That exact defect was found on the real host in `lyly_admin_app`.

- [ ] **Step 4: Status file, then terminal fail**

Plain top-level tasks — **not** inside `always:`. When a block's `when:` is false Ansible skips the block including `rescue:` and `always:`, so an `always:` never runs on the skipped path, which is the most common path.

- [ ] **Step 5: Lint, syntax-check, trace all four outcomes, commit**

---

### Task 5: Delete `swee`'s deploy job

**Files:**
- Modify: `swee/.github/workflows/ci.yml`
- Delete: `swee/deploy/ci-deploy.sh`
- Modify or delete: `swee/deploy/setup.sh`, `swee/deploy/swee.service`

> **STOP.** Do not start this task until Operator Cutover Step 3 has passed. It removes the only working deploy path.

- [ ] **Step 1: Remove the `deploy` job** and the now-unused `needs`/`outputs` wiring on `release-please`. Keep `test` and its exact name.
- [ ] **Step 2: `git rm deploy/ci-deploy.sh`** and `deploy/swee.service` (now declared by `lychee-ops`). `deploy/setup.sh` loses its unit-installing half; keep whatever one-time host preparation it still does, or delete it and record those steps in `swee`'s README.
- [ ] **Step 3: Update `swee`'s `CLAUDE.md`** — it documents the runner deploy. Say what replaced it and that the `test` job's name is load-bearing.
- [ ] **Step 4: Commit**

---

## Operator Cutover

Not agent tasks. These need a shell on `lychee`.

- [ ] **Step 0: Confirm the ground truth the plan assumes.** The real values live in `swee`'s GitHub repo variables, not in any file:

```
gh api repos/LycheeHome/swee/actions/variables --jq '.variables[] | {name, value}'
systemctl cat swee | head -20
stat -c '%a %U:%G %n' /home/steam/swee /home/steam/swee/.venv
id steam                                            # confirm swee_group
sudo -u steam sudo -ln                              # what swee may already do
python3 --version
```

Correct `group_vars/all.yml` and Task 1's Python pin to match. **Expect the `.venv` to be owned by whichever user the old deploy used**; if it is not `swee`, a one-time `sudo chown -R steam:steam /home/steam/swee` is needed before the first real run — this is exactly what broke `lyly-admin`'s first attempt.

- [ ] **Step 1: Deploy key.** Generate `/root/.ssh/id_swee` on `lychee`, add the public half to `LycheeHome/swee` → Deploy keys, **read-only**. `/root/.ssh/config` already has a `Host github.com` block pointing at `id_lychee_ops`; `key_file:` overrides it per-task, so no config change is needed.

- [ ] **Step 2: Token.** Add `Actions: Read` on `LycheeHome/swee` to the existing fine-grained PAT, or mint a second one, and set `swee_app_github_token` in `/etc/lychee-ops/secrets.yml`. Verify before relying on it:

```
curl -sS -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer TOKEN" \
  https://api.github.com/repos/LycheeHome/swee/releases/latest
```

- [ ] **Step 3: Dry run, then apply, then verify a real deploy.** `--check --diff --skip-tags app` first; read every diff. Then apply with a second root shell open. Then cut a release in `swee` and confirm it lands within a tick, `journalctl -u swee` shows `Logged in as`, and the bot responds in Discord.

- [ ] **Step 4: Merge Task 5.** Only now.

- [ ] **Step 5: Confirm the runner has one fewer dependent.** `swee` is off it. The runner still cannot be retired — scaffolded sites still emit `runs-on: self-hosted`.

**Rollback** before Step 4: `swee`'s deploy job still exists and still works, provided its sudo grant and `SWEE_DIR` ownership were not changed by Step 0's `chown`. If they were, restoring means reverting the ownership.
