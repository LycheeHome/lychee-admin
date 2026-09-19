# Pull-Based Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `lyly-admin`'s self-hosted-runner deploy job with `ansible-pull` on `lychee`, so the repo can be made public without exposing the runner to fork pull requests.

**Architecture:** A new private repo `LycheeHome/lychee-ops` holds an Ansible playbook that `lychee` runs against itself on a systemd timer. One role declares six host files moved out of `lyly-admin/deploy/`; a second fetches `main`, refuses to deploy unless its `test` check is green, builds as the `lyly-admin` user, installs to `/opt/lyly-admin`, and health-checks. The `lyly-admin` repo loses its deploy job and its `deploy/` directory.

**Tech Stack:** Ansible (`ansible-pull`), systemd timers, Node 22, GitHub Actions (test job only), GitHub REST API for the green-check gate.

**Spec:** `docs/superpowers/specs/2026-09-18-pull-based-deploy-design.md`

## Global Constraints

- Ops repo: `LycheeHome/lychee-ops`, **private**. Never public — it installs root-owned files.
- Timer interval: 5 minutes.
- Build directory: `/var/lib/lychee-ops/build`. App checkout: `/var/lib/lychee-ops/src/lyly-admin`.
- Status file: `/var/lib/lyly-admin/deploy-status.json`.
- Reconcile units: `lyly-reconcile.timer`, `lyly-reconcile.service`.
- The playbook **must never** touch `/etc/caddy/Caddyfile`, `/etc/cloudflared/sites-config.yml` (app-mutated), `/etc/cloudflared/config.yml` or `cloudflared.service` (the SSH tunnel carrying `ssh.lyly.dev`), or `/opt/lyly-admin/.env`.
- Builds run as `lyly-admin`, never root. Only installation steps use root.
- Rsync exclusions must match the current workflow exactly: `.git`, `.env`, `node_modules`, `src/dev`, `*.test.ts`.
- Health check expects HTTP `401` from `http://${HOST}:${PORT}/`.
- Node 22 (`engines.node: >=22`).

## Testing Note — Read Before Task 1

Classic TDD does not apply to most of this plan: there is no unit-test harness for a playbook that configures a host. The honest substitute, used in every Ansible task below, is:

1. `ansible-playbook --syntax-check` and `ansible-lint` — catches structural errors
2. `--check --diff` — shows what *would* change without changing it
3. **Idempotency**: run twice for real; the second run must report `changed=0`

A task is not done until its second run is `changed=0`. That is the closest thing to a passing test here, and it catches the most common Ansible defect (a task that rewrites a file every tick).

Tasks 7–9 touch `lyly-admin` and *do* have a real test suite: `npm run typecheck && npm run lint && npm test && npm run build`.

## File Structure

### New repo: `LycheeHome/lychee-ops` (private)

```
ansible.cfg                    inventory/config defaults
inventory.yml                  localhost, connection=local
playbook.yml                   applies the three roles in order
bootstrap.sh                   one-time: installs ansible + reconcile units
group_vars/all.yml             paths, repo URLs, interval
roles/
  reconciler/
    tasks/main.yml             installs its own timer/service/notify units
    handlers/main.yml          daemon-reload
    templates/
      lyly-reconcile.service.j2
      lyly-reconcile.timer.j2
      lyly-reconcile-notify.service.j2
      notify.sh.j2             Discord webhook POST
  lyly_admin_host/
    tasks/main.yml             the six declared files
    handlers/main.yml          daemon-reload, restart units
    files/                     moved verbatim from lyly-admin/deploy/
      lyly-admin.service
      cloudflared-sites.service
      sudoers.example
      lyly-admin-write-config.sh
      lyly-admin-create-site-dir.sh
      lyly-admin-docker-status.sh
  lyly_admin_app/
    defaults/main.yml
    tasks/main.yml             fetch → gate → build → install → verify
    templates/deploy-status.json.j2
```

### Modified repo: `lyly-admin`

```
.github/workflows/deploy.yml  → renamed ci.yml, deploy job removed
.github/scripts/              → deleted entirely
deploy/                       → deleted (moved to lychee-ops)
src/config.ts                 → one comment repointed
src/lib/systemCommands.ts     → five comments repointed
CLAUDE.md                     → Deployment section rewritten
```

---

### Task 1: Ops repo skeleton

**Files:**
- Create: `lychee-ops/ansible.cfg`
- Create: `lychee-ops/inventory.yml`
- Create: `lychee-ops/group_vars/all.yml`
- Create: `lychee-ops/playbook.yml`
- Create: `lychee-ops/.gitignore`
- Create: `lychee-ops/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: variables `ops_root`, `build_dir`, `src_dir`, `app_repo_url`, `app_install_dir`, `status_file`, `reconcile_interval`, consumed by every later role.

> **Repo creation is an operator step**, not an agent step — see Operator Cutover step 0. Write these files into a local directory; the operator creates the remote and pushes.

- [ ] **Step 1: Create `ansible.cfg`**

```ini
[defaults]
inventory = inventory.yml
roles_path = roles
stdout_callback = yaml
# ansible-pull runs unattended; no prompts, ever.
host_key_checking = False
retry_files_enabled = False

[privilege_escalation]
become = True
become_method = sudo
```

- [ ] **Step 2: Create `inventory.yml`**

```yaml
# ansible-pull always runs against the local host. Nothing here reaches out
# over SSH — that is the entire point of the pull model.
all:
  hosts:
    lychee:
      ansible_connection: local
```

- [ ] **Step 3: Create `group_vars/all.yml`**

```yaml
ops_root: /var/lib/lychee-ops
build_dir: "{{ ops_root }}/build"
src_dir: "{{ ops_root }}/src/lyly-admin"

app_repo_url: https://github.com/LycheeHome/lyly-admin.git
app_repo_slug: LycheeHome/lyly-admin
app_branch: main
app_install_dir: /opt/lyly-admin
app_user: lyly-admin
app_group: webdeploy

status_file: /var/lib/lyly-admin/deploy-status.json

# The GitHub Actions job name that must be green before anything installs.
required_check: test

reconcile_interval: 5min
```

- [ ] **Step 4: Create `playbook.yml`**

```yaml
- name: Reconcile lychee
  hosts: lychee
  become: true
  roles:
    - reconciler
    - lyly_admin_host
    - lyly_admin_app
```

- [ ] **Step 5: Create `.gitignore`**

```
*.retry
__pycache__/
.DS_Store
```

- [ ] **Step 6: Create `README.md`**

````markdown
# lychee-ops

Ansible playbook `lychee` runs against itself on a 5-minute systemd timer.

**Private, and must stay private.** It installs root-owned files —
`/etc/sudoers.d`, systemd units, `/usr/local/sbin` wrappers. Public read
access here would mean anyone able to open a pull request could propose
content that lands as root on the host.

Design: `lyly-admin/docs/superpowers/specs/2026-09-18-pull-based-deploy-design.md`

## Running by hand

```bash
sudo ansible-pull -U git@github.com:LycheeHome/lychee-ops.git \
  -d /var/lib/lychee-ops/ops -i inventory.yml playbook.yml --check --diff
```

Drop `--check` to apply. Never skip `--diff` on a first run after editing
the host role.
````

- [ ] **Step 7: Verify syntax**

Run: `ansible-playbook --syntax-check playbook.yml`
Expected: `playbook: playbook.yml` and exit 0. It will complain that roles
are missing — that is correct at this point; Task 2 adds the first one.

- [ ] **Step 8: Commit**

```bash
git add ansible.cfg inventory.yml group_vars/all.yml playbook.yml .gitignore README.md
git commit -m "chore: ops repo skeleton"
```

---

### Task 2: `lyly_admin_host` role — declare the six files

**Files:**
- Create: `lychee-ops/roles/lyly_admin_host/tasks/main.yml`
- Create: `lychee-ops/roles/lyly_admin_host/handlers/main.yml`
- Create: `lychee-ops/roles/lyly_admin_host/files/` — six files copied verbatim from `lyly-admin/deploy/`

**Interfaces:**
- Consumes: nothing from other roles
- Produces: `/usr/local/sbin/lyly-admin-{write-config,create-site-dir,docker-status}` and `/etc/sudoers.d/lyly-admin` in the state `lyly_admin_app`'s health check depends on.

- [ ] **Step 1: Copy the six files**

```bash
mkdir -p roles/lyly_admin_host/files
cp ../lyly-admin/deploy/lyly-admin.service            roles/lyly_admin_host/files/
cp ../lyly-admin/deploy/cloudflared-sites.service     roles/lyly_admin_host/files/
cp ../lyly-admin/deploy/sudoers.example               roles/lyly_admin_host/files/
cp ../lyly-admin/deploy/lyly-admin-write-config.sh    roles/lyly_admin_host/files/
cp ../lyly-admin/deploy/lyly-admin-create-site-dir.sh roles/lyly_admin_host/files/
cp ../lyly-admin/deploy/lyly-admin-docker-status.sh   roles/lyly_admin_host/files/
```

`sudoers-github-runner.example` is deliberately **not** copied. `github-runner` no longer deploys anything, so its sudo grant is deleted rather than declared — see Task 7 Step 5.

- [ ] **Step 2: Create `roles/lyly_admin_host/tasks/main.yml`**

```yaml
# Declares the host files lyly-admin needs but does not itself manage.
#
# Deliberately absent: /etc/caddy/Caddyfile and /etc/cloudflared/sites-config.yml
# (lyly-admin mutates these at runtime — declaring them would revert every site
# the app adds), and /etc/cloudflared/config.yml plus cloudflared.service (the
# lychee-ssh tunnel carrying ssh.lyly.dev; restarting it could cut remote access).

- name: Install lyly-admin systemd unit
  ansible.builtin.copy:
    src: lyly-admin.service
    dest: /etc/systemd/system/lyly-admin.service
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Restart lyly-admin

- name: Install cloudflared-sites systemd unit
  ansible.builtin.copy:
    src: cloudflared-sites.service
    dest: /etc/systemd/system/cloudflared-sites.service
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Restart cloudflared-sites

# validate: runs visudo -cf against the candidate file BEFORE it replaces the
# live one. A syntactically broken sudoers file is refused, not installed.
# Note this does not catch a valid file with wrong content.
- name: Install lyly-admin sudoers drop-in
  ansible.builtin.copy:
    src: sudoers.example
    dest: /etc/sudoers.d/lyly-admin
    owner: root
    group: root
    mode: "0440"
    validate: visudo -cf %s

- name: Install privileged wrapper scripts
  ansible.builtin.copy:
    src: "{{ item.src }}"
    dest: "{{ item.dest }}"
    owner: root
    group: root
    mode: "0700"
  loop:
    - src: lyly-admin-write-config.sh
      dest: /usr/local/sbin/lyly-admin-write-config
    - src: lyly-admin-create-site-dir.sh
      dest: /usr/local/sbin/lyly-admin-create-site-dir
    - src: lyly-admin-docker-status.sh
      dest: /usr/local/sbin/lyly-admin-docker-status
```

- [ ] **Step 3: Create `roles/lyly_admin_host/handlers/main.yml`**

```yaml
- name: Reload systemd
  ansible.builtin.systemd:
    daemon_reload: true

# Restarting cloudflared-sites briefly interrupts site traffic. Accepted:
# it only fires when the unit file itself changes, which is rare.
- name: Restart cloudflared-sites
  ansible.builtin.systemd:
    name: cloudflared-sites
    state: restarted

- name: Restart lyly-admin
  ansible.builtin.systemd:
    name: lyly-admin
    state: restarted
```

- [ ] **Step 4: Add the role to the playbook**

Already listed in Task 1 Step 4. No edit needed.

- [ ] **Step 5: Lint and syntax-check**

Run:
```bash
ansible-lint roles/lyly_admin_host
ansible-playbook --syntax-check playbook.yml
```
Expected: no errors. (`reconciler` and `lyly_admin_app` are still missing; comment them out of `playbook.yml` temporarily if the syntax check objects, and restore them in Tasks 6 and 3 respectively.)

- [ ] **Step 6: Dry run against the host** — operator step, see Cutover step 1

Run on `lychee`:
```bash
sudo ansible-playbook -i inventory.yml playbook.yml --check --diff --tags lyly_admin_host
```
Expected: `changed=0`. **A non-zero count here is information, not a failure** — it means the host has drifted from what `deploy/` says, which is exactly what this project exists to surface. Read every diff before proceeding.

- [ ] **Step 7: Commit**

```bash
git add roles/lyly_admin_host
git commit -m "feat: declare lyly-admin host files"
```

---

### Task 3: `lyly_admin_app` role — resolve target and gate on green CI

**Files:**
- Create: `lychee-ops/roles/lyly_admin_app/defaults/main.yml`
- Create: `lychee-ops/roles/lyly_admin_app/tasks/main.yml`

**Interfaces:**
- Consumes: `app_repo_url`, `app_repo_slug`, `app_branch`, `src_dir`, `required_check` from `group_vars/all.yml`
- Produces: facts `target_sha` (string, 40-hex), `installed_sha` (string or `"none"`), `deploy_gate_passed` (bool), `gate_reason` (string). Task 4 and Task 5 both read these.

- [ ] **Step 1: Create `roles/lyly_admin_app/defaults/main.yml`**

```yaml
# Optional. Required only while lyly-admin is a private repo; once it is
# public the check-runs API answers unauthenticated. Supply via ansible-vault
# or a file the reconcile unit sources. Empty string means "call anonymously".
github_token: ""
```

- [ ] **Step 2: Create `roles/lyly_admin_app/tasks/main.yml` — resolve and gate**

```yaml
- name: Ensure ops directories exist
  ansible.builtin.file:
    path: "{{ item }}"
    state: directory
    owner: "{{ app_user }}"
    group: "{{ app_group }}"
    mode: "2775"
  loop:
    - "{{ ops_root }}"
    - "{{ build_dir }}"
    - "{{ src_dir | dirname }}"

- name: Fetch the app repo
  ansible.builtin.git:
    repo: "{{ app_repo_url }}"
    dest: "{{ src_dir }}"
    version: "{{ app_branch }}"
    force: true
  become_user: "{{ app_user }}"
  register: app_checkout

- name: Record the target commit
  ansible.builtin.set_fact:
    target_sha: "{{ app_checkout.after }}"

- name: Read the currently installed commit
  ansible.builtin.slurp:
    src: "{{ app_install_dir }}/.deployed-sha"
  register: installed_sha_raw
  failed_when: false

- name: Record the installed commit
  ansible.builtin.set_fact:
    installed_sha: >-
      {{ (installed_sha_raw.content | b64decode | trim)
         if installed_sha_raw.content is defined else 'none' }}

# The gate. This is what `needs: test` does today: a red main leaves lychee
# serving the last good build rather than installing broken code.
- name: Query check runs for the target commit
  ansible.builtin.uri:
    url: "https://api.github.com/repos/{{ app_repo_slug }}/commits/{{ target_sha }}/check-runs"
    method: GET
    headers: >-
      {{ {'Accept': 'application/vnd.github+json'}
         | combine({'Authorization': 'Bearer ' + github_token} if github_token else {}) }}
    return_content: true
    status_code: [200]
  register: check_runs
  retries: 3
  delay: 10
  until: check_runs.status == 200

- name: Decide whether the gate passes
  ansible.builtin.set_fact:
    gate_conclusion: >-
      {{ (check_runs.json.check_runs
          | selectattr('name', 'equalto', required_check)
          | map(attribute='conclusion')
          | list
          | first) | default('missing') }}

- name: Record the gate outcome
  ansible.builtin.set_fact:
    deploy_gate_passed: "{{ gate_conclusion == 'success' }}"
    gate_reason: >-
      {{ 'ok' if gate_conclusion == 'success'
         else 'check ' ~ required_check ~ ' concluded: ' ~ gate_conclusion }}

- name: Report a blocked deploy
  ansible.builtin.debug:
    msg: "Not deploying {{ target_sha[:8] }} — {{ gate_reason }}"
  when: not deploy_gate_passed
```

`gate_conclusion` is `'missing'` when no check run named `test` exists for
that commit — which happens if the workflow has not started yet. That is
correctly treated as not-green: the next tick five minutes later will see
it. Deliberately **fails closed**, unlike `deploy-needed.sh`, because the
dangerous outcome here is installing untested code, not skipping a tick.

- [ ] **Step 3: Restore the role in `playbook.yml`**

Confirm `lyly_admin_app` is present in the `roles:` list from Task 1 Step 4.

- [ ] **Step 4: Lint and syntax-check**

Run:
```bash
ansible-lint roles/lyly_admin_app
ansible-playbook --syntax-check playbook.yml
```
Expected: exit 0, no errors.

- [ ] **Step 5: Verify the gate both ways** — operator step, Cutover step 2

On `lychee`, with `--check`:
```bash
sudo ansible-playbook -i inventory.yml playbook.yml --check --diff
```
Expected on a green `main`: `gate_reason: ok`.
Then temporarily set `app_branch` to a branch with a failing `test` run and
re-run. Expected: the debug message `Not deploying <sha> — check test
concluded: failure`, and no install tasks attempted. Restore `app_branch`.

- [ ] **Step 6: Commit**

```bash
git add roles/lyly_admin_app
git commit -m "feat: resolve target commit and gate on green CI"
```

---

### Task 4: `lyly_admin_app` role — build, install, verify

**Files:**
- Modify: `lychee-ops/roles/lyly_admin_app/tasks/main.yml` (append)

**Interfaces:**
- Consumes: `target_sha`, `installed_sha`, `deploy_gate_passed` from Task 3
- Produces: `deploy_result` (string: `"deployed"`, `"skipped"`, or `"blocked"`) and `deploy_failed_step` (string or empty), both read by Task 5's status file.

- [ ] **Step 1: Append the install block to `roles/lyly_admin_app/tasks/main.yml`**

```yaml
- name: Install the new build
  when:
    - deploy_gate_passed
    - target_sha != installed_sha
  block:
    - name: Sync source into the build directory
      ansible.posix.synchronize:
        src: "{{ src_dir }}/"
        dest: "{{ build_dir }}/"
        delete: true
        recursive: true
        rsync_opts:
          - "--exclude=.git"
          - "--exclude=node_modules"
      delegate_to: "{{ inventory_hostname }}"

    # Builds run as lyly-admin, never root: npm install executes dependency
    # lifecycle scripts, and those must not have privilege. Same reasoning
    # that keeps the Express process off root.
    - name: Install build dependencies
      ansible.builtin.command:
        cmd: npm ci
        chdir: "{{ build_dir }}"
      become_user: "{{ app_user }}"
      changed_when: true

    - name: Build
      ansible.builtin.command:
        cmd: npm run build
        chdir: "{{ build_dir }}"
      become_user: "{{ app_user }}"
      changed_when: true

    # Exclusions match the workflow this replaces exactly. src/dev and
    # *.test.ts must never reach the host: the dev entry point imports
    # in-memory fakes.
    - name: Sync the build into the install directory
      ansible.posix.synchronize:
        src: "{{ build_dir }}/"
        dest: "{{ app_install_dir }}/"
        delete: true
        recursive: true
        rsync_opts:
          - "--exclude=.git"
          - "--exclude=.env"
          - "--exclude=node_modules"
          - "--exclude=src/dev"
          - "--exclude=*.test.ts"
      delegate_to: "{{ inventory_hostname }}"

    - name: Install production dependencies
      ansible.builtin.command:
        cmd: npm ci --omit=dev
        chdir: "{{ app_install_dir }}"
      become_user: "{{ app_user }}"
      changed_when: true

    - name: Restart lyly-admin
      ansible.builtin.systemd:
        name: lyly-admin
        state: restarted

    # A 401 proves Express bound its port AND basic-auth middleware ran.
    # systemctl is-active only proves systemd thinks the process exists.
    - name: Health check
      ansible.builtin.shell:
        cmd: |
          set -a
          . {{ app_install_dir }}/.env
          set +a
          curl -s -o /dev/null -w "%{http_code}" "http://${HOST:-127.0.0.1}:${PORT:-8787}/"
        executable: /bin/bash
      register: health
      changed_when: false
      failed_when: health.stdout | trim != "401"
      retries: 5
      delay: 2
      until: health.stdout | trim == "401"

    - name: Record the deployed commit
      ansible.builtin.copy:
        content: "{{ target_sha }}\n"
        dest: "{{ app_install_dir }}/.deployed-sha"
        owner: "{{ app_user }}"
        group: "{{ app_group }}"
        mode: "0644"

    - name: Mark the deploy successful
      ansible.builtin.set_fact:
        deploy_result: deployed
        deploy_failed_step: ""

  rescue:
    # Deliberately does NOT roll back. The service keeps running whatever it
    # was running; a half-finished install is worse than a stale one. The
    # OnFailure notification and the status file carry the signal.
    # Deliberately does NOT fail here. A fail: in the rescue aborts the play
    # immediately, and the status file would never be written on the one path
    # where it matters most. Task 5 adds a terminal fail: after the status
    # write, so the unit still exits non-zero and OnFailure= still fires.
    - name: Mark the deploy failed
      ansible.builtin.set_fact:
        deploy_result: failed
        deploy_failed_step: "{{ ansible_failed_task.name | default('unknown') }}"

- name: Record a no-op run
  ansible.builtin.set_fact:
    deploy_result: "{{ 'blocked' if not deploy_gate_passed else 'skipped' }}"
    deploy_failed_step: ""
  when: deploy_result is not defined
```

- [ ] **Step 2: Lint**

Run: `ansible-lint roles/lyly_admin_app`
Expected: exit 0.

- [ ] **Step 3: Idempotency check** — operator step, Cutover step 2

Run the playbook for real twice on `lychee`. Expected: the first run may
deploy; the **second run must report `changed=0`** for this role and
`deploy_result: skipped`. A second run that deploys again means
`.deployed-sha` is not being read or written correctly — fix before moving on.

- [ ] **Step 4: Commit**

```bash
git add roles/lyly_admin_app
git commit -m "feat: build, install and health-check the app"
```

---

### Task 5: Deploy status file

**Files:**
- Create: `lychee-ops/roles/lyly_admin_app/templates/deploy-status.json.j2`
- Modify: `lychee-ops/roles/lyly_admin_app/tasks/main.yml` (append)

**Interfaces:**
- Consumes: `target_sha`, `installed_sha`, `deploy_result`, `deploy_failed_step`, `gate_reason`
- Produces: `/var/lib/lyly-admin/deploy-status.json`, read by the operator and, later, possibly by the app itself.

- [ ] **Step 1: Create `roles/lyly_admin_app/templates/deploy-status.json.j2`**

```jinja
{
  "last_run": "{{ ansible_date_time.iso8601 }}",
  "target_commit": "{{ target_sha | default('unknown') }}",
  "installed_commit": "{{ installed_sha | default('none') }}",
  "result": "{{ deploy_result | default('unknown') }}",
  "gate": "{{ gate_reason | default('unknown') }}",
  "failed_step": "{{ deploy_failed_step | default('') }}"
}
```

- [ ] **Step 2: Append the status-file tasks to `roles/lyly_admin_app/tasks/main.yml`**

Append these as **plain top-level tasks** at the end of the file — *not*
inside the block's `always:`. When a block's `when:` evaluates false, Ansible
skips the whole block including `rescue:` and `always:`, so an `always:` here
would never run on the skipped path, which is the most common path of all.

```yaml
- name: Ensure the status directory exists
  ansible.builtin.file:
    path: "{{ status_file | dirname }}"
    state: directory
    owner: "{{ app_user }}"
    group: "{{ app_group }}"
    mode: "0755"

- name: Write the deploy status file
  ansible.builtin.template:
    src: deploy-status.json.j2
    dest: "{{ status_file }}"
    owner: "{{ app_user }}"
    group: "{{ app_group }}"
    mode: "0644"

# Terminal, after the status write, so a failed deploy still exits non-zero
# and still trips OnFailure= — but only once the failure has been recorded.
- name: Fail the run if the deploy failed
  ansible.builtin.fail:
    msg: "Deploy of {{ target_sha[:8] }} failed at: {{ deploy_failed_step }}"
  when: deploy_result == 'failed'
```

The status file must be written on **every** path — deployed, skipped,
blocked and failed. A status file that only appears on success cannot tell
you the reconciler is stuck.

- [ ] **Step 3: Verify the status file is valid JSON** — operator step

After a real run on `lychee`:
```bash
python3 -m json.tool /var/lib/lyly-admin/deploy-status.json
```
Expected: pretty-printed JSON, exit 0.

- [ ] **Step 4: Commit**

```bash
git add roles/lyly_admin_app/templates roles/lyly_admin_app/tasks/main.yml
git commit -m "feat: deploy status file"
```

---

### Task 6: `reconciler` role — timer, service, notification, bootstrap

**Files:**
- Create: `lychee-ops/roles/reconciler/tasks/main.yml`
- Create: `lychee-ops/roles/reconciler/handlers/main.yml`
- Create: `lychee-ops/roles/reconciler/templates/lyly-reconcile.service.j2`
- Create: `lychee-ops/roles/reconciler/templates/lyly-reconcile.timer.j2`
- Create: `lychee-ops/roles/reconciler/templates/lyly-reconcile-notify.service.j2`
- Create: `lychee-ops/roles/reconciler/templates/notify.sh.j2`
- Modify: `lychee-ops/group_vars/all.yml` (append `discord_webhook_url`)
- Create: `lychee-ops/bootstrap.sh`

**Interfaces:**
- Consumes: `reconcile_interval`, `ops_root`, `discord_webhook_url`
- Produces: `lyly-reconcile.timer` and `lyly-reconcile.service` on the host. After bootstrap, the playbook maintains its own units — the role is self-hosting.

- [ ] **Step 1: Create `roles/reconciler/templates/lyly-reconcile.service.j2`**

```ini
[Unit]
Description=Reconcile lychee from lychee-ops
After=network-online.target
Wants=network-online.target
OnFailure=lyly-reconcile-notify.service

[Service]
Type=oneshot
ExecStart=/usr/bin/ansible-pull \
  --url git@github.com:LycheeHome/lychee-ops.git \
  --directory {{ ops_root }}/ops \
  --inventory inventory.yml \
  playbook.yml
TimeoutStartSec=900
```

- [ ] **Step 2: Create `roles/reconciler/templates/lyly-reconcile.timer.j2`**

```ini
[Unit]
Description=Run lychee reconcile every {{ reconcile_interval }}

[Timer]
OnBootSec=2min
OnUnitActiveSec={{ reconcile_interval }}
# Spread the load off exact minute boundaries.
RandomizedDelaySec=30
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Create `roles/reconciler/templates/lyly-reconcile-notify.service.j2`**

```ini
[Unit]
Description=Notify that lyly-reconcile failed

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lyly-reconcile-notify
```

- [ ] **Step 4: Create `roles/reconciler/templates/notify.sh.j2`**

```bash
#!/usr/bin/env bash
# Fired by lyly-reconcile-notify.service via OnFailure=. Posts the tail of
# the failed run to Discord. Silent reconciler failure is the dangerous
# outcome: lychee would serve stale code with nothing surfacing it.
set -uo pipefail

WEBHOOK="{{ discord_webhook_url }}"
[ -z "$WEBHOOK" ] && exit 0

BODY=$(journalctl -u lyly-reconcile.service -n 30 --no-pager | tail -c 1500)
PAYLOAD=$(printf '%s' "$BODY" | python3 -c '
import json,sys
print(json.dumps({"content": "lyly-reconcile FAILED on lychee:\n```\n" + sys.stdin.read() + "\n```"}))
')

curl -sf -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$WEBHOOK" >/dev/null || true
```

- [ ] **Step 5: Add the webhook variable**

Append to `group_vars/all.yml`:

```yaml
# Discord webhook for reconcile failures. Same channel the swee bot uses.
# Store the real value with ansible-vault; empty disables notification.
discord_webhook_url: ""
```

- [ ] **Step 6: Create `roles/reconciler/tasks/main.yml`**

```yaml
# The reconciler maintains its own units. Bootstrap installs them once by
# hand (see bootstrap.sh); from then on this role owns them, so changing the
# interval is a commit rather than an ssh session.

- name: Install the notify script
  ansible.builtin.template:
    src: notify.sh.j2
    dest: /usr/local/sbin/lyly-reconcile-notify
    owner: root
    group: root
    mode: "0700"

- name: Install reconcile units
  ansible.builtin.template:
    src: "{{ item }}.j2"
    dest: "/etc/systemd/system/{{ item }}"
    owner: root
    group: root
    mode: "0644"
  loop:
    - lyly-reconcile.service
    - lyly-reconcile.timer
    - lyly-reconcile-notify.service
  notify: Reload systemd

- name: Enable the reconcile timer
  ansible.builtin.systemd:
    name: lyly-reconcile.timer
    enabled: true
    state: started
    daemon_reload: true
```

- [ ] **Step 7: Create `roles/reconciler/handlers/main.yml`**

```yaml
- name: Reload systemd
  ansible.builtin.systemd:
    daemon_reload: true
```

- [ ] **Step 8: Create `bootstrap.sh`**

```bash
#!/usr/bin/env bash
# One-time setup on lychee. Everything after this is maintained by the
# playbook itself, including these units.
#
# Run as root:  sudo bash bootstrap.sh
set -euo pipefail

OPS_ROOT=/var/lib/lychee-ops
OPS_REPO=git@github.com:LycheeHome/lychee-ops.git

command -v ansible-pull >/dev/null || {
  apt-get update
  apt-get install -y ansible
}

install -d -m 0755 "$OPS_ROOT"

# Read-only deploy key for the private ops repo must already be in place at
# /root/.ssh/id_lychee_ops with a matching Host entry in /root/.ssh/config.
test -f /root/.ssh/id_lychee_ops || {
  echo "Missing /root/.ssh/id_lychee_ops — add the deploy key first." >&2
  exit 1
}

ansible-pull --url "$OPS_REPO" --directory "$OPS_ROOT/ops" \
  --inventory inventory.yml playbook.yml --check --diff

echo
echo "Dry run complete. Review the diff above, then re-run without --check:"
echo "  ansible-pull --url $OPS_REPO --directory $OPS_ROOT/ops \\"
echo "    --inventory inventory.yml playbook.yml"
```

- [ ] **Step 9: Verify unit syntax**

Run: `systemd-analyze verify roles/reconciler/templates/lyly-reconcile.timer.j2` — this will
fail on the Jinja placeholder, which is expected. Instead render and check on
the host after the first run:
```bash
systemd-analyze verify /etc/systemd/system/lyly-reconcile.timer
systemctl list-timers lyly-reconcile.timer
```
Expected: no warnings; the timer lists a next-run time.

- [ ] **Step 10: Commit**

```bash
git add roles/reconciler bootstrap.sh group_vars/all.yml
git commit -m "feat: reconcile timer, service and bootstrap"
```

---

> **STOP.** Tasks 7–9 modify `lyly-admin` and must not merge until Operator
> Cutover steps 1–3 have passed. Deleting the deploy job before `ansible-pull`
> is proven leaves no working deploy path.

---

### Task 7: `lyly-admin` — workflow becomes CI-only

**Files:**
- Rename: `.github/workflows/deploy.yml` → `.github/workflows/ci.yml`
- Delete: `.github/scripts/deploy-needed.sh`
- Delete: `.github/scripts/deploy-needed.test.sh`
- Delete: `deploy/sudoers-github-runner.example`

**Interfaces:**
- Consumes: nothing
- Produces: a workflow whose only job is `test` — the check name Task 3's gate queries. **The job must stay named `test`**, or `required_check` in `group_vars/all.yml` must change to match.

- [ ] **Step 1: Rename the workflow**

```bash
git mv .github/workflows/deploy.yml .github/workflows/ci.yml
```

- [ ] **Step 2: Rewrite `.github/workflows/ci.yml`**

```yaml
name: CI

# Runs on every pull request against main and every push to main, always on
# a GitHub-hosted runner. Deployment is no longer performed here: lychee
# pulls from main on a timer via LycheeHome/lychee-ops. That split is what
# lets this repo be public — a fork PR supplies its own workflow file, so a
# self-hosted runner reachable from here would be a remote code execution
# path onto the host.
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  # Name is load-bearing: lychee-ops gates its deploy on a check run called
  # exactly "test". Renaming this job silently stops all deploys.
  test:
    runs-on: ubuntu-latest

    concurrency:
      group: test-${{ github.ref }}
      cancel-in-progress: true

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22

      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

Three things collapsed with the deploy job: `outputs.deploy_needed` and the
two steps computing it; `fetch-depth: 0`, needed only to diff against
`github.event.before`; and the conditional `cancel-in-progress`, which
existed because a cancelled test on `main` would have taken its dependent
deploy with it. `workflow_dispatch` is gone too — it existed to trigger
deploys.

- [ ] **Step 3: Delete the deploy-gating scripts**

```bash
git rm .github/scripts/deploy-needed.sh .github/scripts/deploy-needed.test.sh
```

- [ ] **Step 4: Verify the YAML parses**

Run:
```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); print('jobs:', list(d['jobs'].keys()))"
```
Expected: `jobs: ['test']`
If PyYAML is unavailable, run `npx --yes yaml-lint .github/workflows/ci.yml`.

- [ ] **Step 5: Delete the runner's sudoers example**

```bash
git rm deploy/sudoers-github-runner.example
```

`github-runner` no longer deploys, so its sudo grant should also be removed
from the host — see Operator Cutover step 6.

- [ ] **Step 6: Run the suite**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass. None of them read the deleted files.

- [ ] **Step 7: Commit**

```bash
git add -A .github deploy
git commit -m "ci: drop the deploy job; lychee now pulls"
```

---

### Task 8: `lyly-admin` — delete `deploy/`, repoint comments

**Files:**
- Delete: `deploy/` (remaining six files)
- Modify: `src/config.ts:24`
- Modify: `src/lib/systemCommands.ts:35,81,90,101,131`

**Interfaces:**
- Consumes: nothing
- Produces: nothing. Comment-only change plus a directory removal; no runtime behaviour changes. `src/` already invokes the wrappers by installed path (`/usr/local/sbin/...`), never by repo path.

- [ ] **Step 1: Confirm nothing reads `deploy/`**

Run:
```bash
git grep -n 'deploy/' -- src/ public/ package.json tsconfig*.json eslint.config.js
```
Expected: only comment lines in `src/config.ts` and `src/lib/systemCommands.ts`.
If any non-comment hit appears, **stop** and re-plan — the spec's claim that
`deploy/` is not read would be wrong.

- [ ] **Step 2: Delete the directory**

```bash
git rm -r deploy
```

- [ ] **Step 3: Repoint the comment in `src/config.ts`**

Change line 24 from:
```
  // Must stay "/var/www" — deploy/lyly-admin-create-site-dir.sh hardcodes
```
to:
```
  // Must stay "/var/www" — lychee-ops' lyly-admin-create-site-dir.sh hardcodes
```

- [ ] **Step 4: Repoint the five comments in `src/lib/systemCommands.ts`**

Replace each `deploy/<name>` reference with `lychee-ops' <name>`:

| Line | Old | New |
|---|---|---|
| 35 | `see deploy/sudoers.example` | `see lychee-ops' sudoers.example` |
| 81 | `(see deploy/cloudflared-sites.service)` | `(see lychee-ops' cloudflared-sites.service)` |
| 90 | `via deploy/lyly-admin-create-site-dir.sh` | `via lychee-ops' lyly-admin-create-site-dir.sh` |
| 101 | `into deploy/lyly-admin-write-config.sh` | `into lychee-ops' lyly-admin-write-config.sh` |
| 131 | `via deploy/lyly-admin-docker-status.sh` | `via lychee-ops' lyly-admin-docker-status.sh` |

- [ ] **Step 5: Run the suite**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move deploy/ to lychee-ops"
```

---

### Task 9: `lyly-admin` — rewrite the Deployment section of CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — the `## Deployment` section

**Interfaces:**
- Consumes: nothing
- Produces: nothing. Documentation only.

- [ ] **Step 1: Replace the Deployment section**

The current section describes `deploy.yml`'s two jobs, the path-gating
predicate, the one-time host setup list, and the branch-protection situation.
Replace it with prose covering:

1. `.github/workflows/ci.yml` runs `test` only, on `ubuntu-latest`, on PRs and
   pushes to `main`. **The job name `test` is load-bearing** — `lychee-ops`
   gates on a check run of exactly that name.
2. Deployment is pull-based: `lychee` runs `ansible-pull` against the private
   `LycheeHome/lychee-ops` every 5 minutes, refuses to install unless the
   target commit's `test` check is green, builds as `lyly-admin`, installs to
   `/opt/lyly-admin`, and health-checks for a `401`.
3. Why: a public repo plus a self-hosted runner is an RCE path, because a fork
   PR supplies its own workflow file and therefore its own `runs-on:`.
4. Host setup now lives in `lychee-ops`, not in this file's prose. The
   previous "One-time host setup this assumes" list is **deleted** — those
   files are declared and reconciled now. Keep only what is genuinely still
   manual: `.env` placement, and the read-only deploy key at
   `/root/.ssh/id_lychee_ops`.
5. Observability: `journalctl -u lyly-reconcile.service`,
   `systemctl list-timers lyly-reconcile.timer`,
   `/var/lib/lyly-admin/deploy-status.json`, plus the Discord failure
   notification. State plainly that there is no run-history UI.
6. Branch protection: once the repo is public it becomes available and should
   be configured. Update the existing paragraph, which currently says it is
   impossible.

- [ ] **Step 2: Check for stale references elsewhere in CLAUDE.md**

Run: `grep -n 'deploy/\|deploy-needed\|github-runner\|deploy\.yml' CLAUDE.md`
Expected after the rewrite: no references to `deploy/`, `deploy-needed`, or
`deploy.yml` remain. `github-runner` may still appear in the `webdeploy` group
membership list, which is correct — the user still exists and is still a group
member; it just no longer deploys.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite Deployment for the pull-based model"
```

---

## Operator Cutover

**These are not agent tasks.** They run on `lychee`, need a root shell, and one
of them can lock the app out of its own sudo commands. Do them in order.

- [ ] **Step 0: Create the ops repo.** `gh repo create LycheeHome/lychee-ops --private`,
  push Tasks 1–6. Generate a read-only deploy key, add it to the repo's deploy
  keys, install it at `/root/.ssh/id_lychee_ops` with a matching `Host` entry
  in `/root/.ssh/config`.

- [ ] **Step 1: Dry run.** `sudo bash bootstrap.sh` — installs ansible, then runs
  `--check --diff`. Iterate until it is a clean no-op. **Every diff is a real
  finding**: it means the host drifted from what `deploy/` claimed, which is
  the drift this project exists to catch. Read them all.

- [ ] **Step 2: First real run.** Keep a **second root shell open** throughout.
  `/etc/sudoers.d/lyly-admin` is the step that can break sudo for the app —
  `validate: visudo -cf %s` refuses a malformed file, but not a valid file with
  wrong content. Verify after: `sudo -u lyly-admin sudo -ln` lists the expected
  eight commands.

- [ ] **Step 3: Verify a real deploy.** Push a trivial commit to `main`. Confirm
  within one tick: the timer fired (`systemctl list-timers`), the status file
  shows `"result": "deployed"` with the new SHA, and the app answers `401`.
  Then confirm idempotency — the next tick must show `"result": "skipped"`.

- [ ] **Step 4: Merge Tasks 7–9.** Only now. The Actions deploy job stops
  existing at this point.

- [ ] **Step 5: Migrate `swee`.** Its own slice. Until it lands, the runner group
  must still permit public repositories, so the exposure persists.

- [ ] **Step 6: Lock down.** Once both apps are off the runner: deny public
  repositories on the `default` runner group, remove
  `/etc/sudoers.d/lyly-admin-deploy` from the host, and unregister the runner
  if nothing else needs it.

**Do immediately, independent of all the above:** set the org's fork-PR approval
policy to "require approval for all outside collaborators". The `swee` exposure
is live now; this narrows it today and breaks nothing.

**Rollback** at any point before Step 4: `sudo systemctl disable --now
lyly-reconcile.timer`. The Actions deploy job is still present and still works.
