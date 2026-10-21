# Smoke sentences hold a readable measure

Date: 2026-10-21 · Source: critique re-run, runbook line length (`.impeccable/critique/2026-10-20T22-33-23Z__src-views.md`), routed through `/impeccable layout`. Chosen from a rendered comparison: variant **01 Capped measure** (<https://claude.ai/artifact/D3Bw1hB6jNwcb2FSLUzP9u>).

## Problem

A canvas measurement against `npm run dev:mock` shows that almost every Smoke sentence on a site detail page runs **119–128 characters per line** in the 760px column. That covers the runbook steps, both DNS-step paragraphs, the files step, What to check, and the card intros. The comfortable range is about 65–75.

Two things the current markup does make this worse:

- **The Danger paragraph** carries `max-w-[70ch]` and still runs about 95. A `ch` is the width of a zero, roughly 1.35× Nunito's average letter, so `70ch` holds about 95 letters.
- **The services board's failure line** runs 166 characters across the 1080px frame.

DESIGN.md's Body entry says "Longer prose sits inside cards no wider than 760px, which keeps it near 70ch." That claim is false.

## Goal

No Smoke sentence runs past about 75 characters per line, on any page. Mono content (commands, code blocks, fact rows, the request-path chain, gate strings) keeps its full width.

## Decisions

### 1. One measure

`src/views/shared.ts` gains:

```ts
export const PROSE_MEASURE = "max-w-[25rem]";
```

Its comment says three things:

- 25rem holds about 70 characters of Nunito at 0.8rem.
- The measure is in rem, not `ch`, because a `ch` is a zero's width.
- The 760px card keeps its width, so mono content beside the prose stays full width.

### 2. Every Smoke paragraph carries it

Every `<p>` whose class combines `text-stone-400` and `text-[0.8rem]` (Smoke Body) and is not `font-mono` gets `PROSE_MEASURE`:

- the two constants in `src/views/html.ts`: `BODY` and `STEP_TEXT`;
- every inline paragraph that spells the same classes out by hand. Today these are:
  - the add-site preview's empty-state line;
  - a manual step's `then.note`;
  - "Nothing on this page does these for you.";
  - the Danger paragraph, whose `max-w-[70ch]` is replaced.

Prefer composing from `BODY`/`STEP_TEXT` where the classes are otherwise identical. Paragraphs built from other constants (the services board's failure line among them) get it wherever their class string is defined.

Unchanged:

- mono paragraphs;
- flex rows that hold spans and controls (the offer line, the requested line, the prune line);
- code and command blocks;
- the request-path chain.

### 3. A guard against regressions

A test renders the site detail page for:

- a static site;
- a plain proxy that isn't responding;
- an unattached Next.js site (the full runbook, Manual steps, Danger);
- an awaiting-image site with a tag on offer;
- a failed first deploy;
- a running site with a newer tag on offer;
- a retired declaration.

It also renders the services board with a failed row, and the add-site page. On every rendered page, every `<p …>` opening tag whose class attribute contains both `text-stone-400` and `text-[0.8rem]` and does not contain `font-mono` must contain `max-w-[25rem]`. Any new paragraph that copies the Smoke classes without the measure then fails the build.

## Documentation

- **DESIGN.md**: the **Body** entry replaces "Longer prose sits inside cards no wider than 760px, which keeps it near 70ch." with this: every Body sentence is capped at 25rem, about 70 characters at 0.8rem; the card keeps its 760px width, and mono content beside it stays full width; the measure is in rem because a `ch` is a zero's width, which holds about 95 Nunito letters at `70ch`.
- **Sidecar** (`.impeccable/design.json`): the matching typography or Body description, if it repeats the 760px/70ch claim. If the edited DESIGN.md text sits inside a named rule, re-derive `narrative.rules` and verify zero drift.

## Testing

- The guard test in §3, in `src/views/html.test.ts`.
- A test that `PROSE_MEASURE` equals `max-w-[25rem]` and that `BODY` and `STEP_TEXT` include it.
- Re-run the line-length measurement against `npm run dev:mock`: the canvas average-letter method over every non-mono paragraph of 60 or more characters, at a 1440px viewport. Pages:
  - `/sites/legacy.lychee.land`
  - `/sites/broken.lychee.land`
  - `/sites/blog.lychee.land`
  - `/sites/api.lychee.land`
  - `/services`

  Expect no paragraph over 75 characters per line.
- `npm run typecheck`, `lint`, `test` and `build`, and run the detector by hand on `src/views`.

## Out of scope

- Body's size (0.8rem stays; variant 02 was not chosen).
- Card structure (variants 03 and 04 were not chosen).
- Dialog paragraphs (1rem, relaxed) and the add-site field hints (0.75rem).
