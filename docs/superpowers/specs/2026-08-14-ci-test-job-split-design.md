# Split CI checks out of the deploy job

## Problem

`.github/workflows/deploy.yml` triggers only on `push` to `main` and
`workflow_dispatch`. There is no `pull_request` trigger, so **no automated
check runs on a pull request at all**.

The suite added in
`docs/superpowers/specs/2026-08-13-local-dev-environment-design.md` runs
inside the deploy job, between `npm run typecheck` and `npm run build`. That
gates the *deploy* — a red suite stops the rsync and the service restart —
but it does not gate the *merge*. A PR whose tests fail shows no failing
check, merges cleanly, and only goes red on the way to `lychee`, after the
code is already on `main`.

Separately, `npm run lint` is not run by CI anywhere, despite being one of
the three verification commands the repository's own docs and plans treat as
mandatory gates.

## Goal

A pull request against `main` runs the full check suite and reports a status
GitHub can require before merge. Deployment continues to happen only on
`main`, and only after those checks have passed.

Pull-request code must not execute on `lychee`. The self-hosted runner runs
as `github-runner`, which holds `sudo` rights for `systemctl restart
lyly-admin` and `systemctl is-active lyly-admin`
(`deploy/sudoers-github-runner.example`). Checks need none of that — they
need only `npm` — so they belong on an isolated runner.

## Design

### Triggers

`on` gains a `pull_request` trigger scoped to PRs targeting `main`:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch: {}
```

The workflow's `name` changes from `Deploy to lychee` to `CI and deploy`,
since it no longer only deploys. The filename stays `deploy.yml` — GitHub
keys a workflow's run history to its path, and renaming the file would
orphan the existing history for no benefit.

### `test` job

```yaml
  test:
    runs-on: ubuntu-latest
    concurrency:
      group: test-${{ github.ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

GitHub-hosted rather than self-hosted: the checks need only `npm`, and
running them on an ephemeral VM means PR code never executes on `lychee`.

Steps: `actions/checkout@v7`, `actions/setup-node@v7` with `node-version:
22`, then `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`.

All four checks run, in that order. `lint` is included because it is
currently enforced nowhere. `build` is included so a change that typechecks
and passes tests but breaks the build fails on the PR rather than during
deployment.

Concurrency cancels superseded runs on a pull request — push three commits
and only the newest run survives, which matters now that PR runs consume
Actions minutes. It deliberately does **not** cancel on `main`: the
expression evaluates to `false` for a `push` event, so every merge completes
its own test run and therefore gets its own deploy. With unconditional
cancellation, two merges landing close together would cancel the first
test run, and because `deploy` needs `test`, that merge would silently never
deploy. The end state would still be correct — the later commit contains
the earlier one — but a merge producing no deployment is surprising enough
to be worth one expression.

### `deploy` job

```yaml
  deploy:
    needs: test
    if: github.event_name != 'pull_request'
    runs-on: self-hosted
    concurrency:
      group: deploy-lychee
      cancel-in-progress: false
```

`needs: test` is the actual gate. Actions will not start this job unless
`test` succeeded, so a failing suite cannot reach `lychee` even on a direct
push to `main`.

The `if` keeps it off pull requests while still permitting
`workflow_dispatch`, whose `event_name` is `workflow_dispatch`. A manual
dispatch runs both jobs, so it is gated too.

Concurrency uses one fixed group for every deploy, so two merges queue
rather than overlap. `cancel-in-progress` is `false` here — the opposite of
the `test` job — because cancelling mid-deploy could interrupt
`rsync --delete` partway through, leaving `/opt/lyly-admin` half-synced, or
stop between the rsync and the `systemctl restart`. A queued deploy is safe;
an interrupted one is not.

Its steps are unchanged from today **except** that `npm run typecheck` and
`npm test` are removed — they now live in the `test` job, and `needs:`
guarantees they passed. The resulting sequence is:

1. `actions/checkout@v7`
2. `actions/setup-node@v7` with `node-version: 22`
3. `npm ci`
4. `npm run build`
5. Sync app files (`rsync`)
6. Install production dependencies (`npm ci --omit=dev`)
7. Restart service
8. Verify service is active
9. Health check

`npm ci` at step 3 still installs dev dependencies and must stay: `npm run
build` needs `tailwindcss` and `tsc`, both of which are devDependencies. It
is unrelated to the `npm ci --omit=dev` at step 6, which runs inside
`/opt/lyly-admin` on the host and installs only what the running service
needs. `npm run build` stays because the deploy rsyncs its own build output.

Steps 5 through 9 are untouched, including their existing explanatory
comments about why `-a` is not used on the rsync and why a `401` is the
health check's success condition.

### Header comment

The comment above `on:` currently reads:

> Fires on every push that lands on main, which in a PR-based workflow means
> "after a PR merges." That alone isn't a real gate — enforce it with a
> branch protection rule on main (require PR + review, disallow
> direct/force pushes) in repo Settings > Branches. This workflow can't do
> that part for you.

That advice is now incomplete rather than wrong. It is rewritten to say that
the `test` job runs on pull requests and can be made a **required status
check** in branch protection, which is what actually blocks merging a red
PR, and that branch protection remains the part this workflow cannot
configure for itself.

**Correction, discovered after implementation:** that last paragraph assumed
branch protection was available. It is not. The `Lychee-Home` org is on
GitHub Free and this repository is private — a combination for which both
branch protection and rulesets are gated behind GitHub Pro or making the
repository public. Both APIs return `403 Upgrade to GitHub Pro or make this
repository public`. So the `test` job cannot be marked required, and nothing
mechanically prevents merging a red pull request.

This does not undermine the design's goal, but it does narrow what the goal
achieved. `deploy` carries `needs: test`, and that applies to pushes on
`main` as much as to pull requests — so a red merge leaves `main` red and
the deploy **skipped**, and the host keeps serving the last good deploy. The
property the split was really protecting, that broken code never reaches
`lychee`, holds without any repository setting. What is genuinely missing is
only the merge-time block, which on this plan is a matter of reading the
check before clicking merge. The workflow header comment and `CLAUDE.md`
were corrected to say so rather than instructing a step that returns 403.

### Consequence worth recording

Pull requests now consume GitHub Actions minutes, where previously they
triggered no workflow at all. The repository is private, so this draws on
the account's monthly allowance rather than being free-for-public. The job
is a single `npm ci` plus four short commands, so the per-run cost is small,
but this is a change in kind and not merely degree.

## Out of scope

- **Caching `node_modules`** between runs via `actions/setup-node`'s `cache`
  input. It would speed up `npm ci`, but this project's install is small and
  cache configuration carries its own correctness questions (cache
  poisoning, key selection). Worth revisiting only if run time becomes
  annoying.
- **Running the checks on multiple Node versions.** The app is deployed on
  exactly one runtime; a matrix would test configurations nobody runs.
- **Changing `deploy/sudoers-github-runner.example`.** The self-hosted
  runner's privileges are unchanged by this split.
- **A `pull_request_target` trigger or fork handling.** The repository is
  private with a single maintainer; PRs come from branches, not forks.
