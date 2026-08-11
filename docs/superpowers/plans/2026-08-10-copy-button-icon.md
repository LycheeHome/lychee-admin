# Icon-Only Copy Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The GitHub Actions workflow block's "Copy" button becomes a small clipboard-icon button positioned in the top-right corner of the code block, instead of a labeled button in its own row above it.

**Architecture:** Two new entries (`clipboard`, `check`) join the existing `ICONS` map in `src/views/html.ts`, rendered as sibling `<span>`s inside the button (one hidden at a time) rather than swapped via `textContent` — swapping `textContent` on a button containing an SVG would destroy the icon permanently. `public/app.js`'s existing copy handler (already has try/catch for the insecure-context fallback from the prior branch) changes its feedback mechanism from setting `button.textContent` to toggling the `hidden` class on those two icon spans, plus updating `aria-label` for equivalent screen-reader feedback.

**Tech Stack:** Same as the rest of the app — server-rendered HTML via TS template literals, vanilla JS, Tailwind utility classes. No new dependencies.

## Global Constraints

- No automated test framework exists in this repo. Verification is `npm run typecheck`, `npm run build`, and `npm run lint`.
- Do not run `npm run dev` — verify with typecheck/build/lint and code reading.
- No change to the copy-to-clipboard logic itself (the try/catch, the `navigator.clipboard.writeText` call, the fallback text-selection via `window.getSelection()?.selectAllChildren(target)`) — only how success/fallback is displayed on the button changes.
- This redesign is scoped to the one GitHub Actions workflow copy button — no other button in the app changes.
- Follow the existing icon style already used for `plus`/`trash` in `ICONS` (24x24 viewBox, `fill="none" stroke="currentColor"` inherited from the wrapping `<svg>`, no explicit fill/stroke on individual `<path>`/`<rect>` elements).

---

### Task 1: Icon-only button markup

**Files:**
- Modify: `src/views/html.ts` (the `ICONS` map, and `renderSiteDetail`'s `workflowBlock`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: two new icon keys (`clipboard`, `check`) usable via the existing `icon()` helper. The workflow block's button gains `aria-label="Copy to clipboard"` and two child `<span data-copy-icon="idle">`/`<span data-copy-icon="copied" class="hidden">` elements — consumed by Task 2's client JS. The `<pre>` gains `pr-10` so code text doesn't run under the now-overlaid button.

- [ ] **Step 1: Add the `clipboard` and `check` icons**

Change:

```ts
const ICONS = {
  plus: `<path d="M5 12h14" /><path d="M12 5v14" />`,
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
};
```

to:

```ts
const ICONS = {
  plus: `<path d="M5 12h14" /><path d="M12 5v14" />`,
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />`,
  check: `<path d="M20 6 9 17l-5-5" />`,
};
```

- [ ] **Step 2: Rebuild `workflowBlock`'s markup**

Change:

```ts
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
```

to:

```ts
  const workflowBlock = scaffold
    ? `
        <div class="flex flex-col gap-1 mt-2">
          <span class="text-stone-400/70 uppercase text-[0.75rem] tracking-[0.03em] font-mono">github actions workflow</span>
          <div class="relative">
            <button type="button" class="absolute top-2 right-2 p-1.5 rounded-md bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-50 hover:bg-stone-700 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2" data-copy-target="github-workflow-yaml" aria-label="Copy to clipboard">
              <span data-copy-icon="idle">${icon("clipboard")}</span>
              <span data-copy-icon="copied" class="hidden">${icon("check")}</span>
            </button>
            <pre id="github-workflow-yaml" class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 pr-10 text-[0.8rem] text-stone-50 overflow-x-auto whitespace-pre">${escapeHtml(scaffold.deployWorkflow)}</pre>
          </div>
          <p class="text-stone-400 text-[0.75rem] leading-snug m-0">Paste this into <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">.github/workflows/deploy.yml</code> in your app's repo.</p>
        </div>`
    : "";
```

- [ ] **Step 3: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/views/html.ts
git commit -m "Turn the workflow copy button into an icon overlaid on the code block"
```

---

### Task 2: Update the copy handler's feedback mechanism

**Files:**
- Modify: `public/app.js` (the `[data-copy-target]` click handler)

**Interfaces:**
- Consumes: `[data-copy-icon="idle"]`/`[data-copy-icon="copied"]` spans and `aria-label="Copy to clipboard"` from Task 1.
- Produces: nothing consumed by later tasks — this is the last implementation task.

- [ ] **Step 1: Replace the handler**

Change:

```js
document.querySelectorAll("[data-copy-target]").forEach((button) => {
  const originalLabel = button.textContent;
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      button.textContent = "Copied!";
    } catch {
      // Insecure context (plain http over the LAN, which is how this app is
      // actually deployed — see CLAUDE.md) or clipboard permission denied.
      // navigator.clipboard is undefined outside secure contexts, so even
      // accessing .writeText throws synchronously; select the text so the
      // user can still copy it manually with Ctrl+C.
      window.getSelection()?.selectAllChildren(target);
      button.textContent = "Press Ctrl+C to copy";
    }
    setTimeout(() => {
      button.textContent = originalLabel;
    }, 1500);
  });
});
```

to:

```js
document.querySelectorAll("[data-copy-target]").forEach((button) => {
  const idleIcon = button.querySelector('[data-copy-icon="idle"]');
  const copiedIcon = button.querySelector('[data-copy-icon="copied"]');
  button.addEventListener("click", async () => {
    const target = document.getElementById(button.dataset.copyTarget);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.textContent ?? "");
      button.setAttribute("aria-label", "Copied!");
      idleIcon?.classList.add("hidden");
      copiedIcon?.classList.remove("hidden");
    } catch {
      // Insecure context (plain http over the LAN, which is how this app is
      // actually deployed — see CLAUDE.md) or clipboard permission denied.
      // navigator.clipboard is undefined outside secure contexts, so even
      // accessing .writeText throws synchronously; select the text so the
      // user can still copy it manually with Ctrl+C. No icon change here —
      // the selected/highlighted text is the real signal for this case.
      window.getSelection()?.selectAllChildren(target);
      button.setAttribute("aria-label", "Press Ctrl+C to copy");
    }
    setTimeout(() => {
      button.setAttribute("aria-label", "Copy to clipboard");
      idleIcon?.classList.remove("hidden");
      copiedIcon?.classList.add("hidden");
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
git commit -m "Swap copy-button feedback from text to an icon toggle"
```

---

### Task 3: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: succeeds, produces `dist/` and updated `public/style.css`.

- [ ] **Step 2: Confirm no leftover text-button references**

Run: `grep -n "Copy</button>\|button.textContent" src/views/html.ts public/app.js`
Expected: no output — the old labeled `<button>...Copy</button>` markup and the old `button.textContent` assignments are both fully gone.

- [ ] **Step 3: Confirm the icon/attribute wiring is consistent**

Run: `grep -n "data-copy-icon\|aria-label=\"Copy" src/views/html.ts public/app.js`
Expected: `data-copy-icon="idle"` and `data-copy-icon="copied"` both appear in `src/views/html.ts` and are both queried in `public/app.js`; `aria-label="Copy to clipboard"` appears in both files (as the initial value in the markup and as the reset value in the JS).

- [ ] **Step 4: Hand off for manual QA**

This repo has no automated tests. Leave a note for the user: after this branch is deployed, verify (a) the copy button renders as a small clipboard icon in the top-right corner of the workflow code block, not overlapping the YAML text; (b) clicking it over HTTPS or `localhost` copies the workflow text and briefly shows a checkmark instead of the clipboard icon, reverting after ~1.5s; (c) clicking it over plain HTTP on the LAN (`http://192.168.1.10:<port>`) selects/highlights the code block's text instead (since `navigator.clipboard` is unavailable there) and the button's icon does not change in that case, matching the design's intent that the highlighted text itself is the signal.
