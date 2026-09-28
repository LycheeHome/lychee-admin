# swee pinned versioning (slice 1a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `swee_app` deploys an explicit release tag pinned in `lychee-ops`, makes zero GitHub API calls when that pin has not moved, and stops retrying a failed install forever.

**Architecture:** The role's decision logic moves out of `tasks/main.yml` into two pure task files that consume registered results and produce facts. Those files are exercised by a local Ansible test harness, because every defect this role has shipped has been in a Jinja predicate and nothing currently runs them off-host. `main.yml` keeps the API calls and the install block, and gains guards driven by the extracted facts.

**Tech Stack:** Ansible (`ansible-core`, run via `ansible-pull` on the host), Jinja2 expressions, a throwaway venv for local test runs. No new runtime dependency on the host.

**Spec:** `docs/superpowers/specs/2026-09-28-versioning-design.md`

## Global Constraints

- All facts and defaults in `swee_app` carry the `swee_app_` prefix. ansible-lint's production profile enforces it; suppressing the check is not an option.
- `swee_version` lives in `lychee-ops/group_vars/all.yml`. It is a release tag (`v2.11.2`), never a SHA, never `latest`, never `main`.
- `swee_app_pin_moved` and `swee_app_retry_capped` are computed **once, before any API call**, from values nothing later mutates. Nothing inside the install block may reassign a fact that an enclosing `when:` depends on — a block's `when:` is re-evaluated per task.
- Every read of a registered result uses `| default(..., true)` on the way to `b64decode`, `.json`, or `.results`. These task files have no `rescue:`; a raise kills the play before the status file is written, which wedges the reconciler on every future tick.
- The `required_check` job name stays `test`, matched as a **job** name from `GET /actions/runs/{id}/jobs`.
- All work is in `~/WebstormProjects/personal/lychee-ops`. Nothing in this plan touches `roles/lyly_admin_app/` — it is live and unrelated to getting swee off the runner.
- Do not push `lychee-ops` during implementation. The reconcile timer is stopped; pushing is applying. Cutover is a separate, operator-run step after the whole plan is reviewed.

## Review Focus

Five conditions the spec implies that the tasks' own happy-path tests would not reach. Each has a test assigned to the task that owns the code.

1. **`.deployed-tag` absent** — first deploy under the new scheme, and the state `lychee` is in right now. Must resolve to `none` and set `pin_moved: true`, not raise. *(Task 3)*
2. **`.failed-tag` truncated or hand-edited** — the first thing an operator reaches for to clear a stuck cap. An empty or one-token file must resolve to `none`/`0`, not raise. This exact shape was a Critical in `lyly_admin_app`. *(Task 6)*
3. **Two completed runs disagreeing** — `[{test: success}, {test: failure}]` must block, and so must the reverse order. Position-dependent selection (`| first`) was a proven defect here. *(Task 1)*
4. **`swee_version` empty or undefined** — must fail loudly before any API call or fetch, never fall back to a branch tip or deploy whatever is on disk. *(Task 2)*
5. **Zero completed runs for the SHA** — `workflow_runs` empty or absent means a 0-iteration loop and an absent `.results`; must report the no-runs gate string rather than raising on `.results`. *(Task 5)*

---

### Task 1: Test harness and gate-decision extraction

Pure refactor plus the harness that makes every later task testable. No behavior change.

**Files:**
- Create: `tests/run.sh`
- Create: `tests/test_swee_decide.yml`
- Create: `roles/swee_app/tasks/decide_gate.yml`
- Modify: `roles/swee_app/tasks/main.yml:142-181` (replace three tasks with an import)
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `roles/swee_app/tasks/decide_gate.yml`, importable with `ansible.builtin.import_tasks`. Reads `swee_app_run_jobs` (registered `uri` loop result) and `required_check`. Sets `swee_app_gate_conclusions` (list of strings), `swee_app_deploy_gate_passed` (bool), `swee_app_gate_reason` (string). Also produces `tests/run.sh`, which every later task uses.

- [ ] **Step 1: Create the test runner**

```bash
mkdir -p tests
cat > tests/run.sh <<'EOF'
#!/usr/bin/env bash
# Runs the decision-logic tests off-host. These exercise the pure Jinja in
# roles/*/tasks/decide_*.yml against hand-written inputs — no SSH, no API
# calls, nothing on lychee. The venv lives in the repo (gitignored) rather
# than under TMPDIR, which macOS cleans out from under you.
set -euo pipefail
cd "$(dirname "$0")/.."
VENV="tests/.venv"
if [ ! -x "$VENV/bin/ansible-playbook" ]; then
  echo "Creating $VENV ..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q ansible-core
fi
exec "$VENV/bin/ansible-playbook" -i localhost, --connection=local \
  tests/test_swee_decide.yml "$@"
EOF
chmod +x tests/run.sh
```

- [ ] **Step 2: Ignore the venv**

```bash
printf 'tests/.venv/\n' >> .gitignore
```

- [ ] **Step 3: Write the failing tests**

**Fact isolation between plays does not exist, and `meta: clear_facts` does not provide it** — verified by probe: a `set_fact` value survives `clear_facts` into the next play intact, and with `gather_facts: false` there are no gathered facts for it to clear either. Worse, a leaked fact **outranks a later play's `vars:`** in Ansible's precedence ladder, so leakage changes control flow and not just assertions. Therefore: a play that must override a name any imported file sets via `set_fact` has to set it with its own `set_fact`, not in `vars:`; and a play that would assert a fact is absent must assert a sentinel value instead.

```yaml
# tests/test_swee_decide.yml
# Decision-logic tests for roles/swee_app. One play per case: set_fact
# results are host facts and persist across plays, so each play clears
# them first rather than depending on every fact being unconditionally
# reassigned.
---
- name: Gate passes when the required job concluded success
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_run_jobs:
      results:
        - json:
            jobs:
              - { name: test, conclusion: success }
              - { name: release-please, conclusion: success }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the gate passed
      ansible.builtin.assert:
        that:
          - swee_app_deploy_gate_passed
          - swee_app_deploy_gate_passed | type_debug == 'bool'
          - swee_app_gate_reason == 'ok'
        fail_msg: "expected a pass, got {{ swee_app_gate_reason }}"

- name: Gate blocks when the required job failed
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_run_jobs:
      results:
        - json:
            jobs:
              - { name: test, conclusion: failure }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the gate blocked and named the conclusion
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed
          - swee_app_gate_reason == 'job test concluded: failure'

- name: Gate blocks when no job named test exists
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_run_jobs:
      results:
        - json:
            jobs:
              - { name: release-please, conclusion: success }
              - { name: deploy, conclusion: success }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the gate blocked as missing
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed
          - swee_app_gate_reason == 'job test concluded: missing'

- name: Gate blocks when two runs disagree, success first
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_run_jobs:
      results:
        - json: { jobs: [{ name: test, conclusion: success }] }
        - json: { jobs: [{ name: test, conclusion: failure }] }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert a disagreement blocks regardless of order
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed

- name: Gate blocks when two runs disagree, failure first
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_run_jobs:
      results:
        - json: { jobs: [{ name: test, conclusion: failure }] }
        - json: { jobs: [{ name: test, conclusion: success }] }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the reverse order blocks too
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed

- name: Gate reports in_progress for a null conclusion
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_run_jobs:
      results:
        - json: { jobs: [{ name: test, conclusion: null }] }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert a null conclusion is legible
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed
          - swee_app_gate_reason == 'job test concluded: in_progress'
```

- [ ] **Step 4: Run to verify they fail**

Run: `./tests/run.sh`
Expected: FAIL on the first play with `Could not find or access '../roles/swee_app/tasks/decide_gate.yml'`.

- [ ] **Step 5: Create `decide_gate.yml` by moving the three tasks verbatim**

Cut `roles/swee_app/tasks/main.yml` lines 142–181 — `Decide whether the gate passes`, `Record the gate outcome`, `Explain the gate outcome`, **with their comments** — into the new file, prefixed with a header explaining why it is separate.

```yaml
# roles/swee_app/tasks/decide_gate.yml
# Pure decision logic: consumes the registered result of the jobs query and
# produces the gate verdict. No API calls, no host changes, no I/O — which
# is what lets tests/test_swee_decide.yml import this file directly with
# hand-written inputs. Every defect this role has shipped has been in one of
# these expressions, and nothing else in the repo can be exercised off-host.
#
# Consumes: swee_app_run_jobs (registered uri loop), required_check
# Produces: swee_app_gate_conclusions, swee_app_deploy_gate_passed,
#           swee_app_gate_reason
---
# Gathers jobs from every run returned (never `| first` — position-
# dependent selection was a proven defect: [{test,success},{test,failure}]
# would pass while the reverse order blocked). Keeps only jobs named
# required_check, maps to their conclusion. `.results | default([], true)`
# covers the case where the jobs loop ran zero times.
- name: Decide whether the gate passes
  ansible.builtin.set_fact:
    swee_app_gate_conclusions: >-
      {{ swee_app_run_jobs.results | default([], true)
         | map(attribute='json.jobs', default=[])
         | list
         | flatten(levels=1)
         | selectattr('name', 'equalto', required_check)
         | map(attribute='conclusion')
         | list }}

# The whole RHS is a single {{ }} expression with nothing else in the
# scalar, so Ansible preserves the native (non-string) type of the Jinja
# result here — a real bool, not the string "True"/"False" that
# "{{ a and b }}" concatenated with any other text would produce. That
# distinction matters: the string "False" is truthy in Jinja and would
# invert the gate.
- name: Record the gate outcome
  ansible.builtin.set_fact:
    swee_app_deploy_gate_passed: >-
      {{ swee_app_gate_conclusions | length > 0
         and swee_app_gate_conclusions | reject('equalto', 'success') | list | length == 0 }}

# Conclusion is null (rendered here as "in_progress") while the job hasn't
# completed yet; an empty list means no job named required_check exists
# for this commit at all ("missing"). Both are real, distinct states an
# operator reading this at 2am should be able to tell apart from a genuine
# failure/cancelled/timed_out conclusion. `blocked` with no reason is the
# state that makes an operator distrust the status file.
- name: Explain the gate outcome
  ansible.builtin.set_fact:
    swee_app_gate_reason: >-
      {{ 'ok' if swee_app_deploy_gate_passed
         else 'job ' ~ required_check ~ ' concluded: missing' if swee_app_gate_conclusions | length == 0
         else 'job ' ~ required_check ~ ' concluded: '
              ~ (swee_app_gate_conclusions
                 | reject('equalto', 'success')
                 | map('default', 'in_progress', true)
                 | list | join(', ')) }}
```

- [ ] **Step 6: Import it from `main.yml`**

Replace the cut region in `roles/swee_app/tasks/main.yml` with:

```yaml
- name: Decide the gate outcome
  ansible.builtin.import_tasks: decide_gate.yml
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `./tests/run.sh`
Expected: PASS, 6 plays, `failed=0` on every one.

- [ ] **Step 8: Commit**

```bash
git add tests/ roles/swee_app/tasks/decide_gate.yml roles/swee_app/tasks/main.yml .gitignore
git commit -m "test: extract swee_app's gate decision and pin it with tests

Every defect this role has shipped has been in a Jinja predicate, and
nothing in this repo could be exercised off-host: ansible-pull runs with
ansible_connection: local, so the only way to try a change was to apply it
to lychee. tests/run.sh builds a throwaway venv and runs the decision logic
against hand-written inputs in seconds.

decide_gate.yml is a verbatim move of three set_fact tasks and their
comments. The tests pin current behaviour, including the two-runs-disagree
case in both orders — the position-dependent defect an earlier fix removed."
```

---

### Task 2: Pin the target tag

**Files:**
- Modify: `lychee-ops/group_vars/all.yml` (add `swee_version`)
- Modify: `roles/swee_app/tasks/main.yml:12-29` (delete the release query, source the tag from the pin)
- Modify: `tests/test_swee_decide.yml` (add the undefined-pin case)

**Interfaces:**
- Consumes: `tests/run.sh` from Task 1.
- Produces: `swee_version` (string, a release tag) in `group_vars/all.yml`. `swee_app_target_tag` is now set from it rather than from `swee_app_release.json.tag_name`. `swee_app_release` no longer exists — nothing may reference it.

- [ ] **Step 1: Add the pin to `group_vars/all.yml`**

Insert directly after the `swee_repo_url` block:

```yaml
# The release tag to deploy. A pin, not a pointer: the reconciler installs
# exactly this and nothing else, so lychee-ops describes the host's state
# rather than a rule for discovering it. Promotion is a commit here;
# rollback is `git revert` on that commit, applied within one tick.
#
# Deliberately not `latest`: that is a moving pointer, and under it nothing
# in git can answer "what should lychee be running?" without asking GitHub.
# Deliberately not a SHA: the tag is what the fetch checks out, and gating a
# SHA resolved from a different field than the one deployed is a divergence
# with no upside.
#
# Note the rollback horizon. The CI gate requires a job named `required_check`
# to have concluded success for this tag's commit, so a release cut before
# that job existed can never be installed — it blocks with "no job named
# test". v2.11.2 (2026-07-24) is exactly such a release. Old versions age
# out of rollback range; that is accepted, not a bug to work around.
swee_version: v2.11.2
```

- [ ] **Step 2: Write the failing test for an empty pin**

Append to `tests/test_swee_decide.yml`:

```yaml
- name: An empty pin is rejected before anything else happens
  hosts: localhost
  gather_facts: false
  vars:
    swee_version: ""
  tasks:
    - name: Import the target decision, expecting it to fail
      block:
        - ansible.builtin.import_tasks: ../roles/swee_app/tasks/assert_pin.yml
        - name: Fail if the assertion did not fire
          ansible.builtin.fail:
            msg: "an empty swee_version was accepted"
      rescue:
        - name: Assert the failure named the variable
          ansible.builtin.assert:
            that:
              - "'swee_version' in (ansible_failed_result.msg | default(''))"
```

- [ ] **Step 3: Run to verify it fails**

Run: `./tests/run.sh`
Expected: FAIL with `Could not find or access '../roles/swee_app/tasks/assert_pin.yml'`.

- [ ] **Step 4: Create the assertion file**

```yaml
# roles/swee_app/tasks/assert_pin.yml
# Runs before any API call or fetch. An unset or empty pin must stop the
# role here rather than resolve to something arbitrary: an empty `version:`
# passed to ansible.builtin.git checks out the remote's default branch,
# which would silently reintroduce exactly the tip-of-main deploy this
# design replaced.
---
- name: Assert swee_version names a release tag
  ansible.builtin.assert:
    that:
      - swee_version is defined
      - swee_version | length > 0
      - swee_version not in ['latest', 'main', 'HEAD']
    fail_msg: >-
      swee_version must name a release tag (e.g. v2.11.2); got
      {{ swee_version | default('undefined') | to_json }}
```

- [ ] **Step 5: Replace the release query in `main.yml`**

Delete the `Query the latest release` task (the whole `ansible.builtin.uri` block and its `register`/`retries`/`until`/`no_log`) and replace `Record the target tag` so the file now begins:

```yaml
- name: Assert the pin is usable
  ansible.builtin.import_tasks: assert_pin.yml

- name: Record the target tag
  ansible.builtin.set_fact:
    swee_app_target_tag: "{{ swee_version }}"
```

Update the file's header comment — its last paragraph currently says swee deploys "the newest GitHub Release". Replace that paragraph with:

```
# Unlike lyly_admin_app, which deploys the tip of a branch (git checkout,
# .after is the target commit), swee deploys the release tag pinned in
# group_vars — resolved to a commit only when that pin has moved.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `./tests/run.sh`
Expected: PASS, 7 plays (9 after Task 2's review fix adds the undefined and latest/main/HEAD cases).

- [ ] **Step 7: Verify nothing still references the deleted fact**

Run: `grep -rn "swee_app_release" roles/ tests/`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add group_vars/all.yml roles/swee_app/tasks/ tests/test_swee_decide.yml
git commit -m "feat: deploy the swee release pinned in group_vars

Replaces the releases/latest query with swee_version. The host's state is
now described by the ops repo rather than discovered from a pointer that
moves outside it, so promotion is a commit and rollback is git revert.

assert_pin.yml runs before any API call: an empty version: passed to
ansible.builtin.git checks out the remote default branch, which would
silently reintroduce the tip-of-main deploy this replaces."
```

---

### Task 3: Track the installed tag

**Files:**
- Create: `roles/swee_app/tasks/decide_target.yml`
- Modify: `roles/swee_app/tasks/main.yml` (add the `.deployed-tag` slurp; import `decide_target.yml`; write `.deployed-tag` in the install block)
- Modify: `roles/swee_app/templates/deploy-status.json.j2`
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: `swee_app_target_tag` (Task 2).
- Produces: `roles/swee_app/tasks/decide_target.yml`, importable. Reads `swee_app_installed_tag_raw` and `swee_app_installed_sha_raw` (registered `slurp` results, either possibly failed) and `swee_app_target_tag`. Sets `swee_app_installed_tag` (string, `'none'` when absent) and `swee_app_installed_sha` (string, `'none'` when absent). Task 4 adds `swee_app_pin_moved` to this same file; Task 6 adds the retry-cap facts.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_swee_decide.yml`:

```yaml
- name: An absent .deployed-tag resolves to none
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert first-deploy state
      ansible.builtin.assert:
        that:
          - swee_app_installed_tag == 'none'
          - swee_app_installed_sha == 'none'

- name: A populated .deployed-tag is decoded and trimmed
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    # base64 of "v2.11.2\n" and of "447458e9f7e47db665df182407c93e1dd9dfda34\n"
    swee_app_installed_tag_raw:
      content: "djIuMTEuMgo="
    swee_app_installed_sha_raw:
      content: "NDQ3NDU4ZTlmN2U0N2RiNjY1ZGYxODI0MDdjOTNlMWRkOWRmZGEzNAo="
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert the installed markers decode
      ansible.builtin.assert:
        that:
          - swee_app_installed_tag == 'v2.11.2'
          - swee_app_installed_sha == '447458e9f7e47db665df182407c93e1dd9dfda34'

- name: An empty .deployed-tag does not raise
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { content: "" }
    swee_app_installed_sha_raw: { content: "" }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert an empty marker reads as none
      ansible.builtin.assert:
        that:
          - swee_app_installed_tag == 'none'
          - swee_app_installed_sha == 'none'
```

- [ ] **Step 2: Run to verify they fail**

Run: `./tests/run.sh`
Expected: FAIL with `Could not find or access '../roles/swee_app/tasks/decide_target.yml'`.

- [ ] **Step 3: Create `decide_target.yml`**

```yaml
# roles/swee_app/tasks/decide_target.yml
# Pure decision logic, run BEFORE any API call: what is pinned, what is
# installed. Everything here comes from local disk and group_vars, which is
# what lets the whole role skip the GitHub API entirely on a tick where the
# pin has not moved.
#
# Consumes: swee_app_target_tag, swee_app_installed_tag_raw,
#           swee_app_installed_sha_raw (both possibly-failed slurps)
# Produces: swee_app_installed_tag, swee_app_installed_sha
---
# `| default('', true)` before b64decode, twice over: the slurp above runs
# with failed_when: false, so on an absent file the registered result has
# no .content at all, and on an empty file it has an empty one. Either must
# resolve to 'none', never raise — this file has no rescue, and a raise
# kills the play before the status file is written, wedging the reconciler
# on every future tick. The `| trim` matters because these files are
# written with a trailing newline.
- name: Record the installed tag
  ansible.builtin.set_fact:
    swee_app_installed_tag: >-
      {{ (swee_app_installed_tag_raw.content | default('', true) | b64decode | trim) or 'none' }}

- name: Record the installed commit
  ansible.builtin.set_fact:
    swee_app_installed_sha: >-
      {{ (swee_app_installed_sha_raw.content | default('', true) | b64decode | trim) or 'none' }}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./tests/run.sh`
Expected: PASS, 12 plays.

- [ ] **Step 5: Wire it into `main.yml`**

Replace the existing `Read the currently installed commit` / `Record the installed commit` pair with a slurp of both markers followed by the import. The existing `Record the installed commit` task and its long comment are deleted — that reasoning now lives in `decide_target.yml`.

```yaml
- name: Read the currently installed tag
  ansible.builtin.slurp:
    src: "{{ swee_dir }}/.deployed-tag"
  register: swee_app_installed_tag_raw
  failed_when: false

- name: Read the currently installed commit
  ansible.builtin.slurp:
    src: "{{ swee_dir }}/.deployed-sha"
  register: swee_app_installed_sha_raw
  failed_when: false

- name: Decide the target state
  ansible.builtin.import_tasks: decide_target.yml
```

- [ ] **Step 6: Write `.deployed-tag` in the install block**

Beside the existing `Record the deployed commit` task, add:

```yaml
    # Written last, beside .deployed-sha. The tag is what the skip decision
    # compares each tick — a local string comparison, which is why an
    # unchanged pin costs no API call at all. The SHA stays alongside it
    # because it is what the gate actually verified, and because a tag moved
    # to a different commit after deploy is recoverable by hand from it.
    - name: Record the deployed tag
      ansible.builtin.copy:
        content: "{{ swee_app_target_tag }}\n"
        dest: "{{ swee_dir }}/.deployed-tag"
        owner: "{{ swee_user }}"
        group: "{{ swee_group }}"
        mode: "0644"
```

- [ ] **Step 7: Add the field to the status template**

In `roles/swee_app/templates/deploy-status.json.j2`, add after `target_tag`:

```jinja
  "installed_tag": {{ (swee_app_target_tag
                      if swee_app_deploy_result | default('') == 'deployed'
                      else swee_app_installed_tag | default('none')) | to_json }},
```

- [ ] **Step 8: Commit**

```bash
git add roles/swee_app/ tests/test_swee_decide.yml
git commit -m "feat: track the installed tag beside the installed commit

.deployed-tag is what the skip decision compares, so an unchanged pin can
be detected from local disk with no API call. .deployed-sha stays because
it is what the gate verified.

Both reads guard with | default('', true) before b64decode: the slurps run
with failed_when: false, so an absent file has no .content and an empty one
has an empty .content. Either raising here would kill the play before the
status file is written."
```

---

### Task 4: Guard every API call on pin movement

**Files:**
- Modify: `roles/swee_app/tasks/decide_target.yml` (add `swee_app_pin_moved`)
- Modify: `roles/swee_app/tasks/decide_gate.yml` (add `swee_app_noop_result`)
- Modify: `roles/swee_app/tasks/main.yml` (guards on four tasks; three-state no-op result)
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: `swee_app_installed_tag`, `swee_app_target_tag` (Task 3); `swee_app_deploy_gate_passed` (Task 1).
- Produces: `swee_app_pin_moved` (bool) from `decide_target.yml`. `swee_app_noop_result` (string, one of `skipped` / `blocked`) from `decide_gate.yml`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_swee_decide.yml`:

```yaml
- name: An unchanged pin does not move
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.11.2
    swee_app_installed_tag_raw: { content: "djIuMTEuMgo=" }
    swee_app_installed_sha_raw: { failed: true }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert the steady state
      ansible.builtin.assert:
        that:
          - not swee_app_pin_moved
          - swee_app_pin_moved | type_debug == 'bool'

- name: A changed pin moves
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { content: "djIuMTEuMgo=" }
    swee_app_installed_sha_raw: { failed: true }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert a promotion is detected
      ansible.builtin.assert:
        that:
          - swee_app_pin_moved

- name: A first deploy moves
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.11.2
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert an absent marker counts as moved
      ansible.builtin.assert:
        that:
          - swee_app_pin_moved

- name: A skipped tick reports skipped, not blocked
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_pin_moved: false
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the gate was never consulted
      ansible.builtin.assert:
        that:
          - swee_app_noop_result == 'skipped'
          - swee_app_deploy_gate_passed is not defined
        fail_msg: >-
          an unchanged pin must not evaluate the gate; got
          {{ swee_app_noop_result | default('undefined') }}

- name: A moved pin with a red gate reports blocked
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_pin_moved: true
    swee_app_run_jobs:
      results:
        - json: { jobs: [{ name: test, conclusion: failure }] }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert a promotion that fails CI is blocked
      ansible.builtin.assert:
        that:
          - swee_app_noop_result == 'blocked'
```

- [ ] **Step 2: Run to verify they fail**

Run: `./tests/run.sh`
Expected: FAIL — `swee_app_pin_moved` and `swee_app_noop_result` are undefined.

- [ ] **Step 3: Add `swee_app_pin_moved` to `decide_target.yml`**

Append to the file, and extend its `Produces:` header line to name the new fact:

```yaml
# The whole skip decision, and the reason the steady state costs nothing:
# two local strings. Computed once here, before any API call, and never
# reassigned — a block's `when:` is re-evaluated per task, so a fact an
# enclosing condition depends on must not be mutated inside that block.
# That exact mistake silently disabled lyly_admin_app's failure-memory
# cleanup for its whole first deployment.
#
# Compares tags rather than SHAs. A tag moved to a different commit after
# deploy would go unnoticed, where a SHA comparison would catch it — not
# worth an API call every five minutes in a single-maintainer org whose
# tags are cut by release-please. .deployed-sha stays on disk so the answer
# is recoverable by hand.
- name: Decide whether the pin has moved
  ansible.builtin.set_fact:
    swee_app_pin_moved: "{{ swee_app_target_tag != swee_app_installed_tag }}"
```

- [ ] **Step 4: Add `swee_app_noop_result` to `decide_gate.yml`**

Guard the three existing tasks in that file on `swee_app_pin_moved`, then append the result fact. Add `when: swee_app_pin_moved | default(true)` to each of `Decide whether the gate passes`, `Record the gate outcome`, and `Explain the gate outcome`, and append:

```yaml
# Three states, not two. Before pinning there were only two reasons nothing
# installed — the gate said no, or the resolved release was already on disk
# — so `blocked if not gate_passed else skipped` covered it. Under pinning
# the commonest tick of all is "the pin has not moved", where the gate is
# never evaluated at all and swee_app_deploy_gate_passed is UNDEFINED.
# Reading it there would raise, in a top-level task with no rescue.
- name: Decide what a tick with no install should report
  ansible.builtin.set_fact:
    swee_app_noop_result: >-
      {{ 'skipped' if not (swee_app_pin_moved | default(true))
         else 'blocked' if not (swee_app_deploy_gate_passed | default(false))
         else 'skipped' }}

- name: Explain a skipped tick
  ansible.builtin.set_fact:
    swee_app_gate_reason: "pin unchanged ({{ swee_app_installed_tag | default('none') }})"
  when: not (swee_app_pin_moved | default(true))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./tests/run.sh`
Expected: PASS, 17 plays.

- [ ] **Step 6: Reorder, then guard the API calls in `main.yml`**

**Reorder first.** `main.yml` currently resolves the tag *before* it reads the installed markers and imports `decide_target.yml` — which is the only thing that sets `swee_app_pin_moved`. Guarding without reordering references an undefined variable, and Ansible **raises** on an undefined var in `when:` rather than skipping, so every tick would fail. Move `Read the currently installed tag`, `Read the currently installed commit` and `Decide the target state` above the first guarded task.

Then add `when: swee_app_pin_moved` to each of these **five** tasks: `Resolve the release tag to a commit`, `Fail if the release tag is not a lightweight tag`, `Record the target commit`, `Query workflow runs for the target commit`, and `Query jobs for each completed workflow run`.

`Record the target commit` is easy to miss — it dereferences `swee_app_tag_ref.json.object.sha`, the same registered result as the assertion beside it, so it raises on a skipped tick exactly as the assertion would.

The assertion **must** be guarded alongside the call it reads. It dereferences `swee_app_tag_ref.json.object.type`, so an unguarded assertion raises on every skipped tick — which is the commonest tick there is.

- [ ] **Step 7: Use the computed result in the no-op task**

Replace the body of `Record a no-op run`, and delete the comment above it, which now states the opposite of the truth ("the only reason nothing installs is the CI gate itself"):

```yaml
- name: Record a no-op run
  ansible.builtin.set_fact:
    swee_app_deploy_result: "{{ swee_app_noop_result }}"
    swee_app_deploy_failed_step: ""
  when: swee_app_deploy_result is not defined
```

- [ ] **Step 8: Guard the blocked-deploy debug message**

`Report a blocked deploy` prints `swee_app_target_sha[:8]`, which is never set on a skipped tick. Change it to:

```yaml
- name: Report a blocked deploy
  ansible.builtin.debug:
    msg: "Not deploying {{ swee_app_target_tag }} — {{ swee_app_gate_reason }}"
  when: swee_app_deploy_result == 'blocked'
```

- [ ] **Step 9: Add the install-block guard**

The install block's `when:` currently compares SHAs. Change it to:

```yaml
- name: Install swee
  when:
    - swee_app_pin_moved
    - swee_app_deploy_gate_passed | default(false)
  block:
```

- [ ] **Step 10: Verify no unguarded reference to the target SHA survives**

Run: `grep -n "swee_app_target_sha" roles/swee_app/tasks/main.yml roles/swee_app/templates/*.j2`
Expected: every hit is either inside the install block, inside a task carrying `when: swee_app_pin_moved`, or guarded by `| default(...)` in the template.

- [ ] **Step 11: Commit**

```bash
git add roles/swee_app/ tests/test_swee_decide.yml
git commit -m "feat: skip every API call when the pin has not moved

The steady state now costs nothing: two local strings decide there is
nothing to do, and the tag resolution and both gate calls are skipped.
Before pinning this was not expressible — finding out whether the target
had moved WAS the API call.

The no-op result gains a third state. 'blocked if not gate_passed else
skipped' read an undefined fact on exactly the commonest tick, in a
top-level task with no rescue. The comment asserting there were only two
reasons is deleted rather than amended; it is now false.

The lightweight-tag assertion is guarded alongside the call it reads — it
dereferences swee_app_tag_ref.json, so leaving it unguarded would raise on
every skipped tick."
```

---

### Task 5: Split the gate string

**Files:**
- Modify: `roles/swee_app/tasks/decide_gate.yml`
- Modify: `roles/swee_app/tasks/main.yml` (pass the run count through)
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: `swee_app_workflow_runs` (registered `uri` result, already present in `main.yml`).
- Produces: `swee_app_gate_reason` now distinguishes zero completed runs from runs without the required job. No new fact names.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_swee_decide.yml`:

```yaml
- name: Zero completed runs is distinguishable from a renamed job
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_pin_moved: true
    swee_app_target_tag: v2.12.0
    swee_app_workflow_runs: { json: { workflow_runs: [] } }
    swee_app_run_jobs: {}
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the no-runs string
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed
          - swee_app_gate_reason == 'no completed CI runs for v2.12.0'

- name: An absent workflow_runs key does not raise
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_pin_moved: true
    swee_app_target_tag: v2.12.0
    swee_app_workflow_runs: {}
    swee_app_run_jobs: {}
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert a missing key reads as zero runs
      ansible.builtin.assert:
        that:
          - swee_app_gate_reason == 'no completed CI runs for v2.12.0'

- name: Runs without the required job name the count
  hosts: localhost
  gather_facts: false
  vars:
    required_check: test
    swee_app_pin_moved: true
    swee_app_target_tag: v2.11.2
    swee_app_workflow_runs: { json: { workflow_runs: [{ id: 30070602923 }] } }
    swee_app_run_jobs:
      results:
        - json:
            jobs:
              - { name: release-please, conclusion: success }
              - { name: deploy, conclusion: success }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_gate.yml
    - name: Assert the renamed-or-too-old string
      ansible.builtin.assert:
        that:
          - not swee_app_deploy_gate_passed
          - swee_app_gate_reason == 'no job named test in 1 completed run(s) for v2.11.2'
```

- [ ] **Step 2: Run to verify they fail**

Run: `./tests/run.sh`
Expected: FAIL — the reason is still `job test concluded: missing` in all three.

- [ ] **Step 3: Add the run count and rewrite the reason**

In `decide_gate.yml`, add before `Explain the gate outcome`:

```yaml
- name: Count the completed runs considered
  ansible.builtin.set_fact:
    swee_app_run_count: >-
      {{ swee_app_workflow_runs.json.workflow_runs | default([], true) | length }}
  when: swee_app_pin_moved | default(true)
```

**Every play below that needs `swee_app_pin_moved` must establish it with the play's own `set_fact` task, never in `vars:`** — `decide_target.yml` sets that name via `set_fact`, and a leaked fact outranks a later play's `vars:`. The snippets in this task and the next show it in `vars:` for brevity; that is wrong and the file's own header says so.

**If the absent-`workflow_runs`-key test raises rather than returning `0`, that is a real finding, not a bad test.** `| default([], true)` cannot rescue an expression that raised while being evaluated, and `.json` is absent whenever a response was not JSON. Use the defensive form instead:

```yaml
    swee_app_run_count: >-
      {{ (swee_app_workflow_runs | default({}, true)).get('json', {})
         | default({}, true) | ansible.builtin.dict2items
         | selectattr('key', 'equalto', 'workflow_runs')
         | map(attribute='value') | first | default([], true) | length }}
```

or, more simply, `{{ (swee_app_workflow_runs.json | default({}, true)).workflow_runs | default([], true) | length }}`.

**Report it if so.** The identical pattern ships today in both roles' `loop:` expression (`*_workflow_runs.json.workflow_runs | default([], true)`), so a raise here means that line has the same latent defect in production — reachable whenever GitHub returns a non-JSON body, which is exactly what a rate-limit or gateway error looks like.

Then replace `Explain the gate outcome` with:

```yaml
# Three distinct blocked states, because "missing" used to mean all of
# them and an operator could not tell which. Zero completed runs means CI
# has not finished or never started — wait. Runs exist but none contains a
# job named required_check means the job was renamed, OR the pinned release
# predates that job's existence: v2.11.2 was cut in July and its only run
# holds release-please and deploy. That second case is the rollback
# horizon, and this string is what makes it read as "that release is from
# July" rather than "why is this stuck".
- name: Explain the gate outcome
  ansible.builtin.set_fact:
    swee_app_gate_reason: >-
      {{ 'ok' if swee_app_deploy_gate_passed
         else 'no completed CI runs for ' ~ swee_app_target_tag
              if swee_app_run_count | int == 0
         else 'no job named ' ~ required_check ~ ' in '
              ~ swee_app_run_count ~ ' completed run(s) for ' ~ swee_app_target_tag
              if swee_app_gate_conclusions | length == 0
         else 'job ' ~ required_check ~ ' concluded: '
              ~ (swee_app_gate_conclusions
                 | reject('equalto', 'success')
                 | map('default', 'in_progress', true)
                 | list | join(', ')) }}
  when: swee_app_pin_moved | default(true)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./tests/run.sh`
Expected: PASS, 20 plays. The Task 1 case asserting `'job test concluded: missing'` now fails — update that assertion to `'no job named test in 1 completed run(s) for '` plus its tag, and give that play a `swee_app_workflow_runs` with one run and a `swee_app_target_tag`.

- [ ] **Step 5: Commit**

```bash
git add roles/swee_app/tasks/decide_gate.yml tests/test_swee_decide.yml
git commit -m "feat: tell 'CI has not run' apart from 'no job named test'

Every non-green outcome collapsed into 'job test concluded: missing', which
covered three different situations an operator has to act on differently.
Both lists were already in hand, so splitting them costs one length check.

The second string is what makes the accepted rollback horizon legible: a
release cut before the gated job existed can never be installed, and 'no
job named test in 1 completed run(s) for v2.11.2' says so, where 'missing'
read as CI never having run."
```

---

### Task 6: Retry cap, keyed on the tag

**Files:**
- Modify: `roles/swee_app/tasks/decide_target.yml`
- Modify: `roles/swee_app/tasks/main.yml` (slurp `.failed-tag`; guard; remember; clear)
- Modify: `roles/swee_app/templates/deploy-status.json.j2`
- Modify: `tests/test_swee_decide.yml`

**Interfaces:**
- Consumes: `swee_app_target_tag`, `swee_app_pin_moved` (Tasks 2, 4).
- Produces: `swee_app_failed_tag` (string), `swee_app_failed_count` (int), `swee_app_retry_capped` (bool), all from `decide_target.yml`. `.failed-tag` on disk holds `"<tag> <count>"`.

**Note on the key.** `lyly_admin_app` keys its failure memory on the SHA. This role keys on the **tag**, so the cap is computable from local disk before any API call — a capped pin then skips even the tag resolution. Rollback semantics are unchanged: pinning a different tag is a different key and starts fresh.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_swee_decide.yml`:

```yaml
- name: A tag under the cap is not capped
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
    # base64 of "v2.12.0 2"
    swee_app_failed_raw: { content: "djIuMTIuMCAy" }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert two failures still allow a third attempt
      ansible.builtin.assert:
        that:
          - swee_app_failed_tag == 'v2.12.0'
          - swee_app_failed_count | int == 2
          - not swee_app_retry_capped

- name: A tag at the cap is capped
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
    # base64 of "v2.12.0 3"
    swee_app_failed_raw: { content: "djIuMTIuMCAz" }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert the third failure stops further attempts
      ansible.builtin.assert:
        that:
          - swee_app_retry_capped

- name: A different tag is never capped by another tag's failures
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.11.9
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
    swee_app_failed_raw: { content: "djIuMTIuMCAz" }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert rolling back to another tag starts fresh
      ansible.builtin.assert:
        that:
          - not swee_app_retry_capped

- name: A truncated .failed-tag does not raise
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
    # base64 of "v2.12.0" — an operator hand-clearing the cap
    swee_app_failed_raw: { content: "djIuMTIuMA==" }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert a one-token file reads as zero failures
      ansible.builtin.assert:
        that:
          - swee_app_failed_tag == 'v2.12.0'
          - swee_app_failed_count | int == 0
          - not swee_app_retry_capped

- name: An absent .failed-tag does not raise
  hosts: localhost
  gather_facts: false
  vars:
    swee_app_target_tag: v2.12.0
    swee_app_installed_tag_raw: { failed: true }
    swee_app_installed_sha_raw: { failed: true }
    swee_app_failed_raw: { failed: true }
  tasks:
    - ansible.builtin.import_tasks: ../roles/swee_app/tasks/decide_target.yml
    - name: Assert the clean state
      ansible.builtin.assert:
        that:
          - swee_app_failed_tag == 'none'
          - swee_app_failed_count | int == 0
          - not swee_app_retry_capped
```

- [ ] **Step 2: Run to verify they fail**

Run: `./tests/run.sh`
Expected: FAIL — `swee_app_failed_tag` is undefined.

- [ ] **Step 3: Add the cap facts to `decide_target.yml`**

```yaml
# Failure memory. Without it, a pinned release whose install fails would
# rebuild and restart the bot every five minutes forever, with a Discord
# alert each time. Pinning is what makes that loop reachable by a one-line
# commit, so the mechanism arrives with it.
#
# Keyed on the TAG, not the SHA as lyly_admin_app does, so the cap is known
# before any API call — a capped pin skips even the tag resolution. Rollback
# semantics are unchanged: a different tag is a different key, so promoting
# another version always starts fresh.
#
# `| default('', true)` then `.split()`: the slurp runs with
# failed_when: false, and an operator clearing a stuck cap will truncate or
# hand-write this file. Neither an absent file nor a one-token one may raise
# — that exact shape was a Critical in lyly_admin_app's counter parse.
- name: Split the last failed deploy record
  ansible.builtin.set_fact:
    swee_app_failed_tokens: >-
      {{ (swee_app_failed_raw.content | default('', true) | b64decode).split() }}

- name: Record the last failed deploy
  ansible.builtin.set_fact:
    swee_app_failed_tag: "{{ swee_app_failed_tokens[0] | default('none') }}"
    swee_app_failed_count: "{{ swee_app_failed_tokens[1] | default(0) | int }}"

# Hoisted so "same tag, three-plus failures" is one fact checked in three
# places — the install guard, the no-op result, and the gate string —
# instead of three independently-editable copies of the same predicate.
- name: Determine whether the target tag is retry-capped
  ansible.builtin.set_fact:
    swee_app_retry_capped: >-
      {{ swee_app_target_tag == swee_app_failed_tag
         and swee_app_failed_count | int >= 3 }}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `./tests/run.sh`
Expected: PASS, 26 plays (Task 6's review added an ordering test).

- [ ] **Step 5: Slurp the marker in `main.yml`**

Beside the other two slurps, before the `decide_target.yml` import:

```yaml
- name: Read the last failed deploy
  ansible.builtin.slurp:
    src: "{{ swee_dir }}/.failed-tag"
  register: swee_app_failed_raw
  failed_when: false
```

- [ ] **Step 6: Apply the cap to the guards**

Change the four API-call guards from `when: swee_app_pin_moved` to:

```yaml
  when: swee_app_pin_moved and not swee_app_retry_capped
```

Add the same to the install block's conditions:

```yaml
- name: Install swee
  when:
    - swee_app_pin_moved
    - not swee_app_retry_capped
    - swee_app_deploy_gate_passed | default(false)
  block:
```

- [ ] **Step 7: Record and clear the failure**

In the install block's `rescue:`, after `Mark the deploy failed`:

```yaml
    # failed_when: false — this task has no rescue of its own, so a failure
    # here (disk full, directory unwritable) would abort the play and skip
    # the status write below, losing the "failed" record that was already
    # set above. The status record matters more than the counter update.
    - name: Remember the failed tag
      ansible.builtin.copy:
        content: >-
          {{ swee_app_target_tag }} {{
            (swee_app_failed_count | int + 1)
            if swee_app_target_tag == swee_app_failed_tag else 1 }}
        dest: "{{ swee_dir }}/.failed-tag"
        owner: "{{ swee_user }}"
        group: "{{ swee_group }}"
        mode: "0644"
      failed_when: false
```

And as the final task of the block's success path, after `Record the deployed tag`:

```yaml
    # failed_when: false, and deliberately not in rescue: — failing to tidy
    # a stale marker must not turn an already-successful deploy into a
    # reported failure.
    - name: Clear the failure memory after a successful deploy
      ansible.builtin.file:
        path: "{{ swee_dir }}/.failed-tag"
        state: absent
      failed_when: false
```

- [ ] **Step 8: Explain the cap in the gate string**

In `decide_gate.yml`, **as the final task in the file**. Order is load-bearing: `Explain the gate outcome` runs unconditionally for a moved pin, so a cap explanation placed before it would be overwritten by a reason derived from API results that were never fetched.

```yaml
# Reported ahead of any CI verdict, because a capped tag never reaches the
# gate at all — the API calls are skipped. Without this the status file
# would read "unknown", which is the state that makes an operator distrust
# it. Recovery is to promote a different tag, or to remove the marker file.
- name: Explain a retry-cap block
  ansible.builtin.set_fact:
    swee_app_gate_reason: >-
      {{ swee_app_target_tag }} failed 3 times; not retrying
      (promote another tag, or rm {{ swee_dir }}/.failed-tag)
    swee_app_noop_result: blocked
  when:
    - swee_app_pin_moved | default(true)
    - swee_app_retry_capped | default(false)
```

- [ ] **Step 9: Surface the count in the status file**

In `deploy-status.json.j2`, before the closing brace:

```jinja
  "failed_attempts": {{ swee_app_failed_count | default(0) | int | to_json }},
```

- [ ] **Step 10: Run the full suite**

Run: `./tests/run.sh`
Expected: PASS, 25 plays, `failed=0`.

- [ ] **Step 11: Commit**

```bash
git add roles/swee_app/ tests/test_swee_decide.yml
git commit -m "feat: stop retrying a pinned release that keeps failing

swee_app had no failure memory: a pinned release whose install fails would
rebuild and restart the bot every five minutes forever, alerting each time.
Pinning is what makes that loop reachable by a one-line commit.

Keyed on the tag rather than the SHA lyly_admin_app uses, so the cap is
known from local disk before any API call and a capped pin skips even the
tag resolution. Promoting a different tag is a different key and starts
fresh, which is now the primary recovery — it needs no host access, unlike
rm'ing the marker.

Both parses guard against an operator having truncated the file to clear a
stuck cap; that shape was a Critical in lyly_admin_app's counter."
```

---

### Task 7: Consolidate the token and correct the prose

**Files:**
- Modify: `roles/swee_app/defaults/main.yml`
- Modify: `roles/lyly_admin_app/defaults/main.yml`
- Modify: `group_vars/all.yml`
- Modify: `bootstrap.sh`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `github_api_token` in `group_vars/all.yml`, defaulting to `""`. Both roles' `*_github_token` defaults derive from it, so their names are unchanged and every existing reference keeps working.

**Note.** This is the only task that touches `roles/lyly_admin_app/`, and only its `defaults/main.yml` — a one-line default with no behavioral effect while the value is unset. The no-touch rule in the Global Constraints is about its task logic.

- [ ] **Step 1: Add the shared variable**

In `group_vars/all.yml`, after `required_check`:

```yaml
# One token, both roles. Needed for RATE LIMITS, not access: both repos'
# endpoints answer unauthenticated, but the anonymous budget is 60/hr per
# source IP and a promotion burst can approach it. Under pinning this is a
# convenience rather than a dependency — a tick whose pin has not moved
# makes no API call at all, so an absent or expired token slows a promotion
# instead of breaking the loop.
#
# Scope it to LycheeHome/lyly-admin with `Actions: Read` and nothing else.
# NOT `Checks`: GitHub has removed that permission from fine-grained PATs,
# and reaching for it reproduces a 403 on every tick. swee needs no entry of
# its own — it is public, and an authenticated request gets the higher limit
# even for repos the token cannot otherwise see.
#
# The real value lives in /etc/lychee-ops/secrets.yml on the host.
github_api_token: ""
```

- [ ] **Step 2: Derive both role defaults from it**

`roles/swee_app/defaults/main.yml` — replace the whole existing comment block and value (its call-count arithmetic is now wrong, since the role makes 3 calls on a promotion and 0 otherwise):

```yaml
# Derived from the shared github_api_token in group_vars/all.yml so there is
# one value to rotate. Kept as a role-prefixed name because ansible-lint's
# production profile requires it, and because a future need for a
# swee-specific token should be a one-line override here rather than a
# refactor. See group_vars for why a token is wanted at all.
swee_app_github_token: "{{ github_api_token }}"
```

`roles/lyly_admin_app/defaults/main.yml` — same treatment:

```yaml
lyly_admin_app_github_token: "{{ github_api_token }}"
```

- [ ] **Step 3: Update the secrets template**

In `bootstrap.sh`, replace the two commented token lines with one:

```
# github_api_token: "github_pat_..."
```

and amend the surrounding prose so it no longer describes per-role keys.

- [ ] **Step 4: Document the pin in the README**

Add a section explaining that promoting a release is a commit to `group_vars/all.yml`, that rollback is `git revert` on it, that a capped tag is recovered by promoting a different one, and that the rollback horizon means releases predating the `test` job cannot be installed.

- [ ] **Step 5: Verify nothing references the old per-role secret keys**

Run: `grep -rn "swee_app_github_token\|lyly_admin_app_github_token" . --include="*.yml" --include="*.sh" --include="*.md" | grep -v "roles/.*defaults"`
Expected: only the `uri` header expressions inside the two roles' task files.

- [ ] **Step 6: Run the full suite and commit**

Run: `./tests/run.sh`
Expected: PASS, 26 plays (Task 6's review added an ordering test).

```bash
git add group_vars/all.yml roles/ bootstrap.sh README.md
git commit -m "refactor: one github_api_token for both roles

Two keys held one value, in two places, with nothing to keep them in step.
Both role defaults now derive from a shared group_vars entry, so there is
one thing to rotate; the role-prefixed names stay for ansible-lint and so a
swee-specific token remains a one-line override.

swee_app's default carried arithmetic that pinning invalidates — it said
the role makes 4 calls a tick. It now makes 3 on a promotion and none
otherwise, which is why the token drops from required to convenient."
```

---

## Operator cutover (after the plan is reviewed — not part of any task)

Run by hand, in order. The reconcile timer is already stopped.

1. `cd ~/WebstormProjects/personal/lychee-ops && ./tests/run.sh` — 23 plays green.
2. Push `lychee-ops`.
3. On `lychee`, as root, from the ops checkout: `ansible-playbook --check --diff --skip-tags app playbook.yml`, redirecting output to a file (piping `ansible-playbook` through this harness fails with "requires blocking IO").
4. Apply. **Expect the first tick to block**, with `gate` reading `no job named test in 1 completed run(s) for v2.11.2`. That single line proves the pin is read, the guards let a moved pin through, the gate still runs, and the horizon is legible.
5. Cut a real swee release (a `feat:`/`fix:` commit, or a `Release-As:` footer), bump `swee_version`, push, apply. Expect `deployed` and the bot back on Discord.
6. **Unset `github_api_token` in `/etc/lychee-ops/secrets.yml` and run one more tick with the pin unchanged.** It must succeed. This is the direct proof of the zero-API-calls claim; a subtly wrong guard is indistinguishable from a correct one until the rate limit runs out. Restore the token afterward.
7. `systemctl start lyly-reconcile.timer`; confirm an unattended tick reports `skipped`.
8. Update this repo's CLAUDE.md. Its Deployment section says *"the `swee` bot has not migrated yet"* and lists it as one of two remaining dependents of the self-hosted runner; both become false at step 5. The scaffolded-sites dependency (`frameworkScaffold.ts:75`) is untouched and stays, so the runner still cannot be retired — only the sentence about swee changes.
