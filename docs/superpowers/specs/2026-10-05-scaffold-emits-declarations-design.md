# Scaffold emits declarations — design

Date: 2026-10-05
Status: approved in conversation; written spec pending review
Implements step 5 of `2026-09-25-managed-services-design.md` ("the actual goal"),
as **provision-and-attach**: `lyly-admin` provisions a site, and attaching a
repository is what lets it build and deploy. Part A — writing a declaration's
tag and offering Deploy — shipped in #53. This is part B.

## Problem

Since 2026-10-02 a Next.js-scaffolded site has no deploy path at all.
`getScaffoldFiles` (`src/lib/frameworkScaffold.ts:85`) returns exactly a
`Dockerfile`, a `docker-compose.yml` (`build: .`) and a `.dockerignore`, written
into `/var/www/<hostname>/`, and the site's page tells the operator to run
`docker compose up -d --build` there by hand. The workflow that used to sit
beside them was deleted because it only ever worked on a self-hosted runner.

Meanwhile slices 2–4 built everything a site needs except the site-shaped
parts: a bounded declaration schema, a root-owned compose template, a reconciler
that discovers newer tags on ghcr, an inventory `lyly-admin` reads, and a
Deploy control that writes a tag.

### What changed since the parent design

- **The runner is already gone** (retired 2026-09-28). The parent design framed
  this slice as the precondition for retiring it. It is not any more; this slice
  restores a deploy path, it does not close an exposure.
- **"Scaffolded sites belong to other people" is dropped.** Every attached site
  repository lives in `LycheeHome` and pushes to `ghcr.io/lycheehome/*`. The
  reconciler's image allowlist is unchanged, and keeps its property: a
  compromised UI can only run images from your own org.
- **Secrets are deferred again.** SOPS/`age` was deferred to its first real
  consumer; `test.lyly.dev` has no source and no environment, so it is not one.
  `env_keys`/`env_from` stay rejected by the validator, so a site that needs a
  secret fails loudly at validation rather than crash-looping. SOPS/`age` is its
  own slice when a site actually needs a key.
- **`site_files` is not used.** The parent design assumed a site container would
  read `/var/www/<hostname>` through that alias. With the image built in CI the
  application is baked into the image, and the mount buys nothing. The alias
  stays in the vocabulary, still with `allowed_resources: []`, for a future
  static-site kind.

### Verified state, 2026-10-05

- `test.lyly.dev` on `lychee`: `/var/www/test.lyly.dev/` holds the three files
  (2026-10-03, `lyly-admin:webdeploy`), the Caddyfile block proxies to
  `localhost:3000`, nothing listens on 3000, no container exists. The only
  container on the box is `palsave-api:0.3.0`.
- Validator `NAME_RE` is `[a-z0-9][a-z0-9-]{0,62}`, fullmatched
  (`lychee-ops/roles/resources_host/files/validate_declarations.py:89`). Allowed
  fields are exactly `name, image, state, port, bind, mounts, state_volume`;
  `image` must carry a tag (`:96-101`).
- The compose template hardcodes `PALSAVE_API_*` environment for every service
  (`docker-compose.yml.j2:85-88`), maps `port:port` (`:30`), and takes the
  container's identity from a hand-maintained `service_identities` map checked
  against a host account of the same name (`assert_identities.yml:23-53`).
- One rejected declaration means **no** declaration is applied that tick
  (`reconcile.yml:14-26`).
- `lyly-admin`'s hostname validator accepts a single label under `lyly.dev`
  (`src/lib/siteValidation.ts:34`).
- `writeDeclarationTag` edits only an existing file's tagged `image:` line
  (`src/lib/declarationWriter.ts`).

## Decisions

| Question | Decision |
|---|---|
| Where site source lives | `LycheeHome` repos only; images under `ghcr.io/lycheehome/*` |
| Secrets | Deferred; validator keeps rejecting `env_keys`/`env_from` |
| Resource name | `<label>-lyly-dev` (`test.lyly.dev` → `test-lyly-dev`) |
| Container identity | Reconciler creates a per-site `nologin` account |
| When the declaration is written | At **attach**, tagless; first Deploy sets the tag |

**Naming.** The mapping is injective because a label never contains a dot, and
it is the suffix shape `mounts.yml` already anticipates. The validator reserves
the `-lyly-dev` suffix for sites, so a site and a service can never claim the
same name. A label longer than 54 characters is refused (63 − 9).

**Identity.** Rejected: one shared `sites` account (the shape CLAUDE.md records
as laundering privilege between everything that shares it), and a hand commit
per site (provisioning would never be one action in `lyly-admin`). Accepted
cost: a `lyly-admin` write can now cause root to create an account. That is
bounded by the name pattern, the account has no shell and no supplementary
groups, and its uid comes from a reserved range.

**Tagless at attach.** Rejected: writing a full `image:tag` at attach (no schema
change, but `lyly-admin` cannot check the tag exists, a typo surfaces a tick
later as a blocked service, and the first deploy takes a different path from
every later one), and writing at provision time (ties the repo name to the
hostname, and leaves a declaration for every site that never gets a repo).
Tagless means every deploy, the first included, is the #53 offer-and-Deploy path.

## Flow

1. **Provision** — Add site, Next.js, port. Caddy block and tunnel rule exactly
   as today. **No `/var/www/<hostname>/` is created** for a Next.js site. The
   site's page shows the scaffold to copy into a repository.
2. The operator creates a `LycheeHome` repository, commits the scaffold and
   their app, and pushes tag `v0.1.0`. GitHub-hosted CI builds and pushes
   `ghcr.io/lycheehome/<repo>:0.1.0`.
3. **Attach** — on the site's page the operator names the repository.
   `lyly-admin` writes `test-lyly-dev.yml`, tagless, and pushes it.
4. The reconciler creates account `test-lyly-dev` if absent, takes no compose
   action, runs tag discovery, publishes `available_tag: 0.1.0` and
   `result: awaiting-image`.
5. The site's page (and the services board) offers `0.1.0`. **Deploy** writes
   the tag. The next tick renders the site profile and runs `up -d`.

Steps 2 and 3 can happen in either order. Attaching before the first push just
means discovery finds nothing yet.

## Section 1 — `lychee-ops`

### Validator (`validate_declarations.py`)

- A name ending `-lyly-dev` must match `[a-z0-9]([a-z0-9-]*[a-z0-9])?-lyly-dev`
  within the existing 63-character bound. No other name may end `-lyly-dev`.
- `image` may omit its tag **only** for a `-lyly-dev` name. The repository part
  is still checked against the `ghcr.io/lycheehome/` pattern.
- Everything else unchanged: unknown fields rejected, `env_keys`/`env_from`
  rejected, port uniqueness and reserved ports, `bind` allowlist.

### Reconciler

- **Awaiting first image.** A tagless declaration gets no compose action, no
  render, no pull. `resolve_available` still runs (it already derives the
  repository from the image string). Status file: `result: awaiting-image`,
  `target_tag: ""`, `available_tag` as discovered.
- **Site accounts.** A new task ahead of `assert_identities`: for each
  `-lyly-dev` declaration whose account does not exist, create a system account
  of that name — `nologin`, no home, no supplementary groups, uid/gid from a
  reserved range declared in `group_vars`. `service_identities` entries for sites
  are derived from those accounts rather than hand-maintained; `palsave-api`
  stays hand-declared. An `absent` declaration does not delete its account
  (deleting accounts frees uids that orphaned files would then inherit — the
  `github-runner` lesson).
- **Inventory.** Sites enter `services.json` automatically from their
  declarations, with `container:` and `status_file:` derived from the name. A
  hand `inventory_services` entry per site would be a second hand commit.

### Compose template — profiles

The `PALSAVE_API_*` environment moves behind a per-resource profile, selected
by name. A **site profile** is selected by the `-lyly-dev` suffix — the same
marker the account step uses, so no `kind:` field:

- `ports: ["127.0.0.1:<port>:3000"]`
- `environment: { PORT: "3000", HOSTNAME: "0.0.0.0" }`, nothing else
- `tmpfs` at `/tmp` and `/app/.next/cache`, writable by the container's uid
- no mounts, no state volume, no `group_add`
- fixed as for every resource: `user` from the identity, `read_only: true`,
  `cap_drop: [ALL]`, `no-new-privileges`, `restart: unless-stopped`

**Risk, checked first in the plan:** that the scaffold's Next.js image serves
under `read_only` with only those two tmpfs paths. Verify with a real image
before the template is fixed; the tmpfs list is the thing that changes if not.

## Section 2 — the scaffold and `lychee-resources`

`frameworkScaffold.ts` generates three files meant for the site's repository:

- **`Dockerfile`** — as today, adjusted only if the read-only check requires it.
  `HEALTHCHECK` stays on `localhost:3000`, correct because the site profile fixes
  the container port.
- **`.dockerignore`** — unchanged.
- **`.github/workflows/release.yml`** — `runs-on: ubuntu-latest`, permissions
  `contents: read` and `packages: write`, triggered by a pushed `vX.Y.Z` tag;
  builds and pushes `ghcr.io/<lowercased github.repository>:X.Y.Z`. Plain semver,
  no `v`, no `latest`, because that is the only form tag discovery recognises.
  It names nothing about `lychee`.

`docker-compose.yml` is no longer generated. The test asserting nothing
generated names `runs-on` becomes: the only `runs-on` is `ubuntu-latest`, and
nothing names `self-hosted`.

A site declaration as `lyly-admin` writes it:

```yaml
name:  test-lyly-dev
image: ghcr.io/lycheehome/test-site     # tagless until the first Deploy
state: running
port:  3000
bind:  127.0.0.1
```

`lychee-resources`' README still says `lychee-services` and
`services_reconcile`; corrected alongside.

**Verify before depending on it:** a package pushed by a repository's
`GITHUB_TOKEN` is private and linked to that repository. Whether the host's
`read:packages` token can read every new site's package, not only
`palsave-api`'s, depends on that token's type and the package's access
inheritance. Check against `test.lyly.dev`'s first push before any `lyly-admin`
code relies on it. If it does not hold, attach gains one manual GitHub step and
the site's page says so.

**Existing `test.lyly.dev`.** Its three files stay and are inert. Attach works
on it identically (port 3000); its `build: .` compose file is never used.

## Section 3 — `lyly-admin`

- **`src/lib/siteResource.ts`** (pure): hostname → resource name, lowercased;
  refuses a label over 54 characters; validates the repository input as one
  ghcr path component.
- **`declarationWriter.ts`**: factor clone/pull/commit/push out of
  `writeDeclarationTag`, keeping its contract (never throws, never forces, resets
  on a rejected push). Three operations on top of it:
  - `createSiteDeclaration(hostname, repo, port)` — renders from fixed text
    (only the derived name, validated repo and integer port vary), refuses if the
    file exists, and **refuses if any declaration in the fresh clone claims the
    port**, before writing. This is the guard against freezing every resource
    with one rejected declaration.
  - `writeDeclarationTag` also accepts a tagless `image:` line and appends
    `:<tag>`. Changing registry or repository stays unreachable.
  - `setDeclarationState(name, "absent")`.
- **Add-site** port check also counts ports claimed in `lychee-resources`, read
  from the clone. `siteValidation.ts` stays pure; claimed ports are passed in.
- **Site detail page**
  - Next.js site, no declaration: the scaffold to copy, and **Attach repository**.
  - Attached: the request path's last hop reads the resource status from the
    inventory, not the `/var/www` compose wrapper. A site awaiting its image
    shows `awaiting image` — a new **neutral** entry in the status vocabulary.
  - The #53 newer-tag offer and Deploy control are reused on the page.
- **Remove-site**: for an attached site, a third separate request after the
  Caddy/tunnel removal writes `state: absent`; it runs only if that removal
  succeeded, as delete-files does. The container stops within a tick; the
  declaration and its port claim remain until deliberately pruned.
- **UI process**: the attach control, scaffold-to-copy presentation,
  `awaiting image` state and Deploy placement each have more than one reasonable
  answer, so they go through `/impeccable` and `comparing-design-variants` as the
  plan's first UI task, before any markup. `DESIGN.md` gains the `awaiting image`
  tone via `/impeccable document`; the sidecar's rule bodies stay derived.
- **Docs**: CLAUDE.md's Reverse-proxy sites section and the Next.js remove-flow
  text are rewritten (operator-run `docker compose up -d --build` stops being
  the path). PRODUCT.md checked against "never invokes Docker", which still
  holds: the app writes requests; the reconciler acts.

## Testing

- `lychee-ops`: validator tests for the suffix rule, tagless-only-for-sites, and
  the reserved suffix; render tests for the site profile (ports, env, tmpfs, no
  mounts, no palsave env) and that `palsave-api` renders unchanged; a
  reconcile test that a tagless declaration takes no compose action and writes
  `awaiting-image`; fix the `blog.lyly.dev` fixtures (`test_resources_render.yml`
  `:111`, `:836`), which use a name the validator rejects.
- `lyly-admin`: unit tests for name mapping and repo validation; writer tests
  against a fake git for create, port collision, existing file, tagless → tagged,
  and absent; route-flow tests for attach, remove with a declaration, and the
  add-site declared-port conflict; dev seed gains one site awaiting its image and
  one running.
- On `lychee`: `test.lyly.dev` end to end — attach, first push, offer, Deploy,
  `running`, then reachable through the tunnel.

## Order across repositories

1. Read-only spike: the scaffold's image under the site profile's confinement.
2. `lychee-ops`: validator, accounts, awaiting-image, site profile, inventory.
   Merged before any site declaration exists — a tagless declaration written
   before the validator accepts it freezes the whole set.
3. ghcr access check against a real site package.
4. `lyly-admin`: writer, attach, status, remove, add-site check, scaffold.
5. `test.lyly.dev` end to end.

## Manual, by design

- Creating the site's repository in `LycheeHome`.
- Pushing release tags.
- Possibly granting the host's token access to a new package (see Section 2).
- Pruning an `absent` declaration.

## Not in this slice

SOPS/`age` and any environment in a site declaration; static sites as
resources (`site_files`); frameworks other than Next.js; deleting site
accounts; Deploy from anywhere but the existing offer.
