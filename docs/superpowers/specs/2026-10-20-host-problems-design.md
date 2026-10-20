# Host problems on the sites list

Date: 2026-10-20. Status: approved design (approved in conversation), awaiting
written-spec review. Sub-project **C** of the critique's P2 status-consistency
item (`.impeccable/critique/2026-10-19T20-27-46Z__src-views.md`), narrowed after
A (#97) and B (#98) landed. Direction chosen from a rendered comparison —
variant **02 Ledger lines**, with the consequence leading, of
[Host Problems on Sites](https://claude.ai/artifact/SBchu1Vk4yYKG48rqFPX7S),
against 01 Scorch panel, 03 Heading pill, 04 Host strip and the live control.
Branch `feat/host-problems`, stacked on `feat/failing-site-diagnosis` (#95) to
reuse its `statePhrase`.

## Why

Read from the code on 2026-10-20:

- **A Caddy or tunnel outage is invisible on the sites list.**
  `computeStatuses` (`src/routes/sites.ts`) checks a proxy site by connecting
  straight to `localhost:<port>`, bypassing Caddy and the tunnel; the list never
  reads their systemd state (only a site's page does). With Caddy stopped every
  site is unreachable from outside while the list reads `RESPONDING` /
  `RUNNING`.
- **A stopped reconciler timer shows only on `/reconciler`** — `CLAUDE.md`:
  "nothing else would show it".

The operator ruled that the per-site pills stay as they are: they report what
they check, which is still true. This line says what they can't.

## Design

### 1. What counts (pure)

In `src/lib/siteDisplay.ts`:

```ts
export interface HostProblem {
  name: string;          // the board's name for the unit
  word: string;          // the canonical status word, e.g. "exited"
  consequence: string;
  page: "infrastructure" | "reconciler";
  href: "/infrastructure" | "/reconciler";
}
export function hostProblems(
  unitStates: Record<string, UnitState>,
  inventory: ServiceInventory | null,
): HostProblem[]
```

- Units considered: `caddy.service` and `cloudflared-sites.service` always,
  plus every **unit** entry in the inventory's `infrastructure` and
  `reconciler` groups (deduplicated by unit name).
- A unit is a problem when `rowLabels`-equivalent tone of its status is
  `bad` (`exited`, `restarting`, `paused`, `unhealthy`). Missing from
  `unitStates`, or `unknown`, `starting`, `running` → not a problem.
- `name`: the inventory entry's `name` when present; otherwise `caddy` /
  `cloudflared-sites` for the two fixed units.
- `consequence`, by unit:
  - `caddy.service`, `cloudflared-sites.service`, and any other
    `infrastructure` unit: "Every site is unreachable from outside".
  - `lychee-watch.timer`: "Changes wait for the 15-minute full run".
  - the inventory's full-run timer (`findTimerUnit`, i.e.
    `lychee-reconcile.timer` today): "The 15-minute full run has stopped".
  - any other `reconciler` unit: "Deploys may not apply".
- `page` / `href`: `infrastructure` for the fixed units and the
  `infrastructure` group; `reconciler` for the `reconciler` group.
- Order: infrastructure problems first (sites are down), then reconciler
  problems; within each, inventory order, with the fixed units first.

The tone check lives in `src/lib` (not via the view's `rowLabels`): a unit's
`ServiceStatus` is bad when it is `exited`, `restarting`, `paused` or
`unhealthy` — the same set `rowLabels` gives the bad tone.

### 2. Route (`GET /`)

Alongside `computeStatuses`, concurrently: read the inventory (`readInventory`,
a local file; failure → `null`) and `deps.commands.readUnitStates(units)`
(failure → `{}`), where `units` is the fixed two plus the inventory's
infrastructure/reconciler unit entries. Pass `hostProblems(...)` to
`renderSiteList` as a new optional parameter (`problems: HostProblem[] = []`).
Either read failing yields fewer or no problems — never an error page.

### 3. View (`renderSiteList`)

When `problems` is non-empty, between the heading row (SITES + Add site) and
the rows: a `<div role="status" data-host-problems>` with one line per
problem, then a 1px Hairline rule beneath the block. One line:

```
<consequence> — ● <name> <statePhrase(word)> · <page> →
```

- The consequence leads in Chalk (`text-stone-50`), sans 0.85rem — the
  strongest uncoloured weight, because status colour never goes on prose
  (The Three-Tone Status Rule).
- `● <name> <phrase>` in mono, `text-red-300`; the dot `aria-hidden`.
- `· <page> →` a link to `href`, `text-stone-300`, underlined, hover Chalk,
  `FOCUS_RING`.
- All values escaped. Nothing at all renders when `problems` is empty — the
  page is byte-identical to today's apart from the new parameter.
- Per-site pills are unchanged.

## Docs

`DESIGN.md`: the list page's composition — the host-problem lines, when they
appear, their colour split. `CLAUDE.md`: the list page now also reads Caddy's,
the tunnel's and the reconciler units' state (one `systemctl show`, concurrent
with the per-site checks), and the sentence that the list "status-checks" only
reverse-proxy sites is updated accordingly. Sidecar: the list/Site Row
component description if it describes the page composition; no named rule
changes.

## Testing

Written first:

1. `hostProblems`: Caddy `exited` → one problem, `caddy`, "Every site is
   unreachable from outside", `/infrastructure`; tunnel `restarting` → its
   own problem; watcher timer `exited` → "Changes wait for the 15-minute full
   run", `/reconciler`; full-run timer `exited` → "The 15-minute full run has
   stopped"; an unnamed reconciler unit `paused` → "Deploys may not apply".
2. `unknown`, `starting`, `running` and a unit missing from `unitStates` → no
   problem.
3. Order: an infrastructure problem precedes a reconciler one regardless of
   input order.
4. `inventory: null` → only the fixed two are considered, named `caddy` /
   `cloudflared-sites`.
5. View: no `data-host-problems` when `problems` is empty; with problems, a
   `role="status"` block; the consequence has no status-colour class; the
   state words carry `text-red-300`; the link points at the problem's `href`;
   values are escaped.
6. Route: `GET /` renders 200 with the block when the fake reports Caddy
   exited; renders 200 with no block when `readUnitStates` throws, and when the
   inventory is unreadable and units are healthy.

Verification: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; the detector on `src/views` returns `[]`; a screenshot of `/`
from `npm run dev:mock` showing the healthy list unchanged. The outage state is
covered by tests; the dev fakes report every unit running, and no outage switch
is added to them.

## Out of scope

Per-site pills; header counts on every page; the board pages; adding an outage
mode to the dev fakes.
