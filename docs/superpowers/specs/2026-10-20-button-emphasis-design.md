# Button emphasis follows state

Date: 2026-10-20 · Source: critique re-run P1 (`.impeccable/critique/2026-10-20T22-33-23Z__src-views.md`) · Chosen from a rendered comparison: variant **01 Hand-off** (<https://claude.ai/artifact/XzcP6Ku2Bm6u3NbDCpVrAJ>)

## Problem

Ember means "do this next", and three places spend it on a control that does nothing useful or will be refused:

1. **Visit** (`renderDetailHeader`, `src/views/html.ts`) is `BUTTON_PRIMARY` on every site page, including failed, not responding, awaiting image and not deployed sites, where it opens an error page.
2. **Attach repository** (`attachForm`) stays Primary on a retired declaration while the warning beside it says Attach will be refused. Prune, the way out, is a compact secondary.
3. **Add site** stays Primary and submittable while the preview beside it shows a rejection.

On an unattached Next.js site and on a retired one, the page also carries **two** Primaries (Visit and Attach), against DESIGN.md's "used once per view for its one forward action".

## Goal

Every page carries at most one Ember action, and it is always one that will work in the current state. A page whose fix is on the host carries none.

## Decisions

### 1. Visit is Primary only while the site is serving

A pure helper, `visitIsForward(status: SiteStatus | undefined): boolean`, in `src/lib/siteDisplay.ts`:

- **true** when `status` is `undefined` (a static site, or a site with no status entry), and when `describeStatus(status).pill` is `running` or `responding`.
- **false** for everything else: `failed`, `awaiting image`, `not deployed`, `not responding`, `unhealthy`, `exited`, `restarting`, `paused`, **`starting`** and **`unknown`**.

`renderDetailHeader` renders Visit with `BUTTON_PRIMARY` when it returns true, and with `BUTTON_SECONDARY` otherwise. Visit is never removed or disabled: opening a broken site to see what Cloudflare serves stays one click.

Demoting Visit for `starting` and `unknown` is about emphasis only. Their pills and hop text keep the neutral tone, so The Three-Tone Status Rule is untouched: a secondary Visit doesn't claim the site is broken, only that the page can't vouch that it is serving.

### 2. The step the page can do next takes the Ember

- **Attach** stays `BUTTON_PRIMARY` when the declaration isn't retired. On an unattached site, Visit is secondary (status `not deployed`), so Attach is the page's one Primary.
- **First-deploy Deploy** (the runbook's step 4, nothing installed: both `renderOfferLine` calls in `firstDeploy`) renders with a new `BUTTON_PRIMARY_COMPACT`.
- **Installed-version Deploy** (the collapsed card's offer, in `renderRepositoryCard`) keeps `BUTTON_OFFER`. The site is either serving, so Visit leads, or broken in a way a newer tag may not fix; "What to check" covers that case.
- **Services board** offers keep `BUTTON_OFFER`. `renderOfferLine(name, tag, emphasis = "offer")` gains a third parameter, `"offer" | "primary"`, and stays the single renderer for both pages, so they still can't disagree about whether a tag is on offer.

### 3. Retired declaration: Prune leads, Attach steps back

In `attachForm` with `detached = true`:

- Attach renders with `BUTTON_SECONDARY` and stays **enabled**. The page's clone can be stale, so the writer's fresh pull still decides, and pressing Attach still checks again, as the warning says.
- Prune renders with `BUTTON_PRIMARY_COMPACT`. `renderPruneControl(name, emphasis = "secondary")` gains a parameter, `"secondary" | "primary"`; the site page passes `"primary"` and the services board keeps the default.
- Order is unchanged: the field and Attach, the writes line, the warning, then Prune.

Prune's behaviour is unchanged: no modal, and the route still refuses until the container is confirmed down.

### 4. Pages with no Ember

A host-side fault (a plain proxy not responding, or an installed container that is unhealthy, exited, restarting or paused with no runbook step to offer) leaves the page with no Primary. The same holds for an attached site whose first tag hasn't been found yet, and for `starting` and `unknown`. This is intended: the page has nothing to do that would help, and the "What to check" list (where there is one) says where to look.

### 5. Add site: blocked on an explicit rejection, still focusable

In `public/app.js`, around `refreshPreview` and the add-site submit handler:

- When the **newest** preview response (the existing `previewSequence` check) is a rejection (`result.error`), set `aria-disabled="true"` on `#add-site-submit` and add `preview-error` to its `aria-describedby`.
- When the newest response is `ready`, or is neither ready nor an error (the empty state), clear both.
- **A failed preview read never blocks.** On `!response.ok` or a thrown fetch, clear both as well. This keeps `app.js`'s existing rule that a failed preview must never block adding a site.
- **Any field change clears the block immediately.** Every listener that calls `schedulePreview` also clears it, so a quick fix-and-submit isn't held up by the 250ms debounce. The server validates the submit regardless.
- The submit handler checks `aria-disabled="true"` first. If it is set, it calls `preventDefault()`, sends nothing, and moves focus to `#preview-error`, which gains `tabindex="-1"`.
- The native `disabled` attribute keeps its current job (in-flight submits) and is never used for this.

Styling: `BUTTON_PRIMARY` gains `aria-disabled:` variants that mirror its existing `disabled:` look (`aria-disabled:cursor-not-allowed aria-disabled:text-stone-500 aria-disabled:bg-rose-400/40 aria-disabled:hover:bg-rose-400/40`). `BUTTON_PRIMARY_COMPACT` inherits them because it is derived.

### 6. `BUTTON_PRIMARY_COMPACT`

Added in `src/views/shared.ts` and derived from `BUTTON_PRIMARY` exactly as `BUTTON_SECONDARY_COMPACT` is from `BUTTON_SECONDARY`: `text-sm` becomes `text-[0.8rem]`, and `min-h-10 px-4 py-2.5` becomes `min-h-8 px-3 py-1.5`. Primary's colours, hover, focus and disabled states at the offer's 32px size. Used for the runbook's Deploy and the site page's Prune, which sit in 32px rows.

## Documentation

- **DESIGN.md**:
  - The **Primary** component entry gains the rule that the forward action is the one that will work in the current state; Visit qualifies only while the site is serving (running, responding, or static); a page whose fix is on the host has no Primary.
  - A new **Compact primary** entry, written like Compact secondary.
  - **The Ember Is Interactive Rule** gains one sentence: a control the page expects to be refused never wears Ember.
  - `.impeccable/design.json`'s `narrative.rules` bodies are re-derived from the prose (strip `**` and backticks; header to next header), and the sidecar's component snippets gain Compact primary.
  - Then `/impeccable document` runs as a scoped refresh.
- **CLAUDE.md**:
  - "It sits in this card rather than the page header so Visit stays the header's one ember action" becomes a sentence saying the offer lives in this card and is the page's Primary during the first deploy.
  - "The UI is a secondary **Prune old declaration** button" becomes one that says it is Primary on a site page's retired warning and secondary on the board.
- Code comments that say the same things are updated with them: `renderRepositoryCard` (keeps Visit as the header's one ember action), `renderPruneControl` (Secondary, not primary), and the `attachForm` doc comment.

## Testing

- `src/lib/siteDisplay.test.ts`: `visitIsForward` for `undefined` and for every status kind and state, including `running` with health `healthy`, `undefined`, `starting` and `unhealthy`.
- `src/views/html.test.ts`:
  - Visit's class for a running, a not-responding, an awaiting-image, a not-deployed, a starting and an unknown site, and for a static site.
  - On a retired declaration, Attach is secondary and still not `disabled`, and Prune is compact primary.
  - On a non-retired unattached site, Attach is Primary.
  - First-deploy Deploy is compact primary; installed-version Deploy is `BUTTON_OFFER`.
  - Services-board offers and Prune keep `BUTTON_OFFER` and `BUTTON_SECONDARY_COMPACT`.
  - Primary-count guard: render the detail page for each state above (plus a retired declaration) and count `<a>` and `<button>` elements whose class list contains the exact token `bg-rose-400` (variant tokens such as `disabled:bg-rose-400/40` don't count). Assert at most one.
  - `#preview-error` carries `tabindex="-1"`.
- `app.js` has no harness. A Playwright check against `npm run dev:mock`:
  - Type `api`: the submit gets `aria-disabled="true"`.
  - Click it: no POST is sent, and focus lands on `#preview-error`.
  - Type `api2`: the block clears.
  - Submit: the site is created.
- `npm run typecheck`, `lint`, `test` and `build`, and the detector run by hand on `src/views`.

## Out of scope

- The Ember-tinted `X.Y.Z available` text (critique P3).
- The list page's Add site button, and the services board's emphasis.
- Anything about what "What to check" says.
