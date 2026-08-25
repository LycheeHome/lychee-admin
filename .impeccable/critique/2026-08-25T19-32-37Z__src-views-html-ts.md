---
target: src/views/html.ts — re-measure after the hardening sweep
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-08-25T19-32-37Z
slug: src-views-html-ts
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)

# Critique: src/views/html.ts — re-measure after the hardening sweep

Trend: 25/40 (2026-08-24) -> 34/40 (2026-08-25) -> 36/40. P0: 1 -> 0 -> 0. P1: 2 -> 1 -> 1.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 4 | Live step marks, aria-busy, disabled buttons, pulsing progress — verified firing in real time |
| 2 | Match System / Real World | 4 | Vocabulary is the operator's own; the four-hop chain names cloudflared-sites, not a generic gateway |
| 3 | User Control and Freedom | 3 | Cancel/Escape work everywhere except mid-delete, correctly; no undo for a completed removal, inherent to the domain |
| 4 | Consistency and Standards | 4 | One status vocabulary, one focus ring, one danger style reused identically in both destructive contexts |
| 5 | Error Prevention | 3 | Live port-conflict and reserved-port validation excellent; healthcheck-path field has no format guard |
| 6 | Recognition Rather Than Recall | 4 | Every needed value shown in place — DNS command, conflicting-port owner, status word |
| 7 | Flexibility and Efficiency | 3 | The switcher's arrow-key path works but has no visual cue, so it is undiscoverable |
| 8 | Aesthetic and Minimalist Design | 4 | No chart, no gradient, one accent under 10% of pixels, nothing decorative |
| 9 | Error Recovery | 3 | Mechanism-based errors strong; plain reverse-proxy failures get no remediation hint |
| 10 | Help and Documentation | 4 | The in-context "on submit" / "in this order" lists ARE the documentation |
| **Total** | | **36/40** | **Good — upper end** |

Cognitive load: 1 failure (the 6-step add list). Score reported as Assessment A scored it, unanchored by detector output; B's contrast finding below would pressure heuristic 5.

## REGRESSION INTRODUCED BY THE PREVIOUS PASS

**The danger button, disabled while still hovered, measures 2.09:1** — `text-stone-500` on `bg-red-900`. Reachable in the most ordinary way: click Remove, the button disables, the mouse is still on it.

Mechanism: the hardening sweep added `disabled:text-stone-500` for a tonal disabled state. `hover:bg-red-900` was already present, and `disabled:pointer-events-none` was never set, so the hover background stays active under the dimmed text. Smoke Deep on Scorch Rule fails AA.

**The pre-existing wildcard waiver hid it.** The shared.ts `gray-on-color` waiver uses `value: "*"`, suppressing any hit of that rule in that file. Its reason names "both" pairs as high-contrast, but it now suppresses FOUR, including the two disabled pairings it was never written to cover. `detect.mjs src/views` reports clean, exit 0 — and that clean is not trustworthy for that file. A wildcard waiver written when a file had two findings keeps covering whatever the file grows into.

## Verified genuinely fixed

Measured with both known measurement traps explicitly avoided (`:focus-visible` does not match programmatic focus on anchors/buttons; `transition-colors` includes `outline-color` at 150ms):

- Every interactive element on all five pages rings 2px solid oklch(0.712 0.194 13.428) at 2px offset, reached by real Tab, settled past the fade.
- The hostname composite field's ring encloses input AND suffix (wrapper right:1100 vs input right:1016.8) — no seam.
- All four live regions reveal before writing, confirmed by MutationObserver ordering rather than polling: #port-error, #add-site-error, #flash-banner, #confirm-remove-outcome.
- Zero empty accessible names across 32-263 AX nodes per page. The bullet glyph appears in none — pills compute as "NOT RESPONDING" / "RUNNING". Radios compute as "Static site" / "Reverse proxy".
- Reduced motion: zero running animations or transitions on any page.
- Heading order sequential on all five pages; no horizontal overflow at 1440px or 1280px.

## Priority issues

### [P1] The remove dialog's Tab cycle drops focus to <body> once per lap
Verified twice with activeElement reads, dialog still open: Remove -> checkbox -> Cancel -> Remove -> BODY -> checkbox. Native <dialog> behaviour rather than app JS, but reachable on the app's one irreversible screen, and the impatient-power-user profile is exactly who hits it.
Fix: a keydown handler on #confirm-remove-dialog wrapping Tab from last focusable to first, and Shift+Tab in reverse.
Suggested command: /impeccable harden

### [P2] The disabled danger button fails AA in a reachable state (2.09:1)
See the regression section above. Fix: add `disabled:hover:bg-transparent` (or `disabled:pointer-events-none`) so the hover fill cannot survive under the dimmed text, and re-measure. Then narrow the shared.ts waiver from `value: "*"` to the two specific pairs its reason actually names, so this class of regression cannot be silenced again.
Suggested command: /impeccable harden

### [P2] The dialog's autofocused Cancel button shows no focus ring
Measured outlineStyle "none" immediately after showModal() — correct, since :focus-visible does not match programmatic autofocus. But a sighted keyboard user has no indication that an immediate Enter lands on Cancel, on the one screen where that is expensive.
Fix: give this dialog's initial focus a persistent, non-:focus-visible cue, or record the tradeoff deliberately in DESIGN.md rather than leaving it unconsidered.
Suggested command: /impeccable harden

### [P2] The add-site step list is six items
ADD_STEPS renders six flat steps when a framework is picked, breaking the <=4 chunking guideline. A direct consequence of the framework-scaffold feature growing a list that used to be four.
Fix: split into two labelled phases (prepare / activate) using the hairline pattern already used inside cards, without changing step copy or numbering.
Suggested command: /impeccable layout

### [P3] Site-card accessible name is one run-on string
"api.lyly.dev proxy not responding localhost:4000" — serviceable but not segmented for scanning by ear.
Suggested command: /impeccable clarify

### [P3] Plain reverse-proxy failures get no remediation hint
A container failure gets an inline `docker compose logs` block; a plain proxy's "not responding" gets nothing. The app cannot offer a command it does not own, but one static sentence naming the likely cause would close the gap without inventing automation.
Suggested command: /impeccable clarify

## Persona red flags

**Alex (power user).** Four clean Tab stops from load to the first card, and the hostname doubling-guard rewards the paste-a-full-hostname habit. Red flags: the switcher's arrow-key speed path has no visual cue, so Alex likely never finds it; and Alex tabbing fast through the remove dialog is the profile most likely to hit the P1 body-focus gap and fire Enter into nothing.

**Sam (screen reader, keyboard, 200% zoom).** 200% zoom verified clean on the detail page and the dialog — no horizontal scroll, no clipping. Focus rings verified Ember on genuine Tab. The switcher's full keyboard model (arrows, Escape-refocus-to-summary) is a green flag. Remaining risks: the P1 focus gap, and the run-on card name.

**The 11pm operator.** The permanent DNS reminder is exactly right for this person. Red flag scoped to dev only: in dev:mock a freshly scaffolded Next.js site's pill reads RUNNING/healthy while the banner above says it will read "not deployed", because the dev fake's checkContainerStatus is an unconditional stub. Production is correct; but this is the rehearsal moment most likely to be run before trusting the feature live.

## Minor observations

- All three waiver reasons in .impeccable/config.json are now wrong. html.ts claims four hits (there are two) and describes button-primary, which does not appear in that file at all. shared.ts says "both" for four hits. shell.ts cites 15.65:1 against a measured 16.25:1.
- 13 text-occlusion findings are false positives, proven rather than asserted: the closed #hostname-switcher rows keep full layout geometry, but elementFromPoint at their own centre returns the content behind them.
- The detector's em-dash-overuse count (8) does not match direct DOM measurement (2 in body text, 3 counting a summary aria-label). Cause not determined.
- <h1> is "lyly.admin" on every page, so heading-only navigation does not disambiguate pages by h1 alone; the per-page h2 and title do that work.
- The dev fake checkContainerStatus is worth defaulting to not-created so local rehearsal matches the banner copy.
- Healthcheck-path field accepts any string with no leading-slash guard.

## Questions to Consider

1. Should the shared.ts waiver be narrowed from `value: "*"` to the specific pairs its reason names? The wildcard just silenced a real regression in the same file it was written for.
2. Is defending against the native <dialog> Tab gap worth custom JS on a single-operator tool, or is that effort better spent on what PRODUCT.md says is still open (DNS-in-app, container control)?
3. The confirm button disables permanently after a partial failure, deliberately, to prevent an unsafe retry — but nothing says a reload is the next move. Does silence there relocate the "what now" moment rather than remove it?
4. Should the dev fakes' fidelity bar explicitly cover "state immediately after creation", since that is the moment both critiques and the product's own banner copy keep returning to?
