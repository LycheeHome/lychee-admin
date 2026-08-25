---
target: src/views/html.ts — list, add, detail, not-found
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-24T22-36-04Z
slug: src-views-html-ts
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)

# Critique: src/views/html.ts — list, add, detail, not-found

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Add has zero pending feedback; remove dialog's four promised steps invisible during execution; status pills carry no "as of" and never refresh. |
| 2 | Match System / Real World | 3 | Vocabulary is the operator's own, except the Danger card's "restarts the tunnel" where PRODUCT.md requires *the sites tunnel*. |
| 3 | User Control and Freedom | 2 | Escape/Cancel/outside-click and bfcache handled well, but no confirmation on the add flow — which restarts a live service — and remove dialog defaults focus to the destructive opt-in. |
| 4 | Consistency and Standards | 2 | Two key/value conventions; two form-label species; hostname validates server-side while port validates live; third container width on not-found; delete-files checkbox is the only unstyled control. |
| 5 | Error Prevention | 3 | Live named port conflicts and split delete requests excellent; the *.lyly.dev constraint is invisible until failure. |
| 6 | Recognition Rather Than Recall | 2 | .lyly.dev recalled; four remove steps recalled during execution; lateral navigation hidden behind an 11.5px chevron. |
| 7 | Flexibility and Efficiency | 3 | Whole-card link, arrow-key traversal, copy with real HTTP fallback. No status refresh short of full reload. |
| 8 | Aesthetic and Minimalist Design | 3 | Warm Terminal executed with restraint; banner prose set in mono, type-option text at 102ch vs DESIGN.md's ~70ch (8 detector line-length hits agree). |
| 9 | Error Recovery | 2 | Port error is a model; "removed, but failed to delete its files" branch surfaces a raw error with no path, no retry, no statement of host state. |
| 10 | Help and Documentation | 3 | Manual steps is superb in-context documentation of what the app won't do. Nothing documents what the add flow will do. |
| **Total** | | **25/40** | **Acceptable — significant improvements needed** |

Cognitive load: 3 of 8 failed (grouping, visual hierarchy, working memory), 2 borderline (single focus, progressive disclosure).

## Design Specificity Verdict

**Authored for this product — top decile.** Could not be lifted into another product without gutting it. The four-hop routing chain (html.ts:192-259) encodes this host's topology, hop 1 permanently reading `manual step`. The port validator knows this box by name (2019 → "reserved (Caddy admin API)", 8787 → "reserved (lyly-admin itself)"). splitHostnameForDisplay dims the shared .lyly.dev suffix. Poetsen One against DM Mono keeps mono density from tipping into terminal cosplay.

Two surfaces fall out of that standard: the add-site form (html.ts:100-165) is generic admin CRUD, and the not-found page (html.ts:604-616) is anonymous.

**Deterministic scan.** `detect.mjs src/views` → clean, exit 0. Verified a real clean, not a skipped scan: `--no-config` surfaces 5 findings, so the engine parses these .ts files. The three gray-on-color waivers in .impeccable/config.json suppress exactly 5 findings, each measured in-browser at 6.11:1–16.4:1 — rationale holds.

`src public` returns 6 findings, all in public/style.css, none in src/. That file is NOT stale — a fresh Tailwind build reproduces it byte-for-byte at 38049 bytes. Mechanism is Tailwind v4 auto-detecting sources project-wide, compiling class strings out of docs/superpowers/plans/*.md: `border-l-[3px]` from two planning docs, `1.35rem` from 2026-08-21-sidebar-navigation.md:521. Live code uses text-[1.7rem], on the ramp. `border-radius: 1px` is a regex artifact from calc(infinity * 1px); three #000 are Tailwind's sRGB fallback inside color-mix() for shadow-black/40 and backdrop:bg-black/60. All six artifacts — but scoping Tailwind to src+public drops the bundle to 29589 bytes: ~8.5KB / 22% of shipped CSS exists solely to serve class strings inside markdown docs.

**Browser overlay.** Injection succeeded (no CSP); live server ran on port 8400, since stopped — no overlay currently visible. 65 findings across 5 pages at 1440px, 28 false positives. The 13 text-occlusion and 10 undersized-ui-text hits all sit on rows inside the CLOSED <details id="hostname-switcher">; elementFromPoint() at each row's center returns content underneath, tabbable is false closed / true open.

The 27 real undersized-ui-text hits are all documented DESIGN.md steps — Label 10px, Micro-label 9.6px, Pill 10.4px — all below the detector's 11px floor. Not drift; the committed ramp colliding with an accessibility floor.

## Overall Impression

The reading half of this product is excellent and the mutating half is half-finished — the inversion of what PRODUCT.md wants, since it weights both jobs equally. The remove dialog states four steps in execution order and says a failure stops the rest; it is the best-designed thing in the app. Then you confirm and it goes dark. Meanwhile the add flow — which backs up two configs, edits both, validates, reloads Caddy, restarts a live tunnel — asks for no confirmation and gives no feedback.

Biggest opportunity: the app already solved mutation transparency once, in the remove dialog, and doesn't reuse it.

## What's Working

**Routing hop chain is a designed component, not a diagram.** Hops 1–3 carry only derived values with no invented health; hop 1's sub-line is permanently `manual step`; the `docker compose logs` remediation renders inside that card beneath the chain (html.ts:243-248) rather than as a numbered step appearing and disappearing with container state.

**Live host-aware port validation.** portOwners (html.ts:157, app.js:121-134) fires per keystroke, naming both the conflicting site and the reason a port is reserved.

**The ?created=1 copy set** (html.ts:544-555). Three sentences for three site kinds, each leading with what succeeded before explaining the pill the reader is about to misread.

**Structurally sound:** clean h1→h2→h3 with no skips on all five pages, zero empty accessible names, no horizontal overflow at 1440px or 1280px, project focus indicator on every interactive element but one. Pills 8.19–11.45:1, primary CTA 6.11:1, danger button 7.9:1 in-modal.

## Priority Issues

### [P0] The destructive dialog opens with focus on the irreversible opt-in
Both assessments hit this independently. showModal() leaves document.activeElement === #confirm-remove-delete-files. Three defects converge: it takes focus on open; accent-color is auto so it renders browser-blue (only unstyled control in the app, a second accent hue against a stated Don't); focus ring measured auto 1px rgb(153,200,255), the UA default, against "There is no second focus treatment anywhere in the system." The <dialog> has no role, aria-label, or aria-labelledby, and its visible <h2>Remove site</h2> has no id.

Why: a keyboard user pressing Space on open arms an rm -rf on a root-owned directory. A screen reader's entire spoken opening is "dialog. Also delete files at /var/www/app.lyly.dev, checkbox, not checked" — "Remove", the hostname, and the four steps never announced.

Fix: autofocus on Cancel (html.ts:592); aria-labelledby pointing at an id'd <h2>; accent-rose-400 plus shared FOCUS_RING on the checkbox; rename confirm to "Remove app.lyly.dev" (app.lyly.dev and api.lyly.dev are one character apart; trigger and confirm currently read identically).
Suggested command: /impeccable harden

### [P1] The add flow mutates a live host and states no mechanism
Backs up two configs, appends a Caddyfile block, creates a directory, appends a tunnel ingress rule, runs caddy validate, reloads Caddy, restarts cloudflared-sites — no preview, no confirmation, no pending feedback (app.js:151-157). Button stays fully Ember and enabled-looking; a second click is swallowed by addSiteInFlight with zero visual response.

Why: violates PRODUCT.md Principle 2. The destructive flow is transparent to a fault; the constructive one that restarts a live tunnel is a black box.

Fix: put the same ordered step list under the submit button (five short mono lines, 400px of empty page beneath the form). Show the in-flight banner the remove flow has. Affix a fixed .lyly.dev suffix to the hostname input — html.ts:121 has no pattern, no title, no aria-describedby, only a placeholder.
Suggested command: /impeccable harden

### [P1] The removal executes as an opaque ellipsis, then discards its own reminder
"Removing app.lyly.dev…" is static and motionless for the length of a service restart, and bg-rose-950/60 means workflow_dispatch: {} is readable THROUGH the message announcing an irreversible operation (shell.ts:67). Then app.js:48 fires the terminal DNS reminder as kind "success", auto-dismissing in 4s (app.js:29) — violating DESIGN.md's rule that a banner carrying an unfinished manual action is persistent, never timed.

Why: the dialog taught a four-step fail-closed model; execution shows none of it. The reflex when nothing moves for eight seconds is to reload, mid-mutation. Peak-end: the flow is remembered by an unfinished manual action on a 4-second timer.

Fix: reminder to "persistent". Drop the /60 for opacity. Name the step even optimistically ("Removing app.lyly.dev — restarting cloudflared-sites…"), or keep the dialog open and check the four steps off.
Suggested command: /impeccable harden

### [P2] The documented small-text ramp collides with accessibility floors
Card Label measured 10px/500/oklch(.709)/uppercase/0.1em; hop Micro-label 9.6px/500/oklch(.709)/uppercase/0.09em — 0.4px apart with every other variable held constant, so "REQUEST PATH" and "CLOUDFLARE DNS" are two claimed tiers rendering as one, 26px apart in the signature component. Independently, 27 real undersized-ui-text hits cover that whole ramp. Four AA contrast failures the detector never caught, two of them real text:

| ratio | need | size | element |
|---|---|---|---|
| 3.98:1 | 4.5 | 12px | radio-card description + <code> on bg-stone-700, /sites/new |
| 3.98:1 | 4.5 | 10.4px | :3000 port hint on the CURRENT (highlighted) switcher row |
| 2.29:1 | 4.5 | 11.5px | / breadcrumb separator (decorative) |
| 1.99:1 | 4.5 | 14px | → hop arrows, 3× per detail page (decorative, DESIGN.md-prescribed) |

Fix: DESIGN.md-level decision, not a patch — the ramp is committed, so changing it means re-running /impeccable document afterward. Cheapest hierarchy fix: card Label to text-stone-300, hop row stays Smoke. The two real contrast failures need a lighter foreground regardless.
Suggested command: /impeccable typeset

### [P2] "restarts the tunnel" on the Danger card
html.ts:399 reads "…reloads Caddy, then restarts the tunnel." The dialog two clicks later says "cloudflared-sites restarted". PRODUCT.md lists "the sites tunnel (cloudflared-sites) as distinct from the SSH tunnel this app must never touch" as terminology that must stay stable.

Why: ambiguous phrasing on the most consequential surface, next to the destructive button, at the moment the operator decides whether to press it. "Restarts the tunnel" at 11pm invites "wait — will I lose SSH?"

Fix: one word. "restarts the sites tunnel."
Suggested command: /impeccable clarify

## Persona Red Flags

**Alex (impatient power user).** Adds a site and gets nothing back — no spinner, no disabled state, no banner; a second click produces zero response. Removes a site and stares at a motionless ellipsis over legible YAML for the length of a systemctl restart. Scanning for a broken site is a per-card corner check — no summary line, no ordering by state; at 5 sites it works, there is no design for 15. Two of five cards are unanswerable: static sites get no pill (html.ts:57-61), so lyly.dev and blog.lyly.dev render identically whether Caddy is serving them happily or serving an empty directory.

**Sam (screen reader, keyboard-only, 200% zoom).** 200% reflow is genuinely good — at 720px the detail page holds its four-hop row, the workflow scrolls in-block; below 640px the chain stacks with ↓. The remove dialog is the failure (P0). Copy buttons collapse into indistinguishability: two ship as "Copy command" (html.ts:322, used for both DNS and docker-compose), and after one use the reset at app.js:236 overwrites the specific label with generic "Copy to clipboard". The ● is not aria-hidden in any of its three sites (html.ts:60, :231, :524); the accessibility tree renders the link name as "api.lyly.dev proxy ● not responding localhost:4000". Port conflicts are silent: #port-error is display:none until filled, has no aria-live, and is an aria-describedby target — a hidden description isn't exposed and revealing it announces nothing.

**The 11pm operator (PRODUCT.md).** First 15 seconds are excellent: / → api.lyly.dev ● NOT RESPONDING → click → the chain names the failing hop. Then it stops. For a plain reverse-proxy site there's no next move — docker compose logs appears only for scaffolded sites in a bad container state. The most common failure, a bare next start that died, reaches the right hop and hands the operator "create a DNS record" and "remove site". The hop this app restarts is the hop it never checks: lyly-admin restarts cloudflared-sites on every add and remove, so the failure most likely caused by using this app an hour ago renders as four healthy-looking hops. Manual step 1 is permanent noise — "Create the DNS record, once per hostname" renders forever on every site, un-acknowledgeable.

## Minor Observations

- LOCALHOST: is half a machine value dressed as a structural label (html.ts:76-77); path: is a genuine key, localhost:4000 is one literal split down the middle, uppercasing a machine fact against the Uppercase-Is-Structural Rule.
- DETAIL_KEY reserves 120px (html.ts:190) for a column whose longest occupant is ~84px — ~36px of forced void per detail row.
- The four-step dialog list is a 2×2 grid (html.ts:583); a grid is the layout for unordered peers, and this list's message is that these run in sequence.
- A human sentence inside the framework <select> (html.ts:154) renders in DM Mono because INPUT sets font-mono; put the explanation in a Nunito hint line as the field below does.
- The not-found page breaks container alignment — max-w-[640px] (html.ts:608) against a 1080px header band, inventing a third width.
- Empty state and its action are at opposite ends of the page (html.ts:93 far-left, Add site far-right). It's italic at weight 400 while only Nunito 500 italic is loaded (shell.ts:105), so the browser synthesizes.
- The switcher panel is bg-stone-900 (html.ts:500) — the page color, so a floating panel has zero tonal separation where it overhangs.
- Three names for one destination: nav "sites", <title> "Sites", heading "Existing sites".
- The two-request deletion collapses into one message — the banner still reads "Removing…" while rm -rf runs.
- No favicon; every page load 404s on /favicon.ico.
- Detector also flagged 8 real line-length violations, 1 tiny-text, 1 em-dash-overuse.

## Questions to Consider

1. Should hop 2 check itself? This app restarts cloudflared-sites on every mutation, making a dead sites tunnel the failure most likely caused by using this app — and the one hop the chain never verifies. systemctl is-active cloudflared-sites is already in the app's sudo scope.
2. What does the list page say about a static site? Two of five seeded sites can't be answered. Would a HEAD http://localhost/ with the Host: header set give static sites a real verdict without inventing anything?
3. Does the palette have a role it's missing? Ember means "act here", Scorch means "this destroys", Clear is reserved for status verdicts — so a success message has nowhere to live but the interaction hue.
4. Why is the mutating flow the one without a mechanism statement? Should the add flow reuse the remove dialog — same ordered list, same fail-closed sentence, same confirmation?
