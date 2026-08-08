# Modal-Based Site Removal Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Removing a site (including the optional "also delete files" step) never navigates the user away from `/` — it's driven entirely by modals, `fetch`, and a transient flash banner.

**Architecture:** `POST /sites/:hostname/delete` and `POST /sites/:hostname/delete-files` change from rendering full HTML pages to returning JSON. `public/app.js` drives the two-step confirmation with `<dialog>` modals it already has a pattern for, calls the endpoints via `fetch`, removes the site's card from the DOM on success, and shows a flash-banner message. Three now-unused page-render functions are deleted from `src/views/html.ts`.

**Tech Stack:** Express (existing `express.urlencoded` body parsing — no new middleware needed), vanilla JS `fetch`/`<dialog>`, Tailwind utility classes matching the existing dialog/banner patterns.

## Global Constraints

- No automated test framework exists in this repo (see `package.json` — no test script). Verification is `npm run typecheck`, `npm run build`, and `npm run lint`; manual browser QA against the live `lychee` host is the user's own responsibility post-deploy, per project convention (do not run `npm run dev`).
- Follow the existing Tailwind utility-class style used throughout `src/views/html.ts` and `public/app.js` — no new CSS files, no class abstraction.
- Keep all existing server-side mutation logic (backup → edit → validate → reload → restart, `fs.rmSync`) untouched — only response shape and page-render calls change.
- `renderError` and the add-site flow are out of scope — do not modify them.

---

### Task 1: Convert delete/delete-files routes to JSON responses

**Files:**
- Modify: `src/routes/sites.ts:17-24` (imports), `:154-210` (both route handlers)

**Interfaces:**
- Produces: `POST /sites/:hostname/delete` now responds `200 { removed: true, needsFileConfirm: boolean, sitePath?: string }` on success, `500 { error: string }` on failure.
- Produces: `POST /sites/:hostname/delete-files` now responds `200 { deleted: true }` on success, `400 { error: string }` (invalid hostname) or `500 { error: string }` on failure.

- [ ] **Step 1: Update the import block**

Replace lines 17-24:

```ts
import {
  renderAddResult,
  renderConfirmDeleteFiles,
  renderError,
  renderFilesDeletedResult,
  renderRemoveResult,
  renderSiteList,
} from "../views/html";
```

with:

```ts
import { renderAddResult, renderError, renderSiteList } from "../views/html";
```

- [ ] **Step 2: Replace the `/sites/:hostname/delete` handler**

Replace the whole handler (lines 154-189):

```ts
sitesRouter.post("/sites/:hostname/delete", async (req, res) => {
  const hostname = req.params.hostname.toLowerCase();
  const wantsFileDelete = req.body?.deleteFiles === "on";

  try {
    const caddyfileContent = fs.readFileSync(config.caddyfilePath, "utf8");
    const existingSite = caddyfile.parseSites(caddyfileContent).find((site) => site.hostname === hostname);

    backupFile(config.caddyfilePath);
    backupFile(config.tunnelConfigPath);

    await writeManagedConfig(config.caddyfilePath, caddyfile.removeSite(caddyfileContent, hostname));

    const tunnelContent = fs.readFileSync(config.tunnelConfigPath, "utf8");
    await writeManagedConfig(config.tunnelConfigPath, tunnelConfig.removeIngressRule(tunnelContent, hostname));

    await validateCaddyfile(config.caddyfilePath);
    await reloadCaddy();
    await restartCloudflared();

    logAction({ action: "remove-site", hostname });

    // Site file deletion is a separate, explicit confirmation step — never
    // triggered by the same request that removes the site from Caddy/tunnel.
    if (wantsFileDelete && existingSite?.type === "static") {
      res.json({ removed: true, needsFileConfirm: true, sitePath: existingSite.target });
      return;
    }

    res.json({ removed: true, needsFileConfirm: false });
  } catch (error) {
    const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
    logAction({ action: "remove-site-failed", hostname, detail: message });
    res.status(500).json({ error: message });
  }
});
```

- [ ] **Step 3: Replace the `/sites/:hostname/delete-files` handler**

Replace the whole handler (lines 191-210):

```ts
sitesRouter.post("/sites/:hostname/delete-files", (req, res) => {
  const hostname = req.params.hostname.toLowerCase();

  if (!isValidHostname(hostname)) {
    res.status(400).json({ error: `"${hostname}" must be a subdomain of ${config.domain}` });
    return;
  }

  const sitePath = path.posix.join(config.sitesRoot, hostname);

  try {
    fs.rmSync(sitePath, { recursive: true, force: true });
    logAction({ action: "delete-site-files", hostname, detail: sitePath });
    res.json({ deleted: true });
  } catch (error) {
    const message = String(error);
    logAction({ action: "delete-site-files-failed", hostname, detail: message });
    res.status(500).json({ error: message });
  }
});
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (This will still fail at this point — Step 5 fixes it — because `html.ts` still exports `renderConfirmDeleteFiles`/`renderFilesDeletedResult`/`renderRemoveResult`, which is fine; the failure to watch for is only unused-import/type errors in `sites.ts` itself. If `tsc` reports unrelated pre-existing errors in `html.ts`, ignore — Task 2 addresses that file.)

- [ ] **Step 5: Commit**

```bash
git add src/routes/sites.ts
git commit -m "Convert site delete/delete-files routes to return JSON"
```

---

### Task 2: Delete now-unused page-render functions

**Files:**
- Modify: `src/views/html.ts:172-212`

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderError`, `renderAddResult`, `renderSiteList` remain exported and unchanged; `renderRemoveResult`, `renderConfirmDeleteFiles`, `renderFilesDeletedResult` no longer exist.

- [ ] **Step 1: Delete the three unused functions**

Delete this whole block (lines 172-212, everything between `renderAddResult`'s closing brace and `renderError`):

```ts
export function renderRemoveResult(hostname: string): string {
  return layout(
    "Site removed",
    resultPanel(`
    <p class="m-0 leading-relaxed">Removed <strong>${escapeHtml(hostname)}</strong> from Caddy and the tunnel ingress config.</p>
    <p class="font-mono text-[0.85rem] bg-stone-700/60 border border-stone-700 border-l-[3px] border-l-rose-400 px-4 py-3.5 rounded-md leading-relaxed">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

export function renderConfirmDeleteFiles(hostname: string, sitePath: string): string {
  return layout(
    "Confirm delete site files",
    resultPanel(`
    <p class="m-0 leading-relaxed">${escapeHtml(hostname)} has been removed from Caddy and the tunnel ingress config.</p>
    <p class="font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3">
      This next step will permanently delete <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(sitePath)}</code> and everything in it.
      This cannot be undone.
    </p>
    <form method="post" action="/sites/${encodeURIComponent(hostname)}/delete-files">
      <button type="submit" class="${BUTTON_DANGER}">Delete permanently</button>
    </form>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">Cancel &mdash; leave the files in place</a></p>
    `),
    "result",
  );
}

export function renderFilesDeletedResult(hostname: string, sitePath: string): string {
  return layout(
    "Site files deleted",
    resultPanel(`
    <p class="m-0 leading-relaxed">Deleted <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">${escapeHtml(sitePath)}</code>.</p>
    <p class="font-mono text-[0.85rem] bg-stone-700/60 border border-stone-700 border-l-[3px] border-l-rose-400 px-4 py-3.5 rounded-md leading-relaxed">Remember to remove the DNS record for this hostname in Cloudflare manually.</p>
    <p class="m-0 leading-relaxed"><a href="/" class="${RESULT_LINK}">&larr; Back to sites</a></p>
    `),
    "result",
  );
}

```

(Leave `renderError` immediately following this block untouched.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/views/html.ts
git commit -m "Remove page-render functions superseded by the JSON delete flow"
```

---

### Task 3: Add flash-banner, delete-files dialog, and sites-grid hook to the markup

**Files:**
- Modify: `src/views/html.ts` — `layout()` (around line 46), `renderSiteList()` grid div (around line 112) and dialogs section (around line 145-153)

**Interfaces:**
- Produces: every page now includes `<div id="flash-banner">` (hidden by default) with a `<span id="flash-banner-message">` and `<button id="flash-banner-close">` inside it. `renderSiteList` output's sites grid `<div>` carries a `sites-grid` class. `renderSiteList` output includes a `<dialog id="confirm-delete-files-dialog">` with `<strong id="confirm-delete-files-hostname">`, `<code id="confirm-delete-files-path">`, a `data-close-dialog="confirm-delete-files-dialog"` cancel button, and a `<button id="confirm-delete-files-submit">`.

- [ ] **Step 1: Add the flash-banner div to `layout()`**

In `layout()`, change:

```ts
  <main class="${mainClass}">${body}</main>
```

to:

```ts
  <main class="${mainClass}">
    <div id="flash-banner" class="hidden font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 max-w-[1080px] mx-auto mb-5 border flex items-center justify-between gap-3" role="status" aria-live="polite">
      <span id="flash-banner-message"></span>
      <button type="button" id="flash-banner-close" class="hidden shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none" aria-label="Dismiss">&times;</button>
    </div>
    ${body}
  </main>
```

- [ ] **Step 2: Tag the sites grid for JS targeting**

In `renderSiteList()`, change:

```ts
      <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        ${cards || `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`}
      </div>
```

to:

```ts
      <div class="sites-grid grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
        ${cards || `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`}
      </div>
```

- [ ] **Step 3: Add the delete-files confirmation dialog**

In `renderSiteList()`, immediately after the `confirm-remove-dialog` block's closing `</dialog>` (right before the closing template-literal backtick that follows it), add:

```ts

    <dialog id="confirm-delete-files-dialog" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
      <h2 class="font-mono text-[0.85rem] font-semibold uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Delete site files</h2>
      <p class="m-0 mb-5 leading-relaxed">
        <strong id="confirm-delete-files-hostname"></strong> has been removed from Caddy and the tunnel config.
        Permanently delete <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50" id="confirm-delete-files-path"></code> and everything in it? This cannot be undone.
      </p>
      <div class="flex justify-end gap-2.5">
        <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="confirm-delete-files-dialog">Leave files in place</button>
        <button type="button" id="confirm-delete-files-submit" class="${BUTTON_DANGER}">${icon("trash")}Delete permanently</button>
      </div>
    </dialog>
```

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors. (`npm run build` regenerates `public/style.css` via the Tailwind CLI, which scans `public/app.js` too — Task 4 introduces the class names this markup needs JS to toggle, like `bg-red-950/60`; running the build again after Task 4 will pick those up. It's fine if this build step doesn't yet contain every class Task 4 will add — just confirm no errors here.)

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts
git commit -m "Add flash-banner and delete-files confirmation dialog markup"
```

---

### Task 4: Rewrite the client-side delete flow in app.js

**Files:**
- Modify: `public/app.js:1-18`

**Interfaces:**
- Consumes: `#confirm-remove-dialog`, `#confirm-remove-hostname`, `#confirm-remove-submit`, `.delete-form`, `.delete-trigger` (existing); `#confirm-delete-files-dialog`, `#confirm-delete-files-hostname`, `#confirm-delete-files-path`, `#confirm-delete-files-submit`, `.sites-grid`, `#flash-banner`, `#flash-banner-message`, `#flash-banner-close` (from Task 3). `POST /sites/:hostname/delete` and `POST /sites/:hostname/delete-files` JSON contracts from Task 1.
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Replace lines 1-18 of `public/app.js`**

Replace:

```js
let pendingDeleteForm = null;
const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveHostname = document.getElementById("confirm-remove-hostname");

document.querySelectorAll(".delete-form").forEach((form) => {
  const trigger = form.querySelector(".delete-trigger");
  trigger?.addEventListener("click", () => {
    pendingDeleteForm = form;
    const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
    if (confirmRemoveHostname) confirmRemoveHostname.textContent = hostname;
    confirmRemoveDialog?.showModal();
  });
});

document.getElementById("confirm-remove-submit")?.addEventListener("click", () => {
  confirmRemoveDialog?.close();
  pendingDeleteForm?.submit();
});
```

with:

```js
let pendingDeleteForm = null;
let pendingDeleteHostname = null;
let pendingDeleteCard = null;

const confirmRemoveDialog = document.getElementById("confirm-remove-dialog");
const confirmRemoveHostname = document.getElementById("confirm-remove-hostname");
const confirmDeleteFilesDialog = document.getElementById("confirm-delete-files-dialog");
const confirmDeleteFilesHostname = document.getElementById("confirm-delete-files-hostname");
const confirmDeleteFilesPath = document.getElementById("confirm-delete-files-path");

const flashBanner = document.getElementById("flash-banner");
const flashBannerMessage = document.getElementById("flash-banner-message");
const flashBannerClose = document.getElementById("flash-banner-close");
let flashBannerTimeout = null;

function showBanner(message, kind) {
  if (!flashBanner || !flashBannerMessage || !flashBannerClose) return;
  clearTimeout(flashBannerTimeout);
  flashBannerMessage.textContent = message;
  flashBanner.classList.remove("hidden", "bg-red-950/60", "border-red-400/70", "bg-rose-950/60", "border-rose-400/70");
  if (kind === "error") {
    flashBanner.classList.add("bg-red-950/60", "border-red-400/70");
    flashBannerClose.classList.remove("hidden");
  } else {
    flashBanner.classList.add("bg-rose-950/60", "border-rose-400/70");
    flashBannerClose.classList.add("hidden");
    flashBannerTimeout = setTimeout(hideBanner, 4000);
  }
}

function hideBanner() {
  clearTimeout(flashBannerTimeout);
  flashBanner?.classList.add("hidden");
}

flashBannerClose?.addEventListener("click", hideBanner);

function removeCard(card) {
  if (!card) return;
  const grid = card.closest(".sites-grid");
  card.remove();
  if (grid && !grid.querySelector("article")) {
    grid.innerHTML = `<p class="col-span-full text-stone-400 italic m-0">No sites configured yet.</p>`;
  }
}

document.querySelectorAll(".delete-form").forEach((form) => {
  const trigger = form.querySelector(".delete-trigger");
  trigger?.addEventListener("click", () => {
    pendingDeleteForm = form;
    const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
    if (confirmRemoveHostname) confirmRemoveHostname.textContent = hostname;
    confirmRemoveDialog?.showModal();
  });
});

document.getElementById("confirm-remove-submit")?.addEventListener("click", async () => {
  confirmRemoveDialog?.close();
  const form = pendingDeleteForm;
  pendingDeleteForm = null;
  if (!form) return;

  const hostname = decodeURIComponent(form.getAttribute("action").split("/")[2]);
  const deleteFilesChecked = form.querySelector('input[name="deleteFiles"]')?.checked ?? false;
  const card = form.closest("article");

  try {
    const response = await fetch(form.getAttribute("action"), {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to remove site");

    if (result.needsFileConfirm) {
      pendingDeleteHostname = hostname;
      pendingDeleteCard = card;
      if (confirmDeleteFilesHostname) confirmDeleteFilesHostname.textContent = hostname;
      if (confirmDeleteFilesPath) confirmDeleteFilesPath.textContent = result.sitePath ?? "";
      confirmDeleteFilesDialog?.showModal();
      return;
    }

    removeCard(card);
    showBanner(`Removed ${hostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
  } catch (error) {
    showBanner(error.message, "error");
  }
});

document.getElementById("confirm-delete-files-submit")?.addEventListener("click", async () => {
  confirmDeleteFilesDialog?.close();
  const hostname = pendingDeleteHostname;
  const card = pendingDeleteCard;
  pendingDeleteHostname = null;
  pendingDeleteCard = null;
  if (!hostname) return;

  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Failed to delete site files");

    removeCard(card);
    showBanner(`Deleted files for ${hostname}. Remember to remove the DNS record in Cloudflare manually.`, "success");
  } catch (error) {
    showBanner(error.message, "error");
  }
});
```

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: no errors, and `public/style.css` is regenerated including `bg-red-950/60`, `border-red-400/70`, `bg-rose-950/60`, `border-rose-400/70` (grep to confirm: `grep -c "red-950" public/style.css` should be non-zero).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "Drive site removal via fetch instead of full-page navigation"
```

---

### Task 5: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds, produces `dist/` and updated `public/style.css`.

- [ ] **Step 2: Confirm no leftover references to deleted functions/routes**

Run: `grep -rn "renderConfirmDeleteFiles\|renderFilesDeletedResult\|renderRemoveResult" src/`
Expected: no output.

- [ ] **Step 3: Hand off for manual QA**

This repo has no automated tests and the app's real target (Caddy, cloudflared, `/var/www`) only exists on `lychee` — per project convention, manual verification in the browser is done by the user after deploy, not by running `npm run dev` locally. Leave a note for the user: after this branch is deployed, verify: (a) removing a reverse-proxy or non-file-deleting static site shows a success banner and the card disappears without navigation; (b) removing a static site with "Also delete files" checked opens the second confirmation dialog with the correct hostname/path, and confirming it deletes the files, removes the card, and shows a banner; (c) canceling the second dialog leaves the card removed from Caddy state but does not delete files (matches existing behavior — files are already orphaned once step (a) succeeds, same as before this change); (d) a forced failure (e.g. temporarily break `caddy validate`) shows an error banner with a manual dismiss button and leaves the card in place.
