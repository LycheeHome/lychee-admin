---
target: "PR #9 sidebar rail + site switcher"
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-08-24T05-20-21Z
slug: src-views-shell-ts
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)

# Critique: PR #9 — sidebar rail + site switcher

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | The one surface present on every page lists all five sites and reports the state of none. Status still costs one navigation per site. |
| 2 | Match System / Real World | 3 | Host vocabulary is excellent; but one destination now has three names — rail "All sites", heading "Existing sites", breadcrumb "sites". |
| 3 | User Control and Freedom | 3 | Escape closes the switcher and restores focus; dialogs cancel; the 404 keeps the rail as an exit. |
| 4 | Consistency and Standards | 2 | Two floating surfaces disagree on center (822.5 vs 712.5px); rail-current reuses the `proxy` pill's exact treatment; a new off-scale 1.35rem heading; a fourth shadow value. |
| 5 | Error Prevention | 3 | Live port-conflict validation, split delete requests, container warning. A truncated trigger can send you into the wrong site. |
| 6 | Recognition Rather Than Recall | 2 | Trigger clips hostnames from 20 characters; no status in the switcher means remembering which site was broken. |
| 7 | Flexibility and Efficiency | 3 | The switcher is a real accelerator with working arrow-key traversal. No type-ahead, no shortcut to open it, dead weight on `/`. |
| 8 | Aesthetic and Minimalist Design | 2 | A permanent 220px slab plus 222–420px of void beside every detail page; two "Add site" controls on `/`. |
| 9 | Error Recovery | 3 | The 404 now carries the rail instead of being a dead end. The 500 path still renders an empty rail, reading "no sites" rather than "config unreadable". |
| 10 | Help and Documentation | 3 | Best-in-class in the form and cards. Nothing says what the switcher is for on `/`, where it looks like an unfilled field. |
| **Total** | | **26/40** | **Acceptable — significant improvements needed** |

Cognitive load: 4 of 8 failed — single focus, visual hierarchy, ≤4 options per decision, working memory.

## Design Specificity Verdict

A generic dashboard sidebar with two product-specific touches bolted on. The shape is the genre default — 220px left rail, entity switcher styled as a bordered select with a chevron, two-item flat nav with grid and plus glyphs, flex spacer, dim wordmark bottom-left. Swap "site" for "project" and it drops into any multi-tenant SaaS unaltered. DESIGN.md:206 names "the generic dark SaaS dashboard" a confirmed rejection, and this PR imports that genre's most recognizable component.

Product-specific credit is real but thin: the closed trigger shows the active hostname in DM Mono; rows carry STATIC or :port; the spec costs out status dots and rejects them for a real reason (N TCP connects plus a `docker compose ps` per page load). But the rail's rows duplicate what the list cards already show, on a page where all five cards are visible — and the spec's own primary justification is "there is nowhere to put a page that isn't a site": chrome designed for a roadmap rather than for either job PRODUCT.md names.

Deterministic scan (CLI): 4 findings, exit 2. Three are the known `gray-on-color` false positives, now unsuppressed because the PR moved BUTTON_PRIMARY/BUTTON_DANGER out of html.ts into shared.ts:12,16, plus shell.ts:137. One is real: `design-system-font-size` at html.ts:101, the 1.35rem "Add a site" heading — which Assessment A flagged independently from source. public/app.js: zero findings. Assessment B proved the design-system rules were live before trusting this, via two probes including one placed in src/views/ as a .ts file to take the identical engine path.

Browser detector (injected into the live page): 10 findings on /, 9 on /sites/new, 28 on /sites/app.lyly.dev. Dominant categories: `undersized-ui-text` (18 on the detail page at 10.4/10/9.6px) and `low-contrast` (9 hits, all 3.2:1 — #79716b on #292524). Those sizes are DESIGN.md's documented pill/label/micro-label steps, so the detector is arguing with the design system on purpose — but the contrast half is not arguable.

Visual overlays: no live overlay remains. Injection succeeded and the in-page detector ran on all three pages, but the live server was stopped and the tab closed as required.

## Overall Impression

The engineering judgment here is better than the design specificity. Moving add-site out of a 460px modal onto its own page is the best decision in the PR, and it deleted a class of stale-state bug rather than patching it. The keyboard layer on the `<details>` switcher beats most hand-rolled dropdowns.

But the rail spends the most valuable real estate in the app — the only surface present on every page — on five links to sites you can already see, and says nothing when `caddy validate` fails, when `cloudflared-sites` is restarting, or when a container is unhealthy.

The biggest opportunity is not in this PR's diff: PRODUCT.md names two jobs of equal weight and says neither may be buried behind the other, yet answering "is anything down" still costs one navigation per site. The spec's rejection of rail status dots is correctly costed; the conclusion that no surface gets status does not follow. Tone pills on the list-page cards would be one page, N checks, on exactly the page whose job is the five-second glance.

## What's Working

1. Add-site became a page, not a bigger modal (html.ts:86-161). The form is the only place the app explains what static-vs-proxy commits you to; at 760px both option rows keep their explanatory sentences at a readable measure. It also deleted refreshSitesGrid() and the live portOwners patch.
2. The post-add banner explains the pill it arrives beside (shell.ts:134-141). Leading with "routing is live" stops a success message and a `not deployed` pill from contradicting each other; moving it in-flow means it pushes the heading down instead of covering it.
3. The `<details>` disclosure's keyboard layer (app.js:246-288), verified live by both agents: Escape closes and refocuses the trigger, ArrowDown opens and lands on row 1, focusout closes on tab-past, click-outside uses containment. ~40 lines of vanilla JS, and it survives JS being off.

## Priority Issues

[P1] Smoke Deep fails WCAG AA everywhere it carries text — and the rail extends its reach.
Measured with full ancestor alpha compositing: switcher trigger placeholder 3.65:1, switcher row type badge 3.65:1, the lyly.admin wordmark 3.17:1 — all #79716b (stone-500), all below 18.66px so 4.5:1 applies. The in-page detector found 9 more of the same pair on the detail page. Systemic, not PR-specific: DESIGN.md:255 assigns Smoke Deep to hop labels, detail-row keys, the dimmed domain suffix, and command captions, calling it "the dimmest legible text." It is not legible at AA. The 9.6px hop labels are the worst case.
Fix: raise Smoke Deep toward stone-400 for text roles, keep stone-500 for borders/separators only, then re-document. Everything passes 3:1, so nothing is invisible — but AA it is not.
Suggested command: /impeccable audit

[P1] The switcher truncates hostnames — in the one control whose only job is picking a hostname.
`truncate` on the trigger (shell.ts:53-54) and every row (shell.ts:61). Measured: trigger clips from 20 characters, rows from ~28. The panel got a min-w-[16rem] mitigation reasoning about exactly this; the trigger, visible 100% of the time, did not. Violates The Show-It Rule (DESIGN.md:390) and the explicit "Don't … truncate" (DESIGN.md:622) on the app's primary identifier. Two sites named staging-dashboard-preview and staging-dashboard-prod render identically, and you can open the wrong site's page — a page with a Remove button on it.
Fix: drop `truncate` from both, reuse splitHostnameForDisplay so the subdomain renders in Chalk and the shared .lyly.dev in Smoke Deep. Buys 9 characters per row free and matches the detail headline.
Suggested command: /impeccable layout

[P2] Ember now means "where you already are," using the proxy pill's exact treatment.
aria-[current=page]:bg-rose-950/60 aria-[current=page]:text-rose-300 (shell.ts:25,39) is byte-for-byte the proxy type pill (shared.ts:26). The Ember Is Interactive Rule says ember marks what you can act on; on / the current item is ember and the actionable item is Smoke — inverted on the page where it matters most. A nav item now looks identical to a pill meaning "a process runs here."
Fix: current = Chalk on Hairline with a 2px Ember Edge left rule. Structural Ember is already licensed for this (DESIGN.md:236).
Suggested command: /impeccable polish

[P2] The sm breakpoint is now mis-calibrated by exactly the rail's width.
DESIGN.md:379 makes 640px the only breakpoint and "the floor that keeps a narrow window honest." Tailwind's sm: measures the viewport; the content box is now viewport − 220 − 48. At a 640px window the hop chain stays horizontal in a 372px container and breaks machine facts mid-token: app.ly / ly.dev, cloudflar / ed-sites, localhos / t:3000. The rail never collapses (zero sm:/media classes in shell.ts), and below 600px the flash banner overhangs into the rail and past the viewport edge, with the document overflowing 164px at 375px.
Fix: move the hop-chain and dialog-grid breakpoints to ~860px (640 + 220) or use container queries, and clamp the banner to the content column rather than the viewport.
Suggested command: /impeccable adapt

[P2] Two floating surfaces disagree about where the center is, during the remove flow.
Assessment B proved the banner's left-[calc(50%_+_110px)] is exact — banner center matches content-column center to 0.0px at 1440, 1024, 700, 600 and 375. Assessment A found the remove dialog uses m-auto and centers on the viewport instead (822.5 vs 712.5px). The banner is right; the dialog is wrong. You confirm a destructive action at one center and the "Removing…" toast appears 110px away, at the exact moment you are watching for confirmation. The 110 is half of w-[220px] with no shared token, so it breaks silently the first time the rail's width changes.
Fix: define the rail width once as a custom property, derive both offsets from it, center the dialog on the content column, and add a Coupled-Rail-Width note to DESIGN.md.
Suggested command: /impeccable layout

## Persona Red Flags

Alex (impatient power user): first Tab on / lands on a control whose entire content is already on screen as five cards — then still one page load per site to learn if anything is down. Trigger clips at 20 characters, so on a real host he cannot read which site he is on without opening the panel he came from. No shortcut opens the switcher; no Home/End/type-ahead (fine at 5 sites, slower than the grid at 12–15). Two "Add site" controls. At a 640px window the request-path card breaks hostnames mid-token.

Sam (screen reader + keyboard-only): the app's primary navigation sits outside every navigation landmark — the rail is `<aside>` → complementary, and only the two flat links are inside `<nav>`, so the switcher is in the complementary landmark. The trigger's accessible name is just the hostname (AX tree: role=DisclosureTriangle, name="app.lyly.dev") because aria-label="Switch site" sits on the `<details>` group, not the summary. No skip link, with three rail tab stops before content on every page (eight with the switcher open). On a detail page no flat nav item is current, so the only "you are here" in the rail is inside a collapsed disclosure. The 0-site trigger is a `<div aria-disabled="true">` with no role, so aria-disabled is ignored. Credit: the shared 2px Ember focus ring is on every rail control, and expanded is exposed correctly.

## Minor Observations

- Focus-ring inconsistency the design system claims does not exist: rail controls get the documented 2px Ember ring, but site cards in the main column fall back to the UA default auto 1px outline. DESIGN.md:487 says every button, link and control shares one ring. Pre-existing on main; more visible now.
- The switcher panel is bg-stone-900 floating over a bg-stone-800 rail — the floating layer is darker than what it floats over, so it reads as an inset well that only looks raised because of its shadow.
- Panel radius is 6px but it is a surface containing five rows; The Radius-Says-Size Rule says 10px contains.
- Row dividers use border-stone-800 (Hearth Lift) inside a Hearth panel — effectively invisible; DESIGN.md:249 assigns dividers to Hairline.
- STATIC is a literal uppercase string at 0.65rem with no uppercase class and zero tracking, against The Uppercase-Is-Structural Rule.
- gap-0.5 (2px) on the nav is below the documented spacing scale, which claims to be exhaustive.
- A fourth shadow value: shadow-black/50 on the panel, where the documented Overlay is /40.
- Empty-list copy is italic; italic appears nowhere in DESIGN.md's type system.
- The in-page detector also flagged flat-type-hierarchy on / (7 sizes at 1.5:1), 5 line-length hits at 107–112 characters on the detail page, and em-dash-overuse (8 in body text).
- PRODUCT.md:78 still says the sidebar and /sites/new are "planned and not yet built" — must be updated on merge.
- Limitations: the 0-site rail was read from source only, and neither agent exercised a real add or remove, to avoid mutating shared in-memory dev state. Browser-side design-system rules were inactive (dsConfigured: false) because live-server.mjs serves the raw detector with no config; that coverage rests entirely on the CLI scan, where it is proven live.

## Questions to Consider

1. With five destinations and a five-card grid one click from anywhere, what does a 220px permanent rail buy that a hostname dropdown on the existing breadcrumb would not — and would this have been built if the spec had not needed "somewhere to put future host-level pages"?
2. The rail is the only element present during every mutation. When caddy validate fails or cloudflared-sites is restarting, why does the app's most persistent real estate say nothing — and should its bottom slot hold the two services' state instead of a 0.8rem wordmark?
3. DESIGN.md names the generic dark SaaS dashboard a confirmed rejection, and this PR adds that genre's most recognizable component. Which is the real commitment — the rejection, or the convenience?

## DESIGN.md ↔ PR contradictions: 13, adjudicated

DESIGN.md should change for: the Navigation section that says no sidebar exists (it documents main); the wordmark's move to 0.8rem Smoke Deep (sound reasoning, but the display token at 1.5rem is now used nowhere); the panel's max-h-[70vh] (an off-viewport panel is unreachable — deserves a named exception like the one for one-line commands); admitting a dropdown as a true float in the shadow vocabulary; and where content sits relative to the rail. The PR should change for: truncation, ember-as-current, the /50 shadow, the 6px panel radius, the STATIC casing, gap-0.5, the Hearth-Lift divider, and the 1.35rem heading. Both for the breakpoint recalibration and the composition offsets. PRODUCT.md changes on merge.
