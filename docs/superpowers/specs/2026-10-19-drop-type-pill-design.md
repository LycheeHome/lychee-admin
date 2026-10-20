# Drop the site type pill

Date: 2026-10-19. Status: approved design (sections approved in conversation),
awaiting written-spec review. Source: the 2026-10-19 whole-app critique
(`.impeccable/critique/2026-10-19T20-27-46Z__src-views.md`), its second P1.
Direction chosen from a rendered comparison — variant **04 No pill on the
list** of [Proxy Pill Colour](https://claude.ai/artifact/3KZCuKqYEsCYV4CZ722eQe),
against 01 Quiet pair, 02 Outline, 03 One shell, a glyph and the live control —
then extended by the operator to the detail header too: the type pill goes
everywhere.

## Why

The `proxy` type pill is Ember Light (`rose-300`) on Ember Deep (`rose-950`),
about 8° of hue from a Scorch failure pill at the same lightness and chroma.
On `/` the seeded list shows eight red-looking pills for two failures, so the
five-second "is anything down?" read — one of the two jobs `PRODUCT.md` weights
equally — is mostly noise. It also contradicts the Scorch-Is-Not-Ember Rule,
which exists to keep exactly these two apart; the pill's exemption from the
Ember Is Interactive Rule is what causes it.

Recolouring was on the table (01–03). The operator chose to remove the pill:
nothing they do on this app turns on whether a site is static or a proxy at a
glance, and the type is already stated twice — in each list row's address line
(`/var/www/<hostname>` versus `localhost:<port>` with the framework after a
middot), and on the detail page in the request path's last hop ("Your files"
versus "Your app") and in which cards appear.

## What exists today (read 2026-10-19)

| Place | Code |
|---|---|
| List row, right half: type pill then status slot | `renderSiteList`, `src/views/html.ts` ~135-150 |
| Detail header: type pill then status pill | `renderDetailHeader`, `html.ts` ~1019-1024 |
| Pill classes | `TYPE_PILL_STATIC`, `TYPE_PILL_PROXY` (`src/views/shared.ts:53-54`), `TYPE_PILL_BASE` (`html.ts:73`) |
| Status column reserving `sm:min-w-[9rem]` so a static row's type pill lines up with a proxy row's | `STATUS_SLOT` and its comment, `html.ts` ~76-89 |
| Screen-reader commas: after the hostname, at the start of the right half, before the status pill | `SPOKEN_COMMA`, `html.ts` ~100, uses ~139, ~142, ~148 |
| Tests on type pills | `src/views/html.test.ts` — imports `TYPE_PILL_PROXY` (L6), asserts `>static<` (~220) and the proxy class (~1091), and others matching the pill words |

## Design

### 1. Views

- **List rows.** The type pill is removed. The right half holds only the status
  slot; a static row's right half is empty.
- **Status slot.** The `sm:min-w-[9rem]` reservation and its comment go: they
  existed only so two pill columns lined up, and one right-justified column
  lines up by itself. `STATUS_SLOT` becomes `flex justify-end`, and the
  `data-status-slot` attribute stays.
- **Spoken commas.** The comma that opened the right half (it separated the
  address from the type pill) is removed, so a proxy row reads
  "api.lychee.land, localhost:4000, not responding" and a static row
  "blog.lychee.land, /var/www/blog.lychee.land" — no doubled or trailing comma.
  The `SPOKEN_COMMA` comment's example drops the type word.
- **Detail header.** The type pill is removed. A site with a status shows only
  its status pill in that row; a site with none (static) renders no pill row at
  all — no empty `mt-3` container.
- **Dead code.** `TYPE_PILL_STATIC`, `TYPE_PILL_PROXY` and `TYPE_PILL_BASE` are
  deleted, with their imports. Nothing else in the app uses them.

Out of scope: the add-site page's checked reverse-proxy option (a control you
act on, which the rule allows), the flash banner and page notice, status pill
colours.

### 2. Design system

`DESIGN.md`:

- **The Ember Is Interactive Rule** loses "— plus the one label that means
  'something else runs here' (the `proxy` pill)". The rule then has no
  exception.
- **Colour roles.** Ember Light: Ember's hover state on filled buttons only.
  Ember Deep: drops "the `proxy` pill". Hairline: drops "the fill of the
  `static` type pill". Hairline Strong: drops "the `static` pill's edge".
- **Pills.** The type-pill bullet is replaced by one sentence recording that
  there is no type pill and why: the type is already in each row's address and
  in the detail page's last hop, and a coloured type label competed with the
  status pills it sat beside.
- **List row composition** (the "A list row has two halves…" paragraph and the
  Site row behaviour entry): the right half is the status pill alone,
  right-aligned; the 9rem reservation and its rationale are removed.
- **Header nav note**: "deliberately not the `proxy` pill's Ember fill, so a nav
  item and a type pill never look alike" loses that clause.
- Any other sentence naming the type pill (e.g. the small-label list "type
  pills, status pills, the 1.2rem step numerals") drops it.

`.impeccable/design.json`: the Ember Is Interactive Rule's `narrative.rules`
body re-derived from the amended prose by the documented transform (strip
`**bold**` and backticks; from the rule's bolded header to the next rule header
or heading); the "Site Row" component description updated to match. Nothing
else changes.

`CLAUDE.md`: the shell paragraph's nav sentence loses "— deliberately not the
`proxy` pill's ember fill, so a nav item and a type pill never look alike".

## Testing

Written first, in `src/views/html.test.ts`:

1. No list row contains a type pill: the rendered list has no `>static<` or
   `>proxy<` pill span and no `rose-950`.
2. A proxy row's right half contains its status pill and nothing else; a static
   row's right half contains no pill.
3. A row's accessible text has exactly one spoken comma between each pair of
   facts — no `, ,` and no trailing comma — for both a static and a proxy row.
4. The detail header has no type pill for any site type; a proxy site's header
   still shows its status pill; a static site's header has no pill row.
5. The existing tests that asserted the type pill are rewritten to assert its
   absence, and the `TYPE_PILL_PROXY` import goes.

Verification: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`;
the detector on `src/views` returns `[]`; before/after screenshots of `/`,
`/sites/api.lychee.land` and `/sites/blog.lychee.land` from `npm run dev:mock`.
Done when the list's only red-family pills are `api` (not responding) and
`broken` (failed). View edits go through Edit/Write so the design-detector hook
sees them.
