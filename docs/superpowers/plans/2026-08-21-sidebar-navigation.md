# Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed left sidebar carrying a site switcher and a flat nav, and move the add-site form out of its modal onto its own page at `/sites/new`.

**Architecture:** The view layer splits into three files — `shared.ts` (escaping, class-name constants, icons), `shell.ts` (the page shell, rail and switcher), and `html.ts` (the page renderers). Every page renderer passes a `Nav` object into `layout()`; the site list it contains comes from the Caddyfile parse the routes already perform, so this change adds no filesystem reads, no subprocess calls, and no status checks. The switcher is a native `<details>`/`<summary>` disclosure whose panel is a list of links.

**Tech Stack:** TypeScript, Express 4, server-rendered template strings, Tailwind 4 (CLI, no PostCSS), vanilla JS in `public/app.js`, `tsx --test` (Node's built-in test runner).

**Spec:** `docs/superpowers/specs/2026-08-21-sidebar-navigation-design.md`

## Global Constraints

- **Desktop only.** No collapse, no hamburger, no off-canvas drawer, no breakpoint behavior for the rail. Do not add responsive variants to rail classes.
- **No status checks in the rail.** The switcher may read only `hostname`, `type` and `target` off `Site`. Never call `checkPortOpen`, `checkContainerStatus`, or anything else that probes liveness for the rail.
- **No new filesystem reads, subprocess calls, or dependencies.** Every route already reads the Caddyfile; reuse that parse.
- **`Site` is the only site type.** Do not introduce a `NavSite` or any mapping layer. Import `Site` from `src/lib/caddyfile`.
- **Tailwind has no built-in `aria-current` variant.** Its `aria-*` shorthands are busy, checked, disabled, expanded, hidden, pressed, readonly, required and selected only. Use the arbitrary form `aria-[current=page]:` for active-state styling.
- **Every dynamic value interpolated into HTML goes through `escapeHtml`.** No exceptions in new markup.
- **`POST /sites` does not change** — same request shape, same JSON response, same ordering guarantees. Its existing tests must pass untouched.
- **Copy is fixed by the spec.** The three `?created=1` banner strings in Task 4 are exact; do not reword them.

---

### Task 1: Split the view layer

`src/views/html.ts` is 585 lines. Before adding a rail, a switcher and a new page to it, pull out the two pieces both it and the new shell need. **This task is a pure move: no behavior changes, no new tests.** Its gate is that the existing suite passes untouched.

**Files:**
- Create: `src/views/shared.ts`
- Create: `src/views/shell.ts`
- Modify: `src/views/html.ts` (remove the moved code, add imports)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `src/views/shared.ts` exports `escapeHtml(value: string): string`, `icon(name: keyof typeof ICONS): string`, `ICONS`, and the class-name constants `BUTTON_PRIMARY`, `BUTTON_SECONDARY`, `BUTTON_DANGER`, `INPUT`, `FORM_LABEL`, `STATUS_PILL_BASE`, `FOCUS_RING`, `DETAIL_WIDTH`, `TYPE_PILL_STATIC`, `TYPE_PILL_PROXY`, `CARD`, `CARD_LABEL`, `TONE_PILL`, `TONE_TEXT`.
  - `src/views/shell.ts` exports `layout(title: string, body: string): string`.

- [ ] **Step 1: Create `src/views/shared.ts` by moving code out of `html.ts`**

Move these verbatim from `src/views/html.ts`: `escapeHtml`, all the class-name constants listed above, `TONE_PILL`, `TONE_TEXT`, `ICONS`, and `icon`. Add `export` to each. `TONE_PILL` and `TONE_TEXT` need `StatusTone`:

```ts
import type { StatusTone } from "../lib/siteDisplay";
```

Do not move `copyButton` — it is used only by the detail page and stays in `html.ts`.

- [ ] **Step 2: Create `src/views/shell.ts` by moving `layout` out of `html.ts`**

Move the `layout` function verbatim. Its only dependency is `escapeHtml`:

```ts
import { escapeHtml } from "./shared";

export function layout(title: string, body: string): string {
  // ...body moved unchanged from html.ts
}
```

- [ ] **Step 3: Update `src/views/html.ts` imports**

Delete the moved declarations. Add at the top, after the existing imports:

```ts
import { layout } from "./shell";
import {
  escapeHtml,
  icon,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  BUTTON_DANGER,
  INPUT,
  FORM_LABEL,
  FOCUS_RING,
  DETAIL_WIDTH,
  TYPE_PILL_STATIC,
  TYPE_PILL_PROXY,
  CARD,
  CARD_LABEL,
  TONE_PILL,
  TONE_TEXT,
} from "./shared";
```

Drop any of these that `html.ts` turns out not to reference — `npm run lint` will flag unused imports.

- [ ] **Step 4: Verify nothing changed**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass, with the same test count as before this task. A pure move that changes rendered output will show up as a failure in `src/views/html.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/views/shared.ts src/views/shell.ts src/views/html.ts
git commit -m "Split the view layer before growing it

html.ts was 585 lines and this branch adds a rail, a switcher and a new
page to it. shared.ts takes the escaping, class-name constants and icons
both files need; shell.ts takes the page shell the rail is about to live
in. No rendered output changes."
```

---

### Task 2: The rail

Add the fixed sidebar with one nav item (`All sites`) and the brand mark, and thread a `Nav` object through every page renderer. The switcher and the `Add site` item arrive in later tasks — `Add site` waits for Task 3 because that is when its destination exists.

**Files:**
- Modify: `src/views/shell.ts`
- Modify: `src/views/html.ts` (three `layout()` call sites, two signatures)
- Modify: `src/routes/sites.ts` (`GET /sites/:hostname`, both `renderSiteDetail` calls and the 404)
- Create: `src/views/shell.test.ts`

**Interfaces:**
- Consumes: `layout(title, body)` and `escapeHtml`/`icon` from Task 1.
- Produces:
  - `shell.ts` exports `interface Nav { sites: Site[]; active?: string; page?: "sites" | "new" }` and `interface LayoutOptions { nav: Nav }`, and `layout(title: string, body: string, opts: LayoutOptions): string`.
  - `html.ts`: `renderSiteDetail(site, opts)` where `SiteDetailOptions` gains `sites: Site[]`; `renderSiteNotFound(hostname: string, sites: Site[]): string`. `renderSiteList`'s signature is **unchanged**.
  - `Nav.sites` is threaded but not yet read — Task 5's switcher consumes it. Do not destructure it in `renderRail`, or lint will flag it unused.

- [ ] **Step 1: Write the failing tests**

Create `src/views/shell.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { renderSiteList, renderSiteDetail, renderSiteNotFound } from "./html";

const SITES: Site[] = [
  { hostname: "blog.lyly.dev", type: "static", target: "/var/www/blog.lyly.dev" },
  { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" },
  { hostname: "app.lyly.dev", type: "reverse-proxy", target: "3000", framework: "nextjs" },
];

const DETAIL_OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  caddyfilePath: "/etc/caddy/Caddyfile",
  sites: SITES,
};

/**
 * Every rail assertion is scoped to this slice rather than run against the
 * whole document. A page-wide match proves nothing here: "All sites" would
 * also be satisfied by the breadcrumb, and a hostname appears in the detail
 * page's heading, breadcrumb, Visit link and request-path hops. The regex is
 * non-greedy and the rail does not nest, so it captures exactly the rail.
 */
function rail(html: string): string {
  const match = /<aside id="site-nav"[\s\S]*?<\/aside>/.exec(html);
  assert.ok(match, "expected a rail with id=site-nav");
  return match[0];
}

describe("the rail", () => {
  test("renders on the site list", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    assert.match(html, /All sites/);
  });

  test("renders on a site detail page", () => {
    const html = rail(renderSiteDetail(SITES[0], DETAIL_OPTS));
    assert.match(html, /All sites/);
  });

  test("renders on the not-found page", () => {
    const html = rail(renderSiteNotFound("nope.lyly.dev", SITES));
    assert.match(html, /All sites/);
  });

  /**
   * Scoped to the nav block, not the whole rail: Task 5 adds a switcher whose
   * active row also carries aria-current, so a rail-wide assertion here would
   * start passing for the wrong reason on a detail page.
   */
  function navBlock(html: string): string {
    const match = /<nav id="nav-pages"[\s\S]*?<\/nav>/.exec(rail(html));
    assert.ok(match, "expected a nav with id=nav-pages");
    return match[0];
  }

  test("marks All sites current on the list page only", () => {
    assert.match(navBlock(renderSiteList(SITES, "lyly.dev", "/var/www")), /aria-current="page"/);
    assert.doesNotMatch(navBlock(renderSiteDetail(SITES[0], DETAIL_OPTS)), /aria-current="page"/);
  });

  test("carries the brand, which the page header no longer does", () => {
    const html = renderSiteList(SITES, "lyly.dev", "/var/www");
    assert.match(rail(html), /lyly<span class="text-rose-400">\.<\/span>admin/);
    assert.doesNotMatch(html, /<header/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/views/shell.test.ts`
Expected: FAIL. First on TypeScript rejecting the `sites` key in `DETAIL_OPTS` and the second argument to `renderSiteNotFound`; then, once those compile, on `expected a rail with id=site-nav`.

- [ ] **Step 3: Add `Nav`, `LayoutOptions` and the rail to `shell.ts`**

```ts
import type { Site } from "../lib/caddyfile";
import { escapeHtml, icon, FOCUS_RING } from "./shared";

export interface Nav {
  /** Every managed site, for the switcher. Read by renderSwitcher. */
  sites: Site[];
  /** Hostname of the site being viewed, if any — highlights it in the switcher. */
  active?: string;
  /** Which flat nav item is current. Absent on a site detail page. */
  page?: "sites" | "new";
}

export interface LayoutOptions {
  nav: Nav;
}

const NAV_ITEM =
  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.85rem] no-underline text-stone-400 ` +
  `hover:bg-stone-700/60 hover:text-stone-50 ` +
  `aria-[current=page]:bg-rose-950/60 aria-[current=page]:text-rose-300 ${FOCUS_RING}`;

function navItem(href: string, label: string, iconName: "layoutGrid" | "plus", current: boolean): string {
  return `<a href="${href}" class="${NAV_ITEM}"${current ? ` aria-current="page"` : ""}>${icon(iconName)}${escapeHtml(label)}</a>`;
}

function renderRail(nav: Nav): string {
  return `
  <aside id="site-nav" class="w-[220px] shrink-0 bg-stone-800 border-r border-stone-700 flex flex-col gap-4 px-3 py-4" aria-label="Site navigation">
    <nav id="nav-pages" class="flex flex-col gap-0.5" aria-label="Pages">
      ${navItem("/", "All sites", "layoutGrid", nav.page === "sites")}
    </nav>
    <div class="border-t border-dashed border-stone-700 mx-1" aria-hidden="true"></div>
    <div class="flex-1"></div>
    <p class="font-display text-[0.8rem] text-stone-500 m-0 px-2.5">lyly<span class="text-rose-400">.</span>admin</p>
  </aside>`;
}
```

- [ ] **Step 4: Rewrite `layout` around the rail**

Replace the `<body>` through `</body>` region. The `<head>` is unchanged. The old `<header>` block and its wordmark are **deleted** — the brand now lives in the rail's footer.

```ts
export function layout(title: string, body: string, opts: LayoutOptions): string {
  return `<!doctype html>
<html lang="en" class="[color-scheme:dark]">
<head>
  <!-- unchanged -->
</head>
<body class="min-h-screen bg-stone-900 font-sans text-stone-50 m-0 flex">
  ${renderRail(opts.nav)}
  <div class="flex-1 min-w-0 px-6 pb-16">
    <main class="max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6">
      <div id="flash-banner" class="hidden fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3" role="status" aria-live="polite">
        <span id="flash-banner-message"></span>
        <button type="button" id="flash-banner-close" class="hidden shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none" aria-label="Dismiss">&times;</button>
      </div>
      ${body}
    </main>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;
}
```

- [ ] **Step 5: Add the two new icons to `src/views/shared.ts`**

```ts
  chevronDown: `<path d="m6 9 6 6 6-6" />`,
  layoutGrid: `<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />`,
```

`chevronDown` is unused until Task 5. It is added here so `shared.ts` is touched once.

- [ ] **Step 6: Thread `Nav` through the three page renderers in `html.ts`**

`renderSiteList` — signature unchanged; it derives the nav from the `sites` it already has:

```ts
  return layout("Sites", `...unchanged body...`, { nav: { sites, page: "sites" } });
```

`SiteDetailOptions` gains one field:

```ts
export interface SiteDetailOptions {
  sitesRoot: string;
  domain: string;
  tunnelId: string;
  tunnelConfigPath: string;
  caddyfilePath: string;
  status?: SiteStatus;
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string };
  /** Every managed site, for the rail's switcher. */
  sites: Site[];
}
```

and `renderSiteDetail`'s `layout` call becomes:

```ts
  return layout(site.hostname, `...unchanged body...`, {
    nav: { sites: opts.sites, active: site.hostname },
  });
```

`renderSiteNotFound` takes the list and passes it with no active item, so its switcher is a recovery path from a mistyped URL:

```ts
export function renderSiteNotFound(hostname: string, sites: Site[]): string {
  return layout("Site not found", `...unchanged body...`, { nav: { sites } });
}
```

- [ ] **Step 7: Keep the parsed list in `GET /sites/:hostname`**

In `src/routes/sites.ts`, replace the discard-all-but-one parse:

```ts
const sites = caddyfile.parseSites(content).filter((s) => isManagedHostname(s.hostname));
const site = sites.find((s) => s.hostname === hostname);
```

Then add `sites` to both `renderSiteDetail` calls in that route (the static branch and the reverse-proxy branch), and pass it to the 404:

```ts
res.status(404).send(renderSiteNotFound(hostname, sites));
```

The `catch` block's `renderSiteList([], config.domain, config.sitesRoot, message)` stays exactly as it is: the Caddyfile read failed, so an empty rail is the honest result.

- [ ] **Step 8: Give the existing detail tests the new required field**

`SiteDetailOptions.sites` is required, so `src/views/html.test.ts` will not
compile until its shared `OPTS` object has it. Add a realistic list rather than
`[]`, so those tests exercise a populated switcher once Task 5 lands:

```ts
const OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  caddyfilePath: "/etc/caddy/Caddyfile",
  sites: [STATIC_SITE, APEX_SITE, PROXY_SITE, NEXT_SITE],
};
```

This must move below the `STATIC_SITE`/`APEX_SITE`/`PROXY_SITE`/`NEXT_SITE`
declarations, which currently sit after `OPTS` — `const` is not hoisted, so
leaving it above throws at module load.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx tsx --test src/views/shell.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 10: Run the whole suite and the build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass. `src/views/html.test.ts` may still fail if any assertion depended on the deleted `<header>`; if so, fix those assertions rather than restoring the header.

- [ ] **Step 11: Commit**

```bash
git add src/views/shell.ts src/views/shell.test.ts src/views/html.ts src/views/html.test.ts src/views/shared.ts src/routes/sites.ts
git commit -m "Add a fixed rail, and thread the site list to every page

The detail route already parsed the whole Caddyfile and kept one entry, so
the rail's data costs nothing new: filter-then-find replaces find, and the
list rides along in the options object renderSiteDetail already takes.

The py-10 wordmark header is gone. On a single-operator tool the brand does
not earn the page's most prominent slot, so it becomes a dim footer mark in
the rail and the switcher takes the top."
```

---

### Task 3: The add-site page

Move the add-site form out of `#add-site-dialog` onto `/sites/new`, and add the rail's `Add site` item now that its destination exists.

**Files:**
- Modify: `src/views/html.ts` (delete the dialog and its trigger, add `renderAddSite`)
- Modify: `src/views/shell.ts` (`Add site` nav item)
- Modify: `src/routes/sites.ts` (`computePortOwners`, `GET /sites/new`)
- Modify: `public/app.js`
- Modify: `src/views/shell.test.ts`, `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `Nav`/`LayoutOptions`/`layout` from Task 2.
- Produces: `renderAddSite(sites: Site[], domain: string, portOwners: Record<string, string>): string` exported from `html.ts`; `computePortOwners(sites: Site[]): Record<string, string>` module-private in `routes/sites.ts`.

> **Route ordering matters.** Express matches in registration order, so `GET /sites/new` MUST be registered before `GET /sites/:hostname`. Registered after, `/sites/new` is captured as a hostname, fails `isManagedHostname`, and 404s.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/shell.test.ts`:

```ts
import { renderAddSite } from "./html";

const PORT_OWNERS = { "8787": "reserved (lyly-admin itself)", "4000": "api.lyly.dev" };

describe("the add-site page", () => {
  test("renders the fields that used to live in the dialog", () => {
    const html = renderAddSite(SITES, "lyly.dev", PORT_OWNERS);
    assert.match(html, /name="hostname"/);
    assert.match(html, /name="type"[^>]*value="static"/);
    assert.match(html, /name="type"[^>]*value="reverse-proxy"/);
    assert.match(html, /id="port-field"/);
    assert.match(html, /id="framework-field"/);
    assert.match(html, /id="healthcheck-field"/);
    assert.match(html, /id="port-owners-data"/);
  });

  test("posts to the unchanged endpoint", () => {
    assert.match(renderAddSite(SITES, "lyly.dev", PORT_OWNERS), /action="\/sites"/);
  });

  test("marks Add site current, and All sites not", () => {
    const html = rail(renderAddSite(SITES, "lyly.dev", PORT_OWNERS));
    assert.match(html, /href="\/sites\/new"[^>]*aria-current="page"/);
    assert.doesNotMatch(html, /href="\/"[^>]*aria-current="page"/);
  });

  test("the list page no longer carries the dialog", () => {
    const html = renderSiteList(SITES, "lyly.dev", "/var/www");
    assert.doesNotMatch(html, /add-site-dialog/);
    assert.doesNotMatch(html, /id="add-site-form"/);
  });

  test("the list page's own Add site button became a link", () => {
    // The rail carries its own "Add site" link, so this must assert against
    // the page body with the rail removed — otherwise it passes on the rail's
    // item whether or not the header button was ever converted.
    const body = renderSiteList(SITES, "lyly.dev", "/var/www").replace(
      /<aside id="site-nav"[\s\S]*?<\/aside>/,
      "",
    );
    assert.match(body, /<a href="\/sites\/new"[^>]*>(?:(?!<\/a>)[\s\S])*Add site<\/a>/);
    assert.doesNotMatch(body, /data-open-dialog="add-site-dialog"/);
  });
});
```

Add to `src/routes/sites.test.ts`:

```ts
describe("GET /sites/new", () => {
  test("serves the add-site form with port-conflict data", async () => {
    const response = await request("/sites/new");
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /id="add-site-form"/);
    assert.match(body, /id="port-owners-data"/);
    // 4000 is api.lyly.dev in the fixture; 8787 is lyly-admin's own PORT.
    assert.match(body, /api\.lyly\.dev/);
    assert.match(body, /8787/);
  });

  test("is not mistaken for a hostname by the detail route", async () => {
    const body = await (await request("/sites/new")).text();
    assert.doesNotMatch(body, /No managed site found/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/views/shell.test.ts src/routes/sites.test.ts`
Expected: FAIL — `renderAddSite` is not exported, and `/sites/new` returns the not-found page.

- [ ] **Step 3: Add the `Add site` nav item**

In `src/views/shell.ts`, inside `renderRail`'s `<nav>`, after the `All sites` item:

```ts
      ${navItem("/sites/new", "Add site", "plus", nav.page === "new")}
```

- [ ] **Step 4: Move the form into `renderAddSite`**

In `src/views/html.ts`, delete the entire `<dialog id="add-site-dialog">…</dialog>` block from `renderSiteList`, and change its header button to a link:

```ts
        <a href="/sites/new" class="${BUTTON_PRIMARY} no-underline">${icon("plus")}Add site</a>
```

Then add the new page renderer. The form markup, including the two radio cards and the conditional `.port-input` block, moves **verbatim** from the dialog — the only changes are the wrapper and the removal of the Cancel button's `data-close-dialog`:

```ts
export function renderAddSite(
  sites: Site[],
  domain: string,
  portOwners: Record<string, string>,
): string {
  return layout(
    "Add a site",
    `
    <div class="max-w-[640px] w-full flex flex-col gap-5">
      <nav class="font-mono text-[0.72rem] text-stone-500 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5">/</span>
        <span class="text-stone-50">new</span>
      </nav>

      <h2 class="font-mono text-[1.35rem] text-stone-50 m-0">Add a site</h2>

      <form id="add-site-form" method="post" action="/sites" class="flex flex-col gap-5">
        <!-- MOVE VERBATIM from the deleted dialog's form: everything from the
             `<label class="${FORM_LABEL}">Hostname` block through the
             `<script type="application/json" id="port-owners-data">` tag,
             inclusive. That is the hostname label, the type fieldset with both
             radio cards, and the `.port-input` block holding port, framework
             and healthcheck-path. Do not retype it and do not restyle it. -->

        <p id="add-site-error" class="hidden font-mono text-[0.8rem] text-red-300 bg-red-950/60 border border-red-400/70 rounded-md px-3 py-2 m-0"></p>

        <div class="flex justify-end gap-2.5">
          <a href="/" class="${BUTTON_SECONDARY} no-underline">Cancel</a>
          <button type="submit" id="add-site-submit" class="${BUTTON_PRIMARY}">Add site</button>
        </div>
      </form>
    </div>
    `,
    { nav: { sites, page: "new" } },
  );
}
```

The form is no longer inside a `w-[min(460px,…)]` box, so the radio cards' explanatory text and the healthcheck help text get their natural width. Keep every `id` and `name` exactly as it was — `public/app.js` selects on `#port-field`, `#framework-field`, `#healthcheck-field-wrapper`, `#port-owners-data`, `.port-input`, `.port-error`, `input[name="type"]`, `#add-site-form` and `#add-site-error`.

- [ ] **Step 5: Add the route**

In `src/routes/sites.ts`, extract the port-owners computation that `GET /` performs inline:

```ts
function computePortOwners(sites: Site[]): Record<string, string> {
  const portOwners: Record<string, string> = {
    [String(config.port)]: "reserved (lyly-admin itself)",
    [String(CADDY_ADMIN_PORT)]: "reserved (Caddy admin API)",
  };
  for (const site of sites) {
    if (site.type === "reverse-proxy") portOwners[site.target] = site.hostname;
  }
  return portOwners;
}
```

This needs `import type { Site } from "../lib/caddyfile"` if the file does not already have it. Call it from `GET /` in place of the inline block, then register the new route **above** `GET /sites/:hostname`:

```ts
  sitesRouter.get("/sites/new", (req, res) => {
    const content = deps.fs.readFile(config.caddyfilePath);
    const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname));
    res.send(renderAddSite(sites, config.domain, computePortOwners(sites)));
  });
```

Add `renderAddSite` to the existing import from `../views/html`.

- [ ] **Step 6: Rewire `public/app.js`**

Delete `refreshSitesGrid` entirely — its only caller is the add-site success path, and a full navigation replaces it. Delete the `addSiteDialog` constant and its `close` listener (there is no dialog to reset; a fresh page load does it). Then replace the submit handler's success branch:

```js
    if (!response.ok) throw new Error(result.error ?? "Failed to add site");

    // Land on the new site's own page: its Manual steps already states the
    // DNS command permanently, and a full navigation leaves the rail's
    // switcher listing the site we just created.
    window.location.href = `/sites/${encodeURIComponent(result.hostname)}?created=1`;
    return;
```

Delete the `portOwners[result.target] = result.hostname` line and the `scaffoldNote` / `showBanner(...)` block that followed it — Task 4 renders that message server-side.

Add the param strip beside the existing `?removed=` handling, so a reload does not re-announce the add:

```js
if (new URLSearchParams(window.location.search).has("created")) {
  history.replaceState(null, "", window.location.pathname);
}
```

The `[data-open-dialog]` and `[data-close-dialog]` generic handlers stay — the confirm-remove dialog still uses them.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx tsx --test src/views/shell.test.ts src/routes/sites.test.ts`
Expected: PASS. The existing `POST /sites` tests must be green and unmodified.

- [ ] **Step 8: Run the whole suite and the build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass. Fix any `html.test.ts` assertion that referenced `add-site-dialog`.

- [ ] **Step 9: Commit**

```bash
git add src/views/html.ts src/views/shell.ts src/views/shell.test.ts src/routes/sites.ts src/routes/sites.test.ts public/app.js
git commit -m "Move add-site out of its modal onto /sites/new

Sixty lines of form in a 460px box, including the only explanation in the
app of static-vs-proxy and what the framework picker does. A page gives it
its natural width, and makes every rail item a real destination rather than
one of them opening a modal that pages other than / do not render.

POST /sites is untouched. Success now navigates to the new site's own page,
which deletes refreshSitesGrid outright: its only caller was this path, and
a full navigation refreshes the rail that a client-side grid swap would
have left stale."
```

---

### Task 4: The `?created=1` banner

The detail page you land on after adding a site reports an honest status, and for two of the three site types that status is not yet working. Give the banner the job of explaining the pill it arrives beside.

**Files:**
- Modify: `src/views/shell.ts` (`LayoutOptions.banner`)
- Modify: `src/views/html.ts` (`SiteDetailOptions.created`, banner composition)
- Modify: `src/routes/sites.ts` (`GET /sites/:hostname` reads the query param)
- Modify: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `LayoutOptions` from Task 2, the redirect from Task 3.
- Produces: `LayoutOptions` gains `banner?: { message: string }`; `SiteDetailOptions` gains `created?: boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/html.test.ts`. `OPTS` there needs `sites: []` added for Task 2's signature change; these tests spread it.

```ts
/**
 * Anchored to the banner element. A page-wide match on "not responding"
 * would pass on the strength of the header pill and the request-path hop,
 * both of which already say it.
 */
function banner(html: string): string {
  // Non-greedy, stopping at the first </div>: the banner contains a span and a
  // button but no nested div, so this is exactly the banner element.
  const match = /<div id="flash-banner"[\s\S]*?<\/div>/.exec(html);
  assert.ok(match, "expected a flash-banner element");
  return match[0];
}

describe("the ?created=1 banner", () => {
  test("a static site is told its placeholder is already live", () => {
    const html = renderSiteDetail(STATIC_SITE, { ...OPTS, created: true });
    assert.match(banner(html), /Added blog\.lyly\.dev/);
    assert.match(banner(html), /serving the placeholder page it created/);
    assert.match(banner(html), /Manual steps has the DNS record/);
  });

  test("a plain proxy is told why it reads as not responding", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, created: true });
    assert.match(banner(html), /routing is live/);
    assert.match(banner(html), /nothing is listening on port 4000 yet/);
    assert.match(banner(html), /not responding until you start your process/);
  });

  test("a scaffolded site is told why it reads as not deployed", () => {
    const html = renderSiteDetail(NEXT_SITE, { ...OPTS, created: true });
    assert.match(banner(html), /routing is live/);
    assert.match(banner(html), /scaffold is at \/var\/www\/app\.lyly\.dev/);
    assert.match(banner(html), /not deployed until you add your source/);
  });

  test("the banner is visible and dismissible when created, hidden otherwise", () => {
    const created = banner(renderSiteDetail(PROXY_SITE, { ...OPTS, created: true }));
    assert.doesNotMatch(created, /id="flash-banner" class="hidden/);
    assert.match(created, /id="flash-banner-close" class="shrink-0/);

    const plain = banner(renderSiteDetail(PROXY_SITE, OPTS));
    assert.match(plain, /id="flash-banner" class="hidden/);
    assert.match(plain, /id="flash-banner-message"><\/span>/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — TypeScript rejects `created`, then the banner renders empty and hidden.

- [ ] **Step 3: Accept an optional banner in `layout`**

In `src/views/shell.ts`:

```ts
export interface Banner {
  message: string;
}

export interface LayoutOptions {
  nav: Nav;
  banner?: Banner;
}
```

Replace the hardcoded banner markup in `layout` with a call to:

```ts
// Pre-filled server-side for the ?created=1 case. The class list matches what
// showBanner() in public/app.js applies for its "persistent" tone, and that
// function strips these same classes before applying its own, so a later
// client-side banner on the same page still renders correctly.
function renderFlashBanner(banner?: Banner): string {
  const base =
    "fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3";
  const wrapperClass = banner ? `${base} bg-rose-950/60 border-rose-400/70` : `hidden ${base}`;
  const closeClass = "shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none";

  return `<div id="flash-banner" class="${wrapperClass}" role="status" aria-live="polite">
        <span id="flash-banner-message">${banner ? escapeHtml(banner.message) : ""}</span>
        <button type="button" id="flash-banner-close" class="${banner ? closeClass : `hidden ${closeClass}`}" aria-label="Dismiss">&times;</button>
      </div>`;
}
```

Note the ordering: `hidden` comes first in the no-banner case so the test's `/id="flash-banner" class="hidden/` anchor holds.

- [ ] **Step 4: Compose the message in `renderSiteDetail`**

Add `created?: boolean` to `SiteDetailOptions`, then in `html.ts`:

```ts
/**
 * The banner a site lands on after being created. Its job is to explain the
 * status pill beside it: two of the three types arrive not-yet-working, so
 * leading with what did succeed keeps the two from contradicting each other.
 */
function addedBanner(site: Site, sitesRoot: string): string {
  if (site.type === "static") {
    return `Added ${site.hostname} — Caddy is serving the placeholder page it created. Manual steps has the DNS record and how to replace it.`;
  }
  if (site.framework) {
    return `Added ${site.hostname} — routing is live and the scaffold is at ${computeFilesPath(site, sitesRoot)}. It shows as not deployed until you add your source and deploy.`;
  }
  return `Added ${site.hostname} — routing is live, but nothing is listening on port ${site.target} yet, so it shows as not responding until you start your process.`;
}
```

`computeFilesPath` is already imported in `html.ts`. Pass the banner through:

```ts
  return layout(site.hostname, `...unchanged body...`, {
    nav: { sites: opts.sites, active: site.hostname },
    banner: opts.created ? { message: addedBanner(site, opts.sitesRoot) } : undefined,
  });
```

- [ ] **Step 5: Read the flag in the route**

In `GET /sites/:hostname`, before the branches:

```ts
      const created = req.query.created === "1";
```

Add `created` to both `renderSiteDetail` calls.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test src/views/html.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and the build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/views/shell.ts src/views/html.ts src/views/html.test.ts src/routes/sites.ts
git commit -m "Make the add-success banner explain the pill beside it

A plain proxy lands on 'not responding' and a scaffolded site on 'not
deployed', because neither is serving yet. 'Added api.lyly.dev' next to a
red pill reads as a contradiction, so the banner leads with what did
succeed — routing is live — then names what is left, in the pill's own
words.

Server-rendered, because picking the wording needs site.type and
site.framework and the JSON response is gone after the navigation. The
alternative was encoding the type in the query string."
```

---

### Task 5: The switcher

Add the `<details>` disclosure at the top of the rail, listing every managed site as a link.

**Files:**
- Modify: `src/views/shell.ts`
- Modify: `src/views/shell.test.ts`
- Modify: `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `Nav` (`sites`, `active`) from Task 2, `icon("chevronDown")` from Task 2 Step 5.
- Produces: no new exports — `renderSwitcher` is module-private in `shell.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/shell.test.ts`:

```ts
describe("the site switcher", () => {
  test("lists every managed site", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    for (const site of SITES) {
      assert.match(html, new RegExp(`href="/sites/${site.hostname.replace(/\./g, "\\.")}"`));
    }
  });

  test("shows the active hostname closed, and marks only that row current", () => {
    const html = rail(renderSiteDetail(SITES[2], DETAIL_OPTS));
    assert.match(html, /<summary(?:(?!<\/summary>)[\s\S])*app\.lyly\.dev/);
    assert.match(html, /href="\/sites\/app\.lyly\.dev"[^>]*aria-current="page"/);
    assert.doesNotMatch(html, /href="\/sites\/api\.lyly\.dev"[^>]*aria-current="page"/);
  });

  test("keeps the active site listed rather than filtering it out", () => {
    const html = rail(renderSiteDetail(SITES[2], DETAIL_OPTS));
    const rows = html.match(/href="\/sites\/[a-z.]+\.lyly\.dev"/g) ?? [];
    assert.equal(rows.length, SITES.length);
  });

  test("prompts rather than naming a site when none is active", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    assert.match(html, /<summary(?:(?!<\/summary>)[\s\S])*Switch to site…/);
  });

  test("carries a type hint per row: STATIC, or the proxy port", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    assert.match(html, /blog\.lyly\.dev(?:(?!<\/a>)[\s\S])*STATIC/);
    assert.match(html, /api\.lyly\.dev(?:(?!<\/a>)[\s\S])*:4000/);
  });

  test("with no sites, offers a disabled trigger and no panel", () => {
    const html = rail(renderSiteList([], "lyly.dev", "/var/www"));
    assert.match(html, /No sites/);
    assert.doesNotMatch(html, /<details/);
    assert.doesNotMatch(html, /<ul/);
  });

  test("carries no liveness markers — the rail never status-checks", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    for (const word of ["responding", "not deployed", "running", "unhealthy", "exited"]) {
      assert.doesNotMatch(html, new RegExp(word));
    }
  });
});
```

Add to `src/routes/sites.test.ts`:

```ts
describe("the rail on a detail page", () => {
  /** Non-greedy and non-nesting, so this captures exactly the rail. */
  function rail(body: string): string {
    const match = /<aside id="site-nav"[\s\S]*?<\/aside>/.exec(body);
    assert.ok(match, "expected a rail with id=site-nav");
    return match[0];
  }

  test("lists sites other than the one being viewed", async () => {
    const body = await (await request("/sites/blog.lyly.dev")).text();
    // The point of the test: api.lyly.dev is reachable from blog's page.
    assert.match(rail(body), /href="\/sites\/api\.lyly\.dev"/);
  });

  test("omits the unmanaged block, as the site list does", async () => {
    const body = await (await request("/sites/blog.lyly.dev")).text();
    assert.doesNotMatch(rail(body), /lychee\.local/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/views/shell.test.ts src/routes/sites.test.ts`
Expected: FAIL — no `<summary>`, no `/sites/...` links inside the rail.

- [ ] **Step 3: Implement `renderSwitcher`**

In `src/views/shell.ts`:

```ts
const SWITCHER_TRIGGER =
  `list-none cursor-pointer flex items-center justify-between gap-2 rounded-md ` +
  `bg-stone-900 border border-stone-600 px-2.5 py-2 text-stone-50 hover:border-stone-500 ` +
  `[&::-webkit-details-marker]:hidden ${FOCUS_RING}`;

const SWITCHER_ROW =
  `flex items-center justify-between gap-2 px-2.5 py-1.5 no-underline font-mono text-[0.75rem] ` +
  `text-stone-50 border-b border-stone-800 last:border-b-0 hover:bg-stone-800 ` +
  `aria-[current=page]:bg-rose-950/60 aria-[current=page]:text-rose-300 ${FOCUS_RING}`;

function typeHint(site: Site): string {
  return site.type === "static" ? "STATIC" : `:${site.target}`;
}

function renderSwitcher(nav: Nav): string {
  if (nav.sites.length === 0) {
    return `<div class="flex items-center justify-between gap-2 rounded-md bg-stone-900 border border-stone-700 px-2.5 py-2 text-[0.8rem] text-stone-500" aria-disabled="true">
      <span>No sites</span>${icon("chevronDown")}
    </div>`;
  }

  const label = nav.active
    ? `<span class="font-mono text-[0.8rem] truncate">${escapeHtml(nav.active)}</span>`
    : `<span class="text-[0.8rem] text-stone-500 truncate">Switch to site…</span>`;

  const rows = nav.sites
    .map(
      (site) => `<li><a href="/sites/${encodeURIComponent(site.hostname)}" class="${SWITCHER_ROW}"${
        site.hostname === nav.active ? ` aria-current="page"` : ""
      }>
        <span class="truncate">${escapeHtml(site.hostname)}</span>
        <span class="text-[0.65rem] text-stone-500 shrink-0">${escapeHtml(typeHint(site))}</span>
      </a></li>`,
    )
    .join("");

  // max-h/overflow here is a viewport guard, not a tidiness cap: a panel
  // taller than the window cannot be reached at all. It does not engage at
  // the site counts this box is built for.
  return `<details id="site-switcher" class="relative">
    <summary class="${SWITCHER_TRIGGER}">${label}${icon("chevronDown")}</summary>
    <ul class="absolute z-30 left-0 right-0 mt-1 list-none m-0 p-0 bg-stone-900 border border-stone-600 rounded-md shadow-lg shadow-black/50 overflow-hidden max-h-[70vh] overflow-y-auto">${rows}</ul>
  </details>`;
}
```

Then call it as the first child of the rail, above the `<nav>`:

```ts
    ${renderSwitcher(nav)}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test src/views/shell.test.ts src/routes/sites.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and the build**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 6: Check it in a browser**

Run: `npm run dev:mock`, open `http://localhost:8787` (credentials `dev`/`dev`).

Verify: the panel opens on click and overlays the nav rather than pushing it down; `lychee.local` is absent; the active row is highlighted on a detail page; the `<summary>` marker triangle is not visible.

- [ ] **Step 7: Commit**

```bash
git add src/views/shell.ts src/views/shell.test.ts src/routes/sites.test.ts
git commit -m "Add the site switcher to the rail

A native <details> rather than a hand-rolled button: the browser owns the
open state and the disclosure semantics, it works with JS off, and there is
no aria-expanded bookkeeping to drift. The rows are links, so Tab order and
screen-reader link navigation need nothing from us.

No status dots. They would mean a TCP connect per proxy and a docker
compose ps per scaffolded site on every page load, where today only the
detail page checks, for one site. The rail stays a pure function of the
Caddyfile parse."
```

---

### Task 6: Switcher keyboard and dismissal

`<details>` gives open/close on click and Enter. It does not close on Escape, on an outside click, or when focus leaves. Add those.

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Consumes: `#site-switcher` from Task 5.
- Produces: nothing importable.

> There is no test harness for `public/app.js` — it is browser-only and the suite never loads it. This task is verified by hand in `npm run dev:mock`, per Step 3. Do not add a DOM-emulation dependency to test it.

- [ ] **Step 1: Add the behavior**

Append to `public/app.js`:

```js
const siteSwitcher = document.getElementById("site-switcher");

if (siteSwitcher) {
  const summary = siteSwitcher.querySelector("summary");
  const rows = () => Array.from(siteSwitcher.querySelectorAll("a"));

  const close = ({ refocus } = {}) => {
    siteSwitcher.open = false;
    if (refocus) summary?.focus();
  };

  // Not the bounding-rect check used for dialog.modal: that exists because a
  // <dialog>'s backdrop is part of the element. A dropdown has no backdrop,
  // so containment is both correct and simpler.
  document.addEventListener("click", (event) => {
    if (siteSwitcher.open && !siteSwitcher.contains(event.target)) close();
  });

  siteSwitcher.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close({ refocus: true });
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();
    if (!siteSwitcher.open) {
      siteSwitcher.open = true;
      rows()[0]?.focus();
      return;
    }
    const items = rows();
    const index = items.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    // From the summary (index -1), ArrowDown lands on the first row and
    // ArrowUp on the last.
    const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : index + step;
    items[Math.max(0, Math.min(items.length - 1, next))]?.focus();
  });

  siteSwitcher.addEventListener("focusout", (event) => {
    if (!siteSwitcher.contains(event.relatedTarget)) close();
  });
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: PASS. `eslint src` does not cover `public/`, so this is a check that nothing else broke.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev:mock`, open `http://localhost:8787` (`dev`/`dev`).

Walk each one:
- Click the trigger to open, click the page background — it closes.
- Open it, press Escape — it closes and focus returns to the trigger.
- Focus the trigger, press ArrowDown — it opens with the first row focused.
- ArrowDown/ArrowUp walk the rows and stop at each end without wrapping.
- Tab past the last row — the panel closes.
- Click a row — it navigates, and that site's row is highlighted on arrival.

- [ ] **Step 4: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "Give the switcher Escape, outside-click and focusout dismissal

<details> handles click and Enter; it does not close on Escape, on an
outside click, or when focus leaves. Arrow keys move along the rows without
wrapping, and ArrowDown on a closed summary opens it on the first row.

The outside-click check is containment, not the bounding-rect test used for
dialog.modal — that one exists because a <dialog>'s backdrop is part of the
element, which does not apply here."
```

---

## Final verification

Before merging, from a clean tree:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Then `npm run dev:mock` and walk the whole flow: add a static site, land on its page and read the banner against its pill; add a reverse proxy with no framework and confirm the banner explains the red pill; add one with Next.js selected and confirm the scaffold path in the banner; switch between sites from the rail; remove a site and confirm the rail no longer lists it.

What `dev:mock` cannot tell you, and what nothing in this change touches: sudoers scope, the wrapper scripts' validation, `web:webdeploy` ownership, and real `caddy validate` behavior. Nothing here is privileged.
