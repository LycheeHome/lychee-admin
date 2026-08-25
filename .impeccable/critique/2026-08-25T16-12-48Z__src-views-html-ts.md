---
target: src/views/html.ts — re-measure after remediation
total_score: 34
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
timestamp: 2026-08-25T16-12-48Z
slug: src-views-html-ts
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)

# Critique: src/views/html.ts — re-measure after remediation

Baseline: 25/40 (2026-08-24T22-36-04Z), 1 P0 / 2 P1.

## Design Health Score

| # | Heuristic | Was | Now | Key issue |
|---|---|---|---|---|
| 1 | Visibility of System Status | 2 | 3 | `not deployed` shares the alarming tone with crash states; post-removal notice never says whether requested file deletion succeeded |
| 2 | Match System / Real World | 3 | 4 | Hop chain, service names and paths are the real mechanism |
| 3 | User Control and Freedom | 2 | 3 | Escape/outside-click correctly blocked mid-mutation, but disabled buttons show no visual state |
| 4 | Consistency and Standards | 2 | 3 | Type radios fold a paragraph into their accessible name; three focus-ring outliers |
| 5 | Error Prevention | 3 | 4 | Live port-conflict and reserved-port validation; ordered destructive confirmation |
| 6 | Recognition Rather Than Recall | 2 | 4 | Domain-as-affix, port owners inline, tunnel ID in the copy-ready command |
| 7 | Flexibility and Efficiency | 3 | 3 | Hostname field has no autofocus on the most frequent create action |
| 8 | Aesthetic and Minimalist Design | 3 | 4 | The Warm Terminal holds up under real interaction |
| 9 | Error Recovery | 2 | 3 | hostStateMessage explains real host state; raw JS errors still reach the alert unfiltered |
| 10 | Help and Documentation | 3 | 3 | "On submit" and "Manual steps" act as contextual documentation |
| **Total** | | **25/40** | **34/40** | **Good — address weak areas, solid foundation** |

Cognitive load: 3 hard failures -> 0, with one disclosed tradeoff (the Show-It Rule preferring full height over progressive disclosure).

Score reported as Assessment A scored it, unanchored. B's three focus-ring findings would justify docking Consistency to 2 (33/40); adjusting after seeing detector output is the anchoring the two-assessment method prevents, so A's number stands with the tension recorded.

## Verified achievements of the remediation

Measured, not assumed:
- Dialog focus lands on Cancel; accessible name resolves to "Remove site"; Escape and outside-click blocked while in-flight, working again once settled. All four P0 defects closed.
- Both AA contrast fixes hold: type-option descriptions checked measure 6.90:1 and 11.51:1; switcher current-row port hint 6.90:1. All were 3.98:1.
- The hostname field's focus ring encloses the whole composed control and does not stop at the input/suffix seam.
- The bullet glyph is aria-hidden on every instance; stripping hidden nodes leaves the status word alone.
- motion-safe: genuinely compiles and works — dialog animation is `none` under emulated reduced motion.
- Detector clean, exit 0. Heading order clean on all 5 pages. No horizontal overflow at 1440px or 1280px. No empty accessible names.

## Priority issues

### [P1] `not deployed` shares the alarming Scorch tone with `exited` and `unhealthy`
DESIGN.md:278-280 places `not deployed` in the bad tone; src/lib/siteDisplay.ts:62-63 implements it. A freshly-created Next.js site therefore lands showing a red "not deployed" pill directly beneath a banner saying the add succeeded (html.ts:568-570). DESIGN.md's own Three-Tone Rule (DESIGN.md:296-300) already contains the counter-principle — "a container still running its first health check is not broken" — and a site that has never been deployed is at least as clearly not-broken as one that is starting. This is a DESIGN.md decision, not a code defect.
Suggested command: /impeccable clarify (with a DESIGN.md amendment)

### [P2] The one remaining write-before-unhide: #flash-banner
public/app.js:25-26 writes flashBannerMessage.textContent then removes `hidden` from the container — a mutation inside a still-display:none subtree. The same defect was fixed in #port-error, #add-site-error and #confirm-remove-outcome during this work, each with an explanatory comment. So the add flow's in-flight banner is likely never announced.
Suggested command: /impeccable harden

### [P2] Three focus-ring outliers against the "one focus treatment" rule
(a) The two type radios on /sites/new get the browser's native ring, outline: auto 1px rgb(153,200,255) — a second focus treatment, the exact defect Task 2 fixed on the delete-files checkbox. (b) The not-found page's back-link carries no FOCUS_RING at all. (c) The list's site-card links resolve outline-color to Chalk/currentColor rather than Ember despite carrying outline-rose-400 — likely a malformed class.
Suggested command: /impeccable harden

### [P2] Disabled dialog controls have no visual disabled state
BUTTON_SECONDARY and BUTTON_DANGER (shared.ts:13-16) have no `disabled:` styling, and setRemoveBusy only toggles the attribute. Mid-removal both buttons render pixel-identical to enabled. The screen-reader path is covered by aria-busy; the sighted path gets nothing at the moment an operator might second-guess whether their click on an irreversible action registered.
Suggested command: /impeccable harden

### [P2] The breadcrumb separator fails AA and is not decorative
Measured 2.29:1 (87,83,77 on 28,25,23) and carries no aria-hidden. The hop arrows measure a comparable 1.99:1 but ARE aria-hidden, so they are legitimately decoration; this one is not.
Suggested command: /impeccable harden

### [P3] Reduced-motion violation on the type-option cards
They carry plain `transition-colors`, not the `motion-safe:` variant the list-page site cards correctly use, so they still animate at 0.15s under prefers-reduced-motion: reduce.
Suggested command: /impeccable harden

### [P3] Requested file deletion is never confirmed on the page you land on
The post-removal notice is identical whether or not "Also delete files" was checked (src/routes/sites.ts:86-89). The in-dialog outcome that would have confirmed it is gone the moment you navigate. Of the two irreversible acts in that flow, file deletion is the less recoverable and the one with no lasting confirmation.
Suggested command: /impeccable harden

### [P3] Type-selector radios overload their accessible name
Wrapping title plus explanatory sentence in one label makes the radio's accessible name the whole paragraph (html.ts:138-152). Every other control has a short name. Move the description to aria-describedby.
Suggested command: /impeccable clarify

### [P3] Raw JS errors reach the user-facing alert unfiltered
public/app.js:379 writes error.message directly into #add-site-error with no fallback. Observed live: "Failed to execute 'fetch' on 'Window': Request cannot be constructed from a URL that includes credentials". Any unexpected TypeError will read as cryptically to an operator who is not a developer.
Suggested command: /impeccable harden

## Persona red flags

**Alex (power user).** No autofocus on the hostname field, the most frequent create action. Worst moment is the P1: creating a Next.js site and immediately seeing it flagged red will read as "did that just fail?".

**Sam (screen reader, keyboard, 200% zoom).** Escape on the switcher closes and refocuses the trigger. Dialog autofocus-to-Cancel produces a real focus ring. Remaining: the type radios' native blue ring and paragraph-length accessible name; the flash banner likely never announcing; a one-tick state tabbing the dialog where activeElement is body with no visible ring (a native <dialog> containment quirk in Chromium, not obviously app-fixable).

**The 11pm operator.** Best served by the request-path card's embedded `docker compose logs` beside the failing hop, and by hostStateMessage's exact statements of what happened on the host. Worst served by the P1 — a benign never-deployed scaffold reading identically-toned to a crashed container is exactly where the glance-test promise breaks.

## Minor observations

- The html.ts gray-on-color waiver's reason says "four hits"; --no-config shows 2. Contrast holds (16.40:1) but the count claim is stale.
- The shell.ts waiver claims 15.65:1; independently measured 16.25:1. Doesn't affect pass/fail.
- validatePortField clears the port error's visibility but never its textContent in the valid branch — stale DOM state, invisible today.
- checkContainerStatus in the dev fakes always returns running/healthy, so the P1 contradiction cannot be reproduced off-host. A mock-fidelity gap worth knowing.
- The generated GitHub Actions workflow assumes a self-hosted runner exists with no pointer to that assumption.

## Questions to Consider

1. Should `not deployed` share Scorch with `exited`/`unhealthy`, or does the Three-Tone Rule's own logic argue for a neutral treatment reserved for "never deployed", distinct from "was up and died"?
2. Given addedBanner already special-cases copy per site kind, should the success banner and the status pill render as one atomic statement for scaffolded sites rather than two independently-toned facts that can read as contradicting each other?
3. Is the unstyled disabled button a deliberate Flat-At-Rest choice or an oversight — and if deliberate, should the outcome region's text be the design system's sanctioned busy indicator by rule, so nobody later "fixes" it with disabled:opacity-50?
4. Now that file deletion is its own act, should its outcome get its own persistent notice the way the DNS reminder did?
