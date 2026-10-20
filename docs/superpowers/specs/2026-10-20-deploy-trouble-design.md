# Deploy trouble on the services board

Date: 2026-10-20. Status: approved design (approved in conversation), awaiting
written-spec review. Sub-project **B** of the critique's P2 status-consistency
item (`.impeccable/critique/2026-10-19T20-27-46Z__src-views.md`); sub-project A
is `2026-10-20-status-consistency-design.md` (PR #97). Direction chosen from a
rendered comparison — variant **02 Deploy line** of
[Deploy Trouble Signal](https://claude.ai/artifact/YQHE3oUZ4HM7XWiMYFb1Bo),
against 01 Second pill, 03 Scorch edge, 04 Split pill and the live control.
Branch `feat/deploy-trouble`, stacked on `feat/status-consistency`.

## Why

The board's pill is the unit's or container's health, and stays that way. A
deploy that needs the operator shows only as a grey `blocked` / `failed` word
and a grey gate sentence, so `swee` reads RUNNING over a failed CI run and
`swee-staging` UNKNOWN at its retry limit. Not every `blocked` is trouble —
`ci-pending` is CI still running — so colouring `blocked` would cry wolf.

The contract already says which is which. Every status file carries `gate_code`
(lychee-contract `AGREEMENTS.md` A-GATE-1, `constants.json` `gate_codes`), and
"readers branch on the code, never on the text". lychee-admin does not read
`gate_code` yet.

The operator ruled on the two codes the contract leaves open: `host-pending`
is waiting, not trouble; `unknown` is no signal.

## Design

### 1. Read `gate_code`

`src/lib/serviceInventory.ts` parses the entry's `gate_code` (when a string)
into an optional `gateCode` field, without validating it against the code list,
as the other optional fields are parsed. `src/dev/seed.ts` gives every
reconciled entry the code A-GATE-1 assigns it: `swee` → `ci-failed`,
`swee-staging` → `retry-capped`, `palsave-api` → `not-applied`,
`lychee-admin`, `lychee-notes`, `app-lychee-land` → `up-to-date`,
`preview-lychee-land` → `awaiting-image`, `broken-lychee-land` and
`gone-lychee-land` → `ok`. The existing seed-validates-against-the-contract
test covers it.

### 2. Classification

A pure function in `src/lib/siteDisplay.ts`:

```ts
export interface DeployTrouble { tone: "bad" | "neutral"; word: "blocked" | "failed" | "waiting"; reason: string }
export function deployTrouble(entry: { result?: string; gateCode?: string }): DeployTrouble | null
```

- `result: "failed"` → `{ tone: "bad", word: "failed", reason: "deploy failed" }`.
- `result: "blocked"`, by `gateCode`:

| gate_code | tone | word | reason |
|---|---|---|---|
| `ci-failed` | bad | blocked | CI failed |
| `ci-unknown` | bad | blocked | CI result unknown |
| `retry-capped` | bad | blocked | retry limit reached |
| `pin-unresolved` | bad | blocked | tag didn't resolve |
| `declaration-rejected` | bad | blocked | declaration rejected |
| `not-applied` | bad | blocked | not applied |
| `image-unavailable` | bad | blocked | image unavailable |
| `provenance-failed` | bad | blocked | provenance check failed |
| `token-missing` | bad | blocked | no GitHub token on the host |
| `env-mismatch` | bad | blocked | .env doesn't match |
| `ci-pending` | neutral | waiting | CI running |
| `host-pending` | neutral | waiting | waiting for systemd |

- Anything else → `null`: other results, and `blocked` with `ok`,
  `up-to-date`, `awaiting-image`, `unknown`, an unlisted code, or **no code**.
  A `blocked` row from an older inventory without `gate_code` gets no line —
  the app does not guess from the gate sentence; the grey facts word and gate
  sentence still show.

### 3. Rendering

In `renderServiceRow` (`src/views/html.ts`):

- When `undeployedStatus(row)` already set the pill (`failed` / `awaiting
  image`), there is no deploy line — the pill says it.
- Otherwise, when `deployTrouble(row)` is non-null, a line directly under the
  name: `● deploy <word> · <reason>` — mono, `text-[0.8rem]`; the dot (`aria-hidden`)
  and `deploy <word>` in `TONE_TEXT[tone]`; `· <reason>` in Smoke
  (`text-stone-400`). Marked `data-deploy-state`.
- On a row with that line, the facts line drops its `result` word, so the state
  is not said twice. Version, attempts and age stay.
- The gate sentence, the failure line, the offer and the host-action strip are
  unchanged. A running host action does not hide the line: it is about the
  deploy, not the unit.

Status colour lands only on the state words, never on the reason or the gate
sentence (The Three-Tone Status Rule; status colours never go on prose).

## Docs

`DESIGN.md` Service Row: the deploy line, its two tones, and that colour sits
on the state words only. Sidecar: the Service Row description to match; no
named rule changes. `CLAUDE.md`: one sentence that the board reads `gate_code`
(A-GATE-1) to tell deploy trouble from waiting.

## Testing

Written first:

1. `deployTrouble` maps every code in the table; `failed` → failed; `blocked`
   with `ok`, `up-to-date`, `unknown`, an unlisted code and no code → `null`;
   `skipped` / `deployed` → `null`.
2. The inventory parser carries `gate_code` through as `gateCode`, and leaves
   it absent when the field is missing or not a string.
3. The seed still validates against the contract's inventory schema.
4. Board: a `ci-failed` row renders `data-deploy-state` with `deploy blocked`
   in the bad-tone text class and `· CI failed`; its facts line has no
   `blocked`; its pill is still the live state.
5. Board: a `ci-pending` row renders `deploy waiting` in the neutral class,
   not the bad one.
6. Board: an undeployed `failed` row (nothing installed) has no deploy line;
   a `blocked` row with no `gateCode` has no deploy line and keeps `blocked`
   in its facts.
7. Board: a row with a running host action still shows its deploy line.

Verification: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run build`; the detector on `src/views` returns `[]`; a screenshot of
`/services` from `npm run dev:mock`.

## Out of scope

The site page and site list; a cross-page summary (sub-project C); changing
what the pill means.
