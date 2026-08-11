# Icon-only copy button for the GitHub Actions workflow block

## Problem

The "Copy" button next to the GitHub Actions workflow block is a full-width
labeled button sitting in its own row above the code block. The user wants
a smaller, icon-only clipboard button overlaid in the top-right corner of
the code block itself — a more compact, conventional "copy code block" UI.

## Design

### Markup (`src/views/html.ts`)

- `ICONS` gains two new entries, matching the existing stroke style (`fill:
  none`, `stroke: currentColor`, 24x24 viewBox) already used by `plus`/`trash`:
  - `clipboard`: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />`
  - `check`: `<path d="M20 6 9 17l-5-5" />`
- The workflow block's markup changes from a labeled button in a flex row
  above the `<pre>` to: the label alone on its own line, then a
  `relative`-positioned wrapper containing the `<pre>` (with `pr-10` added
  so code text never runs under the button) and an `absolute top-2 right-2`
  icon-only button.
- The button renders **both** icons as sibling elements — `clipboard`
  visible, `check` initially `hidden` — rather than swapping `textContent`.
  Swapping `textContent` on a button containing an SVG would destroy the
  icon permanently (`textContent = "Copied!"` replaces all children with a
  single text node), which is exactly the bug this redesign has to avoid
  now that the button no longer has a text label to swap.
- `aria-label="Copy to clipboard"` on the button by default; JS updates it
  to `"Copied!"` or `"Press Ctrl+C to copy"` for the two feedback states,
  same as the button previously conveyed via visible text — this keeps
  screen-reader feedback equivalent even though sighted feedback is now
  purely the icon swap.

### Client JS (`public/app.js`)

The existing `[data-copy-target]` handler (added in the prior branch,
already has try/catch for the insecure-context fallback) changes its
feedback mechanism:
- Success: toggle the `hidden` class on the two icon `<span>`s (hide
  clipboard, show check) instead of setting `button.textContent`; also
  update `aria-label`. Revert both after the same 1500ms `setTimeout` this
  already uses.
- Fallback (insecure context / clipboard permission denied): keep the
  existing text-selection behavior (`window.getSelection()?.selectAllChildren(target)`)
  unchanged; update only `aria-label` (not button content) to convey the
  "Press Ctrl+C to copy" instruction, since there's no icon that
  meaningfully represents that state and the existing manual-select
  fallback is already the real signal for a sighted user (the selected
  text visibly highlights).

### Out of scope

- No change to the copy-to-clipboard logic itself (the try/catch, the
  `navigator.clipboard.writeText` call, the fallback text-selection) —
  only how success/fallback is *displayed* on the button changes.
- No change to any other button in the app — this redesign is scoped to
  the one GitHub Actions workflow copy button.
