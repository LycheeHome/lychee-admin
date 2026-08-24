# Critique remediation: mutation transparency and the small-text ramp

Answers the five priority issues from the `/impeccable critique` of
`src/views/html.ts` recorded at
[`.impeccable/critique/2026-08-24T22-36-04Z__src-views-html-ts.md`](../../../.impeccable/critique/2026-08-24T22-36-04Z__src-views-html-ts.md),
which scored the page bodies **25/40** — "acceptable, significant
improvements needed". That snapshot is the backlog this spec drains; it
is also the baseline the same command re-measures against when this
work lands.

## Problem

The critique's finding was not that the app is generic. It rated design
specificity top-decile: the four-hop request path encodes this host's
topology, the port validator names `2019` as Caddy's admin API and
`8787` as lyly-admin itself, and `splitHostnameForDisplay` exists only
because every managed hostname shares a suffix. None of that is at
issue here.

The finding was an inversion. `PRODUCT.md` weights two jobs equally —
mutate and read — and **the reading half is excellent while the
mutating half is half-finished**:

- The remove dialog states four steps in execution order and says
  outright that a failed step stops the rest. Then you confirm, and it
  goes dark: a static, motionless ellipsis for the length of a
  `systemctl restart`, in a `bg-rose-950/60` banner through which
  `workflow_dispatch: {}` is legible on a scaffolded page.
- The add flow backs up two configs, edits both, validates, reloads
  Caddy, and restarts a live tunnel — with no confirmation, no pending
  feedback, and no statement of mechanism. `PRODUCT.md` Principle 2
  requires every mutating flow to name its steps in the order they run.
  Only the destructive one does.
- On failure, the flow that exists to prevent half-applied state
  reports one line of error text and never says what state the host is
  now in — even though the route already tracks it in `caddyReloaded`.

Two further findings are independent of that inversion:

- **The remove dialog opens with focus on the irreversible opt-in.**
  `showModal()` leaves `document.activeElement` on
  `#confirm-remove-delete-files`. Pressing Space on open arms an
  `rm -rf` of a root-owned directory. The dialog has no accessible
  name, so a screen reader's entire spoken opening is *"dialog. Also
  delete files at /var/www/app.lyly.dev, checkbox, not checked"* — the
  word "Remove", the hostname, and the four steps are never announced.
  The checkbox is also the only unstyled control in the app: browser
  blue, with a UA-default focus ring measured at
  `auto 1px rgb(153,200,255)` against DESIGN.md's *"There is no second
  focus treatment anywhere in the system."*
- **The documented small-text ramp sits entirely below an 11px
  accessibility floor.** `label` 0.625rem (10px), `micro-label` 0.6rem
  (9.6px), and `pill` 0.65rem (10.4px) are three tokens spanning 0.8px.
  Label and Micro-label render with every other variable held constant —
  same weight, same colour, both uppercase — so "REQUEST PATH" and
  "CLOUDFLARE DNS" are two claimed tiers reading as one, 26px apart in
  the app's signature component. The bundled detector reports 27 real
  `undersized-ui-text` hits across that band.

## Decisions taken

Four decisions were settled before design, and one of them corrected the
brief:

1. **The ramp restructures, it does not merely rise.** Raising all three
   tokens to a flat 11px floor would have made Label, Micro-label, and
   Pill *identical* — completing the hierarchy collapse rather than
   fixing it. Two steps instead: 11px and 12px.
2. **Progress is reported post-hoc, never optimistically.** A client-side
   step list advancing on a timer would violate Principle 2 by implying a
   later step ran when it did not. The route reports what actually ran.
3. **The add flow states its mechanism but gains no confirmation gate.**
   Remove needs a dialog because it is destructive and fires from a
   single button; add is non-destructive and already requires
   deliberately completing a validated form.
4. **Sequencing is P0 → design system → flows → copy.** The a11y fix
   lands first on severity. The ramp settles before the flow work so new
   markup is written against final tokens instead of retrofitted.

**Implementation order is not this document's section order.** The
sections below are grouped by theme so each reads as one idea; the
increments run in the order named in decision 4, which splits the
dialog's P0 accessibility fix out of "Mutation transparency" and lands
it first, before the ramp. The implementation plan sequences the work.

## Type ramp and contrast

`DESIGN.md` typography changes:

| token | now | after | why |
|---|---|---|---|
| `label` | 0.625rem (10px) | **0.75rem (12px)** | The app's most-used small size (9 call sites) — the token joins a de-facto step rather than inventing one |
| `micro-label` | 0.6rem (9.6px) | **0.6875rem (11px)** | Clears the floor |
| `pill` | 0.65rem (10.4px) | **0.6875rem (11px)** | Clears the floor, shares the step |

Three near-identical tokens become two distinct ones, and the sub-11px
band disappears.

`CARD_LABEL` also takes `text-stone-300`. An 11px-versus-12px gap is a
1px signal, barely stronger than the 0.4px gap being fixed; size plus a
colour step makes the distinction unambiguous, and Card Label is a
heading, so added prominence is directionally correct.

### The tokens are serving seven roles, not three

The three sizes have eight call sites between them, and they are not
eight instances of three roles. Applying the new sizes by value would
sweep four elements the ramp never named, so each site is assigned to
its correct token first:

| site | today | role | token after |
|---|---|---|---|
| `shared.ts:36` `CARD_LABEL` | 0.625rem | card label | `label` **0.75rem** |
| `html.ts:398` `<h3>Danger</h3>` | 0.625rem | card label | `label` **0.75rem** |
| `html.ts:288` step badge numeral | 0.625rem | numeral in a badge | `micro-label` **0.6875rem** |
| `html.ts:187` `HOP_LABEL` | 0.6rem | hop label | `micro-label` **0.6875rem** |
| `shared.ts:21` `STATUS_PILL_BASE` | 0.65rem | status pill | `pill` **0.6875rem** |
| `html.ts:196` hop sub-line | 0.65rem | small mono value | `code` **0.72rem** |
| `html.ts:324` `in <cwd>/` | 0.65rem | small mono value | `code` **0.72rem** |
| `html.ts:490` switcher type hint | 0.65rem | small mono value | `code` **0.72rem** |

Two results fall out of this. **No new token is needed**: the three
stray `pill` uses are all small muted mono *values*, which is exactly
what the existing `code` token already describes, and at 0.72rem
(11.52px) it clears the floor without changing. And `pill` ends up
meaning pills — today three of its four uses are not pills at all, so
re-documenting `DESIGN.md` without this step would enshrine the
mismatch.

Two call sites need more than a size swap:

- **`html.ts:398` duplicates `CARD_LABEL`'s exact class string** in red
  rather than using the constant. It folds into `CARD_LABEL` with a
  colour override, so the two card labels cannot drift apart again.
- **`html.ts:288` is a numeral centred in a fixed `1.2rem` (19.2px)
  circle.** Going from 10px to 11px changes the fit inside a
  fixed-diameter badge, so this one is checked visually rather than
  find-and-replaced.

**Two sizes in the code are absent from `DESIGN.md` entirely**:
`0.75rem` with 9 call sites and `0.7rem` with 3. Both clear the 11px
floor, so neither is a defect and neither is fixed here. They are noted
because `/impeccable document` will meet them when it re-derives the
system, and the honest outcome is that `DESIGN.md` records the ramp the
app actually uses rather than a subset of it.

Two measured AA failures are fixed as text — distinct from the
decorative hop arrows (1.99:1) and breadcrumb separator (2.29:1), which
stay exactly as `DESIGN.md` prescribes:

| ratio | need | size | element |
|---|---|---|---|
| 3.98:1 | 4.5 | 12px | radio-card description and its `<code>` on `bg-stone-700`, `/sites/new` |
| 3.98:1 | 4.5 | 10.4px → 11.52px | `:3000` port hint on the **current** switcher row (`html.ts:490`) |

The second element also changes size under the role assignment below.
The two changes are independent: size clears the detector's floor,
contrast clears AA, and neither fixes the other — at 11.52px this text
is still well under the 18.66px large-text threshold, so it needs 4.5:1
regardless.

**Open risk.** `0.6875rem` is exactly 11px, and whether the detector's
rule is `< 11` or `<= 11` is unverified. If it is the latter, the 27
hits do not clear and micro-label/pill must go to 0.75rem — collapsing
the ramp back to a single step and forcing the hierarchy entirely onto
colour. This is resolved by running `detect.mjs src/views` against the
change, not by guessing; if the ramp has to change shape, that is a
material deviation and stops for a decision.

## Mutation transparency

The delete route's real step boundaries (`src/routes/sites.ts:319-388`)
already map cleanly onto the dialog's four claims — Caddyfile write,
tunnel write, validate and reload, restart — so honest post-hoc
reporting needs no restructuring of the handler.

### The dialog

- `<h2 id="confirm-remove-title">` with `aria-labelledby` on the
  `<dialog>`, so it announces as "Remove site" rather than "dialog".
- `autofocus` on Cancel (`html.ts:592`), so focus cannot land on the
  destructive opt-in.
- The checkbox takes `accent-rose-400` and the shared `FOCUS_RING`,
  removing the app's only off-system control and its second focus
  treatment.
- The confirm button reads `Remove app.lyly.dev`, not `Remove site`.
  The seeded set contains `app.lyly.dev` and `api.lyly.dev`, one
  character apart, and today the trigger and the confirm are worded
  identically.

### The dialog stays open through execution

`app.js:57` currently closes the dialog before the fetch, which is why
progress has nowhere to live and the toast lands over the workflow
block. Instead the dialog remains open and its four-step `<ol>` becomes
the progress and result surface:

- **During** — a `motion-safe:` indicator, buttons disabled, the
  operation named.
- **On failure** — every step marked ran / failed / did-not-run, the
  error text, and an explicit host-state line: config restored, or left
  as-is because Caddy had already reloaded. The route tracks this in
  `caddyReloaded` and currently tells no one.
- **On success** — redirect, as today.

As a result surface the `<ol>` becomes a single ordered column. The
present 2×2 grid (`html.ts:583`) is the layout for unordered peers,
which contradicts the list's entire message.

### Response shape

Both mutating routes return `steps: [{ id, label, status }]` alongside
their existing payload; the delete route adds `rolledBack: boolean`.
The change is additive — no existing field changes — so `sites.test.ts`
keeps passing and gains cases.

### The DNS reminder

`app.js:48` fires the terminal reminder as kind `"success"`, which
`app.js:29` auto-dismisses after 4000ms and which renders without a
close button. `DESIGN.md` is explicit: *"A banner carrying a fact the
operator still has to act on — a DNS command, a scaffold path — is
`persistent`, never timed."* Peak-end makes this the last thing the
destructive flow is remembered by.

Rather than add a `persistent` kind to `showBanner`, the reminder moves
to a server-rendered `#page-notice` on the list page, exactly as
`?created=1` already works. `CLAUDE.md` states that element exists for
page-load notices that take layout space, and `?removed=` is one. This
removes the auto-dismiss structurally instead of patching a timer, and
the notice becomes dismissible rather than vanishing.

### The add flow

- A static, always-visible ordered step list under the submit button,
  which doubles as the failure result surface the same way the dialog's
  list does.
- The in-flight banner the flow currently lacks, and a disabled submit
  state so a second click has visible meaning. Today `addSiteInFlight`
  swallows it with no visual response at all.
- The `.lyly.dev` suffix becomes a fixed affix on the input: you type
  `blog`. Server-side validation is unchanged; the client submits the
  composed value. `html.ts:121` currently carries no `pattern`, no
  `title`, and no `aria-describedby` — only a placeholder — so the rule
  is discoverable today only by failing.

## Copy, terminology, and accessibility

- `html.ts:399` reads "restarts the tunnel"; it becomes "restarts the
  **sites** tunnel". `PRODUCT.md` lists *the sites tunnel
  (`cloudflared-sites`)* as distinct from the SSH tunnel this app must
  never touch, and the ambiguous phrasing sits beside the destructive
  button at the moment the operator decides whether to press it.
- `app.js:236` overwrites each copy button's specific label with a
  generic `"Copy to clipboard"` on reset. The original label is stashed
  and restored, and the two buttons that both ship as `"Copy command"`
  (`html.ts:322`) become `Copy DNS command` and
  `Copy docker compose command`.
- Nav, `<title>`, and heading align on **Sites**. Today one destination
  has three names: `sites`, "Sites", and "Existing sites".
- The `●` status dot takes `aria-hidden="true"` at `html.ts:60`, `:231`,
  and `:524`. The accessibility tree currently renders a link as
  `"api.lyly.dev proxy ● not responding localhost:4000"`, which several
  screen readers voice as "black circle".
- `#port-error` takes `aria-live="polite"` and stops being an
  `aria-describedby` target while `display:none`. A hidden description
  is not exposed and revealing it announces nothing, so the app's live
  port-conflict validation — one of its genuinely excellent features —
  is silent for a screen reader until submit.

## Out of scope

Deliberately not addressed here, to keep the spec to one afternoon's
work. All are Minor Observations in the snapshot, and
`/impeccable polish` sweeps them afterward: the not-found page's third
container width (`max-w-[640px]`, `html.ts:608`), the synthesized italic
on the empty state (weight 400 requested, only Nunito 500 italic
loaded), the 120px `DETAIL_KEY` column against an ~84px longest
occupant, the missing favicon, the mono sentence inside the framework
`<select>`, and the `bg-stone-900` switcher panel matching the page
ground.

Also out of scope, and larger than this spec: whether hop 2 should check
itself via `systemctl is-active cloudflared-sites` (already within the
app's sudo scope), and whether static sites should get a status verdict
from a `HEAD` request carrying the right `Host:` header. `PRODUCT.md`
already flags both as likely-later; they are features, not remediation.

## Verification

Per increment: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`.

Route tests assert the `steps` array on success and on each failure
branch, and that `rolledBack` reflects the `caddyReloaded` guard. View
tests anchor to the dialog element itself and prove `aria-labelledby`
resolves and `autofocus` sits on Cancel — document-wide regexes on this
page are vacuous, since almost any string appears somewhere in it.

After the ramp lands, `detect.mjs src/views` resolves the 11px-floor
risk above. After all increments, `/impeccable document` re-derives
`DESIGN.md` and `.impeccable/design.json` — mandatory per `CLAUDE.md`,
since a design system that describes tokens the code no longer uses is
worse than none. Finally `/impeccable critique src/views/html.ts`
re-measures against the 25/40 baseline.

## Not part of this spec

Tailwind v4 auto-detects sources across the whole project and compiles
class strings out of `docs/superpowers/plans/*.md` into the shipped
bundle: `border-l-[3px]` and `1.35rem` both reach `public/style.css`
from planning documents and appear nowhere in `src/`. Scoping to
`source(none)` plus `@source` directives for `src` and `public` drops
the bundle from 38049 to 29589 bytes, about 22%. Per `CLAUDE.md` that is
a mechanical config value change, so it is a direct edit verified by
`typecheck`/`build`/`lint` — no plan task.
