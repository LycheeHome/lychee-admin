# Sidebar navigation

## Problem

Every page in `lyly-admin` is a centered column under a large `lyly.admin`
wordmark, with no persistent navigation. Two consequences:

1. **Site-to-site switching costs a round trip.** Getting from
   `/sites/blog.lyly.dev` to `/sites/api.lyly.dev` means going back to the
   dashboard grid and picking a card. There is no way to move sideways.
2. **There is nowhere to put a page that isn't a site.** Host-level views one
   might eventually want — `caddy`/`cloudflared-sites` service state, the audit
   log `src/lib/logger.ts` already writes, backup history — have no navigation
   structure to hang off. Adding one today means inventing the structure at the
   same time.

The `<header>` currently spends `py-10 pb-12` on a wordmark that is not a
control and never changes.

## Goal

Add a fixed left sidebar carrying a site switcher and a flat nav, and move the
add-site flow out of its modal onto its own page so that every rail item is a
real destination.

**Non-goals**, settled explicitly during design:

- **Not a section nav for the detail page.** The detail page's content is
  unchanged; the rail does not link to anchors within it.
- **No two-level (site-scoped) nav.** Future pages are undecided, so the rail
  gets one flat list. A second level stays cheap to add later precisely because
  nothing is built for it now.
- **No responsive treatment.** `lyly-admin` is used from a desktop browser on
  the LAN. The rail is permanently fixed: no collapse, no hamburger, no
  off-canvas drawer, no breakpoint behavior.
- **No live status in the rail.** See "Site switcher" below.

## Design

### Shell

`<body>` becomes a flex row. The rail is `w-[220px] shrink-0`, full height,
`border-r border-stone-700`, `bg-stone-800` against the page's `bg-stone-900`.
Main content keeps its existing `max-w-[1080px]` and centers in the remaining
space.

The `<header>` block and its `lyly.admin` wordmark are removed. The brand
reappears as a small dim mark pinned to the rail's footer. On a single-operator
internal tool the wordmark does not earn the page's most prominent slot; the
switcher does, because switching is the thing being fixed.

Rail contents, top to bottom:

1. The site switcher (below).
2. Nav: **All sites** (`/`), **Add site** (`/sites/new`).
3. Flexible spacer.
4. The `lyly.admin` brand mark.

Nav items are links, each carrying `aria-current="page"` when active. That
attribute is both the accessibility signal and the styling hook, via Tailwind's
`aria-current:` variant — there is no parallel CSS class to keep in sync with
it. `/` activates All sites, `/sites/new` activates Add site, and
`/sites/:hostname` activates neither (the switcher carries the location
instead).

A dashed separator sits below the nav marking where future pages land. It is
decorative only; no placeholder links.

### Site switcher

A disclosure whose panel lists every managed site as a link. Closed, it shows
the active hostname; on pages with no active site it reads `Switch to site…` in
dim text.

Each row carries the hostname and a right-aligned type hint — `STATIC`, or the
port for a reverse proxy. **No status dots.** Dots would mean status-checking
every site on every page load — a TCP connect per plain proxy plus a
`docker compose ps` shell-out per scaffolded site — where today only the detail
page checks, for one site. Rejected deliberately: the rail's job is navigation,
and this keeps its data purely a function of the Caddyfile parse that already
happens.

The active site stays listed rather than being filtered out, and is highlighted
via `aria-current="page"`. Filtering it would reshuffle the list as the user
moves around.

The panel lists sites only. `All sites` and `Add site` remain nav items rather
than moving inside it: one job per control, and it keeps the nav populated on
day one instead of empty until the undecided future pages arrive.

**Implemented as native `<details>`/`<summary>`,** not a hand-rolled button.
This follows the existing preference for platform elements — both modals are
real `<dialog>` with `showModal()`. The browser supplies open/close state and
disclosure semantics, it works with JS disabled, and there is no manual
`aria-expanded` bookkeeping to drift. The panel is `position: absolute` so it
overlays the nav rather than displacing it.

The panel's rows are `<a>` elements in a `<ul>`, not `role="menu"`/`menuitem`.
They are links; plain links keep Tab order and screen-reader link navigation
behaving as expected.

Note on precedent: a `<details>` fold was rejected during the site detail page
redesign. That fold hid content the user needed and could not discover from its
label. This is transient navigation chrome whose closed state is its resting
state, and the full site list remains visible on `/` regardless.

### Add site becomes a page

The `#add-site-dialog` modal is removed from `renderSiteList`, along with its
`data-open-dialog` trigger button. The form moves to a new page at
`/sites/new`.

Reasons, in order of weight:

1. **The form is too big for the box it is in.** It is roughly 60 lines of
   markup inside `w-[min(460px,calc(100vw-2rem))]`: a hostname field, two radio
   cards each carrying two lines of explanatory prose, then a conditional block
   with port, framework select, and healthcheck path with its own help text. It
   is also the only place in the app that explains the static-vs-proxy
   distinction and what the framework picker does. Compressing that into 460px
   is the instinct rejected repeatedly during the detail-page redesign;
   compactness is not a constraint worth paying for here.
2. **A modal-opening nav item is inconsistent.** Every other rail item
   navigates. A modal also cannot be opened from a page that does not render
   it, which would otherwise force either a `/?add=1` round trip or hoisting
   the dialog (and its `#port-owners-data` block) into the shell — including
   onto the 500 path, which renders `renderSiteList([], …)` and would then show
   an add-site form on a page whose message is that the config is unreadable.
3. **Room to grow.** A second framework, or per-framework options, and the
   modal starts fighting the content.

`POST /sites` is unchanged — same request shape, same JSON response, same
ordering guarantees. Only where the form lives and what happens after success
change.

**After a successful add, the client navigates to the new site's own detail
page:** `/sites/<hostname>?created=1`. This replaces the current
stay-in-place-and-show-a-banner behavior. It removes more than it adds — three
pieces of client-side machinery go, against one optional `layout()` parameter:

- The DNS reminder no longer needs to ride in a transient banner. The detail
  page's Manual steps already states the `cloudflared tunnel route dns` command
  permanently, and Deploy already carries `docker compose up -d --build` for
  scaffolded sites. Both are strictly better placements than a dismissible
  banner.
- `refreshSitesGrid()` in `public/app.js` is **deleted.** Its only caller is
  the add-site success path, and a full navigation makes it unnecessary. This
  also resolves what would otherwise be a new bug: the rail is server-rendered,
  so a client-side grid swap would have left the switcher missing the
  just-added site until the next full page load.
- The `portOwners[result.target] = result.hostname` live-update line goes too,
  for the same reason.

#### The `?created=1` banner

Landing on the detail page means landing on an honest status pill, and for two
of the three site types that pill reports something that is not yet working:

| Type | Pill on arrival | Why |
| --- | --- | --- |
| Static | responding | Caddy serves the placeholder `index.html` immediately. |
| Reverse proxy | not responding | Nothing is listening on the port yet. |
| Reverse proxy + Next.js | not deployed | The container has not been built. |

A bare "Added `<hostname>`" banner next to a red pill reads as a
contradiction. So the banner's job is to **explain the pill**: state that the
routing `lyly-admin` owns succeeded, and name what is still the user's to do.

| Type | Banner |
| --- | --- |
| Static | Added `blog.lyly.dev` — Caddy is serving the placeholder page it created. Manual steps has the DNS record and how to replace it. |
| Reverse proxy | Added `api.lyly.dev` — routing is live, but nothing is listening on port 3000 yet, so it shows as not responding until you start your process. |
| Reverse proxy + Next.js | Added `app.lyly.dev` — routing is live and the scaffold is at `/var/www/app.lyly.dev`. It shows as not deployed until you add your source and deploy. |

Leading with "routing is live" is what resolves the mixed message: what the app
did succeeded, and what is missing belongs to the user.

**The banner is rendered server-side,** which is a change from rendering it on
the client. Picking the right wording needs `site.type` and `site.framework`,
and the detail route already has both — along with `site.target` and the tunnel
ID it already reads. Nothing is smuggled through the query string beyond the
`created=1` flag itself.

This means `layout()` takes an optional banner (see the table above), which
renders `#flash-banner` un-hidden and pre-filled, with its close button
visible — the same "persistent" treatment the current client-side add-success
banner uses: `bg-rose-950/60 border-rose-400/70`, no auto-dismiss, dismissible.
The existing `hideBanner` click handler already targets that element by id and
needs no change.

`public/app.js` therefore does **not** construct this banner. Its only
`created` handling is `history.replaceState` to strip the parameter, so a
reload does not re-announce the add — three lines beside the existing
`?removed=` branch. Note the asymmetry with `?removed=`, which stays
client-rendered: a removed site has no page and no state left to describe,
while a created one has both.

Removal is unaffected: it already navigates to `/?removed=…`, a full load, so
the rail comes back fresh.

### Data flow

The rail needs the managed site list and the active hostname on every page.
Both are already available; **this change adds no filesystem reads, no
subprocess calls, and no network checks.**

`GET /sites/:hostname` already parses the whole Caddyfile and discards all but
one entry:

```ts
const site = caddyfile.parseSites(content).find((s) => s.hostname === hostname && isManagedHostname(s.hostname));
```

becomes:

```ts
const sites = caddyfile.parseSites(content).filter((s) => isManagedHostname(s.hostname));
const site = sites.find((s) => s.hostname === hostname);
```

Equivalent, and it makes the managed-site filter textually identical to the one
in `GET /`.

Signature changes, in full:

| Function | Change |
| --- | --- |
| `renderSiteList` | **None.** It already receives `sites`; it derives the rail from that, with no active hostname. Its five positional parameters do not grow a sixth. |
| `renderSiteDetail(site, opts)` | `sites: Site[]` and `created?: boolean` added to the existing options object. No new positional parameter. Active hostname is `site.hostname`. The view derives the banner wording from `site.type`, `site.framework` and `site.target` — the route passes only the flag, so the copy lives in the view layer with the rest of the copy and is unit-testable per type. |
| `renderSiteNotFound(hostname)` | Becomes `renderSiteNotFound(hostname, sites)`. |
| `layout(title, body)` | Becomes `layout(title, body, nav, banner?)`, where `nav` is `{ sites: Site[]; active?: string }` and `banner` is `{ message: string }` for the `?created=1` case. Module-private, so this is internal. |
| `renderAddSite` | New, in `src/views/html.ts` alongside the other page renderers. Takes the site list (for the rail), `domain` (for the hostname placeholder), and `portOwners` (for the client-side conflict check). |

`Site` from `src/lib/caddyfile.ts` is reused rather than introducing a
`NavSite` type — the switcher reads only `hostname`, `type` and `target`, all
already on it. No mapping layer.

The POST routes return JSON and are untouched.

`GET /sites/new` computes `portOwners` the same way `GET /` does. That
computation — reserved ports plus one entry per reverse-proxy site — is
extracted into a small helper in `src/routes/sites.ts` and called from both.

### Module structure

`src/views/html.ts` is 585 lines; a rail plus a switcher plus the add-site page
pushes it well past 700. Two new files:

- **`src/views/shared.ts`** — `escapeHtml`, the class-name constants
  (`BUTTON_PRIMARY`, `BUTTON_SECONDARY`, `BUTTON_DANGER`, `INPUT`,
  `FORM_LABEL`, `FOCUS_RING`, `CARD`, the `TONE_*` maps, …), and `ICONS` /
  `icon()`. Both view files need all of these.
- **`src/views/shell.ts`** — `layout()`, the `#flash-banner` element it
  contains, the rail, and the switcher. Exports the `Nav` interface
  (`{ sites: Site[]; active?: string }`) that the page renderers construct.

`copyButton()` stays in `src/views/html.ts`, importing `FOCUS_RING` and
`icon()` from `shared.ts` — it is used only by the detail page.

`ICONS` gains two entries: `chevronDown` for the switcher's caret and a grid
glyph for the All sites nav item. `plus` already exists and is reused for Add
site.

This extraction is caused by the change rather than adjacent to it, but it is
the one piece of scope here that is not the feature itself.

### Client JS

Roughly 40 lines added to `public/app.js`, in its existing style — query by id
or `data-` attribute, `addEventListener`, optional chaining, no framework:

- **Esc** closes the switcher and returns focus to the `<summary>`.
- **Click outside** closes it, via `!details.contains(event.target)`. This
  deliberately does *not* reuse the bounding-rect idiom used for
  `dialog.modal`; that check exists because a `<dialog>`'s backdrop is part of
  the element itself, which does not apply to a dropdown.
- **Arrow Down / Up** moves focus along the panel's links. Arrow Down on a
  closed summary opens it and focuses the first row.
- **`focusout`** whose `relatedTarget` is outside the element closes it, so
  tabbing past does not leave it open.

Home/End and type-ahead are skipped — YAGNI at this list size.

`app.js` remains a single file loaded from `layout()` on every page. The
add-site code, now live only on `/sites/new`, keeps no-oping elsewhere through
the `?.` pattern already used throughout the file. No bundle splitting.

### Empty and error states

All three are reachable:

1. **No managed sites.** The switcher renders as a disabled trigger reading
   `No sites`, with no panel and no `<ul>`. The grid already says "No sites
   configured yet."
2. **500 on the detail route.** The existing `catch` calls
   `renderSiteList([], …)`, so the rail shows that same empty state. This is
   honest: the Caddyfile read failed, so the site list genuinely is unknown.
   That this path renders the *list* page for a *detail* route failure is
   pre-existing and is not addressed here.
3. **404, site not found.** `renderSiteNotFound(hostname, sites)` renders the
   full rail with no active item, which makes the switcher a recovery path from
   a mistyped URL. The current page is a dead end.

The detail page's existing breadcrumb to `/` is left as is. It is arguably
redundant beside a persistent All sites link, but removing it is a separate
judgment call.

## Testing

View assertions must be **anchored to the rail**, following the `labelled`
helper already at `src/views/html.test.ts:416` — a regex that walks forward
from an identifying attribute without crossing the element's closing tag. A
document-wide `/app\.lyly\.dev/` on the detail page proves nothing: that
hostname already appears in the heading, the breadcrumb, the Visit link, and
the request-path hops. Each new assertion must be shown to fail when the rail
does not contain what is claimed.

New view tests:

- The rail renders on all four pages: list, detail, `/sites/new`, and 404.
- The switcher lists every managed site.
- The deliberately unmanaged `lychee.local` block from `src/dev/seed.ts` never
  appears in the switcher.
- The active site carries `aria-current="page"` and the other rows do not.
- An empty site list yields a disabled trigger and no `<ul>`.
- `renderSiteNotFound` lists sites.
- `/sites/new` renders the fields that previously lived in the dialog, and
  `renderSiteList` no longer contains `add-site-dialog`.
- With `created: true`, each of the three site types gets its own banner
  wording, and each names the state its own status pill shows — anchored to
  `#flash-banner` so a page-wide match on "not responding" cannot pass on the
  strength of the pill or the request-path hop already saying it.
- Without `created`, `#flash-banner` still renders hidden and empty, as it does
  today on every page.

Route tests:

- `GET /sites/:hostname` puts *other* sites' hostnames in the rail, anchored to
  it. This is the test that proves the list is threaded through rather than
  only the active site.
- `GET /sites/new` returns 200 and includes the port-owners data block.
- The existing add-flow tests assert on `POST /sites`'s JSON, which does not
  change, and survive untouched.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then a
click-through on `npm run dev:mock` — which covers the switcher against seeded
data including the unmanaged block, but cannot cover anything privileged, and
nothing here is privileged.
