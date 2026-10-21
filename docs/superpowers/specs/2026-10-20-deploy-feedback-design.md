# A Deploy request stays on the page

Date: 2026-10-20 · Source: critique re-run P2 "Post-mutation feedback ephemeral" (`.impeccable/critique/2026-10-20T22-33-23Z__src-views.md`). Routed through `/impeccable harden`.

## Problem

Clicking Deploy, on the services board or in a site's repository card, gives three kinds of feedback. All of them go wrong:

- **A toast that vanishes.** The only confirmation is a success toast that auto-dismisses after about 4s (`public/app.js`, the `[data-deploy]` handler).
- **A stale row.** The row keeps `0.3.0 available` with a disabled Deploy button.
- **A reload that offers the same Deploy again.** The board and the card read "requested" from the reconciler's inventory (`target`), which changes only when the reconciler next runs, usually one to two minutes later. Until then a reload offers Deploy again for the tag just requested, which invites a duplicate request.

The app knows the truth sooner. Deploy commits the tag into the resource's declaration in the local `lychee-resources` clone before it answers. `readDeclarations()` returns that declaration's `image`, tag included, and both pages already read the clone on every GET.

## Goal

After Deploy succeeds, the row and the card say which tag was requested and that it applies on the next run. That holds on the live page and after a reload, until the reconciler's inventory takes over.

## Decisions

### 1. Pending tag, from the declaration

Two pure helpers, in `src/lib/siteResource.ts`:

```ts
export function declaredTag(decl: DeclarationSummary | undefined): string | null
export function pendingTag(entry: { version?: string; target?: string }, declared: string | null): string | null
```

**`declaredTag`** returns `null` in any of these cases:

- `decl` is undefined;
- `decl.state` is `"absent"`;
- the image's last path segment (after the last `/`) has no `:`;
- the image is pinned by digest (contains `@`).

Otherwise it returns the text after the last `:` of that last segment. A registry port (`host:5000/x`) sits in an earlier segment, so it is never mistaken for a tag.

**`pendingTag`** returns `declared` only when it is non-null and differs from both `entry.target` and `entry.version`. Otherwise it returns `null`.

### 2. The requested line

One renderer in `src/views/html.ts`:

```ts
function renderRequestedLine(tag: string): string
```

- **Markup:** a `<p data-requested role="status" tabindex="-1">` in the offer line's position and flex classes.
- **Content:** the tag, then `requested` in mono Chalk (`font-mono text-[0.8rem] text-stone-50`), then ` · applies on the next run` in Smoke (`text-stone-400`). Exact text: `<tag> requested · applies on the next run`.
- **No button.**

It replaces the offer line wherever an offer would render **and** the pending tag equals the offered tag:

- on board rows (`renderServiceRow`);
- in the site card's first-deploy step 4 (`firstDeploy`);
- in the installed card (`renderRepositoryCard`).

When a tag is pending but no offer would render (for example, the offer is already suppressed because it's applying), nothing extra renders. The pill and every other line (facts, deploy line, gate, failure line) are unchanged.

### 3. Getting the pending tag to the views

**Board** (`src/routes/services.ts` GET):

- Build `requested: Map<string, string>` from the declarations it already reads. Map each board row's name to `pendingTag(row, declaredTag(declarationFor(row.name)))`, keeping only non-null values.
- Pass the map to `renderServicesPage` as a new trailing parameter, `requested: ReadonlyMap<string, string> = new Map()`, and on to `renderServiceRow`.
- An unreadable clone gives an empty map, which is today's behaviour.

**Site page** (`src/routes/sites.ts`):

- The site's resource view gains an optional `requestedTag?: string`, computed with the same helpers from the declaration and inventory entry that `resolveNextjsSite` already has.
- `firstDeploy` and `renderRepositoryCard` read it from `opts.resource`.

### 4. In-place swap on success

- Every page that renders at least one offer line also renders, once, `<template data-requested-template>${renderRequestedLine("TAG")}</template>`.
- In `public/app.js`'s `[data-deploy]` handler, on `response.ok && body.ok`:
  1. Clone the template's content.
  2. Set the tag text: replace the literal `TAG` in the cloned line's first span with `button.dataset.deployTag`.
  3. Replace the button's closest `[data-offer]` with the clone.
  4. Hide the banner (the line is now the feedback).
  5. Move focus to the new line.
- If the template is missing, fall back to today's success toast and keep the button disabled.
- Errors are unchanged: toast, and the button is re-enabled.
- Update the handler's comment to describe the swap.

## Documentation

- **DESIGN.md:** the offer line entry (and the services-board row paragraph if it describes the after-Deploy state) gains the requested line: same position, no control, mono tag and `requested` in Chalk, the rest in Smoke, swapped in place on success and rendered by the server until the reconciler catches up.
- **Sidecar:** the matching component descriptions in `.impeccable/design.json`. If edited DESIGN.md text sits inside a named rule, re-derive `narrative.rules` and verify zero drift.
- **CLAUDE.md:** the services-board and repository-card sentences that describe what follows a Deploy ("Step 4 states, rather than offers, a tag that is already requested…" and the board's offer description). Edit only what this change makes false.

## Testing

**`src/lib/siteResource.test.ts`:**

- `declaredTag` returns:
  - `0.3.0` for `ghcr.io/lycheehome/app:0.3.0`;
  - `null` for `ghcr.io/lycheehome/app`;
  - `null` for `ghcr.io/lycheehome/app@sha256:abc`;
  - `null` for `host:5000/app` (port only, no tag);
  - `1.2.0` for `host:5000/app:1.2.0`;
  - `null` for a `state: "absent"` declaration;
  - `null` for `undefined`.
- `pendingTag`:
  - `null` when `declared === target`;
  - `null` when `declared === version`;
  - `null` when `declared` is null;
  - the tag when it's ahead of both.

**`src/views/html.test.ts`:**

- A board row with `requested` mapping its name to its `available` tag renders `data-requested` with the exact text and no `data-deploy` button. Without the map entry, the offer is unchanged.
- A row whose pending tag differs from `available` keeps its offer.
- Site card:
  - Awaiting image with a pending tag: step 4 shows the requested line, not the offer.
  - Installed with a pending newer tag: the requested line replaces the offer.
- A page with an offer contains exactly one `data-requested-template`. A page with no offer contains none.

**Route tests:** a services-board GET whose clone declares a tag ahead of the inventory renders the requested line, and an unreadable clone renders the offer as today. Use the existing route-test helpers in `src/dev/testHelpers.ts`.

**Playwright against `npm run dev:mock`:**

1. Click `app.lychee.land`'s Deploy 0.3.0.
2. Check: the offer is replaced by `0.3.0 requested · applies on the next run`, focus is on it, and no toast is showing.
3. Reload.
4. Check: the line is still there. The mock's Deploy writes the declaration, and the mock inventory is unchanged.

Run `npm run typecheck`, `lint`, `test` and `build`, then run the detector by hand on `src/views`.

## Out of scope

- Polling the inventory to flip the line to `applying` live.
- Any change to Attach, Prune or Change repository feedback.
- The reconciler's own timing.
