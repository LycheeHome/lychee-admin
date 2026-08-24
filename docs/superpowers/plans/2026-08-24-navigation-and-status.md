# Navigation and status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 220px rail with a global header band plus a hostname
dropdown on the detail breadcrumb, and answer "is anything down" on the site
list.

**Architecture:** `shell.ts` keeps owning the page frame but renders a
full-width header instead of a sticky column, so content width equals viewport
width again. Site-to-site movement moves to a `<details>` dropdown on the
detail page's breadcrumb, reusing the rail switcher's keyboard layer verbatim.
The list route gains a status read — `Promise.all` over reverse-proxy sites
only — and passes a hostname-keyed map into `renderSiteList`.

**Tech Stack:** TypeScript, Express, server-rendered template literals,
Tailwind v4 via CLI, vanilla JS in `public/app.js`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-24-navigation-and-status-design.md`

## Global Constraints

- No client-side routing and no client-held view state. Server-rendered
  markup, progressive enhancement only.
- No ARIA tab pattern. Navigation is `<a>` elements with `aria-current="page"`.
- Status appears on the list cards only. Not in the header, not in the
  dropdown: pills there would cost N status checks on every page instead of N
  on one.
- The Dim-Text Rule (`DESIGN.md`): dim text is Smoke (`text-stone-400`).
  Smoke Deep (`text-stone-500`) carries text only at the 1.7rem Headline. Every
  label, key, caption, hint and sub-line below 24px takes Smoke.
- **Spec correction:** the spec's Tier 2 paragraph says dropdown rows dim the
  shared `.lyly.dev` suffix in Smoke Deep. Rows are 0.75rem, so that would
  violate the rule above. Rows use Smoke for the suffix; only the detail
  page's Headline keeps Smoke Deep.
- The Ember Is Interactive Rule: `aria-current` state is Chalk on Hairline
  with a 2px Ember Edge left rule — never the `proxy` pill's ember fill.
- The Radius-Says-Size Rule: 10px for a surface containing rows (the dropdown
  panel), 6px for controls.
- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` must all
  pass before every commit.

---

### Task 1: Replace the rail with a global header band

**Files:**
- Modify: `src/views/shell.ts` (delete `renderRail`, `renderSwitcher`,
  `typeHint`, `NAV_ITEM`, `SWITCHER_TRIGGER`, `SWITCHER_ROW`; add
  `renderHeader`; change `Nav`; change `layout`'s body/banner)
- Modify: `src/views/html.ts` (drop `sites` from the `nav` argument in
  `renderSiteList`, `renderAddSite`, `renderSiteDetail`, `renderSiteNotFound`;
  drop the `sites` parameter from `renderSiteNotFound`)
- Modify: `src/routes/sites.ts` (`renderSiteNotFound(hostname)` call site)
- Modify: `src/dev/testHelpers.ts` (`withoutRail` → `withoutHeader`)
- Test: `src/views/shell.test.ts` (replace the rail and switcher suites)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface Nav { page?: "sites" | "new" }`;
  `export function layout(title: string, body: string, opts: LayoutOptions): string`
  unchanged in shape; `export function renderSiteNotFound(hostname: string): string`;
  `withoutHeader(html: string): string` in `src/dev/testHelpers.ts`.

- [ ] **Step 1: Write the failing tests**

Replace the whole `describe("the rail", ...)` and
`describe("the site switcher", ...)` blocks in `src/views/shell.test.ts` with:

```ts
const HEADER = /<header id="site-header"[\s\S]*?<\/header>/;

function header(html: string): string {
  const match = html.match(HEADER);
  assert.ok(match, "expected a header band");
  return match[0];
}

describe("the header band", () => {
  test("renders on the site list", () => {
    assert.match(header(renderSiteList(SITES, {})), /href="\/sites\/new"/);
  });

  test("renders on a site detail page", () => {
    assert.match(header(renderSiteDetail(SITES[0], DETAIL_OPTS)), /href="\/"/);
  });

  test("carries the wordmark at its documented Display size", () => {
    const block = header(renderSiteList(SITES, {}));
    assert.match(block, /font-display text-2xl/);
    assert.match(block, /lyly<span class="text-rose-400">\.<\/span>admin/);
  });

  test("marks sites current on the list page only", () => {
    const list = header(renderSiteList(SITES, {}));
    assert.match(list, /href="\/"[^>]*aria-current="page"/);
    const detail = header(renderSiteDetail(SITES[0], DETAIL_OPTS));
    assert.doesNotMatch(detail, /aria-current="page"/);
  });

  test("marks add site current on the add-site page", () => {
    const block = header(renderAddSite(SITES, "lyly.dev", PORT_OWNERS));
    assert.match(block, /href="\/sites\/new"[^>]*aria-current="page"/);
  });

  test("lists no hostnames — the switcher is not in the header", () => {
    const block = header(renderSiteDetail(SITES[0], DETAIL_OPTS));
    for (const site of SITES) assert.doesNotMatch(block, new RegExp(site.hostname));
  });

  test("does not offset the page for a rail that no longer exists", () => {
    const html = renderSiteList(SITES, {});
    assert.doesNotMatch(html, /id="site-nav"/);
    assert.doesNotMatch(html, /calc\(50% \+ 110px\)/);
    assert.match(html, /id="flash-banner"[^>]*left-1\/2/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/views/shell.test.ts`
Expected: FAIL — `expected a header band` (no `<header id="site-header">` is
rendered yet), plus failures in the old rail suites that no longer compile
against the new `Nav`.

- [ ] **Step 3: Rewrite the shell**

In `src/views/shell.ts`, delete `NAV_ITEM`, `navItem`, `SWITCHER_TRIGGER`,
`SWITCHER_ROW`, `typeHint`, `renderSwitcher` and `renderRail`. Narrow `Nav`
and add the header:

```ts
export interface Nav {
  /** Which header item is current. Absent on a site detail page. */
  page?: "sites" | "new";
}

const HEADER_ITEM =
  `font-mono text-[0.85rem] no-underline text-stone-400 rounded-md px-2 py-1 ` +
  `hover:text-stone-50 ` +
  `aria-[current=page]:text-stone-50 aria-[current=page]:bg-stone-700 ` +
  `aria-[current=page]:border-l-2 aria-[current=page]:border-l-rose-800 ${FOCUS_RING}`;

function headerItem(href: string, label: string, current: boolean): string {
  return `<a href="${href}" class="${HEADER_ITEM}"${current ? ` aria-current="page"` : ""}>${escapeHtml(label)}</a>`;
}

/**
 * Host-level navigation, identical on every page. A header item's destination
 * never changes with location: the moment "sites" means something different
 * depending on where you stand, it is a control you have to read the URL to
 * understand. Per-site movement lives on the detail page's breadcrumb.
 *
 * "add site" is here as well as on the list page's primary button. Same label
 * in both places, quiet here and ember there: this one navigates, that one
 * acts, and with zero sites that button is the entire call to action.
 */
function renderHeader(nav: Nav): string {
  return `
  <header id="site-header" class="max-w-[1080px] mx-auto flex items-center gap-6 py-4">
    <a href="/" class="font-display text-2xl font-semibold tracking-wide text-stone-50 m-0 no-underline ${FOCUS_RING}">lyly<span class="text-rose-400">.</span>admin</a>
    <nav class="flex items-center gap-1" aria-label="Sections">
      ${headerItem("/", "sites", nav.page === "sites")}
      ${headerItem("/sites/new", "add site", nav.page === "new")}
    </nav>
  </header>`;
}
```

Then replace `layout`'s body. The rail is gone, so the body is a normal
document flow again and the banner returns to plain centering:

```ts
<body class="min-h-screen bg-stone-900 font-sans text-stone-50 m-0 px-6 pb-16">
  ${renderHeader(opts.nav)}
  <main class="max-w-[1080px] mx-auto py-6 pb-8 flex flex-col gap-6">
    ${renderFlashBanner()}
```

In `renderFlashBanner`, replace `left-[calc(50%_+_110px)]` with `left-1/2`
and delete the comment explaining the 110px offset — there is no rail to
offset from.

- [ ] **Step 4: Update the callers**

In `src/views/html.ts` change every `layout(...)` third argument from
`{ nav: { sites, page: "sites" } }` (and the detail page's
`{ nav: { sites, active: site.hostname }, banner }`) to drop `sites` and
`active`: `{ nav: { page: "sites" } }`, `{ nav: { page: "new" } }`,
`{ nav: {} }` and `{ nav: {}, banner }` respectively. Change
`renderSiteNotFound(hostname: string, sites: Site[])` to
`renderSiteNotFound(hostname: string)` and drop `sites` from its `layout`
call. In `src/routes/sites.ts`, change the 404 call to
`renderSiteNotFound(hostname)`.

In `src/dev/testHelpers.ts`, rename the helper and re-anchor it:

```ts
const HEADER = /<header id="site-header"[\s\S]*?<\/header>/;

/**
 * The page with the header band cut out of it. Assertions about a page's body
 * would otherwise be satisfied by the header alone: it carries its own "sites"
 * and "add site" links on every page.
 *
 * The assert is the point. `String.replace` returns its input unchanged when
 * the pattern misses and throws nothing, so if the header's id ever changes,
 * every caller would quietly revert to page-wide matching — the exact vacuity
 * they exist to prevent.
 */
export function withoutHeader(html: string): string {
  assert.match(html, HEADER, "expected a header to strip — anchor is stale");
  return html.replace(HEADER, "");
}
```

Update every `withoutRail(` call site to `withoutHeader(` (grep: `rg -l withoutRail src`).

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS. Tests asserting the rail's absence now pass; any test still
naming `site-nav` or `site-switcher` must be deleted, not adapted — those
components no longer exist.

- [ ] **Step 6: Commit**

```bash
git add src/views/shell.ts src/views/html.ts src/routes/sites.ts src/dev/testHelpers.ts src/views/shell.test.ts src/views/html.test.ts
git commit -m "Replace the rail with a header band"
```

---

### Task 2: Hostname dropdown on the detail breadcrumb

**Files:**
- Modify: `src/views/html.ts` (`renderDetailHeader`)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `Nav` from Task 1; `SiteDetailOptions.sites: Site[]`, which
  already exists and stops being the rail's input and becomes the dropdown's.
- Produces: a `<details id="hostname-switcher">` in the detail page's
  breadcrumb, with `<summary>` as the trigger and `<a>` rows — the element ids
  Task 3's JS binds to.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/html.test.ts`:

```ts
describe("the hostname switcher", () => {
  const switcher = (html: string) => {
    const match = html.match(/<details id="hostname-switcher"[\s\S]*?<\/details>/);
    assert.ok(match, "expected a hostname switcher");
    return match[0];
  };

  test("sits in the breadcrumb and lists every managed site", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    for (const site of OPTS.sites) assert.match(block, new RegExp(site.hostname));
  });

  test("names the current site in the trigger, and marks only its row", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    const summary = block.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    assert.match(summary, /blog/);
    const currentRows = block.match(/aria-current="page"/g) ?? [];
    assert.equal(currentRows.length, 1);
  });

  test("tells a screen reader what the trigger does, not just where it is", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.match(block, /<summary[^>]*aria-label="Switch site[^"]*blog\.lyly\.dev"/);
  });

  test("never truncates a hostname — the control exists to pick one", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.doesNotMatch(block, /truncate/);
  });

  test("dims the shared suffix in Smoke, not Smoke Deep, at row size", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    const rows = block.match(/<ul[\s\S]*<\/ul>/)?.[0] ?? "";
    assert.match(rows, /text-stone-400/);
    assert.doesNotMatch(rows, /text-stone-500/);
  });

  test("carries a type hint per row and no status", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.match(block, /:4000/);
    assert.doesNotMatch(block, /●/);
    assert.doesNotMatch(block, /running|responding|unhealthy/);
  });

  test("is a surface containing rows, so it takes the 10px radius", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    const panel = block.match(/<ul[^>]*>/)?.[0] ?? "";
    assert.match(panel, /rounded-\[10px\]/);
  });

  test("marks the current row without the proxy pill's ember fill", () => {
    const block = switcher(renderSiteDetail(STATIC_SITE, OPTS));
    assert.doesNotMatch(block, /bg-rose-950/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — `expected a hostname switcher`.

- [ ] **Step 3: Implement the switcher**

In `src/views/html.ts`, add above `renderDetailHeader`:

```ts
const SWITCHER_TRIGGER =
  `list-none cursor-pointer inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 ` +
  `text-stone-50 hover:bg-stone-800 [&::-webkit-details-marker]:hidden ${FOCUS_RING}`;

const SWITCHER_ROW =
  `flex items-center justify-between gap-3 px-2.5 py-1.5 no-underline font-mono text-[0.75rem] ` +
  `text-stone-50 border-b border-stone-700 last:border-b-0 hover:bg-stone-800 ` +
  `aria-[current=page]:bg-stone-700 aria-[current=page]:border-l-2 aria-[current=page]:border-l-rose-800 ${FOCUS_RING}`;

/** `static`, or the port a proxy site forwards to. Never status. */
function typeHint(site: Site): string {
  return site.type === "static" ? "static" : `:${site.target}`;
}

/**
 * Site-to-site movement, on the one line that already says which site you are
 * looking at. The rows are hostnames and a type hint — no status, because the
 * dropdown renders on every detail page and status pills there would cost one
 * check per site per page view. The list page answers that question instead.
 *
 * No `truncate` anywhere: this is the control whose whole job is picking a
 * hostname, and two sites called staging-dashboard-preview and
 * staging-dashboard-prod must not render identically. Splitting the shared
 * domain suffix off buys about nine characters per row for free.
 */
function renderHostnameSwitcher(site: Site, opts: SiteDetailOptions): string {
  const rows = opts.sites
    .map((entry) => {
      const { lead, dimmed } = splitHostnameForDisplay(entry.hostname, opts.domain);
      const current = entry.hostname === site.hostname;
      return `<li><a href="/sites/${encodeURIComponent(entry.hostname)}" class="${SWITCHER_ROW}"${
        current ? ` aria-current="page"` : ""
      }><span>${escapeHtml(lead)}${dimmed ? `<span class="text-stone-400">${escapeHtml(dimmed)}</span>` : ""}</span><span class="text-[0.65rem] text-stone-400 shrink-0">${escapeHtml(typeHint(entry))}</span></a></li>`;
    })
    .join("");

  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, opts.domain);

  return `<details id="hostname-switcher" class="relative inline-block">
        <summary class="${SWITCHER_TRIGGER}" aria-label="Switch site — currently ${escapeHtml(site.hostname)}">${escapeHtml(lead)}${
          dimmed ? `<span class="text-stone-400">${escapeHtml(dimmed)}</span>` : ""
        }${icon("chevronDown")}</summary>
        <ul class="absolute z-30 left-0 mt-1 min-w-[16rem] list-none m-0 p-0 bg-stone-900 border border-stone-700 rounded-[10px] shadow-lg shadow-black/40 overflow-hidden max-h-[70vh] overflow-y-auto">${rows}</ul>
      </details>`;
}
```

In `renderDetailHeader`, replace the breadcrumb's static hostname span with
the switcher:

```ts
      <nav class="font-mono text-[0.72rem] text-stone-400 m-0" aria-label="Breadcrumb">
        <a href="/" class="text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS_RING}">sites</a>
        <span class="text-stone-600 mx-1.5">/</span>
        ${renderHostnameSwitcher(site, opts)}
      </nav>
```

- [ ] **Step 4: Run the tests**

Run: `npx tsx --test src/views/html.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Move site-to-site movement onto the breadcrumb"
```

---

### Task 3: Retarget the switcher's keyboard layer

**Files:**
- Modify: `public/app.js:/const siteSwitcher/`

**Interfaces:**
- Consumes: `<details id="hostname-switcher">` with a `<summary>` and `<a>`
  rows, from Task 2.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Repoint the binding**

The rail's element id is gone. Change the single lookup and the variable name;
every behaviour below it — Escape closing and refocusing the trigger,
ArrowDown/ArrowUp roving focus, `focusout`, click-outside by containment — is
correct as written and must not change:

```js
const siteSwitcher = document.getElementById("hostname-switcher");
```

- [ ] **Step 2: Verify by hand — this file has no unit tests**

`public/app.js` is untested in this repo; it is exercised through the running
app. Run `npm run dev:mock`, open `http://127.0.0.1:8787/sites/app.lyly.dev`
(credentials `dev` / `dev`) and confirm, with the keyboard only:

- Tab reaches the hostname in the breadcrumb.
- Enter opens the panel; Escape closes it and focus returns to the trigger.
- ArrowDown on the closed trigger opens it and lands on the first row.
- ArrowDown/ArrowUp move between rows.
- Tabbing past the last row closes the panel.
- Clicking outside closes it.
- With JavaScript disabled, the `<details>` still opens and the rows still
  navigate.

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "Point the switcher's keyboard layer at the breadcrumb dropdown"
```

---

### Task 4: Status pills on the list cards

**Files:**
- Modify: `src/views/html.ts` (`renderSiteList`)
- Modify: `src/routes/sites.ts` (`GET /`, plus the 500 fallback call)
- Test: `src/views/html.test.ts`, `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `layout` and `Nav` from Task 1.
- Produces:
  `renderSiteList(sites: Site[], statuses: Record<string, SiteStatus>, error?: string): string`
  and, in `src/routes/sites.ts`,
  `computeStatuses(sites: Site[], deps: Deps): Promise<Record<string, SiteStatus>>`.

- [ ] **Step 1: Write the failing view tests**

Add to `src/views/html.test.ts`:

```ts
describe("status on the site list", () => {
  test("a proxy site's card carries its canonical status word", () => {
    const html = renderSiteList([PROXY_SITE], { [PROXY_SITE.hostname]: { kind: "tcp", responding: true } });
    assert.match(html, /● responding/);
  });

  test("a container site reports the worst-case word, not the lifecycle one", () => {
    const html = renderSiteList([NEXT_SITE], {
      [NEXT_SITE.hostname]: { kind: "container", state: "running", health: "unhealthy" },
    });
    assert.match(html, /● unhealthy/);
  });

  test("starting is neutral, not red", () => {
    const html = renderSiteList([NEXT_SITE], {
      [NEXT_SITE.hostname]: { kind: "container", state: "running", health: "starting" },
    });
    assert.match(html, /text-stone-300[^"]*"[^>]*>● starting/);
    assert.doesNotMatch(html, /text-red-300[^"]*"[^>]*>● starting/);
  });

  test("a static site gets no status pill — nothing checks one", () => {
    const html = renderSiteList([STATIC_SITE], {});
    assert.doesNotMatch(html, /●/);
  });

  test("a site with no status entry renders no pill rather than a guess", () => {
    const html = renderSiteList([PROXY_SITE], {});
    assert.doesNotMatch(html, /●/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — `renderSiteList` takes two arguments today, so the compile
fails before any assertion runs.

- [ ] **Step 3: Render the pill**

In `src/views/html.ts`, widen the signature and add the pill beside the type
pill. `describeStatus` and `TONE_PILL` already exist and are already imported
by this module:

```ts
export function renderSiteList(
  sites: Site[],
  statuses: Record<string, SiteStatus>,
  error?: string,
): string {
  const cards = sites
    .map((site) => {
      const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
      const status = statuses[site.hostname];
      const labels = status ? describeStatus(status) : null;
      const statusPill = labels
        ? `<span class="${TONE_PILL[labels.tone]}">&#9679; ${escapeHtml(labels.pill)}</span>`
        : "";
```

and in the card's first row, after the existing type pill span:

```ts
        <div class="flex items-start justify-between gap-2">
          <p class="font-display text-base leading-relaxed text-stone-50 m-0 break-words">${escapeHtml(site.hostname)}</p>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="inline-block shrink-0 font-mono text-[0.7rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border ${
              site.type === "static" ? TYPE_PILL_STATIC : TYPE_PILL_PROXY
            }">${site.type === "static" ? "static" : "proxy"}</span>
            ${statusPill}
          </div>
        </div>
```

- [ ] **Step 4: Write the failing route test**

Add to `src/routes/sites.test.ts`, matching the file's existing fake-driven
style:

```ts
test("the site list reports each proxy site's status", async () => {
  const { app } = createTestApp();
  const res = await request(app).get("/").auth("dev", "dev");
  assert.match(res.text, /● responding|● not responding/);
});

test("a static-only list makes no status calls", async () => {
  const { app, commands } = createTestApp({ caddyfile: STATIC_ONLY_CADDYFILE });
  await request(app).get("/").auth("dev", "dev");
  assert.equal(commands.checkContainerStatus.callCount, 0);
});
```

- [ ] **Step 5: Compute statuses in the route**

In `src/routes/sites.ts`, add above `createSitesRouter`:

```ts
/**
 * Status for the list page. Reverse-proxy sites only: static sites have no
 * check today and gain none here. Concurrent, so the page costs the slowest
 * check rather than their sum — and every call is bounded, because
 * checkContainerStatus carries its own timeout and checkPortOpen a 500ms one.
 */
async function computeStatuses(sites: Site[], deps: Deps): Promise<Record<string, SiteStatus>> {
  const entries = await Promise.all(
    sites
      .filter((site) => site.type === "reverse-proxy")
      .map(async (site): Promise<[string, SiteStatus]> => {
        if (site.framework) {
          return [site.hostname, { kind: "container", ...(await deps.commands.checkContainerStatus(site.hostname)) }];
        }
        const port = Number(site.target);
        return [site.hostname, { kind: "tcp", responding: port >= 1 && port <= 65535 ? await checkPortOpen(port) : false }];
      }),
  );
  return Object.fromEntries(entries);
}
```

Make the list handler async and pass the map. The 500 fallback passes an empty
map, because nothing was read:

```ts
  sitesRouter.get("/", async (req, res) => {
    const content = deps.fs.readFile(config.caddyfilePath);
    const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname));

    res.send(renderSiteList(sites, await computeStatuses(sites, deps)));
  });
```

and in the detail route's catch: `res.status(500).send(renderSiteList([], {}, message));`

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/views/html.ts src/routes/sites.ts src/views/html.test.ts src/routes/sites.test.ts
git commit -m "Answer \"is anything down\" on the site list"
```

---

### Task 5: Take the add-site heading to Headline

**Files:**
- Modify: `src/views/html.ts` (`renderAddSite`'s `<h2>`)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
test("the add-site page's heading is a documented ramp step", () => {
  const html = renderAddSite([], "lyly.dev", {});
  assert.match(html, /<h2 class="font-mono text-\[1\.7rem\]/);
  assert.doesNotMatch(html, /text-\[1\.35rem\]/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test src/views/html.test.ts`
Expected: FAIL — the heading is `text-[1.35rem]`, which is off the ramp and is
what the detector has been flagging.

- [ ] **Step 3: Use the Headline step**

```ts
      <h2 class="font-mono text-[1.7rem] leading-[1.2] tracking-[-0.01em] text-stone-50 m-0">Add a site</h2>
```

- [ ] **Step 4: Confirm the detector is clean**

Run:
```bash
npm test
node ~/.claude/plugins/cache/impeccable/impeccable/4.1.1/skills/impeccable/scripts/detect.mjs src/views/html.ts src/views/shell.ts src/views/shared.ts
```
Expected: tests PASS; the `design-system-font-size` finding for `1.35rem` is
gone. Remaining `gray-on-color` findings are the known false positives Task 6
waives.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Take the add-site heading to the Headline step"
```

---

### Task 6: Reconcile the documents and the detector waiver

**Files:**
- Modify: `DESIGN.md` (Components > Navigation; Layout)
- Modify: `.impeccable/design.json` (narrative only, if a rule changes)
- Modify: `PRODUCT.md` (Operating Context)
- Modify: `.impeccable/config.json` (via `hook-admin.mjs`, never by hand)
- Modify: `docs/superpowers/specs/2026-08-24-navigation-and-status-design.md`

**Interfaces:**
- Consumes: the shipped markup from Tasks 1–5. Produces: nothing.

- [ ] **Step 1: Rewrite Components > Navigation**

`DESIGN.md`'s Navigation section currently states "No global nav, no tabs, no
sidebar in the incumbent implementation — the list is the only other place to
be." Replace it with the two tiers that now exist: the header band (full
width, aligned to the 1080px container, wordmark as home at Display 1.5rem,
mono 0.85rem items in Smoke going Chalk, `aria-current` as Chalk on Hairline
with a 2px Ember Edge left rule) and the breadcrumb's hostname dropdown
(`<details>`, 10px panel radius, rows carrying hostname plus type hint and no
status, no truncation, `max-h-[70vh]` as the floating-panel exception). Record
that per-site tabs are deferred until a second tall task-specific section
exists.

- [ ] **Step 2: Add the header band to Layout**

The Layout section describes "a 40px-tall header band holding only the
wordmark". It now holds navigation too. State its height, that it aligns to
the same 1080px container as the content, and that content width equals
viewport width — so `sm` (640px) keeps meaning what it says.

- [ ] **Step 3: Update PRODUCT.md**

`PRODUCT.md`'s Operating Context says "A sidebar with a site switcher, and
add-site as its own page, are planned and not yet built." Replace with what
shipped: a global header band, a hostname dropdown on the detail breadcrumb,
add-site at `/sites/new`, and status on the list cards.

- [ ] **Step 4: Waive the moved false positive**

`shared.ts` holds `BUTTON_PRIMARY` and `BUTTON_DANGER` permanently, and both
trip `gray-on-color` — documented pairs (Hearth on Ember; Chalk on Scorch
Rule) that the rule's flat heuristic cannot see are high-contrast. The
existing waiver is scoped to `src/views/html.ts` only:

```bash
node ~/.claude/plugins/cache/impeccable/impeccable/4.1.1/skills/impeccable/scripts/hook-admin.mjs \
  ignore-value gray-on-color "*" --file "src/views/shared.ts" \
  --reason "User confirmed: documented DESIGN.md pairs (Hearth on Ember for button-primary, Chalk on Scorch Rule for danger hover), both high-contrast; rule targets washed-out mid-greys this palette never puts on a fill"
```

- [ ] **Step 5: Close out the spec's carry-forwards**

The spec's Constraints section lists two fixes to re-apply by hand and four
`shell.ts` dim-text uses deferred to this rework. All are resolved: the rail
is gone, so three left with it, and the wordmark now lives in the header at
Display size in Chalk. Mark those bullets resolved rather than deleting them —
the reasoning is why the next reader will not go looking for them.

- [ ] **Step 6: Verify and commit**

```bash
npm test
node ~/.claude/plugins/cache/impeccable/impeccable/4.1.1/skills/impeccable/scripts/detect.mjs src/views/html.ts src/views/shell.ts src/views/shared.ts
git add DESIGN.md PRODUCT.md .impeccable/ docs/superpowers/specs/
git commit -m "Document the navigation the app now has"
```
Expected: tests PASS, detector clean.

---

## Self-Review

**Spec coverage.** Tier 1 header band → Task 1. Tier 2 breadcrumb dropdown →
Tasks 2 and 3. Tier 3 per-site tabs → deliberately deferred; Task 6 records
the trigger. Status on the list cards → Task 4. `execFile` timeout
prerequisite → already shipped on `main` and merged. Rail removal, banner
offset, `sm` recalibration → Task 1, which deletes the rail the breakpoint
problem depended on. The two carry-forwards → already applied in the merge;
Task 6 marks them closed. The `1.35rem` heading → Task 5. `shell.ts`'s four
dim-text uses → three leave with the rail in Task 1, the wordmark is
rewritten there. Documentation and `PRODUCT.md:78` → Task 6.

**Gap found and closed:** the spec never said what happens to
`renderSiteNotFound`'s `sites` parameter, which exists only to feed the rail.
Task 1 drops it.

**Type consistency.** `Nav` is `{ page?: "sites" | "new" }` in Task 1 and used
that way after. `renderSiteList` takes `(sites, statuses, error?)` in Task 4
and every call site listed there is updated, including the 500 fallback.
`computeStatuses` returns `Record<string, SiteStatus>`, which is what
`renderSiteList` indexes by hostname. `withoutHeader` replaces `withoutRail`
in Task 1 and no later task references the old name. `typeHint` is deleted
from `shell.ts` in Task 1 and reintroduced in `html.ts` in Task 2 — the same
name for the same job, in the file that now owns it.
