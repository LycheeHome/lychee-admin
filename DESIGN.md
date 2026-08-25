---
name: lyly-admin
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
    fontFamily: "Poetsen One, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
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
  type-pill:
    fontFamily: "DM Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.7rem"
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
  button-primary-hover:
    backgroundColor: "{colors.ember-light}"
    textColor: "{colors.hearth}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.smoke}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.scorch}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-danger-hover:
    backgroundColor: "{colors.scorch-rule}"
    textColor: "{colors.chalk}"
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
  site-card:
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
  pill-type-static:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
  pill-type-proxy:
    backgroundColor: "{colors.ember-deep}"
    textColor: "{colors.ember-light}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
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
---

# Design System: lyly-admin

## Overview

**Creative North Star: "The Warm Terminal"**

A console you would choose to sit in. Nearly every fact on screen is set in DM
Mono — hostnames, ports, paths, commands, service names, status words, even the
section labels — because nearly every fact came from a machine and will be
pasted back into one. Nunito carries only the sentences a person wrote. The
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
- Mono for machine facts, sans for human sentences; the split is absolute.
- Flat tonal layering at rest; shadow only as a response to state or float.
- Uppercase letterspaced micro-labels as the structural device.
- Nothing folded, capped, or truncated — one operator, one wide viewport.
- Poetsen One as a signature, twice, small.

## Colors

A warm dark palette: a single stone ramp doing all the structural work, one
rose accent for interaction, and two narrow status families that exist only to
carry a verdict.

### Primary

- **Ember** (`rose-400`): The only chromatic voice. Primary button fills, every
  focus ring in the app, the numerals beside manual steps, the checked
  reverse-proxy radio, and the "back to sites" link on the not-found page.
- **Ember Light** (`rose-300`): Ember's hover state on filled buttons, and the
  text color of the `proxy` type pill.
- **Ember Edge** (`rose-800`): Structural Ember — the hairline that appears on a
  site card's hover edge (at 70%), the border of the checked reverse-proxy
  option, and the 2px left rule marking the port/framework branch of the add
  form.
- **Ember Deep** (`rose-950`): The ground beneath Ember text — the `proxy` pill,
  the checked reverse-proxy option's fill (at 50%), and every non-error flash
  banner (at 60%).

### Neutral

- **Hearth** (`stone-900`): The page. Also every inset surface — text inputs,
  command blocks, the workflow block — so an input reads as a well cut into the
  card, not a raised object on it.
- **Hearth Lift** (`stone-800`): Cards, dialogs, and the copy button's rest
  state. One tonal step up from the page, and the only surface color.
- **Hairline** (`stone-700`): Borders on cards, dialogs, inputs and code blocks;
  the divider rule inside a card (`1px`); the fill of the `static` type pill and
  the neutral status pill; the hover fill of secondary buttons.
- **Hairline Strong** (`stone-600`): The one step where a border must be seen
  against Hairline — the secondary button's outline, the `static` pill's edge,
  and the arrows between routing hops.
- **Smoke Deep** (`stone-500`): Structure, not prose. Arrows between routing
  hops, the breadcrumb's `/`, and the trailing `.lyly.dev` of a hostname at
  Headline size. It measures 3.64:1 on Hearth and 3.16:1 on Hearth Lift, so it
  clears WCAG AA for large text and fails it for everything smaller — see The
  Dim-Text Rule.
- **Smoke** (`stone-400`): Secondary text. Every explanatory sentence, form
  label, and card eyebrow.
- **Smoke Light** (`stone-300`): Neutral status pill text — the `neutral` tone,
  carrying `starting`, `unknown` and `not deployed` — and the accent color
  of the static radio control.
- **Chalk** (`stone-50`): Primary text and every value that matters. Warm white,
  never `#fff`.

### Tertiary

Status verdicts, and nothing else. These two families never appear as
decoration, as a background for prose, or as an accent.

- **Clear** (`green-300`) on **Clear Deep** (`green-950` at 60%): the `ok` tone —
  `running`, `running · healthy`, `responding`.
- **Scorch** (`red-300`) on **Scorch Deep** (`red-950` at 60%): the `bad` tone —
  `unhealthy`, `exited`, `restarting · crash-looping`, `not responding` — plus
  the danger button's text and the Danger card's label. Every one of these is
  something that tried and failed; see the Three-Tone Status Rule for why
  `not deployed` is not among them.
- **Scorch Edge** (`red-400` at 70%): the border of an error banner or inline
  error, where Scorch itself would not read against Scorch Deep.
- **Scorch Border** (`red-800`) / **Scorch Rule** (`red-900`): the danger
  button's outline and its hover fill; the Danger card's border (at 60%) over a
  Scorch Deep wash (at 20%).

### Named Rules

**The Ember Is Interactive Rule.** Ember and its family mark what you can act
on — buttons, focus rings, the checked option, step numerals, a card's hover
edge — plus the one label that means "something else runs here" (the `proxy`
pill). It never colors a heading, a body sentence, or a value you can only
read. On any given screen it covers well under 10% of the pixels, and that
rarity is what makes a primary button unmissable.

**The Three-Tone Status Rule.** Site state resolves to exactly three tones:
Clear, Scorch, or Smoke. `starting`, `unknown` and `not deployed` are **Smoke,
never Scorch** — a container still running its first health check is not broken,
a status we failed to read is not evidence that anything is down, and a
container that was never created (or was deliberately taken down) has not
crashed. Scorch is reserved for something that tried and failed, so that red
keeps meaning "this needs you now": a site that has simply never been deployed
must not look like one that died. Never invent a fourth tone, and never let a
tone appear without the canonical status word beside it — that second clause is
what makes the first safe, because the word carries which state it is while the
tone carries only how bad it is. `not deployed` and `unknown` share Smoke and
stay unambiguous.

**The Dim-Text Rule.** Dim text is Smoke, not Smoke Deep. Smoke Deep carries
readable text in exactly one place — the `.lyly.dev` suffix on a detail page's
Headline, which at 27px is WCAG large text and clears the 3:1 that applies
there. At any smaller size it fails the 4.5:1 that applies instead (3.16:1 on a
card), so every label, key, caption, and hop sub-line takes Smoke. When a new
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
rounded, warm, slightly toy-like face used twice, at small sizes, where the app
says its own name and names a site.

### Hierarchy

- **Display** (Poetsen One, 1.5rem, tracking 0.025em): The wordmark only —
  `lyly` + an Ember period + `admin`.
- **Headline** (DM Mono, 1.7rem, line-height 1.2, tracking -0.01em): A site's
  hostname on its detail page, with the shared `.lyly.dev` suffix dropped to
  Smoke Deep so the subdomain reads first — legible there because 27px is large
  text, and nowhere else. Slight negative tracking because mono at display size
  otherwise sprawls.
- **Title** (Poetsen One, 1rem, line-height 1.625): A site card's hostname in
  the list. The only other place the display face appears.
- **Eyebrow** (DM Mono, 0.85rem, weight 500, uppercase, tracking 0.08em, Smoke):
  Section and dialog headings — "Sites", "Add a site", "Remove site".
- **Label** (DM Mono, 0.75rem, weight 500, uppercase, tracking 0.1em, Smoke Light):
  Card headings inside the detail page — "Request path", "Manual steps",
  "Deploy", "Danger".
- **Micro-label** (DM Mono, 0.6875rem, weight 500, uppercase, tracking 0.09em,
  Smoke): The label above a routing hop. The smallest type in the system, so it
  gets the brightest of the dim tones, not the dimmest. 0.6875rem is exactly
  11px — the floor below which small UI text stops being reliably legible.
- **Body** (Nunito, 0.8rem, line-height 1.375, Smoke): Every explanatory
  sentence. Longer prose sits inside cards no wider than 760px, which keeps it
  near 70ch. Dialog paragraphs step up to 1rem with relaxed leading.
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
DM Mono. If a person wrote it as a sentence, it is Nunito. There is no third
case, and no sentence sets a path in Nunito.

**The Signature-Twice Rule.** Poetsen One appears in exactly two places: the
wordmark and a site card's hostname. It is never a page heading, never above
1.5rem, never body copy, and never used for emphasis. The family also ships a
single weight — do not request 600 and let the browser synthesize it.

**The Uppercase-Is-Structural Rule.** Uppercase with letterspacing marks
structure, never emphasis inside prose. Tracking widens as size shrinks
(0.85rem/0.08em → 0.75rem/0.1em → 0.6875rem/0.09em) so the smallest labels stay
readable. Emphasis inside a sentence uses Chalk against Smoke, or `<strong>`,
not caps.

## Layout

Two containers, chosen by what the page is for. The site list runs to 1080px and
fills it with an auto-fill grid of cards (`minmax(280px, 1fr)`, 20px gutters), so
a wider window means more sites per row. A site's detail page caps at 760px and
stays one column, because everything on it is either a sentence to read or a
command to copy, and neither improves at 1200px.

The page ground has 24px of horizontal padding and a 64px-tall header band
(32px of content height under 16px top and bottom padding) holding the wordmark
and the two host-level nav items, aligned to the same 1080px container as the
content below it; content starts below it with 24px gaps between sections.
Content width equals viewport width, so `sm` (640px) means what it says.
Inside a card, the rhythm is 20px padding (24px on site cards and dialogs), a
12px gap between a label and its content, and a `1px` Hairline rule
with 16px of air on both sides wherever one card holds two kinds of content —
the request path's hops and its detail rows, or the Deploy workflow and what the
image bakes in.

The only breakpoint in the system is `sm` (640px). Below it, the routing hop
chain turns from a row of four hops separated by `→` into a stacked column
separated by `↓`, and the remove dialog's four-step list collapses from two
columns to one. That is not a mobile design — PRODUCT.md records this as a
desktop-only tool — it is the floor that keeps a narrow window honest.

Spacing steps in use: 6px, 8px, 10px, 12px, 14px, 16px, 20px, 24px. Nothing in
between, and nothing above 24px except the header band.

### Named Rules

**The Show-It Rule.** There is one operator and one wide viewport, so content is
never folded, capped, truncated with an ellipsis, or put inside an inner scroll
box. A generated workflow file renders at full height. The single exception is
horizontal overflow on a one-line command, which must not wrap: `overflow-x:
auto` with `white-space: nowrap`. Long values wrap by breaking characters
(`break-all`), never by being cut.

**The Width-Follows-Purpose Rule.** 1080px for a grid of things you are choosing
between; 760px for one thing you are reading and acting on. A wider viewport
adds columns, never line length.

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
differently, it shifts a border color instead (a site card's edge goes Ember
Edge on hover), and that remains the lighter-touch option to reach for first.

### Shadow Vocabulary

- **Overlay** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px
  rgba(0,0,0,0.4)`): Elements fixed above the page — the flash banner. Nothing
  in normal document flow gets this.
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
at: **10px** for a surface that contains other things (card, dialog, site card,
the Danger panel), **6px** for a control or a container of text you act on
(button, input, select, command block, copy button, inline error), **4px** for
inline code inside a sentence, and **fully round** for anything stating a single
word or numeral (type pills, status pills, the 1.2rem step numerals).

Borders are `1px` everywhere. The one deliberate exception is the add-site form's
conditional branch — the port, framework, and healthcheck fields sit behind a
`2px` Ember Edge left rule with 12px of padding, which is the only place in the
system where a border carries meaning rather than edge definition.

Icons are 24×24 stroked line icons at `1em`, `stroke-width: 2`, round caps and
joins, inheriting `currentColor` — plus, trash, clipboard, check, external link.
Status is marked by a `●` glyph inside the pill, not by an icon. Nothing in the
system is filled, gradient-filled, or beveled.

### Named Rules

**The Radius-Says-Size Rule.** 10px contains, 6px is controlled, 4px is inline,
round states one word. A new component takes the step matching its role — never a
value between steps, and never a large radius to look friendlier.

## Components

### Buttons

- **Shape:** Softly squared (6px radius), always `inline-flex` with a 6px gap so
  a 1em icon sits on the text baseline without extra markup.
- **Primary:** Ember fill, Hearth text, semibold Nunito at 0.875rem, 16px × 10px
  padding. Used once per view for its one forward action — "Add site", "Visit".
  Hover goes Ember Light.
- **Secondary:** Transparent with a Hairline Strong outline and Smoke text, same
  size as primary. Hover fills Hairline and brings text to Chalk. Always the
  cancel side of a dialog.
- **Danger:** Transparent with a Scorch Border outline and Scorch text, one step
  smaller (0.8rem, 12px × 6px padding) — a destructive action is never the
  largest button on screen. Hover fills Scorch Rule with Chalk text.
- **Disabled:** Smoke Deep text and `cursor: not-allowed`, with the outline
  dropped to Hairline on the outlined buttons and the Ember fill taken to 40% on
  the primary. **Tone, never opacity** — this system says "not actionable" by
  going dim in the palette, the same way `starting` and `not deployed` say "not
  a failure". A blanket `opacity` would fade the border and text together at a
  rate the palette never chose, and nothing else here uses transparency as a
  signal. Disabled is a real state on this app's buttons, not a theoretical one:
  both mutating flows disable their confirm control for the length of a service
  restart, and the sighted operator needs to see that their click landed.
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
- **Internal Padding:** 20px for detail cards, 24px for site cards and dialogs.
- **Site card behavior:** The whole card is one `<a>`, undecorated, laid out as a
  column with 14px gaps: hostname (Title face) and type pill on the first row,
  the path or `localhost:<port>` beneath in Data. Hover moves the border to Ember
  Edge at 70% over a 150ms color transition, gated behind `motion-safe:`.

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
  title's text. Checked state uses `:has(:checked)` — the static row goes
  Hairline fill with a Hairline Strong border; the proxy row goes Ember Deep at
  50% with an Ember Edge border, and its radio's `accent-color` is Ember.
- **Error:** Inline errors are 0.8rem Scorch. A form-level error is Scorch on
  Scorch Deep at 60% with a Scorch Edge border at 70%, 6px radius, hidden until
  it has text.

### Pills

- **Type pills** (`static` / `proxy`): 0.7rem mono, uppercase, tracking 0.06em,
  4px × 10px, fully round. `static` is Chalk on Hairline with a Hairline Strong
  edge; `proxy` is Ember Light on Ember Deep with no visible edge — the state
  that means "a process runs here" is the one that carries color.
- **Status pills:** 0.6875rem mono, uppercase, tracking 0.06em, prefixed with a
  decorative `●` that is `aria-hidden` so it never joins the accessible name,
  fully round, and colored by tone only: Clear on Clear Deep, Scorch on Scorch
  Deep, or Smoke Light on Hairline. `shrink-0`, because a status must never
  compress to fit a long hostname.

### Navigation

Two tiers, each scoped to what it navigates.

**The header band** is a 1080px centred band with no background and no bottom
rule, aligned to the same container as the content below it: the
`lyly.admin` wordmark as a home link at Display 1.5rem, then flat items —
`sites` and `add site` — at 0.85rem mono, Smoke going Chalk on hover.
`aria-current="page"` is both the accessibility signal and the
styling hook (the arbitrary `aria-[current=page]:` variant, since Tailwind ships
no built-in one): Chalk text on a Hairline fill with a 2px Ember Edge left rule
— deliberately not the `proxy` pill's Ember fill, so a nav item and a type pill
never look alike. A header item's destination never changes with location, so
`/sites/:hostname` marks neither item current; the breadcrumb carries the
location instead.

**The breadcrumb's hostname dropdown**, on the detail page only: a `<details>`
disclosure over the breadcrumb's hostname, opening a 10px-radius panel listing
every managed site with a `static`/`:<port>` hint and no status (a status check
per row would mean N checks on every detail-page load instead of the list
page's one page, N checks). No truncation anywhere, including the long-hostname
case. `max-h-[70vh]` is the floating-panel exception to The Show-It Rule — a
panel taller than the viewport cannot be reached regardless.

Per-site tabs are deferred until a second tall, task-specific section exists
alongside Deploy (most likely container logs); one such section does not make
a tab strip.

### Command Block (signature component)

The most-used component in the app and the reason several other values are what
they are. A `<pre>` at Code size on Hearth with a Hairline border and 6px radius,
`overflow-x: auto` and `white-space: nowrap` so a long command scrolls rather
than wraps, with a copy button absolutely positioned inside it. An optional
caption beneath in 0.72rem Smoke names the directory the command must run in
(`in /var/www/app.lyly.dev/`) — a value you have to read, so it is not dimmed
below Smoke.

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

### Routing Hop Chain (signature component)

The component that states this app's whole thesis: a request's path as four
labelled stages — Cloudflare DNS → the sites tunnel → Caddy → your files or your
app. Each hop is a Micro-label above a Data value above an optional 0.72rem
sub-line (Smoke by default, tone-colored when it carries live state).
Separators are Hairline Strong arrows that flip from `→` to `↓` below `sm`, and
are `aria-hidden`.

Only the last hop is ever live. The first three carry derived values — a
hostname, a service name over its config directory — and hop one's sub-line
reads `manual step`, permanently, rather than a DNS status that would go stale
the moment a record is created. When the last hop is in a `bad` tone, the
remediation appears *inside this card*, directly beneath the chain, as a command
block — never as a numbered step that appears and disappears with container
state.

### Flash Banner

Fixed 24px from the top, centered, `min(480px, 100vw - 2rem)` wide, mono at
0.85rem Chalk, 6px radius, the Overlay shadow, and `role="status"` with
`aria-live="polite"`. Four kinds, and the kind determines both color and
dismissal: success and info are Ember Deep at 60% with an Ember Edge border at
70% (success auto-dismisses after 4s, info holds until replaced); persistent is
the same colors with a close button and no timer; error is Scorch Deep at 60%
with a Scorch Edge border at 70% and a close button. **A banner carrying a fact
the operator still has to act on — a DNS command, a scaffold path — is
`persistent`, never timed.**

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
exact path in mono beside it. A scaffolded site adds a Scorch warning box that
deleting files will not stop a running container.

## Do's and Don'ts

### Do:

- **Do** set every machine fact in DM Mono and every human sentence in Nunito.
  A path in Nunito is a bug.
- **Do** reserve Ember for what the operator can act on, and keep it under ~10%
  of any screen.
- **Do** give `starting`, `unknown` and `not deployed` the neutral Smoke tone.
  None of them is a failure.
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
  operator might read. One operator, one wide viewport.
- **Don't** use Poetsen One anywhere except the wordmark and a site card's
  hostname, and never above 1.5rem or at a weight it doesn't ship.
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
- **Don't** show a live-looking indicator for something nothing checks. Hops
  1–3 carry derived values and `manual step`, not invented health.
- **Don't** auto-dismiss a banner that carries an unfinished manual action.
- **Don't** drift toward the dark-SaaS-dashboard look (violet gradients,
  glassmorphism, KPI tiles) or toward terminal cosplay (scanlines, ASCII
  borders, green-on-black, faux boot logs).
