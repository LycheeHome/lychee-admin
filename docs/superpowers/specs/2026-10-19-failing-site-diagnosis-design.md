# Failing-site diagnosis on the site detail page

Date: 2026-10-19. Status: approved design (sections approved in conversation),
awaiting written-spec review. Source: the 2026-10-19 whole-app critique
(`.impeccable/critique/2026-10-19T20-27-46Z__src-views.md`), its first P1.
Direction chosen from a rendered comparison — variant **01 Triage** of
[Failing-Site Diagnosis](https://claude.ai/artifact/JD3gincSmWNE6YLLZo5nrM),
against 02 Full height, 03 Failure first and 04 Ledger and the live control.

## Why

A failing site's page either buries its diagnosis or has none.

- `broken.lychee.land` (first deploy of `0.1.0` failed, nothing installed): the
  request path says `deploy failed`, but the reason — the failed step and the
  journal command — is in step 4 of the "From a repository" runbook, about
  2,600px down a 3,282px page, below the DNS card and 64 lines of scaffold files
  from steps already done. `DESIGN.md`'s Routing Hop Chain entry already says a
  bad last hop's remediation appears "inside this card, directly beneath the
  chain"; the code honours that for one case only.
- `api.lychee.land` (plain proxy, not responding): no next step anywhere.
- The tunnel and Caddy hops can read a bad unit state with no command beside
  them either. A stopped Caddy takes down every site.

The 11pm read — "which hop broke, and what do I run" — is one of the two jobs
`PRODUCT.md` weights equally. It should take one glance below the header.

## What the page does today (read 2026-10-19)

| Red hop | Where the explanation is | Code |
|---|---|---|
| Last hop: installed container `exited` / `unhealthy` / `restarting` / `paused` | Under the chain: `docker compose -p <resource> logs` | `renderRequestPath`, `containerIsBroken` (`src/views/html.ts`) |
| Last hop: first deploy `failed` | Runbook step 4 | `firstDeploy` → `failureLine` |
| Last hop: plain proxy `not responding` | Nowhere | — |
| Tunnel or Caddy unit in a bad tone | Nowhere | `unitStatus` in `renderRequestPath` |

Unit states use the container vocabulary through `rowLabels`, so a stopped unit
reads `exited`; `exited`, `restarting`, `paused` and `unhealthy` are the bad
tone. `starting` and `unknown` stay neutral and get no entry.

Card order is fixed for every site: header → Request path → Manual steps →
From a repository (Next.js only) → Danger.

## Design

### 1. "What to check" under the chain

A new pure function in `src/views/html.ts`:

```ts
interface HopFix {
  /** The hop it belongs to, as the chain labels it, lower-case: "tunnel", "caddy", "your app". */
  hop: string;
  /** Already-escaped HTML: a sentence, an optional mono fact, and a commandBlock. */
  body: string;
}
function hopFixes(site: Site, opts: SiteDetailOptions): HopFix[]
```

It returns one entry per hop whose tone is `bad`, **in request order** —
tunnel, Caddy, your app — because an upstream failure explains everything
after it. Entries:

| Hop | Condition | Sentence (first draft; `/impeccable clarify` owns final wording) | Command |
|---|---|---|---|
| tunnel | `cloudflared-sites.service` tone `bad` | The sites tunnel isn't running, so no request reaches Caddy. Its journal says why: | `journalctl -u cloudflared-sites -n 50` |
| caddy | `caddy.service` tone `bad` | Caddy isn't running, which takes down every site on lychee, not just this one. Its journal says why: | `journalctl -u caddy -n 50` |
| your app | status `failed` and a resource | `failureLine`'s content: Deploying `<target>` failed at this step: / the step / The reconciler's journal has the whole run: | `journalctl -u lychee-reconcile` |
| your app | attached, container tone `bad` | Check the container's logs to see why: (today's copy) | `docker compose -p <resource> logs` |
| your app | `tcp`, not responding | Nothing answered on `localhost:<port>`. lychee-admin doesn't run this process, so check that it's started and listening: | `ss -ltn 'sport = :<port>'` |

`ss -ltn` needs no privilege; `-p` would, and is deliberately left out.

`renderRequestPath` renders the entries when the list is non-empty, between the
chain and the detail rows: a hairline, a Micro-label `What to check`, then one
row per entry — a `7.5rem` mono key in Scorch (`text-red-300`, with the
`aria-hidden` dot) beside the body, stacking to one column below `sm`. This
replaces the `containerIsBroken` block. With no bad hop nothing renders, as
today.

Command element ids stay unique on the page: `cmd-fix-tunnel`,
`cmd-fix-caddy`, `cmd-logs` (kept), `cmd-reconcile-log` (kept),
`cmd-fix-listen`.

**Unchanged on purpose:** an installed site whose *redeploy* failed while the
old version keeps running has a healthy last hop, so no entry appears; its
failure line stays in the repository card's installed state, as today.

### 2. The runbook and the card order

In `renderRepositoryCard`'s not-yet-installed state:

- **Steps 1 and 2, once done** (`imageFound`), each render as a native
  `<details>`, closed at rest: the summary carries the done mark, the title,
  `done`, and for step 1 the three file names (`Dockerfile, .dockerignore,
  release.yml`); the body is today's content, unchanged and in full. While a
  step is not done it renders exactly as today, never folded. No client JS:
  the copy buttons read `textContent` and work inside an open `<details>`.
- **Step 3** is unchanged.
- **Step 4, when the first deploy failed:** `firstDeploy` no longer renders
  `failureLine`. It renders one sentence — Deploying `<target>` failed; the
  reason is under the request path. — then `gateLine` and the offer, as today.
  One home per failure.

In `renderSiteDetail`, an **attached** site (a `resource` exists) renders
Request path → From a repository → Manual steps → Danger. Every other site —
static, plain proxy, unattached or detached Next.js — keeps today's order,
because for them the DNS record is still live setup.

The Danger card's paragraph gets `max-w-[70ch]` (the detector's one real
browser finding: ~114 characters per line).

### 3. Design system

`DESIGN.md`:

- **The Show-It Rule** gains a second named exception: a finished runbook step
  folds at rest; it is never folded while the step is not done, so setup still
  in progress is never behind a click. The **Don't** list's fold line names
  both exceptions.
- **Routing Hop Chain**: the remediation paragraph says every hop in a bad
  tone gets an entry in the "What to check" list beneath the chain, in request
  order, and that hop one never does (it has no state).
- The detail page's card order for an attached site is recorded where the
  page's composition is described.

`.impeccable/design.json`: `narrative.rules` bodies re-derived from the
amended prose by the documented transform (strip `**bold**` and backticks;
extract from a rule's bolded header to the next rule header or heading). Then
a scoped `/impeccable document` refresh, per `CLAUDE.md`.

## Testing

Written first, in `src/views/html.test.ts`, against `renderSiteDetail`:

1. `failed` first deploy: `journalctl -u lychee-reconcile` and the failed step
   render inside the Request path section; step 4 has no `data-deploy-failed`
   and still offers `0.1.1`.
2. Plain proxy not responding: `ss -ltn 'sport = :4000'` under the chain.
3. `caddy.service` `exited`: `journalctl -u caddy -n 50`; with the tunnel also
   bad, the tunnel entry precedes the Caddy entry, which precedes the app's.
4. Installed container `exited`: `docker compose -p <resource> logs`, as today.
5. Healthy site, and a neutral `unknown` unit: no "What to check" block.
6. Steps 1 and 2 done → each inside a `<details>` without `open`; not done →
   no `<details>`.
7. Attached site: the Manual steps section comes after From a repository;
   static and plain-proxy sites keep it before.
8. No duplicate `id` attributes on any of the seeded detail pages.

Verification: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; the detector on `src/views`; before/after screenshots of
`broken`, `api`, `preview` and `blog` from `npm run dev:mock`. View edits go
through Edit/Write so the design-detector hook sees them.

## Out of scope

The `proxy` pill's colour (the critique's other P1); Visit's emphasis on a
failing site; scoping `journalctl` to the resource; any new host read — every
entry is built from data the page already has; client-side behaviour.
