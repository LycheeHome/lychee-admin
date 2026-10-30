---
name: lychee-admin
description: A warm terminal for one operator — mono facts on stone, one ember accent.
colors:
  ember: "oklch(71.2% 0.194 13.428)"
  ember-light: "oklch(81% 0.117 11.638)"
  ember-edge: "oklch(45.5% 0.188 13.697)"
  ember-deep: "oklch(27.1% 0.105 12.094)"
  hearth: "oklch(21.6% 0.006 56.043)"
  hearth-lift: "oklch(26.8% 0.007 34.298)"
  hairline: "oklch(37.4% 0.01 67.558)"
  hairline-strong: "oklch(44.4% 0.011 73.639)"
  smoke-deep: "oklch(55.3% 0.013 58.071)"
  smoke: "oklch(70.9% 0.01 56.259)"
  smoke-light: "oklch(86.9% 0.005 56.366)"
  chalk: "oklch(98.5% 0.001 106.423)"
  clear: "oklch(87.1% 0.15 154.449)"
  clear-deep: "oklch(26.6% 0.065 152.934)"
  scorch: "oklch(80.8% 0.114 19.571)"
  scorch-edge: "oklch(70.4% 0.191 22.216)"
  scorch-border: "oklch(44.4% 0.177 26.899)"
  scorch-rule: "oklch(39.6% 0.141 25.723)"
  scorch-deep: "oklch(25.8% 0.092 26.042)"
typography:
  display:
    fontFamily: "Poetsen One, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    lineHeight: 1.2
    letterSpacing: "0.025em"
  headline:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "1.7rem"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.625
  eyebrow:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.85rem"
    fontWeight: 500
    letterSpacing: "0.08em"
  label:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.1em"
  micro-label:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    letterSpacing: "0.09em"
  body:
    fontFamily: "Nunito, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.375
  body-strong:
    fontFamily: "Nunito, ui-sans-serif, system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 600
    lineHeight: 1.375
  data:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1.5
  code:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.72rem"
    fontWeight: 400
  pill:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.6875rem"
    letterSpacing: "0.06em"
rounded:
  inline: "4px"
  control: "6px"
  surface: "10px"
  full: "9999px"
spacing:
  hair: "6px"
  xs: "8px"
  sm: "10px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  "2xl": "24px"
components:
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.hearth}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    minHeight: "40px"
  button-primary-hover:
    backgroundColor: "{colors.ember-light}"
    textColor: "{colors.hearth}"
  button-primary-compact:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.hearth}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    minHeight: "32px"
  button-primary-compact-hover:
    backgroundColor: "{colors.ember-light}"
    textColor: "{colors.hearth}"
  button-secondary:
    backgroundColor: "{colors.hairline-strong}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    minHeight: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
  button-secondary-compact:
    backgroundColor: "{colors.hairline-strong}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    minHeight: "32px"
  button-secondary-compact-hover:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.scorch}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    minHeight: "32px"
  button-danger-hover:
    backgroundColor: "{colors.scorch-rule}"
    textColor: "{colors.chalk}"
  button-offer:
    backgroundColor: "transparent"
    textColor: "{colors.ember-light}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
    minHeight: "32px"
  button-offer-hover:
    backgroundColor: "{colors.ember-deep}"
    textColor: "{colors.ember-light}"
  input:
    backgroundColor: "{colors.hearth}"
    textColor: "{colors.chalk}"
    typography: "{typography.data}"
    rounded: "{rounded.control}"
    padding: "8px 10px"
  card:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.surface}"
    padding: "20px"
  site-row:
    backgroundColor: "transparent"
    textColor: "{colors.chalk}"
    rounded: "{rounded.control}"
    padding: "16px 12px"
  site-row-hover:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
  empty-state:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.surface}"
    padding: "24px"
  dialog:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.surface}"
    padding: "24px"
  code-line:
    backgroundColor: "{colors.hearth}"
    textColor: "{colors.chalk}"
    typography: "{typography.code}"
    rounded: "{rounded.control}"
    padding: "10px 44px 10px 10px"
  pill-status-ok:
    backgroundColor: "{colors.clear-deep}"
    textColor: "{colors.clear}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  pill-status-bad:
    backgroundColor: "{colors.scorch-deep}"
    textColor: "{colors.scorch}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  pill-status-neutral:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.smoke-light}"
    typography: "{typography.pill}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  step-number:
    backgroundColor: "transparent"
    textColor: "{colors.ember}"
    rounded: "{rounded.full}"
    size: "1.2rem"
  step-number-done:
    backgroundColor: "transparent"
    textColor: "{colors.smoke-light}"
    rounded: "{rounded.full}"
    size: "1.2rem"
  input-affix:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.smoke-light}"
    rounded: "{rounded.md}"
    padding: "0 10px"
  rail-toggle:
    backgroundColor: "transparent"
    textColor: "{colors.smoke}"
    rounded: "{rounded.control}"
    size: "32px"
  rail-toggle-hover:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
  rail-strip-cell:
    backgroundColor: "transparent"
    textColor: "{colors.smoke}"
    rounded: "{rounded.control}"
    width: "40px"
    height: "36px"
  rail-strip-cell-hover:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
  rail-strip-cell-current:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
  rail-strip-tooltip:
    backgroundColor: "{colors.hearth-lift}"
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
  rail-peek:
    backgroundColor: "{colors.hearth}"
    textColor: "{colors.chalk}"
    width: "250px"
---

# Design System: lychee-admin

## Overview

**Creative North Star: "The Warm Terminal"**

A console you would choose to sit in. Nearly every fact on screen is set in DM
Mono — hostnames, ports, paths, commands, service names, status words, even the
section labels — because nearly every fact came from a machine and will be
pasted back into one. Nunito carries the sentences a person wrote, and the
rail's place words. The
ground is Hearth (`oklch(21.6% 0.006 56.043)`), a warm near-black with a trace
of brown in it, never `#000`: this is a room with a lamp in it, not a void.
Against that, exactly one chromatic voice — Ember — marks everything you can
act on.

The density is deliberate and generous at once. There is one operator, one
desktop viewport, and no competition for their attention, so nothing is folded,
capped, truncated, or hidden behind a disclosure widget; a generated workflow
file renders at its full height because it is a file you might read, not a blob
you might copy. But the page is not a wall either — cards are tonal steps, not
boxes with lines around them, and the vertical rhythm is loose enough that the
four sections of a site's page read as four separate answers to four separate
questions.

Components are tactile and confident: fuller padding than a dense admin panel
would use, visible state changes on hover and focus, and an accent that is not
shy about appearing on the things you press. Depth stays flat at rest and lifts
only in response to state. Two directions are confirmed rejections: the generic
dark SaaS dashboard (violet gradients, glassmorphism, KPI tiles and sparklines
for metrics this app does not have) and terminal cosplay (scanlines, ASCII
borders, green-on-black, faux boot logs). Mono type here is precision, not
costume.

**Key Characteristics:**

- Warm near-black ground; no pure black, no pure white — Chalk, not `#fff`.
- One accent, Ember, reserved for what is interactive.
- Mono for machine facts, sans for human sentences and the rail's place words.
- Flat tonal layering at rest; shadow only as a response to state or float.
- Uppercase letterspaced micro-labels as the structural device.
- Nothing folded, capped, or truncated — one operator, one wide viewport.
- Poetsen One as a signature, once, small: the wordmark.

## Colors

A warm dark palette: a single stone ramp doing all the structural work, one
rose accent for interaction, and two narrow status families that exist only to
carry a verdict.

### Primary

- **Ember** (`rose-400`): The only chromatic voice. Primary button fills, every
  focus ring in the app, the numerals beside manual steps, the checked
  type option's radio, and the "back to sites" link on the not-found page.
- **Ember Light** (`rose-300`): Ember's hover state on filled buttons, and the
  offer button's text.
- **Ember Edge** (`rose-800`): Structural Ember — the border of a success or
  info flash banner. It was also the 2px left rule on the current rail item
  until 2026-10-29, when that rule went: a coloured left stripe on the selected
  row is the stock sidebar's mark, and the Hairline ground already says which
  row is current. Never a form's: it sits a percent of lightness from Scorch
  Border, so beside an invalid field's ring the checked type option's border
  and the port branch's rule both read as a second error, and both left it on
  2026-10-27.
- **Ember Deep** (`rose-950`): The ground beneath Ember text — every non-error
  flash banner (at 60%) and the offer button's hover fill. Never a selection's
  ground: as the checked proxy option's wash it read as the error ground's
  neighbour, and it left that option on 2026-10-26.

### Neutral

- **Hearth** (`stone-900`): The page. Also every inset surface — text inputs,
  command blocks, the workflow block — so an input reads as a well cut into the
  card, not a raised object on it.
- **Hearth Lift** (`stone-800`): Cards, dialogs, and the copy button's rest
  state. One tonal step up from the page, and the only surface color.
- **Hairline** (`stone-700`): Borders on cards, dialogs, inputs and code blocks;
  the divider rule inside a card (`1px`); the fill of the neutral status pill;
  the hover fill of secondary buttons.
- **Hairline Strong** (`stone-600`): The secondary button's fill and the arrows
  between routing hops. It carries Chalk at 7.32:1 as a surface, having been
  unusable as a 1px line against Hearth (2.29:1) or Hearth Lift (1.99:1) — the
  same token reads completely differently depending on how much of it there is.
- **Smoke Deep** (`stone-500`): Structure, not prose. Arrows between routing
  hops, the breadcrumb's `/`, and the trailing `.lychee.land` of a hostname at
  Headline size. It measures 3.64:1 on Hearth and 3.16:1 on Hearth Lift, so it
  clears WCAG AA for large text and fails it for everything smaller — see The
  Dim-Text Rule.
- **Smoke** (`stone-400`): Secondary text. Every explanatory sentence, form
  label, and card eyebrow.
- **Smoke Light** (`stone-300`): Neutral status pill text — the `neutral` tone,
  carrying `starting`, `unknown`, `not deployed`, `awaiting image` and `retired` — and the accent color
  of the static radio control.
- **Chalk** (`stone-50`): Primary text and every value that matters. Warm white,
  never `#fff`.

### Tertiary

Status verdicts, and nothing else, with one deliberate exception: the
what-gets-written panel's added-lines text is Clear, because marking a diff
addition is not a site-state verdict — see the Three-Tone Status Rule.
Outside that one use, these two families never appear as decoration, as a
background for prose, or as an accent.

- **Clear** (`green-300`) on **Clear Deep** (`green-950` at 60%): the `ok` tone —
  `running`, `running · healthy`, `responding`.
- **Scorch** (`red-300`) on **Scorch Deep** (`red-950` at 60%): the `bad` tone —
  `unhealthy`, `exited`, `restarting · crash-looping`, `not responding`, and
  `failed` (a first deploy the reconciler attempted and could not complete) —
  plus the danger button's text and the Danger card's label. Every one of these
  is something that tried and failed; see the Three-Tone Status Rule for why
  `not deployed` and `awaiting image` are not among them.
- **Scorch Edge** (`red-400` at 70%): the border of an error banner or inline
  error, where Scorch itself would not read against Scorch Deep.
- **Scorch Border** (`red-800`) / **Scorch Rule** (`red-900`): the danger
  button's outline and its hover fill; the Danger card's border (at 60%) over a
  Scorch Deep wash (at 20%).

### Named Rules

**The Ember Is Interactive Rule.** Ember and its family mark what you can act
on — buttons, focus rings, the checked option, step numerals, a card's hover
edge. It never colors a heading, a body sentence, or a value you can only
read. On any given screen it covers well under 10% of the pixels, and that
rarity is what makes a primary button unmissable. A control the page expects
to be refused never wears it.

**The Three-Tone Status Rule.** Site state resolves to exactly three tones:
Clear, Scorch, or Smoke. `starting`, `unknown`, `not deployed`,
`awaiting image` and `retired` are **Smoke, never Scorch** — a container still running its
first health check is not broken, a status we failed to read is not evidence
that anything is down, a container that was never created (or was deliberately
taken down) has not crashed, a site attached to a repository whose first
image has not been deployed yet is between two steps, not failing, and a
declaration deliberately retired (`state: absent`, not yet pruned) was taken
down on purpose. Scorch is reserved for something that tried and failed, so that red
keeps meaning "this needs you now": a site that has simply never been deployed
must not look like one that died. Never invent a fourth tone, and never let a
tone marking site state appear without the canonical status word beside it —
that second clause is what makes the first safe, because the word carries
which state it is while the tone carries only how bad it is. The
what-gets-written panel's Clear-marked added lines are the one place Clear
appears without a status word, because marking a diff addition is not a
site-state verdict for this rule to govern. `not deployed`, `awaiting image`,
`retired` and `unknown` share Smoke and stay unambiguous, because the word is always
there to tell them apart. That is why `retired` exists at all: a site re-added
over a retired declaration once read `not deployed`, the same word as a site
never attached, so the shared tone hid a different state. A new state that
needs telling apart gets a new word, never a new tone.

**The Pill-Needs-an-Edge Rule.** A status pill aligns to an edge the eye can
follow down the page. A single-line row has a clean right edge, so the pill is
right-aligned there — the site list. A multi-line row does not: its content is
ragged, and a right-aligned pill floats against nothing. So a multi-line row
puts the pill first, in a fixed-width left column, where the pills' left edges
line up and state can be read down the page without reading a name — the
services board. Same component and the same vocabulary either way; only the
placement moves, and the row's shape decides it, never habit or symmetry with
the other page.

**The Dim-Text Rule.** Dim text is Smoke, not Smoke Deep. Smoke Deep carries
readable text in exactly one role — the `.lychee.land` suffix on a Headline,
which at 27px is WCAG large text and clears the 3:1 that applies there. At any
smaller size it fails the 4.5:1 that applies instead (3.16:1 on a card), so
every label, key, caption, and hop sub-line takes Smoke. When a new
dim role appears, the question is not "how dim can this be" but "does it clear
4.5:1 on both Hearth and Hearth Lift."

Two things are deliberately outside that test, because neither is text you
read to learn something. The breadcrumb's `/` is decorative punctuation between
two links, and is marked `aria-hidden` to say so. And a **disabled** control's
label takes Smoke Deep on purpose: WCAG 1.4.3 exempts text that is part of an
inactive user interface component, and dimness past the readable floor is
precisely the signal that the control is not yours to press right now. That
exemption is not a license to dim anything inconvenient — it applies only while
the control is genuinely disabled, and it is why a disabled control must never
keep a hover fill underneath it (measured at 2.09:1 the one time it did, which
is unreadable rather than merely dim).

**The Scorch-Is-Not-Ember Rule.** Danger uses the red family even though it
neighbors rose in hue, and the two never substitute for each other. Ember means
"act here." Scorch means "this destroys something." A destructive control is
outlined Scorch on transparent, never filled Ember.

## Typography

**Display Font:** Poetsen One (with `ui-sans-serif`, `system-ui`, sans-serif)
**Body Font:** Nunito (with `ui-sans-serif`, `system-ui`, "Segoe UI", Roboto)
**Label/Mono Font:** DM Mono (with `ui-monospace`, SFMono-Regular, Consolas)

**Character:** DM Mono is the working voice of the interface — narrow, even,
unemphatic, and correct about a hostname's every character. Nunito softens the
sentences around it without ever competing. Poetsen One is the signature: one
rounded, warm, slightly toy-like face used once, at a small size, where the app
says its own name.

### Hierarchy

- **Display** (Poetsen One, 1.5rem, tracking 0.025em): The wordmark only —
  `lychee`, followed by `admin` as a qualifier in DM Mono 0.85rem (the nav
  items' size), Smoke Light, 0.35em after it on the same baseline. `admin` is mono because
  `lychee-admin` is the service's name, a machine fact. There is no dot
  between the two parts: the first row of the site list was `lychee.land` in
  the same face when the wordmark was chosen, and a dotted wordmark directly
  above it read as another hostname. The link's accessible name is `lychee-admin`. (Until 2026-10-11 it
  was `lyly` + an Ember period + `admin`.)
- **Headline** (DM Mono, 1.7rem, line-height 1.2, tracking -0.01em): A site's
  hostname on the page that owns it — its detail page, and the add-site page
  while that hostname is being composed — with the shared `.lychee.land` suffix
  dropped to Smoke Deep so the subdomain reads first. Legible there because
  27px is large text, and nowhere else. Slight negative tracking because mono
  at display size otherwise sprawls. The subdomain is held as one unit (an
  inline block), so a narrow line breaks before the suffix, never at a hyphen
  inside the label; the headline is `overflow-wrap: anywhere`, so a label
  wider than the line still wraps inside itself.
- **Title** (DM Mono, 1rem, weight 500, line-height 1.625): A list row's
  hostname, in Chalk, with the shared `.<domain>` suffix dropped to Smoke beside
  it. It leads the row's address, also mono, by size, weight and tone: 1rem 500
  Chalk over 0.8rem 400 Smoke. The label is held as one unit (an inline block),
  so a narrow row breaks before the suffix, never inside the label, as the
  Headline does. (Until 2026-10-29 it was Poetsen One, the display face; a
  hostname is a machine fact, so it went mono like every other one.)
- **Eyebrow** (DM Mono, 0.85rem, weight 500, uppercase, tracking 0.08em, Smoke):
  Section and dialog headings — "Sites", "Add a site", "Remove site".
- **Label** (DM Mono, 0.75rem, weight 500, uppercase, tracking 0.1em, Smoke Light):
  Card headings inside the detail page — "Request path", "Manual steps",
  "Deploy", "Danger". An attached site's cards run Request path → From a
  repository → Manual steps → Danger, so the card with something to do sits
  directly under the chain; every other site keeps Manual steps second.
- **Micro-label** (DM Mono, 0.6875rem, weight 500, uppercase, tracking 0.09em,
  Smoke): The label above a routing hop. The smallest type in the system, so it
  gets the brightest of the dim tones, not the dimmest. 0.6875rem is exactly
  11px — the floor below which small UI text stops being reliably legible.
- **Body** (Nunito, 0.8rem, line-height 1.375, Smoke): Every explanatory
  sentence. Every Body sentence is capped at 25rem, about 70 characters at
  0.8rem; the card keeps the frame's width, and mono content beside the prose
  stays full width. The cap is in rem because a `ch` is the width of a zero,
  so `70ch` held about 95 Nunito letters. The one narrower measure is the
  empty state's pitch, which keeps its own 46ch (about 62 letters). Dialog
  paragraphs step up to 1rem with relaxed leading.
- **Body Strong** (Nunito, 0.9rem, weight 600, Chalk): The title line of a
  selectable option row, sitting above the Body sentence that explains what the
  choice commits you to. One step above Body on purpose — the title has to win
  against the explanation beneath it without becoming a heading.
- **Data** (DM Mono, 0.8rem, Chalk): Hop values, detail rows, a card's
  path/port line (0.85rem). Values break rather than truncate (`break-all` on
  paths and hostnames).
- **Code** (DM Mono, 0.72rem, Chalk on Hearth): Copyable commands and the
  generated workflow.
- **Pill** (DM Mono, 0.6875rem status / 0.7rem type, uppercase, tracking 0.06em):
  One word, or two.

### Named Rules

**The Mono-Carries-Facts Rule.** If a machine produced it or will consume it —
hostname, port, path, command, service name, status word, framework name — it is
DM Mono. If a person wrote it as a sentence, it is Nunito. The one other case
is a word naming a place in the app — the rail's `overview`, `activity`,
`sites`, `services`, `reconciler` and `infrastructure`, and the find
panel's group headings — which is Nunito too, since it is a word and not a fact (since 2026-10-29). No sentence
sets a path in Nunito: a fact inside a sentence is a mono
span in Chalk, within the sentence's Nunito. A line that pairs a status word
with a reason (`● deploy waiting · <reason>`, `● retiring · <reason>`) sets the
word in mono and the reason in Nunito.

**The Signature-Once Rule.** Poetsen One appears in exactly one place: the
wordmark. It is never a page heading, never above
1.5rem, never body copy, and never used for emphasis. The family also ships a
single weight — do not request 600 and let the browser synthesize it.

**The Uppercase-Is-Structural Rule.** Uppercase with letterspacing marks
structure, never emphasis inside prose. Tracking widens as size shrinks
(0.85rem/0.08em → 0.75rem/0.1em → 0.6875rem/0.09em) so the smallest labels stay
readable. Emphasis inside a sentence uses Chalk against Smoke, or `<strong>`,
not caps.

## Layout

One page frame, 1080px, and every page in it. The site list fills it with one
row per site, separated by a `1px` Hairline and stacked with no gap, so a wider
window widens the gap between a row's two halves rather than its content. A
site's detail page takes the same frame and stays one column; its sentences
hold the prose measure, and its cards, the request path, code and commands take
the width. Add-site takes the frame too and splits it — see The Frame-And-Column
Rule below.

A list row has two halves: the hostname and its mono address on the left, the
status pill alone on the right, right-aligned so the pills share an edge down the
page; the alignment is the entire reason the list is rows and not cards. A static
site has no status and so nothing on the right.

When Caddy, the sites tunnel or a reconciler unit is down, the list says so
above its rows, between the section heading and the first row: one line per
unit, consequence first in Chalk and plain sans (what the operator needs to
know), then `● name phrase` in Scorch and Data (the machine fact, and the only
red), then a Smoke Light link to the page that holds the unit's detail. A
Hairline rule sits beneath the block and the block is absent entirely when
nothing is down, so a healthy list is the list it always was. Per-site pills are
unchanged: they speak for a site, these lines for the host beneath all of them.

At 900px and wider the page is two columns: a 250px rail fixed to the left edge
at full viewport height, scrolling on its own behind a `1px` Hairline right rule,
and the content column beside it, where the 1080px frame centres in the
remaining width with 24px of horizontal padding and 24px
gaps between sections. Collapsed (see Navigation), the rail is a 56px icon
strip and the content column takes the 194px it gives back; the frame and its
padding do not change. Below 900px the rail gives way to a top bar (a `1px`
Hairline bottom rule, 16px side padding) and the content column takes the whole
viewport. Content width is therefore the viewport less the rail, which is why
`sm` (640px) still describes the content box only below 900px.
Inside a card, the rhythm is 20px padding (24px on dialogs and the empty state),
a 12px gap between a label and its content, and a `1px` Hairline rule
with 16px of air on both sides wherever one card holds two kinds of content —
the request path's hops and its detail rows, or the Deploy workflow and what the
image bakes in.

Two breakpoints. `sm` (640px) is the floor that keeps a narrow window honest:
below it the routing hop chain turns from a row of four hops separated by `→`
into a stacked column separated by `↓`, the remove dialog's four-step list
collapses from two columns to one. `lg` (1024px) exists only for the add-site page, whose
form and preview columns need 1128px to render side by side at full size and
stack below it. Neither is a mobile design — PRODUCT.md records this as a
desktop-only tool.

A third breakpoint, 900px, belongs to the shell alone: it is where the rail
appears and the top bar goes. It is a usable fallback for reaching the app from
a tailnet phone, not a mobile design.

Spacing steps in use: 6px, 8px, 10px, 12px, 14px, 16px, 20px, 24px. Nothing in
between, and nothing above 24px except the rail's two widths.

### Named Rules

**The Show-It Rule.** There is one operator and one wide viewport, so content is
never folded, capped, truncated with an ellipsis, or put inside an inner scroll
box. A generated workflow file renders at full height. One exception is
horizontal overflow on a one-line command, which must not wrap: `overflow-x:
auto` with `white-space: nowrap`. Long values wrap by breaking characters
(`break-all`), never by being cut. Hostnames are the exception: a Headline
holds its label whole and breaks before the domain, and a rail row shows the
label alone; either breaks inside a label only when that label alone is wider
than its line. Two surfaces scroll inside themselves because nothing else can reach
their content: the rail, once its sites outgrow the viewport, and the find
panel's result list, once it does. The activity tables — the
overview's and `/activity`'s — scroll sideways in their own box, and only below
the width their five columns need; at
the desktop width it never does, and the page itself never scrolls sideways. Two more are named. A finished host action's
log folds at rest; it is open while the action runs and open after a failure,
so the log that explains something is never behind a click. A finished runbook
step folds at rest too — one line, the check, its title, `done`, and a chevron,
the body one click away — but a step that is not done never folds, so setup in
progress is never behind a click.

**The Frame-And-Column Rule.** 1080px is the page frame — the shell's `<main>`,
and every page inside it, so every page starts at one left edge and moving
between them moves nothing. No width ever lengthens a line of prose past about
70 characters: every Body sentence carries the prose measure (25rem), a cap on
text rather than a second page width, so the frame can stay wide for commands,
code and the request path. A page with two kinds of content that belong side by
side splits the frame — on the add-site page the form column is 656px beside
the panel — rather than narrowing it. The site list fills the frame because its
rows need the width to align a reserved status column. Until 2026-10-27 a site's
detail page centred a 760px reading column inside the frame, and its left edge
jumped 160px at 1440px on every move from the list; there is no reading column
now. The system holds one page width and never a second.

## Elevation & Depth

Flat at rest. Depth is tonal, in exactly three steps: Hearth page → Hearth Lift
card → Hearth inset (input, command block), each separated by a `1px` Hairline
border rather than a shadow. An input reads as a well cut into the card; a card
reads as a panel resting on the page.

Shadow is licensed only as a response to state or true float. Today that means
one shadow — the flash banner, fixed at the top of the viewport, which is
genuinely above the page — and the dialog scrim, which is not a shadow at all
but a `black/60` backdrop. State-driven lift is permitted by the system: a
hovered or focused element may rise. Where the incumbent implementation does it
differently, it changes a background tone instead (a list row's ground goes
Hearth Lift on hover, bleeding 12px past the text to the content column's
edges), and that remains the lighter-touch option to reach for first.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px
  rgba(0,0,0,0.4)`): Elements fixed above the page — the flash banner, the find
  panel, the icon strip's tooltips and the peek. Nothing in normal document
  flow gets this.
- **Scrim** (`background: rgba(0,0,0,0.6)` on `::backdrop`): How a dialog
  separates from the page.

### Named Rules

**The Flat-At-Rest Rule.** A surface sitting in the document is flat: tone plus a
Hairline, no shadow. Shadow means one of two things — this element floats above
the page, or you are touching it right now. It never means "this card is
important."

**The Scrim-Owns-the-Modal Rule.** A dialog is separated by its backdrop and its
border, not by a heavy drop shadow. If a modal needs more separation, darken the
scrim.

## Shapes

A four-step radius scale, and the step says what kind of thing you are looking
at: **10px** for a surface that contains other things (card, dialog, empty
state, the Danger panel), **6px** for a control or a container of text you act
on (button, input, select, command block, copy button, inline error, a list
row's hover shape), **4px** for
inline code inside a sentence, and **fully round** for anything stating a single
word or numeral (status pills, the 1.2rem step numerals).

Borders are `1px` everywhere. The one deliberate exception is the add-site form's
conditional branch — the port, framework, and healthcheck fields sit behind a
`2px` Hairline Strong left rule with 12px of padding, which is the only place in
the system where a border carries meaning rather than edge definition. It is
neutral because its meaning is structure (these fields belong to the option
above), and an Ember Edge rule there read as Scorch beside an invalid field.

Icons are 24×24 stroked line icons at `1em`, `stroke-width: 2`, round caps and
joins, inheriting `currentColor` — plus, trash, clipboard, check, external
link, chevron down, layout grid, search, menu, and since 2026-10-29 the rail's
place icons (Lucide's `layout-dashboard` for overview, `activity`, `globe` for
sites, `box` for services, `refresh-cw` for reconciler, `server` for
infrastructure) and `panel-left-close` / `panel-left-open` for its collapse
button. A rail row draws its icon at 16px and a strip cell at 18px rather than
at `1em`. Status is marked by a `●` glyph inside the
pill, not by an icon. Nothing in the system is filled, gradient-filled, or
beveled.

### Named Rules

**The Radius-Says-Size Rule.** 10px contains, 6px is controlled, 4px is inline,
round states one word. A new component takes the step matching its role — never a
value between steps, and never a large radius to look friendlier.

**The Icon-Says-Direction Rule.** In a button that pairs an icon with a text
label, the icon's position states which way the action goes — not decoration.
A **leading** icon names the action's category — `plus` for "this creates
something", `trash` for "this destroys something". A **trailing** icon means
the action leaves the app, which is why "Visit" carries `external-link` on
the right and nothing else does. **No icon** means the surface you are
already on has stated the action: the add-site page's submit button is a bare
"Add site" because the heading above it already reads "Add a site", and a
`plus` there would say it twice. A button never carries an icon on both
sides, and a purely decorative icon is not a fourth option. An icon-only
control — the copy button — and a label-only control with nothing to add,
like Cancel, sit outside this rule's domain rather than counting as
exceptions to it. So do the rail's place icons and its collapse button: a
place row is a link, not an action, and its leading icon names the place, so
that the collapsed strip can show the icon alone.

## Components

### Buttons

- **Shape:** Softly squared (6px radius), always `inline-flex` with a 6px gap so
  a 1em icon sits on the text baseline without extra markup. Height is a floor,
  not a fixed value: `min-height` guarantees the resting size — 40px for primary
  and secondary, 32px for danger — while padding and content can still grow the
  button past it, which is what lets a long `Remove <hostname>` label wrap to two
  lines instead of spilling outside its own outline. The footers that pair two
  buttons take `items-center`, because a flex row's default `align-items: stretch`
  otherwise resizes the shortest control to match its tallest sibling — which had
  the danger button rendering at 33.2px in the Danger card and 42px in the
  confirm dialog.
- **Primary:** Ember fill, Hearth text, semibold Nunito at 0.875rem, 10px
  vertical and 16px horizontal padding over a 40px minimum height. Used once
  per view, and it marks the action that will work now: "Add site" beside the
  site list's heading ("Add your first site" in its empty state, which replaces
  it), and "Visit" only while the site is serving (running, responding, or a
  static site). Add site appears nowhere else, the rail included. A page
  whose fix is on the host carries no Primary. A Primary blocked by an explicit
  rejection keeps its disabled look through `aria-disabled` and stays focusable.
  Hover goes Ember Light.
- **Secondary:** A Hairline Strong fill with Chalk text, same size as primary,
  no border. Hover **recedes** to Hairline rather than brightening, which takes
  the label from 7.32:1 to 9.85:1; brightening to Smoke Deep would have been
  4.61:1, the weakest ratio in the system. Always the cancel side of a dialog.
  It is filled rather than outlined because a 1px Hairline Strong line measures
  2.29:1 on Hearth and 1.99:1 on Hearth Lift — invisible as an edge,
  unmistakable as a surface, and the dialog is where it was faintest and where
  it sits beside the one irreversible action.
- **Danger:** Transparent with a Scorch Border outline and Scorch text, one step
  smaller (0.8rem, 6px vertical and 12px horizontal padding over a 32px minimum
  height) — a destructive action is never the largest button on screen. Hover
  fills Scorch Rule with Chalk text.
- **Offer:** Danger's exact geometry — transparent fill, 1px outline, 32px
  minimum height, 6px by 12px padding — in the Ember family rather than Scorch.
  The split is forced by two rules acting together: The Ember Is Interactive Rule
  makes the row's one action ember, and The Scorch-Is-Not-Ember Rule reserves red
  for danger. Deploying a newer version is not destructive, so wearing the danger
  colour would have said the wrong thing at a glance; borrowing its size says the
  right one, because both are in-row controls subordinate to the row they sit in.
- **Compact primary:** Primary's colours, hover, focus, disabled and
  aria-disabled at the offer's size
  (0.8rem, 6px by 12px padding, 32px minimum height). Derived from Primary in
  `shared.ts`, as Compact secondary is from Secondary, so the two cannot drift.
  Used for the runbook's first Deploy and for the Prune in a site page's
  retired notice, where that control is the page's next step.
- **Compact secondary:** Secondary's colours, hover, focus and disabled at the
  offer's size (0.8rem, 6px by 12px padding, 32px minimum height). Made for
  the prune control, which sits on the services board beside the 32px offer; at
  Secondary's 40px it was the tallest control in its row. The host-action strip
  uses it too, for Start, Restart and Update and every confirmation's Cancel.
  Derived from
  Secondary in `shared.ts`, so the two cannot drift apart.
  Hover fills to Ember Deep and lifts the label a step; disabled drops to Smoke
  Deep on a Hairline outline, because the control disables itself while its
  request is in flight and must stop reading as actionable.
- **Disabled:** Smoke Deep text and `cursor: not-allowed`, with the danger
  button — the only outlined button left in the system — dropping its outline
  to Hairline, and the secondary's fill dissolving to transparent while the
  primary's fill is taken to 40% Ember. The two disabled treatments differ
  because their enabled states differ: the secondary's enabled look *is* its
  fill, so removing that fill is the strongest available "not yours to press"
  signal, while the danger button has no fill to remove and so dims its
  outline instead. **Tone, never opacity** — this system says "not actionable"
  by going dim in the palette, the same way `starting` and `not deployed` say
  "not a failure". A blanket `opacity` would fade the border and text together
  at a rate the palette never chose, and nothing else here uses transparency
  as a signal. Disabled is a real state on this app's buttons, not a
  theoretical one: both mutating flows disable their confirm control for the
  length of a service restart, and the sighted operator needs to see that
  their click landed.
- **Pressed:** A 1px downward `translate`, gated behind `motion-safe`. Not a
  shadow — The Flat-At-Rest Rule allows shadow for "you are touching it right
  now", but a transform satisfies the intent without putting depth at rest, and
  depth at rest is what makes a beveled button expensive here.
- **Focus:** Every button, link, and control shares one ring —
  `outline: 2px solid Ember; outline-offset: 2px` — via `:focus-visible`. Inputs
  use the same ring on plain `:focus`. There is no second focus treatment
  anywhere in the system.

### Cards / Containers

- **Corner Style:** 10px.
- **Background:** Hearth Lift on the Hearth page.
- **Border:** `1px` Hairline. The Danger card instead takes Scorch Border at 60%
  over a Scorch Deep wash at 20%.
- **Shadow Strategy:** None at rest — see Elevation & Depth.
- **Internal Padding:** 20px for detail cards, 24px for dialogs and the empty
  state.
- **Retired notice:** A site page whose declaration is retired (`state: absent`,
  not yet pruned) shows one more card, directly under the header and above the
  Request path: a detail card with no visible label (its `Retired declaration`
  heading is an `sr-only` h3, so heading navigation reaches its Prune), holding a Smoke Light Body sentence
  (`<name>.yml is retired (state: absent). Attaching a repository is refused
  until it is pruned.`, machine facts in mono) over the prune line, its Prune the
  page's one compact primary. It is the page-level state notice for a state
  with exactly one way out, so it takes the card treatment and stays until the
  state changes, unlike the transient Flash Banner. It does not reorder the
  cards beneath it: Request path, Manual steps, From a repository and Danger
  keep the order they have for a site that is not attached, since a site
  re-added after a removal may need its DNS record again.
- **Site row behavior:** The whole row is one `<a>`, undecorated, `16px 12px` of
  padding pulled back out with a matching negative margin so its hover ground
  reaches the content column's edges. Left: the hostname (Title face, shared
  suffix in Smoke) over its address in Data — a bare path, or `localhost:<port>`
  with the framework after a middot. Right: the status pill alone, right-aligned,
  with no reserved column. A `1px` Hairline separates rows, dropped on
  the last. Hover fills the row with Hearth Lift over a 150ms color transition,
  gated behind `motion-safe:`.
- **Empty state behavior:** Replaces the row list, and takes the section
  header's Add-site button with it — Ember spent twice on one destination makes
  neither the obvious one. Centered column, 16px gaps: a Body Strong heading in
  Nunito (it is a sentence, not a machine fact), one Body line naming what a
  site is, and the primary button.

### Inputs / Fields

- **Style:** Hearth fill, `1px` Hairline border, 6px radius, DM Mono at 0.875rem
  Chalk, 10px × 8px padding. Placeholders are Smoke at 60% opacity. Inputs are
  mono because everything typed into them is a hostname, a port, or a path.
- **Label:** A `flex` column with a 6px gap and a 0.85rem Smoke label above —
  labels are never placed inside or beside the field.
- **Focus:** The shared Ember ring at 2px with 2px offset.
- **Selectable option rows:** The static/reverse-proxy choice is not a bare radio
  pair but two bordered rows (6px radius, 12px × 10px padding) each holding a
  radio, a Body Strong title in Chalk, and a Smoke explanation indented to the
  title's text. Both rows share one neutral treatment: unchecked, a Hairline
  border on a transparent ground; checked (`:has(:checked)`), a Hairline fill
  with a Smoke Deep border. Ember is every radio's `accent-color` and nothing
  else. Until 2026-10-26 the proxy row went Ember Deep at 50%, a wash that read
  close to the error ground; until 2026-10-27 both went Ember Edge, which read
  as Scorch beside an invalid field's ring.
- **Error:** Inline errors are 0.8rem Scorch. A form-level error is Scorch on
  Scorch Deep at 60% with a Scorch Edge border at 70%, 6px radius, hidden until
  it has text.
- **Affixed field:** When part of a value is fixed and only the rest is typed,
  the fixed part is shown as an affix joined to the input, not as a hint
  beside it: 0.72rem mono Smoke Light on a Hairline fill with a Hairline
  border, the shared edge dropped and the input's facing corners squared. The
  focus ring moves from the input to the wrapper (`focus-within`), so it
  encloses both pieces and the affix reads as part of the control; the affix
  is also tied to the input through `aria-describedby`, so it is announced
  with it. Add-site's hostname field carries the domain as a suffix
  (`.lychee.land`); the attach control carries the registry as a prefix
  (`ghcr.io/lycheehome/`), because the reconciler accepts no other path and
  the only thing left to type is the repository's name.

### Pills

- **There is no type pill.** The type is already in each row's address and in
  the detail page's last hop, and a coloured type label competed with the status
  pills beside it.
- **Status pills:** 0.6875rem mono, uppercase, tracking 0.06em, prefixed with a
  decorative `●` that is `aria-hidden` so it never joins the accessible name,
  fully round, and colored by tone only: Clear on Clear Deep, Scorch on Scorch
  Deep, or Smoke Light on Hairline. `shrink-0`, because a status must never
  compress to fit a long hostname. **Placement belongs to the row, not to the
  pill** — right-aligned in a single-line row, first in a fixed-width left
  column in a multi-line one. See The Pill-Needs-an-Edge Rule.

### Navigation

One rail, on every page, and one way to search it.

**The rail** is the app's only navigation: Hearth, the page's own ground, so it
reads as part of the page rather than a panel laid over it, separated from the
content by a `1px` Hairline rule. It has two states from 900px, expanded
(250px, described here) and collapsed to an icon strip (56px, below). Top to
bottom, at 20px gaps:

- the `lychee` `admin` wordmark as a home link at Display 1.5rem, the page's h1,
  8px in so it stands over the place rows' icons, with the collapse button at
  the line's right edge (below);
- the find box (below);
- **overview**, a row linking to `/`, carrying the rail's one health mark
  (below), and under it **activity**, a plain row linking to `/activity`;
- **Sites**, a row linking to the list at `/sites` like the two above it, then
  every managed site in Caddyfile order, indented 32px from the rail's inner
  edge so each label starts under the place words rather than under their
  icons (12px under Sites' own text until 2026-10-29, when the rows had no
  icons): the label and a right-aligned `static` or `:<port>` hint in
  Smoke Light, with no status mark. The label is Chalk; the domain is not shown (it was, as `· lychee.land`
  beside the heading, from 2026-10-27 to 2026-10-29), and each row keeps it as
  screen-reader text, so a row's accessible name is still its full hostname.
  The apex row is `lychee.land` whole. Until 2026-10-27 each row showed
  `.lychee.land` in Smoke and three seed rows wrapped to two lines;
- **Services**, **Reconciler** and **Infrastructure**: the services board's
  three pages, peers of one another, with no chip beside them and no heading
  over them (their `<nav>` keeps `aria-label="Host"`, so assistive tech still
  hears the group). Until 2026-10-29 `sites` and `host` were headings, in
  tracked caps for a day before that, and the site rows sat flush under
  `sites`; once Sites read as the page it links to, the indent carried the
  nesting and `host` named nothing the three words do not. A short Hairline
  divider (1px, inset 8px either side) sits between Sites and Services, so
  the app's own places and the host's three boards read as two groups in
  both states.

Every place row (Overview, Activity, Sites and the three boards) opens with a
16px line icon in the row's own colour, 8px before its word: `overview` is a
dashboard of four unequal panels, `activity` a pulse line, `sites` a globe,
`services` a box, `reconciler` two cycling arrows and `infrastructure` two
stacked server units (see Shapes). The icon names the place, so the strip can
show it alone. Site rows carry no icon. A place row does not spread its
content to the row's edges: the word follows the icon, and Overview's signal
keeps right with its own `margin-left: auto`. Until 2026-10-29 the place rows
had no icons.

**The collapse button** sits at the right of the wordmark's line: a 32px
square, transparent, with a `panel-left-close` icon in Smoke that goes Chalk on
a Hearth Lift ground on hover, the shared focus ring, the label `Collapse
sidebar`, `aria-expanded="true"` and `aria-controls` naming the rail. In the
strip it becomes `panel-left-open`, `Expand sidebar`, `aria-expanded="false"`.
After a flip focus moves to the other state's button, so a keyboard user keeps
their place. The choice is per browser, stored under `lychee-admin:rail` as
`collapsed` or `expanded`, and read before the first paint, so a reload never
flashes the other state; a store that cannot be read or written means
expanded, and the button still flips the rail. There is no shortcut for it and
no animation: the column changes width in one step. Below 900px the stored
choice has no effect, and the drawer always holds the expanded rail.

The rail is navigation only and carries no action: Add site lives beside the
site list's heading as that page's Primary.

Rows and links are 0.85rem in Smoke; on hover a row goes Chalk on a Hearth Lift
ground, as a sites-list row does, over a 150ms color transition gated behind
`motion-safe:` (a site row's label is already Chalk, so before 2026-10-29, when
hover only changed the text, pointing at one showed nearly nothing). The
current row keeps its Hairline fill under the pointer. The rail has no
headings. A site row is mono, like every hostname and port. A place word
(`overview`, `activity`, `sites` and the three board links) is Nunito, shown
capitalized (`Overview`, `Services`) by CSS `capitalize`, so the markup and the
accessible name keep the plain word. Until 2026-10-29
the whole rail was mono and lowercase. `aria-current="page"` is both the accessibility signal
and the styling hook (the arbitrary `aria-[current=page]:` variant): Chalk text
on a Hairline fill, the ground alone, with no left rule (a 2px Ember Edge one
until 2026-10-29). It marks `overview` on `/`, `activity` on `/activity`, a site's own row on
its page, `Sites` on the list, and a board's link on its page;
`/sites/new` marks nothing, since its breadcrumb carries the location. A rail
item's destination never changes with location.

**The overview signal.** The rail carries exactly one health mark: on the
`overview` row, right-aligned, a 6px dot and then a count in 0.72rem mono. It
counts only the worst tone present — a Scorch dot and the number of things that
are bad when anything is; a Smoke dot and the number that could not be read
when only unknowns remain; nothing at all when everything is clear or before
the first health read; and a Smoke dot with no number when the latest read
failed, never a remembered green. A bad count and an unknown count are never
added together, so the mark never mixes tones. It counts each thing once, a
site and its container as one thing, bad if either is, with the same function
as the overview's strip and attention list, so the three always agree. The dot
and number are `aria-hidden`; the link's accessible name carries the same facts
(`overview, 3 need attention`).

**The icon strip** is the collapsed rail: the same Hearth column and Hairline
rule, 56px wide, the page grid's first column narrowing with it so the content
gains 194px. Top to bottom, centred, at 16px gaps: the wordmark collapsed to a
Poetsen `l` monogram at Display 1.5rem, still the home link inside the page's
h1 with the accessible name `lychee-admin` (it is the wordmark, so The
Signature-Twice Rule still counts two places); the expand button; a find cell;
Overview, Activity and Sites; the divider, 24px wide; then Services,
Reconciler and Infrastructure. A cell is 40×36, 6px radius, its icon 18px (two
more than a row's, since it stands alone), Smoke at rest, Chalk on Hearth Lift
on hover, and current as a row is, Chalk on Hairline; cells within a group sit
2px apart. Site rows, the find box and its `⌘K` hint, the `admin` qualifier
and the rail's two notes are not rendered at all, so none of them is in the
tab order. Each cell keeps its place word as screen-reader text, so its
accessible name is the one its row has expanded. The overview signal becomes
a badge pinned to the Overview cell's top-right corner: a 5px dot and the
count in 0.7rem mono (the type floor), in the signal's tone, the dot alone
after a failed read, nothing when clear, and the same spoken phrase. ⌘K still
finds, through the peek.

**The strip tooltip** names a cell on hover and on keyboard focus: the place
word (or `Find`) in Body type (0.8rem Nunito) at Chalk, capitalized, on a
Hearth Lift ground with a `1px` Hairline edge, 6px radius, 4px 8px padding and
the Overlay shadow, since it floats over the page, 10px to the cell's right and
vertically centred on it. The capital comes from `::first-letter`, not
`text-transform: capitalize`: the tip sits in the same cell as the
screen-reader word, and `capitalize` would read the two as one run and leave
the tip lower-case. It is `aria-hidden`, because the cell's own word already
names it; it never takes the pointer, and it never wraps. The rail's column
stacks above the content column (`z-30` on the sticky `<aside>`, which is a
stacking context of its own), so positioned content in the page — a command
block, a copy button — never paints over the tooltip, the peek or the find
panel, or takes their clicks.

**The peek** is find while collapsed. The strip's find cell or ⌘K opens the
expanded rail, 250px wide, fixed over the content from the left edge at full
height, on the rail's own Hearth with its Hairline right edge and the Overlay
shadow (a modal drawer over a backdrop was the alternative, and was not
chosen: the page stays live behind the peek), with the find box focused. While
it is open it takes the strip's place in the rail, as the drawer takes the
rail out of it, so there is only ever one wordmark, one find box and one set of
navigation landmarks; the page grid keeps its 56px column, so nothing beneath
it moves. It closes on Escape (a first Escape closes find's open panel, a
second the peek), on its own collapse button, on a pointer down outside it, on
focus leaving it, on narrowing below 900px, and on any in-app move. An Escape
or the collapse button returns focus to what opened it (the strip's find cell,
or whatever had focus before ⌘K); every other close leaves focus where it
went, and a move hands it to the new page's heading. The peek never changes the
stored choice.

Until 2026-10-28 every site row carried an 8px status dot (hollow for a static
site), every page link two attention chips, and the top bar an overall count:
the rail was doing a dashboard's job in 250px. That job is the overview page's
now (see Overview, below), and the rail is navigation plus one signal.

**The find panel** opens from the find box: a mono input, its placeholder
`Find` in Nunito (an instruction, not an example value), with its shortcut
(`⌘K`, or `Ctrl K` off Apple platforms) printed inside it at its right edge in a
Smoke `kbd`. ⌘K focuses it from anywhere. The panel is a 10px-radius Hearth
surface with a `1px` Hairline edge on the shared Overlay shadow, anchored beside the rail over the
content's top-left, at most 420px wide, listing places and never actions. With
nothing typed it lists what needs attention, sites first; typing narrows every
site and unit by a literal substring under four group headings — Sites, then
services, reconciler, infrastructure, in Nunito, uppercase and tracked like the rail's headings — each row a hostname or unit name, its
status pill at a shared right edge, and `deploy blocked` or `deploy failed` in
Scorch mono before the pill when that is why it is listed. Rows are 0.8rem mono
in Smoke; the highlighted row goes Chalk on a Hairline fill, without the Ember
Edge rule, which belongs to where you are rather than where you might go. Empty
states are one Smoke sentence per group. Enter or a click on a row is the end of
the search: the query clears, the panel closes and focus leaves the box, so the
page arrived at takes focus as any move's does — its heading, or the board row
the move named, which shows the Ember focus ring (until 2026-10-27 the panel
stayed open over the row it had opened).

**Below 900px** the rail is replaced by a top bar: the wordmark (the h1 at that
width), then a find button and a menu button, each a 36px square outlined in
Hairline. The menu button carries the overview signal as a badge pinned to its
top-right corner — `● <count>` in 0.6875rem mono on a Hearth ground, Scorch or
Smoke by the same rule, `●` alone after a failed read, none when clear —
because it opens the drawer that holds the `overview` row; its accessible name
says the same (`Open navigation, 3 need attention`). The menu button opens the rail itself as a
modal drawer, 280px wide, from the left edge, over a 60% black backdrop; Esc or
a backdrop click closes it and focus returns to the opener. Find on a narrow
screen opens the drawer with the find box focused.

There is no per-site switcher any more: the rail lists every site on every page,
and the breadcrumb is plain location text, `sites / <hostname>`.

Per-site tabs are deferred until a second tall, task-specific section exists
alongside Deploy (most likely container logs); one such section does not make
a tab strip.

### Overview

The page at `/`, and the one place the whole host is read at once. Three blocks
stacked full width under an `Overview` eyebrow, 32px apart: the strip, needs
attention, recent activity. It shares the frame with every other page.

**The strip.** One flat Hearth Lift card with a Hairline edge and no padding of
its own, divided by Hairline rules into four equal cells — `sites`,
`services`, `reconciler`, `infrastructure` — each a link to that page, 20px by
16px inside. Below 640px it is two by two, ruled between the rows and columns
and never doubling the card's edge. A cell holds three lines: the group name as
a Section Label in Smoke Light; the total and noun in 0.9rem mono Chalk
(`8 sites`, `11 units`) followed by the rail's old chips, what is bad in Scorch
on Scorch Deep and what could not be read in the neutral pill's colours, each
only when non-zero; and a quiet 0.75rem Smoke line — `last tick <age>` on the
reconciler cell, `all clear` on a cell with nothing to report, `inventory
unavailable` when the inventory could not be read — which keeps its height when
empty so the cells stay level. Hover lays a faint Hairline wash; the focus ring
is drawn inside the cell, because the card clips its overflow. Ember stays off
the strip.

**The Count-Line Rule.** An overview cell is a count line, not a KPI tile: a
label, a mono total with the tone chips, and one quiet fact. No hero figure, no
chart or sparkline, no trend arrow, no percentage. The host has no metrics to
visualize, only things that are fine, things that are not, and things nobody
could read; a cell says how many of each and links to the page that names them.

**Needs attention.** A Section Label in Scorch, `<n> need attention` (`needs`
when one), over a Hairline-ruled list on a three-column grid: the state pill
first in a fixed 150px column so every pill's left edge lines up (The
Pill-Needs-an-Edge Rule), the subject as a 0.85rem mono Chalk link that wraps
rather than widens, and where it lives (`sites`, `services`, `reconciler`,
`infrastructure`) right-aligned in 0.75rem Smoke. A unit in deploy trouble
reads `deploy blocked` or `deploy failed`. A site whose container is the only
part in trouble is filed under its container's page, still linking to the site,
so the `sites` cell never says `all clear` above a row filed under `sites`.
The rows nobody could read follow under a Smoke Light subheading, `<n> couldn't
be read`, in the same grid; with nothing bad, only that part shows; with
nothing at all, the block is absent. When the health read fails, the block is
one Smoke mono line, `health unavailable · last read <age>`.

**Recent activity.** A Section Label, `Recent activity`, over a full-width
Hairline-ruled table of the last eight events from the app's audit log and the
reconciler's history, newest first, with columns `when`, `who`, `kind`,
`subject`, `outcome`, all 0.8rem mono. `when` is an age in Smoke (`5m`, `3h`);
`who` is plain Smoke text, `app` or `reconciler`, never toned or tagged;
`subject` is a Chalk link when it has a page, plain Chalk when it does not;
`outcome` leads with its word in its tone's text colour — Clear, Scorch, or
Smoke Light. No zebra striping, no row hover. A source that could not be read
gets one Nunito Smoke sentence under the table rather than reading as an empty
history; with nothing recorded and both sources read, the sentence is
`Nothing recorded yet.` Below the width the table needs, it scrolls sideways in
its own box (The Show-It Rule), so the page never does. Under it, `see all
activity` is a quiet 0.75rem mono Smoke Light link with a Hairline Strong
underline, to the full history.

**The kind tag.** The `kind` column is the row's one shaped element: the kind
word (`deploy`, `add`, `remove`, `attach`, `prune`, …) in 0.72rem mono Smoke
Light inside a fully round chip with a `1px` Hairline Strong edge and no fill,
so the eye can run down the column by kind. It is a category, not a verdict,
and never takes a tone — the outcome carries the tone, always with its word.

### Activity

The page at `/activity`: the whole history behind the overview's eight rows,
under an `Activity` eyebrow, in the frame like every other page. It is the
overview's table carried on, not a new component — the same columns, cells,
kind tag and outcome colours — with three additions.

**Filters.** One line of three native selects above the table's left edge,
`subject`, `who` and `kind`, each under a Section Label caption in Smoke Light,
in the shared input style at 0.8rem. When any is set, a `clear filters` link in
the overview's `see all activity` style follows them. Nothing else on the page
filters, and nothing is a chip.

**Day headings.** Rows are grouped by the browser's local day, each group its
own row group opened by a Section Label heading row spanning the table —
`today · wed 28 oct`, `yesterday · tue 27 oct`, then `mon 26 oct` (a year only
when it differs) — with extra space above it so a day reads as a break. `when`
stays an age, as on the overview, with the exact local time in its title, so
the two pages never describe one event two ways.

**The detail line.** A failed, refused or blocked row carries the error that
explains it — a `caddy validate` message, a reconciler's failed step, a gate
sentence — as a second line in the outcome cell: 0.75rem mono Smoke Light,
wrapping at a 60ch measure, never cut, never toned (the outcome word above it
carries the tone). On this page a subject breaks only when the hostname alone
is wider than its column; until 2026-10-28 an unbounded detail line let the
outcome column take the width and hostnames broke mid-label.

**Show older.** A Secondary button under the table loads the next 50 below;
at the start of history it gives way to a quiet `Start of history` line in
0.75rem mono Smoke. Older rows are added, never paged away.

**Ways in.** The rail's `activity` row; the overview's `see all activity`; and
on a site's page, `Activity` — a Secondary button beside Visit, before it,
opening that site's history. It is never Primary and never outlined: Visit (or
nothing) keeps the page's one Ember action, and an outline at Hairline Strong is
invisible as an edge.

### Command Block (signature component)

The most-used component in the app and the reason several other values are what
they are. A `<pre>` at Code size on Hearth with a Hairline border and 6px radius,
`overflow-x: auto` and `white-space: nowrap` so a long command scrolls rather
than wraps, with a copy button absolutely positioned inside it. An optional
caption beneath in 0.72rem Smoke names the directory the command must run in —
a value you have to read, so it is not dimmed below Smoke. No current command
takes one: the logs command reaches its container by compose project name
(`docker compose -p <name> logs --tail 100`), which runs from anywhere, and that is the
better shape whenever it is available.

**A whole file is the one multi-line variant.** The repository card renders
each scaffold file in full, at full height, at 0.72rem with 1.6 leading, under a
Micro-label row carrying the file's path (uppercase dropped, as a path always
is) on the left and its line count on the right. It **wraps** rather than
scrolling sideways — `pre-wrap`, breaking anywhere — because the release
workflow's build line is wider than the card, and The Show-It Rule
allows horizontal overflow only on a one-line command. The copy button reads
the text content, so wrapping changes nothing that is copied; it pins
top-right, per The Coupled-Inset Rule.

The copy button is a 26px square: Hearth Lift fill, Hairline border, 6px radius,
a 16px clipboard icon that swaps to a check on success. **It must keep its
non-clipboard fallback** — this app is served over plain HTTP on the LAN, so
`navigator.clipboard` is undefined and even reading `.writeText` throws; the
failure path selects the target's text and relabels the button "Press Ctrl+C to
copy". The selection is the feedback in that case, not an icon change.

**The Coupled-Inset Rule.** Every copy button in the app is one size (16px icon
→ 26px button) at one inset (6px), pinned center-right in a single-line block and
top-right in a multi-line one. The code block's 10px vertical padding and 44px
right padding are chosen against those numbers to balance the gap and keep the
button off the text. Change any one of the four and recompute the others.

### What-Gets-Written Panel

The add-site page's right column, and the only place in the app that shows
config before it exists. A card holding, in order: each target file's path as
a Micro-label with its uppercase dropped — a path is case-sensitive and must
never be transformed — over a Hearth inset showing the lines to be added in
Clear, with one line of surrounding context in Smoke beneath them so the
insertion point is visible — Smoke, not Smoke Deep, because this text is well
below Headline size, where the Dim-Text Rule's 4.5:1 floor applies and Smoke
Deep does not clear it. Additions are marked by colour, never by a `+` gutter,
because a YAML list dash in the same column reads as a deletion.

Below a `1px` Hairline rule, the six add steps in execution order. A step the
chosen type skips (a reverse proxy creates no site directory) reads `· skipped`
beside its label as soon as the type is chosen, a word a listener hears; a
submit's own ✓, ✗ or `·` marks stand at the right edge. Until 2026-10-27 the
skipped step showed nothing until a good preview, then a bare `—` at that edge.

The panel is not a live region. It rewrites on every debounced keystroke, and
announcing a Caddyfile block that often would bury the field being typed into;
the one actionable thing in it — a rejection the submit would also make — is
announced by its own `role="status"` error instead: a Scorch box whose text is
the server's sentence, so Nunito, as is the submit's own error box beside the
form. A rejection is said once. When a field already states the same sentence
(the port, whose conflict check runs on the page too, and the hostname, whose
characters the page judges with the validator's own `hostnameMessage`), the box
stays hidden, the panel's line reads "Fix the port in the form and the block
appears here." (or "the hostname"; not "above": at desktop width the form sits
beside the panel), and a blocked submit points to and focuses that field
instead. The hostname's error sits under its field in a status slot, with
`aria-invalid` on the field while it holds one, and says one cause per message:
wrong domain, more than one label, or invalid characters.

### Routing Hop Chain (signature component)

The component that states this app's whole thesis: a request's path as four
labelled stages — Cloudflare DNS → the sites tunnel → Caddy → your files or your
app. Each hop is a Micro-label above a Data value above an optional 0.72rem
sub-line (Smoke by default, tone-colored when it carries live state).
Separators are Hairline Strong arrows that flip from `→` to `↓` below `sm`, and
are `aria-hidden`.

Hops two to four carry live state; hop one never does and never may. The tunnel
and Caddy hops read their own systemd unit — one unprivileged `systemctl show`
for both, run concurrently with the per-site check and degrading to a neutral
`unknown` if it fails — and the last hop reports the site itself. Hop one is
Cloudflare DNS, which this app does not touch at all (Tier 1 scope), so its
sub-line reads `manual step` permanently: an indicator there would be invented
health rather than a reading, and would go stale the moment a record is
created. Every hop in a `bad` tone gets an entry in a
"What to check" list *inside this card*, beneath the chain behind a Hairline
rule, in request order — tunnel, Caddy, your app. Each entry is a Scorch mono
hop key (a dot and the hop's name) beside a Body sentence and a command block;
the key is a fixed column above `sm` and stacks over its sentence below it. Hop
one never gets an entry, because it has no state to be bad. It is a list of
what to check, never a numbered step that appears and disappears with container
state.

### Service Row

The row shape of the services board (`GET /services`, `/reconciler` and
`/infrastructure`), and the one place a
status pill leads. A fixed-width left column holds the pill; the right column
holds the unit's name on one line and its facts beneath, as prose rather than
columns — `v0.2.0 · 3 attempts`, with no raw reconciler `result` word (the one
exception is `blocked`, kept on a row whose `gate_code` the app cannot classify,
since such a row gets no deploy line). The reconciler's own gate string follows
on its own line, in full, only for a blocked or failed run that has one; a
healthy run's gate text is not shown.

A deploy that is blocked or failed gets its own line directly under the name,
`● deploy blocked · <reason>`, because the pill stays the unit's own health and a
healthy old build must never read as a broken one. Scorch marks trouble the
operator has to act on and Smoke marks a deploy that is only waiting (`deploy
waiting`); the colour sits on the `deploy <word>` alone, in mono, and the reason
beside it is a phrase, so Nunito in Smoke, and is left out when it would only
repeat the word or when the gate string sits beneath the line and already gives
the reason. A blocked
deploy is classified by the reconciler's `gate_code`, never by the sentence beside
it, and a failed one by its `result`; a blocked row with no code, or with a code
the app does not know, gets no line. A container row with
nothing installed whose pill already reads `failed` or `awaiting image` gets no
line either.

Prose and not a table, deliberately: half the rows have no deploy state at all
and never will, because the game server, Caddy and the tunnel are not things the
reconciler deploys. A table of those rows is mostly empty cells arguing it
should have been a list, and the longest and most important content — the gate
string naming a recovery command — breaks a row grid wherever it lands.

Each group is its own page, named by the page's eyebrow, so the board carries no
Micro-label group headings and no card around its rows. The rows once grouped
under those headings on one page, as a reading order rather than three
independent objects; when the board split into three peer pages (chosen from a
rendered comparison on 2026-10-19), the eyebrow came to name the group, and a
heading beneath it would only have repeated it. Each page repeats the inventory's
freshness line, and a page whose group the inventory lists nothing in says so in
one plain sentence. Age is always rendered as an age and never as a timestamp, with no
threshold at which it changes appearance — "written 3 hours ago" reads as wrong
on its own, and a cutover would be a number nobody has watched long enough to
choose.

This section used to end that first sentence with "and nothing on this page is
actionable". That stopped being true when the row gained the offer line below,
and it is recorded rather than quietly deleted because it is the shape this file
fails in: a sentence that was accurate when written, describing an absence, and
nothing breaks when the absence ends.

**The attention summary.** When any row needs attention (a Scorch pill or a
Scorch deploy line, decided by the same function that draws the row), one line
sits under the eyebrow: `N need attention` in Scorch mono, then each row's name
as a mono link to its row, in inventory order, in a Nunito sentence; then, apart,
`N unknown` in Smoke Light mono and the rows whose state could not be read, so
the line counts exactly what the overview strip's chips count for this page. The rows
themselves keep inventory order, the one fixed map of the page, so nothing moves
between re-reads; the five-second read is the sentence. A calm board with
nothing unknown has no line at all, and merely waiting rows are never named.

**The offer line.** When a service's declaration can be moved to a newer
published version, the row grows one line beneath its facts — the available
version as a Chalk mono fact followed by `available` in Nunito Smoke, then an
Offer button naming that exact version. The version is a value you can only
read, so it stays out of Ember; the button is the line's one Ember. It is a line
and not a column: a third grid column would be reserved on all ten rows to serve
the two that can ever carry an action, and eight of them would hold an empty
cell on a board whose whole job is a five-second glance. A row with nothing to
offer is byte-identical to one from before the feature existed.

**The requested line.** Once Deploy succeeds, the offer is replaced in the same
position by the requested line: the tag and the word `requested` in mono Chalk,
then `· applies on the next run` in Smoke, with no control, because there is
nothing left to press. It is swapped in place from a template the server
rendered into the page, so the client never composes its markup, and it takes
focus so the change is announced. The server renders the same line from the
declaration it just committed, not from the inventory, until the reconciler's
inventory catches up; it shows only while the pending tag is the offered tag,
and the pill and every other line on the row are unchanged. When the inventory
catches up, the row's own states (`applying`, step four's "requested") take
over.

**The same line serves a site's own page.** An attached Next.js site's
repository card carries the offer from the same renderer and the same Deploy
control, posting to the same endpoint — a Compact primary during the first
deploy, the board's outline offer otherwise — and the rule for whether a tag is
on offer at all is one function shared by both pages — so a site's page and the
board can never disagree about what is deployable. It lives in that card, not
the page header, which keeps Visit the header's action while the site is
serving.

Where both appear, the gate line comes first and the offer second. A blocked
service's gate string carries its own recovery instruction — on this host it
reads `not retrying (promote another tag, or rm …/.failed-tag)` — so the gate
explains why and the offer is the thing you would do about it. Explanation, then
action.

A failed row carries the Repository Card's failure line, the same markup from
the same function: the tag it tried, the reconciler's failed step in mono, and
`journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"` as a Command Block. It sits after the gate and
directly above the offer, so the order stays explanation, then action. The facts
line still reads `failed · N attempts`; the failure line is what says which tag
and why, which a service with no site page (palsave-api) has nowhere else to
say.

**The prune line.** A site row whose declaration is retired (`state: absent`)
and still in `lychee-resources` grows one more line, last: a compact secondary
`Prune old declaration` button (compact primary in a site page's retired
notice, where it is the page's next step) and a caption naming the file it
deletes and the condition it waits for, as one Nunito sentence at 0.75rem with
its two facts in Chalk mono — "Deletes `<name>.yml` from `lychee-resources`
once its container is confirmed down." — which wraps at words like any
sentence. The same markup, from
the same function, sits in a site page's retired notice, and both post to
the same route. On the board, Secondary rather than the offer's Ember outline or the danger button's Scorch: it removes
a file already retired for a container already down, in a commit that can be
reverted, so it is neither the row's way forward nor a destructive act, and no
modal guards it. The button is shown only on evidence that the declaration is
absent — an unreadable clone shows none anywhere — and only for a site's
resource name; a hand-declared service such as palsave-api is never pruned from
here. On the board the button also waits for the evidence the route itself
checks: a row offers Prune only once the reconciler has confirmed its container
down (`confirmedDown`, the one rule the route and the board share), and its pill
then reads `retired`, its site page's word, in place of the live state. Until
then the row keeps its live pill and grows a Smoke line under its facts in the
deploy line's shape, `● retiring · Prune follows once the reconciler confirms
the container down` (the key in mono, the reason in Nunito), which names what Prune waits for and stays true when a
down fails (the failure then shows as `failed`, in Scorch, on the pill when
nothing is left installed and on the row's `deploy failed` line when a version
still is). On a site page,
whether the container is down yet is still the route's to answer, through the
toast.

**The name, and a pill that cannot be read.** Every row carries an anchor
(`service-<name>`) so a site's page can link to it, and a site resource's name
links back to its site, but only while that site is still in the Caddyfile: a
retired declaration outlives its site, and a link to a page that answers not-found
would be worse than plain text. A row whose pill reads `unknown` carries one Smoke
sentence beneath its name saying lychee-admin could not read that unit's (or
container's) state, since a neutral word alone does not say whether anything is
wrong. A container row with nothing installed whose last run failed, or which
is awaiting its first image, shows the word its site page shows, `failed` or
`awaiting image`, from the one function both use; other states can differ by
design, because the page falls back to `awaiting image` where the board shows
the live container state.

**Applying is a state of the pill, not a colour.** While a declaration pins a
version the host has not installed yet, the pill reads `applying` in the neutral
tone and the facts line states both versions as one fact, `v0.2.0 → v0.3.0`,
rather than two. Neutral and never Scorch, under The Three-Tone Status Rule: the
reconciler acts within a couple of minutes, so a pending deploy is ordinary operation,
and a board that paints it as failure cries wolf on every deploy. The pill only
says `applying` when the last reconcile actually succeeded; a blocked or failed
row keeps its real state, because a pin that moved and then stopped is not in
flight, and it would otherwise read as applying forever.

**The host-action strip.** A unit whose inventory entry lists host actions
(today only `palworld-palchuds`) grows a strip of in-row buttons beneath its
facts, chosen from a rendered comparison as "01 Strip". Start shows only when
the unit is not up, and Stop and Restart only when it is not down (a state the
page could not read shows all three); Update always. Stop is the only coloured
button in the strip, a Danger button; Start, Restart and Update are compact
Secondary, the grey Prune the board already uses ("02 Quiet neighbours", from a second
comparison). Stop is the one action that leaves the server down, and an Offer
outline beside a Danger one read as one red, so the strip spent no colour on
the others rather than let Stop's lose its meaning. Stop,
Restart and Update each confirm inline: the strip is replaced in place by one
sentence naming what happens to the people on the server, then Cancel and a
confirm button named for the act ("Stop server"), Cancel on the left as in the
Dialog. Stop's confirmation sits in the Danger card's Scorch wash; the other two
on Hearth Lift with a Hairline edge, since neither destroys anything. The most
recent run is one more mono fact line — `update succeeded · 2 hours ago · took
3m 41s`, the state word in its tone — over a `<details>` disclosure "log · N
lines" holding the tail in full and wrapping, open by default when the run
failed, and reading `log · no output` when there was none. That fold is The
Show-It Rule's named exception and goes no further: closed only for a run that
finished cleanly. While a run is
active the pill turns neutral and names it (`restarting`, `updating`), the
same move `applying` makes; every button disables, a Smoke sentence says an
action is already running on the unit, and the live tail shows open beneath a
fact line led by the same pulsing Smoke dot the remove dialog uses. The page
polls only while that is true and reloads once the run settles. Ember stays on
the buttons alone: the live log line is not tinted, because a value you can
only read is not Ember's.

### Repository Card (From a repository)

The deploy story of a Next.js site, and the one card in the app that is a
runbook. It has two shapes, decided by whether a version is installed.

**Before anything runs, it is four numbered steps in the order they happen:**
commit the three scaffold files (each shown in full — see the Command Block's
whole-file variant), create the repository in `LycheeHome` and push the first
tag (a copyable command), attach, and deploy. A one-line Body sentence above the
steps says which happen in GitHub and which happen here, because a numbered
list otherwise implies the page performs all of them. Each step is a numeral
column beside a Body Strong title — machine facts inside it set in mono, per The
Mono-Carries-Facts Rule — over its body, 20px between steps. An open step's
numeral is the remove dialog's: Ember, in a 1.2rem ring of Ember at 40%. A
done step's numeral becomes a check in Smoke Light inside a Hairline Strong
ring, and its title gains a mono `done` in Smoke. A done scaffold or
repository step (one and two) folds at rest into a native `<details>`, closed:
its summary is that title line, `done`, step one's file names in mono, and a
chevron, and its body stays in the page beneath. Step three
(attach) and step four (deploy) never fold. The numeral leaves Ember when
the step is done because there is nothing left to act on there — The Ember Is
Interactive Rule, applied to a step rather than a button.

**Once a version is installed, the setup is history** and the card collapses
to facts: `running`, `requested` while a pin is in flight, and `repository`, as
key–value detail rows, then the failure line when a redeploy failed, then the
gate line and the offer line exactly as a service row shows them. In both shapes the card closes, below a Hairline rule,
with the build and run commands the Dockerfile bakes in — detail rows, not
command blocks, because they run inside the image and are not commands to run
yourself.

**The attach control** is step three's body until there is something to show
instead: a Smoke label, then the affixed repository field and a primary
`Attach repository` button on one wrapping row, then a caption naming the
file it will write and saying that no tag is written until the first deploy,
as one Nunito sentence with its facts in Chalk mono, as the prune line's is
(the change-repository caption beneath its own field follows the same form).
Its error is the form-level error surface with `role="alert"`, hidden until it
has text, in Nunito like every error box that holds a sentence: the add page's
two and the pages' refresh alert. When the site's declaration is retired but
not yet pruned, there is no attach control and no runbook at all: the card's
body is one Body sentence, "While `<name>.yml` is retired, there is nothing to
set up here. Prune it above, then attach a repository again; the setup steps
come back once it's pruned.", above the build and run rows. Attach would be
refused until the prune, which the page's retired notice under the header
offers (see Cards / Containers), so a 2,200px runbook below it was setup nobody
could act on (critique 2026-10-26). After the prune the page re-reads and the
runbook returns. Attached, the step's body becomes the image and declaration file in
mono, so the step shows what was written rather than that something was.

**The change-repository control** joins that body only once the reconciler has
run and found no tag, while the declaration is still tagless: a Body sentence
saying no image was found at the mono image path, then naming both causes
without picking one — push `v0.1.0` if it has not been, change the name if it
is wrong — because a typo and an unpushed tag look identical from here. Below
it, the attach control's own shape (the same label, the same affixed field,
prefilled with the current repository) with a **secondary** `Change repository`
button, not a primary: correcting a request is not the step's forward action,
and the page's one Ember fill belongs to its forward action. Its caption names the file it
rewrites and that it works only while there is no tag; its error is the same
form-level surface. Step four does not repeat the explanation and says only
that nothing is offered until an image exists. Before the reconciler's first
run there is nothing to explain and no control; once a tag is found, written
or deployed there is no control either, because the writer refuses to repoint
a tagged declaration.

**The failure line** replaces "requested" when the reconciler tried a deploy
and failed: a Body sentence naming the tag it tried, the step that failed as
the reconciler recorded it — mono, in Smoke Light, the gate line's own
treatment — and `journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"` as a single-line Command Block.
It sits in step four before anything is installed and, after, in the
collapsed card above the gate line. When a different, newer tag has been
published, the offer line follows it in both places, exactly as a blocked row's
follows its gate: the reconciler retries the failing pin every tick, so a newer
tag is the way out, and the failure stays on screen beside it. The tag that
failed is never offered again. The Scorch is the status pill's alone
(`failed` before anything is installed; the container's own word after); the
sentences stay Smoke, because status colors never go on prose.

**The Evidence-Marks-Done Rule.** A runbook step is checked only by something
the page has read, never by the operator's say-so and never by elapsed time.
The commit and the first tag are done once the reconciler has found a tag in
the registry; attach is done once a declaration exists, or, only when the
app's copy of `lychee-resources` cannot be read, an inventory entry;
deploy is never checked, because once something is installed the runbook is
replaced. A step that cannot be verified from here stays open rather than
guessing, so a check always means the host agrees.

### Flash Banner

Fixed 24px from the top, centered, `min(480px, 100vw - 2rem)` wide, mono at
0.85rem Chalk, 6px radius, the Overlay shadow, and `role="status"` with
`aria-live="polite"`. Four kinds, and the kind determines both color and
dismissal: success and info are Ember Deep at 60% with an Ember Edge border at
70% (success auto-dismisses after 4s, info holds until replaced); persistent is
the same colors with a close button and no timer; error is Scorch Deep at 60%
with a Scorch Edge border at 70% and a close button. **A banner carrying a fact
the operator still has to act on — a DNS command — is `persistent`, never
timed.**

An error banner may carry **one recovery action**, an Offer-geometry button
beside its close button, focused when the banner appears. Today that is only
Retry, after a site was removed but its container declaration was not retired.
The toast carries it rather than the dialog because the dialog has to close —
a modal makes everything beneath it inert, the toast included — and every call
that shows a new message clears the action, so an action can never outlive the
message it was offered with.

### Dialog

A native `<dialog>`, `min(420–460px, 100vw - 2rem)` wide, Hearth Lift, `1px`
Hairline, 10px radius, 24px padding, auto-margined to center, with a `black/60`
backdrop and a 150ms `modal-in` entrance (6px rise + fade) gated behind
`motion-safe:`. Closes on Escape, on the Cancel button, and on a click outside
the box measured against its bounding rect. The heading is an Eyebrow; the body
is 1rem Nunito with relaxed leading; actions are right-aligned with a 10px gap,
Cancel on the left.

The remove dialog is the system's model for a destructive confirmation: it names
the target in `<strong>`, lists the four steps **in the order they run** as a
two-column mono grid at 0.75rem, states in 0.75rem Smoke that a failed step stops
the ones after it, and only then offers the "also delete files" checkbox with the
exact path in mono beside it — offered only where the directory exists. A
Next.js site that still has a directory from before site resources adds a
Scorch warning box that deleting files will not stop a container started from
them. An attached site adds a fifth step, retiring its declaration, and a Smoke
line beneath the stop-on-failure sentence saying that step five is the one that
stops the container, and when.

## Do's and Don'ts

### Do:

- **Do** set every machine fact in DM Mono and every human sentence in Nunito.
  A path in Nunito is a bug.
- **Do** reserve Ember for what the operator can act on, and keep it under ~10%
  of any screen.
- **Do** give `starting`, `unknown`, `not deployed` and `awaiting image` the
  neutral Smoke tone. None of them is a failure.
- **Do** show a status word with every status color — the `●` and the tone are
  never the whole message.
- **Do** let long hostnames, paths, and commands break or scroll (`break-all`,
  or `overflow-x: auto` + `nowrap` for one-liners).
- **Do** put remediation beside the hop that reported the problem, not in a
  numbered step list.
- **Do** check a dim tone against both grounds before using it on text: 4.5:1
  on Hearth *and* Hearth Lift below 24px, 3:1 at or above it.
- **Do** keep the shared focus ring: 2px Ember, 2px offset, `:focus-visible`.
- **Do** gate every transition and the dialog entrance behind `motion-safe:`.
- **Do** state a destructive flow's steps in execution order, and say outright
  that a failed step stops the rest.
- **Do** keep the copy-button fallback that selects text when
  `navigator.clipboard` is unavailable — over plain HTTP it always is.

### Don't:

- **Don't** fold, cap, truncate, or add an inner scrollbar to content the
  operator might read. One operator, one wide viewport. The two named folds
  are The Show-It Rule's: a finished host action's log, and a finished
  runbook step, at rest; its named scroll boxes are the rail, the find
  panel's list, and the activity tables below their width.
- **Don't** use Poetsen One anywhere except the wordmark, and never above
  1.5rem or at a weight it doesn't ship.
- **Don't** fill a destructive button with Ember or make it the largest control
  on screen — Scorch outline, one size down.
- **Don't** introduce a second accent hue, a gradient, or a chart. This app has
  no metrics to visualize.
- **Don't** add a shadow to a card, a pill, or anything else sitting in normal
  document flow.
- **Don't** put a status color on prose, a heading, or a background behind a
  sentence — status colors belong to pills, sub-lines, and error surfaces.
- **Don't** use uppercase for emphasis inside a sentence; it marks structure
  only.
- **Don't** put a status mark back on the rail's site rows or host links. The
  rail carries one health mark, the `overview` signal, and the overview page
  carries the rest.
- **Don't** show a live-looking indicator for something nothing checks. Hop 1
  never carries live state; every indicator on hops 2–4 is something actually
  checked, not invented health.
- **Don't** auto-dismiss a banner that carries an unfinished manual action.
- **Don't** drift toward the dark-SaaS-dashboard look (violet gradients,
  glassmorphism, KPI tiles — the overview's strip is count lines, per The
  Count-Line Rule) or toward terminal cosplay (scanlines, ASCII
  borders, green-on-black, faux boot logs).
