# Add site migration: sub-project 6 of the SPA migration

Date: 2026-10-23

## Decision record

Three decisions came out of brainstorming. The design sections were then approved one at a time in conversation.

- **Scope B: the add-site page, and `app.js` deleted.**
  - The page moves to React with output and behaviour parity.
  - The last shared pieces of `public/app.js` (copy buttons, the page notice's close, the toast's close) move into the client bundle, and `app.js` is deleted.
  - Retiring the server-rendered shell (`layout()`, `rail.ts`) is a separate, final sub-project.
- **A successful add ends in a full load of `/sites/<host>?created=1`.**
  - The `created` notice keeps one owner, the server.
  - Only a fresh document gets the new site's rail row, because the rail's site list comes from the server-drawn shell.
- **A read endpoint, React state, dual-run parity.** The page reads its facts from `GET /api/sites/new`, and `app.js`'s decisions move into a tested client module. Because most of this page is behaviour, parity is proven by running the real `app.js` against the server's markup and the React page through the same interactions, before either is deleted.

## Why

`/sites/new` is the last page the server draws, and `app.js` is now almost entirely its script. Until both move, the add page is a full load from everywhere, it is the one place two scripts share a document, and the toast keeps two implementations held together by a test.

## Goal

- `/sites/new` is a client route whose output and behaviour match today's page and script.
- `public/app.js`, `renderAddSite`, `renderErrorPage` and `src/views/html.ts` are deleted.
- No page loads a script other than the client bundle.

## Non-goals

- **Any visual, copy or behaviour change** to the add page, its preview or its submit.
- **Changing `POST /sites` or `POST /sites/preview`.**
- **Retiring the server-rendered shell or the rail's server renderer.**
- **A client-drawn `created` notice.**

## Decisions

### 1. Route

- **Client route.** `/sites/new` becomes a client route rendered by `AddSitePage`. It replaces the router's `{ path: "/sites/new", Component: Nothing }` and stays registered before `/sites/:hostname`. `isClientRoute("/sites/new")` is true.
- **Router moves.** The list's Add site button, the empty state's "Add your first site", the page's Cancel and its breadcrumb become router moves.
- **On arrival:**
  - the title becomes `Add a site`;
  - no rail row is marked current;
  - focus moves to the headline, unless focus is in a wide-screen `#find`.
- **Express:**
  - `GET /sites/new` answers with the client shell (`data-page="add-site"`, title `Add a site`).
  - Without client assets it answers `500` "client bundle missing; run npm run build".
  - An unreadable Caddyfile answers `200`, and the page shows the error with the shared `CaddyfileError` body, as `/` and the site page do.

### 2. `GET /api/sites/new`

- **Response:** `ApiOk<AddSitePayload>`:

  ```
  { domain: string, portOwners: Record<string, string>, paths: { caddyfilePath, tunnelConfigPath },
    steps: { id: string; label: string }[], caddyfileError: string | null }
  ```

  - `portOwners` is today's `computePortOwners(sites)`.
  - `steps` is `ADD_STEPS`.
- **Unreadable Caddyfile:** `200` with `caddyfileError` set to the message today's `500` page shows (`CommandError` message plus stderr, or `String(error)`).
- **Refresh:** `?refresh=1` runs `refreshDeclarations` first, as today's GET does, so the preview and submit check fresh port claims. Only the route loader sends it, and there is no polling.
- **Auth:** behind basic auth and `sameOrigin`.

### 3. Behaviour (ported from `app.js` with its strings, timing and order)

- **Headline.**
  - It shows `composeHostname(field)` as the field changes.
  - When the hostname ends in `.<domain>` and is longer than it, the label is plain and the suffix is a `text-stone-500` span.
  - An empty hostname reads `Add a site`.
- **Type.** Reverse proxy:
  - shows the port block with inline `display: flex` (`none` otherwise);
  - makes the port field required and enabled (disabled otherwise);
  - re-checks the port.
- **Port.** A port in `portOwners` sets the field's custom validity and shows the owner sentence in `#port-error`. Any other port clears both.
- **Framework.** Next.js:
  - shows the healthcheck field with inline `display: flex`;
  - swaps `#type-proxy-description` for `#type-proxy-description-nextjs`;
  - points the proxy radio's `aria-describedby` at the visible one.
- **Preview.**
  - **When it runs.**
    - Any change to hostname, type, port, framework or healthcheck schedules `POST /sites/preview` after 250 ms. One also runs on arrival.
    - The body is `hostname` (composed), `type`, `port`, `framework` and `healthcheckPath`, trimmed.
    - Each request takes a sequence number, and an answer older than the newest request is dropped.
  - **Ready.**
    - The panel renders the Caddy, tunnel and (when present) files sections, with `contextAfter` muted.
    - Steps whose `willRun` is false are marked "—".
    - `#preview-error` hides and submit unblocks.
  - **Error.**
    - `#preview-error` shows the message.
    - The panel reads "Fix the problem above and the block appears here.", and the marks reset.
    - Submit gets `aria-disabled="true"` and `preview-error` in its `aria-describedby`.
  - **Neither.** The panel returns to its at-rest content, the marks reset, and submit unblocks.
  - **Failures.** A non-ok status or a network failure unblocks submit and leaves the panel unchanged.
  - **Scheduling.** A new schedule unblocks submit first. Leaving the page cancels a pending timer.
- **Submit.**
  - **Blocked.** While blocked it focuses `#preview-error` and sends nothing.
  - **Empty hostname.** The marks reset, and `#add-site-error` reads "Enter a hostname.".
  - **Second submit.** A synchronous in-flight guard stops it.
  - **On send:**
    - the marks reset;
    - `#add-site-error` hides;
    - the button disables;
    - the toast reads `Adding <host> — reloading Caddy and restarting cloudflared-sites…`.
  - **Failure:**
    - the steps are marked from the response's `steps`;
    - the toast hides and the button re-enables;
    - `#add-site-error` shows the error, falling back to `Failed to add site`;
    - the preview re-runs.
  - **Success.** A full load of `/sites/<encoded hostname>?created=1`.
- **`pageshow` with `persisted`.** The in-flight flag clears, the button re-enables, the toast hides and the preview re-runs.
- **Logic module.** The decisions live in a node-free `src/client/addSiteModel.ts`, with unit tests. It covers:
  - `composeHostname` and the headline's parts;
  - the port message;
  - field visibility;
  - how a preview payload becomes panel sections;
  - how marks come from steps.

### 4. Leaving `app.js`

- **Copy buttons.**
  - The `document` click listener for `[data-copy-target]` moves into the client, installed once by `mountApp`.
  - It keeps the `aria-label` swaps, the `#copy-status` text and the icon toggles.
  - It keeps the 1,500 ms reset and the select-text fallback when the clipboard write fails.
- **Notice close.** `#page-notice-close` removes `#page-notice`, bound by the client.
- **Toast close.** `#flash-banner-close` hides the toast, bound by the client.
  - `src/client/toast.ts` becomes the toast's only implementation.
  - `toast.test.ts` stops comparing it with `showBanner` and tests its own behaviour: tones, the 4,000 ms success dismissal, the action button, and close.
- **Script tag.** `layout()` stops emitting the `app.js` `<script>`, and `public/app.js` is deleted.
- **References.** Every reference is updated: shell tests, CLAUDE.md, and the Tailwind source comment about `app.js` adding classes at runtime.
- **Tailwind.** The `public` `@source` is kept or narrowed only so that `public/style.css` builds byte-identical, or with every difference explained.
- **No bundle.** Every page is a client route. A missing bundle answers the existing `500` on each, so no page remains that loads without it.

### 5. Retiring the server page

In order:

1. **Dual run.** Run the real `app.js` against `renderAddSite`'s markup and the React page through one script of steps (§ Testing), and assert parity at each step.
2. **Freeze.** Freeze the reference side's snapshots into `src/dev/fixtures/add-site/<step>.html`, checked byte-equal.
3. **Switch.** Point the tests at the fixtures. Each parity file ends with the check that every fixture is read.
4. **Delete.** Remove `renderAddSite`, `renderErrorPage`, `src/views/html.ts`, the server's HTML path for `/sites/new` and `public/app.js`.

## Scope

- **Server:**
  - `GET /api/sites/new`;
  - `GET /sites/new` serving the shell;
  - `layout()` dropping the script tag;
  - the deletions.
- **Client:**
  - `AddSitePage` with its loader;
  - the form, preview and submit components;
  - `addSiteModel.ts`;
  - the copy, notice-close and toast-close bindings;
  - router links to `/sites/new`.
- **Docs:** CLAUDE.md (the add page on React, `/api/sites/new`, no `app.js`, the fixtures, what the server still renders). DESIGN.md is unchanged.

## Testing

- **Dual-run parity.**
  - In happy-dom, the reference is `renderAddSite`'s live markup with the real `public/app.js` evaluated against it. The candidate is `AddSitePage` with the same payload. Both share one stubbed `fetch` with recorded preview and submit answers.
  - The steps:
    1. at rest;
    2. typing `blog`;
    3. typing a full `blog.lychee.land`;
    4. switching to reverse proxy;
    5. a claimed port, then a free one;
    6. Next.js, then a healthcheck path;
    7. a preview error, then a blocked submit;
    8. an empty submit;
    9. a failed submit with step marks;
    10. a stale preview answer arriving after a newer one;
    11. the `pageshow` restore.
  - After each step it compares:
    - `<main>` under `canonical()` and the strict inline-whitespace check;
    - the toast's state;
    - the submit button's attributes;
    - the `fetch` calls made;
    - the focused element.
- **Model:** unit tests for each `addSiteModel.ts` function.
- **API:**
  - the payload, with `portOwners` matching the seed;
  - `200` with `caddyfileError`;
  - `?refresh=1` pulls once, and a plain read never does;
  - `401` without credentials.
- **Router:**
  - list → `/sites/new` and the empty state → `/sites/new` make no document load;
  - Cancel and the breadcrumb return in-app;
  - the title follows and the headline gets focus;
  - leaving cancels a pending preview;
  - a successful submit makes a full load of `/sites/<host>?created=1`.
- **Shared bindings:**
  - copy success and failure;
  - the notice's close;
  - the toast's close.
- **Browser check** against `npm run dev:mock`:
  - `/sites/new` compared pixel for pixel against `main` at 1280 and 390px, at rest, with a static preview, and with a Next.js preview;
  - end-to-end adds of a static site and a Next.js site, each ending on its page with the notice;
  - a copy button and the notice's close on a site page.
- **Commands:** `npm run typecheck`, `lint`, `test` and `build`, plus the detector on `src/views src/client`.

## Risks

- **Will `app.js` run under happy-dom?** The dual run depends on it. If some part will not run there, the gap is recorded and that step's reference comes from a real browser via Playwright instead.
- **No script without the bundle.** Deleting `app.js` leaves a page without the bundle with no script at all. That is accepted, because every page's content needs the bundle already.
