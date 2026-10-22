# Navigation shell: sub-project 2 of the SPA migration

Date: 2026-10-21

## Decision record

This sub-project's design was settled in three steps:

- **The `/impeccable shape` pass.** The operator named four pains, all at once:
  - every move is a full reload;
  - moving site to site is slow;
  - five header links read as equals, while the board is one thing cut in three;
  - nothing in the header answers "something is broken: which page?"
- **Two rendered comparisons.** The navigation round chose **01 Ledger Rail**. The switcher round chose **A Anchored Find with ⌘K**.
- **The approved brief.** Its three open decisions were answered:
  - the server renders the rail;
  - an empty find shows what needs attention;
  - the rail collapses below 900px.

The comparisons are the Artifacts "lychee-admin Navigation Variants" and "lychee-admin Switcher Placement". They are drawn in The Warm Terminal. That world itself is still undecided: this spec fixes structure, not skin.

## Why

The header was built when the app had one page type. It now carries five peer links, and only the sites list shows any health.

A failing service, a blocked deploy or a down timer is found by visiting pages in turn. Moving between sites goes through a breadcrumb dropdown that lists hostnames with no state.

The rail makes health visible from every page, and makes every site and unit reachable in two actions.

## Goal

Every page renders inside a **rail shell**: a fixed left rail and the existing content column beside it. On every page, the rail answers three questions:

- **What is unhealthy?** A live dot per site, and a count per host section.
- **Where am I?** `aria-current`.
- **How do I get anywhere?** A click, or ⌘K and a few letters.

This is a shell change. No page body changes, except the two small ones named under Scope.

## Non-goals

- **A client-side router.** Pages are still full loads. "No full reloads" arrives page by page as bodies migrate. The router comes with the second migrated page, as the foundation spec said.
- **Per-unit pages.** Choosing a unit opens its board row.
- **Actions in the find panel.** No Remove, no Deploy, no host actions.
- **A visual-world change.** Every DESIGN.md token, tone and named rule stands.
- **Migrating any page body.**

## Decisions

### 1. The rail's contents and order

Top to bottom:

1. **The wordmark** `lychee` `admin`, a link to `/`. It is moved from the header band, at its documented Display size.
2. **The find box.**
   - A mono input, with its shortcut printed inside: `⌘K`, or `Ctrl K` on non-Apple platforms, decided from `navigator.platform`.
   - Server-rendered as a plain input with the printed hint.
3. **Sites.**
   - A heading link to `/`, labelled `sites`, with an attention count.
   - Then every managed site in Caddyfile order, as rows, each with:
     - a dot;
     - the hostname, with the label in Chalk and `.lychee.land` in Smoke Deep, as today's dropdown does;
     - a right-aligned hint: `static` or `:<port>`.
   - Each row links to `/sites/<hostname>`.
4. **Host.**
   - A non-link heading, `host`.
   - Then three links, `services`, `reconciler` and `infrastructure`, to their existing pages, each with an attention count.
5. **Add site.** The rail's one Ember primary button, at the bottom, linking to `/sites/new`.

The current page is marked with `aria-current="page"` on its rail row or link, using today's current-nav treatment: Chalk on Hairline with a 2px Ember Edge left rule.

- `/sites/new` marks Add site.
- A site page marks its own site row.
- The three board pages mark their links.
- The not-found page marks nothing.

The header band and the breadcrumb's hostname dropdown are removed. The breadcrumb stays as plain location text, `sites / <hostname>`.

The sites list loses its own Add site button, except inside its empty state. The rail's button is now the page's one primary action. The Ember Is Interactive Rule allows one Ember action per view.

### 2. Dots, counts and the counting rule

**Site dots** use the canonical vocabulary's three tones, `ok`, `bad` and `neutral`, from the same `SiteStatus` the list's pill uses.

- A static site's dot is **hollow** (a Hairline Strong ring). There is nothing to poll, matching today's list, where a static site gets no pill.

**A unit's tone** comes from its board row's status, through `rowLabels`.

**Attention:**
- A site needs attention when its tone is `bad`.
- A unit needs attention when its tone is `bad`, **or** `deployTrouble` classifies its last run as `blocked` or `failed`.

A running service with a blocked deploy therefore counts. A row that is merely waiting, such as `ci-pending`, does not. That is the same line the board's `deploy blocked` / `deploy failed` already draws.

**The counting rule:** a Next.js site's container is counted once, as its site, and never again among the units. Board rows whose resource is a managed site are excluded from unit counts and from the find panel's unit groups.

A count shows in Scorch on a Scorch Deep chip only when it is above zero. Zero is quiet Smoke Deep, so a healthy rail has no colour but its green dots.

### 3. Health: one batched read, polled

`GET /api/health` returns:

```
{ ok: true, now, sites: SiteHealth[], units: UnitHealth[] | null }
```

`SiteHealth` is:

```
{ hostname, tone: "ok" | "bad" | "neutral" | "none", label, attention }
```

- `label` is the canonical status phrase, for example `failed` or `not responding`.
- `none` is a static site.

`UnitHealth` is:

```
{ name, group, tone, label, trouble: "blocked" | "failed" | null, href, attention }
```

- `href` is `/services#service-<name>`, `/reconciler#service-<name>` or `/infrastructure#service-<name>`, by group.
- `units` is `null` when the inventory is unavailable.

**How it is built:**
- Site health uses the list's existing `computeStatuses`. Unit health uses the same `loadBoardPage` both boards use, so the rail, the list's pills and the boards cannot disagree.
- Every read is already bounded: `checkPortOpen` has a 500ms timeout and the container-status wrapper has its own.
- The endpoint never refreshes the `lychee-resources` clone.
- It sits behind basic auth like every route. Without credentials it answers `401`.
- A read failure answers a `500` `ApiError`.

**The cost, deliberately accepted:** CLAUDE.md records that the breadcrumb dropdown never status-checked, because that would cost a check per site per page view. The rail pays it differently:
- one batched read per poll, whatever page is open;
- every 15 seconds;
- paused while the tab is hidden.

CLAUDE.md's paragraph is rewritten to say this and why.

**Polling** uses TanStack Query, through the foundation's `QueryClient`:
- `refetchInterval: 15_000`
- `refetchIntervalInBackground: false`
- `refetchOnWindowFocus: true`

**Failure must never show a remembered green.** When the latest poll errored:
- every dot renders neutral `unknown`, and counts hide;
- a quiet Smoke line under the sites section reads `health unavailable · last read <relative time>`.

Before the first response, dots render hollow and counts render nothing. There is no skeleton green.

### 4. Who renders the rail

- **The server renders it on every page.** `layout()` gains a `rail: RailData` option:

  ```
  { sites: { hostname, hint }[] | null, current: RailCurrent, hostAvailable: boolean }
  ```

  It is built by one function, `loadRail(deps, current)`, which reads the Caddyfile and the inventory file. It is synchronous filesystem reads only, with **no status checks**.
- **The server rail carries no health.** All dots are hollow and all counts are empty. This deviates from the comparison's wording ("server pages show health as of page load"): a check per site on every page render is exactly the cost the poll replaces.
- **The client bundle now loads on every page.** A `RailIsland` replaces the server rail's markup with React on mount, then fills in health from the poll. So server-rendered pages get live health and ⌘K too, not only migrated ones.
- **The island's first render matches the server markup**: same elements, ids, classes and text. A parity test pins this, as `/infrastructure`'s does, so taking over causes no visible shift.
- **A missing bundle.** The foundation's `500` "client bundle missing" applies to migrated pages only. On a server page a missing bundle leaves the static rail working as plain links, with no health and no ⌘K. The page still works.
- **Unreadable Caddyfile.** `sites: null` renders one Smoke line, "Can't read the Caddyfile", in place of the rows.
- **Missing inventory.** `hostAvailable: false` renders the host links without counts. A neutral line reads "Inventory unavailable".

### 5. The find panel

**Opening and closing**
- ⌘K or Ctrl+K focuses the find box from anywhere, including from inside other inputs. Clicking the box also focuses it.
- Esc closes the panel and returns focus to the element that had it.

**What it lists**
- **With nothing typed**, it lists what needs attention: sites first, then units, each row with its pill, plus a `deploy blocked` or `deploy failed` label in Scorch when that is the reason. If nothing needs attention, it shows one line: "Nothing needs attention."
- **Typing** filters by case-insensitive substring match on the hostname or unit name. Results appear under four group headings: Sites, then services, reconciler, infrastructure.
- A group with no match says so, for example "No site matches “sw”."
- Results come from the latest health payload. While none has arrived, sites are matched from the rail's own list, without pills, and units are not listed.

**Moving and choosing**
- The arrow keys move through the list, crossing groups. Enter opens the highlighted row:
  - a site goes to `/sites/<hostname>`;
  - a unit goes to its `href`.
- Pointer hover moves the highlight, and a click opens the row.
- Navigation is a full page load (`location.assign`) until a router exists.
- The panel never lists actions.

**Placement**
- The panel is anchored beside the rail, overlapping the content column's top-left, as drawn in placement A.
- It is at most 420px wide, and its list scrolls inside the panel once it is taller than the viewport.

**Accessibility**
- It follows the combobox pattern: an input with `role="combobox"`, `aria-expanded` and `aria-controls`, a `role="listbox"` list with `role="option"` rows, and `aria-activedescendant` tracking the highlight.
- Each group heading is a `role="presentation"` label, so a screen reader reads every option's own group.

### 6. Layout and narrow screens

**At 900px and wider**
- The rail is fixed at 250px, full height, and scrolls on its own. Add site stays pinned at its foot.
- The content column sits to the right, keeping today's 1080px frame and 760px detail widths, centred in the remaining space.
- The flash toast stays fixed, and the page notice stays in flow at the top of the content column, as today.

**Below 900px**, the rail becomes a top bar:
- on the left, the wordmark;
- on the right, an overall attention count and a menu button.
- The menu button opens the full rail as a left drawer, a modal `<dialog>` that closes with Esc or a click on the scrim.
- ⌘K still opens find. A find icon button in the bar opens it for touch.

PRODUCT.md's "desktop only" stays true of the design target. This is a usable fallback for the tailnet address, not a phone design.

## Scope

- **Server.**
  - `layout()` and `loadRail` in `src/views/shell.ts`, plus a new `src/views/rail.ts` for the rail markup.
  - Every renderer passes its `rail` option.
  - `GET /api/health` in a new route module.
  - The list page's Add site button is reduced to its empty state.
  - The breadcrumb dropdown is removed from `html.ts`.
  - `public/app.js` loses the `#hostname-switcher` handler block (outside-click close, Esc, arrow keys). Its add-site comment, which says the new site appears in "the breadcrumb switcher", is updated to name the rail instead.
- **Client.**
  - `RailIsland`, `FindPanel` and the health query in `src/client/`.
  - `main.tsx` mounts the island on every page, and the page component only where `#app-root` names one.
- **Shared.** The rail's markup comes from one place per renderer: `rail.ts` on the server and `Rail.tsx` on the client. Class strings and the counting rule live in a node-free module both renderers import, following `boardFacts.ts`.

## Testing

**API tests**
- `/api/health` returns the seeded sites with the right tones (`api` `bad`, `app` `ok`, `preview` `neutral`, static sites `none`) and units with `trouble`.
- Site containers are excluded from units.
- The response gives `attention` per item.
- A missing inventory gives `units: null`.
- No credentials gives `401`.

**Server rail tests**
- Every page type renders the rail, with the right `aria-current`.
- An unreadable Caddyfile shows its line.
- A missing inventory shows its line.
- No header band or hostname dropdown remains anywhere.
- The list page's Add site button appears only in its empty state.

**Parity test**
- The island's first render equals the server rail, for the seeded sites and for the unreadable-Caddyfile and missing-inventory cases.

**Island tests**
- A health payload fills in dots and counts. Zero counts stay quiet.
- An errored poll turns every dot to `unknown`, hides counts and shows the unavailable line.
- Before the first response, dots are hollow.

**Find tests**
- ⌘K focuses the box. Esc closes it and returns focus.
- An empty query lists the attention items.
- Typing filters the groups, and a group with no match says so.
- Arrow keys and Enter navigate to the right URL.
- The combobox ARIA attributes are present.
- Each `findBy*` and `waitFor` carries `{ timeout: 5000 }`.

**Narrow layout test**
- Below 900px the drawer opens and closes.

**Browser check** against `npm run dev:mock`:
- the rail on the sites list, a site page, a board page and `/sites/new`, at 1280px and at 390px;
- ⌘K from a server page and from `/infrastructure`;
- the health poll visibly updating a dot after a seeded state change.

Also run:
- `npm run typecheck`, `lint`, `test` and `build`;
- the detector on `src/views src/client`.

## Documentation

- **CLAUDE.md:**
  - the shell paragraph (rail instead of header band, island on every page, `/api/health`);
  - the dropdown paragraph (retired; the health-poll cost and why it is accepted);
  - the two banner elements, whose positions are unchanged but now sit in a rail layout.
- **PRODUCT.md:** the "Surfaces today" header sentence.
- **DESIGN.md:** after the build, run `/impeccable document` as a scoped refresh, to add the rail, find panel, attention count and hollow static dot. The sidecar's rule bodies stay derived from the prose.

## Risks

- **Poll cost on a host with many container sites.** Each poll runs one status wrapper per installed container. It is bounded by the wrapper's timeout, and paused when hidden. If it shows up, the interval is one constant.
- **Two rail renderers.** The parity test holds them together until the last server page migrates and the server rail is deleted.
- **A shell-wide change touches every page's tests.** Renderers assert their bodies, not the header, today; a shared helper supplies `rail` in tests.
