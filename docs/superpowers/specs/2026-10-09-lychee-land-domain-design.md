# Move managed sites from lyly.dev to lychee.land — design

**Date:** 2026-10-09
**Repos:** `LycheeHome/lychee-admin` (app), `LycheeHome/lychee-ops` (reconciler)
**Status:** approved in conversation, section by section

## Goal

`lychee.land` replaces `lyly.dev` as the domain every managed site lives under.
Success means:
- a new `x.lychee.land` site works end to end, both static and Next.js
  (attach, deploy, remove, prune, account deletion);
- nothing in either repo still accepts or creates `lyly.dev` names;
- `palsave-api` and `admin.lychee.land` are untouched.

The domain is configured in exactly **one place per repo**, and everything else
is derived from it. A check at deploy time stops the two repos' values
drifting apart.

## Starting state and decisions

- **No migration.** No `*.lyly.dev` site exists anywhere: no Caddy block but the
  unmanaged `lychee.local`, no tunnel ingress rule, no site declaration, no
  site account, and the apex DNS record is deleted. This is a cutover with
  nothing in flight.
- **Clean cutover, not multi-domain.** After this, only `lychee.land` is
  accepted. Supporting both domains would be code nothing uses.
- **One value per repo, plus a reconciler check** (chosen over making
  lychee-ops the only source and over two unchecked values):
  - lychee-admin: `DOMAIN` in its hand-placed `.env`;
  - lychee-ops: `site_domain` in `group_vars`;
  - the reconciler reads the app's `.env` and blocks deploys when the two
    disagree.
- **Tier 1 holds.** DNS stays a manual step. Out of scope: the `lyly.admin`
  wordmark, the app's host identity (`lyly-admin` user, unit and paths), and a
  Cloudflare redirect from `lyly.dev`.

## lychee-admin

- **`DOMAIN` becomes required, with no default.**
  - **Why:** `src/config.ts` currently falls back to `"lyly.dev"`. That is
    another hardcoded copy, and it would let the reconciler's check compare
    `.env` against a value hidden in code.
  - **Without it:** the production server refuses to start and names the
    missing variable.
  - **Dev mode:** `src/dev/env.ts` sets `DOMAIN=lychee.land`, beside its
    `dev`/`dev` credentials.
  - **`.env.example`:** shows `DOMAIN=lychee.land`, marked required.
- **One derivation, in `src/lib/siteValidation.ts`:**
  - **Replaces** the `SITE_SUFFIX` constant (`"-lyly-dev"`) with:
    - `siteSuffixFor(domain)`: `-` plus the domain with dots replaced by
      hyphens (`lychee.land` → `-lychee-land`);
    - a site-name pattern built from that suffix.
  - **Uses it:** `resourceNameFor`, the Next.js label-length check,
    `declarationWriter`'s site-name checks (`SITE_NAME_RE` today) and the
    prune route's site-name guard.
  - **The writer** gets the domain from the app config it is handed. It turns a
    resource name back into a hostname by stripping the suffix and adding
    `.${domain}`, where today it uses the literal `.lyly.dev`.
- **Label length.** The 63-character resource-name limit stays, so the longest
  Next.js label is `63 − suffix length`: 51 for `lychee.land`, down from 54.
  The error message states the computed number.
- **Reservation:**
  - **The setting:** `RESERVED_HOSTNAMES`, an optional comma-separated list in
    `.env`.
  - **The check:** add-site rejects any listed hostname in both
    `POST /sites/preview` and `POST /sites`, through the shared validator. That
    keeps preview and submit from disagreeing, the same way reserved ports work
    today.
  - **The message:** "`<hostname>` is reserved".
  - **On lychee:** `admin.lychee.land`.
  - **Why it's needed:** the admin HTTPS site lives in lychee-ops'
    `conf.d/admin.caddy`, which the app never parses, so `hostnameExists`
    cannot see it. Without the reservation, typing `admin` in the add-site
    form would create a competing Caddy block, DNS record and resource name.
- **Seed and tests:**
  - **Seed:** `src/dev/seed.ts` moves to `lychee.land` hostnames. The
    deliberately unmanaged `lychee.local` block stays, and the seed keeps
    covering every Caddyfile parser branch.
  - **Literal values:** tests assert `-lychee-land` and `x.lychee.land`
    literally, so they check the derived values rather than repeating the
    derivation.
  - **Domain switch:** a new test runs with `example.test` and checks that the
    suffix, the name pattern, the name → hostname round trip and the label
    limit all follow it.
  - **Reservation:** a new test refuses a reserved hostname in both preview
    and submit.
- **Docs:**
  - **Update:** every passage that names the *current* managed domain moves
    to `lychee.land`: CLAUDE.md (the domain line, `*.lyly.dev` examples,
    `<label>-lyly-dev`), PRODUCT.md, README.md, `.env.example`, code comments
    with `lyly.dev` examples (e.g. `public/app.js`), the seed list in
    `.claude/skills/comparing-design-variants/SKILL.md`, and DESIGN.md's
    example hostnames.
  - **DESIGN.md's sidecar:** if DESIGN.md's named-rule prose changes,
    `.impeccable/design.json`'s `narrative.rules` is re-derived by the
    documented transform (strip `**bold**` and backticks). It is never
    hand-edited.
  - **Left as written (historical):** the retired `ssh.lyly.dev` tunnel, the
    2026-08-08 apex removal, and the dated critique files under
    `.impeccable/critique/`.

## lychee-ops

- **One source:** `site_domain: lychee.land` in `group_vars/all.yml`, with these
  derived there:
  - `site_suffix: "-{{ site_domain | replace('.', '-') }}"`. The domain's
    characters are `[a-z0-9.-]`, so the result is regex-safe.
  - `site_name_pattern`: `[a-z0-9](?:[a-z0-9-]*[a-z0-9])?` plus `site_suffix`.
  - `admin_hostname: "admin.{{ site_domain }}"`, replacing the literal.
- **Callers that switch to the variable,** instead of each pasting the regex:
  - `roles/resources_reconcile/tasks/reconcile.yml`;
  - `roles/resources_reconcile/tasks/main.yml`;
  - `roles/resources_reconcile/tasks/select_account_candidate.yml`;
  - the default of `inventory_site_pattern` in `roles/inventory/defaults/main.yml`;
  - `roles/resources_host/templates/docker-compose.yml.j2`, which uses
    `site_name_pattern ~ '\\Z'` to decide which services get the site profile.
- **`validate_declarations.py`:**
  - **The change:** its `SITE_SUFFIX` and `SITE_NAME_RE` constants become a
    required `--site-suffix` argument, and its error messages derive from it.
  - **Callers:** the two tasks that run it pass `{{ site_suffix }}`.
  - **Its tests:** they pass `-lychee-land` explicitly, plus one case with
    another suffix to show nothing inside is hardcoded.
- **`create-site-dir`:** `lyly-admin-create-site-dir.sh` becomes a template
  (`.sh.j2`) that renders `*.{{ site_domain }}` into its hostname check and its
  refusal message. Its install path, owner, mode and sudoers line don't change.
- **Comments** that use `-lyly-dev` or `*.lyly.dev` as examples (mounts.yml,
  the validator, the compose template, the account tasks) move to
  `-lychee-land`.
- **The `.env` check, in `lyly_admin_app`:**
  - **Inputs:** the role already reads and parses (never sources) `HOST` and
    `PORT` from `/opt/lyly-admin/.env`. It also parses `DOMAIN` and
    `RESERVED_HOSTNAMES`, *before* deciding whether to install a new commit,
    using the existing parse pattern.
  - **Where it lives:** in a pure decision file (`decide_env.yml`, like the
    existing `decide_*` files) that the suite can import.
  - **When it blocks:** `DOMAIN` missing or different from `site_domain`, or
    `RESERVED_HOSTNAMES` not containing `admin_hostname`.
  - **What blocking does:** the deploy is blocked like a red CI result. The app
    stays on its last healthy build, and the status file's `gate` names the
    mismatch exactly, e.g. `DOMAIN in .env is lyly.dev, lychee-ops expects
    lychee.land`.
  - **What it never does:** write `.env`, or fail the tick by itself. A blocked
    deploy is already a normal, visible state.
- **Tests:**
  - **Fixtures:** they move to `-lychee-land` names.
  - **Domain switch:** a new test sets `site_domain: example.test` and checks
    the derived pattern selects `blog-example-test` and not `blog-lychee-land`
    (through `select_account_candidate.yml` and the inventory site pattern).
  - **`decide_env.yml`:** passes on a match, and blocks with the right gate
    string on a wrong `DOMAIN`, a missing `DOMAIN`, and a missing
    reservation.
  - **`create-site-dir`:** its rendered script is checked with `sh -n`, the
    same way `run.sh` already renders and checks the steamcmd wrapper.

## Cutover (in this order)

0. **Done 2026-10-09:** the operator confirmed `/opt/lyly-admin/.env` has a
   `DOMAIN` line, so the new app (which requires it) will start.
1. **Operator edits `.env`:** `DOMAIN=lychee.land`, and adds
   `RESERVED_HOSTNAMES=admin.lychee.land`. **No restart:** the running process
   keeps the environment it started with, so nothing changes yet.
2. **Merge the lychee-ops PR.** On the next tick:
   - the validator, compose template, account handling and `create-site-dir`
     switch to `lychee.land`;
   - the `.env` check passes;
   - `palsave-api` is unaffected, since it isn't a site name.
3. **Merge the lychee-admin PR.** Once CI is green, the next tick deploys it
   and restarts the app with the new `DOMAIN` and the reservation.

**Before step 2, the operator checks that nothing is named for the old
domain** (amended after the whole-branch review). The cutover is hard: after
step 2 the reconciler no longer treats a `-lyly-dev` name as a site, so one left
over would be handled as a plain resource or rejected outright. The first
command should print nothing (no site accounts), and the two listings should
show only `palsave-api`:

```
getent passwd | grep -- '-lyly-dev:'
sudo ls /etc/lychee-resources /var/lib/lychee-resources
ls /var/lib/lyly-admin/lychee-resources
```

**Window: add or attach no sites from step 1 until the step 3 deploy is
confirmed, and don't restart lyly-admin in between** (amended after the
whole-branch review; this paragraph first opened the window at step 2 and
called both failures fail-closed, and neither was true). The window opens at
step 1, not step 2. The running app on `main` reads `DOMAIN` for validation
but hardcodes `-lyly-dev` and `.lyly.dev` when it names a declaration. So if
lyly-admin restarts after step 1 and before the step 3 deploy — a reboot, a
crash, or the old ops deploying some other `main` commit — old code runs with
`DOMAIN=lychee.land`: it accepts `x.lychee.land` and names it `x-lyly-dev`, a
mix that neither side's code expects. Within the window, with the old process
still running, adds go wrong in three ways:

- **Static add:** fails at `create-site-dir` once step 2 has landed, and rolls
  back. This one is fail-closed.
- **Reverse-proxy add** (plain, or a Next.js site before Attach): succeeds,
  because it writes only the Caddyfile block and the ingress rule. After step
  3, `isManagedHostname` hides `x.lyly.dev`, so its block and rule are
  orphaned: the new app can neither list nor remove them, and they have to be
  taken out by hand.
- **Next.js attach:** writes `x-lyly-dev.yml`, which the new validator rejects
  on **every** tick, not one. Its errors stop `can_apply`, so `palsave-api` and
  every other resource stay frozen until it is gone. The new app can't prune it
  either (`isSiteName` is false for it), so only a hand commit to
  `lychee-resources` clears it.

The reverse order (app first) is worse: the app would make `-lychee-land` names
that the old validator doesn't recognise as sites, and would accept them
without the site profile.

**A mismatched `.env` shows `blocked`, not `skipped`** (amended after the
whole-branch review). Once step 2 has landed, a `.env` whose `DOMAIN` or
`RESERVED_HOSTNAMES` doesn't match blocks the app deploy, and the status file
reads `blocked` with that gate string on every tick, not only the first, until
`.env` is fixed.

## Verification

1. **Deploy:** the status file shows the lychee-admin merge installed with
   `gate: ok`; `drift.json` is `[]`; `palsave-api` is unchanged.
2. **Add-site form (operator, in the browser; preview writes nothing):**
   - `blog.lychee.land` is accepted and previews resource `blog-lychee-land`;
   - `blog.lyly.dev` is rejected;
   - `admin.lychee.land` is rejected as reserved.
3. **Static, end to end:**
   - add `hello.lychee.land`, plus its DNS record (a proxied CNAME to the
     tunnel, as the site's page says);
   - the placeholder page is served over the tunnel;
   - remove it, with its files.
4. **Next.js, end to end:**
   - add `test.lychee.land`, attach `LycheeHome/test-site`, and deploy its
     existing tag;
   - **expect:** the container `test-lychee-land` runs under its own account
     with the site profile;
   - remove the site, prune the declaration, and watch the reconciler clean up
     the project and delete the account under the new pattern.
5. **`https://admin.lychee.land`** still returns `401`. Its name now comes from
   `site_domain`.

## Rollback

In this order (amended after the whole-branch review, which found the order
matters):

0. **Remove any site added under `lychee.land`, while the new lychee-ops is
   still running.** Remove it in the app, and prune its declaration if it was a
   Next.js site, then wait for the reconciler to clean up its project, status
   and account. That cleanup only recognises `-lychee-land` names under the new
   lychee-ops, and the old app's `isManagedHostname` would hide the site
   entirely, so after step 1 neither side could remove it.
1. **Revert the lychee-ops PR.** The new ops blocks every app deploy while
   `.env` doesn't say `lychee.land`, so it has to go first, or step 3 would
   never install.
2. **Set `.env` back to `DOMAIN=lyly.dev`**, and drop `RESERVED_HOSTNAMES`.
   **No restart**, for the same reason as cutover step 1.
3. **Revert the lychee-admin PR.** The next tick deploys it and restarts the
   app with `lyly.dev`.

The same window applies between steps 1 and 3: add or attach no sites, and
don't restart lyly-admin. Apart from step 0's sites, there's no data either
way.

## Later, not here

- A Cloudflare redirect rule from `lyly.dev` to `lychee.land` (dashboard only).
- The `lyly.admin` wordmark, and the app's host identity.
- Follow-up carried from admin HTTPS: when `admin_https` fails, the play-level
  "Fail the run if any deploy failed" task is skipped, so a deploy failure on
  the same tick goes unnamed in the alert.
