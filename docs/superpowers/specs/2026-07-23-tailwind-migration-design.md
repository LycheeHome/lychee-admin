# Tailwind CSS migration — design

## Goal

Replace the hand-rolled `public/style.css` (451 lines, custom dark theme) with
Tailwind CSS utility classes across all server-rendered views, so future UI
work has a consistent, low-friction styling system instead of hand-written
CSS. This is a full restyle: the current custom color palette, spacing, and
component classes (`.site-card`, `.badge`, `.panel`, `.modal`, etc.) are
replaced, not preserved.

## Build setup

- Add `tailwindcss` (v4) as the only new styling devDependency. No
  `postcss`, `autoprefixer`, or `postcss.config.js` — Tailwind v4's CLI
  handles prefixing, minification (`--minify`), and CSS nesting natively, and
  nothing else on the current feature list needs a PostCSS plugin Tailwind
  doesn't already cover.
- Add `concurrently` as a devDependency, used only to run `tsx watch` and
  `tailwindcss --watch` side by side in `npm run dev`.
- New entry file `src/styles/tailwind.css`:
  ```css
  @import "tailwindcss";

  @theme {
    /* rose/stone lychee-toned accent aliases, e.g. --color-lychee-* */
  }
  ```
- npm scripts:
  - `build:css`: `tailwindcss -i src/styles/tailwind.css -o public/style.css --minify`
  - `dev`: `concurrently -n tsx,css "tsx watch src/server.ts" "tailwindcss -i src/styles/tailwind.css -o public/style.css --watch"`
  - `build`: `npm run build:css && tsc -p tsconfig.json`

## Generated CSS is a build artifact

`public/style.css` stops being hand-edited. It's added to `.gitignore` and
the currently-committed version is deleted from the repo. `npm run build`
(used by CI/deploy) and `npm run dev` (used locally) both regenerate it, so
it's never stale in a way that matters, and it's never manually edited again.

## Visual direction

Dark theme, reset from the current custom palette to Tailwind's default
`stone` scale (`stone-800/900/950`) as the neutral base, with `rose-400` as
the single accent color (buttons, links, badges, focus rings) — chosen to
evoke lychee's pink/brown skin tones, decided via visual mockup comparison
during brainstorming (option "C2": warm stone base + rose-400 accent, vs.
cooler zinc-base and lime-accent alternatives that were rejected).

Site-type badges (static/proxy) get distinct muted tones within this
palette (e.g. `stone-700` vs. a `rose-950`/`rose-300` pairing) rather than
the current ad hoc green/blue.

Fonts are unchanged: Poetsen One (header) and Nunito (body) stay, loaded via
the existing Google Fonts `<link>` tags in `layout()` — this is the one
piece of the current design that is *not* reset to Tailwind defaults.

## Markup migration

`src/views/html.ts` (184 lines) is rewritten in place: every custom CSS
class currently referenced there (`.site-card`, `.badge`, `.panel`,
`.modal`, `.delete-form`, `.section-head`, etc.) is replaced with equivalent
Tailwind utility classes applied directly to the elements. Layout,
structure, and behavior (the `<dialog>`-based add-site modal, forms, icons)
are unchanged — this is a class-attribute and color-token swap, not a
redesign of what's on the page beyond the palette change described above.

`public/app.js` is untouched — no behavioral logic changes. It selects
elements via `.delete-form`, `dialog.modal`, and several `data-*` attributes
(`data-open-dialog`, `data-close-dialog`, `input[name="type"]`). The
`data-*` selectors are unaffected by the restyle. `.delete-form` and
`dialog.modal` are the two CSS class names `app.js` depends on directly, so
`html.ts` keeps emitting those two class names as-is (alongside whatever
Tailwind utility classes style the same elements) — they're behavioral hooks
now, not styling classes, and must not be renamed or removed during the
migration.

`public/style.css`'s current 451 lines of hand-rolled CSS are deleted
entirely, superseded by generated Tailwind output.

## Verification

No test suite currently covers views. Verification is:
- `npm run build` succeeds — both `tailwindcss` and `tsc` compile without
  error.
- `npm run typecheck` and `npm run lint` still pass (unaffected by this
  change in principle, but worth confirming since `html.ts` is being
  rewritten).
- Per standing project preference, `npm run dev` is not run by
  Claude — the user verifies the restyled UI themselves in a browser.

## Out of scope

- No change to `src/lib/*`, `src/routes/*`, `src/middleware/*`, or any
  server-side logic — this is a views/styling-only change.
- No new light-mode theme — the app stays dark-only, matching the current
  design and the approved mockup direction.
- No design-system documentation or component library beyond what's needed
  to restyle the existing three views (site list, add-site modal content,
  confirm-delete-files page) in `html.ts`.
