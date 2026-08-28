# Button Weight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the secondary button a filled object instead of a near-invisible outline, give every button a resting height that flex cannot stretch, add a press state, and record all of it — plus the previously undocumented icon-composition rule — in `DESIGN.md` and its sidecar.

**Architecture:** All three button treatments live as Tailwind class constants in `src/views/shared.ts`. Every call site consumes them by reference, so Tasks 1–3 change one source file and its tests, with **no edits to any call site in `html.ts`**. Tasks 4–5 then bring `DESIGN.md` and `.impeccable/design.json` back in line, because the sidecar drifts silently and nothing fails when it does.

**Tech Stack:** TypeScript, server-rendered HTML, Tailwind v4 (`src/styles/tailwind.css`, `source(none)` + explicit `@source` for `src` and `public`), Node's built-in test runner via `tsx --test`.

**Spec:** The rendered comparison and its recommendation — https://claude.ai/code/artifact/e54fa7fa-2fe4-4690-abbd-7850470a9b5b (section "What I'd build"). Read it before Task 1; the four rejected variants explain why this shape and not another.

## Global Constraints

- **`DESIGN.md` is normative.** Extend it; do not reopen its decisions as part of this change.
- **The danger button does not change** except for the shared height and motion work in Tasks 2 and 3. Its colours, border, and one-size-down relationship to the primary are deliberate and stay exactly as they are.
- **The corner radius does not change.** 6px (`rounded-md`) for all three, per The Radius-Says-Size Rule: *"10px contains, 6px is controlled, 4px is inline, round states one word."*
- **Tone, never opacity.** Disabled states say "not actionable" by moving in the palette. Never add `disabled:opacity-*`.
- **Motion is gated.** Every transition and transform must carry the `motion-safe:` prefix. `src/views/html.test.ts` already asserts `doesNotMatch(html, /(?<!motion-safe:)transition-colors/)` — do not defeat it.
- **Colour tokens (Tailwind name = `DESIGN.md` name):** `stone-900` Hearth · `stone-800` Hearth Lift · `stone-700` Hairline · `stone-600` Hairline Strong · `stone-500` Smoke Deep · `stone-400` Smoke · `stone-50` Chalk · `rose-400` Ember · `rose-300` Ember Light · `red-300` Scorch · `red-800` Scorch Border · `red-900` Scorch Rule.
- **Verification commands:** `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. All four must pass before any commit.
- This plan lives under `docs/`, which `.github/scripts/deploy-needed.sh` treats as deploy-skippable and which `tailwind.css` excludes from the CSS build. Committing it will not deploy or change the bundle.

---

## File Structure

| File | Responsibility in this change |
|---|---|
| `src/views/shared.ts` | The three button class constants. **The only source file Tasks 1–3 modify.** |
| `src/views/html.test.ts` | Existing button assertions live in the `describe` block around lines 1195–1225. New assertions join it. |
| `DESIGN.md` | Frontmatter `components:` entries for `button-secondary` / `button-secondary-hover`; the Neutral colour bullets for Hairline and Hairline Strong; the `## Components → ### Buttons` prose; a new named rule in the Shapes section. |
| `.impeccable/design.json` | `components[]` entries "Primary Button", "Secondary Button", "Danger Button"; `narrative.rules[]` gains the new rule. **Rule bodies are derived from the `DESIGN.md` prose, never written independently.** |

No call site in `src/views/html.ts` changes. If a task tempts you to edit `html.ts`, stop — the constants are doing their job and something has gone wrong.

---

## Task 1: The secondary becomes a filled object

The complaint that started this: today's secondary is a Smoke label inside a Hairline Strong outline measuring **2.29:1 against Hearth and 1.99:1 against Hearth Lift** — faintest in the confirm-remove dialog, which is exactly where it sits beside the irreversible action. Filling it with the same Hairline Strong fixes it without introducing a new colour, because a 1px line and a filled rectangle need completely different amounts of contrast to register.

The hover **recedes** to Hairline rather than brightening. Chalk on Hairline is 9.85:1; brightening to Smoke Deep would have been 4.61:1, the weakest ratio anywhere in this system.

Disabled deliberately keeps `bg-transparent`: an enabled secondary is a solid object and a disabled one dissolves into the page, which is a stronger signal than today's text-tone-only change — and it preserves the existing `disabled:hover:bg-transparent` guard unchanged.

**Files:**
- Modify: `src/views/shared.ts` — `BUTTON_SECONDARY`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `BUTTON_SECONDARY` string constant, exported from `src/views/shared.ts`, containing `bg-stone-600`, `text-stone-50`, `border-none`, `hover:bg-stone-700`. Tasks 2 and 3 add to this same constant.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/html.test.ts`, inside the existing `describe` block that contains the "a disabled control's hover fill cannot survive underneath it" test:

```typescript
  test("the secondary is a filled object, not an outline", () => {
    // Measured: a Hairline Strong 1px outline is 2.29:1 on Hearth and 1.99:1
    // on Hearth Lift — invisible as a line, unmistakable as a surface. Same
    // token, different amount of it.
    assert.match(BUTTON_SECONDARY, /\bbg-stone-600\b/);
    assert.match(BUTTON_SECONDARY, /\btext-stone-50\b/);
    assert.match(BUTTON_SECONDARY, /\bborder-none\b/);
    assert.doesNotMatch(BUTTON_SECONDARY, /\bborder-stone-600\b/);
  });

  test("the secondary's hover recedes toward the ground, it does not brighten", () => {
    // Chalk on Hairline is 9.85:1. Brightening to Smoke Deep would have been
    // 4.61:1 — inside AA, but the weakest ratio in a system that runs 6-9:1.
    // Asserted as a property (hover step is darker than rest) rather than a
    // literal, so the direction survives a future retune of either token.
    const rest = BUTTON_SECONDARY.match(/\bbg-stone-(\d+)\b/);
    const hover = BUTTON_SECONDARY.match(/\bhover:bg-stone-(\d+)\b/);
    assert.ok(rest, "secondary has no resting stone fill");
    assert.ok(hover, "secondary has no stone hover fill");
    assert.ok(
      Number(hover[1]) > Number(rest[1]),
      `hover fill stone-${hover[1]} should be darker than rest fill stone-${rest[1]}`,
    );
  });

  test("a disabled secondary dissolves into the page rather than staying solid", () => {
    // The enabled/disabled distinction is now fill-versus-none, which is a
    // louder signal than the text-tone change it used to be.
    assert.match(BUTTON_SECONDARY, /disabled:bg-transparent/);
    assert.match(BUTTON_SECONDARY, /disabled:hover:bg-transparent/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test 2>&1 | grep -A5 "filled object"
```

Expected: FAIL. The first test fails on `bg-stone-600` not being present; the second fails on `rest` being `null`; the third fails on `disabled:bg-transparent`.

- [ ] **Step 3: Rewrite `BUTTON_SECONDARY`**

In `src/views/shared.ts`, replace the whole `BUTTON_SECONDARY` assignment with:

```typescript
export const BUTTON_SECONDARY =
  "font-sans font-semibold text-sm bg-stone-600 text-stone-50 border-none rounded-md px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-stone-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-stone-500 disabled:bg-transparent disabled:hover:bg-transparent";
```

Note what is deliberately *unchanged*: `rounded-md`, the focus ring, `disabled:text-stone-500`, and `gap-1.5`. Height comes in Task 2 — leave `px-4 py-2.5` alone for now.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | tail -20
```

Expected: PASS, with no other test regressing. The pre-existing "a disabled control's hover fill cannot survive underneath it" test still passes because `disabled:hover:bg-transparent` is retained.

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev:mock
```

Open `http://127.0.0.1:8787/sites/new` (credentials `dev` / `dev`). The Cancel button is now a solid grey object beside the Ember "Add site". Open `http://127.0.0.1:8787/sites/app.lyly.dev` and click "Remove site": in the dialog, Cancel is solid and "Remove app.lyly.dev" is still an outline. Confirm the two no longer read as the same kind of control.

- [ ] **Step 6: Commit**

```bash
git add src/views/shared.ts src/views/html.test.ts
git commit -m "feat: make the secondary button a filled object

A Hairline Strong 1px outline measures 2.29:1 on Hearth and 1.99:1 on
Hearth Lift — faintest in the confirm-remove dialog, beside the one
irreversible action. Same token as a fill instead of a line, so no new
colour enters the palette. Hover recedes to Hairline (9.85:1) rather
than brightening to Smoke Deep (4.61:1)."
```

---

## Task 2: One resting height that flex cannot stretch

Measured on the live DOM, the app has **no button height** — heights are emergent, because every footer is a plain `flex` row and the browser's default `align-items: stretch` resizes the shortest sibling:

| Component | Where | Height |
|---|---|---|
| Primary | list header | 40.0px |
| Primary | add-site footer | 42.0px |
| Secondary | add-site footer | 42.0px |
| Danger | Danger card | 33.2px |
| Danger | confirm dialog footer | **42.0px** |

That last row silently breaks a rule the system already wrote down — the danger button is supposed to be *"one size down from primary — never the largest control on screen."* In the dialog it is exactly as tall as Cancel.

An explicit `height` wins over `align-items: stretch`, because stretch only applies when the cross size is `auto`. So replacing the vertical padding with a fixed height fixes every row at once, with no change to any flex container.

**Files:**
- Modify: `src/views/shared.ts` — `BUTTON_PRIMARY`, `BUTTON_SECONDARY`, `BUTTON_DANGER`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: `BUTTON_SECONDARY` from Task 1, already carrying `bg-stone-600 text-stone-50 border-none hover:bg-stone-700`.
- Produces: all three constants carry an `h-*` class and no `py-*` class. `BUTTON_PRIMARY` and `BUTTON_SECONDARY` are `h-10` (40px); `BUTTON_DANGER` is `h-8` (32px).

- [ ] **Step 1: Write the failing tests**

Add to the same `describe` block in `src/views/html.test.ts`:

```typescript
  test("every button states its own height instead of inheriting one", () => {
    // Measured before this change: the primary was 40px on the list header
    // and 42px in the add-site footer; the danger button was 33.2px in the
    // Danger card and 42px in the confirm dialog — the same component at two
    // sizes, because a flex row's default align-items:stretch resized it.
    // An explicit height wins over stretch (stretch only applies when the
    // cross size is auto), so the fix is a height, not a container change.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /\bh-\d+\b/, `no explicit height in: ${c}`);
      assert.doesNotMatch(c, /\bpy-[\d.]+\b/, `height still derived from padding in: ${c}`);
    }
  });

  test("the danger button stays one size down from the primary", () => {
    // The Scorch-Is-Not-Ember Rule: a destructive action is never the largest
    // control on screen. Stretch defeated this in the dialog before Task 2.
    const step = (c: string) => Number(c.match(/\bh-(\d+)\b/)![1]);
    assert.equal(step(BUTTON_PRIMARY), step(BUTTON_SECONDARY));
    assert.ok(
      step(BUTTON_DANGER) < step(BUTTON_PRIMARY),
      `danger h-${step(BUTTON_DANGER)} is not smaller than primary h-${step(BUTTON_PRIMARY)}`,
    );
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test 2>&1 | grep -A5 "states its own height"
```

Expected: FAIL — no `h-*` class present, and `py-2.5` / `py-1.5` still match.

- [ ] **Step 3: Add heights, remove vertical padding**

In `src/views/shared.ts`, make exactly these substitutions inside the three constants. `h-10` is 40px — the primary's existing intrinsic height, so the primary does not visually change. `h-8` is 32px.

- `BUTTON_PRIMARY`: `rounded-md px-4 py-2.5 cursor-pointer` → `rounded-md h-10 px-4 cursor-pointer`
- `BUTTON_SECONDARY`: `rounded-md px-4 py-2.5 cursor-pointer` → `rounded-md h-10 px-4 cursor-pointer`
- `BUTTON_DANGER`: `rounded-md px-3 py-1.5 cursor-pointer` → `rounded-md h-8 px-3 cursor-pointer`

Leave `inline-flex items-center gap-1.5` as it is on all three.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | tail -20
```

Expected: PASS, no regressions.

- [ ] **Step 5: Verify the measured defect is actually gone**

With `npm run dev:mock` running, open `http://127.0.0.1:8787/sites/app.lyly.dev`, click "Remove site", and run this in the browser console:

```javascript
[...document.querySelectorAll('#confirm-remove-submit, [data-close-dialog]')]
  .map(b => b.textContent.trim().slice(0, 20) + ': ' + b.getBoundingClientRect().height)
```

Expected: Cancel `40`, Remove `32`. Before this task both reported `42`. Also check `/sites/new` — Cancel and "Add site" should both be `40`, and the list header's "Add site" should be `40` too (it was 40 before and must stay 40).

- [ ] **Step 6: Commit**

```bash
git add src/views/shared.ts src/views/html.test.ts
git commit -m "fix: give buttons a resting height flex cannot stretch

Heights were emergent: a flex row's default align-items:stretch resized
whatever was shortest. The primary rendered 40px on the list header and
42px in the add-site footer; the danger button rendered 33.2px in the
Danger card and 42px in the confirm dialog — where it was exactly as
tall as Cancel, silently breaking 'never the largest control on screen'.
An explicit height wins over stretch, so no flex container changes."
```

---

## Task 3: Transitions and a press state

Two gaps close here.

First, `DESIGN.md`'s motion table already claims a 150ms `state-transition` applies to *"cards, buttons and option rows"* — but the button constants carry no transition class at all. Cards and option rows do (`src/views/html.ts:55`, `:218`, `:226`). The documentation is ahead of the code; this brings the code up.

Second, **nothing in the app currently responds to being pressed.** The Flat-At-Rest Rule already anticipates this — *"Shadow means one of two things: this element floats above the page, or you are touching it right now"* — and the second clause has never been used. A 1px downward nudge on `:active` satisfies the intent without invoking shadow at all, so no rule needs amending. `transform` does not affect layout, so nothing reflows.

**Files:**
- Modify: `src/views/shared.ts` — `BUTTON_PRIMARY`, `BUTTON_SECONDARY`, `BUTTON_DANGER`
- Test: `src/views/html.test.ts`

**Interfaces:**
- Consumes: all three constants as left by Task 2.
- Produces: all three carry `motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px`.

- [ ] **Step 1: Write the failing tests**

```typescript
  test("buttons transition their state changes, gated behind motion-safe", () => {
    // DESIGN.md's motion table already claimed a 150ms state-transition for
    // "cards, buttons and option rows". Cards and option rows had it; the
    // button constants did not. This closes that gap rather than adding a
    // new claim.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /motion-safe:transition-colors/, `no gated transition in: ${c}`);
      assert.match(c, /motion-safe:duration-150/, `no 150ms duration in: ${c}`);
      assert.doesNotMatch(c, /(?<!motion-safe:)transition-colors/, `ungated transition in: ${c}`);
    }
  });

  test("a pressed button moves, and only for viewers who want motion", () => {
    // The Flat-At-Rest Rule already allows for "you are touching it right
    // now"; nothing in the app had ever used that clause. A 1px translate
    // satisfies it without introducing a resting shadow, which is what made
    // the rejected Keycap variant expensive.
    for (const c of [BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_DANGER]) {
      assert.match(c, /motion-safe:active:translate-y-px/, `no press state in: ${c}`);
      assert.doesNotMatch(c, /(?<!motion-safe:)active:translate/, `ungated press in: ${c}`);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test 2>&1 | grep -A5 "gated behind motion-safe"
```

Expected: FAIL — no `motion-safe:transition-colors` in any button constant.

- [ ] **Step 3: Add the motion classes**

In `src/views/shared.ts`, append the same three utilities to each of the three constants, immediately after the `hover:` classes and before the `focus-visible:` classes:

```
motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px
```

Order within the class string does not affect the cascade — Tailwind resolves by stylesheet order, not attribute order — but keeping these three together in the same position in all three constants makes future diffs readable.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test 2>&1 | tail -20
```

Expected: PASS. The pre-existing `doesNotMatch(html, /(?<!motion-safe:)transition-colors/)` test over the rendered add-site and list pages must also still pass — if it fails, a `transition-colors` lost its prefix.

- [ ] **Step 5: Verify in the browser**

With `npm run dev:mock` running, open `/sites/new`. Hover Cancel — the fill should ease darker over 150ms rather than snapping. Press and hold either button — it should drop 1px and return on release. Then set the OS to reduce motion (macOS: System Settings → Accessibility → Display → Reduce motion) and confirm both the ease and the nudge stop while hover and press still change colour.

- [ ] **Step 6: Run the full verification suite and commit**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

All four must pass.

```bash
git add src/views/shared.ts src/views/html.test.ts
git commit -m "feat: transition and press states on buttons

DESIGN.md's motion table already claimed a 150ms state-transition for
buttons; only cards and option rows had one. Adds the press the
Flat-At-Rest Rule anticipated ('you are touching it right now') as a 1px
translate rather than a resting shadow, so no rule is amended."
```

---

## Task 4: Record the button change in DESIGN.md and the sidecar

`DESIGN.md` can lie, and the sidecar drifts silently — `narrative.rules` holds a **second, independent copy of every named rule's prose**, so hand-amending one desyncs the other with nothing failing. It has drifted six times across two changes. The bodies are *derived* from the prose by one transform: **strip `**bold**` markers and backticks, keep everything else verbatim.** Keep them derived.

**Files:**
- Modify: `DESIGN.md` — frontmatter `components:`; the Hairline and Hairline Strong bullets under Neutral; the `### Buttons` prose under `## Components`
- Modify: `.impeccable/design.json` — `components[]` entries for Primary/Secondary/Danger Button

**Interfaces:**
- Consumes: the final state of all three constants from Tasks 1–3.
- Produces: documentation only. No code depends on this task.

- [ ] **Step 1: Update the frontmatter component tokens**

In `DESIGN.md`, change these two entries. `button-secondary-hover` keeps the values it already had — the new resting state is the old hover state one step lighter, so only the rest entry moves.

```yaml
  button-secondary:
    backgroundColor: "{colors.hairline-strong}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.chalk}"
```

Add `height` and change `padding` on the other two:

```yaml
  button-primary:
    backgroundColor: "{colors.ember}"
    textColor: "{colors.hearth}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
```

```yaml
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.scorch}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "32px"
```

- [ ] **Step 2: Update the two Neutral colour bullets**

Hairline's description stays accurate — it is still the secondary's hover fill — but Hairline Strong's changes from outline to fill. Replace the Hairline Strong bullet with:

```markdown
- **Hairline Strong** (`stone-600`): The secondary button's fill, the `static`
  pill's edge, and the arrows between routing hops. It carries Chalk at 7.32:1
  as a surface, having been unusable as a 1px line against Hearth (2.29:1) or
  Hearth Lift (1.99:1) — the same token reads completely differently depending
  on how much of it there is.
```

- [ ] **Step 3: Update the Buttons prose**

Under `## Components → ### Buttons`, replace the **Secondary** bullet and add a **Pressed** bullet after **Disabled**:

```markdown
- **Secondary:** A Hairline Strong fill with Chalk text, same size as primary,
  no border. Hover **recedes** to Hairline rather than brightening, which takes
  the label from 7.32:1 to 9.85:1; brightening to Smoke Deep would have been
  4.61:1, the weakest ratio in the system. Always the cancel side of a dialog.
  It is filled rather than outlined because a 1px Hairline Strong line measures
  2.29:1 on Hearth and 1.99:1 on Hearth Lift — invisible as an edge,
  unmistakable as a surface, and the dialog is where it was faintest and where
  it sits beside the one irreversible action.
```

```markdown
- **Pressed:** A 1px downward `translate`, gated behind `motion-safe`. Not a
  shadow — The Flat-At-Rest Rule allows shadow for "you are touching it right
  now", but a transform satisfies the intent without putting depth at rest, and
  depth at rest is what makes a beveled button expensive here.
```

Also update the **Shape** bullet, which currently says buttons are `inline-flex` with a 6px gap, to record that height is now explicit:

```markdown
- **Shape:** Softly squared (6px radius), always `inline-flex` with a 6px gap so
  a 1em icon sits on the text baseline without extra markup. Height is stated,
  not derived from padding — 40px for primary and secondary, 32px for danger —
  because a flex row's default `align-items: stretch` otherwise resizes the
  shortest control to match its tallest sibling, which had the danger button
  rendering at 33.2px in the Danger card and 42px in the confirm dialog.
```

- [ ] **Step 4: Mirror the three components into the sidecar**

In `.impeccable/design.json`, update the `css` string of each button component so it matches the shipped Tailwind. For "Secondary Button", also update `description`. The CSS values, written out:

- `.ds-btn-secondary` — `background: oklch(44.4% 0.011 73.639)`, `color: oklch(98.5% 0.001 106.423)`, no `border`, `height: 40px`, `padding: 0 16px`; `:hover { background: oklch(37.4% 0.01 67.558) }`; add `transition: background 150ms, color 150ms` and `:active { transform: translateY(1px) }`; `:disabled { background: transparent; color: oklch(55.3% 0.013 58.071) }`.
- `.ds-btn-primary` — `height: 40px`, `padding: 0 16px`; add `:active { transform: translateY(1px) }`.
- `.ds-btn-danger` — `height: 32px`, `padding: 0 12px`; add `:active { transform: translateY(1px) }`.

Set "Secondary Button"'s `description` to: `The cancel side of a dialog. Same size as primary, filled Hairline Strong rather than outlined, because a 1px line at this tone is invisible against both grounds.`

- [ ] **Step 5: Verify the sidecar parses and nothing else drifted**

```bash
node -e 'const j=require("./.impeccable/design.json"); const b=j.components.filter(c=>c.kind==="button"); console.log(b.map(c=>c.name+": "+(/height/.test(c.css)?"has height":"NO HEIGHT")).join("\n"))'
```

Expected: all three report `has height`.

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all pass — this task changes no code, so a failure here means something from Tasks 1–3 regressed.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md .impeccable/design.json
git commit -m "docs: record the filled secondary and stated button heights

Frontmatter tokens, the Hairline Strong bullet, and the Buttons prose in
DESIGN.md, mirrored into the sidecar's component CSS. The sidecar holds a
second copy of this and nothing fails when it drifts, so the two move
together or not at all."
```

---

## Task 5: Write down the icon-composition rule

The primary button already renders three different compositions, and the pattern in them is real but undocumented:

| Where | Composition |
|---|---|
| `html.ts:148` empty-state CTA, `html.ts:161` list header | leading `plus`, then the label |
| `html.ts:260` add-site submit | no icon |
| `html.ts:670` detail header "Visit" | label, then trailing `external-link` |
| `html.ts:544`, `html.ts:737` danger buttons | leading `trash` |

Read together: **a leading icon names the action's category, a trailing icon means the action leaves the app, and no icon means the surface you are already on states the action.** The add-site submit sits under a heading reading "Add a site", so a plus there would be redundant.

The code is already correct. What is missing is the rule, and undocumented means the next button added is a coin flip. **No code changes in this task.**

**Files:**
- Modify: `DESIGN.md` — a new named rule in the `## Shapes → ### Named Rules` section, beside The Radius-Says-Size Rule
- Modify: `.impeccable/design.json` — `narrative.rules[]`

**Interfaces:**
- Consumes: nothing. Documentation only.
- Produces: a named rule present in both files, with the sidecar body derived from the prose.

- [ ] **Step 1: Add the rule to DESIGN.md**

In the `## Shapes` section's `### Named Rules`, directly after The Radius-Says-Size Rule, add:

```markdown
**The Icon-Says-Direction Rule.** A button's icon states which way the action
goes, so its position is not decorative. A **leading** icon names the action's
category — `plus` for "this creates something", `trash` for "this destroys
something". A **trailing** icon means the action leaves the app, which is why
"Visit" carries `external-link` on the right and nothing else does. **No icon**
means the surface you are already on has stated the action: the add-site page's
submit button is a bare "Add site" because the heading above it already reads
"Add a site", and a `plus` there would say it twice. A button never carries an
icon on both sides, and a purely decorative icon is not a fourth option.
```

- [ ] **Step 2: Derive the sidecar body and append it**

The transform is: strip `**bold**` markers and backticks, keep everything else verbatim. Run this, which performs the derivation rather than retyping the prose — retyping is exactly how the sidecar has drifted before:

```bash
node <<'EOF'
const fs = require("fs");
const md = fs.readFileSync("DESIGN.md", "utf8");
const m = md.match(/\*\*The Icon-Says-Direction Rule\.\*\*([\s\S]*?)(?=\n\n)/);
if (!m) throw new Error("rule not found in DESIGN.md — add it first");
const body = ("The Icon-Says-Direction Rule." + m[1])
  .replace(/\*\*/g, "")
  .replace(/`/g, "")
  .replace(/\s*\n\s*/g, " ")
  .trim()
  .replace(/^The Icon-Says-Direction Rule\.\s*/, "");
const j = JSON.parse(fs.readFileSync(".impeccable/design.json", "utf8"));
if (j.narrative.rules.some(r => r.name === "The Icon-Says-Direction Rule")) {
  throw new Error("rule already present — edit it in place instead of appending");
}
j.narrative.rules.push({ name: "The Icon-Says-Direction Rule", body, section: "shapes" });
fs.writeFileSync(".impeccable/design.json", JSON.stringify(j, null, 2) + "\n");
console.log("derived body:\n" + body);
EOF
```

- [ ] **Step 3: Verify the derivation round-trips**

Confirm the stored body is the prose minus bold markers and backticks, with no wording of its own:

```bash
node -e '
const fs=require("fs");
const j=JSON.parse(fs.readFileSync(".impeccable/design.json","utf8"));
const r=j.narrative.rules.find(x=>x.name==="The Icon-Says-Direction Rule");
const md=fs.readFileSync("DESIGN.md","utf8");
const m=md.match(/\*\*The Icon-Says-Direction Rule\.\*\*([\s\S]*?)(?=\n\n)/)[1];
const want=m.replace(/\*\*/g,"").replace(/`/g,"").replace(/\s*\n\s*/g," ").trim();
console.log(r.body===want ? "IN SYNC" : "DRIFTED\n--stored--\n"+r.body+"\n--derived--\n"+want);
''
```

Expected: `IN SYNC`. If it prints `DRIFTED`, the stored body was hand-written rather than derived — re-run Step 2 rather than editing the JSON by hand.

- [ ] **Step 4: Confirm the code already obeys the rule**

This task documents existing behaviour, so the rule must describe what is actually rendered. Check every button icon in the views:

```bash
grep -n 'icon("plus")\|icon("trash")\|icon("externalLink")' src/views/html.ts
```

Expected, and nothing else:
- `148`, `161` — `${icon("plus")}Add…` (leading, creates)
- `544`, `737` — `${icon("trash")}Remove…` (leading, destroys)
- `670` — `Visit ${icon("externalLink")}` (trailing, leaves the app)

Line `260` (the add-site submit) must have no icon. If any line contradicts the rule, **stop and report it** — the rule is wrong, or the code is, and this plan assumed the code was right.

- [ ] **Step 5: Run the full verification suite**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: all pass. This task changes no code, so any failure is a regression from an earlier task.

- [ ] **Step 6: Commit**

```bash
git add DESIGN.md .impeccable/design.json
git commit -m "docs: name the icon-composition rule

The primary button already renders three compositions — leading plus,
trailing external-link, and no icon on the add-site submit — and the
pattern in them is real: leading names the category, trailing means the
action leaves the app, none means the surface already stated it. The
code was right and the rule was nowhere, which makes the next button a
coin flip. Sidecar body derived from the prose, not retyped."
```

---

## Final verification

After Task 5, before opening a pull request:

- [ ] `npm run typecheck && npm run lint && npm test && npm run build` — all four pass.
- [ ] `git diff main --stat` touches exactly five files: `src/views/shared.ts`, `src/views/html.test.ts`, `DESIGN.md`, `.impeccable/design.json`, and this plan. **If `src/views/html.ts` appears in that list, something went wrong** — the class constants were supposed to absorb every change.
- [ ] `cat .impeccable/hook.cache.json` shows findings recorded for this session, confirming the Impeccable design hook fired on the `shared.ts` edits. Note that `context.mjs` may print `MANUAL_DETECTOR_REQUIRED` even while the hook is demonstrably running — believe the cache file over that message. Running `node <impeccable-skill-dir>/scripts/detect.mjs --json src/views` by hand is harmless but redundant; scope it to `src/views` and never to `public`, whose `style.css` is gitignored Tailwind output.
- [ ] With `npm run dev:mock` running, walk all four surfaces and confirm each: the list header (solo primary, 40px), the empty state (`/` with a Caddyfile holding no managed blocks), the add-site footer (Cancel + Add site, both 40px), and the confirm-remove dialog (Cancel 40px solid, Remove 32px outlined).
- [ ] Re-read the recommendation's stated caveat and judge it live: *a filled Cancel is more prominent than a ghost one, and on `/sites/new` it sits directly beside the Ember primary.* Ember should still read as the obvious action, being the only chromatic voice on screen. If it does not, that is a real finding — report it rather than adjusting tokens unilaterally, since the fix would reopen a `DESIGN.md` decision.

## What this change deliberately does not do

Recorded so a reviewer does not read these as oversights:

- **The corner radius does not change.** Pill would collide with the status and type pills that sit inches from the Visit button on the detail page; square is the costume `DESIGN.md` rejects; 8px blurs into `rounded.surface`. The Radius-Says-Size Rule already settles this.
- **The danger button keeps its colours, border, and outline treatment.** Filling it was the whole expense of the rejected Ledger variant, and it would make the app's one irreversible action look more pressable.
- **No resting shadow or bevel.** That was the rejected Keycap variant's cost — it would have retired "flat tonal layering at rest" from the Key Characteristics.
- **Button labels stay in Nunito.** Moving them to DM Mono was the rejected Command variant, which would have made the Mono-Carries-Facts split conditional and needed an exception for labels containing a hostname.
- **No new colour token enters the palette.** The filled secondary reuses Hairline Strong; its hover reuses Hairline, which was already the secondary's hover fill.
