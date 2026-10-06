---
name: comparing-design-variants
description: Use when a lyly-admin UI or UX decision has more than one reasonable answer — layout, density, list vs grid, component shape, a new surface, a restyle — or when the user asks for references, Mobbin precedents, prior art, mockups, options, variants, or versions to pick between.
---

# Comparing design variants

## Overview

lyly-admin UI decisions are made from rendered comparisons, not from prose. Describing two layouts hides the exact trade-offs a picture makes obvious: the 2026-08-25 sites-list change (card grid to row list) turned on misaligned status pills that no written description had surfaced.

This runs alongside `impeccable`, which still owns the visual system. `DESIGN.md` and `.impeccable/design.json` stay normative — this skill feeds their tokens into the variants rather than reopening their decisions.

## The deliverable

One published Artifact containing, in this order:

1. **Reference row** — 4-8 Mobbin screens, each cited as a markdown link to its `mobbin_url`, with one line naming the specific move being borrowed. Not "clean and modern"; "status sits in the left gutter so the hostname column stays flush".
2. **Four variants**, numbered and named (`01 Ledger`, `02 Manifest`, ...), each rendered in real markup.
3. **One labelled control** — the current implementation, screenshotted live, not reconstructed from memory.
4. **A cost line per variant**, stated as plainly as its benefit. A variant with no stated cost is unfinished.
5. **Implicit decisions, named.** Any choice a mock made silently — a dropped type pill, a changed truncation, a lost affordance — gets its own line so the pick cannot smuggle it in.

Then one question asking which to build. The set is the answer; a recommendation does not replace it.

## Getting the inputs right

**References.** `mcp__mobbin__search_screens` with `platform: "web"`, `mode: "deep"`, `limit: 6`. One query per question, describing a single screen in plain language — the elements and how they relate. Search separately rather than combining intents; skip negations and style adjectives. Read the returned images, since metadata alone does not tell you what a screen does. Keep `task_intent` identical across every call for one decision.

**Tokens.** The real ones: `colors` and `typography` from `DESIGN.md` frontmatter, tonal ramps/shadows/motion from `.impeccable/design.json`, Tailwind class constants from `src/views/shared.ts`. Variants in stand-in greys prove nothing about a warm-terminal palette.

**Data.** The actual seed sites from `src/dev/seed.ts` — `lyly.dev` and `blog.lyly.dev` (static), `api.lyly.dev:4000` (plain proxy), `app.lyly.dev:3200` (Next.js, attached, running `0.2.0` with `0.3.0` on offer), `preview.lyly.dev:3100` (Next.js, attached, awaiting its first image with `0.1.0` on offer), `legacy.lyly.dev:3001` (Next.js, no healthcheck, unattached). Never `example.com` or `Site One`. That mixed static/proxy/framework spread is what makes a weak layout visibly fail.

**Control shot.** `npm run dev:mock`, then Playwright to `http://127.0.0.1:8787` with basic auth `dev`/`dev`, and screenshot the real surface.

Load `artifact-design` before writing the Artifact file, as every artifact requires.

## Quick reference

| Input | Source |
|---|---|
| References | `mcp__mobbin__search_screens` — web, deep, limit 6 |
| Palette, typography | `DESIGN.md` frontmatter |
| Ramps, shadows, motion | `.impeccable/design.json` |
| Tailwind class constants | `src/views/shared.ts` |
| Site data | `src/dev/seed.ts` |
| Control screenshot | `npm run dev:mock` → `127.0.0.1:8787`, `dev`/`dev` |

## Common mistakes

- **Sketches instead of markup.** A boxes-and-labels wireframe cannot show a pill misaligning.
- **Four variants that differ only in spacing.** Four options should encode four different answers to the question, not one answer at four sizes.
- **No control.** A comparison with nothing to compare against is a moodboard.
- **Skipping the Mobbin pass because the answer seems obvious.** The reference row is where the non-obvious option comes from.
- **Folding, capping or truncating content to fit variants on screen.** This is a single-operator desktop page; show full content.
