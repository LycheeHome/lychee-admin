# Status consistency, links and `unknown`

Date: 2026-10-20. Status: approved design (approved in conversation), awaiting
written-spec review. Source: the 2026-10-19 whole-app critique
(`.impeccable/critique/2026-10-19T20-27-46Z__src-views.md`), P2 "health is
spread across four pages that disagree". That item was split into three
sub-projects with the operator: **this one (A + D + E)** — one status word per
site, links between a site and its services row, and an explanation for
`unknown`; then **B**, deploy trouble on installed board rows (needs a rendered
comparison); then **C**, a cross-page summary. Logic, links and copy only; no
new visual treatment.

## Why

- **A — one site, two words.** `broken.lychee.land` reads `FAILED` on the site
  list and its page but `EXITED` on `/services`. The site path
  (`resolveNextjsSite`, `src/routes/sites.ts`) decides: nothing installed and
  the last result failed → `failed`, and the container is never asked. The
  board (`buildBoard`, `src/lib/serviceBoard.ts`; `renderServiceRow`,
  `src/views/html.ts`) always shows the live container state. Same rule needed
  in both.
- **D — no way across.** A site page names its resource (`broken-lychee-land`)
  but does not link to it; the board names a site resource but does not link
  to its site. The operator has to translate the name and know which board
  page holds it.
- **E — `unknown` unexplained.** A board row reads `UNKNOWN` (neutral, by The
  Three-Tone Status Rule) when its live state could not be read, and nothing
  says so.

## Design

### A. One rule for an undeployed site resource

A pure function in `src/lib/siteDisplay.ts`:

```ts
export function undeployedStatus(entry: { version?: string; result?: string }):
  { kind: "failed" } | { kind: "awaiting-image" } | null
```

When `version` is empty or absent: `result === "failed"` → `{ kind: "failed" }`;
`result === "awaiting-image"` → `{ kind: "awaiting-image" }`; anything else →
`null`. When a version is installed → `null`. `null` means "use the live
container state".

- `resolveNextjsSite` uses it in place of its inline `resource.result ===
  "failed" ? … : "awaiting-image"`, keeping its current behaviour exactly:
  with nothing installed and a `null` answer it still returns
  `awaiting-image`, as today.
- The services board uses it for **container rows**: when it returns a status,
  the row's pill comes from `describeStatus` of that status (word and tone)
  instead of the live container state. Unit rows and container rows with an
  installed version are unchanged.
- An in-flight host action (`restarting`, `updating`) still overrides the pill
  as today; `applying` is unaffected (it needs an installed version).

Result on the seed: `broken-lychee-land` reads `failed` (bad) on the board, as
on its page; `preview-lychee-land` reads `awaiting image` (neutral). `gone`
(nothing installed, last result `deployed`) is unchanged.

### D. Links

- **Site page → board.** The request-path detail row `resource` renders its
  value as a link to `/services#service-<name>`. Every board row gains
  `id="service-<name>"` beside its existing `data-service`. Site resources are
  always in the `service` group, which is the `/services` page.
- **Board → site page.** `src/lib/siteResource.ts` gains
  `hostnameForResource(name: string, domain: string): string | null`, the
  inverse of `resourceNameFor` (`test-lychee-land` → `test.lychee.land`; `null`
  for a name that is not a site resource). On the board, a row whose name maps
  to a hostname **that is a managed site in the Caddyfile** renders its name as
  a link to `/sites/<hostname>`. The board route passes the set of managed
  hostnames (one local Caddyfile read, `parseCaddyfile`); an unreadable
  Caddyfile degrades to an empty set, so no links, never an error. A row whose
  site has been removed — its entry can outlive the site until the reconciler
  cleans up — stays plain text rather than linking to "not found".
- **Style** follows the breadcrumb link: the text keeps its colour, underline
  on hover, `FOCUS_RING`. No new treatment.

### E. Explaining `unknown`

A board row whose pill word is `unknown` (and no host action is running) gets
one `SERVICE_DETAIL` line, after the facts line:

- unit row: "lychee-admin couldn't read this unit's state from systemd."
- container row: "lychee-admin couldn't read this container's state."

The pill stays neutral.

## Docs

`DESIGN.md`: the Service Row entry notes the `unknown` line and that a site
resource's name links to its site; wherever the board's pill is described as
the live container state, add that a site resource with nothing installed
shows the same word its site page does. `CLAUDE.md`: the services-board
description notes that site status and board status share one rule for an
undeployed resource, and the two links. Sidecar: update any component entry
that describes the Service Row; re-derive a named rule's `narrative.rules`
body only if its prose changes.

## Testing

Written first:

1. `undeployedStatus` — nothing installed + `failed` → failed; nothing
   installed + `awaiting-image` → awaiting-image; nothing installed + other or
   no result → `null`; installed version + `failed` → `null`.
2. Board: a container row with nothing installed and `result: "failed"` shows
   a bad-tone `failed` pill even when its live state is `exited`; with
   `awaiting-image`, a neutral `awaiting image` pill; an installed row shows
   its live state; a unit row is unaffected.
3. The site path still returns `failed` / `awaiting-image` exactly as before
   (existing tests keep passing).
4. Site page: the `resource` row links to `/services#service-<name>`; each
   board row has `id="service-<name>"`.
5. `hostnameForResource` round-trips `resourceNameFor` and returns `null` for
   a non-site name (`palsave-api`).
6. Board: a site row whose hostname is in the managed set links to
   `/sites/<hostname>`; one whose hostname is not stays plain text; a non-site
   row never links.
7. Board: an `unknown` unit row and an `unknown` container row each show their
   sentence; a non-`unknown` row shows neither; a row with a running host
   action shows neither.

Verification: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; the detector on `src/views` returns `[]`; screenshots of
`/services` and `/sites/broken.lychee.land` from `npm run dev:mock`.

## Out of scope

Deploy trouble on rows with an installed version (`blocked`, retry cap) — that
is sub-project B. A cross-page summary or header counts — sub-project C. Any
change to the site list.
