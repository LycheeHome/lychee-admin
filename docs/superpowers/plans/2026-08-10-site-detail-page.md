# Site Detail Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a site card navigates to `GET /sites/<hostname>`, a dedicated detail page showing the site's path/port, framework (if any), a live "is anything listening on this port" status check for reverse-proxy sites, and — for Next.js-scaffolded sites — the build/run commands baked into the generated Dockerfile. The Remove action moves from the card to this page.

**Architecture:** Site cards become plain `<a>` links (no more nested delete form). A new `computeFilesPath(site, sitesRoot)` helper in `caddyfile.ts` replaces the duplicated files-path ternary that currently exists independently in both `sites.ts` and `html.ts`. A new `checkPortOpen(port)` helper does a raw TCP connect (no shell-out, no new privileges) to answer the "is it deployed" question. `frameworkScaffold.ts`'s `Scaffold` type gains `buildCommand`/`runCommand` fields, generated from the same constants that get interpolated into the Dockerfile template, so the detail page can never show a command that doesn't match what's actually in the generated file.

**Tech Stack:** Same as the rest of the app — Express/TypeScript backend, server-rendered HTML + vanilla JS frontend, Tailwind utility classes, Node's built-in `net` module for the TCP check. No new dependencies.

## Global Constraints

- No automated test framework exists in this repo. Verification is `npm run typecheck`, `npm run build`, and `npm run lint`. For non-trivial pure logic (the TCP check, the Dockerfile command interpolation), also do a manual smoke check via `npx tsx -e "..."`.
- Do not run `npm run dev` — verify with typecheck/build/lint and code reading, per this project's established convention.
- No Docker-backed status check — the TCP connect approach was deliberately chosen over adding sudo/group privileges for `docker compose ps` or similar. Do not add any Docker invocation anywhere in this plan.
- `computeFilesPath` always returns `sitesRoot/hostname` (via `path.posix.join`), never a value derived from the Caddyfile's `root *` directive or any other site-specific data — this is what keeps the confirm-dialog's displayed path and the actually-deleted path identical for every site type.
- Follow the existing Tailwind utility-class style — no new CSS files, no class abstraction, no new npm dependencies.
- Preserve the existing safety-critical add/remove mutation logic (backup → edit → validate → reload → restart, and the validate/reload rollback mechanism in both `POST /sites` and `POST /sites/:hostname/delete`) exactly as-is — nothing in this plan touches that logic, only the files-path computation feeding into the removal flow's decision of whether to offer file deletion.

---

### Task 1: Shared `computeFilesPath` helper

**Files:**
- Modify: `src/lib/caddyfile.ts` (add an import and one new exported function; no existing function bodies change)

**Interfaces:**
- Produces: `computeFilesPath(site: Site, sitesRoot: string): string | null` — `sitesRoot/hostname` for static sites and framework-scaffolded reverse-proxy sites, `null` otherwise. Pure refactor: this is the exact logic already duplicated in `src/routes/sites.ts`'s `/delete` handler and `src/views/html.ts`'s card template (both already fixed, post-final-review, to use `sitesRoot/hostname` rather than `site.target` for static sites) — no behavior change, just consolidation into one place. Later tasks replace both call sites with this function.

- [ ] **Step 1: Add the `path` import**

At the top of `src/lib/caddyfile.ts`, change:

```ts
export type SiteType = "static" | "reverse-proxy";
```

to:

```ts
import path from "node:path";

export type SiteType = "static" | "reverse-proxy";
```

- [ ] **Step 2: Add `computeFilesPath`**

At the end of `src/lib/caddyfile.ts`, after the existing `hostnameExists` function, add:

```ts

/**
 * Where this site's on-disk files live, if anywhere — static sites always
 * have one; reverse-proxy sites only do when scaffolded with a framework.
 * Always sitesRoot/hostname, the same path createSiteDirectory() and
 * /delete-files use — never derived from a Caddyfile directive like
 * `root *`, so a hand-edited block can't make the displayed path diverge
 * from the path that actually gets deleted.
 */
export function computeFilesPath(site: Site, sitesRoot: string): string | null {
  if (site.type === "static") return path.posix.join(sitesRoot, site.hostname);
  if (site.type === "reverse-proxy" && site.framework) return path.posix.join(sitesRoot, site.hostname);
  return null;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual smoke check**

Run:

```bash
npx tsx -e "
import { computeFilesPath } from './src/lib/caddyfile';
console.log(computeFilesPath({ hostname: 'blog.lyly.dev', type: 'static', target: '/anything' }, '/var/www'));
console.log(computeFilesPath({ hostname: 'app.lyly.dev', type: 'reverse-proxy', target: '3000', framework: 'nextjs' }, '/var/www'));
console.log(computeFilesPath({ hostname: 'api.lyly.dev', type: 'reverse-proxy', target: '4000' }, '/var/www'));
"
```

Expected output: `/var/www/blog.lyly.dev`, then `/var/www/app.lyly.dev`, then `null`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/caddyfile.ts
git commit -m "Add computeFilesPath helper to caddyfile.ts"
```

---

### Task 2: Expose build/run commands from the framework scaffold generator

**Files:**
- Modify: `src/lib/frameworkScaffold.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `Scaffold` gains `buildCommand: string` and `runCommand: string`. `getFrameworkScaffold`'s public signature (`(framework: string, port: string) => Scaffold | null`) is unchanged. The Dockerfile's `RUN`/`CMD` lines are now generated from these same two values, so there is exactly one source of truth for what the detail page will display and what actually runs during `docker compose up -d --build`.

- [ ] **Step 1: Replace the whole file**

Replace the entire contents of `src/lib/frameworkScaffold.ts` with:

```ts
export interface Scaffold {
  dockerfile: string;
  compose: string;
  dockerignore: string;
  buildCommand: string;
  runCommand: string;
}

const NEXTJS_BUILD_COMMAND = "npm run build";
const NEXTJS_RUN_COMMAND = "npm start";

// Docker's exec-form CMD needs a JSON array (e.g. ["npm","start"]) rather
// than a shell string — this only needs to handle simple space-separated
// commands like the ones above, not full shell syntax.
function toExecForm(command: string): string {
  return JSON.stringify(command.split(" "));
}

function nextjsDockerfile(buildCommand: string, runCommand: string): string {
  return `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN ${buildCommand}

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js* /app/next.config.mjs* ./
EXPOSE 3000
CMD ${toExecForm(runCommand)}
`;
}

const NEXTJS_DOCKERIGNORE = `node_modules
.next
Dockerfile
docker-compose.yml
.git
`;

function nextjsCompose(port: string): string {
  return `services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "127.0.0.1:${port}:3000"
`;
}

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

- [ ] **Step 2: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

Run:

```bash
npx tsx -e "
import { getFrameworkScaffold } from './src/lib/frameworkScaffold';
const scaffold = getFrameworkScaffold('nextjs', '3000');
console.log(scaffold.buildCommand, '|', scaffold.runCommand);
console.log(scaffold.dockerfile.includes('RUN npm run build'));
console.log(scaffold.dockerfile.includes('CMD [\"npm\",\"start\"]'));
"
```

Expected: `npm run build | npm start`, then `true`, then `true`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/frameworkScaffold.ts
git commit -m "Expose build/run commands as structured fields on Scaffold"
```

---

### Task 3: Port status check

**Files:**
- Create: `src/lib/portStatus.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `checkPortOpen(port: number, timeoutMs?: number): Promise<boolean>`, `true` if a TCP connection to `127.0.0.1:<port>` succeeds within `timeoutMs` (default `500`), `false` on timeout or connection error (including `ECONNREFUSED`, meaning nothing is listening).

- [ ] **Step 1: Create the file**

```ts
import net from "node:net";

export function checkPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
```

- [ ] **Step 2: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

Run (uses Node's own `nc`-equivalent via a throwaway listener, then a definitely-closed port):

```bash
npx tsx -e "
import net from 'node:net';
import { checkPortOpen } from './src/lib/portStatus';

const server = net.createServer().listen(58234, '127.0.0.1', async () => {
  console.log('listening port ->', await checkPortOpen(58234));
  console.log('closed port ->', await checkPortOpen(58235));
  server.close();
});
"
```

Expected: `listening port -> true`, then `closed port -> false`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/portStatus.ts
git commit -m "Add TCP-based port status check"
```

---

### Task 4: Site cards become links; add the detail and not-found page renderers

**Files:**
- Modify: `src/views/html.ts` (imports, `renderSiteList`'s card template and its dialogs, two new exported functions)

**Interfaces:**
- Consumes: `computeFilesPath` from Task 1.
- Produces: `renderSiteList`'s cards are now `<a href="/sites/<hostname>">` elements with no nested form — the confirm-remove-dialog is removed from `renderSiteList`'s output entirely (it moves to the detail page). New exports: `renderSiteDetail(site: Site, sitesRoot: string, respondingOnPort?: boolean, scaffold?: { buildCommand: string; runCommand: string }): string` and `renderSiteNotFound(hostname: string): string`. The detail page's confirm-remove-dialog has exactly two elements later tasks need: `#confirm-remove-delete-files` (checkbox, present only when the site has a files path) and `#confirm-remove-submit` (carries `data-hostname="<hostname>"`). The "Remove site" button uses the existing generic `data-open-dialog="confirm-remove-dialog"` convention — no new open-handler needed.

- [ ] **Step 1: Update the import**

Change:

```ts
import path from "node:path";
import type { Site } from "../lib/caddyfile";
```

to:

```ts
import { computeFilesPath, type Site } from "../lib/caddyfile";
```

(`path` is no longer used directly in this file once the card template stops computing a files path — see Step 2. `computeFilesPath` is used by `renderSiteDetail`, added in Step 4.)

- [ ] **Step 2: Simplify the card template to a plain link, and remove `renderSiteList`'s confirm-remove-dialog**

`renderSiteList` is currently the last thing in the file — its closing `}` is the final line. Replace the whole function definition (everything from `export function renderSiteList(` to the end of the file) with:

```ts
export function renderSiteList(
  sites: Site[],
  domain: string,
  sitesRoot: string,
  error?: string,
  portOwners: Record<string, string> = {},
): string {
  const cards = sites
    .map((site) => {
      const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;

      return `
      <a href="/sites/${encodeURIComponent(site.hostname)}" class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3.5 motion-safe:transition-colors motion-safe:duration-150 hover:border-rose-800/70 no-underline">
        <div class="flex items-start justify-between gap-2">
          <p class="font-display text-base leading-relaxed text-stone-50 m-0 break-words">${escapeHtml(site.hostname)}</p>
          <span class="inline-block shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
            site.type === "static"
              ? "border-stone-600 text-stone-50 bg-stone-700"
              : "border-transparent text-rose-300 bg-rose-950"
          }">${site.type === "static" ? "static" : "proxy"}</span>
        </div>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words">${
          site.type === "static"
            ? `<span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}`
            : `<span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">localhost:</span>${escapeHtml(site.target)}${frameworkLabel ? ` · ${escapeHtml(frameworkLabel)}` : ""}`
        }</p>
      </a>`;
    })
    .join("");

  return layout(
    "Sites",
    `
    ${error ? `<p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3 max-w-[1080px] mx-auto mb-5">${escapeHtml(error)}</p>` : ""}
    <section>
      <div class="flex items-center justify-between gap-4 mb-5">
        <h2 class="font-mono text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0">Existing sites</h2>
        <button type="button" class="${BUTTON_PRIMARY} font-mono" data-open-dialog="add-site-dialog">${icon("plus")}Add site</button>
      </div>
      <div class="sites-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        ${cards || `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`}
      </div>
    </section>

    <dialog id="add-site-dialog" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(460px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 class="font-mono text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Add a site</h2>
      <form id="add-site-form" method="post" action="/sites" class="flex flex-col gap-4">
        <label class="${FORM_LABEL}">
          Hostname
          <input type="text" name="hostname" placeholder="blog.${escapeHtml(domain)}" required class="${INPUT}" />
        </label>

        <fieldset class="border-0 p-0 m-0 flex flex-col gap-2.5">
          <legend class="font-mono text-[0.7rem] uppercase tracking-[0.06em] text-stone-400 px-0 mb-2">Type</legend>

          <label class="flex flex-col gap-1 rounded-md border border-stone-600 bg-stone-700/50 px-3 py-2.5 cursor-pointer transition-colors hover:bg-stone-700/80 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500">
            <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
              <input type="radio" name="type" value="static" checked class="accent-stone-300" />
              Static site
            </span>
            <span class="text-stone-400 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lyly-admin creates for you with a placeholder page — no process to run yourself.</span>
          </label>

          <label class="flex flex-col gap-1 rounded-md border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer transition-colors hover:bg-stone-800/40 has-[:checked]:bg-rose-950/50 has-[:checked]:border-rose-800/70">
            <span class="flex items-center gap-2 text-stone-50 text-[0.9rem] font-semibold">
              <input type="radio" name="type" value="reverse-proxy" class="accent-rose-400" />
              Reverse proxy
            </span>
            <span class="text-stone-400 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lyly-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
          </label>
        </fieldset>

        <div class="port-input hidden flex-col gap-3 border-l-2 border-l-rose-800/70 pl-3 ml-1">
          <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
            Local port (reverse proxy only)
            <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" />
            <span class="port-error hidden text-red-300 text-[0.8rem]"></span>
          </label>
          <label class="flex flex-col gap-1.5 text-[0.85rem] text-stone-400">
            Framework (optional)
            <select name="framework" class="${INPUT}" id="framework-field">
              <option value="none">None</option>
              <option value="nextjs">Next.js — generates a Dockerfile + docker-compose.yml</option>
            </select>
          </label>
        </div>
        <script type="application/json" id="port-owners-data">${JSON.stringify(portOwners)}</script>

        <p id="add-site-error" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

        <div class="flex justify-end gap-2.5">
          <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="add-site-dialog">Cancel</button>
          <button type="submit" id="add-site-submit" class="${BUTTON_PRIMARY}">Add site</button>
        </div>
      </form>
    </dialog>
    `,
  );
}
```

(The only change from the current file within this block, besides the card template, is that the `confirm-remove-dialog` `<dialog>` block that used to follow `</dialog>` after `add-site-dialog` is now gone — deleted entirely, not moved within this function.)

- [ ] **Step 3: Add `renderSiteDetail` and `renderSiteNotFound`**

At the end of `src/views/html.ts`, after the `renderSiteList` function, add:

```ts

export function renderSiteDetail(
  site: Site,
  sitesRoot: string,
  respondingOnPort?: boolean,
  scaffold?: { buildCommand: string; runCommand: string },
): string {
  const filesPath = computeFilesPath(site, sitesRoot);
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;

  const statusLine =
    respondingOnPort === undefined
      ? ""
      : respondingOnPort
        ? `<p class="text-rose-300 text-[0.85rem] leading-relaxed m-0">&#9679; Responding on localhost:${escapeHtml(site.target)}</p>`
        : `<p class="text-stone-400 text-[0.85rem] leading-relaxed m-0">&#9679; Not responding on localhost:${escapeHtml(site.target)}<br />
        <span class="text-[0.75rem]">Run <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">docker compose up -d --build</code> in <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(filesPath ?? "")}/</code> to deploy.</span></p>`;

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

  const deleteFilesSection = filesPath
    ? `
      <div class="flex flex-col gap-2 mb-5">
        <label class="flex flex-row items-center text-[0.8rem] text-stone-400 gap-1.5">
          <input type="checkbox" id="confirm-remove-delete-files" />
          Also delete files at <span class="font-mono">${escapeHtml(filesPath)}</span>
        </label>
        ${
          site.framework
            ? `<p class="text-[0.75rem] text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2 leading-snug m-0">
          If a Docker container is running from this directory, stop it first with <code class="font-mono">docker compose down</code> — deleting the files won't stop it.
        </p>`
            : ""
        }
      </div>`
    : "";

  return layout(
    site.hostname,
    `
    <div class="max-w-[640px] mx-auto flex flex-col gap-5 w-full">
      <p class="m-0"><a href="/" class="text-rose-400 no-underline font-mono text-[0.85rem] hover:underline">&larr; Back to sites</a></p>

      <div class="flex items-start justify-between gap-2">
        <h2 class="font-display text-xl leading-relaxed text-stone-50 m-0 break-words">${escapeHtml(site.hostname)}</h2>
        <span class="inline-block shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
          site.type === "static"
            ? "border-stone-600 text-stone-50 bg-stone-700"
            : "border-transparent text-rose-300 bg-rose-950"
        }">${site.type === "static" ? "static" : "proxy"}</span>
      </div>

      <section class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3">
        ${detailsBody}
      </section>

      <button type="button" class="${BUTTON_DANGER} self-start" data-open-dialog="confirm-remove-dialog">${icon("trash")}Remove site</button>
    </div>

    <dialog id="confirm-remove-dialog" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 class="font-mono text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
      <p class="m-0 mb-4 leading-relaxed">Remove <strong>${escapeHtml(site.hostname)}</strong>? This removes it from Caddy and the tunnel config immediately.</p>
      ${deleteFilesSection}
      <div class="flex justify-end gap-2.5">
        <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
        <button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove</button>
      </div>
    </dialog>
    `,
  );
}

export function renderSiteNotFound(hostname: string): string {
  return layout(
    "Site not found",
    `
    <div class="max-w-[640px] mx-auto flex flex-col gap-4">
      <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">No managed site found for "${escapeHtml(hostname)}".</p>
      <p class="m-0"><a href="/" class="text-rose-400 no-underline font-mono text-[0.85rem] hover:underline">&larr; Back to sites</a></p>
    </div>
    `,
  );
}
```

- [ ] **Step 4: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors. (`npm run build`'s `tsc` step will fail loudly if `src/routes/sites.ts` no longer type-matches `renderSiteList`'s signature or references the now-removed confirm-remove-dialog data attributes from the old card markup — that's expected until Task 5 lands; if this specific task's build fails for a reason unrelated to `src/routes/sites.ts`, investigate before moving on.)

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts
git commit -m "Turn site cards into links and add the site detail page renderer"
```

---

### Task 5: Wire up `GET /sites/:hostname` and simplify the delete route

**Files:**
- Modify: `src/routes/sites.ts` (imports; the `/delete` handler's `filesPath` computation; a new `GET /sites/:hostname` route)

**Interfaces:**
- Consumes: `computeFilesPath` from Task 1, `checkPortOpen` from Task 3, `renderSiteDetail`/`renderSiteNotFound` from Task 4.
- Produces: `GET /sites/:hostname` — `200` with the detail page for a known managed site, `404` with the not-found page otherwise. No response-shape changes to any existing route.

- [ ] **Step 1: Update imports**

Change:

```ts
import { getFrameworkScaffold } from "../lib/frameworkScaffold";
import { logAction } from "../lib/logger";
import { renderSiteList } from "../views/html";
```

to:

```ts
import { getFrameworkScaffold } from "../lib/frameworkScaffold";
import { logAction } from "../lib/logger";
import { checkPortOpen } from "../lib/portStatus";
import { renderSiteDetail, renderSiteList, renderSiteNotFound } from "../views/html";
```

- [ ] **Step 2: Simplify the `/delete` handler's `filesPath` computation**

Change:

```ts
    // Site file deletion is a separate, explicit request — never triggered
    // by the same request that removes the site from Caddy/tunnel config.
    // filesPath covers both static sites and Next.js-scaffolded
    // reverse-proxy sites. Always computed as sitesRoot/hostname — the same
    // path /delete-files actually removes — rather than trusting
    // existingSite.target for static sites, since a hand-edited Caddyfile
    // block could root a *.lyly.dev static site somewhere else, which would
    // otherwise make the confirm dialog show a different path than the one
    // that actually gets deleted.
    const filesPath =
      existingSite?.type === "static" || (existingSite?.type === "reverse-proxy" && existingSite.framework)
        ? path.posix.join(config.sitesRoot, hostname)
        : undefined;

    if (wantsFileDelete && filesPath) {
```

to:

```ts
    // Site file deletion is a separate, explicit request — never triggered
    // by the same request that removes the site from Caddy/tunnel config.
    const filesPath = existingSite ? caddyfile.computeFilesPath(existingSite, config.sitesRoot) : null;

    if (wantsFileDelete && filesPath) {
```

- [ ] **Step 3: Add the `GET /sites/:hostname` route**

After the `GET /` route handler (right before `sitesRouter.post("/sites", async (req, res) => {`), add:

```ts
sitesRouter.get("/sites/:hostname", async (req, res) => {
  const hostname = req.params.hostname.toLowerCase();
  const content = fs.readFileSync(config.caddyfilePath, "utf8");
  const site = caddyfile.parseSites(content).find((s) => s.hostname === hostname && isManagedHostname(s.hostname));

  if (!site) {
    res.status(404).send(renderSiteNotFound(hostname));
    return;
  }

  if (site.type === "static") {
    res.send(renderSiteDetail(site, config.sitesRoot));
    return;
  }

  const respondingOnPort = await checkPortOpen(Number(site.target));
  const scaffold = site.framework ? getFrameworkScaffold(site.framework, site.target) : null;
  const scaffoldCommands = scaffold ? { buildCommand: scaffold.buildCommand, runCommand: scaffold.runCommand } : undefined;

  res.send(renderSiteDetail(site, config.sitesRoot, respondingOnPort, scaffoldCommands));
});

```

- [ ] **Step 4: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sites.ts
git commit -m "Add GET /sites/:hostname and simplify the delete route's files-path logic"
```

---

### Task 6: Client-side wiring for the detail page's remove flow

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `#confirm-remove-submit[data-hostname]`, `#confirm-remove-delete-files` from Task 4's `renderSiteDetail`. The generic `[data-open-dialog]`/`[data-close-dialog]` handlers already in this file (untouched) now also cover the detail page's "Remove site" button and dialog cancel button — no new code needed for those.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Remove the now-dead per-card delete machinery**

Delete these declarations (no longer meaningful — cards have no delete form, and the confirm-remove-dialog no longer has these ids since it's fully server-rendered per-site):

```js
const confirmRemoveHostname = document.getElementById("confirm-remove-hostname");
const confirmRemoveDeleteFilesSection = document.getElementById("confirm-remove-delete-files-section");
const confirmRemoveDockerWarning = document.getElementById("confirm-remove-docker-warning");
const confirmRemovePath = document.getElementById("confirm-remove-path");
```

Keep `confirmRemoveDialog` and `confirmRemoveDeleteFilesCheckbox` — both still exist and are still needed.

Also delete `pendingDeleteForm` (the `let pendingDeleteForm = null;` declaration) and the entire `wireDeleteForms()` function, its `wireDeleteForms();` call site, and the entire `removeCard()` function (including its `portOwners`-pruning loop) — none of these apply anymore now that removal always ends in a full navigation instead of in-place DOM removal.

- [ ] **Step 2: Remove the now-invalid call inside `refreshSitesGrid`**

Change:

```js
async function refreshSitesGrid() {
  const response = await fetch("/");
  const html = await response.text();
  const newGrid = new DOMParser().parseFromString(html, "text/html").querySelector(".sites-grid");
  const currentGrid = document.querySelector(".sites-grid");
  if (!newGrid || !currentGrid) return;
  currentGrid.innerHTML = newGrid.innerHTML;
  wireDeleteForms();
}
```

to:

```js
async function refreshSitesGrid() {
  const response = await fetch("/");
  const html = await response.text();
  const newGrid = new DOMParser().parseFromString(html, "text/html").querySelector(".sites-grid");
  const currentGrid = document.querySelector(".sites-grid");
  if (!newGrid || !currentGrid) return;
  currentGrid.innerHTML = newGrid.innerHTML;
}
```

(Cards are plain links now — nothing needs re-wiring after the grid's HTML is swapped in.)

- [ ] **Step 3: Rewrite the `confirm-remove-submit` handler**

Replace the entire handler:

```js
document.getElementById("confirm-remove-submit")?.addEventListener("click", async () => {
  if (deleteInFlight) return;
  confirmRemoveDialog?.close();
  const form = pendingDeleteForm;
  pendingDeleteForm = null;
  if (!form) return;

  const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
  const deleteFilesChecked = confirmRemoveDeleteFilesCheckbox?.checked ?? false;
  const card = form.closest("article");

  deleteInFlight = true;
  showBanner(`Removing ${hostname}…`, "info");
  try {
    const response = await fetch(form.getAttribute("action"), {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to remove site");

    if (!result.needsFileConfirm) {
      removeCard(card, hostname);
      showBanner(`Removed ${hostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
      return;
    }

    // Site removal already succeeded at this point, so the card comes out
    // of the DOM regardless of whether the follow-up file deletion below
    // succeeds — it's a separate request specifically so a failure here
    // can't be confused with the (already-completed) config removal.
    const filesResponse = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const filesResult = await filesResponse.json();
    removeCard(card, hostname);
    if (!filesResponse.ok) {
      showBanner(`Removed ${hostname}, but failed to delete its files: ${filesResult.error ?? "unknown error"}`, "error");
      return;
    }
    showBanner(`Removed ${hostname} and deleted its files. Remember to remove the DNS record in Cloudflare manually.`, "success");
  } catch (error) {
    showBanner(error.message, "error");
  } finally {
    deleteInFlight = false;
  }
});
```

with:

```js
document.getElementById("confirm-remove-submit")?.addEventListener("click", async (event) => {
  if (deleteInFlight) return;
  confirmRemoveDialog?.close();
  const hostname = event.currentTarget.dataset.hostname;
  if (!hostname) return;

  const deleteFilesChecked = confirmRemoveDeleteFilesCheckbox?.checked ?? false;

  deleteInFlight = true;
  showBanner(`Removing ${hostname}…`, "info");
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete`, {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to remove site");

    if (!result.needsFileConfirm) {
      window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
      return;
    }

    // Site removal already succeeded at this point — files deletion is a
    // separate request specifically so a failure here can't be confused
    // with the (already-completed) config removal.
    const filesResponse = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const filesResult = await filesResponse.json();
    if (!filesResponse.ok) {
      showBanner(`Removed ${hostname}, but failed to delete its files: ${filesResult.error ?? "unknown error"}`, "error");
      return;
    }
    window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
  } catch (error) {
    showBanner(error.message, "error");
  } finally {
    deleteInFlight = false;
  }
});
```

- [ ] **Step 4: Pick up the post-delete banner on the list page**

Immediately after the `flashBannerClose?.addEventListener("click", hideBanner);` line, add:

```js

const removedHostname = new URLSearchParams(window.location.search).get("removed");
if (removedHostname) {
  showBanner(`Removed ${removedHostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
  history.replaceState(null, "", "/");
}
```

- [ ] **Step 5: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors. (`npm run lint` only runs `eslint src`, which doesn't cover `public/app.js` — pre-existing scope gap, not something to fix here. Read the diff carefully instead.)

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "Move the remove flow's client wiring to the site detail page"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds, produces `dist/` and updated `public/style.css`.

- [ ] **Step 2: Confirm no leftover references to removed markup/functions**

Run:

```bash
grep -rn "delete-form\|delete-trigger\|wireDeleteForms\|removeCard\|pendingDeleteForm\|confirm-remove-hostname\|confirm-remove-path\|confirm-remove-delete-files-section\|confirm-remove-docker-warning" src/ public/
```

Expected: no output.

- [ ] **Step 3: Confirm the card markup and detail-page markup are internally consistent**

Run:

```bash
grep -n "sites-grid\|renderSiteDetail\|renderSiteNotFound\|data-open-dialog=\"confirm-remove-dialog\"\|data-hostname" src/views/html.ts
```

Expected: shows the `sites-grid` div in `renderSiteList`, both new function definitions, the `data-open-dialog="confirm-remove-dialog"` Remove-site button, and the `data-hostname` attribute on `#confirm-remove-submit` — all inside `renderSiteDetail`, none inside `renderSiteList`.

- [ ] **Step 4: Hand off for manual QA**

This repo has no automated tests, and the real target environment (Caddy, cloudflared, `/var/www`, Docker) only exists on `lychee` — per this project's established convention, manual verification in the browser is the user's job after deploy, not something done by running `npm run dev` locally. Leave a note for the user: after this branch is deployed, verify (a) clicking a site card navigates to its detail page instead of doing anything else; (b) a static site's detail page shows just its path, with no status/commands section; (c) a plain reverse-proxy site (no framework) shows its port and a responding/not-responding status line, but no framework label and no build/run commands; (d) a Next.js-scaffolded site shows port, framework, status, and both commands, and the status line's "Not responding" message only appears before `docker compose up -d --build` has been run in that directory, flipping to "Responding" after; (e) removing a site from its detail page navigates back to `/` with a visible, dismissible success banner, and the removed site's card is actually gone from the list; (f) the "also delete files" checkbox and Docker warning appear/don't appear on the confirm dialog exactly as before (checkbox for static and Next.js-scaffolded sites, warning only for the latter); (g) visiting `/sites/<some-made-up-hostname>` shows the "Site not found" page with a working link back to `/`.
