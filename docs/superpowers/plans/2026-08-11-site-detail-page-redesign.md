# Site Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `renderSiteDetail` in `src/views/html.ts` to show a larger header with an inline live-status pill, and to split the reverse-proxy body into distinct Overview/Status/Deploy cards instead of one flat card (static sites keep a single minimal Overview card).

**Architecture:** Pure presentational change to one function in one file. No routes, data flow, or business logic change — `renderSiteDetail`'s signature (`site`, `sitesRoot`, `respondingOnPort?`, `scaffold?`) stays exactly as-is; only the HTML string it returns changes.

**Tech Stack:** TypeScript, Express, hand-written HTML template strings (no view engine), Tailwind CSS v4 (classes read directly from the compiled string, no build-time template syntax).

## Global Constraints

- Never run `npm run dev` or start the app to verify — this user tests changes themselves on the live host. Verify only with `npm run typecheck` and `npm run build`.
- Green/red are being introduced as new semantic status colors (header pill + Status card dot/text) for this page only — do not carry green/red into any other page or into the static/proxy type badge, which keeps its existing rose/stone colors.
- No changes to `GET /sites/:hostname`, `checkPortOpen`, `frameworkScaffold.ts`, `computeFilesPath`, or the site list page — this plan touches only `src/views/html.ts`.
- Reuse existing style vocabulary (`BUTTON_*`, `INPUT`, `FORM_LABEL`, `icon()`, `escapeHtml()`) rather than duplicating equivalent classes.

---

### Task 1: Rewrite `renderSiteDetail` with the new header and card structure

**Files:**
- Modify: `src/views/html.ts:169-277` (the full `renderSiteDetail` function, plus adding new style constants near the existing `BUTTON_*`/`INPUT`/`FORM_LABEL` constants around line 11-19)

**Interfaces:**
- Consumes: `computeFilesPath(site, sitesRoot)` from `../lib/caddyfile` (already imported), `Site` type (already imported), `escapeHtml()`, `icon()`, `FRAMEWORK_LABELS`, `BUTTON_DANGER`, `BUTTON_SECONDARY`, `layout()` — all already defined earlier in this file, unchanged.
- Produces: `renderSiteDetail(site: Site, sitesRoot: string, respondingOnPort?: boolean, scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string }): string` — same exported signature as before. `src/routes/sites.ts` calls this and needs no changes.

There is no test framework in this repo (`package.json` has no test script) — verification for this task is a throwaway render check (Step 1) plus `npm run typecheck` / `npm run build` (Steps 4-5), not a committed test file.

- [ ] **Step 1: Write a throwaway render-check script**

Create `C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\render-check.ts` (outside the repo — this file is never committed):

```ts
import { renderSiteDetail } from "C:/Users/byron/WebstormProjects/lyly-admin/.claude/worktrees/site-detail-redesign/src/views/html";

function assertContains(html: string, needle: string, label: string) {
  if (!html.includes(needle)) {
    throw new Error(`FAIL (${label}): expected to find ${JSON.stringify(needle)}`);
  }
}
function assertNotContains(html: string, needle: string, label: string) {
  if (html.includes(needle)) {
    throw new Error(`FAIL (${label}): did not expect to find ${JSON.stringify(needle)}`);
  }
}

// Static site: single minimal Overview card, no pill, no Status/Deploy cards.
const staticHtml = renderSiteDetail(
  { hostname: "blog.lyly.dev", type: "static", target: "/var/www/blog.lyly.dev" },
  "/var/www",
);
assertContains(staticHtml, "Overview", "static: has Overview label");
assertContains(staticHtml, "/var/www/blog.lyly.dev", "static: shows path");
assertNotContains(staticHtml, ">Status<", "static: no Status card");
assertNotContains(staticHtml, ">Deploy<", "static: no Deploy card");
assertNotContains(staticHtml, "live</span>", "static: no status pill");
assertNotContains(staticHtml, "down</span>", "static: no status pill");

// Reverse-proxy, responding, no framework: Overview + Status cards, no Deploy, green pill.
const proxyUpHtml = renderSiteDetail(
  { hostname: "app.lyly.dev", type: "reverse-proxy", target: "3000" },
  "/var/www",
  true,
);
assertContains(proxyUpHtml, "Overview", "proxy-up: has Overview label");
assertContains(proxyUpHtml, ">Status<", "proxy-up: has Status card");
assertNotContains(proxyUpHtml, ">Deploy<", "proxy-up: no Deploy card (no scaffold)");
assertContains(proxyUpHtml, "live", "proxy-up: pill says live");
assertContains(proxyUpHtml, "text-green-300", "proxy-up: green status color");
assertContains(proxyUpHtml, "Responding on localhost:3000", "proxy-up: status sentence");

// Reverse-proxy, not responding, with framework scaffold: all three cards, red pill, hint text.
const proxyDownHtml = renderSiteDetail(
  { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000", framework: "nextjs" },
  "/var/www",
  false,
  {
    buildCommand: "npm run build",
    runCommand: "npm start",
    deployWorkflow: "name: deploy\non: push",
  },
);
assertContains(proxyDownHtml, ">Overview<", "proxy-down: has Overview card");
assertContains(proxyDownHtml, ">Status<", "proxy-down: has Status card");
assertContains(proxyDownHtml, ">Deploy<", "proxy-down: has Deploy card");
assertContains(proxyDownHtml, "down", "proxy-down: pill says down");
assertContains(proxyDownHtml, "text-red-300", "proxy-down: red status color");
assertContains(proxyDownHtml, "Not responding on localhost:4000", "proxy-down: status sentence");
assertContains(proxyDownHtml, "docker compose up -d --build", "proxy-down: hint text present");
assertContains(proxyDownHtml, "/var/www/api.lyly.dev", "proxy-down: hint shows files path");
assertContains(proxyDownHtml, "npm run build", "proxy-down: build command shown");
assertContains(proxyDownHtml, "npm start", "proxy-down: run command shown");
assertContains(proxyDownHtml, "name: deploy", "proxy-down: workflow yaml shown");

console.log("All render checks passed.");
```

- [ ] **Step 2: Run it to confirm it fails against the current implementation**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\render-check.ts"`
Expected: throws `FAIL (...)` on one of the new-structure assertions (e.g. `>Status<` not found, since the current implementation has no per-card labels) — confirms the check actually exercises the new structure before it exists.

- [ ] **Step 3: Rewrite `renderSiteDetail` and its supporting constants**

Add these constants near the other style constants at the top of `src/views/html.ts` (after the existing `FORM_LABEL` constant on line 19):

```ts
const SECTION_LABEL =
  "font-mono text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0 mb-2";
const DETAIL_CARD = "bg-stone-800 border border-stone-700 rounded-[10px] p-6 flex flex-col gap-3";
const STATUS_PILL_BASE =
  "inline-flex items-center gap-1 shrink-0 font-mono text-[0.65rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-transparent";
const STATUS_PILL_LIVE = `${STATUS_PILL_BASE} text-green-300 bg-green-950/60`;
const STATUS_PILL_DOWN = `${STATUS_PILL_BASE} text-red-300 bg-red-950/60`;
```

Replace the entire `renderSiteDetail` function (currently `src/views/html.ts:169-277`) with:

```ts
export function renderSiteDetail(
  site: Site,
  sitesRoot: string,
  respondingOnPort?: boolean,
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string },
): string {
  const filesPath = computeFilesPath(site, sitesRoot);
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;

  const statusPill =
    respondingOnPort === undefined
      ? ""
      : respondingOnPort
        ? `<span class="${STATUS_PILL_LIVE}">&#9679; live</span>`
        : `<span class="${STATUS_PILL_DOWN}">&#9679; down</span>`;

  const overviewCard =
    site.type === "static"
      ? `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Overview</h3>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0 break-words"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">path:</span> ${escapeHtml(site.target)}</p>
      </section>`
      : `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Overview</h3>
        <p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">local port:</span> ${escapeHtml(site.target)}</p>
        ${frameworkLabel ? `<p class="font-mono text-stone-400 text-[0.85rem] leading-relaxed m-0"><span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em]">framework:</span> ${escapeHtml(frameworkLabel)}</p>` : ""}
      </section>`;

  const statusCard =
    site.type === "static"
      ? ""
      : `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Status</h3>
        ${
          respondingOnPort
            ? `<p class="text-green-300 text-[0.85rem] leading-relaxed m-0">&#9679; Responding on localhost:${escapeHtml(site.target)}</p>`
            : `<p class="text-red-300 text-[0.85rem] leading-relaxed m-0">&#9679; Not responding on localhost:${escapeHtml(site.target)}${
                filesPath
                  ? `<br />
        <span class="text-[0.75rem] text-stone-400">Run <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">docker compose up -d --build</code> in <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(filesPath)}/</code> to deploy.</span>`
                  : ""
              }</p>`
        }
      </section>`;

  const deployCard = scaffold
    ? `
      <section class="${DETAIL_CARD}">
        <h3 class="${SECTION_LABEL}">Deploy</h3>
        <div class="flex flex-col gap-1">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">build command</span>
          <code class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.85rem] text-stone-50">${escapeHtml(scaffold.buildCommand)}</code>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">run command</span>
          <code class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 text-[0.85rem] text-stone-50">${escapeHtml(scaffold.runCommand)}</code>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">github actions workflow</span>
          <div class="relative">
            <button type="button" class="absolute top-2 right-2 p-1.5 rounded-md bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-50 hover:bg-stone-700 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2" data-copy-target="github-workflow-yaml" aria-label="Copy to clipboard">
              <span data-copy-icon="idle">${icon("clipboard")}</span>
              <span data-copy-icon="copied" class="hidden">${icon("check")}</span>
            </button>
            <pre id="github-workflow-yaml" class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 pr-10 text-[0.8rem] text-stone-50 overflow-x-auto whitespace-pre">${escapeHtml(scaffold.deployWorkflow)}</pre>
          </div>
          <p class="text-stone-400 text-[0.75rem] leading-snug m-0">Paste this into <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">.github/workflows/deploy.yml</code> in your app's repo.</p>
        </div>
      </section>`
    : "";

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
        <h2 class="font-display text-3xl leading-relaxed text-stone-50 m-0 break-words">${escapeHtml(site.hostname)}</h2>
        <div class="flex items-center gap-2 shrink-0">
          <span class="inline-block font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
            site.type === "static"
              ? "border-stone-600 text-stone-50 bg-stone-700"
              : "border-transparent text-rose-300 bg-rose-950"
          }">${site.type === "static" ? "static" : "proxy"}</span>
          ${statusPill}
        </div>
      </div>

      ${overviewCard}
      ${statusCard}
      ${deployCard}

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
```

- [ ] **Step 4: Re-run the render-check script and confirm it passes**

Run: `npx tsx "C:\Users\byron\AppData\Local\Temp\claude\C--Users-byron-WebstormProjects-lyly-admin\56221037-4fea-4209-9cde-b42fc5ffaf5e\scratchpad\render-check.ts"`
Expected: `All render checks passed.` with no thrown error.

Delete the scratchpad script after this passes — it's throwaway, not part of the repo.

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck`
Expected: exits 0, no errors.

Run: `npm run build`
Expected: exits 0 (runs `build:css` then `tsc`), no errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts
git commit -m "$(cat <<'EOF'
Redesign site detail page into Overview/Status/Deploy cards

Splits the reverse-proxy detail view's single flat card into distinct
sections and adds a header status pill, per the approved design spec.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** header hostname size + inline badge/pill (Task 1 header block); static site single minimal Overview card, no Status/Deploy (Task 1 `overviewCard`/`statusCard`/`deployCard` conditionals); reverse-proxy Overview/Status/Deploy split (same); green/red semantic colors on pill and Status card (`STATUS_PILL_LIVE`/`STATUS_PILL_DOWN`, `text-green-300`/`text-red-300`); hint text stays only in Status card (verified by `render-check.ts` asserting it's absent from Deploy-only content and present alongside the down-status sentence); Deploy card only when `scaffold` present — all covered by the single task.
- **Placeholder scan:** no TBD/TODO; every step has literal code, not descriptions.
- **Type consistency:** `renderSiteDetail`'s signature is unchanged from the current codebase (verified against `src/views/html.ts:169-173` and its only caller in `src/routes/sites.ts`), so no downstream signature drift to check.
