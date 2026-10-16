# lychee-admin built in CI

Date: 2026-10-15. Status: approved design (sections approved in conversation),
awaiting written-spec review. Roadmap sub-project 4, "lychee-admin built in CI"
(`2026-10-12-platform-roadmap-design.md`). Spans lychee-contract, lychee-admin
and lychee-ops.

## Why

The roadmap's done-when for sub-project 4 is **no `npm ci` or build runs on
lychee, so no dependency lifecycle script runs on the host.** Today
lychee-ops' `lychee_admin_app` role builds the app on lychee itself: it
checks out the repo as root, gates on CI, syncs the tree into
`/var/lib/lychee-ops/build`, runs `npm ci` and `npm run build` there as
`lychee-admin`, rsyncs the result into `/opt/lychee-admin`, runs
`npm ci --omit=dev` in place, restarts, and health-checks. Every `npm ci`
executes dependency lifecycle scripts on the host. They run unprivileged, but
they run in the directory holding `.env`, and the installed code is writable
by the app user it runs as.

## What the build is today (read 2026-10-15)

| Fact | Value |
|---|---|
| Host | x86_64, Ubuntu 26.04.1 LTS, glibc 2.43, Node v22.23.2 (from apt) |
| Runtime dependencies | `express`, `js-yaml`, `dotenv` (pure JS); `bcrypt ^6.0.0` (native) |
| bcrypt | N-API, ships prebuilds including `linux-x64/bcrypt.glibc.node`; its `install` script is `node-gyp-build`, which only checks for a prebuild; the same library loads it at runtime |
| bcrypt use | `src/middleware/auth.ts` calls `bcrypt.compareSync` on every request, uncached |
| Build | `npm run build:css && tsc -p tsconfig.build.json` |
| What runs | `node dist/server.js`; `src/app.ts` serves `public/` relative to `dist/`; `package.json` has no `type` (CommonJS) |
| Installed size | `node_modules` 7.9 MB (82 packages), `dist` 600 KB |
| Install-script packages | `bcrypt` (runtime); `esbuild`, `@parcel/watcher` (build-time only) |
| Host tools | Docker 29.8.1; no `gh`, no `cosign`; root holds a ghcr read credential in `/root/.docker/config.json` |

## Decisions

1. **The artifact is a minimal OCI image on ghcr, unpacked rather than run.**
   CI pushes `ghcr.io/lycheehome/lychee-admin:sha-<full sha>`, a `FROM scratch`
   image holding the finished app at `/app`. lychee pulls it with the
   credential it already has and copies `/app` out. Nothing runs in a
   container; lychee-admin stays a host service. Rejected: a GitHub Actions
   artifact (expires after at most 90 days, capping rollback; needs the host
   token to gain `Actions: Read`), and a GitHub release asset per merge
   (buries meaningful releases).
2. **Provenance is checked on the host with GitHub's verifier.** CI signs the
   image digest with `actions/attest-build-provenance`; lychee runs
   `gh attestation verify` against the digest before unpacking. Rejected:
   trusting the registry (anyone or anything holding package-write can replace
   a tag after the gate passed), and reading a digest out of the CI run
   (still trusts whatever wrote it). `gh` was chosen over `cosign` because the
   attestations are GitHub's format and `gh` has the exact checks:
   `--signer-workflow`, `--source-ref`, `--source-digest`,
   `--deny-self-hosted-runners`, `--bundle-from-oci`.
3. **bcrypt stays, with its bundled prebuild, and no install script runs
   anywhere.** The runtime tree is installed with `--ignore-scripts`. A CI
   smoke check in an image with an older glibc than lychee's proves the
   prebuild loads. Rejected: `bcryptjs` (several times slower, on every
   request, blocking the event loop longer) and compiling from source (a
   toolchain in CI for no gain over a binary bcrypt already ships).
4. **Releases are directories with a `current` symlink, rolled back
   automatically.** The Capistrano layout (as in Ansistrano for Ansible): one
   immutable directory per release, `current` pointing at one, deploy is an
   atomic symlink swap plus restart, rollback is pointing it back. A failed
   health check rolls back on its own, so a bad commit no longer leaves the
   service down. Rejected: in-place swap with a manual `previous/`, and
   keeping today's behaviour.

## Part 1: CI builds the release image (lychee-admin)

`.github/workflows/ci.yml` gains a second job, **`release`**. It is not named
`test`, so the deploy gate's `test` rule and the ruleset's required check are
unchanged.

- `needs: test`; `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`.
  Pull requests, forks included, never reach it.
- Job-level permissions: `contents: read`, `packages: write`,
  `id-token: write`, `attestations: write`. The workflow default stays
  `contents: read`.
- Steps:
  1. Checkout, `actions/setup-node` with Node 22, `npm ci`, `npm run build`.
     Build-time install scripts (esbuild, @parcel/watcher) run here, in CI,
     as they already do in `test`.
  2. `scripts/assemble-release.sh <out-dir>`: copies `dist/`, `public/`,
     `package.json` and `package-lock.json` into a clean directory and runs
     `npm ci --omit=dev --ignore-scripts` there. It fails if `dist/server.js`
     or `public/style.css` is missing. The same script runs locally.
  3. Smoke check, in `node:22-bookworm-slim` (glibc 2.36, older than lychee's
     2.43) with the assembled tree mounted read-only:
     `require('bcrypt')` loads and `compareSync` of a known password against
     a hash committed in the script returns `true`; `require('./dist/app')`
     loads, so a runtime dependency missing from the tree fails here.
  4. Build and push a `linux/amd64` image: `FROM scratch`, `COPY` the tree to
     `/app`, label `org.opencontainers.image.source` set to the repository
     URL. One tag, `sha-<40-hex commit>`; no `latest`, no other tag.
  5. `actions/attest-build-provenance` on the pushed digest with
     `push-to-registry: true`, so the attestation lives beside the image.
- Cost: about a minute more on merges to `main`; PR CI is unchanged.

## Part 2: lychee installs it (lychee-ops)

### Layout

`/usr/local/lib/lychee-admin/`, `root:root 0755`:

```
/usr/local/lib/lychee-admin/
  releases/<sha>/        one complete tree, root-owned, never modified after unpacking
  current -> releases/<sha>
```

It is outside `/opt/lychee-admin` on purpose. That directory is
`2775 lychee-admin:webdeploy` with no sticky bit, so any `webdeploy` member can
rename or replace entries in it, a root-owned symlink included. Under
`/usr/local/lib` the running code is, for the first time, something neither
the app user nor `webdeploy` can write. `/opt/lychee-admin` keeps `.env` (still
hand-placed; `EnvironmentFile=` and A-ENV-1..4 unchanged).

`.deployed-sha` and `.failed-sha` move from `/opt/lychee-admin/` to
`/var/lib/lychee-ops/lychee-admin/`, a directory the role creates
`root:root 0700` (lychee-ops' `app_marker_dir`). Not beside
`deploy-status.json`: `/var/lib/lychee-admin` is owned by the app user and is
a `ReadWritePaths` entry of its service, so the app could unlink and replace a
root-written marker there, forging `.deployed-sha` to skip a deploy, or making
it a symlink to a root-only file (`.deployed-sha -> /root/.ssh/id_lychee_admin`)
that root's read would follow and copy into `installed_commit` of the
world-readable status file. As a second lock, each marker is `stat`ed without
following links before it is read, and anything that is not a regular file
owned by uid 0 is treated as absent, with a warning in the run's output.
`deploy-status.json` stays in `/var/lib/lychee-admin`, where the app reads it.
The recovery instruction becomes
`sudo rm /var/lib/lychee-ops/lychee-admin/.failed-sha`.

### Unit

`lychee-admin.service`:

```
WorkingDirectory=/usr/local/lib/lychee-admin/current
ExecStart=/usr/bin/node /usr/local/lib/lychee-admin/current/dist/server.js
```

`EnvironmentFile=`, `ProtectSystem=strict` and `ReadWritePaths=` are
unchanged; the service writes nothing under its code directory. Node resolves
the symlink to the real release path, so each release loads only its own
`node_modules`.

### The `gh` binary

Installed by lychee-ops from the `cli/cli` release tarball for a pinned
version, checked against a sha256 hard-coded in `group_vars`, at
`/usr/local/lib/lychee-ops/gh/<version>/gh`, root-owned. It is not put on
`PATH`; the role calls it by full path. Invoked with
`GH_TOKEN={{ github_api_token }}` when that is set (it is today: a
fine-grained PAT with no permissions). Bumping the version is a commit
changing both the version and the checksum.

### The app role, in order

`lychee_admin_app` is rewritten. Its env check (`decide_env.yml`), failure
counting and status-file write keep their behaviour.

1. **Target.** `git ls-remote` with the existing deploy key for
   `refs/heads/main`. The root-owned checkout in `src_dir` is no longer
   needed.
   Before anything else, the program checks that the unit **systemd has
   loaded** runs from `<release root>/current/`: `systemctl show lychee-admin
   -p ExecStart -p NeedDaemonReload`, whose `ExecStart` must name
   `<release root>/current/` and whose `NeedDaemonReload` must be `no`. The
   file on disk is not enough: a full run that dies between installing the new
   unit and its daemon-reload leaves the new file beside the old loaded
   definition, and `systemctl restart` would run the old one. If the loaded
   unit does not qualify, or `systemctl show` fails, the run is `blocked` with
   gate code `host-pending`, a `gate` naming which, and nothing is pulled. App runs use the lychee-ops
   checkout of the last full run, which already ran the host role, so this
   should never fire; it exists so that a deploy can never pass a health
   check against the old tree and be recorded as the new one.
2. **Gate.** As A-CI-1 for `test`, and the same rule for a job named
   `release`: every job of that name in every completed run for the target
   concluded `success`; none means `missing`. The CI-pending/CI-failed
   classification (A-GATE-1) covers both job names. The watcher already holds
   a moved lychee-admin commit until all of its runs have completed, which
   now includes `release`.
3. **Pull and resolve.** `docker pull ghcr.io/lycheehome/lychee-admin:sha-<sha>`,
   then read the image's repo digest. Everything after this step names
   `@sha256:<digest>`, never the tag. A pull failure blocks with gate code
   `image-unavailable`.
4. **Verify.** `gh attestation verify oci://ghcr.io/lycheehome/lychee-admin@sha256:<digest>
   --bundle-from-oci --repo LycheeHome/lychee-admin
   --signer-workflow LycheeHome/lychee-admin/.github/workflows/ci.yml
   --source-ref refs/heads/main --source-digest <sha> --deny-self-hosted-runners`.
   Non-zero exit blocks with gate code `provenance-failed` and the verifier's
   last line in `gate`. Nothing is unpacked.
5. **Unpack.** If `releases/<sha>` already exists (a retry after a failed
   health check, or a revert to a commit whose release was not yet pruned),
   skip to step 6; it was verified before it was renamed into place, and
   step 4 has just verified the image again.
   Otherwise: remove any leftover `releases/<sha>.tmp`;
   `docker create --name lychee-admin-unpack-<sha8> <digest> /nonexistent`
   (a `scratch` image has no command, and create never runs one);
   `docker cp <container>:/app releases/<sha>.tmp`; `docker rm`;
   `chown -R root:root`, directories `0755`, files `0644`; check
   `dist/server.js` and `node_modules/bcrypt` exist; rename to
   `releases/<sha>`. The container is removed in an `always:` so a failure
   leaves none behind.
6. **Switch.** Record the release `current` points at now as `previous`
   (from `readlink`; none on a fresh host). If `current` already names the
   target (a run killed after its swap and before its health check),
   `previous` is the newest other release by the ordering prune uses, else
   `legacy` if it exists. `ln -s releases/<sha>
   current.tmp` then `mv -T current.tmp current`. Restart the service.
7. **Health check.** Today's: `GET http://<HOST>:<PORT>/` answers `401`,
   five tries two seconds apart, `HOST`/`PORT` from the existing `.env` parse.
8. **On success:** write `.deployed-sha`, clear `.failed-sha`, result
   `deployed`.
9. **On failure (rescue):** if `previous` exists, swap `current` back to it
   the same atomic way, restart, health-check again. Result `failed`;
   `failed_step` is `health check; rolled back to <prev8>` or, if the
   rollback's check also fails, `health check; rollback to <prev8> also
   failed`. `.failed-sha` counts attempts and the retry cap is unchanged.
   `.deployed-sha` keeps naming the rolled-back-to commit, so
   `installed_commit` stays "the last commit that passed a health check",
   which is now also what is running.
10. **Prune.** Keep the newest three entries in `releases/` by modification
    time, never removing the target of `current` or the release just rolled
    back from. Pruning failures are logged and never fail the run.
11. Remove the pulled image (`docker image rm` with both the `sha-<sha>` tag
    and the digest reference, in one call: removing the digest reference alone
    leaves the tag holding the image) so pulls do not accumulate; failure here
    is ignored.

The role runs no `npm`, and no longer needs `build_dir`, `src_dir` or
`/var/lib/lychee-ops/.npm`.

### First run on an existing host

If `current` does not exist, `lychee_admin_host` creates the release root,
creates `releases/legacy` as a symlink to `/opt/lychee-admin` and points
`current` at it, **before** it writes the new unit file. That role runs before
the app role and its unit change may restart the service, so `current` must
already resolve to a working tree when it does. The old in-place build (dist, public and node_modules
are all there) is then the `previous` that the first real release rolls back
to. This needs no hand step and does not stop the reconciler's timers.
Until the cleanup in Rollout step 4, that legacy tree is as writable as it is
today; the protection of Part 2's layout applies to real releases from the
first one on. Markers left in `/opt/lychee-admin` by the old role are not
read and go with that cleanup. A retry count there is dropped, so a commit
that was capped under the old role gets three fresh attempts under the new
one, each of which now rolls back.

## Part 3: contract

lychee-contract, a minor version:

- **A-CI-2** (new): lychee-admin's CI has a job named exactly
  `constants.json` `release_job` (`release`), and the deploy gate requires it
  green by the same rule as A-CI-1.
- **A-BUILD-2** (new): the release artifact. Image
  `ghcr.io/lycheehome/lychee-admin`, tag `sha-<40 lowercase hex>`, the tree
  at `/app` with `dist/server.js` as the entry point, signed by
  `.github/workflows/ci.yml` on `refs/heads/main` with build provenance
  pushed to the registry.
- **A-BUILD-1** (lychee-ops builds with `npm`) is retired by A-GROW-1's
  order: lychee-ops stops reading it first (Part 2 ships), then the contract
  removes it in the release after.
- `constants.json` gains `release_job: "release"`,
  `release_image: "ghcr.io/lycheehome/lychee-admin"`,
  `release_tag_format: "sha-{commit}"`,
  `release_signer_workflow: ".github/workflows/ci.yml"`, and
  `paths.app_release_root: "/usr/local/lib/lychee-admin"`.
- `gate_codes` gains `image-unavailable`, `provenance-failed` and `host-pending`; A-GATE-1's
  table gains their rows. `failed_step` is already a free string in
  `app-status.schema.json`, so the rollback wording needs no schema change.

## Rollout

Each step is safe on its own.

1. **lychee-contract**: A-CI-2, A-BUILD-2, the constants and gate codes.
   Tagged.
2. **lychee-admin**: the `release` job and `scripts/assemble-release.sh`;
   pin the new contract. On merge the host still deploys the old way (it
   ignores the new job), but every merge now publishes a signed image. Then,
   from the development machine, `gh attestation verify` against the first
   real image with the exact flags of Part 2 step 4, before anything on the
   host depends on it.
3. **lychee-ops**: the `gh` install, the rewritten app role, the unit change,
   the marker move, the legacy seeding. Pin the new contract.
4. **lychee-ops follow-up, after a few days of clean deploys**: remove
   `releases/legacy`, everything in `/opt/lychee-admin` except `.env`,
   `build_dir`, `src_dir` and `/var/lib/lychee-ops/.npm`. It refuses unless
   `current` points at a real `releases/<sha>` that `.deployed-sha` names.
   Then the contract release that removes A-BUILD-1.
5. **lychee-admin docs**: CLAUDE.md's Deployment section rewritten for the
   pulled artifact; the roadmap marks sub-project 4 done.

## Testing

**lychee-ops**, focused playbook tests, with a fake `gh` (a script recording
its argv and exiting as told) and a local registry stand-in or a fake
`docker`, whichever the existing `resources_reconcile` tests already use:

- the gate blocks `ci-pending` while `release` is missing, and `ci-failed`
  when it failed;
- a failed pull blocks with `image-unavailable`;
- `gh` receives exactly the flags of Part 2 step 4, with the target SHA as
  `--source-digest` and the resolved digest in the reference;
- a failed verification blocks with `provenance-failed` and creates no
  release directory;
- an unpacked tree missing `dist/server.js` fails and leaves no
  `releases/<sha>`, only a removed `.tmp`;
- the swap leaves `current` a symlink at every step (no `ln -sfn`);
- a failed health check rolls `current` back, restarts, records `failed`
  with the rollback wording, and counts the retry;
- first run with no `current` seeds `releases/legacy`;
- pruning keeps three, never the target of `current` or the rolled-back-from
  release;
- the role contains no `npm` invocation (a grep test over the role).

**lychee-admin**: the `release` job itself, with its smoke checks; and a
local run of `scripts/assemble-release.sh` followed by the same smoke command.

Rollback is proven by the tests, not on the host: lychee deploys only `main`,
and there is no safe way to hand it a broken commit.

## Done when (on lychee)

- An app run's journal shows a deploy with no `npm` in it.
- `current` points at `releases/<sha>`, `root:root`, and `<sha>` is `main`.
- The health check passed, and `deploy-status.json` shows that SHA deployed.
- After step 4: `/var/lib/lychee-ops/.npm`, `build_dir` and `src_dir` are
  gone, and `/opt/lychee-admin` holds only `.env`.

## Out of scope

- Running lychee-admin in a container. It stays a host service.
- Node itself. It still comes from apt; the image does not ship a runtime.
- A deploy-history UI.
- Verifying provenance for resource images (swee, palsave-api, sites). The
  same `gh` could do it later; it is not this sub-project.
