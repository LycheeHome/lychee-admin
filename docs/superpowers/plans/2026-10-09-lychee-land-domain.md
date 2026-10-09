# lychee.land Domain Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lychee.land` the only managed domain in both repos. The domain is set in one place per repo and derived everywhere else. lychee-admin gets a hostname reservation, and the reconciler gets a check that blocks deploys when the app's `.env` disagrees with it.

**Architecture:**
- **lychee-admin:** reads a required `DOMAIN` and derives the resource suffix, the site-name pattern and the label limit from it. That replaces the `-lyly-dev` constants. It also adds `RESERVED_HOSTNAMES` to add-site validation.
- **lychee-ops:** one `site_domain` in `group_vars` derives `site_suffix`, `site_name_pattern` and `admin_hostname`. Every pasted regex, the validator, and the site-directory script consume those. A new pure decision file, `decide_env.yml`, compares the app's `.env` with them and joins the deploy gate.

**Tech Stack:** lychee-admin, Express 4 and TypeScript: `npm test` (tsx --test), `npm run typecheck`, `npm run lint`, `npm run build`. lychee-ops, Ansible with ansible-core 2.20.1 (pinned, don't bump) and Python 3: `./tests/run.sh </dev/null` (6–40 minutes, foreground) and `tests/.venv/bin/python -m unittest tests.test_validate_declarations`.

**Spec:** `docs/superpowers/specs/2026-10-09-lychee-land-domain-design.md` (lychee-admin)

## Global Constraints

- **Branches:** `feat/lychee-land` in each repo. In lychee-admin it is cut from `docs/lychee-land-spec`, so the spec and this plan travel with it. Never push from a task.
- **Domain values:** the value is `lychee.land`. Derived suffix `-lychee-land`; resource names `<label>-lychee-land`; site-name pattern `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?` + suffix, always matched in full; maximum resource name 63, so the maximum Next.js label is `63 − suffix length`, which is 51.
- **`DOMAIN` is required:** no default anywhere in app code.
- **`RESERVED_HOSTNAMES`:** optional, comma-separated. Entries are trimmed and lowercased, and empty ones are dropped. The error is `"<hostname>" is reserved`.
- **lychee-ops variables, all in `group_vars/all.yml`:**
  - `site_domain: lychee.land`
  - `site_suffix: "-{{ site_domain | replace('.', '-') }}"`
  - `site_name_pattern: "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?{{ site_suffix }}"`
  - `admin_hostname: "admin.{{ site_domain }}"`
- **Gate strings (exact):**
  - `could not read /opt/lyly-admin/.env`
  - `DOMAIN missing from .env, lychee-ops expects <site_domain>`
  - `DOMAIN in .env is <value>, lychee-ops expects <site_domain>`
  - `RESERVED_HOSTNAMES in .env does not include <admin_hostname>`
- **The `.env` file:** it is read and parsed, never sourced, and never written.
- **The public repo (lychee-admin)** carries no host coordinates: no tailnet address, uids, tunnel IDs or tokens.
- **Tests assert literal values** (`-lychee-land`, `x.lychee.land`), not re-derivations.
- **History stays:** `ssh.lyly.dev`, the 2026-08-08 apex removal and `.impeccable/critique/*` are left as written.

## Review Focus

1. **A quoted or padded `.env` value** (`DOMAIN="lychee.land"`, `DOMAIN= lychee.land `) must pass the ops check, as HOST/PORT parsing already allows. *(Task 8 test.)*
2. **`RESERVED_HOSTNAMES` with spaces and capitals** (`Admin.lychee.land, other.lychee.land`): the app reserves `admin.lychee.land` and the ops check counts it as present. *(Task 3 and Task 8 tests.)*
3. **A reserved hostname typed in capitals, or as a bare label** (`ADMIN.lychee.land`): rejected the same as lowercase, because `readSiteInput` lowercases first. *(Task 3 test.)*
4. **A multi-dot domain** (`example.co.uk`): suffix `-example-co-uk` in both repos. *(Task 1 and Task 5 domain-switch tests.)*
5. **An old `-lyly-dev` name after the move:** not a site name, so `isSiteName("blog-lyly-dev", "lychee.land")` is false and the ops pattern doesn't select it. *(Task 1 and Task 5 tests.)*

---

### Task 1: lychee-admin: derive suffix, pattern and label limit from the domain

**Files:**
- Modify: `src/lib/siteValidation.ts` (remove `SITE_SUFFIX` and `MAX_SITE_LABEL_LENGTH`, keep `MAX_RESOURCE_NAME_LENGTH`), `src/lib/siteResource.ts`, `src/lib/declarationWriter.ts` (`SITE_NAME_RE`, `isSiteName`, `WriterOptions`, and the `.lyly.dev` hostname rebuild at about line 292), `src/lib/systemCommands.ts` (pass `domain: config.domain` into the writer's options), `src/dev/fakes.ts`, `src/routes/services.ts`, `src/routes/sites.ts`, `src/views/html.ts` (callers of `isSiteName`; the views get the domain through the options they already receive, adding `domain` where a renderer lacks it)
- Test: `src/lib/siteValidation.test.ts`, `src/lib/siteResource.test.ts`, `src/lib/declarationWriter.test.ts`

**Interfaces (produced):**
- `siteSuffixFor(domain: string): string`: `"-" + domain.replace(/\./g, "-")`
- `siteNamePatternFor(domain: string): RegExp`: anchored `^…$`, the label regex plus the escaped suffix
- `maxSiteLabelLength(domain: string): number`: `MAX_RESOURCE_NAME_LENGTH - siteSuffixFor(domain).length`
- `resourceNameFor(hostname, domain)`: unchanged signature, derived suffix
- `isSiteName(name: string, domain: string): boolean`
- `WriterOptions.domain: string` (required)

- [ ] **Step 1: Write failing tests:**
  - `siteSuffixFor("lychee.land") === "-lychee-land"` and `siteSuffixFor("example.co.uk") === "-example-co-uk"`.
  - `maxSiteLabelLength("lychee.land") === 51`.
  - `resourceNameFor("blog.lychee.land", "lychee.land") === "blog-lychee-land"`.
  - Domain switch: `resourceNameFor("blog.example.test", "example.test") === "blog-example-test"`.
  - `isSiteName("blog-lychee-land", "lychee.land")` is true; `isSiteName("blog-lyly-dev", "lychee.land")` is false; `isSiteName("palsave-api", "lychee.land")` is false.
  - The Next.js label error names 51 for `lychee.land`.
  - `createSiteDeclaration("blog-lychee-land", …, { …, domain: "lychee.land" })` writes the comment `# Written by lyly-admin for blog.lychee.land.`
- [ ] **Step 2: Run** `npm test`. Expected: FAIL (the functions don't exist; the hostname is wrong).
- [ ] **Step 3: Implement** the interfaces. Every former use of `SITE_SUFFIX`, `MAX_SITE_LABEL_LENGTH` and `SITE_NAME_RE` goes through them. Existing tests that pass `"lyly.dev"` as the domain may stay as they are in this task (Task 2 moves them).
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: derive the site suffix and name pattern from DOMAIN`

---

### Task 2: lychee-admin: `DOMAIN` required; seed, fixtures and examples on `lychee.land`

**Files:**
- Modify: `src/config.ts` (`domain: required("DOMAIN")`), `src/dev/env.ts` (`process.env.DOMAIN ??= "lychee.land"`, with the comment explaining it beside the credentials), `src/dev/seed.ts`, `.env.example` (`DOMAIN=lychee.land`, commented as required), every `*.test.ts` and fixture that uses `lyly.dev` or `-lyly-dev` as the *current* domain, and the `lyly.dev` examples in code comments (`public/app.js` and others)
- Test: the existing suite

**Interfaces:** consumes Task 1. Produces none.

- [ ] **Step 1: Write the failing test:** run `npm run dev:mock` and request `http://127.0.0.1:8787/` with basic auth `dev:dev`. Expect the seed's sites as `*.lychee.land`, with `lychee.local` still absent from the list. Stop only the server you started, by its PID.
- [ ] **Step 2: Implement:**
  - **Values:** the config, dev env, seed, `.env.example`, test fixtures and comment examples move to `lychee.land`.
  - **Unmanaged block:** the seed keeps its deliberately unmanaged `lychee.local` block and every Caddyfile parser branch.
  - **History:** leave historical mentions (the retired `ssh.lyly.dev` tunnel, the 2026-08-08 apex) as they are.
- [ ] **Step 3: Verify:**
  - `npm test && npm run typecheck && npm run lint && npm run build`.
  - `git grep -nE "lyly[.-]dev" -- src public .env.example` lists only historical comments; name each remaining hit in the report.
  - Re-run Step 1. Expected: pass.
- [ ] **Step 4: Commit** `feat: DOMAIN is required; seed and tests move to lychee.land`

---

### Task 3: lychee-admin: `RESERVED_HOSTNAMES`

**Files:**
- Modify: `src/config.ts` (`reservedHostnames: string[]` parsed from `RESERVED_HOSTNAMES` per Global Constraints), `src/lib/siteValidation.ts` (`SiteEnv.reservedHostnames: readonly string[]`; `validateSiteInput` rejects a listed hostname right after the subdomain check), `src/routes/sites.ts` (`SITE_ENV.reservedHostnames: config.reservedHostnames`), `src/dev/env.ts` (`RESERVED_HOSTNAMES ??= "admin.lychee.land"`), `.env.example`
- Test: `src/lib/siteValidation.test.ts`, `src/routes/sites.test.ts`

- [ ] **Step 1: Write failing tests:**
  - `validateSiteInput` with `reservedHostnames: ["admin.lychee.land"]` returns `{ ok: false, error: '"admin.lychee.land" is reserved' }`.
  - The route tests: `POST /sites/preview` and `POST /sites` both refuse `hostname=ADMIN.lychee.land`. The submit writes nothing; check through the fakes that the Caddyfile is unchanged.
  - A config parse test: `"Admin.lychee.land, other.lychee.land,,"` becomes `["admin.lychee.land", "other.lychee.land"]`. Export the parser as `parseHostnameList(raw: string | undefined): string[]` from `src/config.ts`, so it is testable without module-level env.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: add-site refuses RESERVED_HOSTNAMES`

---

### Task 4: lychee-admin: docs

**Files:**
- Modify: `CLAUDE.md`, `PRODUCT.md`, `README.md`, `DESIGN.md` (example hostnames), `.impeccable/design.json` (only if DESIGN.md's rule prose changed: re-derive `narrative.rules` with the documented transform, strip `**bold**` and backticks, from each rule's header to the next rule header or heading), and `.claude/skills/comparing-design-variants/SKILL.md` (seed list).
- **CLAUDE.md specifically:**
  - **The domain line:** becomes `lychee.land`.
  - **Examples:** `<label>-lyly-dev` and `*.lyly.dev` examples become `lychee-land`.
  - **Configuration:** `DOMAIN` is described as required, and `RESERVED_HOSTNAMES` is documented (it holds `admin.lychee.land`).
  - **The admin.lychee.land bullet:** the reservation is no longer "ships with the domain move" but present.

- [ ] **Step 1: Edit.** History stays (Global Constraints).
- [ ] **Step 2: Verify:**
  - `npm run lint`.
  - `git grep -nE "lyly[.-]dev" -- '*.md' .claude .impeccable/design.json`: every remaining hit is historical; list them in the report.
  - `git grep -c "100\.82" -- .` reports no matches.
  - If `design.json` changed: re-derive the rule bodies from DESIGN.md with the documented transform and confirm the result equals the file.
- [ ] **Step 3: Commit** `docs: lychee.land is the managed domain`

---

### Task 5: lychee-ops: `site_domain` and every derived use

**Files:**
- Modify: `group_vars/all.yml` (the four variables; `admin_hostname` now derived; each commented), `roles/inventory/defaults/main.yml` (`inventory_site_pattern: "{{ site_name_pattern }}"`), `roles/resources_reconcile/tasks/reconcile.yml`, `roles/resources_reconcile/tasks/main.yml` and `roles/resources_reconcile/tasks/select_account_candidate.yml` (each `select('regex', '<pasted pattern>', match_type='fullmatch')` uses `site_name_pattern`), `roles/resources_host/templates/docker-compose.yml.j2` (`service.name is match(site_name_pattern ~ '\\Z')`), and the comments that use `-lyly-dev`/`*.lyly.dev` as examples in those files and in `roles/resources_host/files/mounts.yml`
- Test: `tests/fixtures/*` and `tests/test_*.yml` move from `-lyly-dev` to `-lychee-land`; add a domain-switch play in `tests/test_resources_render.yml`

**Interfaces (produced):** `site_domain`, `site_suffix`, `site_name_pattern`, `admin_hostname` (Global Constraints).

- [ ] **Step 1: Write the failing domain-switch play:**
  - With `site_domain: example.test` (re-derive `site_suffix` and `site_name_pattern` in the play's vars from the same expressions as `group_vars`), importing `select_account_candidate.yml` with passwd entries `blog-example-test` and `blog-lychee-land` and no declarations selects `blog-example-test`.
  - The inventory site pattern selects `blog-example-test` and not `blog-lychee-land`.
  - With the real `group_vars`, `blog-lyly-dev` is selected by neither.
- [ ] **Step 2: Run** `./tests/run.sh </dev/null`. Expected: FAIL.
- [ ] **Step 3: Implement,** and move the fixtures to `-lychee-land`.
- [ ] **Step 4: Run** `./tests/run.sh </dev/null` and the syntax check (`ANSIBLE_COLLECTIONS_PATH=$PWD/tests/.collections tests/.venv/bin/ansible-playbook --syntax-check -i inventory.yml playbook.yml </dev/null`). Expected: PASS. Also, `git grep -nE "lyly[.-]dev" -- roles group_vars tests` shows only historical text; list it in the report.
- [ ] **Step 5: Commit** `feat: site_domain is the one source for site names`

---

### Task 6: lychee-ops: the validator takes `--site-suffix`

**Files:**
- Modify: `roles/resources_host/files/validate_declarations.py`. Remove `SITE_SUFFIX` and `SITE_NAME_RE`. Add a required `--site-suffix SUFFIX` option; a suffix not matching `^-[a-z0-9]+(-[a-z0-9]+)*$` exits 2 with a usage message. The site-name regex and the error messages are built from the suffix, and the docstring's usage line is updated.
- Modify: the two callers' argv, `roles/resources_reconcile/tasks/main.yml:~119` and `roles/resources_reconcile/tasks/reconcile.yml:~99`, to append `--site-suffix` and `"{{ site_suffix }}"`.
- Test: `tests/test_validate_declarations.py`

- [ ] **Step 1: Write failing tests:**
  - Every existing case passes `--site-suffix -lychee-land`, with fixture names moved.
  - New: with `--site-suffix -example-test`, the name `blog-example-test` is a site and `x-example-test-old` is rejected as a malformed site name.
  - A missing `--site-suffix` exits 2.
  - `--site-suffix lychee-land` (no leading dash) exits 2.
- [ ] **Step 2: Run** `tests/.venv/bin/python -m unittest tests.test_validate_declarations`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the unittest command, then `./tests/run.sh </dev/null` and the syntax check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: the declaration validator takes its site suffix as an argument`

---

### Task 7: lychee-ops: `create-site-dir` renders its domain

**Files:**
- Create: `roles/lyly_admin_host/templates/lyly-admin-create-site-dir.sh.j2`, from `files/lyly-admin-create-site-dir.sh` with `*.lyly.dev` and the refusal message rendered from `site_domain`.
- Delete: `roles/lyly_admin_host/files/lyly-admin-create-site-dir.sh`.
- Modify: `roles/lyly_admin_host/tasks/main.yml`. Drop it from the "Install privileged wrapper scripts" copy loop and add a `template` task with the same `dest`, owner root:root and mode `0700`, beside "Install the resource-status wrapper".
- Modify: `tests/run.sh`. Render the template with Ansible's own templating against the real `group_vars/all.yml` (as it already does for the steamcmd wrapper), then run `sh -n` on the result, and check that the rendered file contains `*.lychee.land)` and not `lyly.dev`.

- [ ] **Step 1: Add the `run.sh` check.** Run it. Expected: FAIL (no template).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run** `./tests/run.sh </dev/null` and the syntax check. Expected: PASS.
- [ ] **Step 4: Commit** `feat: create-site-dir renders the managed domain`

---

### Task 8: lychee-ops: the `.env` check joins the deploy gate

**Files:**
- Create: `roles/lyly_admin_app/tasks/decide_env.yml`, a pure decision file in the style of `roles/swee_app/tasks/decide_gate.yml`, with the same header listing what it consumes and produces.
  - **Consumes:** `lyly_admin_app_env_early` (a `slurp` result, possibly failed or without `content`), `site_domain`, `admin_hostname`.
  - **Produces:** `lyly_admin_app_env_ok` (bool) and `lyly_admin_app_env_reason` (`'ok'` or one of the exact gate strings).
  - **Parsing:** `DOMAIN` and `RESERVED_HOSTNAMES` are parsed exactly the way the existing HOST/PORT parse does it (regex_search, trim, strip quotes, trim). `RESERVED_HOSTNAMES` is split on commas, each entry trimmed and lowercased, empty entries dropped.
- Modify: `roles/lyly_admin_app/tasks/main.yml`.
  - **Before** "Record the gate outcome", add a `slurp` of `{{ app_install_dir }}/.env` (`failed_when: false`, registered `lyly_admin_app_env_early`) and an `import_tasks: decide_env.yml`.
  - **"Record the gate outcome"** ANDs in `lyly_admin_app_env_ok`.
  - **"Explain the gate outcome"** uses `lyly_admin_app_env_reason` whenever the env check fails; otherwise it keeps its CI-based reason.
  - **The later `.env` read** for the health check is unchanged. Comment the early read: why it exists, and that it never sources the file.
- Modify: `HOST.md`. One line under the lyly-admin `.env` facts: the reconciler now checks `DOMAIN` and `RESERVED_HOSTNAMES` against `site_domain` and `admin_hostname`, with the gate strings.
- Test: a new `tests/test_lyly_admin_decide_env.yml`, appended to `run.sh`'s final `exec` line.

- [ ] **Step 1: Write failing plays.** Each builds a fake slurp result (`content: "<base64 .env>"`) and imports `decide_env.yml`. Expected outcomes:
  - **Match:** `DOMAIN=lychee.land` with `RESERVED_HOSTNAMES=admin.lychee.land` → ok, reason `'ok'`.
  - **Quoted and padded:** `DOMAIN="lychee.land"` with `RESERVED_HOSTNAMES= Admin.lychee.land , other.lychee.land` → ok.
  - **Wrong domain:** `DOMAIN=lyly.dev` → `DOMAIN in .env is lyly.dev, lychee-ops expects lychee.land`.
  - **No `DOMAIN` line** → `DOMAIN missing from .env, lychee-ops expects lychee.land`.
  - **Right domain, no reservation line** → `RESERVED_HOSTNAMES in .env does not include admin.lychee.land`.
  - **Slurp failed** (no `content` key) → `could not read /opt/lyly-admin/.env`.
- [ ] **Step 2: Run** `./tests/run.sh </dev/null`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `./tests/run.sh </dev/null` and the syntax check. Expected: PASS.
- [ ] **Step 5: Commit** `feat: block a deploy whose .env disagrees with site_domain`

---

## After merge (operator and controller)

These are the spec's Cutover and Verification sections, done by hand, not by implementers. In order:
1. Edit `.env` (no restart).
2. Merge lychee-ops.
3. Merge lychee-admin.
4. Verify steps 1–5, including the static and Next.js end-to-end runs.
