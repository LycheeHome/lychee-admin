# Retired state: make a retired declaration visible (critique 2026-10-21, P1)

Date: 2026-10-26

## Decision record

- **Scope A: both a status word and the page layout.** Retired becomes a canonical status, and the site page brings the notice and Prune to the top.
- **The rendered comparison** (artifact https://claude.ai/artifact/HcKfSHkvtd3bg6MRnssf7B) offered four variants against the live control. The user picked a **mix**:
  - **from 01 "Quiet word":** the word `retired`, in the neutral tone;
  - **from 03 "Named file":** a notice card directly under the header, holding Prune.
- **Rejected:**
  - **02 (Scorch):** it contradicts the Three-Tone rule, which already files "deliberately taken down" under Smoke, and it would count a one-click cleanup as an outage.
  - **03's word (keep `not deployed`):** the pills would stay identical.
  - **01's card reorder:** a re-added site may need its DNS record again, so Manual steps must not drop.
  - **04 (Prune on the list row):** a row stops being one link, and a destructive action would sit away from its context.
- **The notice does not claim the container is down.** The page doesn't know it; the prune route checks at press time. The caption says what the route checks.

## Why

`gone.lychee.land` (a site re-added over a `state: absent` declaration, not yet pruned) reads `not deployed` everywhere, exactly like the never-attached `legacy.lychee.land`. On its page, the warning and Prune sit about 2,780px down a 3,325px page, inside runbook step 3, below Manual steps and all three scaffold files. The page's one useful action is hidden, and nothing in the list tells the two sites apart.

## Goal

- `retired` is a canonical status word, in the neutral tone, wherever site status shows: the list pill, the page header pill and last hop, find, and the rail's screen-reader label.
- A retired site's page shows a notice card with Prune directly under the header.

## Non-goals

- Changes to the services board, Attach, Prune, any endpoint's behaviour, or the card order.
- A new tone or colour.
- Pruning from the list.

## Decisions

### 1. The status

- **Data:**
  - `SiteStatus` (`src/lib/siteDisplay.ts`) gains `{ kind: "retired" }`.
  - `resolveNextjsSite` (`src/routes/sites.ts`) returns it in place of `NOT_DEPLOYED` whenever it returns `detached: true`, the declaration being `state: absent`. No new data is read.
- **How it reads** (`describeStatus`): pill `retired`, last hop `retired · not pruned`, tone `neutral`.
- **Where it shows up:**
  - **List and page:** the list pill (`/api/sites`), the page's header pill and last hop, and find all show it through the status they already read.
  - **Rail:** the dot stays neutral, the same as `not deployed`. The screen-reader label reads `retired`.
  - **Attention counts:** unchanged, since neutral states never count.
- **Exhaustive branches.** Every switch over `SiteStatus` gains a `retired` case, and TypeScript's exhaustiveness checks flag any that are missed.

### 2. The site page

- **The notice card.**
  - **Placement:** shown only when `detached` is true, directly under the header and above the request path.
  - **Treatment:** the page's card treatment (Hearth Lift, Hairline border, 10px radius), at the detail width.
  - **Sentence** (sans, machine facts in mono): `` `<name>.yml` is retired (`state: absent`). Attaching a repository is refused until it is pruned. ``
  - **Control:** **Prune old declaration**, as a compact primary. It is the page's one Ember; Visit stays secondary.
  - **Caption** (Smoke): `` deletes `<name>.yml` from lychee-resources · once the reconciler confirms its container is down ``
- **Runbook step 3.**
  - Its warning shortens to: `` Attaching is refused while `<name>.yml` is retired. Prune it above; pressing Attach checks again. ``
  - It stays the target of Attach's `aria-describedby`.
  - Its own Prune control is removed, so Prune appears once per page.
- **Card order is unchanged:** request path, Manual steps, From a repository, Danger.
- **Behaviour:**
  - Prune uses the existing mutation.
  - On success the page re-reads, the site is no longer detached, and the notice card and the shortened warning go.
  - Focus follows the existing rule: it moves to the repository card's heading when the control that had it is gone.
  - A refusal shows the unchanged error toast.

### 3. Docs and the frozen fixture

- **DESIGN.md:**
  - add `retired` to the Three-Tone rule's neutral list, with the reason ("deliberately taken down is not a failure");
  - add the notice card to Components, as a page-level state notice holding one action;
  - note that Repository Card ordering is unchanged for retired sites.
- **Sidecar:** `.impeccable/design.json` `narrative.rules` bodies are re-derived from the prose, using CLAUDE.md's one transform.
- **PRODUCT.md:** add `retired` to the canonical status vocabulary.
- **CLAUDE.md:** update the status vocabulary and the retired-site page description.
- **The fixture:**
  - `src/dev/fixtures/detail/gone-detached.html` and its parity case are retired, not edited and not regenerated. It is the retired server renderer's output for exactly the case this redesign changes.
  - Explicit tests replace it.
  - CLAUDE.md's fixture paragraph records that this redesign superseded it.
  - No other fixture changes. The shell and rail fixtures show `gone` without health, and the board is unchanged.

## Testing

- **Status:**
  - `resolveNextjsSite` returns `retired` for an absent declaration and `not deployed` for an unattached site.
  - `describeStatus({kind:"retired"})` returns `retired`, `retired · not pruned` and `neutral`.
- **List:** `gone`'s pill reads `retired`, and `legacy`'s reads `not deployed`. Both are neutral.
- **Rail:** `gone`'s dot is neutral, its screen-reader label includes `retired`, and the attention counts are unchanged from today.
- **Find:** `gone` shows `retired`.
- **Page:**
  - The notice card sits between the header and the request path, with the exact sentence and caption.
  - Prune appears exactly once, as a compact primary. Visit is secondary.
  - Step 3 keeps the shortened warning, wired to Attach's `aria-describedby`.
  - A successful prune removes both, and focus moves to the card heading.
  - A 409 shows the unchanged toast.
  - The card is absent on a site that is not retired.
- **Rules:** the rail design-rule tests and the detector stay clean.
- **Browser check:** the list and `gone`'s page at 1280 and 390px, against the chosen variant's mock, then an end-to-end Prune of `gone` in `dev:mock`.
- **Commands:** typecheck, lint, test and build all pass, and the detector on `src/views src/client` returns `[]`.
