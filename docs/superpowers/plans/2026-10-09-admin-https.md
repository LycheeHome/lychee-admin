# Admin over HTTPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lychee-ops issues, installs and keeps renewed a Let's Encrypt certificate for `admin.lychee.land`, and serves lyly-admin there over HTTPS through Caddy, reachable only over the tailnet.

**Architecture:** A new `admin_https` role in `LycheeHome/lychee-ops`, last in `playbook.yml`, does the following:
- **Certificate:** issues it once with certbot's Cloudflare DNS plugin, and copies it every tick to where Caddy can read it.
- **Caddy config:** owns `/etc/caddy/conf.d/admin.caddy` and the one Caddyfile `import` line.
- **Reload:** validates before every reload.
- **Checks:** fails on a near-expiry certificate, and warns on a missing DNS record.

Two pieces are their own task files so the off-host suite can import them: the `import`-line edit and the expiry check. lychee-admin gets one CLAUDE.md paragraph.

**Tech Stack:** Ansible (ansible-core 2.20.1, pinned — do not bump), certbot + `python3-certbot-dns-cloudflare` (Ubuntu apt), Caddy (distro package), openssl. Tests: `./tests/run.sh </dev/null` in lychee-ops (6–40 minutes; slow, not hung).

**Spec:** `docs/superpowers/specs/2026-10-09-admin-https-design.md` (in lychee-admin)

## Global Constraints

- **Repos:** all code lives in `lychee-ops`, on branch `feat/admin-https`. The only lychee-admin change is CLAUDE.md, on branch `docs/admin-https-spec`, which already carries the spec and this plan.
- **New `group_vars/all.yml` values:**
  - `admin_hostname: admin.lychee.land`
  - `tailnet_address: <the tailnet address, from HOST.md>`
  - `admin_upstream: 192.168.1.10:8787`
  - `cloudflare_dns_token: ""`, the empty default, overridden from `/etc/lychee-ops/secrets.yml` like `github_api_token`.
- **Paths:**
  - certbot credentials: `/etc/letsencrypt/cloudflare-lychee-land.ini` (root:root `0600`, `no_log: true`)
  - copied certificate: `/etc/caddy/certs/admin.lychee.land/{fullchain,privkey}.pem` (directory root:caddy `0750`, files root:caddy `0640`)
  - Caddy file: `/etc/caddy/conf.d/admin.caddy` (root:root `0644`, directory `0755`)
- **Import line (exact):** `import /etc/caddy/conf.d/*.caddy`
- **Expiry:** `openssl x509 -checkend 1209600 -noout -in <copied fullchain>`. A non-zero exit fails the tick.
- **Reload:** never reload Caddy without a successful `caddy validate --config /etc/caddy/Caddyfile` immediately before it, in the same role run, inline (not a handler).
- **No certificate yet:** a missing `cloudflare_dns_token` gates only the credential write and issuing. With no token and no certificate the role ends with `meta: end_role` without failing; with no token and a certificate, everything from the certificate stat on still runs. A missing or wrong DNS record warns and never fails.
- **Never:** `bind` in the Caddy block, `tailscale funnel`, DNS writes, or touching any Caddyfile line other than the import line.
- **Check mode:** every task must be safe under `--check`. The role is untagged, so bootstrap's dry run executes it.

## Review Focus

1. **A Caddyfile with no global options block, or with the import line already present.** The line must land at the top level, and a second run must report no change. *(Task 2 test.)*
2. **A Caddyfile whose site blocks also end in a bare `}`.** The import must go after the FIRST `}` (the global block), never after a site block's. *(Task 2 test.)*
3. **A certificate that expires in under 14 days fails; one with 30 days passes.** *(Task 2 test.)*
4. **A fresh host where no certificate exists yet, or a `--check` run.** The copy, config and reload steps must be skipped, not errored, when `live/` has no certificate. *(Task 3; checked with `--syntax-check` plus the conditions as written. Verified on the host, not off-host.)*
5. **`caddy validate` fails.** The reload must not run. *(Task 3: ordering plus `failed_when`. Verified on the host.)*

---

### Task 1: Role skeleton, values and the Caddy template

**Files:**
- Modify: `group_vars/all.yml` (add the four values from Global Constraints, each with a comment in the file's style. The token's comment says: Zone → DNS → Edit on `lychee.land` only, value in `secrets.yml`.)
- Create: `roles/admin_https/defaults/main.yml` (`admin_https_min_validity_seconds: 1209600`, `admin_https_caddyfile: /etc/caddy/Caddyfile`, `admin_https_cert_dir: "/etc/caddy/certs/{{ admin_hostname }}"`)
- Create: `roles/admin_https/templates/admin.caddy.j2`
- Create: `tests/test_admin_https.yml`
- Modify: `tests/run.sh` (append `tests/test_admin_https.yml` to the final `exec` line)

**Interfaces:**
- Produces: the variables above, plus the template the role's Task 3 renders to `/etc/caddy/conf.d/admin.caddy`.

- [ ] **Step 1: Write the failing play** in `tests/test_admin_https.yml`. It uses `hosts: localhost`, `gather_facts: false`, and `vars_files: [../group_vars/all.yml, ../roles/admin_https/defaults/main.yml]`. It renders `lookup('template', playbook_dir ~ '/../roles/admin_https/templates/admin.caddy.j2')` and asserts exact equality with:
  ```
  https://admin.lychee.land {
  	tls /etc/caddy/certs/admin.lychee.land/fullchain.pem /etc/caddy/certs/admin.lychee.land/privkey.pem
  	reverse_proxy 192.168.1.10:8787
  }
  ```
  (tab-indented, matching the live Caddyfile, with one trailing newline).
- [ ] **Step 2: Run** `./tests/run.sh </dev/null`. Expected: FAIL (template missing).
- [ ] **Step 3: Create** the template, defaults and `group_vars` values. Header comment in the template: the file is owned by lychee-ops; lyly-admin never parses it (it reads only `http://` blocks in the main Caddyfile); no `bind`, and why.
- [ ] **Step 4: Run** `./tests/run.sh </dev/null`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin_https): values and the admin.caddy template`

---

### Task 2: The two importable task files: import line and expiry check

**Files:**
- Create: `roles/admin_https/tasks/ensure_import.yml`
- Create: `roles/admin_https/tasks/check_expiry.yml`
- Test: `tests/test_admin_https.yml` (new plays), `tests/fixtures/caddyfile_with_global.txt`, `tests/fixtures/caddyfile_without_global.txt`

**Interfaces:**
- `ensure_import.yml`
  - **Consumes:** `admin_https_caddyfile` (path).
  - **Produces:** registered `admin_https_import` (the `lineinfile` result; `.changed` feeds Task 3's reload decision).
- `check_expiry.yml`
  - **Consumes:** `admin_https_cert_path` (path), `admin_https_min_validity_seconds`.
  - **Produces:** fails the host with a message naming the path and the threshold in days (computed once from `admin_https_min_validity_seconds`) when the certificate is within the threshold or unreadable.

- [ ] **Step 1: Write failing plays.** Each copies a fixture into a `tempfile` directory and points `admin_https_caddyfile` at it:
  - **With a global options block.** Fixture: `{\n\tauto_https off\n}\n\nhttp://lychee.local {\n\treverse_proxy 192.168.1.10:8787\n}\n\nhttp://blog.lyly.dev {\n\troot * /var/www/blog.lyly.dev\n\tfile_server\n}\n`.
    - **First import:** the file's line immediately after the first `}` is `import /etc/caddy/conf.d/*.caddy`; both site blocks are byte-identical to before; `admin_https_import.changed` is true.
    - **Second import:** `admin_https_import.changed` is false, and the import line appears exactly once.
  - **Without a global options block.** Fixture: the same two site blocks only. After import, the line is present exactly once at column 0 (not inside a block). The assertion: every line before it has balanced `{`/`}` counts.
  - **Expiry.** `openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=t -days N` into a tempdir, for N=30 and N=5.
    - **30 days:** importing `check_expiry.yml` succeeds.
    - **5 days:** the import inside a `block` fails; `rescue` records it; then assert it was rescued.
    - **Missing file:** a nonexistent path is also rescued (failure, not a pass).
- [ ] **Step 2: Run** the suite. Expected: FAIL (task files missing).
- [ ] **Step 3: Implement.**
  - **`ensure_import.yml`:** one `ansible.builtin.lineinfile` with `path: "{{ admin_https_caddyfile }}"`, `line: "import /etc/caddy/conf.d/*.caddy"`, `insertafter: '^\}\s*$'`, `firstmatch: true`, registered as `admin_https_import`.
    - **Comment the race:** an app write between read and write can drop the line, and the next tick restores it.
    - **Comment `firstmatch`:** lineinfile otherwise uses the LAST match, which is a site block's closing brace.
    - **No global block:** if there's no global block, the first `}` closes a site block, which is still top level, so the import is valid there.
  - **`check_expiry.yml`:** an `ansible.builtin.command` with `argv: [openssl, x509, -checkend, "{{ admin_https_min_validity_seconds }}", -noout, -in, "{{ admin_https_cert_path }}"]`, `changed_when: false`, `failed_when: false`, registered. Then an `ansible.builtin.fail` when `rc != 0`, with a message saying renewal has stopped working, the path, and where to look (`systemctl status certbot.timer`, `journalctl -u certbot`).
- [ ] **Step 4: Run** the suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin_https): import-line and expiry-check task files, tested off-host`

---

### Task 3: The role's main flow, playbook placement and the host-role comment

**Files:**
- Create: `roles/admin_https/tasks/main.yml`
- Modify: `playbook.yml` (append `- admin_https` as the LAST entry under `roles:`, after `inventory`, with a comment explaining why last: a failure here must not skip any app or resource role, and still trips `OnFailure=`; it is untagged so bootstrap's dry run includes it, which every task here supports)
- Modify: `roles/lyly_admin_host/tasks/main.yml` (the header comment's "Deliberately absent: /etc/caddy/Caddyfile …": add that `admin_https` asserts exactly one line in it, the `import`, and nothing else)

**Interfaces:**
- Consumes: Task 1's variables and template; Task 2's `ensure_import.yml` (→ `admin_https_import`) and `check_expiry.yml`.

`main.yml`, in this exact order:

1. **Packages:** a read-only `dpkg-query` (`check_mode: false`) sees whether both are installed; `ansible.builtin.apt` installs `certbot` and `python3-certbot-dns-cloudflare`, with `update_cache` true only when one is missing. No `cache_valid_time`: it would run `apt-get update` as root every hour for packages already there.
2. **No token:** set `admin_https_has_token` from `cloudflare_dns_token | default('') | length > 0` and stat `live/{{ admin_hostname }}/fullchain.pem`. Without a token, print a debug line ("cloudflare_dns_token not set in /etc/lychee-ops/secrets.yml; admin.lychee.land certificate not managed", or "still served and checked, but not re-issued" when the certificate exists). `meta: end_role` only when there is no token and no certificate.
3. **Credential** (only with a token): `ansible.builtin.copy` writes `/etc/letsencrypt/cloudflare-lychee-land.ini` with `content: "dns_cloudflare_api_token = {{ cloudflare_dns_token }}\n"`, root:root `0600`, `no_log: true`.
4. **Issue** (only with a token): `ansible.builtin.command` with argv `[certbot, certonly, --non-interactive, --agree-tos, --register-unsafely-without-email, --dns-cloudflare, --dns-cloudflare-credentials, /etc/letsencrypt/cloudflare-lychee-land.ini, --cert-name, "{{ admin_hostname }}", -d, "{{ admin_hostname }}"]`.
   - Set `creates: /etc/letsencrypt/live/{{ admin_hostname }}/fullchain.pem`.
   - Comment that renewal is certbot's packaged timer and the role never runs `renew`.
5. **Look for a certificate:** `ansible.builtin.stat` on `live/{{ admin_hostname }}/fullchain.pem` (follow: false), registered.
   - **No certificate yet** (a fresh host under `--check`, or before the first issue): steps 6–10 all carry `when: <that stat>.stat.exists`.
6. **Copy for Caddy:**
   - **Directory:** `ansible.builtin.file` creates `{{ admin_https_cert_dir }}`, root:caddy `0750`.
   - **Files:** for `fullchain.pem` and `privkey.pem`, `stat` the `live/` path (`follow: false`) and `ansible.builtin.copy` from `.stat.lnk_source`, with `remote_src: true`, root:caddy `0640`.
   - **Why `lnk_source`:** `live/` holds symlinks into `archive/`, and copying from the resolved target is unambiguous.
   - **Register** the copy results.
7. **Caddy config:**
   - **Directory:** `ansible.builtin.file` creates `/etc/caddy/conf.d`, `0755`.
   - **File:** `ansible.builtin.template` renders `admin.caddy.j2` → `/etc/caddy/conf.d/admin.caddy`, root:root `0644`, with `validate: caddy validate --adapter caddyfile --config %s` (not run under `--check`). Register it.
   - **Import line:** `import_tasks: ensure_import.yml`.
8. **Validate, then reload,** on every tick where the step 5 certificate exists and `not ansible_check_mode` (amended during review; the plan first had validate-on-change, see the spec's step 6):
   - **Marker:** when any of step 6's copies, step 7's template or `admin_https_import` changed, touch `{{ ops_root }}/admin_https.reload-pending` (root:root `0600`).
   - **Validate:** `ansible.builtin.command` with argv `[caddy, validate, --config, "{{ admin_https_caddyfile }}"]` and `changed_when: false`. If it fails the task fails, so the next task never runs.
   - **Reload:** if the marker exists, `ansible.builtin.systemd` with `name: caddy`, `state: reloaded`, then remove the marker.
9. **Expiry:** `import_tasks: check_expiry.yml` with `admin_https_cert_path: "{{ admin_https_cert_dir }}/fullchain.pem"`. Skip it under `--check` when the copy has not happened yet; the condition is the step 5 stat.
10. **DNS:**
    - **Look up:** `ansible.builtin.command` with argv `[getent, ahosts, "{{ admin_hostname }}"]`, `changed_when: false`, `failed_when: false`, registered.
    - **Warn:** `ansible.builtin.debug` warns (msg names the hostname, the expected `tailnet_address`, and "add an A record, DNS only, in the Cloudflare dashboard") when `tailnet_address` is not in its stdout.

- [ ] **Step 1: Write `main.yml`** as above, with one comment per step giving its reason, citing the spec's decisions (no `bind`, inline validate before reload, the copy instead of a certbot hook).
- [ ] **Step 2: Syntax check:** `ANSIBLE_COLLECTIONS_PATH=$PWD/tests/.collections tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml </dev/null`. Expected: `playbook: playbook.yml`, exit 0.
- [ ] **Step 3: Run** `./tests/run.sh </dev/null`. Expected: PASS. Its last play parses `playbook.yml` for real, so the new role must resolve.
- [ ] **Step 4: Commit** `feat(admin_https): issue, install and serve the admin.lychee.land certificate`

---

### Task 4: Docs

**Files:**
- Modify: `lychee-ops/HOST.md` (a short "admin.lychee.land" section:
  - the certificate's `live/` path and its copy under `/etc/caddy/certs/admin.lychee.land/` (root:caddy);
  - `/etc/caddy/conf.d/admin.caddy`;
  - the token's location (`secrets.yml`, key `cloudflare_dns_token`) and scope (Zone → DNS → Edit, `lychee.land` only);
  - the A record `admin` → `tailnet_address`, DNS only, created by hand.)
- Modify: `lychee-admin/CLAUDE.md`, in the Environment section beside the `lychee.local` facts. One paragraph covering:
  - `https://admin.lychee.land` is the tailnet-only HTTPS address for this app;
  - lychee-ops owns its block in `/etc/caddy/conf.d/admin.caddy`, outside anything the app parses (the app reads only `http://` blocks in the main Caddyfile), and asserts one `import` line in the Caddyfile;
  - it never touches the tunnel, so "never expose this app through the Cloudflare Tunnel" still holds;
  - `tailscale funnel` is never used for this app;
  - the add-site reservation of `admin.lychee.land` ships with the `lychee.land` domain move, which must not flip `DOMAIN` without it.

- [ ] **Step 1: Write both edits.**
- [ ] **Step 2: Verify:** `npm run lint` in lychee-admin passes; `git diff --stat` shows only those two files.
- [ ] **Step 3: Commit** in each repo: `docs: admin.lychee.land` (lychee-ops, on `feat/admin-https`) and `docs: admin.lychee.land, tailnet-only HTTPS for the app` (lychee-admin, on `docs/admin-https-spec`).

---

## After merge (operator and controller, on lychee)

Done by the controller and the operator after the PRs merge, not by implementer subagents. It's the spec's "Verification on lychee" list, 1–6, plus the two hand steps (the token in `secrets.yml`, and the DNS record) beforehand.
