# Critique Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five priority issues from the `/impeccable critique` of `src/views/html.ts` — the remove dialog's P0 accessibility defects, both mutating flows' missing mechanism statements, and the sub-11px type ramp — without touching the reading half of the app, which the critique rated top-decile.

**Architecture:** Four sequenced increments. The P0 dialog fix lands first on severity and depends on nothing. The type ramp settles second so later markup is written against final tokens. Mutation transparency third, built on a new pure `stepReport` module that lets both routes report what actually ran without restructuring their handlers. Copy and remaining accessibility last.

**Tech Stack:** TypeScript, Express, server-rendered template strings, vanilla JS (`public/app.js`), Tailwind v4 via CLI, `tsx --test` (Node's built-in runner).

**Spec:** [`docs/superpowers/specs/2026-08-24-critique-remediation-design.md`](../specs/2026-08-24-critique-remediation-design.md)

## Global Constraints

- **Branch:** `critique-remediation`. Do not commit to `main`.
- **Never hand-edit `DESIGN.md` or `.impeccable/design.json`.** Both are re-derived by `/impeccable document` in Task 17. Changing tokens by hand and re-deriving later produces conflicting values.
- **Verification per task:** `npm run typecheck`, `npm run lint`, `npm test`. Run `npm run build` before the final commit of each increment.
- **View tests anchor to an element, never the document.** Use the existing `tagById` helper in `src/views/html.test.ts` and `withoutHeader` from `src/dev/testHelpers.ts`. A document-wide regex on the detail page is vacuous — almost any string appears somewhere in it.
- **Status vocabulary is fixed:** `running`, `unhealthy`, `starting`, `exited`, `restarting`, `paused`, `not deployed`, `unknown`, `responding`, `not responding`. Do not add to it.
- **Terminology:** *the sites tunnel* (`cloudflared-sites`), never "the tunnel". Managed hostname. Static vs reverse-proxy site. Framework scaffold. Healthcheck path. Hop.
- **DESIGN.md Don'ts that bound every task:** no second accent hue, no gradient, no chart, no shadow on in-flow cards, no folding/truncating/capping content, no uppercase for emphasis inside a sentence, no status colour on prose or headings.
- **All motion is `motion-safe:` gated.**
- **`navigator.clipboard` is unavailable** — the app is served over plain HTTP. Never remove the select-text fallback.

---

## Increment 1 — P0: the remove dialog

### Task 1: The dialog announces itself and focuses Cancel

`showModal()` currently leaves `document.activeElement` on the delete-files checkbox, so pressing Space on open arms an `rm -rf`. The dialog also has no accessible name, so a screen reader's whole spoken opening is the checkbox label.

**Files:**
- Modify: `src/views/html.ts:580-597` (the `<dialog id="confirm-remove-dialog">` block)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `tagById(html, id)` — existing local helper in `html.test.ts`, returns the opening tag of the element with that id.
- Produces: `id="confirm-remove-title"` on the dialog's `<h2>`; `autofocus` on the Cancel button. Task 3 modifies the confirm button in the same block.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/html.test.ts`, inside a new `describe`:

```typescript
describe("remove dialog accessibility", () => {
  test("the dialog names itself with its own heading", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const dialog = tagById(html, "confirm-remove-dialog");
    assert.match(dialog, /aria-labelledby="confirm-remove-title"/);
    // The id must actually exist, or the reference dangles and the dialog
    // still announces as bare "dialog".
    assert.ok(tagById(html, "confirm-remove-title"));
  });

  test("focus opens on Cancel, never on the delete-files checkbox", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const cancel = html.match(/<button[^>]*data-close-dialog="confirm-remove-dialog"[^>]*>/);
    assert.ok(cancel, "no Cancel button was rendered");
    assert.match(cancel[0], /\bautofocus\b/);
    const checkbox = tagById(html, "confirm-remove-delete-files");
    assert.doesNotMatch(checkbox, /\bautofocus\b/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `aria-labelledby` is absent, and the Cancel button has no `autofocus`.

- [ ] **Step 3: Add the accessible name and the autofocus**

In `src/views/html.ts`, change the dialog's opening tag to add `aria-labelledby`:

```html
<dialog id="confirm-remove-dialog" aria-labelledby="confirm-remove-title" class="modal font-sans bg-stone-800 text-stone-50 border border-stone-700 rounded-[10px] p-6 w-[min(420px,calc(100vw-2rem))] m-auto backdrop:bg-black/60 motion-safe:animate-modal-in">
```

Give the heading the matching id:

```html
<h2 id="confirm-remove-title" class="font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0 mb-[1.1rem]">Remove site</h2>
```

Add `autofocus` to the Cancel button:

```html
<button type="button" autofocus class="${BUTTON_SECONDARY}" data-close-dialog="confirm-remove-dialog">Cancel</button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Verify manually in the browser**

Run `npm run dev:mock`, open `http://127.0.0.1:8787/sites/blog.lyly.dev` (auth `dev`/`dev`), click **Remove site**, and confirm the focus ring lands on Cancel. Stop the server afterward.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Give the remove dialog an accessible name and open focus on Cancel"
```

---

### Task 2: The delete-files checkbox is in-system

The checkbox is the app's only unstyled control: `accent-color: auto` renders it browser-blue, and its focus ring measures `auto 1px rgb(153,200,255)` — a second focus treatment, against DESIGN.md's "There is no second focus treatment anywhere in the system."

**Files:**
- Modify: `src/views/html.ts:554` (the checkbox `<input>`)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `FOCUS_RING` from `src/views/shared.ts:22` — the shared `focus-visible:outline` class string.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Add inside the `describe("remove dialog accessibility")` block from Task 1:

```typescript
test("the delete-files checkbox uses the system accent and focus ring", () => {
  const checkbox = tagById(renderSiteDetail(STATIC_SITE, OPTS), "confirm-remove-delete-files");
  assert.match(checkbox, /accent-rose-400/);
  assert.match(checkbox, /focus-visible:outline-rose-400/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the input carries no class attribute at all.

- [ ] **Step 3: Style the checkbox**

Import `FOCUS_RING` if it is not already imported in `src/views/html.ts`, then change the input:

```html
<input type="checkbox" id="confirm-remove-delete-files" class="accent-rose-400 ${FOCUS_RING}" />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Pull the delete-files checkbox into the design system"
```

---

### Task 3: The confirm button names the hostname

`app.lyly.dev` and `api.lyly.dev` differ by one character, and today both the trigger and the confirm read "Remove site".

**Files:**
- Modify: `src/views/html.ts:593` (the `#confirm-remove-submit` button)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `escapeHtml` from `src/views/shared.ts`.
- Produces: the confirm button's visible text becomes `Remove <hostname>`. Task 10's client code reads `dataset.hostname`, which is unchanged.

- [ ] **Step 1: Write the failing test**

```typescript
test("the confirm button names the site, not the category", () => {
  const html = renderSiteDetail(PROXY_SITE, OPTS);
  const button = html.match(/<button[^>]*id="confirm-remove-submit"[\s\S]*?<\/button>/);
  assert.ok(button, "no confirm button was rendered");
  assert.match(button[0], /Remove api\.lyly\.dev/);
  // The trigger keeps the generic label; only the confirm is specific.
  assert.match(html, /data-open-dialog="confirm-remove-dialog"[\s\S]{0,200}?Remove site/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the confirm button reads "Remove site".

- [ ] **Step 3: Name the hostname**

```html
<button type="button" id="confirm-remove-submit" class="${BUTTON_DANGER}" data-hostname="${escapeHtml(site.hostname)}">${icon("trash")}Remove ${escapeHtml(site.hostname)}</button>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS. If an existing test asserted the confirm button's text was "Remove site", update it to the new label — the trigger, not the confirm, keeps the generic wording.

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Name the hostname on the remove confirmation button"
```

---

## Increment 2 — The type ramp

Read the spec's role-assignment table before starting. The three sizes serve seven roles across eight call sites; applying sizes by value would sweep four elements the ramp never named.

### Task 4: The `label` role goes to 12px

**Files:**
- Modify: `src/views/shared.ts:36` (`CARD_LABEL`)
- Modify: `src/views/html.ts:398` (the hardcoded `<h3>Danger</h3>`)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CARD_LABEL` at `text-[0.75rem]` with `text-stone-300`. Task 5 and Task 6 change different constants; they do not collide.

- [ ] **Step 1: Write the failing tests**

```typescript
describe("small-text ramp", () => {
  test("card labels sit at the 12px step in Chalk-adjacent stone", () => {
    const html = renderSiteDetail(NEXT_SITE, OPTS);
    assert.match(html, /class="font-mono text-\[0\.75rem\] font-medium uppercase tracking-\[0\.1em\] text-stone-300/);
    assert.doesNotMatch(html, /text-\[0\.625rem\]/);
  });

  test("the Danger heading reuses the card-label constant instead of restating it", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    const danger = html.match(/<h3[^>]*>Danger<\/h3>/);
    assert.ok(danger, "no Danger heading was rendered");
    // Same size and tracking as every other card label; only the colour differs.
    assert.match(danger[0], /text-\[0\.75rem\]/);
    assert.match(danger[0], /text-red-300/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — both are at `0.625rem`.

- [ ] **Step 3: Move the token and fold the duplicate**

In `src/views/shared.ts`, split the typographic facts from the colour and spacing, so a caller that needs a different colour does not have to fight utility precedence:

```typescript
/**
 * The size, weight, and tracking every card label shares. Split out because
 * the Danger card needs the same type at a different colour and margin, and
 * Tailwind resolves competing utilities by stylesheet order, not by the order
 * they appear in a class attribute — so appending an override is unreliable.
 */
export const CARD_LABEL_BASE = "font-mono text-[0.75rem] font-medium uppercase tracking-[0.1em]";
export const CARD_LABEL = `${CARD_LABEL_BASE} text-stone-300 m-0 mb-3`;
```

In `src/views/html.ts:398`, build the Danger heading from the same base instead of restating the type:

```html
<h3 class="${CARD_LABEL_BASE} text-red-300 m-0 mb-1.5">Danger</h3>
```

Add `CARD_LABEL_BASE` to the existing import from `./shared` in `html.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/shared.ts src/views/html.ts src/views/html.test.ts
git commit -m "Move the label token to 12px and fold the Danger heading into it"
```

---

### Task 5: The `micro-label` role goes to 11px

Two sites: the hop label, and the numbered step badge. The badge is a numeral centred in a fixed `1.2rem` (19.2px) circle, so it needs looking at rather than a find-and-replace.

**Files:**
- Modify: `src/views/html.ts:187` (`HOP_LABEL`)
- Modify: `src/views/html.ts:288` (the step badge)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no exported surface change.

- [ ] **Step 1: Write the failing test**

```typescript
test("hop labels and step badges clear the 11px floor", () => {
  const html = renderSiteDetail(NEXT_SITE, OPTS);
  assert.match(html, /text-\[0\.6875rem\][^"]*uppercase tracking-\[0\.09em\]/);
  assert.doesNotMatch(html, /text-\[0\.6rem\]/);
  assert.doesNotMatch(html, /text-\[0\.625rem\]/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `HOP_LABEL` is at `0.6rem`.

- [ ] **Step 3: Move both sites to 11px**

```typescript
const HOP_LABEL =
  "font-mono text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-stone-400 m-0 mb-1.5";
```

And the step badge at `html.ts:288`:

```typescript
  "font-mono text-[0.6875rem] text-rose-400 border border-rose-400/40 rounded-full w-[1.2rem] h-[1.2rem] flex items-center justify-center shrink-0 mt-0.5";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Check the badge fit in the browser**

Run `npm run dev:mock` and open `http://127.0.0.1:8787/sites/blog.lyly.dev`. The Manual steps numerals must stay centred and fully inside their circles. If an 11px numeral crowds the `1.2rem` circle, widen the circle to `1.35rem` rather than shrinking the text back below the floor — and say so in the commit message. Stop the server afterward.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Move the micro-label token to 11px"
```

---

### Task 6: The `pill` role goes to 11px

Only `STATUS_PILL_BASE` is genuinely a pill. The other three `0.65rem` sites move in Task 7.

**Files:**
- Modify: `src/views/shared.ts:21` (`STATUS_PILL_BASE`)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `STATUS_PILL_BASE` at `text-[0.6875rem]`. `TONE_PILL` composes from it and needs no change.

- [ ] **Step 1: Write the failing test**

```typescript
test("status pills clear the 11px floor", () => {
  const html = renderSiteList(SITES, { "api.lyly.dev": { kind: "tcp", responding: false } });
  assert.match(html, /inline-flex items-center gap-1 shrink-0 font-mono text-\[0\.6875rem\] uppercase/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the pill base is at `0.65rem`.

- [ ] **Step 3: Move the token**

```typescript
export const STATUS_PILL_BASE =
  "inline-flex items-center gap-1 shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-transparent";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/shared.ts src/views/html.test.ts
git commit -m "Move the pill token to 11px"
```

---

### Task 7: The three small mono values become `code`, and two contrast failures are fixed

The hop sub-line, the `in <cwd>/` line, and the switcher type hint are all small muted mono *values*, which the existing `code` token (0.72rem / 11.52px) already describes above the floor. Two separately-measured AA failures are fixed in the same pass.

**Files:**
- Modify: `src/views/html.ts:196` (hop sub-line), `:324` (`in <cwd>/`), `:490` (switcher type hint)
- Modify: `src/views/html.ts` — the radio-card description on `/sites/new`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: no exported surface change.

- [ ] **Step 1: Write the failing tests**

```typescript
test("small mono values sit on the code step, not the pill step", () => {
  const html = renderSiteDetail(NEXT_SITE, OPTS);
  assert.doesNotMatch(html, /text-\[0\.65rem\]/);
});

test("the switcher's current row states its port at readable contrast", () => {
  const html = renderSiteDetail(NEXT_SITE, OPTS);
  // stone-400 on the highlighted row measured 3.98:1; stone-300 clears 4.5:1.
  assert.doesNotMatch(html, /text-\[0\.65rem\] text-stone-400 shrink-0/);
});

test("the type-option description clears AA on its raised card", () => {
  const html = renderAddSite(SITES, "lyly.dev", {});
  // On bg-stone-700 the description measured 3.98:1 at 12px.
  assert.doesNotMatch(html, /bg-stone-700[^"]*"[\s\S]{0,400}?text-stone-400/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL on all three.

- [ ] **Step 3: Move the three sites and lift the two foregrounds**

At `html.ts:196`, the hop sub-line:

```typescript
${hop.sub ? `<p class="font-mono text-[0.72rem] ${hop.subClass ?? "text-stone-400"} m-0 break-all">${escapeHtml(hop.sub)}</p>` : ""}
```

At `html.ts:324`, the working-directory line:

```typescript
${cwd ? `<p class="font-mono text-[0.72rem] text-stone-400 m-0 mt-1">in ${escapeHtml(cwd)}/</p>` : ""}
```

At `html.ts:490`, the switcher type hint — size *and* colour, since this row is the highlighted one:

```typescript
<span class="text-[0.72rem] text-stone-300 shrink-0">${escapeHtml(typeHint)}</span>
```

Then lift the two type-option descriptions at `html.ts:131` and `html.ts:138`. Each card sets `has-[:checked]:bg-stone-700`, and it is the checked state that measured 3.98:1. Change both spans' `text-stone-400` to `text-stone-300`:

```html
<span class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Serves plain files from <code class="font-mono">/var/www/&lt;hostname&gt;</code>, which lyly-admin creates for you with a placeholder page — no process to run yourself.</span>
```

```html
<span class="text-stone-300 text-[0.75rem] leading-snug pl-[1.55rem]">Routes to a process you already run and manage yourself on a local port (e.g. <code class="font-mono">next start</code>). lyly-admin only wires up the routing — it won't start, stop, or restart that process for you.</span>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Fold small mono values onto the code step and fix two AA failures"
```

---

### Task 8: Resolve the 11px-floor risk

`0.6875rem` is exactly 11px, and whether the detector's rule is `< 11` or `<= 11` is unverified. This task answers it. **It may stop for a decision.**

**Files:**
- None modified unless the detector rejects 11px.

**Interfaces:**
- Consumes: the tokens set by Tasks 4–7.
- Produces: a verified-clean detector run, or a stop.

- [ ] **Step 1: Run the detector over the changed source**

```bash
node "$(ls -d ~/.claude/plugins/cache/impeccable/impeccable/*/skills/impeccable)/scripts/detect.mjs" --json src/views
```

Expected: exit 0 and `[]`.

- [ ] **Step 2: Interpret the result**

If exit 0 — the floor is `< 11`, the two-step ramp holds, continue to Increment 3.

If it still reports `undersized-ui-text` on the 11px sites, the rule is `<= 11`. **Stop and report.** Do not silently push micro-label and pill to `0.75rem`: that collapses the ramp back to a single step and puts the entire Label/Micro-label hierarchy on colour alone, which is a material deviation from the approved design and needs a decision.

- [ ] **Step 3: Verify the whole suite and the build**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 4: Commit if anything changed**

```bash
git commit --allow-empty -m "Verify the 11px floor clears the design detector"
```

---

## Increment 3 — Mutation transparency

### Task 9: A pure step-report module

Both routes need to report what actually ran without restructuring their handlers. This is a pure module with no I/O, matching the `src/lib/*.ts` + `*.test.ts` pattern already used by `caddyfile`, `tunnelConfig`, and `siteDisplay`.

**Files:**
- Create: `src/lib/stepReport.ts`
- Test: `src/lib/stepReport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type StepStatus = "ok" | "failed" | "skipped" | "not-run"`
  - `interface StepDefinition { id: string; label: string }`
  - `interface Step extends StepDefinition { status: StepStatus }`
  - `createStepReport(definitions: readonly StepDefinition[]): StepReport`
  - `StepReport.run<T>(id: string, fn: () => Promise<T>): Promise<T>` — records `ok`, or records `failed` and rethrows
  - `StepReport.skip(id: string): void`
  - `StepReport.steps(): Step[]`
  - `REMOVE_STEPS` and `ADD_STEPS` constants

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stepReport.test.ts`:

```typescript
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ADD_STEPS, REMOVE_STEPS, createStepReport } from "./stepReport";

const DEFS = [
  { id: "one", label: "First" },
  { id: "two", label: "Second" },
];

describe("createStepReport", () => {
  test("un-run steps report not-run, never ok", async () => {
    const report = createStepReport(DEFS);
    await report.run("one", async () => undefined);
    assert.deepEqual(report.steps(), [
      { id: "one", label: "First", status: "ok" },
      { id: "two", label: "Second", status: "not-run" },
    ]);
  });

  test("a failing step records failed and rethrows, leaving later steps not-run", async () => {
    const report = createStepReport(DEFS);
    await assert.rejects(
      () => report.run("one", async () => { throw new Error("boom"); }),
      /boom/,
    );
    assert.deepEqual(report.steps(), [
      { id: "one", label: "First", status: "failed" },
      { id: "two", label: "Second", status: "not-run" },
    ]);
  });

  test("skip distinguishes deliberately-inapplicable from blocked", async () => {
    const report = createStepReport(DEFS);
    report.skip("one");
    assert.equal(report.steps()[0].status, "skipped");
    assert.equal(report.steps()[1].status, "not-run");
  });

  test("run returns the wrapped value", async () => {
    const report = createStepReport(DEFS);
    assert.equal(await report.run("one", async () => 42), 42);
  });

  test("an unknown id is a programming error, not a silent no-op", async () => {
    const report = createStepReport(DEFS);
    await assert.rejects(() => report.run("nope", async () => undefined), /Unknown step "nope"/);
    assert.throws(() => report.skip("nope"), /Unknown step "nope"/);
  });

  test("the remove steps match the four the dialog promises, in order", () => {
    assert.deepEqual(
      REMOVE_STEPS.map((step) => step.label),
      [
        "Caddyfile block removed",
        "Tunnel route removed",
        "Caddy validated and reloaded",
        "cloudflared-sites restarted",
      ],
    );
  });

  test("the add steps name the sites tunnel, never just the tunnel", () => {
    const labels = ADD_STEPS.map((step) => step.label).join(" ");
    assert.match(labels, /cloudflared-sites restarted/);
    assert.doesNotMatch(labels, /\bthe tunnel\b/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./stepReport` does not exist.

- [ ] **Step 3: Write the module**

Create `src/lib/stepReport.ts`:

```typescript
/**
 * Records what a mutating flow actually did, so the UI can report it without
 * ever implying a later step ran when it did not — PRODUCT.md Principle 2.
 *
 * Steps start as "not-run" rather than "ok", so a flow that throws before
 * reaching a step can never report that step as having succeeded. "skipped"
 * is deliberately distinct: it means the step did not apply (a reverse-proxy
 * site with no framework creates no directory), not that a failure blocked it.
 */

export type StepStatus = "ok" | "failed" | "skipped" | "not-run";

export interface StepDefinition {
  id: string;
  label: string;
}

export interface Step extends StepDefinition {
  status: StepStatus;
}

export interface StepReport {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  skip(id: string): void;
  steps(): Step[];
}

export function createStepReport(definitions: readonly StepDefinition[]): StepReport {
  const statuses = new Map<string, StepStatus>(definitions.map((step) => [step.id, "not-run"]));

  function assertKnown(id: string): void {
    if (!statuses.has(id)) throw new Error(`Unknown step "${id}"`);
  }

  return {
    async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
      assertKnown(id);
      try {
        const result = await fn();
        statuses.set(id, "ok");
        return result;
      } catch (error) {
        statuses.set(id, "failed");
        throw error;
      }
    },
    skip(id: string): void {
      assertKnown(id);
      statuses.set(id, "skipped");
    },
    steps(): Step[] {
      return definitions.map((step) => ({ ...step, status: statuses.get(step.id) ?? "not-run" }));
    },
  };
}

/** The four steps the remove dialog promises, in execution order. */
export const REMOVE_STEPS: readonly StepDefinition[] = [
  { id: "caddyfile", label: "Caddyfile block removed" },
  { id: "tunnel", label: "Tunnel route removed" },
  { id: "caddy", label: "Caddy validated and reloaded" },
  { id: "cloudflared", label: "cloudflared-sites restarted" },
];

/** The add flow's steps, in execution order. */
export const ADD_STEPS: readonly StepDefinition[] = [
  { id: "backup", label: "Configs backed up" },
  { id: "caddyfile", label: "Caddyfile block appended" },
  { id: "files", label: "Site directory created" },
  { id: "tunnel", label: "Tunnel route added" },
  { id: "caddy", label: "Caddy validated and reloaded" },
  { id: "cloudflared", label: "cloudflared-sites restarted" },
];
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/stepReport.ts src/lib/stepReport.test.ts
git commit -m "Add a pure step-report module for the mutating flows"
```

---

### Task 10: The delete route reports its steps and the host's state

**Files:**
- Modify: `src/routes/sites.ts:319-388` (the `/sites/:hostname/delete` handler)
- Test: `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `createStepReport`, `REMOVE_STEPS` from `src/lib/stepReport`.
- Produces: the success response gains `steps: Step[]`; the 500 response gains `steps: Step[]` and `rolledBack: boolean`. All existing fields (`removed`, `needsFileConfirm`, `sitePath`, `error`) are unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/routes/sites.test.ts`, inside the existing `describe("POST /sites/:hostname/delete")`:

```typescript
test("a successful removal reports all four steps as ok", async () => {
  const response = await request("/sites/blog.lyly.dev/delete", form({}));
  const body = await response.json();
  assert.deepEqual(
    body.steps.map((step: { id: string; status: string }) => [step.id, step.status]),
    [["caddyfile", "ok"], ["tunnel", "ok"], ["caddy", "ok"], ["cloudflared", "ok"]],
  );
});

test("a failed tunnel edit reports the failing step and leaves later steps not-run", async () => {
  // Reuse the mechanism the existing rollback test at "restores the Caddyfile
  // when the tunnel edit fails during remove" already uses: a tunnel config
  // with no `ingress` key makes removeIngressRule throw, after the Caddyfile
  // has already been rewritten.
  const response = await requestWithBrokenTunnelConfig("/sites/blog.lyly.dev/delete", form({}));
  assert.equal(response.status, 500);
  const body = await response.json();
  const byId = Object.fromEntries(body.steps.map((s: { id: string; status: string }) => [s.id, s.status]));
  assert.equal(byId.caddyfile, "ok");
  assert.equal(byId.tunnel, "failed");
  assert.equal(byId.caddy, "not-run");
  assert.equal(byId.cloudflared, "not-run");
  // caddyReloaded was still false, so the handler restored both files.
  assert.equal(body.rolledBack, true);
});

test("a failure after Caddy reloaded reports that the config was left in place", async () => {
  // The existing test "does not roll back once Caddy has already reloaded,
  // even if cloudflared then fails" builds its own app with a fake whose
  // restartCloudflared rejects. Build the same fake here.
  const response = await requestWithRejectingCloudflared("/sites/blog.lyly.dev/delete", form({}));
  assert.equal(response.status, 500);
  const body = await response.json();
  const byId = Object.fromEntries(body.steps.map((s: { id: string; status: string }) => [s.id, s.status]));
  assert.equal(byId.caddy, "ok");
  assert.equal(byId.cloudflared, "failed");
  assert.equal(body.rolledBack, false);
});
```

Both helper names above are placeholders for *inlining the existing setup*, not for new shared helpers: copy the arrangement from the two named tests already in this file (around `sites.test.ts:377` and `:388`) directly into these tests. Do not invent a new failure-injection mechanism — the fakes have no on-demand failure switch.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `body.steps` is undefined.

- [ ] **Step 3: Wrap the handler's steps**

In `src/routes/sites.ts`, add the import:

```typescript
import { REMOVE_STEPS, createStepReport } from "../lib/stepReport";
```

Inside the delete handler, create the report before the `try`, then wrap each step. Note that validate and reload share the `caddy` step, because that is what the dialog promises as one line:

```typescript
    const report = createStepReport(REMOVE_STEPS);
    let rolledBack = false;

    try {
      caddyfileContent = deps.fs.readFile(config.caddyfilePath);
      const existingSite = caddyfile.parseSites(caddyfileContent).find((site) => site.hostname === hostname);

      backupFile(config.caddyfilePath);
      backupFile(config.tunnelConfigPath);

      await report.run("caddyfile", () =>
        deps.commands.writeManagedConfig(config.caddyfilePath, caddyfile.removeSite(caddyfileContent!, hostname)),
      );

      tunnelContent = deps.fs.readFile(config.tunnelConfigPath);
      await report.run("tunnel", () =>
        deps.commands.writeManagedConfig(
          config.tunnelConfigPath,
          tunnelConfig.removeIngressRule(tunnelContent!, hostname),
        ),
      );

      await report.run("caddy", async () => {
        await deps.commands.validateCaddyfile(config.caddyfilePath);
        await deps.commands.reloadCaddy();
        caddyReloaded = true;
      });

      await report.run("cloudflared", () => deps.commands.restartCloudflared());
```

Add `steps: report.steps()` to both success responses:

```typescript
      if (wantsFileDelete && filesPath) {
        res.json({ removed: true, needsFileConfirm: true, sitePath: filesPath, steps: report.steps() });
        return;
      }

      res.json({ removed: true, needsFileConfirm: false, steps: report.steps() });
```

In the `catch`, set `rolledBack = true` inside the successful rollback branch (right after the existing `logAction({ action: "remove-site-rolled-back", hostname })`), and add both fields to each error response:

```typescript
          res.status(500).json({
            error: `${message}\n\nAdditionally, restoring the original config failed: ${rollbackMessage}\n\nManual recovery needed — backups are in ${config.backupDir}.`,
            steps: report.steps(),
            rolledBack: false,
          });
          return;
```

and

```typescript
      res.status(500).json({ error: message, steps: report.steps(), rolledBack });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including every pre-existing delete test — the change is additive.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sites.ts src/routes/sites.test.ts
git commit -m "Report the remove flow's steps and whether the config was restored"
```

---

### Task 11: The add route reports its steps

**Files:**
- Modify: `src/routes/sites.ts:178-300` (the `POST /sites` handler)
- Test: `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `createStepReport`, `ADD_STEPS` from `src/lib/stepReport`.
- Produces: success and 500 responses gain `steps: Step[]`. All existing fields unchanged.

- [ ] **Step 1: Write the failing tests**

```typescript
test("a static site reports every step as ok", async () => {
  const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
  const body = await response.json();
  assert.ok(body.steps.every((step: { status: string }) => step.status === "ok"));
});

test("a plain reverse-proxy site skips the directory step rather than failing it", async () => {
  const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "reverse-proxy", port: "4100" }));
  const body = await response.json();
  const files = body.steps.find((step: { id: string }) => step.id === "files");
  assert.equal(files.status, "skipped");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `body.steps` is undefined.

- [ ] **Step 3: Wrap the handler's steps**

Create the report before the `try` in the `POST /sites` handler:

```typescript
    const report = createStepReport(ADD_STEPS);
```

Then wrap each numbered step already marked in the handler's comments. The backup pair becomes one step; the conditional directory work uses `skip` when it does not apply:

```typescript
      await report.run("backup", async () => {
        backupFile(config.caddyfilePath);
        backupFile(config.tunnelConfigPath);
      });

      await report.run("caddyfile", () =>
        deps.commands.writeManagedConfig(
          config.caddyfilePath,
          caddyfile.appendSite(caddyfileContent!, { hostname, type, target, framework, healthcheckPath }),
        ),
      );

      if (type === "static") {
        await report.run("files", async () => {
          await deps.commands.createSiteDirectory(hostname);
          deps.fs.writeFile(path.join(sitePath, "index.html"), PLACEHOLDER_INDEX_HTML(hostname));
        });
      } else if (framework) {
        await report.run("files", async () => {
          const scaffold = getFrameworkScaffold(framework, port, hostname, config.sitesRoot, healthcheckPath ?? "/");
          if (!scaffold) return;
          await deps.commands.createSiteDirectory(hostname);
          deps.fs.writeFile(path.join(sitePath, "Dockerfile"), scaffold.dockerfile);
          deps.fs.writeFile(path.join(sitePath, "docker-compose.yml"), scaffold.compose);
          deps.fs.writeFile(path.join(sitePath, ".dockerignore"), scaffold.dockerignore);
        });
      } else {
        // A plain reverse-proxy site has no directory to create. This is not a
        // blocked step, so it must not report as not-run.
        report.skip("files");
      }

      await report.run("tunnel", () =>
        deps.commands.writeManagedConfig(
          config.tunnelConfigPath,
          tunnelConfig.addIngressRule(tunnelContent!, hostname, "http://localhost:80"),
        ),
      );

      await report.run("caddy", async () => {
        await deps.commands.validateCaddyfile(config.caddyfilePath);
        await deps.commands.reloadCaddy();
        caddyReloaded = true;
      });

      await report.run("cloudflared", () => deps.commands.restartCloudflared());
```

Add `steps: report.steps()` to the success `res.json({ added: true, ... })` and to both error responses in the `catch`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, including all pre-existing add tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/sites.ts src/routes/sites.test.ts
git commit -m "Report the add flow's steps"
```

---

### Task 12: The dialog stays open and becomes the result surface

`public/app.js:57` closes the dialog before the fetch, which is why progress has nowhere to live and the toast lands over the workflow block.

**Files:**
- Modify: `src/views/html.ts:583` (the four-step `<ol>`)
- Modify: `public/app.js:56-95` (the confirm-remove handler)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `steps` and `rolledBack` from Task 10's response.
- Produces: `id="confirm-remove-steps"` on the `<ol>`, and `data-step-id="<id>"` on each `<li>`, matching `REMOVE_STEPS` ids. `id="confirm-remove-outcome"` on a new region for the error text and host-state line.

- [ ] **Step 1: Write the failing test**

```typescript
test("the step list is addressable per step and reads as an ordered column", () => {
  const html = renderSiteDetail(STATIC_SITE, OPTS);
  const list = tagById(html, "confirm-remove-steps");
  // An ordered sequence is a column; the 2x2 grid was the layout for peers.
  assert.doesNotMatch(list, /sm:grid-cols-2/);
  for (const id of ["caddyfile", "tunnel", "caddy", "cloudflared"]) {
    assert.match(html, new RegExp(`data-step-id="${id}"`));
  }
  assert.ok(tagById(html, "confirm-remove-outcome"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — the `<ol>` has no id and no per-step ids.

- [ ] **Step 3: Make the list addressable**

Replace the `<ol>` in `src/views/html.ts` and add the outcome region beneath the fail-closed sentence:

```html
      <ol id="confirm-remove-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
        <li class="flex gap-2" data-step-id="caddyfile"><span class="text-stone-400 shrink-0">1.</span><span>Caddyfile block removed</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="tunnel"><span class="text-stone-400 shrink-0">2.</span><span>Tunnel route removed</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="caddy"><span class="text-stone-400 shrink-0">3.</span><span>Caddy validated and reloaded</span><span class="step-mark ml-auto shrink-0"></span></li>
        <li class="flex gap-2" data-step-id="cloudflared"><span class="text-stone-400 shrink-0">4.</span><span>cloudflared-sites restarted</span><span class="step-mark ml-auto shrink-0"></span></li>
      </ol>
      <p class="text-stone-400 text-[0.75rem] leading-snug m-0 mb-4">If a step fails, the ones after it don't run.</p>
      <div id="confirm-remove-outcome" class="hidden font-mono text-[0.72rem] text-red-300 bg-red-950/40 border border-red-800/50 rounded-md px-2.5 py-2 leading-snug m-0 mb-4 whitespace-pre-wrap"></div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Keep the dialog open through execution**

In `public/app.js`, rewrite the confirm handler. Remove the `confirmRemoveDialog?.close()` call at the top, disable the buttons during flight, mark the steps from the response, and only close on success:

```javascript
const STEP_MARKS = { ok: "✓", failed: "✗", skipped: "—", "not-run": "·" };
const STEP_MARK_CLASSES = {
  ok: "text-green-300",
  failed: "text-red-300",
  skipped: "text-stone-400",
  "not-run": "text-stone-400",
};

// Takes the list id so Task 14's add-site list can reuse it unchanged.
function markSteps(listId, steps) {
  for (const step of steps ?? []) {
    const row = document.querySelector(`#${listId} [data-step-id="${step.id}"]`);
    const mark = row?.querySelector(".step-mark");
    if (!mark) continue;
    mark.textContent = STEP_MARKS[step.status] ?? "";
    mark.className = `step-mark ml-auto shrink-0 ${STEP_MARK_CLASSES[step.status] ?? ""}`;
  }
}

function setRemoveBusy(busy, hostname) {
  const submit = document.getElementById("confirm-remove-submit");
  const cancel = document.querySelector('[data-close-dialog="confirm-remove-dialog"]');
  if (submit) {
    submit.disabled = busy;
    submit.textContent = busy ? `Removing ${hostname}…` : submit.textContent;
  }
  if (cancel) cancel.disabled = busy;
}
```

Then the handler body:

```javascript
document.getElementById("confirm-remove-submit")?.addEventListener("click", async (event) => {
  if (deleteInFlight) return;
  const hostname = event.currentTarget.dataset.hostname;
  if (!hostname) return;

  const deleteFilesChecked = confirmRemoveDeleteFilesCheckbox?.checked ?? false;
  const outcome = document.getElementById("confirm-remove-outcome");

  deleteInFlight = true;
  setRemoveBusy(true, hostname);
  outcome?.classList.add("hidden");
  try {
    const response = await fetch(`/sites/${encodeURIComponent(hostname)}/delete`, {
      method: "POST",
      body: new URLSearchParams({ deleteFiles: deleteFilesChecked ? "on" : "" }),
    });
    const result = await response.json();
    markSteps("confirm-remove-steps", result.steps);

    if (!response.ok) {
      // The dialog stays open: it stated the four steps, so it is where the
      // outcome belongs. Say what the host's state is now — a failure before
      // Caddy reloaded is rolled back, one after it is not.
      const state = result.rolledBack
        ? "The original Caddyfile and tunnel config were restored."
        : "Caddy had already reloaded, so the edited config is live and was left in place.";
      if (outcome) {
        outcome.textContent = `${result.error ?? "Failed to remove site"}\n\n${state}`;
        outcome.classList.remove("hidden");
      }
      return;
    }

    if (!result.needsFileConfirm) {
      window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
      return;
    }

    const filesResponse = await fetch(`/sites/${encodeURIComponent(hostname)}/delete-files`, { method: "POST" });
    const filesResult = await filesResponse.json();
    if (!filesResponse.ok) {
      if (outcome) {
        outcome.textContent = `Removed ${hostname} from Caddy and the sites tunnel, but deleting its files failed:\n${filesResult.error ?? "unknown error"}\n\nThe site is no longer served. Its files are still on disk.`;
        outcome.classList.remove("hidden");
      }
      return;
    }
    window.location.href = `/?removed=${encodeURIComponent(hostname)}`;
  } catch (error) {
    if (outcome) {
      outcome.textContent = error.message;
      outcome.classList.remove("hidden");
    }
  } finally {
    deleteInFlight = false;
    setRemoveBusy(false, hostname);
  }
});
```

- [ ] **Step 6: Verify both paths in the browser**

Run `npm run dev:mock`. Remove a site and confirm the dialog stays open, the buttons disable, and navigation happens on success. The mock fakes do not fail on demand, so verify the failure rendering by temporarily forcing the `!response.ok` branch — revert that before committing.

- [ ] **Step 7: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts public/app.js
git commit -m "Keep the remove dialog open and report each step's real outcome"
```

---

### Task 13: The DNS reminder becomes a page notice

`app.js:48` fires the terminal reminder as kind `"success"`, which auto-dismisses after 4000ms and renders without a close button — against DESIGN.md's rule that a banner carrying an unfinished manual action is persistent, never timed.

**Files:**
- Modify: `src/views/html.ts:44-53` (`renderSiteList` signature and its `layout` call)
- Modify: `src/routes/sites.ts:80-90` (`GET /`)
- Modify: `public/app.js:46-50` (remove the client-side reminder)
- Test: `src/views/html.test.ts`, `src/routes/sites.test.ts`

**Interfaces:**
- Consumes: `layout`'s existing `banner?: Banner` option, which renders `#page-notice`.
- Produces: `renderSiteList(sites, statuses, error?, nav?, notice?)` — a fifth optional parameter. Existing callers are unaffected.

- [ ] **Step 1: Write the failing tests**

```typescript
test("the removal reminder renders in flow, not as a timed toast", () => {
  const html = renderSiteList([], {}, undefined, { page: "sites" }, "Removed blog.lyly.dev. Remember to remove the DNS record in Cloudflare manually.");
  const notice = tagById(html, "page-notice");
  assert.ok(notice);
  assert.match(html, /Remember to remove the DNS record/);
  // It must be dismissible rather than vanishing on a timer.
  assert.ok(tagById(html, "page-notice-close"));
});

test("no notice renders without one", () => {
  const html = renderSiteList([], {}, undefined, { page: "sites" });
  assert.doesNotMatch(html, /id="page-notice"/);
});
```

And in `src/routes/sites.test.ts`:

```typescript
test("GET / states the DNS reminder after a removal", async () => {
  const response = await request("/?removed=blog.lyly.dev");
  const html = await response.text();
  assert.match(html, /id="page-notice"/);
  assert.match(html, /Remember to remove the DNS record/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `renderSiteList` takes no notice, and `GET /` ignores `removed`.

- [ ] **Step 3: Thread the notice through**

In `src/views/html.ts`, add the parameter and pass it to `layout`:

```typescript
export function renderSiteList(
  sites: Site[],
  statuses: Record<string, SiteStatus>,
  error?: string,
  nav: Nav = { page: "sites" },
  // A removal's DNS reminder is a page-load notice carrying an unfinished
  // manual action, so it belongs in flow with a close button — not in the
  // transient toast, which times out after four seconds.
  notice?: string,
): string {
```

and in its `layout(...)` call, add `banner: notice ? { message: notice } : undefined` to the options object.

In `src/routes/sites.ts`, read the query in `GET /`:

```typescript
  sitesRouter.get("/", async (req, res) => {
    const removed = typeof req.query.removed === "string" ? req.query.removed : undefined;
    const notice = removed
      ? `Removed ${removed}. Remember to remove the DNS record in Cloudflare manually.`
      : undefined;
    try {
      const content = deps.fs.readFile(config.caddyfilePath);
      const sites = caddyfile.parseSites(content).filter((site) => isManagedHostname(site.hostname));

      res.send(renderSiteList(sites, await computeStatuses(sites, deps), undefined, { page: "sites" }, notice));
    } catch (error) {
      const message = error instanceof CommandError ? `${error.message}\n${error.stderr}` : String(error);
      res.status(500).send(renderSiteList([], {}, message));
    }
  });
```

In `public/app.js`, delete the `removedHostname` block at lines 46-50 entirely — the server renders this now. Keep the `history.replaceState` for `?created=1`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts src/routes/sites.ts src/routes/sites.test.ts public/app.js
git commit -m "Render the removal DNS reminder as a persistent page notice"
```

---

### Task 14: The add flow states its mechanism

**Files:**
- Modify: `src/views/html.ts:101-165` (`renderAddSite`)
- Modify: `public/app.js:140-175` (the submit handler)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `ADD_STEPS` from `src/lib/stepReport` — import it into `html.ts` so the list and the route cannot drift.
- Produces: `id="add-site-steps"` with `data-step-id` per row, mirroring Task 12's markup.

- [ ] **Step 1: Write the failing test**

```typescript
test("the add form states its steps in execution order", () => {
  const html = renderAddSite(SITES, "lyly.dev", {});
  const list = tagById(html, "add-site-steps");
  assert.ok(list);
  for (const id of ["backup", "caddyfile", "files", "tunnel", "caddy", "cloudflared"]) {
    assert.match(html, new RegExp(`data-step-id="${id}"`));
  }
  assert.match(html, /If a step fails, the ones after it don't run\./);
  assert.match(html, /cloudflared-sites restarted/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — no step list exists on the add page.

- [ ] **Step 3: Render the step list**

Import `ADD_STEPS` in `src/views/html.ts` and render the list beneath the submit button, generated from the same constant the route uses:

```typescript
const addStepList = `
      <div class="mt-5">
        <p class="${CARD_LABEL}">On submit</p>
        <ol id="add-site-steps" class="font-mono text-[0.75rem] text-stone-400 m-0 mb-3 p-0 list-none grid gap-y-1.5">
          ${ADD_STEPS.map(
            (step, index) =>
              `<li class="flex gap-2" data-step-id="${step.id}"><span class="text-stone-400 shrink-0">${index + 1}.</span><span>${escapeHtml(step.label)}</span><span class="step-mark ml-auto shrink-0"></span></li>`,
          ).join("")}
        </ol>
        <p class="text-stone-400 text-[0.75rem] leading-snug m-0">If a step fails, the ones after it don't run.</p>
      </div>`;
```

Place `${addStepList}` after the submit button inside the form's container.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Add in-flight feedback to the submit handler**

`markSteps(listId, steps)` already exists from Task 12 and needs no change — it takes the list id precisely so this task can reuse it.

In `public/app.js`'s add handler, after `addSiteInFlight = true;`:

```javascript
  const submitButton = addSiteForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  showBanner(`Adding ${hostname} — reloading Caddy and restarting cloudflared-sites…`, "info");
```

and in the `catch`, alongside the existing `addSiteInFlight = false;`:

```javascript
    if (submitButton) submitButton.disabled = false;
    hideBanner();
    markSteps("add-site-steps", error.steps);
```

To make `error.steps` available, capture the parsed body before throwing:

```javascript
    const result = await response.json();
    if (!response.ok) {
      markSteps("add-site-steps", result.steps);
      throw new Error(result.error ?? "Failed to add site");
    }
```

Leave `addSiteInFlight = true` on the success path — the existing comment at `app.js:160` explains why, and that reasoning is unchanged.

- [ ] **Step 6: Make the banner opaque**

In `src/views/shell.ts:67`, drop the `/60` from the in-flight banner's background so it is not translucent over the workflow block. Change `bg-rose-950/60` to `bg-rose-950` in the banner base, and make the same change in `public/app.js`'s `showBanner` class lists so the two agree.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
git add src/views/html.ts src/views/html.test.ts src/views/shell.ts public/app.js
git commit -m "State the add flow's mechanism and give it in-flight feedback"
```

---

### Task 15: The hostname field carries its own constraint

`html.ts:121` has no `pattern`, no `title`, and no `aria-describedby` — only a placeholder — so the `*.lyly.dev` rule is discoverable today only by failing.

**Files:**
- Modify: `src/views/html.ts:118-125` (the hostname field)
- Modify: `public/app.js:140-150` (compose the submitted value)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: the `domain` parameter already passed to `renderAddSite`.
- Produces: the input's value is the subdomain label only; the client composes `<label>.<domain>` before POSTing. Server-side validation in `sites.ts` is unchanged and still authoritative.

- [ ] **Step 1: Write the failing test**

```typescript
test("the hostname field affixes the domain instead of hiding it in a placeholder", () => {
  const html = renderAddSite(SITES, "lyly.dev", {});
  const input = tagById(html, "hostname-field");
  assert.match(html, /id="hostname-suffix"[^>]*>\.lyly\.dev</);
  assert.match(input, /aria-describedby="[^"]*hostname-suffix/);
});
```

The input at `html.ts:121` has no `id` today, so adding `id="hostname-field"` is part of this task, not a conditional.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Affix the domain**

Wrap the input and a suffix in a flex row inside the existing label, so the suffix reads as part of the field:

```html
<span class="flex items-stretch">
  <input type="text" id="hostname-field" name="hostname" required autocomplete="off"
         aria-describedby="hostname-suffix"
         class="${INPUT} rounded-r-none flex-1 min-w-0" placeholder="blog" />
  <span id="hostname-suffix" class="font-mono text-[0.72rem] text-stone-300 bg-stone-700 border border-l-0 border-stone-700 rounded-r-md px-2.5 flex items-center shrink-0">.${escapeHtml(domain)}</span>
</span>
```

- [ ] **Step 4: Compose the value on submit**

In `public/app.js`, change the hostname read so the label becomes a full hostname:

```javascript
  const domain = document.getElementById("hostname-suffix")?.textContent?.replace(/^\./, "") ?? "";
  const label = String(formData.get("hostname") ?? "").trim().replace(/\.$/, "");
  const hostname = label.endsWith(`.${domain}`) || label === domain ? label : `${label}.${domain}`;
```

The server still rejects anything that is not a subdomain of the configured domain, so a pasted full hostname keeps working.

- [ ] **Step 5: Run the tests and verify in the browser**

```bash
npm test
```

Run `npm run dev:mock`, type `blog` into the field, and confirm the created site is `blog.lyly.dev`. Also paste `blog.lyly.dev` and confirm it is not doubled.

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts public/app.js
git commit -m "Affix the managed domain to the hostname field"
```

---

## Increment 4 — Copy, terminology, accessibility

### Task 16: Terminology and one destination, one name

**Files:**
- Modify: `src/views/html.ts:399` ("restarts the tunnel")
- Modify: `src/views/html.ts:89` (the list heading)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

```typescript
test("the Danger card names the sites tunnel, not the tunnel", () => {
  const body = withoutHeader(renderSiteDetail(STATIC_SITE, OPTS));
  assert.match(body, /restarts the sites tunnel/);
  assert.doesNotMatch(body, /then restarts the tunnel\b/);
});

test("one destination has one name", () => {
  const body = withoutHeader(renderSiteList(SITES, {}));
  assert.doesNotMatch(body, /Existing sites/);
  assert.match(body, /<h2[^>]*>Sites<\/h2>/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Fix the copy**

At `html.ts:399`, change "then restarts the tunnel." to "then restarts the sites tunnel."

At `html.ts:89`, change the heading text "Existing sites" to "Sites". Confirm the `<title>` already reads "Sites"; if it does not, align it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Name the sites tunnel and give the list one name"
```

---

### Task 17: Copy buttons keep their own names

`app.js:236` overwrites each button's specific label with a generic `"Copy to clipboard"` on reset, and two buttons ship as `"Copy command"` from the start.

**Files:**
- Modify: `public/app.js:215-243` (the copy handler)
- Modify: `src/views/html.ts:322` (the two `Copy command` labels)
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: each copy button's initial `aria-label` is distinct and is restored after the 1500ms reset.

- [ ] **Step 1: Write the failing test**

```typescript
test("copy buttons are distinguishable by name", () => {
  const html = renderSiteDetail(NEXT_SITE, OPTS);
  const labels = [...html.matchAll(/aria-label="(Copy [^"]*)"/g)].map((match) => match[1]);
  assert.ok(labels.length >= 2, "expected at least two copy buttons");
  assert.equal(new Set(labels).size, labels.length, `duplicate copy labels: ${labels.join(", ")}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — two buttons share `Copy command`.

- [ ] **Step 3: Give the two buttons distinct names**

`commandBlock` at `html.ts:319` hardcodes the label, so every command block it renders shares one name:

```typescript
function commandBlock(id: string, value: string, cwd?: string): string {
  return `<div class="relative">
              <pre id="${id}" class="${CODE_LINE}">${escapeHtml(value)}</pre>
              ${copyButton(id, "Copy command", COPY_IN_LINE)}
```

Give it a label parameter and pass a specific one at each call site:

```typescript
function commandBlock(id: string, value: string, label: string, cwd?: string): string {
  return `<div class="relative">
              <pre id="${id}" class="${CODE_LINE}">${escapeHtml(value)}</pre>
              ${copyButton(id, label, COPY_IN_LINE)}
```

Update all three call sites — the manual steps' DNS command becomes `Copy DNS command`, Deploy's by-hand alternative becomes `Copy docker compose command`, and the request path's failure hint becomes `Copy logs command`. Note `cwd` moves to the fourth parameter, so every existing call that passes it must be updated.

- [ ] **Step 4: Restore the original label instead of a generic one**

In `public/app.js`, capture the label before changing it and restore that value:

```javascript
    const originalLabel = button.getAttribute("aria-label") ?? "Copy to clipboard";
```

Place this at the top of the click handler, before the `try`. Then in the `setTimeout` reset, restore it:

```javascript
    setTimeout(() => {
      button.setAttribute("aria-label", originalLabel);
      if (copyStatus) copyStatus.textContent = "";
      idleIcon?.classList.remove("hidden");
      copiedIcon?.classList.add("hidden");
    }, 1500);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts public/app.js
git commit -m "Keep each copy button's own name through its reset"
```

---

### Task 18: The status dot is decoration, and port conflicts are announced

The `●` is read aloud as part of the link name, and `#port-error` is an `aria-describedby` target while `display:none`, so the live port validation is silent for a screen reader until submit.

**Files:**
- Modify: `src/views/html.ts:60`, `:231`, `:524` (the `●` glyphs)
- Modify: `src/views/html.ts` — the `#port-error` element
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing tests**

```typescript
test("the status dot is not part of any accessible name", () => {
  const html = renderSiteList(SITES, { "api.lyly.dev": { kind: "tcp", responding: false } });
  const dots = [...html.matchAll(/<span[^>]*>&#9679;/g)];
  assert.ok(dots.length > 0, "no status dot was rendered");
  for (const dot of dots) {
    assert.match(dot[0], /aria-hidden="true"/);
  }
});

test("a port conflict is announced, not just shown", () => {
  const error = tagById(renderAddSite(SITES, "lyly.dev", {}), "port-error");
  assert.match(error, /aria-live="polite"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL

- [ ] **Step 3: Hide the dot and announce the error**

At each of the three `●` sites, wrap the glyph in its own `aria-hidden` span rather than marking the whole pill hidden — the pill's text is the real status and must stay in the accessible name:

```html
<span class="${TONE_PILL[labels.tone]}"><span aria-hidden="true">&#9679;</span> ${escapeHtml(labels.pill)}</span>
```

Give `#port-error` (`html.ts:148`) a live region, preserving its existing classes exactly — `port-error` is a hook `public/app.js` and the stylesheet both use, and the size is already on the ramp:

```html
<span id="port-error" class="port-error hidden text-red-300 text-[0.8rem]" role="status" aria-live="polite"></span>
```

Keep the `aria-describedby="port-error"` on the port input — with a live region the announcement now comes from the region itself when it fills.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/html.ts src/views/html.test.ts
git commit -m "Hide the status dot from assistive tech and announce port conflicts"
```

---

## Final verification

### Task 19: Re-derive the design system and re-measure

**Files:**
- Modify: `DESIGN.md`, `.impeccable/design.json` — written by `/impeccable document`, never by hand.

- [ ] **Step 1: Run the full suite and build**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 2: Re-derive DESIGN.md and its sidecar**

Run `/impeccable document`. This is mandatory per CLAUDE.md: the token values moved, so the committed design system now describes sizes the code no longer uses. Expect it to also record `0.75rem` and `0.7rem`, which were already in the code but absent from `DESIGN.md`.

- [ ] **Step 3: Commit the re-derived system**

```bash
git add DESIGN.md .impeccable/design.json
git commit -m "Re-derive DESIGN.md after the type ramp change"
```

- [ ] **Step 4: Re-measure against the baseline**

Run `/impeccable critique src/views/html.ts`. The baseline is **25/40** with 1 P0 and 2 P1s, recorded at `.impeccable/critique/2026-08-24T22-36-04Z__src-views-html-ts.md`. Report the new score and any issue that did not move.

- [ ] **Step 5: Commit the new snapshot**

```bash
git add .impeccable/critique/
git commit -m "Record the post-remediation critique snapshot"
```

---

## Not in this plan

**Tailwind source scoping.** Tailwind v4 compiles class strings out of `docs/superpowers/plans/*.md` into the shipped bundle; scoping to `source(none)` plus `@source` for `src` and `public` drops it from 38049 to 29589 bytes. Per CLAUDE.md this is a mechanical config value change, so it is a direct edit to `src/styles/tailwind.css` verified by `typecheck`/`build`/`lint` — no plan task. Note that doing this will change `public/style.css`, which is gitignored.

**Minor observations**, left for `/impeccable polish`: the not-found page's third container width, the synthesized italic on the empty state, the 120px `DETAIL_KEY` column, the missing favicon, the mono sentence inside the framework `<select>`, and the `bg-stone-900` switcher panel.

**Features, not remediation:** whether hop 2 should check itself via `systemctl is-active cloudflared-sites`, and whether static sites should get a status verdict from a `HEAD` request carrying the right `Host:` header.
