# Site detail page redesign

## Problem

`renderSiteDetail` (`src/views/html.ts`) renders reverse-proxy site details as
one flat card: local port, framework, live status line, build command, run
command, and the GitHub Actions workflow block all stacked with no visual
separation beyond spacing. As the scaffold feature added more to this card
over time, it's become hard to scan — status and deploy instructions read as
one undifferentiated block. The header above it (back link, hostname, type
badge) is also minimal to the point of feeling like an afterthought rather
than a page header.

## Goal

Reorganize the reverse-proxy detail view into visually distinct sections, and
give the header more presence, without changing any of the underlying data,
routes, or logic — this is a presentational change confined to
`renderSiteDetail` and its supporting markup/CSS in `src/views/html.ts`.

## Design

### Header

Currently: small back link, hostname, and type badge in one row, all roughly
equal visual weight.

New treatment: hostname renders larger (bumped up from `text-xl` toward
`text-2xl`/`text-3xl` territory, matching the site's own display-font
convention used in the page `<h1>`). The type badge stays inline next to it.
For reverse-proxy sites only (where `respondingOnPort` is defined — static
sites have no port to check), a second small pill sits next to the type
badge showing live status at a glance:

- Responding: green pill, `● live`
- Not responding: red pill, `● down`

This introduces green/red as new semantic status colors. The previous detail
page design deliberately avoided green ("there's no green anywhere in this
palette," using rose for "Responding" instead) — this redesign supersedes
that call specifically for the header pill and Status card dot, per explicit
sign-off in this session. It's scoped to status semantics only; no other
part of the app's rose/stone palette changes.

Static sites (no port, no pill) show just the larger hostname + type badge,
same as reverse-proxy sites minus the pill.

### Card structure

**Static sites**: unchanged in substance — a single card, labeled "Overview,"
containing just the path line. No Status or Deploy cards, since neither
applies.

**Reverse-proxy sites**: the current single card splits into up to three
stacked cards, each with a small uppercase mono section-head label (matching
the existing `FORM_LABEL`/label style vocabulary already used elsewhere in
this file):

1. **Overview** — local port, and framework if set. Always present.
2. **Status** — the full status sentence (`● Responding on localhost:<port>`
   / `● Not responding on localhost:<port>`), colored to match the header
   pill (green/red), plus the existing docker-compose hint text when not
   responding. Always present for reverse-proxy sites (the header pill is
   the at-a-glance version; this card carries the full sentence and, when
   relevant, the hint). This card is the only place the hint text lives —
   nothing duplicates it into the Deploy card.
3. **Deploy** — build command, run command, and the GitHub Actions workflow
   block (with its existing copy-button). Only present when a framework
   scaffold exists (`scaffold` is defined), same condition as today.

Each card reuses the existing `bg-stone-800 border border-stone-700
rounded-[10px]` panel style already used for the current single card and for
list-page site cards — no new container styling, just more of them with a
label at the top of each.

### Layout

```
← Back to sites

blog.lyly.dev                              [proxy] [● live]

┌─ OVERVIEW ────────────────────────────────────┐
│ Local port: 3000                               │
│ Framework: Next.js                             │
└─────────────────────────────────────────────────┘

┌─ STATUS ──────────────────────────────────────┐
│ ● Responding on localhost:3000                 │
└─────────────────────────────────────────────────┘

┌─ DEPLOY ──────────────────────────────────────┐
│ Build command                                  │
│ npm run build                                  │
│                                                 │
│ Run command                                    │
│ npm start                                      │
│                                                 │
│ GitHub Actions workflow            [copy icon] │
│ name: deploy                                   │
│ on: push...                                    │
└─────────────────────────────────────────────────┘

[ Remove site ]
```

Static sites: header (no pill) + a single Overview card with the path line +
Remove site button. Same as today, just under the "Overview" label and the
larger header treatment.

### Out of scope

- No changes to `GET /sites/:hostname`, `checkPortOpen`, `frameworkScaffold.ts`,
  or any other logic/data — this is `src/views/html.ts` markup and CSS classes
  only (plus, if useful, small shared style constants alongside the existing
  `BUTTON_*`/`INPUT`/`FORM_LABEL` constants for the section-head label and
  status pill, reused across both cases).
- No changes to the site list page or its cards.
- No polling/auto-refresh, no new status semantics beyond live/down.
- No icons added to section headers — text labels only, matching the
  existing mono-uppercase label style used elsewhere in this file.
