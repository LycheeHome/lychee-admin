# Add-site split console

Redesigns `GET /sites/new` into a two-column page whose right column shows the
exact text about to be appended to `/etc/caddy/Caddyfile` and the sites
tunnel's `sites-config.yml`, produced by the same functions that will write
them.

Chosen from five rendered directions compared against the shipping page:
[Add-Site Directions](https://claude.ai/code/artifact/d91c09ae-fe46-4132-bf31-d830097001dc)
(variant 02, "Split Console"). The four rejected directions and their costs are
recorded there; this spec does not restate them.

## Problem

Measured on the rendered page at a 1280px desktop viewport, and against
`src/views/html.ts:170-261`.

- **The commit control sits above its own contract.** The Cancel/Add site row
  renders at mid-page and the six-step "On submit" list renders *below* it.
  `PRODUCT.md` Principle 2 says every mutating flow names its steps in the
  order they run; today the page does that in a footnote, after the button
  that runs them. Everything else destructive in this app — the remove dialog
  — puts its step list before its confirm control.

- **The step list promises a step that will not run.** All six `ADD_STEPS`
  render flat regardless of type. For a plain reverse-proxy site with no
  framework there is no directory to create, and `src/routes/sites.ts:277`
  calls `report.skip("files")` for exactly that case. The server models it
  correctly; the pre-submit list cannot, because it renders before a type is
  chosen.

- **The page never shows the config it is about to write.** This is the
  largest gap and the reason for the redesign. `PRODUCT.md` states the product
  purpose as replacing hand-editing those two files "with a web UI that
  performs the same edits in a safe, fixed order", and Principle 1 is "show
  the mechanism, at full size — the exact file, service, path, port, and
  command *are* the content". The one page that performs the edit shows none
  of it. A wrong port is valid config and a dead site, and nothing on the page
  surfaces it before the reload.

- **A duplicate hostname is a server-only rejection.** `computePortOwners`
  (`src/routes/sites.ts:44-53`) already covers both port conflicts *and* the
  two reserved ports client-side, so those are flagged as you type.
  `hostnameExists` is not — you learn a hostname is taken only after
  submitting, and `public/app.js:371` documents a real bug that came from
  exactly that path.

- **One spacing value for every relationship.** `gap-5` (20px) separates
  breadcrumb from headline, headline from hostname, hostname from type, type
  from actions. Nothing groups, because everything is equidistant. The system
  documents eight steps from 6px to 24px and this page spends one.

- **No echo of the composed hostname.** You type `blog` into a field with
  `.lyly.dev` affixed to its right edge and never see `blog.lyly.dev` as one
  string, on the page whose entire output is that string.

- **Visual mass is inverted against decision cost.** The two type rows are
  ~70px each with three lines of explanation apiece. The hostname — the only
  field with no default, and the only one that cannot be changed later without
  a remove-and-re-add — is a single 38px row.

## Goal

1. The exact text about to be written to both config files, visible before the
   mutation is authorized, and provably identical to what gets written.
2. The contract — what runs, in what order — above the button that runs it.
3. A step list that tells the truth about which steps apply to the site being
   created.
4. A duplicate hostname caught before submit, alongside the port conflicts
   already caught there.

## Direction: form left, what-gets-written right

The page runs the full 1080px frame the shell already provides and splits into
two columns: the form at `1fr`, a preview panel at a fixed `400px`, `24px`
apart. At 1080 that puts the form at 656px — *narrower* than today's 760, so
every label, input, and option-row sentence gets a shorter measure, not a
longer one.

The right column is one card, `Will be written`, holding in order:

- the Caddyfile block that will be appended, under its path
- the ingress lines that will be inserted, under their path, with the
  catch-all line beneath them in Smoke Deep so the insertion point is visible
- the directory and files that will be created, if any
- a `1px` Hairline rule
- the six steps, in execution order, with any step that will not run dimmed to
  Smoke Deep and marked `skipped`

The panel is therefore both the preview and the contract, and it sits beside
the form rather than after it, which is what puts the contract above the
button without pushing the button below the fold.

The page headline becomes the composed hostname — `blog` in Chalk with
`.lyly.dev` in Smoke Deep, at Headline size — matching the treatment a site's
detail page gives its own hostname, so the page you are filling in already
looks like the page you are about to create.

### Why a server endpoint and not client-side rendering

The panel's claim is that this is *the exact text*. That claim is only worth
making if one implementation produces both. Rendering the block in `app.js`
would mean two implementations of the same string-building that must stay in
lockstep forever, and the first divergence shows the operator config that is
not what gets written — on the page whose pitch is that they never have to
open those files.

`POST /sites/preview` therefore calls `caddyfile.appendSite` and
`tunnelConfig.addIngressRule` — the real functions — and derives the added
text by diffing their output against the input. Drift becomes structurally
impossible rather than a thing to maintain.

The Caddyfile diff is exact by construction: `appendSite` returns
`${trimmed}\n\n${block}` + `"\n"`, so the addition is whatever follows the
trimmed original. The tunnel config is re-serialized whole by `yaml.dump`, so
its addition is found by a contiguous line diff — which has the useful
property that if the YAML round-trip ever reformats a line the app did not
intend to touch, the operator sees that too.

### Validation shares one path

`validateSiteInput` is extracted from the `POST /sites` handler and called by
both routes, so the preview cannot accept input the submit will reject, or
reject input the submit would accept. The preview surfaces the submit's own
error strings.

## Scope

In:

- `GET /sites/new` layout, markup, and copy.
- `POST /sites/preview`, new.
- `POST /sites` refactored to call the extracted validator. No behavior change;
  the existing rejection tests are the gate.
- `public/app.js` preview fetching, debounce, race handling, rendering.
- `DESIGN.md` reconciliation (below), then a scoped `/impeccable document`.

Out:

- **The site detail page is untouched.** It keeps its 760px content cap, which
  is correct: it has one column of things to read and nothing to put beside
  them. Its prose measure is a real and separate finding — roughly 100–110
  characters against a `DESIGN.md` claim of "near 70ch" — and belongs to its
  own change.
- The site list is untouched.
- No new sudo scope. The preview reads the two config files the app already
  reads and writes nothing.
- The preview does **not** run `caddy validate`. It is a rendering of intent,
  not a dry run of the mutation.

## Constraints and consequences

- **The preview never writes.** No backup, no `writeManagedConfig`, no
  `createSiteDirectory`, no validate, no reload, no restart, no audit-log
  entry. Two file reads and two pure calls.
- **The preview returns fragments, not files.** The added block plus one
  context line — never the whole Caddyfile serialized to the browser. Basic
  auth on the LAN makes that not a leak, but it is more than the feature
  needs.
- **An incomplete form is not a client error.** `POST /sites/preview` returns
  `200` with `{ ready: false }` for a half-typed form, and `200` with
  `{ ready: false, error }` for input that fails validation. A `4xx` would
  make the browser console noisy on every keystroke and imply the request was
  malformed when it was merely early.
- **Responses can arrive out of order.** The client keeps a request sequence
  number and renders only the newest, so a slow early response cannot
  overwrite a fast later one.
- **The 2px Ember Edge branch rule is preserved.** The port / framework /
  healthcheck fields keep it. `DESIGN.md` calls it the system's one border
  that carries meaning rather than edge definition, and this direction keeps
  its only user.
- **`sm` stops being the only breakpoint.** The two columns collapse to one
  below Tailwind's `lg` (1024px), which is the nearest step below the 1128px
  the full layout needs. `DESIGN.md`'s "The only breakpoint in the system is
  `sm` (640px)" becomes false and must be edited in this change, not after it.

### The width rule, rewritten

`DESIGN.md`'s Width-Follows-Purpose Rule reads "1080px for a list of things
you are choosing between; 760px for one thing you are reading and acting on",
justified by "everything on it is either a sentence to read or a command to
copy, and neither improves at 1200px". The scope is a page-type dichotomy; the
justification is measure. This direction separates them: it takes 1080 while
making every line of prose on the page *shorter*, because the width buys a
second column rather than a longer line.

The rule is rewritten to say what it protects:

> **1080 is the page frame. 760 is a reading column.** A page runs the full
> frame when it has two kinds of content that belong side by side, and caps at
> 760 when it has one. No width ever lengthens a line of prose past ~70ch.

This documents what the code already does rather than changing it:
`src/views/shell.ts:126` already sets `<main>` to `max-w-[1080px]`, and
`DETAIL_WIDTH` is a cap applied *inside* that frame by the pages that want
one. Add-site takes 1080 by dropping `DETAIL_WIDTH`, not by widening anything.

The rewrite also settles the count: the system keeps exactly two numbers, and
add-site moves from one existing number to the other. It does not add a third.

### Typography: Headline names a site that does not exist yet

`DESIGN.md` scopes Headline to "a site's hostname on its detail page". This
direction extends it to the hostname being composed on the add page. The
Smoke Deep suffix is legible only at that size — 27px is WCAG large text — so
the role cannot simply be loosened to "any hostname"; the extension is to
"a site's hostname, on the page that owns it, including the one being
created". Typography section updated accordingly.

## States and ranges

- **Nothing typed.** Panel shows its label and one Smoke line: the block and
  route appear once the site is named. No skeleton, no placeholder config.
- **Hostname only, type static.** Full preview: block, ingress lines,
  directory with `index.html`, six steps all running.
- **Reverse proxy, no port yet.** `{ ready: false }` — the block cannot be
  rendered without a target. Same empty line as above.
- **Reverse proxy, plain.** Preview renders; the `files` step dims to
  `skipped`, and no directory section appears.
- **Reverse proxy, Next.js.** Directory section lists `Dockerfile`,
  `docker-compose.yml`, `.dockerignore`.
- **Validation failure** (duplicate hostname, port in use, reserved port, bad
  healthcheck path). Panel shows the submit's own error string in Scorch on
  Scorch Deep, in place of the preview. The inline `#port-error` beside the
  port field is unchanged and still fires from `portOwners`.
- **Below 1024px.** One column: form, then the panel beneath it.
- **Preview request fails** (network, 500). Panel keeps the last good render
  and shows nothing new. A failed preview must never block submitting — it is
  a read, and the mutation has its own validation.

## Open decisions

None. The three that were open when the directions were compared are settled
above: the step list reacts to type, Headline extends to the composed
hostname, and the width rule is rewritten rather than carved out.
