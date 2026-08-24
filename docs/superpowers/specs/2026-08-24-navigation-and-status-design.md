# Navigation and status

Supersedes the navigation half of
[the sidebar navigation spec](2026-08-21-sidebar-navigation-design.md).
That spec's two problems were real and are restated below; its answer — a
220px persistent rail — is replaced here. Everything else it shipped is kept.

## Problem

The sidebar spec named two gaps: site-to-site switching costs a round trip
through the dashboard grid, and there is nowhere to put a page that isn't a
site. Both hold. The rail answers the first and pays for it on the wrong
axis, and it answers the second by building chrome for pages that do not
exist yet.

Measured on the branch, at a desktop viewport:

- **The expensive axis is horizontal.** The request path — the signature
  component, and the reason the detail page exists — is a four-hop row that
  needs width. With the rail present, a 640px window leaves a 372px content
  box, and the chain stays horizontal and breaks machine facts mid-token:
  `app.ly / ly.dev`, `cloudflar / ed-sites`, `localhos / t:3000`. The list
  page is a card grid and the detail page a 760px column; both have vertical
  space to spare and none to spare sideways.
- **`sm` stopped meaning what DESIGN.md says it means.** Tailwind's `sm:`
  measures the viewport, but the content box is now viewport − 220 − 48, so
  the one breakpoint in the system — "the floor that keeps a narrow window
  honest" — is off by exactly the rail's width. Below 600px the flash banner
  also overhangs into the rail on the left and past the viewport on the
  right, because `w-[min(480px,calc(100vw-2rem))]` clamps against the
  viewport rather than the column it is centered on.
- **222–420px of void.** Content still centers inside the space left over
  beside the rail, so a 760px detail page sits 222px right of it and the
  640px 404 card sits 420px right, leaving the composition without a centre.
- **The rail's rows duplicate the cards.** On `/`, all five sites are already
  on screen; the rail lists the same five hostnames with the same type hints,
  and reports the state of none of them.
- **It is the shape DESIGN.md rejects.** "The generic dark SaaS dashboard" is
  a confirmed anti-reference, and a left rail with an entity switcher, a
  chevron, a flat two-item nav and a dim wordmark in the corner is that
  genre's most recognizable component. Swap "site" for "project" and it drops
  into any multi-tenant product unaltered.

Two further findings from `/impeccable critique` (26/40; snapshot at
`.impeccable/critique/2026-08-24T05-20-21Z__src-views-shell-ts.md`) belong to
this spec rather than to polish:

- **Ember was inverted.** The rail gives the *current* item the `proxy`
  pill's exact ember treatment, so on `/` the place you already are is ember
  and the actionable control is Smoke — against the rule that ember marks
  what you can act on.
- **The switcher truncates hostnames**, in the one control whose only job is
  picking a hostname: the trigger clips from 20 characters, rows from ~28.
  Two sites named `staging-dashboard-preview` and `staging-dashboard-prod`
  render identically, and opening the wrong one lands you on a page with a
  Remove button.

Separately, and unrelated to the rail: **"is anything down" still costs one
navigation per site.** `PRODUCT.md` names two jobs of equal weight and says
neither may be buried behind the other, but status exists only on a site's
own page. The sidebar spec correctly costed rail status dots (N TCP connects
plus a sudo'd `docker compose ps` per page load) and rejected them; the
conclusion drawn was that no surface gets status, which does not follow.

## Goal

1. A site-to-site move with no round trip through the list.
2. A place for host-level pages that costs nothing until they exist.
3. "Is anything down" answered in one page load.

## Direction: three tiers, each scoped to what it navigates

**Tier 1 — a global header band.** Restores the 40px band DESIGN.md already
documents, and with it the `display` token at 1.5rem that the rail had
orphaned by demoting the wordmark to 0.8rem Smoke Deep. Carries the wordmark
as home plus `sites` and `add site`. The governing rule: a header item's
destination never changes with location. The moment `log` means this site's
log on one page and the host's log on another, it is a control you have to
read the URL to understand.

**Tier 2 — a hostname dropdown on the breadcrumb**, on site pages only. The
list page needs none: it is already the switcher. Reuses the branch's
`<details>` keyboard layer verbatim — Escape closes and refocuses the
trigger, arrow keys traverse, `focusout` closes on tab-past, click-outside
uses containment — which works without JS and is the best-engineered part of
the rail work. Rows carry hostname plus type hint (`STATIC` / `:port`) and
**no status**: pills there would mean N checks on every page instead of N on
one. No truncation: `splitHostnameForDisplay` renders the subdomain in Chalk
and the shared `.lyly.dev` in Smoke — not Smoke Deep, which the Global
Constraints section below rules out at row size — which still buys real
characters back per row and echoes, rather than exactly matches, the detail
page's headline treatment.

**Tier 3 — per-site tabs, deferred, with a stated trigger.** A section earns
a tab when it is tall *and* task-specific: something you came to do, not
something you came to know. Today exactly one section qualifies (Deploy,
which renders a whole workflow file), and one candidate does not make a tab
strip. The trigger is the second one arriving — most likely container logs,
which is where `docker compose logs` would move from its current home beside
the failing hop. When that happens: real server-rendered routes
(`/sites/<hostname>/deploy`), plain links with `aria-current="page"`, never
the ARIA tab pattern and never client-held view state. Overview stays the
default and permanently carries status and Danger — the page's answer and its
destructive action are not things you navigate to.

**No rail.** Content-box width equals viewport width again, so `sm` recovers
its documented meaning, the hop chain stacks when it should, the banner
returns to plain centering, and the banner/dialog centre disagreement
dissolves without needing a shared rail-width token.

## Status on the list cards

Tone pills on the cards, server-rendered, `Promise.all` across reverse-proxy
sites only — static sites have no check today and gain none. Latency is the
slowest check, not the sum.

**Prerequisite, landing first as its own change:** `run()` in
`src/lib/systemCommands.ts` calls `execFile` with no `timeout`, and
`checkContainerStatus`'s `catch` handles a non-zero exit, not a hang. A
wedged `dockerd` therefore hangs a site's detail page today, and would hang
the front door once the list page checks containers. Pass a timeout and
degrade to `{ state: "unknown" }`, which is already neutral in the canonical
vocabulary.

Rejected: filling pills in asynchronously after page load. It buys
page-load latency insurance that one operator on a LAN does not need, and
costs a status endpoint, a client fan-out, a loading state, and a second
place the same fact is rendered — in an app whose one status vocabulary
exists so the page "can never describe one fact two ways." Revisit past
roughly ten sites, where N `docker compose ps` spawns per view of `/` stops
being free on a box that also runs a game server.

## Scope

Rework the existing branch in place rather than merging the rail and removing
it afterwards.

**Keep from the rail work:** the view-layer split (`shell.ts` / `shared.ts`),
add-site as its own page at `/sites/new`, the in-flow `?created=1` notice
that pushes the heading down instead of covering it, and the `<details>`
keyboard layer.

**Remove:** the rail, its sticky full-height column, the body flex row, and
the banner's `calc(50% + 110px)` offset.

**Add:** the header band with `sites` and `add site`, the breadcrumb
dropdown, and status pills on the list cards.

**Untouched:** the four-card detail composition, the remove flow's ordering
and copy, all Caddyfile and tunnel logic, and DESIGN.md's palette and type
ramp beyond the reconciliations below.

**Non-goals:** client-side routing, client-held view state, the ARIA tab
pattern, status in the header or the dropdown, and any rail returning under
another name.

## States and ranges

- **0 sites:** the header keeps both items; the list shows its empty state;
  the dropdown is *suppressed*, not rendered inert. The branch's
  `<div aria-disabled="true">` lookalike is dropped — `aria-disabled` on a
  generic element is ignored, so it announces as bare text beside a
  decorative chevron.
- **1 / 5 typical / ~15 ceiling.** Past ~10, revisit async pills.
- **Long hostname:** `staging-dashboard-preview.lyly.dev` must render whole
  in both the dropdown trigger and its rows.
- **Apex `lyly.dev`:** a managed site with no suffix to dim; it stays whole.
- **All nine canonical status values**, including `unknown` from a timed-out
  check, which renders neutral rather than red.
- `/sites/new` and the 404 both carry the header; the 404 keeps being a
  recovery surface rather than a dead end.

## Constraints and consequences

- **The Smoke Deep contrast fix gates the dropdown.** Measured with full
  ancestor compositing, `#79716b` (stone-500) runs 3.17–3.65:1 against both
  Hearth and Hearth Lift, below AA for every size in this app. The dropdown's
  type hints reuse that exact role, so shipping it first would import a known
  failure into a new control. Either stone-500 stops carrying text, or it
  moves up toward stone-400 — and DESIGN.md's "dimmest legible text" line
  gets restated either way.
- **DESIGN.md reconciliations:** rewrite Components > Navigation for the
  header and dropdown (it currently states no sidebar exists, describing
  `main`), record the header band's geometry, restate the wordmark step, and
  keep the floating-panel `max-h` exception — the dropdown still needs it,
  since a panel taller than the viewport cannot be reached. **Resolved**:
  done in Task 6.
- **`PRODUCT.md`** still says the sidebar and `/sites/new` are planned and
  not yet built; it updates when this lands. **Resolved**: done in Task 6.
- **Accepted deliberately:** `add site` appears both in the header and as the
  list page's primary button. Resolved by weight, not deletion — same label
  in both places, quiet Smoke treatment in the header with `aria-current`
  when on `/sites/new`, ember primary button on the list page. With zero
  sites that button is the entire call to action, so it is not the one that
  goes.
- **Also worth fixing while here:** site cards in the main column fall back
  to the UA default focus outline instead of the shared 2px Ember ring that
  DESIGN.md says every control carries. Pre-existing on `main`.
- **Two accessibility fixes from `main` cannot arrive by merging.** The
  commit that brought dim text up to AA also removed the input placeholder's
  opacity modifier and added a `#copy-status` live region — both in
  `html.ts`. This branch had already moved `INPUT` into `shared.ts` and
  `layout()` into `shell.ts`, so git sees `main` editing lines this branch
  deleted, and neither fix lands: `shared.ts`'s
  `placeholder:text-stone-400/60` (4.45:1) and the missing live region in
  `shell.ts`'s `layout()` both survive the merge untouched. Re-apply both by
  hand, whatever happens to the rail. Expect a conflict in `html.ts` as well,
  where both sides edited the hop-label and detail-key regions. **Resolved**:
  both were hand-applied in the merge that landed before this rework —
  `shared.ts`'s `INPUT` carries plain `placeholder:text-stone-400`, and
  `shell.ts`'s `layout()` renders `#copy-status`.
- **The rail's own dim text is deliberately left alone.** `shell.ts` has four
  `text-stone-500` uses that all fail the Dim-Text Rule, but three of them —
  the disabled trigger, its "Switch to site…" label, and the type hint —
  leave with the rail, and the wordmark's treatment is already listed above
  for restatement. Fixing them before the rework is work thrown away.
  **Resolved**: the rail is gone, taking three of the four uses with it; the
  fourth, the wordmark, is now Chalk at Display size in the header band, not
  Smoke Deep.

## Open decisions

- Whether `log` (the audit log `src/lib/logger.ts` already writes) and
  `backups` (`/etc/lyly-admin/backups`) get built at all. The header is
  designed to hold them; nothing here commits to them.
- Whether tabs ever arrive. The trigger is stated, not scheduled.
