# CI Test Job Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a pull request against `main` run the full check suite as a status GitHub can require before merge, while deployment continues to happen only on `main` and only after those checks pass.

**Architecture:** `.github/workflows/deploy.yml` gains a `pull_request` trigger and splits into two jobs: a `test` job on a GitHub-hosted runner (so PR code never executes on `lychee`), and the existing `deploy` job on the self-hosted runner, gated with `needs: test` and skipped for pull requests. Each job carries its own `concurrency` block, with deliberately opposite cancellation behavior.

**Tech Stack:** GitHub Actions, Node.js 22 in CI, `js-yaml` (already a dependency) for structural verification.

**Spec:** `docs/superpowers/specs/2026-08-14-ci-test-job-split-design.md`

**Branch:** `ci-test-job-split`, already cut from the merged `main` (`838d427`).

## Global Constraints

- **This is a single-file change plus one documentation paragraph.** No application source is touched. If a step seems to require editing anything under `src/`, stop and report.
- **`actions/setup-node@v7` is already on this branch** (commit `75817b4`). `main` still has `v4`. When writing the new workflow file, keep **v7** — do not copy the version from `main`'s copy of the file.
- **`actions/checkout@v7` and `node-version: 22` stay as they are.**
- **Everything in the `deploy` job from the rsync step onward must be preserved byte-for-byte**, including all explanatory comments — the note about why `-a` is not used on the rsync, and the note about why a `401` is the health check's success condition.
- **No new dependencies**, and no new npm scripts. The workflow calls only `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`, all of which already exist.
- **Do not touch** `deploy/sudoers-github-runner.example`, `deploy/sudoers.example`, the `deploy/*.sh` scripts, or `deploy/lyly-admin.service`.
- **`npm test`, `npm run typecheck`, and `npm run lint` must all still pass locally** before committing. They are unaffected by a workflow change, but a green run confirms nothing else was disturbed.

---

### Task 1: Split the workflow into test and deploy jobs

**Files:**
- Modify: `.github/workflows/deploy.yml` (whole file)
- Modify: `CLAUDE.md` — the `## Deployment` section's first paragraph

**Interfaces:**
- Consumes: nothing — this is the only task
- Produces: a `test` job named exactly `test`, which is the name to enter when configuring a required status check in branch protection

- [ ] **Step 1: Read the current file**

Read `.github/workflows/deploy.yml` in full before editing. Steps 5 through 9 of the `deploy` job (rsync, production install, restart, is-active, health check) are carried over unchanged in the next step, and their comments must survive exactly.

- [ ] **Step 2: Replace the workflow file**

Replace the entire contents of `.github/workflows/deploy.yml` with:

```yaml
name: CI and deploy

# The test job runs on every pull request targeting main and on every push
# to main. Make `test` a required status check in branch protection
# (Settings > Branches) — that is what actually blocks merging a PR whose
# checks failed. Branch protection also needs to require a PR and disallow
# direct/force pushes to main; this workflow cannot configure that part.
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch: {}

jobs:
  # Runs on a GitHub-hosted runner, not the self-hosted one: these checks
  # need only npm, and an ephemeral VM means pull-request code never
  # executes on lychee, where github-runner holds sudo rights.
  test:
    runs-on: ubuntu-latest

    # Cancel superseded runs on a pull request, so pushing three commits
    # leaves only the newest run. Deliberately does NOT cancel on main:
    # the deploy job needs this one, so a cancelled test run would take
    # its deploy with it and leave that merge silently undeployed.
    concurrency:
      group: test-${{ github.ref }}
      cancel-in-progress: ${{ github.event_name == 'pull_request' }}

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

  deploy:
    # needs: test is the real gate — Actions will not start this job unless
    # the checks passed, so a failing suite cannot reach lychee even on a
    # direct push to main. The `if` keeps it off pull requests while still
    # allowing workflow_dispatch, which runs both jobs and is gated too.
    needs: test
    if: github.event_name != 'pull_request'
    runs-on: self-hosted

    # One group for every deploy, so two merges queue rather than overlap.
    # Never cancelled, unlike the test job: interrupting a deploy could
    # stop rsync --delete partway through, leaving /opt/lyly-admin
    # half-synced, or land between the sync and the service restart.
    concurrency:
      group: deploy-lychee
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: 22

      # Installs dev dependencies as well, because npm run build needs tsc
      # and tailwindcss. Unrelated to the --omit=dev install further down,
      # which runs inside /opt/lyly-admin and installs only what the
      # running service needs. typecheck and test are not repeated here —
      # they ran in the test job, and needs: guarantees they passed.
      - run: npm ci
      - run: npm run build

      # Sync everything except secrets and dev artifacts. .env lives only on
      # the host (/opt/lyly-admin/.env) and is never written by CI.
      #
      # Deliberately not using -a: /opt/lyly-admin is pre-created and owned
      # by lyly-admin, not github-runner, so preserving perms/owner/group/
      # times on that existing directory fails even though github-runner (a
      # webdeploy group member) can write inside it fine. None of those
      # attributes matter for how this app runs, so just recurse, keep
      # symlinks as symlinks, and preserve file (not directory) content —
      # new files get the setgid dir's webdeploy group and default perms.
      - name: Sync app files
        run: |
          rsync -rl --delete \
            --exclude='.git' --exclude='.env' --exclude='node_modules' \
            --exclude='src/dev' --exclude='*.test.ts' \
            ./ /opt/lyly-admin/

      - name: Install production dependencies
        run: cd /opt/lyly-admin && npm ci --omit=dev

      - name: Restart service
        run: sudo systemctl restart lyly-admin

      - name: Verify service is active
        run: |
          sleep 2
          sudo systemctl is-active lyly-admin

      # is-active only proves systemd thinks the process is running — it
      # doesn't prove Express actually bound its port and is answering
      # requests. A 401 here (unauthenticated) is the real proof: it means
      # the server accepted the connection and basic-auth middleware ran.
      - name: Health check
        run: |
          set -a
          . /opt/lyly-admin/.env
          set +a
          code=$(curl -s -o /dev/null -w "%{http_code}" "http://${HOST:-127.0.0.1}:${PORT:-8787}/")
          if [ "$code" != "401" ]; then
            echo "Unexpected health check status: $code (expected 401)" >&2
            exit 1
          fi
          echo "Health check OK — got 401 as expected"
```

- [ ] **Step 3: Verify the file parses and has the intended structure**

A workflow file has no local test runner, so assert its parsed structure directly. `js-yaml` is already a dependency and `tsx` is already the test runner.

Run this throwaway check (it writes nothing):

Write this to a scratch file rather than passing it with `-e`. The assertions
need to match strings containing both `${{ ... }}` and single quotes, and
embedding those in a shell argument invites quoting mistakes that silently
weaken the check.

The file must go **in the repository root**, not `/tmp`. Node resolves
imports relative to the script's own location, so a script outside the
project cannot find `js-yaml` in `node_modules` and dies with
`MODULE_NOT_FOUND` before testing anything. The leading dot keeps it out of
the way, and the final `rm` removes it — confirm `git status` is clean
afterwards.

```bash
cat > .check-workflow.ts <<'CHECK'
import fs from "node:fs";
import yaml from "js-yaml";

const w = yaml.load(fs.readFileSync(".github/workflows/deploy.yml", "utf8")) as any;
const fail = (m: string) => { console.error("FAIL: " + m); process.exitCode = 1; };

if (w.name !== "CI and deploy") fail("workflow name is " + w.name);
if (!w.on.pull_request) fail("no pull_request trigger");
if (w.on.pull_request.branches?.[0] !== "main") fail("pull_request not scoped to main");
if (w.on.push.branches?.[0] !== "main") fail("push not scoped to main");
if (!("workflow_dispatch" in w.on)) fail("workflow_dispatch missing");

const t = w.jobs.test;
const d = w.jobs.deploy;
if (!t) fail("no test job");
if (t["runs-on"] !== "ubuntu-latest") fail("test job not on ubuntu-latest");

const tGroup = String(t.concurrency?.group ?? "");
if (!tGroup.startsWith("test-") || !tGroup.includes("github.ref")) fail("test concurrency group is " + tGroup);

const tCancel = String(t.concurrency?.["cancel-in-progress"] ?? "");
if (!tCancel.includes("github.event_name") || !tCancel.includes("pull_request"))
  fail("test cancel-in-progress should be a pull_request expression, got: " + tCancel);

const runs = t.steps.filter((s: any) => s.run).map((s: any) => s.run);
const expected = ["npm ci", "npm run typecheck", "npm run lint", "npm test", "npm run build"];
if (JSON.stringify(runs) !== JSON.stringify(expected)) fail("test steps are " + JSON.stringify(runs));

if (d.needs !== "test") fail("deploy needs is " + d.needs);
if (!String(d.if ?? "").includes("pull_request")) fail("deploy if is " + d.if);
if (d["runs-on"] !== "self-hosted") fail("deploy not self-hosted");
if (d.concurrency?.group !== "deploy-lychee") fail("deploy concurrency group wrong");
if (d.concurrency?.["cancel-in-progress"] !== false) fail("deploy cancel-in-progress must be literal false");

const dRuns = d.steps.filter((s: any) => s.run).map((s: any) => s.run);
if (dRuns.some((r: string) => r.includes("npm run typecheck"))) fail("deploy still runs typecheck");
if (dRuns.some((r: string) => r.trim() === "npm test")) fail("deploy still runs npm test");
if (!dRuns.some((r: string) => r.includes("npm run build"))) fail("deploy lost npm run build");

for (const name of ["Sync app files", "Install production dependencies", "Restart service", "Verify service is active", "Health check"])
  if (!d.steps.some((s: any) => s.name === name)) fail("deploy lost step: " + name);

if (!process.exitCode) console.log("workflow structure OK");
CHECK
npx tsx .check-workflow.ts && rm .check-workflow.ts
```

Expected: `workflow structure OK` and nothing else. If it fails, the `rm` does not run — delete `.check-workflow.ts` yourself before committing, and confirm `git status` is clean.

This script has been dry-run against the pre-split file and correctly reports `workflow name is Deploy to lychee`, `no pull_request trigger`, and `no test job` — so it detects the state it is meant to detect rather than passing vacuously.

Two notes on why the assertions are shaped this way. The `${{ ... }}` values are compared with `includes` rather than exact equality, so a harmless whitespace difference inside the expression does not fail the check while a wrong variable still does. And `cancel-in-progress` on `deploy` is compared with `!== false` against the literal boolean — if it were quoted in YAML it would parse as the string `"false"`, which GitHub treats as truthy, so this catches a subtle and dangerous typo.

- [ ] **Step 4: Verify the preserved deploy steps are byte-identical**

The structural check above confirms those five steps exist by name. This confirms their bodies and comments were not reworded. Compare against the version on `main`:

```bash
diff <(git show main:.github/workflows/deploy.yml | sed -n '/# Sync everything except/,$p') \
     <(sed -n '/# Sync everything except/,$p' .github/workflows/deploy.yml) \
  && echo "preserved tail is identical"
```

Expected: `preserved tail is identical` with no diff output. If `diff` prints anything, restore those lines exactly from `main`'s version.

- [ ] **Step 5: Confirm setup-node is still v7**

The version bump already on this branch is easy to lose when replacing the whole file.

```bash
grep -c 'actions/setup-node@v7' .github/workflows/deploy.yml
```

Expected: `2` — one in each job. If it prints anything else, fix the version before continuing.

- [ ] **Step 6: Update the Deployment section in CLAUDE.md**

The `## Deployment` section's first paragraph describes CI as though deployment is all it does. It now also gates pull requests, and that is the part a reader most needs to know.

This step goes beyond the spec's literal text, which covers only the workflow file — it is included deliberately. The immediately preceding branch left this same paragraph stale (it still claimed CI excluded only `.env` and `node_modules` long after two more excludes were added), and the whole-branch review caught it as a finding. Leaving a known-inaccurate description of the deploy pipeline in place, in the very change that alters that pipeline, would repeat that exactly.

Replace the paragraph beginning `CI/CD runs via the existing self-hosted` with:

```markdown
CI/CD is `.github/workflows/deploy.yml`, which has two jobs. **`test`** runs on every pull request against `main` and on every push to `main`, on a GitHub-hosted runner: `npm ci`, then `typecheck`, `lint`, `test`, and `build`. It runs off-host deliberately — those checks need only `npm`, so pull-request code never executes on `lychee`. Make `test` a required status check in branch protection; that is what blocks merging a red PR. **`deploy`** runs only on `main` (and `workflow_dispatch`), on the existing self-hosted `github-runner`, and is gated behind `needs: test` so a failing suite cannot reach the host. It builds, syncs everything except `.git`, `.env`, `node_modules`, `src/dev/`, and `*.test.ts` into `/opt/lyly-admin`, installs production deps there, restarts the `lyly-admin` systemd service, and health-checks it (expects a `401` from `/`, since that's proof Express bound its port and basic-auth middleware ran — `systemctl is-active` alone only proves systemd thinks the process is running, not that it's serving traffic). Deploys share one concurrency group so two merges queue rather than overlap. `github-runner`'s sudo scope for this is in `deploy/sudoers-github-runner.example`, separate from the app's own scope in `deploy/sudoers.example`.
```

Leave the rest of the section — the "One-time host setup this assumes" list — untouched.

- [ ] **Step 7: Confirm the local suite is unaffected**

A workflow change cannot break the app, but a green run proves nothing else was disturbed.

```bash
npm test && npm run typecheck && npm run lint
```

Expected: 67 tests passing, typecheck and lint both clean.

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/deploy.yml CLAUDE.md
git commit -m "Split CI checks into a test job gating deploy

No workflow ran on pull requests, so the suite gated the deploy but not
the merge. Adds a pull_request trigger and a GitHub-hosted test job
running typecheck, lint, test, and build; the self-hosted deploy job now
sits behind needs: test and skips pull requests. Adds lint, which CI
never ran. Concurrency queues deploys without ever cancelling one, and
cancels superseded PR runs only."
```

---

## Final verification

After Task 1, before opening a PR:

- [ ] `npm test` — 67 passing
- [ ] `npm run typecheck` and `npm run lint` — clean
- [ ] `git diff main -- .github/workflows/deploy.yml` shows the two-job structure and no change to the rsync/restart/health-check bodies
- [ ] `grep -c 'actions/setup-node@v7' .github/workflows/deploy.yml` returns `2`

**The real verification happens on the PR.** GitHub uses the workflow definition from the head branch for `pull_request` events, so opening the PR is what first exercises the new `test` job. On that run, confirm:

1. A check named **`test`** appears on the PR and passes.
2. The **`deploy` job does not run** — it should show as skipped.
3. No `actions/setup-node` deprecation warning appears.

If `test` passes and `deploy` is skipped, the split works. Then set `test` as a required status check in Settings > Branches, which is the step that makes it a real merge gate and which no workflow file can do for itself.
