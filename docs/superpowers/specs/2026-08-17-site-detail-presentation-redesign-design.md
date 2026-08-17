# Site detail page — presentation redesign (Spec A)

## Problem

`renderSiteDetail` (`src/views/html.ts`) has accumulated into a page that
under-uses the data it already has and offers nothing to do:

- **No affirmative action.** The only button is `Remove site`. The hostname is
  not a link anywhere in the app, so there is no way to reach the site the page
  is about.
- **Status is prose.** `renderContainerStatusLine` packs container lifecycle
  state, Docker's health verdict, and a remediation command into one sentence,
  with the command as `<br />`-separated small text inside a red paragraph.
- **Two vocabularies for one fact.** The header pill says `live` / `down` /
  `not deployed` while the Status card says `Running on localhost:3000. Healthy.`
- **Overview is a card wrapping one line.** Meanwhile `healthcheckPath` is
  visible *only* inside the failure message, so a healthy site never shows it,
  and nothing shows which tunnel carries the hostname.
- **The routing chain — the app's entire purpose — is never drawn.** Nothing
  conveys that a request goes Cloudflare DNS → `lychee-sites` tunnel → Caddy →
  `localhost:<port>`.
- **The DNS reminder is unrecoverable.** It flashes once in a banner after
  creation and is then gone forever, even though a missing DNS record leaves the
  site unreachable while this page still reports it healthy.
- **No hierarchy.** Overview, Status, and Deploy share one `DETAIL_CARD`
  constant, so volatile must-read status looks identical to reference material
  consulted twice a year.
- **`Remove site`** is a bare small red button floating at the bottom of the
  column with no separation from the content above it.
- **`--font-mono` is set to `"Nunito"`** (`src/styles/tailwind.css:6`) — a
  proportional face, loaded from Google Fonts and therefore winning over the
  `ui-monospace` fallbacks behind it. Every path, port, and shell command on a
  page made almost entirely of paths, ports, and shell commands renders
  proportionally. This is a bug, not a taste call.

## Goal

Rebuild the detail page's presentation so it states the routing chain, keeps
status in one vocabulary, surfaces the manual steps permanently, and offers the
actions you actually want — using only data the request handler already has.

This is **Spec A of two**. Spec A introduces no new routes, no new
`SystemCommands` methods, and no new privileged calls. Spec B (separate spec,
built after this lands) adds the parts that need new backend data: live state on
routing hops 1–3, a `checked at` timestamp with a Recheck control, and
per-hostname activity read from the audit log.

It supersedes parts of `2026-08-11-site-detail-page-redesign-design.md` — see
[Superseded decisions](#superseded-decisions).

## Design

### Typography and tokens

`src/styles/tailwind.css`:

```css
--font-mono: "DM Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
```

`DM+Mono:wght@300;400;500` joins the existing Google Fonts link in `layout()`.
DM Mono was chosen over JetBrains Mono, IBM Plex Mono, and Geist Mono because
it is geometric and quiet enough to leave Poetsen One as the page's only loud
voice, where Geist Mono in particular would import the exact register of the
Vercel/Railway dashboards this redesign was benchmarked against.

Two consequences of fixing a global token:

1. **The list page, add-site modal, flash banner, section labels, and error
   boxes all change appearance too**, since they use `font-mono`. This is the
   fix working as intended, but verification must cover the list page, not only
   the detail page.
2. **DM Mono tops out at weight 500.** Every existing `font-mono font-semibold`
   pairing would faux-bold, so `SECTION_LABEL`, the list page's section heading,
   and the dialog headings change from `font-semibold` to `font-medium`.

### Page structure

Single column, `max-w-[760px]` — up from today's `max-w-[640px]`, to give the
four-hop chain room without going two-column. Sections are omitted entirely when
they don't apply to the site.

```
sites / app.lyly.dev                                      ← breadcrumb
app.lyly.dev  [copy]                            [Visit ↗]
[proxy] [● running]
┌─ REQUEST PATH ───────────────────────────────────────┐
│  Cloudflare DNS → Tunnel → Caddy → Your app          │
│  ──────────────────────────────────────────────      │
│  framework / healthcheck / files                     │
└──────────────────────────────────────────────────────┘
┌─ MANUAL STEPS ───────────────────────────────────────┐
│  lyly-admin wires up routing only. These are yours.  │
│  ① DNS record            + copyable command          │
│  ② Build and start it    + copyable command          │
│  ③ Find out why it stopped  (bad states only)        │
└──────────────────────────────────────────────────────┘
▸ DEPLOY  (native <details>, closed by default)
┌─ DANGER ────────────────────────── [ Remove site ] ──┐
```

### Header

**Breadcrumb** replaces the `← Back to sites` text link: `sites / <hostname>`,
where `sites` links to `/` and the trailing hostname crumb is plain text, not a
link to the page you are already on. It deliberately does *not* start with a
`lyly.admin` crumb — `layout()` already renders that wordmark in the page
`<header>` directly above.

**Hostname** is set in `font-mono` at `text-[1.7rem]`, `leading-[1.2]`,
`tracking-[-0.01em]`, with the trailing `.<domain>` dimmed to `text-stone-500`
against a `text-stone-50` subdomain. Hostnames are structured data, and this is
the one typographic move on the page that none of the reference dashboards make.

**Apex rule:** dim the trailing `.<domain>` only when
`hostname.length > domain.length` and the hostname ends with `.<domain>`.
`lyly.dev` itself is a managed site (`isManagedHostname` admits `config.domain`,
and `src/dev/seed.ts` seeds it) and has no subdomain to split, so it renders
entirely bright.

**Copy button** sits beside the hostname, reusing the existing generic
`data-copy-target` handler with an `id` on the hostname element. Its two nested
spans concatenate to exactly the hostname under `textContent`, and the handler's
existing insecure-context fallback still applies — this app is served over plain
HTTP on the LAN, where `navigator.clipboard` is undefined.

**Pills** move to a second line below the hostname: the existing type pill
(`static` stone / `proxy` rose) followed by the state pill.

**Visit** is the primary action, top-right, linking to `https://<hostname>` with
`target="_blank" rel="noopener noreferrer"`.

### Request path card

Four hops separated by arrows, each carrying a hop label, a value, and a
sub-line:

| hop | label | value | sub-line |
|---|---|---|---|
| 1 | `Cloudflare DNS` | `<hostname>` | `manual step` |
| 2 | `Tunnel` | first 8 chars of `<tunnelId>` + `…` | `cloudflared-sites` |
| 3 | `Caddy` | `:80` | dirname of `<caddyfilePath>` |
| 4 | `Your app` (`Your files` for static sites) | see per-variant table | live state, see below |

Every hop value is derived, never asserted. Hop 2 shows the tunnel **ID** from
`config.tunnelId` and the service name `cloudflared-sites`, which
`restartCloudflared()` pins — the human-readable tunnel name `lychee-sites` is
not in config and must not be hardcoded into the view. When `config.tunnelId` is
empty, hop 2's value falls back to `cloudflared-sites` with no sub-line. Hop 3's
`:80` is the port the tunnel ingress is written against in `routes/sites.ts`.

Hop 1's sub-line is `manual step`, not a state marker. In Spec A none of hops
1–3 are verified, and `manual step` stays true permanently — it does not go
stale the moment a DNS record is created, and it leaves the dot slot free for
Spec B to fill with real state.

Below a hairline rule, a label/value grid carries what the hops don't: framework,
healthcheck path, and files path. Static sites carry their path in hop 4 instead,
so no value is stated twice.

Below `sm` (640px) the chain stacks vertically — `flex-col sm:flex-row`, with the
`→` and `↓` glyphs swapped by `sm:hidden` / `hidden sm:inline`. A vertical chain
reads correctly as a pipeline.

### Status vocabulary

One canonical word per state. The pill carries the worst-case truth; hop 4
carries the same word plus detail. `live` and `down` are retired.

| container state | health | pill | hop 4 | tone |
|---|---|---|---|---|
| running | healthy | `● running` | `● running · healthy` | ok |
| running | starting | `● starting` | `● running · health check starting` | neutral |
| running | unhealthy | `● unhealthy` | `● running · unhealthy` | bad |
| running | *(none)* | `● running` | `● running` | ok |
| exited | — | `● exited` | `● exited` | bad |
| restarting | — | `● restarting` | `● restarting · crash-looping` | bad |
| paused | — | `● paused` | `● paused` | bad |
| not-created | — | `● not deployed` | `● not deployed` | bad |
| unknown | — | `● unknown` | `● can't check` | neutral |

Plain reverse proxy (TCP check): `● responding` / `● not responding`, tones ok
and bad. Static sites get no pill and no dot.

Tones map to `ok` = `text-green-300` on `bg-green-950/60`, `bad` =
`text-red-300` on `bg-red-950/60`, `neutral` = `text-stone-300` on
`bg-stone-700`. **`starting` and `unknown` stop being red**, which they are
today: a container still running its first health check is not broken, and "I
could not check" is not a failure of the site.

The `running` + *no health data* row is the legacy shape — `legacy.lyly.dev` in
the seed, and any site created before the healthcheck feature, whose already-built
image has no `HEALTHCHECK`.

This mapping is the only real logic in an otherwise presentational change, so it
becomes a pure module beside `containerStatus.ts`. It shipped as
`src/lib/siteDisplay.ts` rather than `siteStatusLabels.ts` (a deviation
documented in the implementation plan): the same module also holds
`splitHostnameForDisplay`, the other pure display derivation this redesign
introduces, so both live together instead of splitting one small file in two.

```ts
// src/lib/siteDisplay.ts
export type SiteStatus =
  | { kind: "tcp"; responding: boolean }
  | { kind: "container"; state: ContainerState; health?: ContainerHealth };

export interface StatusLabels {
  pill: string;
  hop: string;
  tone: "ok" | "bad" | "neutral";
}

export function describeStatus(status: SiteStatus): StatusLabels;
```

`SiteStatus` moves here out of `src/views/html.ts`; `views/html.ts` and
`routes/sites.ts` import it from this module instead, keeping the dependency
direction lib → views rather than the reverse.

### Manual steps card

Label `MANUAL STEPS` — short enough for a 10px tracked label, with the meaning
carried by a one-line intro instead: *"lyly-admin wires up routing only. These
are yours."*

Numbered, because these genuinely are sequential:

1. **DNS record.** `cloudflared tunnel route dns <tunnelId> <hostname>`. Body
   text notes that until this exists the page still reports the site running,
   because lyly-admin only checks localhost. When `config.tunnelId` is empty
   (its default is `""`), the command is replaced with an instruction to add the
   CNAME from the Cloudflare dashboard — never a command with an empty ID in it.
2. **Build and start it.** `docker compose up -d --build`, with the site
   directory named. Shown only when the site has a scaffold. Body text restates
   that lyly-admin never starts, stops, or rebuilds the container.
3. **Find out why it stopped.** `docker compose logs`. Shown only when the
   container tone is `bad`, with one exception: `not-created` is also in the
   `bad` bucket, but a container that was never created has no logs to read,
   and step 2 already covers it — so step 3 is suppressed specifically for
   `not-created`, even though its tone is `bad`.

Every command is a copyable block using the existing copy-button markup, with
distinct ids (`cmd-dns`, `cmd-compose`, `cmd-logs`, `github-workflow-yaml`).
This is the only place on the page where commands appear — hop 4 stays terse,
and today's `<br />`-appended remediation hints inside the status paragraph are
removed.

### Deploy fold

The build command, run command, and GitHub Actions workflow move into a native
`<details>`/`<summary>`, closed by default, with the existing copy button intact
on the YAML block. The `<summary>` reads `DEPLOY` in the same mono uppercase
label style as `REQUEST PATH`, `MANUAL STEPS`, and `DANGER`, with a chevron.
Native `<details>` keeps this keyboard-accessible and JS-free. Reference material
consulted rarely should not compete visually with status read every visit.

### Danger zone

A titled block separated from the content above, `border-red-900/60` on
`bg-red-950/20`, holding a one-line consequence statement and the `Remove site`
button:

> Removing takes the site out of the Caddyfile and the tunnel route, reloads
> Caddy, then restarts the tunnel. Your DNS record and files stay unless you
> ask otherwise.

The confirm modal names the sequence, because the fail-closed ordering is a real
property of the design that the UI has never communicated:

```
Remove app.lyly.dev?
  1. Caddyfile block removed        3. Caddy validated and reloaded
  2. Tunnel route removed           4. cloudflared-sites restarted
  If a step fails, the ones after it don't run.

  [ ] Also delete files at /var/www/app.lyly.dev
      (scaffolded sites keep today's warning that a running
       container won't be stopped by deleting its files)

  [ Cancel ]  [ Remove site ]
```

The confirm button is relabelled from `Remove` to **`Remove site`**, so the
action keeps one name from danger-zone button → modal confirm → the existing
`Removed app.lyly.dev` banner.

No typed-hostname confirmation. The two-request delete flow already prevents a
failed config removal from cascading into deleted files, and this is a
single-user LAN tool.

### Per-variant behaviour

Every variant is driven off data already in `Site`, and all five exist in
`src/dev/seed.ts`:

| site | hop 4 | detail rows | state pill | steps | deploy fold |
|---|---|---|---|---|---|
| `lyly.dev` (apex, static) | `file_server` · `/var/www/lyly.dev` | — | none | 1 | — |
| `blog.lyly.dev` (static) | `file_server` · `/var/www/blog.lyly.dev` | — | none | 1 | — |
| `api.lyly.dev` (plain proxy) | `localhost:4000` · responding | — | yes | 1 | — |
| `app.lyly.dev` (Next.js) | `localhost:3000` · state · health | framework, healthcheck, files | yes | 1, 2, 3\* | yes |
| `legacy.lyly.dev` (Next.js, no healthcheck) | `localhost:3001` · state | framework, files | yes | 1, 2, 3\* | yes |

\* step 3 only when the container tone is `bad`.

### Quality floor

Responsive to 375px with no horizontal body scroll — the chain stacks, command
blocks scroll inside their own `overflow-x-auto`. Visible `focus-visible`
outlines on the Visit link, both copy buttons, the `<summary>`, and the remove
button, reusing the existing `focus-visible:outline-rose-400` pattern. No new
animation; the existing `animate-modal-in` stays `motion-safe:`-gated.

## Files touched

- `src/styles/tailwind.css` — the `--font-mono` value.
- `src/views/html.ts` — `renderSiteDetail` rebuilt; `layout()` fonts link;
  `SECTION_LABEL` and heading weights; new shared constants for the hop, detail
  row, command block, step, and danger styles.
- `src/lib/siteDisplay.ts` — new pure module (`SiteStatus` moves here, alongside
  `splitHostnameForDisplay`).
- `src/lib/siteDisplay.test.ts` — new.
- `src/routes/sites.ts` — imports `SiteStatus` from its new home and passes
  `domain`, `tunnelId`, and `caddyfilePath` through.

`renderSiteDetail`'s signature becomes

```ts
renderSiteDetail(site, opts: {
  sitesRoot: string;
  domain: string;
  tunnelId: string;
  caddyfilePath: string;
  status?: SiteStatus;
  scaffold?: { buildCommand: string; runCommand: string; deployWorkflow: string };
})
```

rather than growing to seven positional parameters.

`public/app.js` needs **no changes**: the copy handler is already generic over
`data-copy-target`, and the fold is native `<details>`.

## Testing

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- `src/lib/siteDisplay.test.ts` covers all nine container rows and both TCP
  cases. `describeStatus` is never called for a static site — the route passes no
  `status` for them — so "static shows no pill" is a `renderSiteDetail` branch,
  covered by the manual pass rather than by this unit test.
- Manual pass in `npm run dev:mock` over all five seeded hostnames plus the site
  list page, at 1080px and 375px, exercising keyboard focus order, the copy
  buttons' insecure-context fallback, the fold, and the remove modal.

Nothing here becomes lychee-only to verify — Spec A adds no privileged calls.

## Out of scope

Deferred to **Spec B**:

- Live state on routing hops 1–3 (`systemctl is-active` for Caddy and
  `cloudflared-sites`, DNS resolution for hop 1).
- A `checked at` timestamp and a Recheck control, with the JSON status endpoint
  they need.
- Per-hostname activity read from the audit log at `config.logFile`.
- Any status at all for static sites.

Explicitly not in either spec:

- No changes to the add-site flow, the remove/delete-files request sequence, or
  any route behaviour beyond passing two more values into the view.
- No two-column layout, no tabs, and no polling or auto-refresh.
- No typed-hostname delete confirmation.
- No changes to the site list page's layout — only the appearance changes it
  inherits from the `--font-mono` fix.

## Superseded decisions

From `2026-08-11-site-detail-page-redesign-design.md`:

- The `● live` / `● down` pill vocabulary is replaced by the canonical state
  words above.
- "No icons in section headers — text labels only" still holds for section
  labels, but the header now carries a copy icon and the Visit link an arrow.
- That spec's three-card Overview / Status / Deploy structure is replaced: the
  Overview and Status cards merge into the request path card, and Deploy becomes
  a collapsed fold.
- Its "no changes to `GET /sites/:hostname`" constraint is relaxed only to pass
  `domain` and `tunnelId` into the view. No behaviour changes.
