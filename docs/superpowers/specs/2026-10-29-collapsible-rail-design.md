# Collapsible rail: icons and a desktop icon strip

Date: 2026-10-29

## Decision record

- **The desktop rail can collapse to an icon strip.** The user asked for a collapsible sidebar. A full hide was recommended, because the rail had no icons and the site rows have nothing natural to show. The user chose an icon strip instead, with icons on the place rows.
- **Place rows get icons in both states**, not only in the strip. Icons were first raised as a question about the expanded rail ("should each page link have an icon"), and a strip that introduces icons the expanded rail lacks was shown (variant 04) and not chosen.
- **Site rows hide while collapsed.** They have no icon, and they are reachable through Sites, find and the expanded rail.
- **Visual treatment: 03 Grouped**, chosen from a rendered comparison (comparing-design-variants, https://claude.ai/artifact/SYou4XEzv18yu8DACgpPLr) over 01 Ledger (no divider), 02 Captioned (an 84px strip with 0.6rem captions under the 0.7rem floor) and 04 Strip only. A short Hairline divider separates the app's own places (Overview, Activity, Sites) from the host boards (Services, Reconciler, Infrastructure), in both states.
- **Find while collapsed: an icon that expands the rail temporarily**, chosen over a floating find panel beside the strip (new positioning for the panel) and the narrow-screen drawer (a modal overlay on desktop).
- **Toggle at the top, beside the wordmark.** Collapsed, the wordmark shrinks to a Poetsen `l` monogram with the toggle under it. Chosen over a toggle at the bottom of the strip and a hover handle on the rail's edge.
- **Approach: one `Rail` with a `collapsed` mode**, chosen over a separate `RailStrip` component (two place lists, and the current-row, signal and ⌘K logic wired twice) and a CSS-only collapse (hidden site rows still in the DOM and the tab order).

## Why

The rail takes 250px on every desktop page. Between 900px and about 1330px wide that space comes out of the content column, which tops out at 1080px. A collapsed rail returns 194px there and keeps every place one click away.

## Goal

- From 900px, the rail can be collapsed to a 56px icon strip and expanded again, and the choice persists per browser.
- The strip keeps the rail's one health mark, its current-row marking, ⌘K and find.
- Both states share one set of place icons and one grouping.

## Non-goals

- Any change below 900px. The top bar and drawer stay as they are, and the drawer always holds the expanded rail.
- Icons for site rows.
- A keyboard shortcut for the toggle.
- Persisting the choice anywhere but the browser (`localStorage`).
- Animating the collapse. The grid column switches width; there is no transition.

## Design

### Expanded rail (250px)

- Each place row (Overview, Activity, Sites, Services, Reconciler, Infrastructure) gets a 16px icon before its word, with the `gap-2` already on the row. (Amended during implementation: the rows drop the `justify-between` the frozen overview and host rows carried, which beside a leading icon pushed the word to the row's far edge; Overview's signal keeps right with its own `ml-auto`.)
- Site rows' left padding goes from 20px (`pl-5`) to 32px (`pl-8`), so their labels line up under the place words rather than under the icons.
- A short Hairline divider (1px, `stone-700`) sits between the Sites nav and the Host nav, inset 8px either side.
- The wordmark row gains a collapse button at its right edge (amended during implementation: the row, `RAIL_HEAD`, has no padding of its own, and the h1's `px-2` puts the wordmark 8px in, over the place rows' icons): a `panel-left-close` icon in a 32px square button, Smoke, going Chalk on a Hearth Lift ground on hover, with the shared focus ring.

### Collapsed strip (56px)

Top to bottom:

1. The Poetsen `l` monogram: still the home link (`/`) and still inside the rail's `h1`, with the accessible name `lychee-admin`.
2. The expand button: `panel-left-open`, the same button as collapse.
3. A find button: the `search` icon in a 40×36 cell.
4. Overview, Activity and Sites as 40×36 icon cells, centred, 2px apart.
5. The divider, 24px wide and centred.
6. Services, Reconciler and Infrastructure, the same way.

Icons are 18px in the strip. A cell's current treatment is the rail's (Chalk on Hairline), and its hover is the rail's (Chalk on Hearth Lift). Site rows, the find input and its `⌘K` hint, the `admin` qualifier and the two rail notes ("Can't read the Caddyfile", "Inventory unavailable") are not rendered in the strip.

The overview signal becomes a badge at the Overview cell's top-right corner: a 5px dot and the count in 0.7rem mono (amended during implementation from 0.6rem, which is under the type floor), in the signal's tone, or the dot alone after a failed poll. The screen-reader phrase is unchanged.

Each cell shows its place word in a tooltip to its right on hover and on keyboard focus: Hearth Lift ground, Hairline border, 6px radius, 0.8rem Nunito Chalk, the Overlay shadow. The tooltip is `aria-hidden`; the link keeps its word as `sr-only` text, so its accessible name is the same in both states.

### Icons

24×24 line icons, stroke 2, round caps and joins, `currentColor`, Lucide-shaped, added to `ICONS` in `src/views/shared.ts`:

| Place | Icon |
|---|---|
| Overview | `layout-dashboard` (four unequal rounded rectangles) |
| Activity | `activity` (a pulse line) |
| Sites | `globe` |
| Services | `box` (a container) |
| Reconciler | `refresh-cw` (two cycling arrows) |
| Infrastructure | `server` (two stacked units) |
| Collapse / expand | `panel-left-close` / `panel-left-open` |

`search` already exists and is reused for the strip's find button.

### Behaviour

- **Toggle.** The collapse and expand buttons flip the rail between states. Each is a `<button>` with `aria-expanded` (true when expanded), `aria-controls="rail"`, and the label "Collapse sidebar" or "Expand sidebar". After a flip, focus moves to the other button, so a keyboard user keeps their place.
- **Persistence.** The state is stored in `localStorage` under `lychee-admin:rail` as `collapsed` or `expanded`. It is read synchronously when `Navigation` first renders, so the first paint is already in the right state, and every read and write is wrapped so an unavailable store falls back to expanded without throwing.
- **Layout.** While collapsed, `Navigation` sets `data-rail="collapsed"` on `<body>` and removes it otherwise. `index.html`'s body grid gains `min-[900px]:data-[rail=collapsed]:grid-cols-[56px_minmax(0,1fr)]`; the aside itself keeps its classes, and its width follows its contents.
- **Peek: find while collapsed.** Clicking the strip's find button or pressing ⌘K opens a peek: the expanded rail, 250px wide, `position: fixed` over the content from the left edge at full height, on the rail's own Hearth with its Hairline right edge and the Overlay shadow, with the find input focused. The body grid stays at 56px, so the page does not reflow.
  - The peek closes on Escape (a first Escape with find's panel open closes the panel, a second the peek, as in the drawer), on a pointer down outside it, when focus leaves it, and on any in-app move (a rail link, find's Enter), the same way the drawer closes on navigation.
  - A close by Escape or by the peek's collapse button returns focus to the strip's find button if the peek was opened from it (the remounted strip's `#rail-find-open`), and otherwise to what had focus before ⌘K. A close by a pointer down outside, by focus leaving, or by narrowing below 900px leaves focus where it went, since it already has somewhere to be. A close caused by an in-app move returns focus nowhere, so the new page's heading takes it. (Amended during implementation: the spec first returned focus on every close.)
  - The peek never changes the stored state. Its own collapse button reads "Collapse sidebar" and closes the peek.
  - There is only ever one rail, one `#find` and one ⌘K listener: while the peek is open, the rail renders in the peek and the peek takes the strip's place in the aside, as the drawer takes the rail out of the aside, so ids, the h1 and the nav landmarks never repeat. The peek's collapse button carries `aria-controls="rail-peek"`. (Amended during implementation: the spec first kept the strip in the aside beside the peek, which duplicated `#rail-toggle`, the h1 and the navs.)
- **Below 900px** the collapsed state has no effect. The aside is hidden there, the `data-rail` grid variant applies only from 900px, and the drawer renders the expanded rail regardless of the stored state. Widening past 900px with the drawer open closes it, as today.
- **⌘K routing.** `FindPanel` owns ⌘K wherever it is mounted, and it is not mounted in the strip. So while the rail is collapsed and no peek is open, `Navigation` holds the one ⌘K listener itself, using `FindPanel`'s own shortcut predicate: from 900px it opens the peek, and below 900px it opens the drawer on find, as `FindPanel`'s narrow branch does today. While the peek or the drawer is open, the `FindPanel` inside it owns ⌘K. The expanded rail's ⌘K is unchanged. (Amended while planning: the spec first gave `FindPanel` an `onCollapsedShortcut` branch, which cannot fire from a panel the strip does not render.)

### Implementation shape

- `src/client/components/Rail.tsx`
  - `Navigation` owns `collapsed` (initialised from storage) and `peek` (null or `{ opener }`), sets the body attribute in a layout effect, and renders the aside's rail with `collapsed`, the peek's rail expanded, and the drawer's rail expanded.
  - `Rail` takes `collapsed` and `onToggle`. Its place rows come from one list (href, word, page, icon, group), so the strip and the expanded rail cannot disagree about order, grouping or current state.
  - A small `Peek` component holds the overlay, its outside-pointer and focus-out handling and focus restoration, alongside `Drawer`.
- `src/views/railModel.ts`: class constants for the strip aside, the icon cell, the toggle button, the divider (both widths), the badge, the tooltip, the peek, and the realigned `RAIL_ROW`. The storage key and the two stored values are constants here too.
- `src/views/shared.ts`: the seven new icon paths in `ICONS`.
- `src/client/components/FindPanel.tsx`: exports its shortcut predicate for `Navigation`'s collapsed listener.
- `index.html`: the collapsed grid variant on `<body>`.

## Testing

- **Parity.** The frozen rail fixtures predate icons, the divider and the realigned site rows. Each is declared in `src/client/test/redesigns.ts`, dated and explained: the place rows gain their icon, site rows' padding moves from `pl-5` to `pl-8` (via `RAIL_ROW`), and the divider is inserted between the Sites and Host navs. The expanded rail's parity tests otherwise stand unchanged. The collapse button in the wordmark row is new markup in the fixtures' `h1` region, declared the same way.
- **`Rail.test.tsx`, collapsed:**
  - No site rows, no find input and no rail notes are rendered.
  - Each place link has its word as `sr-only` text and an `aria-hidden` tooltip.
  - The badge carries the signal's count and tone, the dot alone after a failed poll, and nothing when clean.
  - The existing rule checks hold in the collapsed state: one current row, Chalk on Hairline, no left rule, focus rings, no Ember, no Add site.
  - The divider is present in both states.
- **Toggle and persistence:**
  - Clicking toggles `aria-expanded`, the body attribute and the stored value, and moves focus to the other button.
  - A stored `collapsed` renders the strip on the first render.
  - A throwing `localStorage` renders expanded and does not throw on toggle.
- **Peek:**
  - ⌘K while collapsed opens the peek with find focused, and the find button does the same.
  - Escape closes find's panel first and then the peek, and focus goes back to the opener.
  - A rail link inside the peek closes it on the move.
  - The stored value is unchanged throughout.
- **Narrow:** with a stored `collapsed` below 900px, the drawer shows the expanded rail.
- **Browser** (mock server, Playwright): collapse, reload and confirm no flash, peek by ⌘K and by click, the tooltip on hover and focus, the current cell on a board page, and the narrow drawer. The design detector runs on `src/views src/client` with no findings.

## Documentation

- `DESIGN.md`
  - The rail section describes both states, the icons, the grouping divider, the toggle, the badge and the peek.
  - The icon list gains the seven icons.
  - New components: the icon strip, the strip tooltip and the peek.
  - Any amended named rule is re-derived into the sidecar.
- `.impeccable/design.json`: the rail component's description and CSS snippet, plus new snippets for the strip, the tooltip and the peek, with `narrative.rules` bodies re-derived from the prose.
- `CLAUDE.md`: the rail paragraph in Core v1 feature flow mentions the collapsed strip and the peek.
