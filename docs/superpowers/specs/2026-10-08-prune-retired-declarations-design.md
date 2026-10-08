# Prune retired declarations — design

Date: 2026-10-08
Status: approved in conversation; written spec pending review
Follows `2026-10-05-scaffold-emits-declarations-design.md`, which left pruning a
retired declaration as a deliberate manual step.

## Problem

Removing an attached site writes `state: absent` to its declaration in
`lychee-resources`. The reconciler then takes the container down, and keeps the
declaration, its port claim and its name reserved indefinitely. That is the
"deletion is declared, never implied by absence" rule doing its job. But it
leaves one step with no in-app path: re-adding the same hostname is refused
until someone deletes the retired file by hand on GitHub. The site page already
says so ("prune it before re-attaching") and offers no way to do it.

Deleting the file alone is not enough. Verified on `lychee` 2026-10-08:

- an `absent` declaration is still **rendered** (`/etc/lychee-resources/<name>/`)
  and `down` is applied to it every tick;
- its **status file** (`/var/lib/lychee-resources/<name>/status.json`) persists,
  and the inventory discovers site rows from status files on disk.

So an app-only delete would leave the rendered project listed in `drift.json` as
an undeclared project — the alarm meant for a declaration deleted by mistake —
and a ghost row on the services board, both permanently.

## Decisions

| Question | Decision |
|---|---|
| What Prune leaves behind | **Clean retirement**: the app deletes the declaration; the reconciler removes the rendered project and status file once it can prove nothing runs. The site's account stays. |
| Where Prune lives | **Both**: the site page's detached warning and a retired row on the services board, behind one route. |

Rejected: an app-only delete (permanent drift and ghost rows train the operator
to ignore both), and reusing a retired declaration on re-attach instead of
deleting it (retired files accumulate and their ports stay claimed until reused).

## Guards

Prune is the app's first delete write, so it is bounded on both sides.

**App** — `POST /resources/:name/prune`:

1. **Site names only** (`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-lyly-dev`), like every
   other write the app makes. Hand-declared resources (`palsave-api`) cannot be
   pruned from the app.
2. **The declaration is already `state: absent`**, checked by the writer on the
   parsed file **after its fresh pull**, not from the page's possibly stale view.
3. **The reconciler has confirmed it down**: its inventory entry shows nothing
   installed (`version` empty) and a last `result` of `deployed` (a completed
   `down`) or `awaiting-image` (never installed). Otherwise the route answers
   `409` "the container hasn't been confirmed down yet; try after the next
   reconcile" and writes nothing.

**Reconciler** — new cleanup rule. For a name that has a rendered project
directory or a status directory but **no valid declaration**, remove both
directories only when **both** proofs hold:

- the last `status.json` shows a completed down (`action: down`,
  `result: deployed`, `installed_tag: none`) or a never-installed site
  (`result: awaiting-image`, `installed_tag: none`); and
- `docker compose -p <name> ps -a -q` lists no containers.

If either fails, the name stays reported as drift, exactly as today. A deleted
declaration still never stops anything. Names are filtered by the reconciler's
existing name rule before any path is built from them.

The site's system account is **not** removed (uid reuse; see the slice-5 spec).
Re-adding the same hostname later reuses it.

## lychee-ops

- **Cleanup task** in `roles/resources_reconcile/tasks/reconcile.yml`, inside the
  apply block and **before** drift is computed, so a cleaned project never
  appears in `drift.json`. Candidates are project and status directory names
  that are not in the valid declaration set, after the name-rule filter.
- **Removal** of `{{ lychee_resources_dir }}/<name>` and
  `{{ resources_reconcile_status_dir }}/<name>` with `ansible.builtin.file
  state: absent`, only after both proofs; the compose check uses the same docker
  stand-in seam the existing tests use.
- **Tests** (`tests/test_resources_render.yml` or a sibling play):
  - a confirmed-down undeclared project is cleaned and absent from drift;
  - status showing `up` → kept, reported as drift;
  - compose ps lists a container → kept, reported as drift;
  - a never-installed (`awaiting-image`) undeclared site → cleaned;
  - `palsave-api` and every declared resource untouched;
  - a malformed or missing status file → kept as drift.

## lyly-admin

- **Writer** `pruneSiteDeclaration(name)` in `src/lib/declarationWriter.ts`, on
  the serialized `withClone` path (fresh pull, re-clone if dirty, never force,
  reset on failure). Refuses: a non-site name, a missing file, or a file whose
  **parsed** `state` is not `absent`. Deletes the file in one commit,
  `<name>: prune retired declaration`. Exposed on `SystemCommands` (real and
  fakes).
- **Route** `POST /resources/:name/prune` (JSON): `404` no such declaration in the
  clone; `409` not confirmed down (inventory guard above) or writer refused
  because state is not `absent`; `502` any other refused write; `200` on success.
  Whole async body in try/catch. Logged `prune-declaration` /
  `prune-declaration-failed`.
- **UI**: a secondary **Prune old declaration** button
  - on the site page's detached warning (state `absent`), replacing "prune it
    before re-attaching" as the only instruction;
  - on a services-board row whose declaration is `absent`.
  No modal: it deletes a retired file for a container already confirmed down, and
  the commit is revertible. The button is shown only when the declaration is
  `absent`; the confirmed-down check is the route's, and its `409` reason is shown
  through the existing banner. Copy and markup through impeccable's scoped flow;
  detector run on `src/views`.
- **Dev seed**: one retired, confirmed-down site, so the state is visible in
  `npm run dev:mock`; the comparing-design-variants skill's seed list updated.
- **Docs**: CLAUDE.md's remove-site passage and Reverse-proxy sites section say
  Prune exists and what it removes; DESIGN.md if the button adds a pattern (rule
  bodies re-derived if any rule text changes).
- **Tests**: writer (absent allowed; running, non-site, missing refused; rejected
  push resets; deletes exactly one file); route (`409` not confirmed down, `404`,
  `502`, `200` calls the writer); views (button only for absent declarations, on
  both surfaces).

## Order

lychee-ops first, so the first real prune cleans up. The reverse order is still
safe: a prune with no cleanup rule only leaves drift and a stale row.

## Verification on lychee

Retire test.lyly.dev (Remove in the app), wait for the down, Prune it, then
confirm within a tick: `/etc/lychee-resources/test-lyly-dev` and
`/var/lib/lychee-resources/test-lyly-dev` are gone, `drift.json` is empty, the
board row is gone, and `getent passwd test-lyly-dev` still shows the account.

## Not in this design

Deleting site accounts; pruning hand-declared (non-site) resources from the app;
pruning anything not already `absent`; purging named volumes (still a separate,
deliberate act outside this work).
