# GitHub Actions workflow template for Next.js sites

## Problem

Deploying a Next.js reverse-proxy site today is entirely manual after the
initial scaffold: the user has to write their own CI, or SSH in and re-run
`docker compose up -d --build` by hand for every change. lyly-admin already
has a self-hosted `github-runner` on `lychee` (used for its own CI/CD, see
`.github/workflows/deploy.yml`) — the same pattern can drive per-app
deploys, but the user shouldn't have to write that workflow from scratch.

## Goal

lyly-admin does not build, deploy, or hold any git/Docker credentials
itself — that boundary stays exactly as documented in CLAUDE.md. Instead,
the site detail page for a Next.js-scaffolded reverse-proxy site shows a
ready-to-use GitHub Actions workflow, fully interpolated with that site's
real hostname and paths, in a code block with a "Copy" button. The user
pastes it into their own repo as `.github/workflows/deploy.yml` and points
their self-hosted runner at it (the same `github-runner` already configured
on `lychee` for lyly-admin's own deploys).

## Design

### The workflow template

Mirrors `.github/workflows/deploy.yml`'s existing conventions (`runs-on:
self-hosted`, `rsync -rl --delete --exclude=...`, `workflow_dispatch` for
manual triggers) rather than inventing a new style:

```yaml
name: Deploy blog.lyly.dev

on:
  push:
    branches: [main]
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4

      # Sync app source into the directory lyly-admin scaffolded, without
      # touching the generated Dockerfile/docker-compose.yml/.dockerignore.
      - name: Sync app files
        run: |
          rsync -rl --delete \
            --exclude='.git' \
            --exclude='Dockerfile' \
            --exclude='docker-compose.yml' \
            --exclude='.dockerignore' \
            ./ /var/www/blog.lyly.dev/

      - name: Build and deploy
        run: docker compose -f /var/www/blog.lyly.dev/docker-compose.yml up -d --build
```

**Why rsync-into-the-scaffold-directory over a build-in-checkout +
image-tag approach:** the alternative (build the image in the runner's own
checkout workspace, tag it, and have `docker-compose.yml` reference
`image: <tag>` instead of `build: .`) avoids the filename-collision risk
below, but breaks the existing manual-deploy path — "drop your app source
into `/var/www/<hostname>/` and run `docker compose up -d --build`" only
works today because the compose file builds from local source. Switching to
an image-tag reference means that command alone can no longer build
anything, for either the manual or CI-triggered path. One consistent
deploy mechanism (same compose file, same command, human or workflow) beats
a marginally cleaner CI setup that fragments the two paths — especially
since there's no registry-push benefit to gain here: build host and run
host are the same machine.

**The filename-collision risk this accepts:** if the user's own repo
happens to contain a file literally named `Dockerfile`, `docker-compose.yml`,
or `.dockerignore`, the rsync `--exclude` flags mean that file is neither
synced in nor deleted from the target directory — lyly-admin's generated
versions always win silently. This is a reasonable, easily-documented
constraint (those three filenames are reserved for lyly-admin's scaffold),
not a correctness bug: rsync's default behavior is that `--delete` does not
remove excluded files, so this can't corrupt the scaffold either.

**Branch name:** hardcoded to `main`, matching this repo's own convention
and the overwhelmingly common default. Not configurable in this pass — a
comment isn't even necessary since `workflow_dispatch` gives the user a
manual-trigger fallback regardless of what their default branch is called.

### Where the template is generated

`src/lib/frameworkScaffold.ts`'s `getFrameworkScaffold` signature changes
from `(framework, port)` to `(framework, port, hostname, sitesRoot)` — the
workflow needs the site's hostname (for the job name and the rsync target)
and `sitesRoot` (to compute that target path via the same convention
`computeFilesPath` already uses). `Scaffold` gains a `deployWorkflow:
string` field, fully interpolated, no placeholders. Both existing call
sites (the add-site route, the site-detail route) already have `hostname`
and `config.sitesRoot` in scope — this is a mechanical signature update, not
a new capability. The rsync target path in the generated YAML is built via
`path.posix.join(sitesRoot, hostname)` — the same convention
`computeFilesPath` already uses — not string concatenation, since
`sitesRoot` is env-configurable and isn't guaranteed to lack a trailing
slash.

### Detail page UI

For Next.js-scaffolded reverse-proxy sites only (same gating as the
existing build/run commands section — i.e., when a `scaffold` is present),
a new block appears below the build/run commands:

```
GitHub Actions workflow                              [Copy]
┌─────────────────────────────────────────────────────┐
│ name: Deploy blog.lyly.dev                           │
│                                                       │
│ on:                                                   │
│   push:                                               │
│     branches: [main]                                  │
│   ...                                                 │
└─────────────────────────────────────────────────────┘
Paste this into .github/workflows/deploy.yml in your app's repo.
```

A `<pre>` block (same dark code-block styling already used for the
build/run commands) holds the full YAML, HTML-escaped like every other
piece of interpolated content in this file. A small "Copy" button next to
the section label copies the block's text to the clipboard.

### Copy-to-clipboard mechanism

A small, generic addition to `public/app.js` — not scoped to this one
feature, so any future code block gets the same behavior for free:

```js
document.querySelectorAll("[data-copy-target]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    navigator.clipboard.writeText(target.textContent ?? "");
  });
});
```

The `<pre>` block gets `id="github-workflow-yaml"`; the button gets
`data-copy-target="github-workflow-yaml"`. Brief visual feedback (e.g. the
button label flashing "Copied!" for a second) is a reasonable small
addition but not load-bearing — out of scope to specify precisely here,
left to implementation judgment within the existing button/Tailwind
conventions.

### Out of scope

- No workflow file is ever written to disk by lyly-admin — this is purely
  a displayed, copyable template. The "no Docker invocation, no git
  credentials held by lyly-admin" boundary is completely unchanged.
- No branch-name customization, no support for a different runner label,
  no multi-environment (staging/prod) variants — one hardcoded `main`-push
  + manual-dispatch workflow, matching the project's own deploy.yml.
  Extending this later is straightforward (more interpolated fields) but
  not built now.
- Not framework-generic — like the Dockerfile scaffold itself, this is
  Next.js-specific for now. A future second framework would need its own
  template, following the same seam `getFrameworkScaffold`'s per-framework
  branching already provides.
