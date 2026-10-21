# Board and site copy says what the app knows

Date: 2026-10-20 · Source: two P2s in the critique re-run (`.impeccable/critique/2026-10-20T22-33-23Z__src-views.md`): "Board speaks reconciler and contradicts itself" and "DNS step and Danger copy misstate the app". Routed through `/impeccable clarify`.

## Problem

**The services board prints the reconciler's own words.**

- **Raw result word on healthy rows.** On lychee today the `lychee-admin` row reads `a428e84 · skipped`, then a separate line, `up to date`.
- **Rows contradict their pills.** In the mock seed:
  - `gone-lychee-land` reads `deployed` under a NOT DEPLOYED pill, because its last run was a completed take-down.
  - `preview-lychee-land` reads `awaiting-image` under the pill that already says it.
  - `broken-lychee-land` reads `failed` under a FAILED pill.
- **Gate lines say nothing is wrong.** Healthy rows get a gate line (`ok`, `pin unchanged (0.2.0)`) that only confirms all is well. A site's repository card prints the same line.
- **The reason appears twice.** `palsave-api` reads `● deploy blocked · not applied`, then the gate, `not applied: port 8788 is claimed…`.

**Two sentences on the site page misstate what the app does.**

- **The DNS step** (`renderManualSteps`, both variants) ends: "Until it exists this page still reports the site running, because lychee-admin only checks localhost." That's false for any site whose pill isn't `running`, and a failing site is exactly when it gets read.
- **The Danger card** (`renderDangerZone`) ends: "Your DNS record and files stay unless you ask otherwise." The app can never remove DNS. File deletion is offered only where a site directory exists. And the card never says that removing an attached site stops its container.

## Goal

Every word on a board row either adds something its pill doesn't say or is gone, and no row contradicts its own pill. Every sentence on the site page about what the app does is true for every site it renders on.

## Decisions

### 1. Board rows drop the raw result word

`renderServiceRow` (`src/views/html.ts`) no longer pushes `row.result` into the facts line, with one exception: a `blocked` row with no deploy line (`deployTrouble(row)` is null, because the code is missing or unknown to this app) keeps `blocked` as a fact, since nothing else on the row would say the deploy is stuck. These facts are unchanged:

- the version, or `version → target` while applying
- the failed-attempt count
- `changed <age>`
- the full-run timer's `next run` and `last run`

The pill carries the state, the deploy line carries trouble, and the failure line carries a failed run's detail.

### 2. A gate sentence shows only as the explanation of trouble

A new pure helper in `src/lib/siteDisplay.ts`:

```ts
export function troubleGate(entry: { result?: string; gateCode?: string; gate?: string }): string | null
```

It returns `entry.gate` only when `entry.result` is `"blocked"` or `"failed"` **and** `entry.gate` is a non-empty string. Otherwise it returns `null`. It branches on the run's `result`, never on the gate's text (contract A-GATE-1).

So a `skipped` (up-to-date), `deployed` (ok) or `awaiting-image` row never shows a gate. Every blocked row does, including one whose code is missing or unknown to this app, because otherwise a stuck deploy under a new code would go silent. `retry-capped` keeps its recovery command. A `failed` row shows its gate when the reconciler wrote one: lychee-admin's own row can carry its only explanation there, and a failed first deploy publishes an empty gate, so nothing extra appears.

*Amended 2026-10-20 while planning:* the first draft keyed this on `deployTrouble`, which would have hidden both the gate and the `blocked` word for an unclassified code, and hidden a failed row's only explanation.

**Board row:** the `data-gate` line renders `troubleGate(row)` and nothing else.

**Deploy line:** when `troubleGate(row)` is non-null, the line drops its short reason and renders `● deploy blocked` or `● deploy waiting` alone, because the gate beneath says why, in full. When the gate is null (a known trouble code with no gate text), the line keeps its short reason as now. A `deploy failed` line is unchanged (its reason already equals its word, so it shows no reason).

**Site repository card:** `gateLine(resource)` renders `troubleGate(resource)` and nothing else, in every place it is called. A running site's card loses `pin unchanged (0.2.0)`. A blocked first deploy still shows its gate in full.

### 3. The DNS step's second sentence

In both variants of the DNS step (with the tunnel ID, and the dashboard-only fallback), the sentence "Until it exists this page still reports the site running, because lychee-admin only checks localhost." becomes, exactly:

> Until it exists, the site can't be reached from the internet even while every check on this page passes: lychee-admin checks lychee itself, never Cloudflare.

### 4. The Danger card says what removal does to this site

The signature becomes `renderDangerZone(opts: { attached: boolean; deletableFiles: boolean }): string`.

- `attached` uses the same test as the remove dialog's fifth step: there is a resource name and `opts.resource` exists, so `attachedName !== null` in `renderSiteDetail`.
- `deletableFiles` uses the same test as the dialog's delete-files checkbox: `filesPath && opts.filesExist`.

The paragraph is built from these sentences, in this order. Each conditional sentence appears only when its flag is true:

1. "Removing takes the site out of the Caddyfile and the tunnel route, reloads Caddy, then restarts the sites tunnel."
2. *(attached)* "It then retires the site's declaration, which stops its container."
3. *(deletableFiles)* "The site's files stay unless you tick the box when you confirm."
4. "lychee-admin never touches the DNS record; delete it in Cloudflare afterwards."

Update the doc comment above `renderDangerZone` so it describes what the paragraph now says.

## Documentation

- **CLAUDE.md:** any sentence describing what a board row's facts line or gate line shows, and the site card's "a blocked run shows its gate string" passage, gets updated only where this change makes it false.
- **DESIGN.md:** the services-board row description (the paragraph that says the gate string has "its own line in full", and that the facts line drops the result word on a row with a deploy line) gets updated to the new rule.
- **Sidecar:** the matching `.impeccable/design.json` component description (Service Row) is updated. If any edited DESIGN.md text sits inside a named rule, `narrative.rules` bodies are re-derived (strip `**` and backticks; header to next rule header or heading) and zero drift is verified.

## Testing

- `src/lib/siteDisplay.test.ts`, for `troubleGate`:
  - Returns the gate for:
    - `blocked` + `retry-capped`, `not-applied` and `ci-pending`
    - `blocked` + an unknown code
    - `blocked` with no code
    - `failed` with a gate string
  - Returns `null` for each of these:
    - `blocked` with an empty gate
    - `failed` with an empty gate
    - `skipped` + `up-to-date`
    - `deployed` + `ok`
    - `awaiting-image`
    - no result
- `src/views/html.test.ts`:
  - No board row's facts line contains `skipped`, `deployed`, `failed` or `awaiting-image` as a fact. Check each seed shape: up-to-date, awaiting image, failed first deploy, taken-down (gone), blocked retry-capped, blocked not-applied, unit rows.
  - A `retry-capped` row shows `● deploy blocked` with no ` · retry limit reached`, and its full gate (with the recovery command) on the `data-gate` line.
  - A `blocked` row with a known code and no gate keeps `· <reason>`.
  - A `blocked` row with no code keeps `blocked` in its facts and shows its gate.
  - An up-to-date row (`gate: "pin unchanged (1.4.0)"`, `gate_code: "up-to-date"`) has no `data-gate` line.
  - A running site's repository card has no `data-gate` line. A blocked first deploy's card still has one.
  - Both DNS step variants contain the new sentence and not "still reports the site running".
  - The Danger paragraph for each flag combination:
    - neither: sentences 1 and 4
    - attached only
    - files only
    - both
  - The Danger paragraph never contains "unless you ask otherwise".
- Run `npm run typecheck`, `lint`, `test` and `build`, and run the detector by hand on `src/views`.

## Out of scope

- The reconciler's own gate sentences (they're `lychee-ops`').
- The `unknown` row's missing command, the "pin unchanged" grid break beyond removing the line, and the other P3s.
- Folding the three board pages back into one.
