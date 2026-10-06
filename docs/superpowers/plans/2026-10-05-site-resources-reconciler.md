# Site Resources in the Reconciler — Implementation Plan (1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach `lychee-ops` to reconcile a scaffolded site as a container resource: accept a tagless `*-lyly-dev` declaration, create its account, wait for its first image, and render it with a site profile.

**Architecture:** All changes are in `LycheeHome/lychee-ops` (plus a README fix in `lychee-resources`). The validator learns one name family and one tagless form; `main.yml` creates site accounts before `getent`; `reconcile.yml` derives site identities from `passwd` and diverts tagless declarations to an `awaiting-image` status before any render; the compose template gains a site profile; the inventory publishes site entries found on disk. `lyly-admin` changes are plan 2 (`2026-10-05-site-resources-lyly-admin.md`), which must not merge before this one is live.

**Tech Stack:** Ansible (core 2.20.1, pinned — do not bump), Python 3 + PyYAML (`unittest`), Docker Compose. Tests: `./tests/run.sh` in `lychee-ops`.

**Spec:** `lyly-admin/docs/superpowers/specs/2026-10-05-scaffold-emits-declarations-design.md`

## Global Constraints

- Site name: `[a-z0-9]([a-z0-9-]*[a-z0-9])?-lyly-dev`, within the existing 63-character bound. No other name may end `-lyly-dev`.
- A tagless `image` is accepted **only** for a site name, and its repository part must still match `ghcr.io/lycheehome/<component>(/<component>)*`.
- Unchanged: unknown fields rejected; `env_keys`/`env_from` rejected; `bind` allowlist `127.0.0.1`; reserved ports `8787`, `2019`; port uniqueness across declarations; `:latest` refused.
- Site profile: `ports: ["127.0.0.1:<port>:3000"]`, environment exactly `PORT: "3000"` and `HOSTNAME: "0.0.0.0"`, `tmpfs` at `/tmp` and `/app/.next/cache`, no volumes, no `group_add`, no `working_dir`. `user`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, `restart: unless-stopped` as for every resource.
- `palsave-api`'s rendered compose file must be **byte-identical** before and after this plan.
- Site accounts: `nologin` (`/usr/sbin/nologin`), system, no home, no supplementary groups. Never deleted by the reconciler, including for `absent`.
- A tagless declaration takes no render, no pull, no compose action. Status `result: awaiting-image`, `target_tag: none`, `failed_attempts: 0`.
- `down` never carries `-v` (existing assert stays).

**Spec amendment (record it in the spec in Task 2's commit):** the spec says site uids come "from a reserved range declared in `group_vars`". This plan lets `useradd --system` allocate from the system range instead, because `ansible.builtin.user` cannot pass `-K SYS_UID_MIN` and hand-rolled allocation in Jinja is new surface for no stated benefit; the account *name* is what marks a site account, and identity is read back from `getent`. If the reviewer disagrees, this is the one decision to revisit.

## Review Focus

1. **A tagless image on a non-site name.** Must be rejected with a message that says tags are optional only for `-lyly-dev` sites, not the generic image message. *(Task 1)*
2. **A tagless declaration flowing into code that splits on `:`.** `write_status.yml` computes `target_tag` with `rsplit(':', 1)[-1]`, which on `ghcr.io/lycheehome/test-site` returns the whole image string. It must record `none`. *(Task 3)*
3. **`awaiting-image` counted as a failure.** `failed_attempts` increments on any result that is not `deployed`; a site waiting for its first image for a week must not reach the alerting threshold. *(Task 3)*
4. **A site declaration whose account does not exist yet** (first tick, or account creation failed). Must block that one site at render time with the `service_identities` message, never fall back to another uid, never fail the tick for other resources. *(Task 2)*
5. **A blocked or fetch-failed tick dropping sites from the board.** Inventory site entries come from status files on disk, so a tick that applies nothing must still publish them. *(Task 5)*

---

### Task 0: Spike — does the scaffold's image serve under the site profile? (throwaway)

**Files:** none kept. Work in the session scratchpad.

**Interfaces:**
- Produces: a verdict recorded in Task 4's commit message and, if the tmpfs list changes, in this plan's Global Constraints: either "serves with `/tmp` + `/app/.next/cache`" or the exact extra path(s) needed.

- [ ] **Step 1:** In the scratchpad, `npx create-next-app@latest spike-app --ts --no-eslint --no-tailwind --app --use-npm --yes`, then copy in the `Dockerfile` and `.dockerignore` produced by `getFrameworkScaffold("nextjs", "3000", "/")` from `lyly-admin/src/lib/frameworkScaffold.ts` (print them with a one-line `tsx -e`).
- [ ] **Step 2:** `docker build -t spike-site .`
- [ ] **Step 3:** Run it under the profile:

```bash
docker run -d --name spike-site -p 127.0.0.1:3999:3000 \
  -e PORT=3000 -e HOSTNAME=0.0.0.0 \
  --user 61000:61000 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:mode=1777 --tmpfs /app/.next/cache:mode=1777 \
  spike-site
```

- [ ] **Step 4:** Verify. Expected: `curl -fsS http://127.0.0.1:3999/` returns the page; after 45s `docker inspect -f '{{.State.Health.Status}}' spike-site` is `healthy`; `docker logs spike-site` has no `EROFS`/`EACCES`. If any fails, add the path named in the error as a further `--tmpfs` and repeat until clean; record each added path.
- [ ] **Step 5:** `docker rm -f spike-site && docker rmi spike-site`. Nothing is committed.

---

### Task 1: Validator accepts site names and tagless site images

**Files:**
- Modify: `roles/resources_host/files/validate_declarations.py`
- Test: `tests/test_validate_declarations.py`

**Interfaces:**
- Produces: `SITE_SUFFIX = "-lyly-dev"`, `SITE_NAME_RE` (fullmatch pattern `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-lyly-dev`), `TAGLESS_IMAGE_RE` (the repository half of `IMAGE_RE`, no tag), and `is_site(name: str) -> bool`. A valid tagless declaration's resolved dict carries `awaiting_image: True`; every other valid declaration carries `awaiting_image: False`. Task 3 dispatches on that key.

- [ ] **Step 1: Write the failing tests** in `tests/test_validate_declarations.py`, following the file's existing helper style:

```python
def test_accepts_a_tagless_site_declaration(self):
    valid, errors = validate({"test-lyly-dev": {
        "name": "test-lyly-dev", "image": "ghcr.io/lycheehome/test-site", "port": 3000}}, VOCAB)
    self.assertEqual(errors, [])
    self.assertTrue(valid[0]["awaiting_image"])

def test_tagged_site_is_not_awaiting(self):
    valid, _ = validate({"test-lyly-dev": {
        "name": "test-lyly-dev", "image": "ghcr.io/lycheehome/test-site:0.1.0", "port": 3000}}, VOCAB)
    self.assertFalse(valid[0]["awaiting_image"])

def test_rejects_a_tagless_image_on_a_non_site(self):
    _, errors = validate({"palsave-api": {
        "name": "palsave-api", "image": "ghcr.io/lycheehome/palsave-api", "port": 8788}}, VOCAB)
    self.assertIn("only -lyly-dev sites", errors[0]["message"])

def test_rejects_a_tagless_image_outside_the_namespace(self):
    _, errors = validate({"x-lyly-dev": {
        "name": "x-lyly-dev", "image": "ghcr.io/someoneelse/x", "port": 3000}}, VOCAB)
    self.assertEqual(errors[0]["field"], "image")

def test_a_name_ending_in_the_site_suffix_must_be_a_site_name(self):
    # NAME_RE accepts it; SITE_NAME_RE does not (the label "a-" ends in a dash,
    # which no hostname label can). The error must be on `name`.
    _, errors = validate({"a--lyly-dev": {
        "name": "a--lyly-dev", "image": "ghcr.io/lycheehome/x:1.0.0", "port": 3000}}, VOCAB)
    self.assertEqual([e["field"] for e in errors], ["name"])

def test_a_multi_dash_label_is_a_site(self):
    valid, errors = validate({"a-b-lyly-dev": {
        "name": "a-b-lyly-dev", "image": "ghcr.io/lycheehome/x", "port": 3000}}, VOCAB)
    self.assertEqual(errors, [])

def test_existing_palsave_declaration_still_valid(self):
    # palsave-api.yml's seven fields, copied verbatim from lychee-resources
    # (mounts: [palworld_saves], state_volume: true, port 8788).
    # assert errors == [] and valid[0]["awaiting_image"] is False
```

- [ ] **Step 2: Run** `tests/.venv/bin/python -m unittest tests.test_validate_declarations -v` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `_check_one`: a name that ends `lyly-dev` must fullmatch `SITE_NAME_RE` (error field `name`, message naming the site pattern). For `image`: if `IMAGE_RE` fails and `TAGLESS_IMAGE_RE` fullmatches, accept only when `is_site(name)`, else error `"image has no tag; a tag may be omitted only by -lyly-dev sites, before their first deploy"`. Set `awaiting_image` in the resolved dict. Update the module docstring's field paragraph in one sentence each for the suffix and the tagless form.
- [ ] **Step 4: Run** `./tests/run.sh` — Expected: PASS, including the existing `test_rejects_reserved_env_fields`.
- [ ] **Step 5: Commit** `feat: accept tagless site declarations in the validator`

---

### Task 2: Site accounts, created by the reconciler and read back as identities

**Files:**
- Modify: `roles/resources_reconcile/tasks/main.yml` (host-only; not reachable by the suite)
- Modify: `roles/resources_reconcile/tasks/reconcile.yml`
- Modify: `roles/resources_host/templates/docker-compose.yml.j2` (identity lookup only)
- Test: `tests/test_resources_render.yml`
- Modify: `lyly-admin/docs/superpowers/specs/2026-10-05-scaffold-emits-declarations-design.md` (the amendment above)

**Interfaces:**
- Consumes: `is_site` semantics from Task 1 (Jinja side: `select('regex', '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-lyly-dev', match_type='fullmatch')`).
- Produces: fact `resources_reconcile_identities` — `service_identities` combined with `{name: {uid, gid}}` for every site name in `resources_reconcile_valid` that exists in `resources_reconcile_passwd`. The template reads this fact instead of `service_identities`.

- [ ] **Step 1: Write the failing tests** in `tests/test_resources_render.yml`, as new plays in the file's existing style:
  - a valid `test-lyly-dev` declaration (tagged) with `resources_reconcile_passwd` containing `test-lyly-dev: ['x', '998', '998', '', '/', '/usr/sbin/nologin']` renders `user: "998:998"`;
  - the same declaration with no `passwd` entry is recorded in `resources_reconcile_blocked` with a message containing `service_identities has no entry for test-lyly-dev`, and `palsave-api` in the same tick still renders;
  - `assert_identities.yml` does **not** complain about site accounts (it iterates only the hand map).
- [ ] **Step 2: Run** `./tests/run.sh` — Expected: the new plays FAIL.
- [ ] **Step 3: Implement.**
  - `reconcile.yml`: after the verdict is read and before `resolve_mounts.yml`, set `resources_reconcile_identities` as above.
  - Template: `{% set ident = resources_reconcile_identities[service.name] | mandatory(...) %}`, same message.
  - `main.yml`: between the fetch and `getent passwd`, when the fetch succeeded, run the validator (same argv as `reconcile.yml`), and for each valid name matching the site pattern, `ansible.builtin.user: name=<n> system=true shell=/usr/sbin/nologin create_home=false groups=[] append=false`. Wrap in `block`/`rescue` that records nothing and continues: a failure surfaces next as that site's render block (Review Focus 4). Comment why accounts are never removed (the `github-runner` uid-reuse lesson, CLAUDE.md).
- [ ] **Step 4: Run** `./tests/run.sh` and `tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: create site accounts and derive their identities` (include the spec amendment).

---

### Task 3: Awaiting first image

**Files:**
- Modify: `roles/resources_reconcile/tasks/reconcile.yml`
- Modify: `roles/resources_reconcile/tasks/write_status.yml`
- Test: `tests/test_resources_render.yml`

**Interfaces:**
- Consumes: `awaiting_image` from Task 1.
- Produces: status file for a tagless site: `result: awaiting-image`, `target_tag: none`, `installed_tag: none` (or carried forward), `available_tag` as discovered, `failed_attempts: 0`. Plan 2 reads `result == "awaiting-image"` from the inventory.

- [ ] **Step 1: Write the failing tests:** with a tagless `test-lyly-dev` and the existing docker stand-in,
  - no compose argv is recorded for `test-lyly-dev` and no `docker-compose.yml` is written under its project dir;
  - its status file has `result == 'awaiting-image'`, `target_tag == 'none'`, `failed_attempts == 0`, and `available_tag == '0.1.0'` when the registry stand-in (`tests/fixtures/registry_standin.yml`) offers `0.1.0`;
  - with a previous status of `failed_attempts: 3`, an awaiting tick records `0`;
  - `test-lyly-dev` is not in `resources_reconcile_failed_services`.
- [ ] **Step 2: Run** `./tests/run.sh` — Expected: FAIL.
- [ ] **Step 3: Implement.** In the apply block, exclude `awaiting_image` services from the mount-check, render and apply loops (same `rejectattr` placement as the blocked filter); keep them in `resolve_available.yml`'s loop; after it, write their status via `write_status.yml` with `result: awaiting-image`. In `write_status.yml`: `target_tag` is `none` when the image has no `:` after its last `/`; `failed_count` is `0` for `deployed` **and** `awaiting-image`.
- [ ] **Step 4: Run** `./tests/run.sh` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: hold a tagless site at awaiting-image`

---

### Task 4: Compose template site profile

**Files:**
- Modify: `roles/resources_host/templates/docker-compose.yml.j2`
- Test: `tests/test_resources_render.yml` (incl. fixing the `blog.lyly.dev` fixtures at `:111`, `:836` and their assertions at `:137`, `:851`)

**Interfaces:**
- Consumes: Task 0's verdict (the tmpfs list); `resources_reconcile_identities` from Task 2.

- [ ] **Step 1: Write the failing tests:** a tagged `test-lyly-dev` renders, parsed with `from_yaml`:
  - `ports == ['127.0.0.1:3000:3000']` for `port: 3000`, and `['127.0.0.1:3100:3000']` for `port: 3100`;
  - `environment == {'PORT': '3000', 'HOSTNAME': '0.0.0.0'}` (no `PALSAVE_API_*` key);
  - `tmpfs` contains exactly the Task 0 list; no `volumes`, `group_add`, `working_dir`;
  - `read_only`, `cap_drop`, `security_opt`, `restart` as for palsave;
  - and no `command`, `entrypoint`, `privileged`, `cap_add` (extend the existing absence assertion to this render).
  - **Byte-identity:** render `palsave-api` from the existing fixture and compare against a golden copy captured from `main` before this task (`tests/fixtures/palsave-api.compose.golden.yml`, created in this step from the pre-change template).
  - Replace the `blog.lyly.dev` fixture name with `blog-lyly-dev` and its asserted path accordingly.
- [ ] **Step 2: Run** `./tests/run.sh` — Expected: FAIL.
- [ ] **Step 3: Implement** `{% set site = service.name is match('...-lyly-dev') %}` (fullmatch semantics as elsewhere) and branch `ports`/`environment`/`tmpfs`/`volumes`/`working_dir` on it. Keep palsave's comment block attached to its branch; replace "this template has one consumer until the slice that adds a second" with one sentence saying the profile is selected by the site suffix. tmpfs entries use `mode=1777`.
- [ ] **Step 4: Run** `./tests/run.sh` — Expected: PASS, golden byte-identical.
- [ ] **Step 5: Commit** `feat: render sites with their own compose profile` — body states Task 0's verdict.

---

### Task 5: Inventory publishes site entries from disk

**Files:**
- Modify: `roles/inventory/tasks/main.yml`
- Modify: `roles/inventory/defaults/main.yml` (comment only: sites need no hand entry)
- Test: `tests/test_resources_render.yml` (new play rendering `services.json.j2`) — or a new `tests/test_inventory.yml` added to `run.sh`'s final `exec` line

**Interfaces:**
- Produces: for every directory `<status_dir>/<n>/status.json` with `<n>` matching the site pattern and not already in `inventory_services`, an entry `{name: n, container: n, group: service, status_file: <path>}` appended before rendering. Rendered exactly as any container entry (so plan 2 sees `kind: container`, `result`, `available`, `target`).

- [ ] **Step 1: Write the failing test:** a temp status dir with `test-lyly-dev/status.json` (`result: awaiting-image`, `available_tag: 0.1.0`) and `palsave-api/status.json`; render; assert one entry named `test-lyly-dev` with `kind == 'container'`, `result == 'awaiting-image'`, `available == '0.1.0'`, `target == ''`; `palsave-api` appears once (no duplicate); a directory named `evil.name` is ignored.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with `ansible.builtin.find` (`paths: /var/lib/lychee-resources`, `file_type: directory`, `depth: 1`), filter names by the site pattern, build `inventory_all_services`, and loop/render over that instead of `inventory_services`. The status dir path comes from the same variable `resources_reconcile_status_dir` resolves to; if that is a role default not visible here, add `inventory_resources_status_dir` to `group_vars/all.yml` and point both at it.
- [ ] **Step 4: Run** `./tests/run.sh` + syntax check — Expected: PASS.
- [ ] **Step 5: Commit** `feat: publish site resources in the inventory`

---

### Task 6: lychee-resources README

**Repo:** `LycheeHome/lychee-resources`

- [ ] **Step 1:** Replace `lychee-services` → `lychee-resources` and `services_reconcile` → `resources_reconcile` (`README.md:1-4`); add the site row to the field table: `image` may be tagless for `*-lyly-dev` until the first Deploy; site declarations are written by `lyly-admin`, not by hand.
- [ ] **Step 2: Commit** `docs: name the repo and role correctly; document site declarations`

---

## After merge (operator, on `lychee`)

- Watch one tick: `journalctl -u lyly-reconcile.service -n 100`; `/var/lib/lychee-resources/palsave-api/status.json` still `deployed`, `0.3.0`; `docker ps` unchanged.
- Only then may plan 2 merge. A tagless declaration written before this is live freezes every resource.
