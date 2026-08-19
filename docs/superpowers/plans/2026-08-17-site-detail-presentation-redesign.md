# Site detail page presentation redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the site detail page's presentation — request-path chain, one status vocabulary, permanent manual steps, collapsed deploy fold, danger zone — and fix the `--font-mono` token, using only data the route already has.

**Architecture:** All display logic that has branches moves into one new pure module, `src/lib/siteDisplay.ts`, which is unit-tested. Everything else is markup inside `src/views/html.ts`, rebuilt one section per task so the page keeps working after every commit. `renderSiteDetail` grows an options object instead of more positional parameters. No new routes, no new privileged calls, and `public/app.js` is not touched.

**Tech Stack:** TypeScript, Express 4, server-rendered template strings, Tailwind CSS v4 (CLI, `src/styles/tailwind.css` → `public/style.css`), Node's built-in test runner via `tsx --test`.

## Global Constraints

Every task's requirements implicitly include this section.

- **No new routes, no new `SystemCommands` methods, no new privileged calls.** This plan is presentation only.
- **`public/app.js` must not be modified.** The copy handler is already generic over `data-copy-target`; the deploy fold is a native `<details>`.
- `--font-mono` is exactly `"DM Mono", ui-monospace, "SFMono-Regular", Consolas, monospace`.
- **DM Mono has no weight above 500.** Never combine `font-mono` with `font-semibold` or `font-bold`; use `font-medium`.
- Detail page column is `max-w-[760px] mx-auto w-full` (was `max-w-[640px]`).
- Tone classes, used for both pills and text: `ok` = `text-green-300` / `bg-green-950/60`; `bad` = `text-red-300` / `bg-red-950/60`; `neutral` = `text-stone-300` / `bg-stone-700`.
- **`starting` and `unknown` are `neutral`, never red.** A container running its first health check is not broken, and "could not check" is not a site failure.
- **The words `live` and `down` are retired.** Use the canonical state words from Task 1.
- **Every routing-hop value is derived from `config`, never hardcoded.** Never render a command containing an empty tunnel ID.
- **The remove action has one name: `Remove site`** — on the danger-zone button and on the modal's confirm button.
- Responsive to 375px with no horizontal scroll on `<body>`; wide content scrolls inside its own `overflow-x-auto`. Visible `focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2` on every interactive element. No new animation.
- Escape every interpolated value with the existing `escapeHtml`.

**One documented deviation from the spec:** the spec names the new module `src/lib/siteStatusLabels.ts`. This plan uses `src/lib/siteDisplay.ts` instead and puts both pure display derivations in it (status labels *and* the hostname split), rather than creating two ~30-line modules with near-identical responsibilities.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/siteDisplay.ts` | **Create.** Pure display derivations: the `SiteStatus` type (moved here), `describeStatus()`, `splitHostnameForDisplay()`. No I/O, no HTML. |
| `src/lib/siteDisplay.test.ts` | **Create.** Unit tests for both functions. |
| `src/views/html.test.ts` | **Create.** Calls `renderSiteDetail` directly with constructed `Site` objects and asserts on the returned HTML. |
| `src/views/html.ts` | **Modify.** `layout()` fonts link; `renderSiteDetail` rebuilt section by section; new shared class constants; mono weight fixes. |
| `src/styles/tailwind.css` | **Modify.** The `--font-mono` value only. |
| `src/routes/sites.ts` | **Modify.** Import `SiteStatus` from its new home; pass an options object to `renderSiteDetail`. |
| `CLAUDE.md` | **Modify.** Update the Core v1 feature flow's description of the detail page and the remove-site modal. |

---

## Task 1: Pure display module

**Files:**
- Create: `src/lib/siteDisplay.ts`
- Create: `src/lib/siteDisplay.test.ts`
- Modify: `src/views/html.ts:182-184` (delete the `SiteStatus` type declaration)
- Modify: `src/routes/sites.ts:9` (import `SiteStatus` from its new home)

**Interfaces:**
- Consumes: `ContainerState`, `ContainerHealth` from `src/lib/containerStatus.ts`.
- Produces: `SiteStatus`, `StatusTone`, `StatusLabels`, `HostnameParts`, `describeStatus(status: SiteStatus): StatusLabels`, `splitHostnameForDisplay(hostname: string, domain: string): HostnameParts`. Tasks 3–7 all depend on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/lib/siteDisplay.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeStatus, splitHostnameForDisplay } from "./siteDisplay";

describe("describeStatus", () => {
  test("a healthy running container is ok, and says so on both lines", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running", health: "healthy" }), {
      pill: "running",
      hop: "running · healthy",
      tone: "ok",
    });
  });

  test("a running container with no health data omits health rather than inventing it", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running" }), {
      pill: "running",
      hop: "running",
      tone: "ok",
    });
  });

  test("an unhealthy container leads with unhealthy in the pill", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running", health: "unhealthy" }), {
      pill: "unhealthy",
      hop: "running · unhealthy",
      tone: "bad",
    });
  });

  test("a starting health check is neutral, not a failure", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running", health: "starting" }), {
      pill: "starting",
      hop: "running · health check starting",
      tone: "neutral",
    });
  });

  test("exited, restarting and paused are all bad", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "exited" }), {
      pill: "exited",
      hop: "exited",
      tone: "bad",
    });
    assert.deepEqual(describeStatus({ kind: "container", state: "restarting" }), {
      pill: "restarting",
      hop: "restarting · crash-looping",
      tone: "bad",
    });
    assert.deepEqual(describeStatus({ kind: "container", state: "paused" }), {
      pill: "paused",
      hop: "paused",
      tone: "bad",
    });
  });

  test("a container that was never created reads as not deployed", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "not-created" }), {
      pill: "not deployed",
      hop: "not deployed",
      tone: "bad",
    });
  });

  test("an unreadable container status is neutral — not knowing is not a failure", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "unknown" }), {
      pill: "unknown",
      hop: "can't check",
      tone: "neutral",
    });
  });

  test("tcp checks use responding, never live or down", () => {
    assert.deepEqual(describeStatus({ kind: "tcp", responding: true }), {
      pill: "responding",
      hop: "responding",
      tone: "ok",
    });
    assert.deepEqual(describeStatus({ kind: "tcp", responding: false }), {
      pill: "not responding",
      hop: "not responding",
      tone: "bad",
    });
  });

  test("no state anywhere is described as live or down", () => {
    const states = ["running", "exited", "restarting", "paused", "not-created", "unknown"] as const;
    for (const state of states) {
      const { pill, hop } = describeStatus({ kind: "container", state });
      assert.doesNotMatch(`${pill} ${hop}`, /\b(live|down)\b/);
    }
  });
});

describe("splitHostnameForDisplay", () => {
  test("dims the managed domain suffix on a subdomain", () => {
    assert.deepEqual(splitHostnameForDisplay("blog.lyly.dev", "lyly.dev"), {
      lead: "blog",
      dimmed: ".lyly.dev",
    });
  });

  test("keeps a multi-level subdomain whole in the bright part", () => {
    assert.deepEqual(splitHostnameForDisplay("a.b.lyly.dev", "lyly.dev"), {
      lead: "a.b",
      dimmed: ".lyly.dev",
    });
  });

  test("the apex domain has nothing to dim", () => {
    assert.deepEqual(splitHostnameForDisplay("lyly.dev", "lyly.dev"), {
      lead: "lyly.dev",
      dimmed: "",
    });
  });

  test("a hostname outside the managed domain is left alone", () => {
    assert.deepEqual(splitHostnameForDisplay("lychee.local", "lyly.dev"), {
      lead: "lychee.local",
      dimmed: "",
    });
  });

  test("a hostname that merely ends in the domain's letters is not split", () => {
    assert.deepEqual(splitHostnameForDisplay("notlyly.dev", "lyly.dev"), {
      lead: "notlyly.dev",
      dimmed: "",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/siteDisplay.test.ts`
Expected: FAIL — `Cannot find module './siteDisplay'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/siteDisplay.ts`:

```ts
import type { ContainerHealth, ContainerState } from "./containerStatus";

/**
 * How the detail page learned about a site's liveness. Plain reverse-proxy
 * sites get a raw TCP check; sites scaffolded with a framework get container
 * lifecycle state plus Docker's own health verdict. Static sites get neither,
 * so the route passes no status at all for them.
 *
 * Declared here rather than in the view because describeStatus() below is the
 * only thing that interprets it, and lib must not import from views.
 */
export type SiteStatus =
  | { kind: "tcp"; responding: boolean }
  | { kind: "container"; state: ContainerState; health?: ContainerHealth };

export type StatusTone = "ok" | "bad" | "neutral";

export interface StatusLabels {
  /** Worst-case single word for the header pill, e.g. "unhealthy" over "running". */
  pill: string;
  /** Fuller line for the request-path card's last hop, e.g. "running · unhealthy". */
  hop: string;
  tone: StatusTone;
}

/**
 * One canonical vocabulary for site state, used by both the header pill and
 * the last routing hop so the page can never describe one fact two ways.
 *
 * "starting" and "unknown" are deliberately neutral rather than bad: a
 * container still running its first health check is not broken, and a status
 * we failed to read is not evidence the site is down.
 */
export function describeStatus(status: SiteStatus): StatusLabels {
  if (status.kind === "tcp") {
    return status.responding
      ? { pill: "responding", hop: "responding", tone: "ok" }
      : { pill: "not responding", hop: "not responding", tone: "bad" };
  }

  switch (status.state) {
    case "running":
      if (status.health === "unhealthy") {
        return { pill: "unhealthy", hop: "running · unhealthy", tone: "bad" };
      }
      if (status.health === "starting") {
        return { pill: "starting", hop: "running · health check starting", tone: "neutral" };
      }
      // health === "healthy", or undefined for an image built before the
      // HEALTHCHECK instruction existed — say nothing rather than guess.
      return {
        pill: "running",
        hop: status.health === "healthy" ? "running · healthy" : "running",
        tone: "ok",
      };
    case "exited":
      return { pill: "exited", hop: "exited", tone: "bad" };
    case "restarting":
      return { pill: "restarting", hop: "restarting · crash-looping", tone: "bad" };
    case "paused":
      return { pill: "paused", hop: "paused", tone: "bad" };
    case "not-created":
      return { pill: "not deployed", hop: "not deployed", tone: "bad" };
    case "unknown":
      return { pill: "unknown", hop: "can't check", tone: "neutral" };
  }
}

export interface HostnameParts {
  /** The bright leading part — the whole hostname when there is nothing to dim. */
  lead: string;
  /** The dimmed trailing ".<domain>", or "" when the hostname is the apex domain. */
  dimmed: string;
}

/**
 * Splits a hostname so the page can dim the part that is the same on every
 * site. The apex domain is itself a managed site (isManagedHostname admits
 * config.domain), and it has no subdomain to separate, so it stays whole.
 */
export function splitHostnameForDisplay(hostname: string, domain: string): HostnameParts {
  const suffix = `.${domain}`;
  if (hostname.length > suffix.length && hostname.endsWith(suffix)) {
    return { lead: hostname.slice(0, -suffix.length), dimmed: suffix };
  }
  return { lead: hostname, dimmed: "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/siteDisplay.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Move the type off the view**

In `src/views/html.ts`, delete this declaration (currently lines 182–184):

```ts
export type SiteStatus =
  | { kind: "tcp"; responding: boolean }
  | { kind: "container"; state: ContainerState; health?: ContainerHealth };
```

and add to the imports at the top of the file:

```ts
import type { SiteStatus } from "../lib/siteDisplay";
```

Leave the existing `import type { ContainerHealth, ContainerState } from "../lib/containerStatus";` in place for now — `renderContainerStatusLine` still uses both, and it is deleted in Task 4.

In `src/routes/sites.ts`, change line 9 from:

```ts
import { renderSiteDetail, renderSiteList, renderSiteNotFound, type SiteStatus } from "../views/html";
```

to:

```ts
import { renderSiteDetail, renderSiteList, renderSiteNotFound } from "../views/html";
import type { SiteStatus } from "../lib/siteDisplay";
```

- [ ] **Step 6: Verify nothing else broke**

Run: `npm run typecheck && npm test && npm run lint`
Expected: all pass. No rendered output has changed yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/siteDisplay.ts src/lib/siteDisplay.test.ts src/views/html.ts src/routes/sites.ts
git commit -m "Add pure siteDisplay module with one status vocabulary

describeStatus() replaces the live/down wording with canonical state words and
makes 'starting' and 'unknown' neutral instead of red. splitHostnameForDisplay()
handles the apex domain, which has no subdomain to dim. SiteStatus moves out of
the view so lib never imports from views."
```

---

## Task 2: Fix the `--font-mono` token

**Files:**
- Modify: `src/styles/tailwind.css:6`
- Modify: `src/views/html.ts:21-22` (`SECTION_LABEL`), `:40-43` (fonts link), `:113`, `:114`, `:122`, `:359`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing consumed by later tasks. Independent — but do it before the layout tasks so all later visual checks happen in the real face.

- [ ] **Step 1: Point the token at a real monospace face**

In `src/styles/tailwind.css`, change line 6 from:

```css
  --font-mono: "Nunito", ui-monospace, "SFMono-Regular", Consolas, monospace;
```

to:

```css
  --font-mono: "DM Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
```

- [ ] **Step 2: Load the face**

In `src/views/html.ts`, in `layout()`, replace the stylesheet link href:

```html
  <link
    href="https://fonts.googleapis.com/css2?family=Poetsen+One&family=Nunito:ital,wght@0,400;0,500;0,600;0,700;1,500&family=DM+Mono:wght@300;400;500&display=swap"
    rel="stylesheet"
  />
```

- [ ] **Step 3: Drop every mono weight above 500**

DM Mono stops at 500, so `font-semibold` (600) would synthesize a fake bold. Four label sites and one button:

1. `SECTION_LABEL` — change `font-semibold` to `font-medium`:

```ts
const SECTION_LABEL =
  "font-mono text-[0.7rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-2";
```

2. The site list's "Existing sites" heading — change `font-semibold` to `font-medium`:

```html
<h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0">Existing sites</h2>
```

3. The "Add a site" dialog heading — same change:

```html
<h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Add a site</h2>
```

4. The "Remove site" dialog heading — same change:

```html
<h2 class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
```

5. The "Add site" button on the list page overrides `BUTTON_PRIMARY`'s `font-sans` with `font-mono`, which puts a 600 weight on DM Mono. Drop the override so the button stays in Nunito semibold:

```html
<button type="button" class="${BUTTON_PRIMARY}" data-open-dialog="add-site-dialog">${icon("plus")}Add site</button>
```

- [ ] **Step 4: Rebuild CSS and verify the token took**

Run: `npm run build:css && grep -c "DM Mono" public/style.css`
Expected: a count of at least 1 — the compiled stylesheet now names DM Mono.

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 5: Look at it**

Run: `npm run dev:mock`, open `http://127.0.0.1:8787`, log in with `dev` / `dev`.

Confirm: the **site list** cards' paths and ports, the section heading, and the add-site modal are all genuinely monospaced now (compare digit widths — `1` and `0` should occupy the same width), and no label looks smeared from a synthetic bold. This is the global knock-on the spec called out; the list page must be checked, not only the detail page.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tailwind.css src/views/html.ts public/style.css
git commit -m "Point --font-mono at DM Mono instead of a proportional face

--font-mono was set to Nunito, which is proportional and loaded from Google
Fonts, so it beat the ui-monospace fallbacks and every path, port and command
in the app rendered proportionally. DM Mono caps at weight 500, so the four
font-mono headings drop from font-semibold to font-medium and the Add site
button keeps font-sans."
```

---

## Task 3: Options object and the new header

**Files:**
- Create: `src/views/html.test.ts`
- Modify: `src/views/html.ts` — `renderSiteDetail` signature and header block; add shared constants; delete `STATUS_PILL_LIVE` / `STATUS_PILL_DOWN`
- Modify: `src/routes/sites.ts:74`, `:95` (both `renderSiteDetail` call sites)

**Interfaces:**
- Consumes: `describeStatus`, `splitHostnameForDisplay`, `SiteStatus`, `StatusTone` from Task 1.
- Produces: `SiteDetailOptions`, the `renderSiteDetail(site, opts)` signature, and the constants `DETAIL_WIDTH`, `FOCUS_RING`, `TYPE_PILL_STATIC`, `TYPE_PILL_PROXY`, `TONE_PILL`, plus `copyButton()` — used by Tasks 4–7. `CARD`, `CARD_LABEL`, and `TONE_TEXT` are declared in Task 4, the task that first uses them. Every one of these stays module-private; none is exported.

- [ ] **Step 1: Write the failing test**

Create `src/views/html.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { renderSiteDetail } from "./html";

const OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "c7081f91-61c2-476b-8505-42d219bb6d7e",
  caddyfilePath: "/etc/caddy/Caddyfile",
};

const STATIC_SITE: Site = { hostname: "blog.lyly.dev", type: "static", target: "/var/www/blog.lyly.dev" };
const APEX_SITE: Site = { hostname: "lyly.dev", type: "static", target: "/var/www/lyly.dev" };
const PROXY_SITE: Site = { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" };
const NEXT_SITE: Site = {
  hostname: "app.lyly.dev",
  type: "reverse-proxy",
  target: "3000",
  framework: "nextjs",
  healthcheckPath: "/api/health",
};

describe("renderSiteDetail header", () => {
  test("replaces the back link with a breadcrumb to the site list", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /aria-label="Breadcrumb"/);
    assert.match(html, /<a href="\/"[^>]*>sites<\/a>/);
    assert.doesNotMatch(html, /Back to sites/);
  });

  test("dims the managed domain suffix on a subdomain", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /blog<span class="text-stone-500">\.lyly\.dev<\/span>/);
  });

  test("leaves the apex domain undimmed — it has no subdomain", () => {
    const html = renderSiteDetail(APEX_SITE, OPTS);
    assert.match(html, /id="site-hostname"[^>]*>lyly\.dev</);
    assert.doesNotMatch(html, /<span class="text-stone-500"><\/span>/);
  });

  test("offers Visit as the primary action, opening the real hostname safely", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /href="https:\/\/blog\.lyly\.dev"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  test("wires the hostname copy button to the existing generic handler", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /data-copy-target="site-hostname"/);
    assert.match(html, /id="site-hostname"/);
  });

  test("a static site gets a type pill and no state pill", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, />static</);
    assert.doesNotMatch(html, /data-state-pill/);
  });

  test("a container site's pill uses the canonical state word, not live", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "unhealthy" },
    });
    assert.match(html, /data-state-pill[^>]*>[\s\S]*?unhealthy/);
    assert.doesNotMatch(html, /&#9679; live|>\s*live\s*</);
  });

  test("a plain proxy's pill reports responding", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.match(html, /data-state-pill[^>]*>[\s\S]*?responding/);
  });

  test("widens the column past the old 640px", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /max-w-\[760px\]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — `renderSiteDetail` still takes positional parameters, so TypeScript rejects the object argument and the breadcrumb assertions have nothing to match.

- [ ] **Step 3: Add the shared constants**

In `src/views/html.ts`, delete these two constants (currently lines 26–27):

```ts
const STATUS_PILL_LIVE = `${STATUS_PILL_BASE} text-green-300 bg-green-950/60`;
const STATUS_PILL_DOWN = `${STATUS_PILL_BASE} text-red-300 bg-red-950/60`;
```

and add, next to the existing style constants:

```ts
const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
const DETAIL_WIDTH = "max-w-[760px] mx-auto w-full";
const TYPE_PILL_STATIC = "border-stone-600 text-stone-50 bg-stone-700";
const TYPE_PILL_PROXY = "border-transparent text-rose-300 bg-rose-950";

const TONE_PILL: Record<StatusTone, string> = {
  ok: `${STATUS_PILL_BASE} text-green-300 bg-green-950/60`,
  bad: `${STATUS_PILL_BASE} text-red-300 bg-red-950/60`,
  neutral: `${STATUS_PILL_BASE} text-stone-300 bg-stone-700`,
};
```

Declare **only** these here. `CARD`, `CARD_LABEL`, and `TONE_TEXT` belong to
Task 4, which is where they are first used — declaring them now leaves them
unused, and `npm run lint`'s `no-unused-vars` fails this task's gate. Do not
work around that by exporting them; a module-private constant that nothing
outside the module reads should stay private.

Update the imports at the top of the file:

```ts
import { computeFilesPath, type Site } from "../lib/caddyfile";
import type { ContainerHealth, ContainerState } from "../lib/containerStatus";
import {
  describeStatus,
  splitHostnameForDisplay,
  type SiteStatus,
  type StatusTone,
} from "../lib/siteDisplay";
```

Do not add a `node:path` import yet — nothing uses it until Task 4, and `npm run lint` fails on an unused import.

**On mid-task compile errors:** Step 3 deletes constants whose last uses are removed in Step 5, so the file will not compile between those two steps. That is expected; the gate is Step 7.

- [ ] **Step 4: Add the external-link icon and the copy-button helper**

Add to the `ICONS` object:

```ts
  externalLink: `<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />`,
```

Add this helper below `icon()` — it is exactly the markup already inlined on the workflow YAML block, so the existing `app.js` handler picks it up unchanged:

```ts
/**
 * The copy affordance app.js already understands: it reads the target
 * element's textContent, and falls back to selecting the text when
 * navigator.clipboard is unavailable — which it is here, since this app is
 * served over plain HTTP on the LAN.
 */
function copyButton(targetId: string, label: string, extraClass = ""): string {
  return `<button type="button" class="p-1.5 rounded-md bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-50 hover:bg-stone-700 cursor-pointer ${FOCUS_RING} ${extraClass}" data-copy-target="${targetId}" aria-label="${escapeHtml(label)}">
      <span data-copy-icon="idle">${icon("clipboard")}</span>
      <span data-copy-icon="copied" class="hidden">${icon("check")}</span>
    </button>`;
}
```

- [ ] **Step 5: Change the signature and replace the header**

Add the options type above `renderSiteDetail`:

```ts
export interface SiteDetailOptions {
  sitesRoot: string;
  domain: string;
  tunnelId: string;
  caddyfilePath: string;
  status?: SiteStatus;
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string };
}
```

Add the header renderer above `renderSiteDetail`:

```ts
function renderDetailHeader(site: Site, opts: SiteDetailOptions): string {
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, opts.domain);
  const labels = opts.status ? describeStatus(opts.status) : null;

  return `
      <nav class="font-mono text-[0.72rem] text-stone-500 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5">/</span>
        <span class="text-stone-50">${escapeHtml(site.hostname)}</span>
      </nav>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h2 id="site-hostname" class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0 break-all">${escapeHtml(lead)}${dimmed ? `<span class="text-stone-500">${escapeHtml(dimmed)}</span>` : ""}</h2>
            ${copyButton("site-hostname", "Copy hostname", "shrink-0")}
          </div>
          <div class="flex items-center gap-2 mt-3 flex-wrap">
            <span class="inline-block font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
              site.type === "static" ? TYPE_PILL_STATIC : TYPE_PILL_PROXY
            }">${site.type === "static" ? "static" : "proxy"}</span>
            ${labels ? `<span class="${TONE_PILL[labels.tone]}" data-state-pill>&#9679; ${escapeHtml(labels.pill)}</span>` : ""}
          </div>
        </div>
        <a href="https://${escapeHtml(site.hostname)}" target="_blank" rel="noopener noreferrer" class="${BUTTON_PRIMARY} no-underline shrink-0">Visit ${icon("externalLink")}</a>
      </div>`;
}
```

Now change `renderSiteDetail`'s signature and its header section. Replace the opening of the function:

```ts
export function renderSiteDetail(site: Site, opts: SiteDetailOptions): string {
  const { status, scaffold } = opts;
  const filesPath = computeFilesPath(site, opts.sitesRoot);
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
```

Delete the `isLive`, `downLabel`, and `statusPill` blocks entirely (currently lines 236–250) — `describeStatus` replaces all three.

In the returned template, replace the breadcrumb/heading block (currently the `<p class="m-0"><a href="/">…` line through the closing `</div>` of the hostname row) with:

```ts
    <div class="${DETAIL_WIDTH} flex flex-col gap-5">
      ${renderDetailHeader(site, opts)}
```

and change the outer wrapper's old `max-w-[640px] mx-auto flex flex-col gap-5 w-full` to `${DETAIL_WIDTH} flex flex-col gap-5`. Leave the existing `overviewCard`, `statusCard`, `deployCard`, and remove-site button interpolations in place — Tasks 4–7 replace them one at a time, so the page stays working after this commit.

- [ ] **Step 6: Update both call sites**

In `src/routes/sites.ts`, change the static early return (line 74) from:

```ts
        res.send(renderSiteDetail(site, config.sitesRoot));
```

to:

```ts
        res.send(
          renderSiteDetail(site, {
            sitesRoot: config.sitesRoot,
            domain: config.domain,
            tunnelId: config.tunnelId,
            caddyfilePath: config.caddyfilePath,
          }),
        );
```

and the reverse-proxy return (line 95) from:

```ts
      res.send(renderSiteDetail(site, config.sitesRoot, status, scaffoldCommands));
```

to:

```ts
      res.send(
        renderSiteDetail(site, {
          sitesRoot: config.sitesRoot,
          domain: config.domain,
          tunnelId: config.tunnelId,
          caddyfilePath: config.caddyfilePath,
          status,
          scaffold: scaffoldCommands,
        }),
      );
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsx --test src/views/html.test.ts && npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts src/routes/sites.ts
git commit -m "Give the detail page a real header

Breadcrumb replaces the back link, the hostname is set in mono with the shared
domain suffix dimmed (and the apex left whole), Visit becomes the primary
action, and the pills move to a second line using the canonical state words.
renderSiteDetail takes an options object rather than a fifth positional
parameter."
```

---

## Task 4: Request path card

**Files:**
- Modify: `src/views/html.ts` — add `renderRequestPath()`; delete `renderContainerStatusLine`, `overviewCard`, `statusCard`
- Modify: `src/views/html.test.ts` — add the request-path describe block

**Interfaces:**
- Consumes: `describeStatus`, `SiteDetailOptions` from Task 3; `computeFilesPath` from `src/lib/caddyfile.ts`.
- Produces: `renderRequestPath(site, opts)`, plus the constants `CARD`, `CARD_LABEL` and `TONE_TEXT`, which **Tasks 5 and 6 also use**. Declare them exactly as written here, module-private.

- [ ] **Step 1: Write the failing test**

Append to `src/views/html.test.ts`:

```ts
describe("renderSiteDetail request path", () => {
  test("names all four hops", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    for (const label of ["Cloudflare DNS", "Tunnel", "Caddy", "Your app"]) {
      assert.match(html, new RegExp(label));
    }
  });

  test("marks DNS as a permanent manual step rather than a state", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /manual step/);
  });

  test("derives the tunnel hop from config instead of hardcoding a tunnel name", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /c7081f91/);
    assert.match(html, /cloudflared-sites/);
    assert.doesNotMatch(html, /lychee-sites/);
  });

  test("falls back to the service name when no tunnel id is configured", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.match(html, /cloudflared-sites/);
    // No truncation ellipsis, because there was no id to truncate.
    assert.doesNotMatch(html, /…/);
  });

  test("derives the Caddy hop's path from the configured Caddyfile", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, caddyfilePath: "/opt/caddy/Caddyfile" });
    assert.match(html, /\/opt\/caddy/);
  });

  test("a static site's last hop is its files, and the path is not repeated as a detail row", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /Your files/);
    assert.match(html, /file_server/);
    // Deliberately not a page-wide occurrence count. The remove-confirmation
    // modal — untouched until Task 7 — names this same path in its "Also
    // delete files at ..." label, so the raw path legitimately appears twice
    // on the page. What this guards is the narrower claim: no redundant
    // "files" detail row below the hairline duplicating the hop 4 value.
    assert.doesNotMatch(html, /files<\/span>/);
  });

  // Both colour assertions below are anchored to the hop's own sub-line, not
  // matched page-wide. The header pill renders the same tone class for the
  // same status, so a page-wide `assert.match(html, /text-red-300/)` would
  // still pass if the hop lost its subClass entirely and fell back to the
  // default muted stone — which is exactly the regression this card replaced.
  test("a container site's last hop carries the fuller status line", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "restarting" },
    });
    assert.match(html, /text-red-300[^"]*">● restarting · crash-looping/);
  });

  test("a starting health check is not painted red", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "starting" },
    });
    assert.match(html, /text-stone-300[^"]*">● running · health check starting/);
    assert.doesNotMatch(html, /text-red-300[^"]*">● running/);
  });

  test("shows the healthcheck path for a healthy site, not only when it fails", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /healthcheck/);
    assert.match(html, /\/api\/health/);
  });

  test("a legacy site with no healthcheck comment shows no healthcheck row", () => {
    const legacy: Site = { hostname: "legacy.lyly.dev", type: "reverse-proxy", target: "3001", framework: "nextjs" };
    const html = renderSiteDetail(legacy, { ...OPTS, status: { kind: "container", state: "running" } });
    assert.doesNotMatch(html, /healthcheck/);
    assert.match(html, /Next\.js/);
  });

  test("a plain proxy has no framework, healthcheck or files rows", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } });
    assert.doesNotMatch(html, /framework/);
    assert.doesNotMatch(html, /healthcheck/);
    assert.doesNotMatch(html, /files<\/span>/);
  });

  test("stacks the chain vertically on narrow screens", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /flex-col sm:flex-row/);
  });

  test("drops the old prose status card and its inline remediation hints", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "exited" },
    });
    assert.doesNotMatch(html, /Not responding on localhost/);
    assert.doesNotMatch(html, /Exited on localhost/);
    assert.doesNotMatch(html, /&#9679; Running on localhost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — no hop labels exist yet; the old prose status card is still rendered.

- [ ] **Step 3: Write the implementation**

First add the import Task 3 deliberately left out — `renderRequestPath` needs it for the Caddy hop's sub-line, and it must be `path.posix` so the rendered path uses forward slashes even when a developer runs `dev:mock` on Windows:

```ts
import path from "node:path";
```

Then add the three shared constants Task 3 deliberately left out, because this is the task that first uses them — module-private, not exported:

```ts
const CARD = "bg-stone-800 border border-stone-700 rounded-[10px] p-5";
const CARD_LABEL =
  "font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-stone-400 m-0 mb-3";

const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-green-300",
  bad: "text-red-300",
  neutral: "text-stone-300",
};
```

Then add above `renderSiteDetail` in `src/views/html.ts`:

```ts
interface Hop {
  label: string;
  value: string;
  sub?: string;
  /** Tailwind text-colour class for the sub-line; defaults to muted stone. */
  subClass?: string;
}

const HOP_LABEL =
  "font-mono text-[0.6rem] font-medium uppercase tracking-[0.09em] text-stone-500 m-0 mb-1.5";
const HOP_VALUE = "font-mono text-[0.8rem] text-stone-50 m-0 mb-0.5 break-all";
const DETAIL_ROW = "font-mono text-[0.8rem] m-0 mb-1 flex gap-3 last:mb-0";
const DETAIL_KEY = "text-stone-500 min-w-[7.5rem] shrink-0";

function renderHop(hop: Hop): string {
  return `<div class="flex-1 min-w-0">
            <p class="${HOP_LABEL}">${escapeHtml(hop.label)}</p>
            <p class="${HOP_VALUE}">${escapeHtml(hop.value)}</p>
            ${hop.sub ? `<p class="font-mono text-[0.65rem] ${hop.subClass ?? "text-stone-500"} m-0 break-all">${escapeHtml(hop.sub)}</p>` : ""}
          </div>`;
}

/**
 * The chain a request actually travels, which is the whole point of this app:
 * Cloudflare DNS → the sites tunnel → Caddy → whatever serves the site.
 *
 * Every value is derived from config or the parsed site — the human-readable
 * tunnel name ("lychee-sites") lives only in documentation, never in config,
 * so this shows the tunnel ID and the service name instead of asserting it.
 *
 * Hops 1-3 carry no live state: nothing here verifies them. Hop 1's sub-line
 * says "manual step", which stays true forever rather than going stale the
 * moment a DNS record is created.
 */
function renderRequestPath(site: Site, opts: SiteDetailOptions): string {
  const filesPath = computeFilesPath(site, opts.sitesRoot);
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
  const labels = opts.status ? describeStatus(opts.status) : null;

  const lastHop: Hop =
    site.type === "static"
      ? { label: "Your files", value: "file_server", ...(filesPath ? { sub: filesPath } : {}) }
      : {
          label: "Your app",
          value: `localhost:${site.target}`,
          ...(labels ? { sub: `● ${labels.hop}`, subClass: TONE_TEXT[labels.tone] } : {}),
        };

  const hops: Hop[] = [
    { label: "Cloudflare DNS", value: site.hostname, sub: "manual step" },
    {
      label: "Tunnel",
      value: opts.tunnelId ? `${opts.tunnelId.slice(0, 8)}…` : "cloudflared-sites",
      ...(opts.tunnelId ? { sub: "cloudflared-sites" } : {}),
    },
    { label: "Caddy", value: ":80", sub: path.posix.dirname(opts.caddyfilePath) },
    lastHop,
  ];

  const arrow = `<div class="flex items-center justify-center text-stone-600 text-sm shrink-0 sm:px-3" aria-hidden="true"><span class="sm:hidden">&darr;</span><span class="hidden sm:inline">&rarr;</span></div>`;

  // Static sites carry their path in the last hop, so it is not repeated here.
  const rows = [
    ...(frameworkLabel ? [["framework", frameworkLabel]] : []),
    ...(site.healthcheckPath ? [["healthcheck", site.healthcheckPath]] : []),
    ...(site.type !== "static" && filesPath ? [["files", filesPath]] : []),
  ];

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Request path</h3>
        <div class="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-0">
          ${hops.map((hop) => renderHop(hop)).join(arrow)}
        </div>
        ${
          rows.length
            ? `<div class="h-px bg-stone-700 my-4"></div>
        ${rows
          .map(
            ([key, value]) =>
              `<p class="${DETAIL_ROW}"><span class="${DETAIL_KEY}">${escapeHtml(key)}</span><span class="text-stone-50 break-all">${escapeHtml(value)}</span></p>`,
          )
          .join("\n        ")}`
            : ""
        }
      </section>`;
}
```

- [ ] **Step 4: Remove the old cards**

Delete the entire `renderContainerStatusLine` function (currently lines 186–225) and its now-unused import:

```ts
import type { ContainerHealth, ContainerState } from "../lib/containerStatus";
```

Delete the `overviewCard` and `statusCard` const blocks inside `renderSiteDetail`, and in the returned template replace:

```ts
      ${overviewCard}
      ${statusCard}
```

with:

```ts
      ${renderRequestPath(site, opts)}
```

The `frameworkLabel` local in `renderSiteDetail` is now unused — delete it too (`renderRequestPath` computes its own).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/views/html.test.ts && npm run typecheck && npm test && npm run lint`
Expected: all pass. `lint` catches any leftover unused import or variable.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Draw the request path instead of describing status in prose

Replaces the Overview and Status cards with the four-hop chain the app
actually manages, annotated with real per-site values. The healthcheck path is
now visible on a healthy site rather than only inside a failure message, and
hop values are derived from config rather than hardcoded."
```

---

## Task 5: Manual steps card

**Files:**
- Modify: `src/views/html.ts` — add `renderManualSteps()`
- Modify: `src/views/html.test.ts` — add the manual-steps describe block

**Interfaces:**
- Consumes: `CARD`, `CARD_LABEL`, `copyButton()`, `describeStatus`, `SiteDetailOptions` from Task 3.
- Produces: `renderManualSteps(site, opts)`, plus the `CODE_LINE` constant, which **Task 6 also uses**. Define it exactly as written here.

- [ ] **Step 1: Write the failing test**

Append to `src/views/html.test.ts`:

```ts
describe("renderSiteDetail manual steps", () => {
  test("gives the DNS command permanently, not only in a post-create banner", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(
      html,
      /cloudflared tunnel route dns c7081f91-61c2-476b-8505-42d219bb6d7e blog\.lyly\.dev/,
    );
    assert.match(html, /id="cmd-dns"/);
    assert.match(html, /data-copy-target="cmd-dns"/);
  });

  test("warns that a missing DNS record still reads as running here", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /only checks localhost/);
  });

  test("never emits a command with an empty tunnel id", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, tunnelId: "" });
    assert.doesNotMatch(html, /tunnel route dns\s+[a-z]/);
    assert.doesNotMatch(html, /id="cmd-dns"/);
    assert.match(html, /Cloudflare dashboard/);
  });

  test("a static site's only manual step is DNS", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.doesNotMatch(html, /docker compose up/);
    assert.doesNotMatch(html, /docker compose logs/);
  });

  test("a plain proxy gets no docker step — lyly-admin scaffolded nothing", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: false } });
    assert.doesNotMatch(html, /docker compose/);
  });

  test("a scaffolded site is told to build and start the container itself", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /docker compose up -d --build/);
    assert.match(html, /id="cmd-compose"/);
    assert.match(html, /\/var\/www\/app\.lyly\.dev/);
    assert.match(html, /never starts, stops, or rebuilds/);
  });

  test("a healthy site is not offered the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.doesNotMatch(html, /docker compose logs/);
  });

  test("a broken container adds the logs step", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "exited" } });
    assert.match(html, /docker compose logs/);
    assert.match(html, /id="cmd-logs"/);
  });

  test("an unreadable container status is not treated as broken", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, status: { kind: "container", state: "unknown" } });
    assert.doesNotMatch(html, /docker compose logs/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — no manual-steps markup exists.

- [ ] **Step 3: Write the implementation**

Add above `renderSiteDetail` in `src/views/html.ts`:

```ts
const STEP_NUMBER =
  "font-mono text-[0.625rem] text-rose-400 border border-rose-400/40 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
const STEP_TEXT = "text-stone-400 text-[0.8rem] leading-snug m-0 mb-1.5";
const CODE_LINE =
  "font-mono text-[0.72rem] bg-stone-900 border border-stone-700 rounded-md pl-2.5 pr-10 py-1.5 text-stone-50 overflow-x-auto whitespace-nowrap m-0";

interface ManualStep {
  /** Plain sentence. Escaped at render time — never carries markup. */
  text: string;
  command?: {
    id: string;
    value: string;
    /** Directory the command must run in, shown as a caption beneath it. */
    cwd?: string;
  };
}

function renderStep(step: ManualStep, index: number): string {
  return `<div class="flex gap-3">
          <span class="${STEP_NUMBER}">${index + 1}</span>
          <div class="flex-1 min-w-0">
            <p class="${STEP_TEXT}">${escapeHtml(step.text)}</p>
            ${
              step.command
                ? `<div class="relative">
              <pre id="${step.command.id}" class="${CODE_LINE}">${escapeHtml(step.command.value)}</pre>
              ${copyButton(step.command.id, "Copy command", "absolute top-1 right-1")}
            </div>
            ${step.command.cwd ? `<p class="font-mono text-[0.65rem] text-stone-500 m-0 mt-1">in ${escapeHtml(step.command.cwd)}/</p>` : ""}`
                : ""
            }
          </div>
        </div>`;
}

/**
 * The steps lyly-admin deliberately does not take. DNS is Tier 1 scope — the
 * app never touches Cloudflare DNS — and it never starts, stops, or rebuilds
 * a container. Both used to be one-shot flash banners that vanished on
 * reload; a missing DNS record is permanent state, so it needs a permanent
 * home.
 */
function renderManualSteps(site: Site, opts: SiteDetailOptions): string {
  const filesPath = computeFilesPath(site, opts.sitesRoot);
  const labels = opts.status ? describeStatus(opts.status) : null;
  const containerIsBroken = opts.status?.kind === "container" && labels?.tone === "bad";

  const steps: ManualStep[] = [
    {
      text: opts.tunnelId
        ? "Create the DNS record, once per hostname. Until it exists this page still reports the site running, because lyly-admin only checks localhost."
        : "Create the DNS record, once per hostname — add a CNAME for this hostname to your tunnel from the Cloudflare dashboard. Until it exists this page still reports the site running, because lyly-admin only checks localhost.",
      ...(opts.tunnelId
        ? {
            command: {
              id: "cmd-dns",
              value: `cloudflared tunnel route dns ${opts.tunnelId} ${site.hostname}`,
            },
          }
        : {}),
    },
  ];

  if (site.framework && filesPath) {
    steps.push({
      text: "Build and start the container yourself. lyly-admin never starts, stops, or rebuilds it.",
      command: { id: "cmd-compose", value: "docker compose up -d --build", cwd: filesPath },
    });
  }

  if (site.framework && filesPath && containerIsBroken) {
    steps.push({
      text: "Find out why it stopped.",
      command: { id: "cmd-logs", value: "docker compose logs", cwd: filesPath },
    });
  }

  return `
      <section class="${CARD}">
        <h3 class="${CARD_LABEL}">Manual steps</h3>
        <p class="text-stone-400 text-[0.8rem] leading-snug m-0 mb-4">lyly-admin wires up routing only. These are yours.</p>
        <div class="flex flex-col gap-4">
          ${steps.map((step, index) => renderStep(step, index)).join("\n          ")}
        </div>
      </section>`;
}
```

**Nothing here is interpolated unescaped.** `text` is a plain sentence escaped
by `renderStep`, and a directory a command must run in travels in
`command.cwd`, which `renderStep` escapes and renders as its own caption line
beneath the command. Keep it that way: no `ManualStep` field may carry HTML,
so a later edit cannot accidentally introduce an unescaped interpolation.

- [ ] **Step 4: Render it**

In `renderSiteDetail`'s returned template, add below the request path:

```ts
      ${renderRequestPath(site, opts)}
      ${renderManualSteps(site, opts)}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/views/html.test.ts && npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Give the manual steps a permanent home on the page

The DNS command and the docker compose build were one-shot flash banners that
vanished on reload, and the compose hint was small text inside a red status
paragraph. Both are now numbered, copyable steps, with a third appearing only
when the container is actually broken. Never emits a command containing an
empty tunnel id."
```

---

## Task 6: Collapse the deploy block into a fold

**Files:**
- Modify: `src/views/html.ts` — replace `deployCard` with `renderDeployFold()`; delete `DETAIL_CARD` and `SECTION_LABEL` if unused
- Modify: `src/views/html.test.ts` — add the deploy describe block

**Interfaces:**
- Consumes: `copyButton()`, `FOCUS_RING`, `SiteDetailOptions` from Task 3; `CODE_LINE` from Task 5.
- Produces: `renderDeployFold(scaffold)`, `renderDeployCommand()`, `FOLD_LABEL`. Nothing later depends on them.

- [ ] **Step 1: Write the failing test**

Append to `src/views/html.test.ts`:

```ts
const SCAFFOLD = {
  buildCommand: "npm run build",
  runCommand: "npm start",
  deployWorkflow: "name: Deploy app.lyly.dev\non:\n  push:\n    branches: [main]\n",
};

describe("renderSiteDetail deploy fold", () => {
  test("reference material is collapsed by default", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    assert.match(html, /<details/);
    assert.doesNotMatch(html, /<details[^>]*\sopen[\s>]/);
    assert.match(html, /<summary/);
  });

  test("keeps every deploy command copyable", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    assert.match(html, /npm run build/);
    assert.match(html, /npm start/);
    assert.match(html, /data-copy-target="cmd-build"/);
    assert.match(html, /data-copy-target="cmd-run"/);
    assert.match(html, /data-copy-target="github-workflow-yaml"/);
  });

  test("a site with no scaffold has no fold at all", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.doesNotMatch(html, /<details/);
  });

  test("the summary is keyboard reachable and shows a focus ring", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
      scaffold: SCAFFOLD,
    });
    assert.match(html, /<summary[^>]*focus-visible:outline/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — the deploy block is still an always-open card with no `<details>`.

- [ ] **Step 3: Write the implementation**

Add above `renderSiteDetail` in `src/views/html.ts`:

```ts
// Same look as CARD_LABEL but without its bottom margin — the summary row
// centres its children, so a stray mb-3 would push the label off-axis.
// Do not write `${CARD_LABEL} mb-0`: Tailwind resolves conflicting utilities
// by stylesheet order, not by the order they appear in a class attribute.
const FOLD_LABEL =
  "font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-stone-400 m-0";

function renderDeployCommand(label: string, id: string, value: string): string {
  return `<div class="flex flex-col gap-1">
            <span class="text-stone-500 uppercase text-[0.65rem] tracking-[0.09em] font-mono">${escapeHtml(label)}</span>
            <div class="relative">
              <pre id="${id}" class="${CODE_LINE}">${escapeHtml(value)}</pre>
              ${copyButton(id, `Copy ${label}`, "absolute top-1 right-1")}
            </div>
          </div>`;
}

/**
 * Commands and CI config you consult when setting a site up and rarely after,
 * so this starts closed rather than competing with status you read every
 * visit. A native <details> keeps it keyboard-accessible with no JS.
 */
function renderDeployFold(scaffold: NonNullable<SiteDetailOptions["scaffold"]>): string {
  return `
      <details class="group bg-stone-800 border border-stone-700 rounded-[10px]">
        <summary class="flex items-center gap-2 px-5 py-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden ${FOCUS_RING} rounded-[10px]">
          <span class="text-stone-500 text-[0.6rem] motion-safe:transition-transform group-open:rotate-90" aria-hidden="true">&#9656;</span>
          <span class="${FOLD_LABEL}">Deploy</span>
        </summary>
        <div class="flex flex-col gap-3 px-5 pb-5">
          ${renderDeployCommand("build command", "cmd-build", scaffold.buildCommand)}
          ${renderDeployCommand("run command", "cmd-run", scaffold.runCommand)}
          <div class="flex flex-col gap-1">
            <span class="text-stone-500 uppercase text-[0.65rem] tracking-[0.09em] font-mono">github actions workflow</span>
            <div class="relative">
              <pre id="github-workflow-yaml" class="font-mono bg-stone-900 border border-stone-700 rounded-md px-3 py-2 pr-10 text-[0.72rem] text-stone-50 overflow-x-auto whitespace-pre">${escapeHtml(scaffold.deployWorkflow)}</pre>
              ${copyButton("github-workflow-yaml", "Copy workflow", "absolute top-2 right-2")}
            </div>
            <p class="text-stone-400 text-[0.72rem] leading-snug m-0">Paste this into <code class="font-mono bg-stone-700 rounded px-1.5 py-0.5 text-[0.85em] text-stone-50">.github/workflows/deploy.yml</code> in your app's repo.</p>
          </div>
        </div>
      </details>`;
}
```

- [ ] **Step 4: Swap it in and clean up**

Delete the `deployCard` const block from `renderSiteDetail` and replace its interpolation:

```ts
      ${scaffold ? renderDeployFold(scaffold) : ""}
```

This removes the last use of both `DETAIL_CARD` and `SECTION_LABEL` — each was referenced only by the five detail-page card headings that Tasks 4 and 6 delete, never by `renderSiteList`. **Delete both constant declarations.** Keep `STATUS_PILL_BASE`; `TONE_PILL` still builds on it.

Confirm nothing is left behind:

Run: `grep -c "DETAIL_CARD\|SECTION_LABEL" src/views/html.ts`
Expected: `0`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/views/html.test.ts && npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Collapse the deploy block into a native details fold

Build command, run command and the workflow YAML are reference material read
once at setup, so they no longer compete visually with status read every visit.
Native <details> keeps this keyboard-accessible with no JS, and the build and
run commands gain the copy buttons the YAML block already had."
```

---

## Task 7: Danger zone and the remove modal

**Files:**
- Modify: `src/views/html.ts` — add `renderDangerZone()`; rewrite the `confirm-remove-dialog` body
- Modify: `src/views/html.test.ts` — add the danger describe block

**Interfaces:**
- Consumes: `BUTTON_DANGER`, `BUTTON_SECONDARY`, `CARD_LABEL`, `icon()`, `computeFilesPath` — all pre-existing or from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `src/views/html.test.ts`:

```ts
describe("renderSiteDetail danger zone", () => {
  test("isolates the destructive action in a titled block with its consequence stated", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /Danger/);
    assert.match(html, /reloads Caddy, then restarts the tunnel/);
  });

  test("the remove action keeps one name from button to modal confirm", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    // Scoped to each button's own markup rather than counting the string
    // page-wide: the danger-zone button already read "Remove site" before this
    // task and the modal heading reads it too, so a whole-document count of 2+
    // was satisfied before anything changed. Each regex walks forward from a
    // button's identifying attribute without crossing a </button>, so it can
    // only match that button's own label.
    const labelled = (attr: string) =>
      new RegExp(`${attr}(?:(?!<\\/button>)[\\s\\S])*Remove site<\\/button>`);
    assert.match(html, labelled('data-open-dialog="confirm-remove-dialog"'));
    assert.match(html, labelled('id="confirm-remove-submit"'));
    // The old confirm button said just "Remove".
    assert.doesNotMatch(html, />Remove<\/button>/);
  });

  test("the modal names the sequence, in order", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    for (const step of [
      "Caddyfile block removed",
      "Tunnel route removed",
      "Caddy validated and reloaded",
      "cloudflared-sites restarted",
    ]) {
      assert.match(html, new RegExp(step));
    }
    assert.match(html, /the ones after it don't run/);
  });

  test("a site with files offers the delete checkbox naming the exact path", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /id="confirm-remove-delete-files"/);
    assert.match(html, /\/var\/www\/blog\.lyly\.dev/);
  });

  test("a plain proxy has no directory, so no delete checkbox", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.doesNotMatch(html, /id="confirm-remove-delete-files"/);
  });

  test("a scaffolded site keeps the running-container warning", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "healthy" },
    });
    assert.match(html, /docker compose down/);
    assert.match(html, /won't stop it/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — there is no danger block and the modal does not name the sequence.

- [ ] **Step 3: Write the danger zone**

Add above `renderSiteDetail` in `src/views/html.ts`:

```ts
/**
 * Destructive action, isolated and labelled. The consequence line states what
 * actually happens because the ordering matters: files are a separate second
 * request, so a failed config removal can never cascade into a deletion.
 */
function renderDangerZone(): string {
  return `
      <section class="border border-red-900/60 bg-red-950/20 rounded-[10px] p-5 mt-4 flex items-center justify-between gap-4 flex-wrap">
        <div class="min-w-0">
          <h3 class="font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-red-300 m-0 mb-1.5">Danger</h3>
          <p class="text-stone-400 text-[0.8rem] leading-snug m-0">Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the tunnel. Your DNS record and files stay unless you ask otherwise.</p>
        </div>
        <button type="button" class="${BUTTON_DANGER} shrink-0" data-open-dialog="confirm-remove-dialog">${icon("trash")}Remove site</button>
      </section>`;
}
```

In `renderSiteDetail`'s returned template, replace the bare button:

```ts
      <button type="button" class="${BUTTON_DANGER} self-start" data-open-dialog="confirm-remove-dialog">${icon("trash")}Remove site</button>
```

with:

```ts
      ${renderDangerZone()}
```

- [ ] **Step 4: Rewrite the modal body**

Replace the `<p>` and confirm button inside `confirm-remove-dialog`. The heading, `deleteFilesSection`, Cancel button, `id="confirm-remove-submit"`, and `data-hostname` attribute must all stay exactly as they are — `public/app.js` binds to them.

```ts
      <p class="m-0 mb-3 leading-relaxed">Remove <strong>${escapeHtml(site.hostname)}</strong>? In this order:</p>
      <ol class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 pl-5 grid gap-1 sm:grid-cols-2 list-decimal">
        <li>Caddyfile block removed</li>
        <li>Tunnel route removed</li>
        <li>Caddy validated and reloaded</li>
        <li>cloudflared-sites restarted</li>
      </ol>
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">If a step fails, the ones after it don't run.</p>
      ${deleteFilesSection}
      <div class="flex justify-end gap-2.5">
        <button type="button" class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
        <button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove site</button>
      </div>
```

Also update the scaffolded-site warning inside `deleteFilesSection` so its wording matches the test:

```ts
        ${
          site.framework
            ? `<p class="text-[0.75rem] text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2 leading-snug m-0">
          If a Docker container is running from this directory, stop it first with <code class="font-mono">docker compose down</code> — deleting the files won't stop it.
        </p>`
            : ""
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsx --test src/views/html.test.ts && npm run typecheck && npm test && npm run lint`
Expected: all pass.

- [ ] **Step 6: Verify the remove flow still works end to end**

Run: `npm run dev:mock`, open `http://127.0.0.1:8787/sites/blog.lyly.dev`, click **Remove site**, tick the delete-files box, confirm.

Expected: it redirects to `/?removed=blog.lyly.dev` and the banner reads `Removed blog.lyly.dev. Remember to remove the DNS record in Cloudflare manually.` This proves the `confirm-remove-submit` / `confirm-remove-delete-files` / `data-hostname` bindings in the untouched `app.js` still resolve. Restart to reset the in-memory state.

- [ ] **Step 7: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Isolate remove in a danger zone and name what it does

The remove button was floating at the bottom of the column with no separation.
It now sits in a titled block stating the consequence, and the modal lists the
four steps in the order they run plus the fail-closed guarantee, which the UI
has never communicated. The confirm button is relabelled Remove site so the
action keeps one name from button to modal to banner."
```

---

## Task 8: Whole-page verification and docs

**Files:**
- Modify: `CLAUDE.md` — the Core v1 feature flow's site detail and remove-site descriptions
- Verify only: everything else

**Interfaces:**
- Consumes: the finished page from Tasks 1–7.
- Produces: nothing.

- [ ] **Step 1: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all four pass. `build` also regenerates `public/style.css`.

- [ ] **Step 2: Walk every site variant**

Run: `npm run dev:mock`, log in `dev` / `dev`, and visit each seeded hostname:

| URL | Expect |
|---|---|
| `/sites/lyly.dev` | apex — hostname fully bright, no dimmed suffix; `Your files` hop; no state pill; one manual step |
| `/sites/blog.lyly.dev` | `blog` bright, `.lyly.dev` dimmed; files path in the hop and **not** repeated as a detail row |
| `/sites/api.lyly.dev` | `● not responding` pill; no framework/files rows; no docker steps; no fold |
| `/sites/app.lyly.dev` | `● running` pill, hop reads `● running · healthy`; framework + healthcheck `/api/health` + files rows; steps 1 and 2 only; closed `Deploy` fold |
| `/sites/legacy.lyly.dev` | framework row but **no** healthcheck row; hop still reads `running · healthy` |
| `/` | list page reads correctly in DM Mono |

Two things about what the fakes do, so these expectations aren't misread as bugs:

- `src/dev/fakes.ts:112` hardcodes `checkContainerStatus` to `{ state: "running", health: "healthy" }`, so **both Next.js sites always look healthy in dev mode** and step 3 never appears. Every bad-state branch is covered by the unit tests from Tasks 1, 4 and 5. To see one in the browser, temporarily edit that line to e.g. `{ state: "exited" }` and reload — then revert it.
- `checkPortOpen` is *not* faked (`routes/sites.ts` imports it directly rather than through `deps`), so `api.lyly.dev` does a real TCP connect to `127.0.0.1:4000` on your own machine. It reads `not responding` unless you happen to have something listening there.

- [ ] **Step 3: Check the quality floor**

On `/sites/app.lyly.dev`:

- Narrow the window to 375px. The chain stacks vertically with `↓` arrows, no horizontal scrollbar appears on the page itself, and the command blocks scroll inside their own boxes.
- Press Tab from the top. Focus ring is visible on: breadcrumb `sites` link → hostname copy button → `Visit` → each command's copy button → the `Deploy` summary → `Remove site`.
- Press Enter on the `Deploy` summary. It opens and the chevron rotates.
- Click a command's copy button. Because dev mode is served over plain HTTP, `navigator.clipboard` is undefined, so expect the fallback: the command text becomes selected and the button's `aria-label` becomes `Press Ctrl+C to copy`. No icon change in that path — that is correct existing behaviour.
- With OS "reduce motion" enabled, the chevron does not animate.

- [ ] **Step 4: Update CLAUDE.md**

In the **Core v1 feature flow** section, replace item 3's UI description so it matches the shipped modal, and extend item 1/2 where they describe the detail page. Apply these edits:

Item 3's first sentence becomes:

```
3. **Remove a site** — the UI is a single confirm-remove modal that lists the
   four steps in the order they run (Caddyfile block → tunnel route → validate
   and reload Caddy → restart `cloudflared-sites`) and states that a failed step
   stops the ones after it; it includes an "also delete site files" checkbox
   showing the exact path for static sites and for Next.js-scaffolded
   reverse-proxy sites alike
```

Add a new paragraph at the end of the **Core v1 feature flow** section:

```
The site detail page states the request path as a four-hop chain (Cloudflare
DNS → the `lychee-sites` tunnel → Caddy → the site's files or local port),
annotated with values derived from `config` — hops 1–3 carry no live state.
Status uses one canonical vocabulary shared by the header pill and the last
hop (`running`, `unhealthy`, `starting`, `exited`, `restarting`, `paused`,
`not deployed`, `unknown`, and `responding` / `not responding` for plain
proxies); `starting` and `unknown` are neutral, not red. The DNS command and
`docker compose up -d --build` are permanent numbered steps on the page rather
than one-shot flash banners, with `docker compose logs` appearing only when a
container is actually broken. Deploy commands and the workflow YAML sit in a
`<details>` fold, closed by default.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the redesigned site detail page in CLAUDE.md

The remove-site modal now lists its four steps and the fail-closed guarantee,
and the detail page states the request path with one status vocabulary."
```

- [ ] **Step 6: Request a whole-branch review**

Use the `superpowers:requesting-code-review` skill for a final review across all of Tasks 1–8 before merging, per CLAUDE.md's development workflow.

---

## Notes for the implementer

- **`public/app.js` is never edited.** If a task seems to need it, the markup is wrong: the copy handler needs `data-copy-target="<id>"` on the button plus a matching `id` on the element and the two `data-copy-icon` spans; the fold needs no JS at all.
- **`renderSiteList` is out of scope.** It changes appearance only as a side effect of the `--font-mono` fix in Task 2. Do not restructure it.
- **The remove flow's request sequence does not change.** `POST /sites/:hostname/delete` followed by a separate `POST /sites/:hostname/delete-files` stays exactly as it is; only the modal's wording changes.
- **`escapeHtml` every interpolated value, with no exceptions.** No data-carrying type in this plan may hold HTML; `ManualStep` in particular splits prose (`text`) from a path (`command.cwd`) precisely so the renderer escapes both.
- `npm test` uses `tsx --test` with Node's default discovery, so new `*.test.ts` files anywhere under `src/` are picked up with no config change. `tsconfig.build.json` already excludes them from `dist/`.
