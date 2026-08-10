# Next.js Framework Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding a reverse-proxy site lets the user optionally pick "Next.js" as a framework, which generates a Dockerfile + docker-compose.yml scaffold in the site's directory, persists the choice so it shows on the site's card, and extends the remove-site "also delete files" flow to cover these directories with a Docker-specific warning.

**Architecture:** The framework choice is persisted as a plain Caddy comment inside the reverse-proxy block (`# lyly-admin-framework: nextjs`), so it rides along with every existing backup/validate/reload/rollback mechanism already built for the Caddyfile — no new file or data store. Scaffold file generation is a pure function module (`(framework, port) -> { dockerfile, compose }`) with no knowledge of routes or config. The remove-site flow's existing static-only "also delete files" checkbox becomes a general "does this site have a files path" check that covers both static sites and Next.js-scaffolded reverse-proxy sites uniformly.

**Tech Stack:** Same as the rest of the app — Express/TypeScript backend, server-rendered HTML + vanilla JS frontend, Tailwind utility classes, `fs`/`path` from Node, no new dependencies.

## Global Constraints

- No automated test framework exists in this repo (no test script in `package.json`). Verification is `npm run typecheck`, `npm run build`, and `npm run lint`. Where a task's logic is non-trivial (regex parsing, string templating), also do a quick manual smoke check via `npx tsx -e "..."` — this repo has no test runner, but `tsx` (already a devDependency, used by `npm run dev`) can execute a one-off script against the real TS source without touching the filesystem or requiring `MOCK_SYSTEM`.
- Do not run `npm run dev` — this project's convention (established across prior work) is that the user verifies UI changes themselves in the browser after deploy; agents verify with typecheck/build/lint and code-reading only.
- Follow the existing Tailwind utility-class style used throughout `src/views/html.ts` and `public/app.js` — no new CSS files, no class abstraction, no new npm dependencies.
- The framework comment (`# lyly-admin-framework: <value>`) must live **inside** the Caddyfile block body (between the braces), not before the block header — this is what lets `removeSite`'s existing whole-block-replacement logic delete it for free, with no changes to `removeSite` itself.
- Scaffold file writes (Dockerfile/docker-compose.yml) are **not** covered by the add-site validate/reload rollback logic — this matches the existing, deliberate precedent for the static site's placeholder `index.html`, not a new gap.
- No new sudo scope: scaffold files are written via plain `fs.writeFileSync` into the already-group-writable `/var/www/<hostname>/` directory (created via the existing `createSiteDirectory()`/`lyly-admin-create-site-dir.sh`), never through `writeManagedConfig` (which stays pinned to exactly the Caddyfile and tunnel config per `deploy/sudoers.example`).
- lyly-admin never invokes Docker itself (no `docker` or `docker compose` shell-outs anywhere in this plan) — it only writes files. The user runs `docker compose up -d --build` themselves.

---

### Task 1: Persist framework choice in the Caddyfile parser

**Files:**
- Modify: `src/lib/caddyfile.ts` (whole file is under 102 lines; changes touch the `Site` interface, `parseSites`, and `renderReverseProxyBlock`/`appendSite`)

**Interfaces:**
- Produces: `Site` gains `framework?: string`. `parseSites(content: string): Site[]` populates `framework` for reverse-proxy blocks containing a `# lyly-admin-framework: <value>` comment. `appendSite(content, { hostname, type, target, framework? })` accepts an optional `framework` and writes the comment into the generated block when present. `removeSite` and `hostnameExists` are unchanged.

- [ ] **Step 1: Update the `Site` interface**

In `src/lib/caddyfile.ts`, change:

```ts
export interface Site {
  hostname: string;
  type: SiteType;
  /** local path for static sites, local port for reverse proxies */
  target: string;
}
```

to:

```ts
export interface Site {
  hostname: string;
  type: SiteType;
  /** local path for static sites, local port for reverse proxies */
  target: string;
  /** only set for reverse-proxy sites scaffolded with a known framework, e.g. "nextjs" */
  framework?: string;
}
```

- [ ] **Step 2: Extract the framework comment in `parseSites`**

Change:

```ts
export function parseSites(content: string): Site[] {
  return splitBlocks(content).map((block) => {
    const proxyMatch = /reverse_proxy\s+localhost:(\d+)/.exec(block.body);
    if (proxyMatch) {
      return { hostname: block.hostname, type: "reverse-proxy", target: proxyMatch[1] };
    }

    const rootMatch = /root\s+\*\s+(\S+)/.exec(block.body);
    return { hostname: block.hostname, type: "static", target: rootMatch?.[1] ?? "" };
  });
}
```

to:

```ts
export function parseSites(content: string): Site[] {
  return splitBlocks(content).map((block) => {
    const proxyMatch = /reverse_proxy\s+localhost:(\d+)/.exec(block.body);
    if (proxyMatch) {
      const frameworkMatch = /#\s*lyly-admin-framework:\s*(\S+)/.exec(block.body);
      return {
        hostname: block.hostname,
        type: "reverse-proxy",
        target: proxyMatch[1],
        ...(frameworkMatch ? { framework: frameworkMatch[1] } : {}),
      };
    }

    const rootMatch = /root\s+\*\s+(\S+)/.exec(block.body);
    return { hostname: block.hostname, type: "static", target: rootMatch?.[1] ?? "" };
  });
}
```

- [ ] **Step 3: Emit the comment in `renderReverseProxyBlock`, and thread `framework` through `appendSite`**

Change:

```ts
function renderReverseProxyBlock(hostname: string, port: string): string {
  return `http://${hostname} {\n\treverse_proxy localhost:${port}\n}\n`;
}

export function appendSite(
  content: string,
  site: { hostname: string; type: SiteType; target: string },
): string {
  const block =
    site.type === "static"
      ? renderStaticBlock(site.hostname, site.target)
      : renderReverseProxyBlock(site.hostname, site.target);

  const trimmed = content.trimEnd();
  return `${trimmed}\n\n${block}`.trimEnd() + "\n";
}
```

to:

```ts
function renderReverseProxyBlock(hostname: string, port: string, framework?: string): string {
  const frameworkComment = framework ? `\t# lyly-admin-framework: ${framework}\n` : "";
  return `http://${hostname} {\n${frameworkComment}\treverse_proxy localhost:${port}\n}\n`;
}

export function appendSite(
  content: string,
  site: { hostname: string; type: SiteType; target: string; framework?: string },
): string {
  const block =
    site.type === "static"
      ? renderStaticBlock(site.hostname, site.target)
      : renderReverseProxyBlock(site.hostname, site.target, site.framework);

  const trimmed = content.trimEnd();
  return `${trimmed}\n\n${block}`.trimEnd() + "\n";
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual smoke check of the parse/append round-trip**

Run:

```bash
npx tsx -e "
import { appendSite, parseSites } from './src/lib/caddyfile';
let content = 'http://existing.lyly.dev {\n\troot * /var/www/existing.lyly.dev\n\tfile_server\n}\n';
content = appendSite(content, { hostname: 'blog.lyly.dev', type: 'reverse-proxy', target: '3000', framework: 'nextjs' });
content = appendSite(content, { hostname: 'api.lyly.dev', type: 'reverse-proxy', target: '4000' });
console.log(content);
console.log(JSON.stringify(parseSites(content), null, 2));
"
```

Expected output includes the rendered Caddyfile with a `# lyly-admin-framework: nextjs` line inside `blog.lyly.dev`'s block only (not `api.lyly.dev`'s), and the parsed JSON shows:
```json
{ "hostname": "blog.lyly.dev", "type": "reverse-proxy", "target": "3000", "framework": "nextjs" }
```
for the first site, and no `framework` key at all for `api.lyly.dev` or `existing.lyly.dev`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/caddyfile.ts
git commit -m "Persist reverse-proxy framework choice as a Caddyfile comment"
```

---

### Task 2: Framework scaffold file generator

**Files:**
- Create: `src/lib/frameworkScaffold.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `getFrameworkScaffold(framework: string, port: string): { dockerfile: string; compose: string } | null` — returns `null` for any `framework` other than `"nextjs"`.

- [ ] **Step 1: Create the file**

```ts
export interface Scaffold {
  dockerfile: string;
  compose: string;
}

const NEXTJS_DOCKERFILE = `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
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
  return { dockerfile: NEXTJS_DOCKERFILE, compose: nextjsCompose(port) };
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke check**

Run:

```bash
npx tsx -e "
import { getFrameworkScaffold } from './src/lib/frameworkScaffold';
console.log(getFrameworkScaffold('nextjs', '3000'));
console.log(getFrameworkScaffold('none', '3000'));
"
```

Expected: first call prints an object with `dockerfile` (starting with `FROM node:20-alpine AS deps`) and `compose` (containing `127.0.0.1:3000:3000`); second call prints `null`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/frameworkScaffold.ts
git commit -m "Add Dockerfile/docker-compose scaffold generator for Next.js"
```

---

### Task 3: Wire framework selection into the add-site route

**Files:**
- Modify: `src/routes/sites.ts` (the `POST /sites` handler, roughly lines 63-170; imports at the top)

**Interfaces:**
- Consumes: `caddyfile.appendSite(content, { hostname, type, target, framework? })` from Task 1. `getFrameworkScaffold(framework, port): { dockerfile, compose } | null` from Task 2.
- Produces: `POST /sites`'s success JSON response gains a `framework` field (`"nextjs"` or `"none"`), consumed by Task 6's client code.

- [ ] **Step 1: Import `getFrameworkScaffold`**

Add to the top of `src/routes/sites.ts`, alongside the existing imports:

```ts
import { getFrameworkScaffold } from "../lib/frameworkScaffold";
```

- [ ] **Step 2: Read and normalize the `framework` field**

In the `POST /sites` handler, change:

```ts
sitesRouter.post("/sites", async (req, res) => {
  const hostname = String(req.body?.hostname ?? "").trim().toLowerCase();
  const type = req.body?.type === "reverse-proxy" ? "reverse-proxy" : "static";
  const port = String(req.body?.port ?? "").trim();
```

to:

```ts
sitesRouter.post("/sites", async (req, res) => {
  const hostname = String(req.body?.hostname ?? "").trim().toLowerCase();
  const type = req.body?.type === "reverse-proxy" ? "reverse-proxy" : "static";
  const port = String(req.body?.port ?? "").trim();
  const rawFramework = String(req.body?.framework ?? "").trim();
  const framework = type === "reverse-proxy" && rawFramework === "nextjs" ? "nextjs" : undefined;
```

(This is not a rejection path — an unrecognized or stray `framework` value silently collapses to `undefined`/"none", the same way `port` is already ignored for static sites.)

- [ ] **Step 3: Pass `framework` into `appendSite`**

Change:

```ts
    // 2. Append the Caddyfile block.
    await writeManagedConfig(
      config.caddyfilePath,
      caddyfile.appendSite(caddyfileContent, { hostname, type, target }),
    );
```

to:

```ts
    // 2. Append the Caddyfile block.
    await writeManagedConfig(
      config.caddyfilePath,
      caddyfile.appendSite(caddyfileContent, { hostname, type, target, framework }),
    );
```

- [ ] **Step 4: Generate scaffold files for Next.js reverse-proxy sites**

Change:

```ts
    // 3. Static sites get a directory + placeholder page.
    if (type === "static") {
      await createSiteDirectory(hostname);
      fs.writeFileSync(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
    }
```

to:

```ts
    // 3. Static sites get a directory + placeholder page; Next.js
    // reverse-proxy sites get a directory + Dockerfile/docker-compose
    // scaffold. Not covered by the rollback below if a later step fails —
    // same deliberate asymmetry that already applies to the static
    // placeholder file.
    if (type === "static") {
      await createSiteDirectory(hostname);
      fs.writeFileSync(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
    } else if (framework) {
      const scaffold = getFrameworkScaffold(framework, port);
      if (scaffold) {
        await createSiteDirectory(hostname);
        fs.writeFileSync(path.join(sitePath, "Dockerfile"), scaffold.dockerfile);
        fs.writeFileSync(path.join(sitePath, "docker-compose.yml"), scaffold.compose);
      }
    }
```

- [ ] **Step 5: Include `framework` in the success response and audit log**

Change:

```ts
    logAction({ action: "add-site", hostname, detail: `type=${type} target=${target}` });
    res.json({ added: true, hostname, type, target, tunnelId: config.tunnelId });
```

to:

```ts
    logAction({
      action: "add-site",
      hostname,
      detail: `type=${type} target=${target}${framework ? ` framework=${framework}` : ""}`,
    });
    res.json({ added: true, hostname, type, target, framework: framework ?? "none", tunnelId: config.tunnelId });
```

- [ ] **Step 6: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/sites.ts
git commit -m "Generate Next.js scaffold files when adding a reverse-proxy site"
```

---

### Task 4: Display framework on site cards and add the framework picker to the UI

**Files:**
- Modify: `src/views/html.ts` (imports, `renderSiteList`'s signature/card template, the add-site dialog's reverse-proxy port block, and the confirm-remove-dialog's delete-files checkbox)
- Modify: `src/routes/sites.ts` — the `GET /` handler's `res.send(renderSiteList(...))` call only, one line, to match `renderSiteList`'s new signature (find it by content, not line number — Task 3 will have already shifted line numbers in this file by the time this task runs). The rest of `sites.ts`'s route logic is Task 5's responsibility.

**Interfaces:**
- Consumes: `Site.framework` from Task 1.
- Produces: `renderSiteList(sites, domain, sitesRoot, error?, portOwners?)` — note the new `sitesRoot` parameter inserted before `error`. Card markup's `.delete-trigger` button now has `data-site-path` computed as each site's actual files directory (empty string when none applies) instead of always being `site.target`, plus a new `data-framework` attribute. The confirm-remove-dialog's checkbox is now wrapped in `<div id="confirm-remove-delete-files-section">` (replacing the old `id="confirm-remove-delete-files-label"` on the label itself), with a new `<p id="confirm-remove-docker-warning">` sibling — both consumed by Task 6's `public/app.js` changes. The add-site dialog's reverse-proxy fields wrapper (class `port-input`, already toggled by existing JS) now contains two `<label>`s: the existing port field, and a new `<select id="framework-field" name="framework">` with `<option value="none">`/`<option value="nextjs">`.

- [ ] **Step 1: Add the `path` import and a framework display-name lookup**

At the top of `src/views/html.ts`, change:

```ts
import type { Site } from "../lib/caddyfile";
```

to:

```ts
import path from "node:path";
import type { Site } from "../lib/caddyfile";
```

Then, after the `ICONS`/`icon()` block (before `export function renderSiteList`), add:

```ts
const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js",
};
```

- [ ] **Step 2: Update `renderSiteList`'s signature and card template**

Change:

```ts
export function renderSiteList(
  sites: Site[],
  domain: string,
  error?: string,
  portOwners: Record<string, string> = {},
): string {
  const cards = sites
    .map(
      (site) => `
      <article class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3.5 motion-safe:transition-colors motion-safe:duration-150 hover:border-rose-800/70">
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
            : `<span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">localhost:</span>${escapeHtml(site.target)}`
        }</p>
        <form method="post" action="/sites/${encodeURIComponent(site.hostname)}/delete" class="delete-form mt-auto pt-2.5 flex items-center gap-2.5 flex-wrap">
          <button type="button" class="delete-trigger ${BUTTON_DANGER}" data-site-type="${site.type}" data-site-path="${escapeHtml(site.target)}">${icon("trash")}Remove</button>
        </form>
      </article>`,
    )
    .join("");
```

to:

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
      const filesPath =
        site.type === "static"
          ? site.target
          : site.type === "reverse-proxy" && site.framework
            ? path.posix.join(sitesRoot, site.hostname)
            : null;
      const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;

      return `
      <article class="bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3.5 motion-safe:transition-colors motion-safe:duration-150 hover:border-rose-800/70">
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
        <form method="post" action="/sites/${encodeURIComponent(site.hostname)}/delete" class="delete-form mt-auto pt-2.5 flex items-center gap-2.5 flex-wrap">
          <button type="button" class="delete-trigger ${BUTTON_DANGER}" data-site-type="${site.type}" data-site-path="${escapeHtml(filesPath ?? "")}" data-framework="${escapeHtml(site.framework ?? "")}">${icon("trash")}Remove</button>
        </form>
      </article>`;
    })
    .join("");
```

- [ ] **Step 3: Replace the reverse-proxy port block with a port+framework group**

Change:

```ts
        <label class="port-input hidden flex-col gap-1.5 text-[0.85rem] text-stone-400 border-l-2 border-l-rose-800/70 pl-3 ml-1">
          Local port (reverse proxy only)
          <input type="number" name="port" min="1" max="65535" class="${INPUT}" id="port-field" />
          <span class="port-error hidden text-red-300 text-[0.8rem]"></span>
        </label>
```

to:

```ts
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
```

(The wrapping element keeps the `port-input` class, so the existing `syncPortField()` show/hide logic in `public/app.js` — which toggles `document.querySelector(".port-input")`'s display — needs no changes; it now shows/hides both fields together.)

- [ ] **Step 4: Add the Docker-container warning to the confirm-remove-dialog**

Change:

```ts
      <label id="confirm-remove-delete-files-label" class="hidden flex-row items-center text-[0.8rem] text-stone-400 gap-1.5 flex mb-5">
        <input type="checkbox" id="confirm-remove-delete-files" />
        Also delete files at <span id="confirm-remove-path" class="font-mono"></span>
      </label>
```

to:

```ts
      <div id="confirm-remove-delete-files-section" class="hidden flex flex-col gap-2 mb-5">
        <label class="flex flex-row items-center text-[0.8rem] text-stone-400 gap-1.5">
          <input type="checkbox" id="confirm-remove-delete-files" />
          Also delete files at <span id="confirm-remove-path" class="font-mono"></span>
        </label>
        <p id="confirm-remove-docker-warning" class="hidden text-[0.75rem] text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2 leading-snug m-0">
          If a Docker container is running from this directory, stop it first with <code class="font-mono">docker compose down</code> — deleting the files won't stop it.
        </p>
      </div>
```

- [ ] **Step 5: Update the one call site in `src/routes/sites.ts` for the new `renderSiteList` signature**

In `src/routes/sites.ts`, change:

```ts
  res.send(renderSiteList(sites, config.domain, undefined, portOwners));
```

to:

```ts
  res.send(renderSiteList(sites, config.domain, config.sitesRoot, undefined, portOwners));
```

- [ ] **Step 6: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/views/html.ts src/routes/sites.ts
git commit -m "Show framework on site cards and add the framework picker to the add-site dialog"
```

---

### Task 5: Extend the remove-site delete-files flow to framework-scaffolded sites

**Files:**
- Modify: `src/routes/sites.ts` (the `POST /sites/:hostname/delete` handler, roughly lines 172-238 — Task 4 already updated the `GET /` line elsewhere in this file; this task only touches the `/delete` handler)

**Interfaces:**
- Consumes: `Site.framework` from Task 1. `config.sitesRoot` (existing).
- Produces: `POST /sites/:hostname/delete`'s `needsFileConfirm` response now covers Next.js-scaffolded reverse-proxy sites too, with a correctly computed `sitePath` (previously this would have incorrectly used the port number for reverse-proxy sites, but the checkbox never showed for them before this task, so this path change was unreachable in practice).

- [ ] **Step 1: Replace the static-only gate with a general `filesPath` computation**

In `src/routes/sites.ts`, in the `POST /sites/:hostname/delete` handler, change:

```ts
    logAction({ action: "remove-site", hostname });

    // Site file deletion is a separate, explicit request — never triggered
    // by the same request that removes the site from Caddy/tunnel config.
    if (wantsFileDelete && existingSite?.type === "static") {
      res.json({ removed: true, needsFileConfirm: true, sitePath: existingSite.target });
      return;
    }

    res.json({ removed: true, needsFileConfirm: false });
```

to:

```ts
    logAction({ action: "remove-site", hostname });

    // Site file deletion is a separate, explicit request — never triggered
    // by the same request that removes the site from Caddy/tunnel config.
    // filesPath covers both static sites (target is already the path) and
    // Next.js-scaffolded reverse-proxy sites (target is a port, not a path
    // — the scaffold directory has to be computed the same way the site
    // list already does).
    const filesPath =
      existingSite?.type === "static"
        ? existingSite.target
        : existingSite?.type === "reverse-proxy" && existingSite.framework
          ? path.posix.join(config.sitesRoot, hostname)
          : undefined;

    if (wantsFileDelete && filesPath) {
      res.json({ removed: true, needsFileConfirm: true, sitePath: filesPath });
      return;
    }

    res.json({ removed: true, needsFileConfirm: false });
```

- [ ] **Step 2: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/sites.ts
git commit -m "Extend remove-site file deletion to cover Next.js scaffold directories"
```

---

### Task 6: Client-side wiring for the framework picker and Docker warning

**Files:**
- Modify: `public/app.js` (DOM ref declarations near the top, `wireDeleteForms`, the add-site submit handler's body-building and success-banner logic)

**Interfaces:**
- Consumes: `#framework-field` (a `<select>` inside the existing `.port-input` wrapper), `#confirm-remove-delete-files-section` (replaces the old `#confirm-remove-delete-files-label` id), `#confirm-remove-docker-warning`, and the `data-framework` attribute on `.delete-trigger` buttons — all from Task 4. `POST /sites`'s response now includes `framework` from Task 3.

- [ ] **Step 1: Update the DOM ref declarations**

Change:

```js
const confirmRemoveDeleteFilesLabel = document.getElementById("confirm-remove-delete-files-label");
```

to:

```js
const confirmRemoveDeleteFilesSection = document.getElementById("confirm-remove-delete-files-section");
const confirmRemoveDockerWarning = document.getElementById("confirm-remove-docker-warning");
```

- [ ] **Step 2: Update `wireDeleteForms` to key off "has a files path" instead of "is static," and toggle the Docker warning**

Change:

```js
function wireDeleteForms() {
  document.querySelectorAll(".delete-form").forEach((form) => {
    const trigger = form.querySelector(".delete-trigger");
    trigger?.addEventListener("click", () => {
      pendingDeleteForm = form;
      const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
      if (confirmRemoveHostname) confirmRemoveHostname.textContent = hostname;

      const isStatic = trigger.dataset.siteType === "static";
      confirmRemoveDeleteFilesLabel?.classList.toggle("hidden", !isStatic);
      if (confirmRemoveDeleteFilesCheckbox) confirmRemoveDeleteFilesCheckbox.checked = false;
      if (confirmRemovePath) confirmRemovePath.textContent = trigger.dataset.sitePath ?? "";

      confirmRemoveDialog?.showModal();
    });
  });
}
```

to:

```js
function wireDeleteForms() {
  document.querySelectorAll(".delete-form").forEach((form) => {
    const trigger = form.querySelector(".delete-trigger");
    trigger?.addEventListener("click", () => {
      pendingDeleteForm = form;
      const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
      if (confirmRemoveHostname) confirmRemoveHostname.textContent = hostname;

      const hasFiles = Boolean(trigger.dataset.sitePath);
      const hasFramework = Boolean(trigger.dataset.framework);
      confirmRemoveDeleteFilesSection?.classList.toggle("hidden", !hasFiles);
      confirmRemoveDockerWarning?.classList.toggle("hidden", !hasFramework);
      if (confirmRemoveDeleteFilesCheckbox) confirmRemoveDeleteFilesCheckbox.checked = false;
      if (confirmRemovePath) confirmRemovePath.textContent = trigger.dataset.sitePath ?? "";

      confirmRemoveDialog?.showModal();
    });
  });
}
```

- [ ] **Step 3: Include `framework` in the add-site POST body**

Change:

```js
  const formData = new FormData(addSiteForm);
  const hostname = String(formData.get("hostname") ?? "").trim();
  const type = formData.get("type");
  const port = String(formData.get("port") ?? "").trim();

  addSiteInFlight = true;
  addSiteError?.classList.add("hidden");
  try {
    const response = await fetch("/sites", {
      method: "POST",
      body: new URLSearchParams({ hostname, type, port }),
    });
```

to:

```js
  const formData = new FormData(addSiteForm);
  const hostname = String(formData.get("hostname") ?? "").trim();
  const type = formData.get("type");
  const port = String(formData.get("port") ?? "").trim();
  const framework = String(formData.get("framework") ?? "").trim();

  addSiteInFlight = true;
  addSiteError?.classList.add("hidden");
  try {
    const response = await fetch("/sites", {
      method: "POST",
      body: new URLSearchParams({ hostname, type, port, framework }),
    });
```

- [ ] **Step 4: Include the scaffold reminder in the success banner**

Change:

```js
    addSiteDialog?.close();
    await refreshSitesGrid();
    if (result.type === "reverse-proxy") portOwners[result.target] = result.hostname;
    showBanner(
      `Added ${result.hostname}. Don't forget to add the DNS record: cloudflared tunnel route dns ${result.tunnelId} ${result.hostname}`,
      "persistent",
    );
```

to:

```js
    addSiteDialog?.close();
    await refreshSitesGrid();
    if (result.type === "reverse-proxy") portOwners[result.target] = result.hostname;
    const scaffoldNote =
      result.framework === "nextjs"
        ? ` A Next.js scaffold was created at /var/www/${result.hostname}/ — add your app source and run "docker compose up -d --build" there.`
        : "";
    showBanner(
      `Added ${result.hostname}.${scaffoldNote} Don't forget to add the DNS record: cloudflared tunnel route dns ${result.tunnelId} ${result.hostname}`,
      "persistent",
    );
```

- [ ] **Step 5: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors. (`npm run lint` only runs `eslint src`, which doesn't cover `public/app.js` — this is a pre-existing gap in the lint script's scope, not something to fix here. Read the diff carefully instead.)

- [ ] **Step 6: Commit**

```bash
git add public/app.js
git commit -m "Wire up the framework picker and Docker-container warning in the client"
```

---

### Task 7: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds, produces `dist/` and updated `public/style.css`.

- [ ] **Step 2: Confirm the new opacity-variant utility classes made it into the compiled CSS**

Task 4's Docker warning paragraph introduces two color/opacity combinations not used elsewhere in the file (`bg-red-950/40` and `border-red-800/50` — existing red usages elsewhere are `/60` and `/70`). Run:

```bash
grep -o "red-950\\\\/40\|red-800\\\\/50" public/style.css
```

Expected: both patterns found (Tailwind's minified output escapes the `/` in fractional-opacity class names as `\/`).

- [ ] **Step 3: Grep for leftover references to the old single-arg `renderSiteList` call or the old `confirm-remove-delete-files-label` id**

Run: `grep -rn "confirm-remove-delete-files-label\|renderSiteList(sites, config.domain, undefined" src/`
Expected: no output.

- [ ] **Step 4: Hand off for manual QA**

This repo has no automated tests, and the real target environment (Caddy, cloudflared, `/var/www`, and now Docker) only exists on `lychee` — per this project's established convention, manual verification in the browser is the user's job after deploy, not something done by running `npm run dev` locally. Leave a note for the user: after this branch is deployed, verify (a) adding a reverse-proxy site with "Next.js" selected creates `/var/www/<hostname>/Dockerfile` and `/var/www/<hostname>/docker-compose.yml`, and the Caddyfile block contains the `# lyly-admin-framework: nextjs` comment line; (b) the site card shows `localhost:<port> · Next.js`; (c) removing that site shows the "also delete files" checkbox with the Docker warning below it, and checking it actually deletes the directory; (d) a plain reverse-proxy site (framework "None") behaves exactly as before this branch — no scaffold files, no framework label on its card, no Docker warning on removal; (e) a static site's remove flow is completely unaffected (checkbox still shows, no Docker warning).
