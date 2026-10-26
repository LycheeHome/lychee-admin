# Retired on the board: one rule for "confirmed down"

Date: 2026-10-26

## Decision record

- **The rendered comparison** (artifact https://claude.ai/artifact/PRNfpa2uRFpGCbomBeVfMR) offered four variants for the services board's row of a retired site resource, each shown in two moments: container confirmed down, and container still up just after Remove. The user picked **03 "Retired once down"**.
- **Rejected:**
  - **01 (pill `retired` whenever the declaration is absent):** while the container is still up, the pill would stop saying `running`, so the board's pill column would stop meaning live state.
  - **02 (live pill plus a `declaration retired` line):** once the container is down, the pill would still say `not deployed` while the site page says `retired`.
  - **04 (a `retired` tag beside the name):** a new element `DESIGN.md` doesn't have, and two words for one state once the container is down.
- **The site page does not change.** It still reads `retired` as soon as the declaration is absent, and its Prune still answers 409 during the minute before the down. Its notice is about the declaration, and #116 settled its wording.

## Why

Since #116, `gone.lychee.land`'s page reads `retired`, but its row on `/services` still reads `not deployed` beside its Prune, and each links to the other. The board also offers Prune while the container is still up, and the route then refuses it with a 409.

## Goal

- A board row whose site declaration is `state: absent` reads `retired` (neutral) with Prune, once the reconciler has confirmed its container down.
- Until then the row keeps its live pill, shows a neutral `retiring` line, and offers no Prune.
- The board and the prune route decide "confirmed down" with one function, so the board never hides a Prune the route would accept, and never offers one it would refuse for that reason.

## Non-goals

- The site page, its notice and its Prune.
- The rail, find and health: both states are neutral or live, so no count changes.
- Any new tone or colour.

## Decisions

### 1. One rule: `confirmedDown`

- **Where:** `src/lib/siteResource.ts`, beside `declaredTag`. Server-side only.
- **Signature:** `confirmedDown(entry: ContainerEntry | undefined, declaration: DeclarationSummary | undefined): boolean`.
- **True when all of these hold:**
  - an inventory entry exists and has no installed `version`;
  - its last `result` is `deployed` (a completed down), or `awaiting-image` with a declaration whose image has **no tag**.
- **The tag read ignores `state`.** `declaredTag` returns `null` for every `state: absent` declaration, which is exactly the set this rule is about, so it cannot answer the question. A new `imageTag(image: string): string | null` holds `declaredTag`'s parsing (no tag for a digest reference, the colon read only in the last path segment), and `declaredTag` calls it after its own `state` check. The image is the parsed YAML value (`parseDeclaration`), so a quoted escape that hides a colon from a regex reads as tagged here, as it does to the reconciler.
- **The prune route** (`POST /resources/:name/prune`) replaces its inline entry check with `confirmedDown(entry, declaration)`, where `declaration` is the one it already found in the clone. Every refusal keeps today's status and body: `409` with `CONFIRM_DOWN_REASON`, audited once as `prune-declaration-refused`. The writer still gets `requireTagless` on the `awaiting-image` path and still checks after its own pull. The new up-front tag check never refuses something the writer would accept, because no writer in this app removes a tag.

### 2. The board

- **Sorting** (`loadBoardPage`, `src/routes/services.ts`). Each declaration that is `state: absent` with a site name is sorted by `confirmedDown(itsInventoryEntry, declaration)`:
  - into `prunable` (confirmed down);
  - or into `retiring` (new: not yet confirmed down).
  An unreadable clone gives empty sets, as today. A declaration with no inventory entry is `retiring`.
- **Payload** (`/api/services`, `src/shared/board.ts`): gains `retiring: string[]`. `prunable` keeps its name and narrows to "confirmed down".
- **The row** (`ServiceRow`, `src/client/components/BoardRows.tsx`), decided by a node-free `retiredRow(name, prunable, retiring, domain): "down" | "retiring" | null` in `src/views/boardRowModel.ts`, beside `showsPrune`, and like it only for site names:
  - **`down`:** the pill is `retired`, neutral, in place of whatever `summarizeRow` and `rowPill` would give. Prune follows, as today.
  - **`retiring`:** the pill is the live state, as today. A line follows the facts line, in the deploy-trouble line's shape (`font-mono text-[0.8rem]`, dot and word in `TONE_TEXT.neutral`, reason in Smoke): `● retiring · Prune follows once the reconciler confirms the container down`. There is no Prune.
  - `null`: unchanged.
- **Copy.** The mock's `the container stops on the next run` is not used: it is false when a down fails. The line names what Prune waits for, which is true in every case.

### 3. Tests, fixtures, docs

- **Tests:**
  - `confirmedDown`: a table covering no entry; a version installed; `deployed`; `awaiting-image` tagless; `awaiting-image` tagged; a tag hidden by a YAML escape; `failed`; a missing `result`.
  - `imageTag`: the cases `declaredTag` covers today, with no `state` involved.
  - `loadBoardPage`: a confirmed-down absent site goes to `prunable`; a running one, and one with no entry, go to `retiring`; a non-site absent declaration goes to neither; an unreadable clone gives both empty.
  - The route: each case that isn't confirmed down answers `409` with `CONFIRM_DOWN_REASON` and commits nothing; the confirmed-down cases still prune.
  - The row: `down` gives a `retired` neutral pill, Prune, and no retiring line; `retiring` gives the live pill, the exact retiring line, and no Prune; a non-site name gets neither.
- **Fixtures.** `src/dev/fixtures/board/{service,reconciler,infrastructure}-prunable-and-links.html` show `gone-lychee-land` as `not deployed` beside Prune, the case this change redesigns. They are retired, never edited or regenerated, and their parity case in `BoardParity.test.tsx` is replaced by a comment. The links half of that case (site names linked only while managed) gets its own new test.
- **Docs:**
  - `CLAUDE.md`: the board's Prune sentence (in Reverse-proxy sites), the board vocabulary sentence, and the fixtures paragraph.
  - `DESIGN.md`: `retired` on the board row, and a `retiring` line entry beside the deploy-trouble line.
  - `.impeccable/design.json`: re-derive the rule bodies if a rule's prose changed.
  - `PRODUCT.md`: the board paragraph's Prune sentence.
