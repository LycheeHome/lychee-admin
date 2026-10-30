# Collapsible Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the rail's place rows icons and a grouping divider, and let the desktop rail collapse to a 56px icon strip with a find peek, persisted per browser.

**Architecture:** One `Rail` component renders either the expanded rail or the strip from a single place list, and `Navigation` owns the collapsed and peek state. `Navigation` writes `data-rail="collapsed"` on `<body>`, and `index.html`'s grid narrows the first column from that. The peek is the expanded rail in a fixed overlay, sharing the drawer's one-rail rule.

**Tech Stack:** React 19, TypeScript, Tailwind v4 (class constants in `src/views/`), Node's test runner with `@testing-library/react` on happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-29-collapsible-rail-design.md`

## Global Constraints

- Below 900px nothing changes. The drawer always renders the expanded rail.
- Storage key `lychee-admin:rail`, values `collapsed` | `expanded`. Anything else, or a throwing store, means expanded.
- Strip width 56px; icon cells 40×36; strip icons 18px; expanded-rail icons 16px.
- Expanded site rows: `pl-8 pr-2` (32px left), replacing `pl-5 pr-2`.
- Divider: 1px `bg-stone-700`. Expanded: inset 8px (`mx-2`). Strip: 24px wide (`w-6`), centred.
- Current treatment everywhere: `aria-[current=page]:text-stone-50 aria-[current=page]:bg-stone-700` (the existing `RAIL_CURRENT`). There is no left rule.
- Toggle labels, exactly: `Collapse sidebar` / `Expand sidebar`. `aria-controls="rail"`, and `aria-expanded` is true when expanded.
- Tooltip: `aria-hidden="true"`, with classes `bg-stone-800 border border-stone-700 rounded-md text-[0.8rem] font-sans text-stone-50 px-2 py-1 shadow-lg shadow-black/40`. It shows on the cell's `:hover` and `:focus-visible` through a `group` / `group-hover:` / `group-focus-visible:` pair.
- Every place link keeps its word in the DOM. In the strip it is `sr-only`.
- Exactly one `#find` and one ⌘K listener in the document at any time.
- Frozen fixtures in `src/dev/fixtures/` are never edited. Every markup change to the expanded rail is declared in `src/client/test/redesigns.ts`, matching the raw fixture text (redesigns.test.ts checks entries against raw files, and parity applies them in order).
- Edit `src/views` and `src/client` with Edit/Write, never sed, so the design-detector hook sees the change.

## Review Focus

- **Resizing below 900px while a peek is open:** the peek closes, as the drawer does on widening. Test in Task 5.
- **A stored value that is neither `collapsed` nor `expanded`** (old or hand-typed): the rail renders expanded. Test in Task 1.
- **Unmounting `Navigation`** (a test teardown, or a future layout swap): `data-rail` is removed from `<body>`, so the grid does not stay narrow. Test in Task 4.
- **The collapse button inside a peek:** it closes the peek and leaves the stored value `collapsed`. Test in Task 5.
- **An in-app move while collapsed:** the current cell follows the route, as the expanded rail's current row does. Test in Task 3.

---

### Task 1: Icons, class constants and the stored state

**Files:**
- Modify: `src/views/shared.ts` (`ICONS`)
- Modify: `src/views/railModel.ts`
- Test: `src/views/railModel.test.ts`

**Interfaces:**
- Produces:
  - `ICONS.search` already exists. Add these inner SVG markup strings, written in the existing entries' style (self-closing elements, `width`/`height` before `x`/`y`, ` />`):
    - `overview`: `<rect width="7" height="9" x="3" y="3" rx="1" /><rect width="7" height="5" x="14" y="3" rx="1" /><rect width="7" height="9" x="14" y="12" rx="1" /><rect width="7" height="5" x="3" y="16" rx="1" />`
    - `activity`: `<path d="M22 12h-4l-3 9L9 3l-3 9H2" />`
    - `sites`: `<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />`
    - `services`: `<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />`
    - `reconciler`: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />`
    - `infrastructure`: `<rect width="20" height="8" x="2" y="2" rx="2" /><rect width="20" height="8" x="2" y="14" rx="2" /><path d="M6 6h.01" /><path d="M6 18h.01" />`
    - `panelClose`: `<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" />`
    - `panelOpen`: `<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="m14 9 3 3-3 3" />`
  - `type RailPlace = "overview" | "activity" | "sites" | "services" | "reconciler" | "infrastructure"`.
  - `RAIL_PLACES: readonly { place: RailPlace; href: string; group: "app" | "host" }[]`, in order: overview `/`, activity `/activity`, sites `/sites` (group app), services `/services`, reconciler `/reconciler`, infrastructure `/infrastructure` (group host).
  - `RAIL_STORAGE_KEY = "lychee-admin:rail"`.
  - `readRailCollapsed(storage: Pick<Storage, "getItem"> | undefined): boolean` and `writeRailCollapsed(storage: Pick<Storage, "setItem"> | undefined, collapsed: boolean): void`. Neither ever throws.
  - Class constants: `RAIL_ROW` (now `pl-8 pr-2`), `RAIL_ICON` (`w-4 h-4 shrink-0`), `RAIL_HEAD` (`flex items-center justify-between gap-2 px-2`), `RAIL_TOGGLE` (32px square, Smoke, `hover:text-stone-50 hover:bg-stone-800`, plus the `RAIL_HOVER` transition and `FOCUS_RING`), `RAIL_DIVIDER` (`h-px bg-stone-700 mx-2`), `RAIL_STRIP_DIVIDER` (`h-px w-6 bg-stone-700 mx-auto my-0.5`), `RAIL_STRIP` (the strip's inner column: `flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-4 px-2 py-5`), `RAIL_CELL` (`group relative flex items-center justify-center w-10 h-9 rounded-md text-stone-400 no-underline hover:text-stone-50`, plus `RAIL_HOVER`, `RAIL_CURRENT` and `FOCUS_RING`), `RAIL_CELL_ICON` (`w-[18px] h-[18px]`), `RAIL_TIP` (from Global Constraints, plus `pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 z-40 whitespace-nowrap hidden group-hover:block group-focus-visible:block`), `RAIL_BADGE` (`pointer-events-none absolute top-0.5 right-px inline-flex items-center gap-0.5 font-mono text-[0.6rem] leading-none`), `RAIL_MONOGRAM` (`font-display text-2xl leading-none text-stone-50 no-underline` plus `FOCUS_RING`), and `RAIL_PEEK` (`fixed inset-y-0 left-0 z-40 w-[250px] flex flex-col bg-stone-900 border-r border-stone-700 shadow-lg shadow-black/40`).

- [ ] **Step 1: Write the failing tests** in `railModel.test.ts`:
  - `readRailCollapsed` returns true only for `"collapsed"`. It returns false for `"expanded"`, `null`, `"yes"` and `undefined` storage, and for a storage whose `getItem` throws.
  - `writeRailCollapsed` writes `"collapsed"`/`"expanded"` under `RAIL_STORAGE_KEY`, and does not throw when `setItem` throws.
  - `RAIL_PLACES.map(p => p.place)` deep-equals the six in order, and `group` splits after `sites`.
  - `RAIL_ROW` contains `pl-8` and not `pl-5`.
- [ ] **Step 2: Run** `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the Interfaces above. Rewrite `RAIL_ROW`'s doc comment: site labels line up under the place words, past their icons.
- [ ] **Step 4: Run** `npm test`. Expected: all pass. The fixtures get the new `RAIL_ROW` through `rail-row-hover`'s `to`, so rail parity stays green with `pl-8`.
- [ ] **Step 5: Commit** `feat: add rail place icons, strip classes and stored collapse state`.

### Task 2: Expanded rail with icons, divider and toggle

**Files:**
- Modify: `src/client/components/Rail.tsx`
- Modify: `src/client/test/redesigns.ts`
- Test: `src/client/components/Rail.test.tsx`, `src/client/test/redesigns.test.ts` (existing), `src/client/AppFrameParity.test.tsx` (existing)

**Interfaces:**
- Consumes: Task 1's `ICONS`, `RAIL_PLACES` and class constants.
- Produces:
  - `RailProps` gains `collapsed?: boolean` (unused until Task 3), `onToggle?: (button: HTMLButtonElement) => void` and `onFindOpen?: (button: HTMLButtonElement) => void` (unused until Task 3).
  - The head markup: `<div class=RAIL_HEAD><h1 …(unchanged)…><Wordmark/></h1><button type="button" id="rail-toggle" class=RAIL_TOGGLE aria-label="Collapse sidebar" aria-expanded="true" aria-controls="rail">{panelClose svg}</button></div>`, rendered whenever `!inDrawer`.

- [ ] **Step 1: Write the failing tests** in `Rail.test.tsx`:
  - "each place row leads with its icon": for each of the six place links, `firstElementChild` is an `svg` with `aria-hidden="true"` and class `RAIL_ICON`, and the link's `textContent` is still the bare word.
  - "a divider separates the app's places from the host boards": the element between `nav[aria-label=Sites]` and `nav[aria-label=Host]` has class `RAIL_DIVIDER` and `aria-hidden="true"`.
  - "the collapse button sits beside the wordmark, and not in the drawer": `#rail-toggle` has `aria-label` `Collapse sidebar` and `aria-expanded` `true`. Rendering with `inDrawer` gives no `#rail-toggle`. Clicking it calls `onToggle` with the button.
- [ ] **Step 2: Run** `npm test`. Expected: those fail.
- [ ] **Step 3: Implement in `Rail.tsx`.**
  - Render the Overview/Activity/Sites place links and the host links from `RAIL_PLACES`, each with a leading `<Icon>` sized `RAIL_ICON`.
  - Keep the three `<nav>`s, their labels, and the overview row's `justify-between` with its signal. Drop `HOST_LINKS`.
  - Insert `<div aria-hidden="true" className={RAIL_DIVIDER} />` between the Sites and Host navs.
  - Add the head wrapper and the toggle.
  - Generalise the `Icon` component to take a `className` (default `ICON_CLASS`).
- [ ] **Step 4: Declare the redesigns in `redesigns.ts`.** Every entry is dated `2026-10-29` with the why "Place rows lead with an icon, the app's places and the host boards are split by a divider, and a collapse button sits beside the wordmark (spec 2026-10-29-collapsible-rail)." Each entry must match the raw fixture text. Add a helper `railIcon(name)` that writes exactly the `<svg …>` string React's static markup produces for `<Icon>`. Write it once, and if parity disagrees, print the client's markup and copy its attribute order. Then:
  - `rail-overview-row`: the `to` gets `${railIcon("overview")}` before `overview` and `${railIcon("activity")}` before `activity`.
  - `rail-sites-place`: the `to` gets `${railIcon("sites")}` before `sites`.
  - Replace `rail-place-sans:links` with three entries, `rail-place-sans:services|reconciler|infrastructure`. Each matches `href="/<x>" class="${FROZEN_RAIL_ROW} justify-between"([^>]*)>` and writes `href="/<x>" class="${RAIL_PLACE} justify-between"$1>${railIcon(x)}`. Check that `rail-row-hover` (`FROZEN_RAIL_ROW` without `justify-between`) still matches only site rows.
  - `rail-divider`: from `/<nav aria-label="Host"/g` to `<div aria-hidden="true" class="${RAIL_DIVIDER}"></div><nav aria-label="Host"`, anchor `<nav aria-label="Host"`.
  - `rail-head-toggle`: from `/(<h1 class="m-0 px-2 text-base font-normal leading-none">[\s\S]*?<\/h1>)/g` to `<div class="${RAIL_HEAD}">$1<button …>${panelClose svg}</button></div>`, anchor `<h1 class="m-0 px-2 text-base font-normal leading-none">`. The top bar's `<h1 class="m-0 text-base …">` has no `px-2`, so it is not matched.
  - `RAIL_ROW` already flows through `rail-row-hover`'s `to`, so `pl-8` needs no new entry.
- [ ] **Step 5: Run** `npm test`. Expected: all pass, including `redesigns.test.ts` (each entry matches raw text, every anchor occurrence matched) and both rail parity suites. If an anchor is also present in a non-rail fixture (for example `shell/*.html` holding the rail), it is matched there too, which is correct.
- [ ] **Step 6: Run** `npm run typecheck && npm run lint`. Expected: clean.
- [ ] **Step 7: Commit** `feat: give rail place rows icons, a grouping divider and a collapse button`.

### Task 3: The collapsed strip

**Files:**
- Modify: `src/client/components/Rail.tsx`
- Test: `src/client/components/Rail.test.tsx`

**Interfaces:**
- Consumes: Task 2's `RailProps` (`collapsed`, `onToggle`, `onFindOpen`).
- Produces:
  - With `collapsed`, `Rail` renders `<div class=RAIL_STRIP>`. In order it holds:
    - `<h1>` around the monogram link to `/`, with `aria-label="lychee-admin"`, text `l`, class `RAIL_MONOGRAM`.
    - `#rail-toggle` as a button with label `Expand sidebar`, `aria-expanded="false"` and the `panelOpen` icon.
    - `<button type="button" id="rail-find-open" class=RAIL_CELL aria-label="Find">` with the search icon and a tooltip `Find`.
    - `<nav aria-label="Overview">` with overview and activity cells, then `<nav aria-label="Sites">` with the sites cell, each nav a `flex flex-col items-center gap-0.5`.
    - The strip divider.
    - `<nav aria-label="Host">` with three cells.
  - Each cell is a `RailLink` with class `RAIL_CELL`, the current state via `aria-current`, and three children: the `RAIL_CELL_ICON` svg, `<span className="sr-only">{word}</span>`, and `<span aria-hidden="true" className={RAIL_TIP}>{word}</span>`. CSS `capitalize` applies to the tip.
  - The overview cell adds `<Signal>`'s badge form: `<span data-signal aria-hidden class=RAIL_BADGE><dot class=RAIL_SIGNAL_DOT[tone] size-[5px]/>{count}</span>` plus the existing spoken `sr-only` phrase. Count text uses `RAIL_SIGNAL_COUNT[tone]` minus its font size, and nothing renders when `overviewSignal` returns null.
  - Not rendered in the strip: `FindPanel`, site rows, `RAIL_NOTE` lines.

- [ ] **Step 1: Write the failing tests** in a new `describe("the collapsed strip")`:
  - "no site rows, no find box and no notes": with `collapsed` and `rail.sites === null` and `hostAvailable: false`, there are no `a[data-site]`, no `#find`, and no `Can't read the Caddyfile` or `Inventory unavailable` text.
  - "each place cell keeps its word": the six links' accessible text (the `sr-only` span) equals the six words, and each has exactly one `[aria-hidden=true]` tooltip with the same word.
  - "the badge carries the signal": `healthWith(3)` gives `[data-signal]` text `5` and the bad tone's dot. `healthWith(3,false)` gives the neutral tone. A failed poll gives a dot with no number. `cleanHealth()` gives no `[data-signal]`.
  - "the toggle expands and find opens the peek": `#rail-toggle` reads `Expand sidebar` with `aria-expanded="false"`, and clicking `#rail-find-open` calls `onFindOpen` with that button.
  - "the strip keeps the rail's rules": run the existing `assertRules(container, "strip")` on a collapsed render with `{ site: "broken.lychee.land" }`. Expected: no current row, since sites are hidden. So also run it with `{ page: "services" }`, and adjust `assertRules` to take the expected current-row count (1, or 0 for a hidden site). The left-rule, Ember, focus-ring and Add-site checks still apply.
  - Review Focus, "the current cell follows the route": inside the client router test harness the file already uses for route-following rows, collapsed at `/reconciler`, then navigated to `/activity`, `aria-current` moves from the reconciler cell to the activity cell.
  - "the divider is in the strip too": a `RAIL_STRIP_DIVIDER` between the Sites and Host navs.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests fail.
- [ ] **Step 3: Implement the strip branch in `Rail`.** Compute `current` and `signal` once above the branch, so both states share them.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: render the rail as an icon strip when collapsed`.

### Task 4: Collapse state in Navigation and the frame grid

**Files:**
- Modify: `src/client/components/Rail.tsx` (`Navigation`)
- Modify: `index.html`
- Modify: `src/client/components/FindPanel.tsx` (export `isFindShortcut`)
- Test: `src/client/components/Rail.test.tsx`

**Interfaces:**
- Consumes: Task 1's `readRailCollapsed`/`writeRailCollapsed`, and Task 3's strip.
- Produces:
  - `Navigation` state `collapsed`, initialised with `useState(() => readRailCollapsed(safeLocalStorage()))`, where `safeLocalStorage()` returns `window.localStorage` inside a try, or `undefined`.
  - A `useLayoutEffect` that sets `document.body.dataset.rail = "collapsed"` while collapsed, deletes it otherwise, and deletes it on unmount.
  - `toggle()`: flips the state, writes it, then after render focuses `#rail-toggle` in the new state through a ref or effect.
  - `index.html` `<body>` class gains `min-[900px]:data-[rail=collapsed]:grid-cols-[56px_minmax(0,1fr)]`.
  - `isFindShortcut` is exported from `FindPanel.tsx`.

- [ ] **Step 1: Write the failing tests** (using the file's `mountNavigation`, and clearing `localStorage` in `beforeEach`):
  - "a stored collapse renders the strip on the first render": `localStorage.setItem(RAIL_STORAGE_KEY, "collapsed")`, then mount. The aside holds `#rail-find-open` and no `#find`, and `document.body.dataset.rail === "collapsed"`.
  - "the toggle flips state, storage, the body and focus": mount expanded and click `#rail-toggle`. The stored value is `collapsed`, the body attribute is set, `document.activeElement` is the new `#rail-toggle` with `Expand sidebar`. Click again: the stored value is `expanded`, the attribute is gone, and focus is on `Collapse sidebar`.
  - "a store that throws renders expanded and toggles in memory": stub `localStorage.getItem`/`setItem` to throw. The mount shows `#find`, and the toggle collapses without throwing.
  - Review Focus, "unmount clears the body attribute": collapsed, then `cleanup()`, and `document.body.dataset.rail` is undefined.
  - "the drawer is always expanded": stored `collapsed`, narrow (stub `matchMedia` to not match, as the drawer tests already do), and open the drawer from the menu button. The dialog holds `#find` and site rows, and no `#rail-toggle`.
  - "⌘K while collapsed and narrow opens the drawer on find": dispatch the shortcut, and expect the dialog open with `#find` focused.
  - "the body class names the collapsed grid": read `index.html` from disk and assert it contains `min-[900px]:data-[rail=collapsed]:grid-cols-[56px_minmax(0,1fr)]`.
- [ ] **Step 2: Run** `npm test`. Expected: they fail.
- [ ] **Step 3: Implement.** The aside's rail gets `collapsed`, `onToggle` and `onFindOpen` (a stub that Task 5 replaces). While `collapsed` and no drawer is open, `Navigation` adds one `keydown` listener using `isFindShortcut`. Below 900px it calls the existing `open(previous, true)`. From 900px it is a no-op until Task 5. Update `Navigation`'s doc comment: one rail, one `#find`, one ⌘K listener, now across aside, drawer and peek.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass. `public/style.css` contains `data-[rail=collapsed]` (check with `grep -c 'rail=collapsed' public/style.css`).
- [ ] **Step 5: Commit** `feat: persist the rail's collapse and narrow the frame grid`.

### Task 5: The find peek

**Files:**
- Modify: `src/client/components/Rail.tsx` (`Peek`, `Navigation`)
- Test: `src/client/components/Rail.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `Navigation` state `peek: { opener: HTMLElement | null } | null`. `openPeek(opener)` comes from `#rail-find-open` and from the wide ⌘K branch.
  - `Peek({ onClose, children })` renders `<div id="rail-peek" role="dialog" aria-modal="false" aria-label="Navigation" class=RAIL_PEEK>`, holding `<Rail {...props} findInitial={{ query: "", focused: true }} onToggle={closePeek} />` (expanded, so its toggle reads `Collapse sidebar`).
  - While the peek is open the aside renders the strip without its find button's listener and without `FindPanel`. There is still one `#find`, the peek's.
  - Close paths:
    - Escape: `FindPanel` handles the first Escape while its panel is open. Add a `keydown` on the peek root that closes on an Escape not `defaultPrevented`, and check how `FindPanel` marks a handled Escape (it already defers a closed-panel Escape to the drawer).
    - `pointerdown` outside `#rail-peek`.
    - `focusout` whose `relatedTarget` is outside `#rail-peek`, ignoring `relatedTarget === null`, so a window blur keeps it open.
    - Any `locationKey` change, as with the drawer's `navigatedAway`.
    - The `matchMedia(RAIL_WIDE_QUERY)` change to not-matching.
  - Focus on close: back to `peek.opener` if connected, except after a location change.

- [ ] **Step 1: Write the failing tests:**
  - "the find button opens the peek with find focused": collapsed, wide (stub `matchMedia` to match), click `#rail-find-open`. `#rail-peek` exists, `document.activeElement` is `#find`, there is exactly one `#find`, and the stored value is still `collapsed`.
  - "⌘K while collapsed and wide opens the peek": same expectations, then Escape closes it and focus returns to what had focus before ⌘K.
  - "Escape closes find's panel first, then the peek": type `api`, Escape (the panel closes, the peek stays), Escape (the peek closes, focus on `#rail-find-open`).
  - "a rail link inside the peek closes it on the move": router harness, open the peek, click the `Services` link. `#rail-peek` is gone, the services cell is current, and focus is not restored to the find button.
  - "a pointer down outside closes it": dispatch `pointerdown` on `document.body`, and `#rail-peek` is gone.
  - Review Focus, "the peek's collapse button closes it and keeps the stored state": click `#rail-peek #rail-toggle`. The peek is gone, and storage is still `collapsed`.
  - Review Focus, "narrowing closes the peek": fire the stubbed media query's change to not-matching, and `#rail-peek` is gone.
- [ ] **Step 2: Run** `npm test`. Expected: they fail.
- [ ] **Step 3: Implement** `Peek` and the `Navigation` wiring. Peek is not modal: no `inert` on the page, since its job is a quick pick.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: open a find peek from the collapsed rail`.

### Task 6: Docs, detector and browser check

**Files:**
- Modify: `DESIGN.md`, `.impeccable/design.json`, `CLAUDE.md`

- [ ] **Step 1: Update `DESIGN.md`.**
  - The rail section describes both states, the icons and the divider, the toggle, the badge and the peek.
  - The icon list gains overview (layout dashboard), activity, globe, box, refresh, server, and panel close/open.
  - Add component entries for the icon strip, the strip tooltip and the peek.
  - If a named rule's prose changes (for example Mono-Carries-Facts naming the rail), re-derive its sidecar body: strip `**` and backticks, from the bolded header to the next rule header or heading.
- [ ] **Step 2: Update `.impeccable/design.json`.**
  - The rail component's description, and its CSS snippet: `.ds-rail__row--site` padding-left 32px, `.ds-rail__icon`, `.ds-rail__divider` and a `.ds-rail__toggle`.
  - New `rail-strip` and `rail-peek` components with descriptions and CSS in the snippet style already there.
  - Check with `python3 -c "import json;json.load(open('.impeccable/design.json'))"`.
- [ ] **Step 3: Update `CLAUDE.md`.** In the Core v1 rail paragraph, add one or two sentences on the collapsed strip (56px, icons, site rows hidden, `lychee-admin:rail` in `localStorage`) and the find peek.
- [ ] **Step 4: Run the detector.** Run `"<impeccable-skill-dir>/scripts/impeccable" detect --json src/views src/client`. Expected: `[]`.
- [ ] **Step 5: Browser check.** With `npm run dev:mock` and Playwright, apply Basic auth through `page.route('http://127.0.0.1:8787/**', …)` rather than `setExtraHTTPHeaders`, so the Google Fonts load. Check:
  - 1280px, expanded: icons, divider, sites aligned at 32px, toggle.
  - Click collapse, and the grid's first column computes to 56px.
  - Reload, and the first screenshot is already the strip.
  - Hover a cell for the tooltip, and Tab to a cell for the tooltip.
  - ⌘K opens the peek, Escape closes it.
  - On `/services`, the services cell is current.
  - At 800px with the state collapsed, the menu opens a drawer with the full rail.
  Save the screenshots under `.playwright-mcp/`.
- [ ] **Step 6: Run** `npm test && npm run typecheck && npm run lint && npm run build`. Expected: all pass.
- [ ] **Step 7: Commit** `docs: record the collapsible rail in DESIGN.md, the sidecar and CLAUDE.md`.
