# GitHub Actions Workflow Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The site detail page for a Next.js-scaffolded reverse-proxy site shows a fully interpolated, copy-paste-ready GitHub Actions workflow (matching the project's own `.github/workflows/deploy.yml` conventions) with a "Copy" button — never written to disk, never executed by lyly-admin.

**Architecture:** `src/lib/frameworkScaffold.ts`'s `Scaffold` type gains a `deployWorkflow: string` field, and `getFrameworkScaffold` gains two new parameters (`hostname`, `sitesRoot`) needed to interpolate the workflow's job name and rsync target path. The detail page renders it in a `<pre>` block; a small, generic `[data-copy-target]` click handler in `public/app.js` copies any such block's text to the clipboard — not scoped to this one feature.

**Tech Stack:** Same as the rest of the app — Express/TypeScript backend, server-rendered HTML + vanilla JS frontend, Tailwind utility classes, the browser's `navigator.clipboard` API. No new dependencies.

## Global Constraints

- No automated test framework exists in this repo. Verification is `npm run typecheck`, `npm run build`, and `npm run lint`. For the new template-generation logic, also do a manual smoke check via `npx tsx -e "..."`.
- Do not run `npm run dev` — verify with typecheck/build/lint and code reading, per this project's established convention.
- lyly-admin never invokes Docker, holds git credentials, or executes the generated workflow in any way — it only generates and displays text. Do not add any new shell-out, sudo scope, or file write anywhere in this plan (the workflow YAML is never written to disk).
- The rsync target path in the generated workflow must be built via `path.posix.join(sitesRoot, hostname)`, not string concatenation — `sitesRoot` is env-configurable and isn't guaranteed to lack a trailing slash, and this is the same convention `computeFilesPath` already uses elsewhere in the codebase.
- **JS template-literal escaping gotcha, critical for this plan's code to work correctly:** the generated YAML needs literal backslash-newline shell line-continuations (`rsync -rl --delete \` followed by a real newline). In a JS/TS template literal, a single `\` immediately followed by a real newline in the *source* is a line-continuation escape sequence that JS itself swallows (both the backslash and the newline vanish from the resulting string) — that would silently corrupt the generated YAML by joining the `--exclude` flags onto one line. To get a literal backslash character followed by a real newline in the *output* string, the source must write `\\` (two characters — an escaped backslash) immediately before the real newline. Every task step below that touches this template already has this right — do not "simplify" `\\` down to `\` when transcribing it.
- Follow the existing Tailwind utility-class style — no new CSS files, no class abstraction, no new npm dependencies. When adding the "Copy" button, reuse the existing `BUTTON_SECONDARY` constant unmodified rather than layering extra padding/font-size utility classes on top of it — Tailwind utility precedence is based on the order classes are defined in the generated stylesheet, not the order they appear in an element's `class` attribute, so appending conflicting size classes to an existing button constant is fragile and should be avoided.

---

### Task 1: Generate the deploy workflow in `frameworkScaffold.ts`

**Files:**
- Modify: `src/lib/frameworkScaffold.ts` (add a `path` import, add `deployWorkflow` to `Scaffold`, add a new template function, change `getFrameworkScaffold`'s signature)

**Interfaces:**
- Produces: `Scaffold` gains `deployWorkflow: string`. `getFrameworkScaffold(framework: string, port: string, hostname: string, sitesRoot: string): Scaffold | null` — two new required parameters inserted after `port`. Both existing call sites in `src/routes/sites.ts` (Task 3) need updating to match; that's out of scope for this task.

- [ ] **Step 1: Add the `path` import**

At the top of `src/lib/frameworkScaffold.ts`, change:

```ts
export interface Scaffold {
```

to:

```ts
import path from "node:path";

export interface Scaffold {
```

- [ ] **Step 2: Add `deployWorkflow` to the `Scaffold` interface**

Change:

```ts
export interface Scaffold {
  dockerfile: string;
  compose: string;
  dockerignore: string;
  buildCommand: string;
  runCommand: string;
}
```

to:

```ts
export interface Scaffold {
  dockerfile: string;
  compose: string;
  dockerignore: string;
  buildCommand: string;
  runCommand: string;
  deployWorkflow: string;
}
```

- [ ] **Step 3: Add the workflow-template function**

After the `nextjsCompose` function (right before `export function getFrameworkScaffold`), add:

```ts
function nextjsDeployWorkflow(hostname: string, deployPath: string): string {
  return `name: Deploy ${hostname}

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
          rsync -rl --delete \\
            --exclude='.git' \\
            --exclude='Dockerfile' \\
            --exclude='docker-compose.yml' \\
            --exclude='.dockerignore' \\
            ./ ${deployPath}/

      - name: Build and deploy
        run: docker compose -f ${deployPath}/docker-compose.yml up -d --build
`;
}
```

Note the `\\` (double backslash) at the end of the `rsync`/`--exclude` lines — see this plan's Global Constraints for why. Transcribe exactly as shown.

- [ ] **Step 4: Update `getFrameworkScaffold`'s signature and return value**

Change:

```ts
export function getFrameworkScaffold(framework: string, port: string): Scaffold | null {
  if (framework !== "nextjs") return null;
  return {
    dockerfile: nextjsDockerfile(NEXTJS_BUILD_COMMAND, NEXTJS_RUN_COMMAND),
    compose: nextjsCompose(port),
    dockerignore: NEXTJS_DOCKERIGNORE,
    buildCommand: NEXTJS_BUILD_COMMAND,
    runCommand: NEXTJS_RUN_COMMAND,
  };
}
```

to:

```ts
export function getFrameworkScaffold(framework: string, port: string, hostname: string, sitesRoot: string): Scaffold | null {
  if (framework !== "nextjs") return null;
  const deployPath = path.posix.join(sitesRoot, hostname);
  return {
    dockerfile: nextjsDockerfile(NEXTJS_BUILD_COMMAND, NEXTJS_RUN_COMMAND),
    compose: nextjsCompose(port),
    dockerignore: NEXTJS_DOCKERIGNORE,
    buildCommand: NEXTJS_BUILD_COMMAND,
    runCommand: NEXTJS_RUN_COMMAND,
    deployWorkflow: nextjsDeployWorkflow(hostname, deployPath),
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: errors in `src/routes/sites.ts` (its two call sites still use the old 2-argument form — that's expected and will be fixed by Task 3, not yours). No errors should appear in `src/lib/frameworkScaffold.ts` itself.

- [ ] **Step 6: Manual smoke check**

Run:

```bash
npx tsx -e "
import { getFrameworkScaffold } from './src/lib/frameworkScaffold';
const scaffold = getFrameworkScaffold('nextjs', '3000', 'blog.lyly.dev', '/var/www');
console.log(scaffold.deployWorkflow);
console.log('---');
console.log('line count:', scaffold.deployWorkflow.split('\n').length);
"
```

Expected: the printed YAML shows `name: Deploy blog.lyly.dev` on its own line, each of the four `--exclude=...` flags on its own separate line ending visibly with a trailing `\`, the `rsync` target as `./ /var/www/blog.lyly.dev/`, and the final line `run: docker compose -f /var/www/blog.lyly.dev/docker-compose.yml up -d --build`. The line count should be in the high 20s (roughly 27) — if it's noticeably lower (e.g. low 20s), the backslash-escaping described in the Global Constraints went wrong and the `--exclude` lines got silently joined; fix it before proceeding.

- [ ] **Step 7: Commit**

```bash
git add src/lib/frameworkScaffold.ts
git commit -m "Generate a per-site GitHub Actions deploy workflow template"
```

---

### Task 2: Display the workflow on the detail page with a Copy button

**Files:**
- Modify: `src/views/html.ts` (`renderSiteDetail`'s `scaffold` parameter type and its reverse-proxy detail body)

**Interfaces:**
- Consumes: nothing directly from Task 1 (this task defines its own inline parameter shape, matching what Task 3 will pass).
- Produces: `renderSiteDetail`'s `scaffold` parameter becomes `{ buildCommand: string; runCommand: string; deployWorkflow: string }`. The rendered page gains a `<pre id="github-workflow-yaml">` holding the workflow text and a `<button data-copy-target="github-workflow-yaml">Copy</button>` — consumed by Task 4's client JS.

- [ ] **Step 1: Widen `renderSiteDetail`'s `scaffold` parameter type**

Change:

```ts
export function renderSiteDetail(
  site: Site,
  sitesRoot: string,
  respondingOnPort?: boolean,
  scaffold?: { buildCommand: string; runCommand: string },
): string {
```

to:

```ts
export function renderSiteDetail(
  site: Site,
  sitesRoot: string,
  respondingOnPort?: boolean,
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string },
): string {
```

- [ ] **Step 2: Add the workflow block and include it in the reverse-proxy detail body**

Change:

```ts
  const commandsBlock = scaffold
    ? `
        <div class="flex flex-col gap-1 mt-2">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">build command</span>
          <code class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.85rem] text-stone-50">${escapeHtml(scaffold.buildCommand)}</code>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">run command</span>
          <code class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.85rem] text-stone-50">${escapeHtml(scaffold.runCommand)}</code>
        </div>`
    : "";

  const detailsBody =
    site.type === "static"
      ? `<p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}</p>`
      : `
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">local port:</span> ${escapeHtml(site.target)}</p>
        ${frameworkLabel ? `<p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">framework:</span> ${escapeHtml(frameworkLabel)}</p>` : ""}
        ${statusLine}
        ${commandsBlock}`;
```

to:

```ts
  const commandsBlock = scaffold
    ? `
        <div class="flex flex-col gap-1 mt-2">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">build command</span>
          <code class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.85rem] text-stone-50">${escapeHtml(scaffold.buildCommand)}</code>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">run command</span>
          <code class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.85rem] text-stone-50">${escapeHtml(scaffold.runCommand)}</code>
        </div>`
    : "";

  const workflowBlock = scaffold
    ? `
        <div class="flex flex-col gap-1 mt-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">github actions workflow</span>
            <button type="button" class="${BUTTON_SECONDARY}" data-copy-target="github-workflow-yaml">Copy</button>
          </div>
          <pre id="github-workflow-yaml" class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.8rem] text-stone-50 overflow-x-auto whitespace-pre">${escapeHtml(scaffold.deployWorkflow)}</pre>
          <p class="text-stone-400 text-[0.75rem] leading-snug m-0">Paste this into <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">.github/workflows/deploy.yml</code> in your app's repo.</p>
        </div>`
    : "";

  const detailsBody =
    site.type === "static"
      ? `<p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}</p>`
      : `
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">local port:</span> ${escapeHtml(site.target)}</p>
        ${frameworkLabel ? `<p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">framework:</span> ${escapeHtml(frameworkLabel)}</p>` : ""}
        ${statusLine}
        ${commandsBlock}
        ${workflowBlock}`;
```

- [ ] **Step 3: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors in `src/views/html.ts` itself. (`src/routes/sites.ts` may still show the pre-existing, Task-3-scoped errors from Task 1 — that's fine.)

- [ ] **Step 4: Commit**

```bash
git add src/views/html.ts
git commit -m "Show the GitHub Actions workflow on the site detail page"
```

---

### Task 3: Thread hostname/sitesRoot through to `getFrameworkScaffold`'s call sites

**Files:**
- Modify: `src/routes/sites.ts` (two `getFrameworkScaffold` call sites)

**Interfaces:**
- Consumes: `getFrameworkScaffold(framework, port, hostname, sitesRoot)` from Task 1. `renderSiteDetail`'s widened `scaffold` parameter from Task 2.
- Produces: nothing new — this task just satisfies the signature change so the app compiles again.

- [ ] **Step 1: Update the add-site route's call site**

In the `POST /sites` handler, change:

```ts
    } else if (framework) {
      const scaffold = getFrameworkScaffold(framework, port);
      if (scaffold) {
```

to:

```ts
    } else if (framework) {
      const scaffold = getFrameworkScaffold(framework, port, hostname, config.sitesRoot);
      if (scaffold) {
```

- [ ] **Step 2: Update the detail route's call site and pass `deployWorkflow` through**

In the `GET /sites/:hostname` handler, change:

```ts
    const scaffold = site.framework ? getFrameworkScaffold(site.framework, site.target) : null;
    const scaffoldCommands = scaffold ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand } : undefined;
```

to:

```ts
    const scaffold = site.framework ? getFrameworkScaffold(site.framework, site.target, hostname, config.sitesRoot) : null;
    const scaffoldCommands = scaffold
      ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand, deployWorkflow: scaffold.deployWorkflow }
      : undefined;
```

- [ ] **Step 3: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors anywhere.

- [ ] **Step 4: Commit**

```bash
git add src/routes/sites.ts
git commit -m "Pass hostname/sitesRoot to getFrameworkScaffold at both call sites"
```

---

### Task 4: Copy-to-clipboard client wiring

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `#github-workflow-yaml` and `[data-copy-target="github-workflow-yaml"]` from Task 2 — but written generically, so it works for any future `[data-copy-target]` element too.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the generic copy handler**

After the existing `document.querySelectorAll("[data-close-dialog]")...` block, add:

```js

document.querySelectorAll("[data-copy-target]").forEach((button) => {
  const originalLabel = button.textContent;
  button.addEventListener("click", () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    navigator.clipboard.writeText(target.textContent ?? "");
    button.textContent = "Copied!";
    setTimeout(() => {
      button.textContent = originalLabel;
    }, 1500);
  });
});
```

- [ ] **Step 2: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors. (`npm run lint` only runs `eslint src`, which doesn't cover `public/app.js` — pre-existing scope gap, not something to fix here. Read the diff carefully instead.)

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "Add copy-to-clipboard wiring for the deploy workflow block"
```

---

### Task 5: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds, produces `dist/` and updated `public/style.css`.

- [ ] **Step 2: Confirm no leftover 2-argument `getFrameworkScaffold` calls**

Run: `grep -n "getFrameworkScaffold(" src/routes/sites.ts`
Expected: both matches show 4 arguments (`framework/site.framework`, `port/site.target`, `hostname`, `config.sitesRoot` or `sitesRoot`) — no 2-argument call remains.

- [ ] **Step 3: Confirm the workflow block and copy button are wired consistently**

Run: `grep -n "github-workflow-yaml\|data-copy-target\|deployWorkflow" src/views/html.ts src/lib/frameworkScaffold.ts src/routes/sites.ts public/app.js`
Expected: `id="github-workflow-yaml"` and `data-copy-target="github-workflow-yaml"` both appear in `src/views/html.ts` with matching id/target strings; `deployWorkflow` appears in `frameworkScaffold.ts` (defined), `html.ts` (consumed via `scaffold.deployWorkflow`), and `sites.ts` (threaded through); `data-copy-target` appears in `public/app.js`'s generic handler.

- [ ] **Step 4: Hand off for manual QA**

This repo has no automated tests, and the real target environment (Caddy, cloudflared, `/var/www`, Docker, and now GitHub Actions on the self-hosted runner) only exists on `lychee` — per this project's established convention, manual verification in the browser is the user's job after deploy. Leave a note for the user: after this branch is deployed, verify (a) a Next.js-scaffolded reverse-proxy site's detail page shows a "GitHub Actions workflow" block with the correct hostname in the job name and the correct `/var/www/<hostname>/` path in both the rsync target and the `docker compose -f` path; (b) clicking "Copy" actually places the workflow text on the clipboard (paste it somewhere to confirm) and the button briefly shows "Copied!"; (c) a static site's and a plain reverse-proxy site's (no framework) detail pages show no workflow block at all; (d) pasting the copied YAML into a real repo as `.github/workflows/deploy.yml` and pushing to `main` (or using `workflow_dispatch`) actually runs successfully against the self-hosted runner and deploys the app — this is the one part of this feature that can't be verified by reading code, since it depends on GitHub Actions infrastructure entirely outside lyly-admin.
