# Sentences in sans, the offer tag out of Ember (critique 2026-10-21, P2)

Date: 2026-10-26

## Decision record

- **The rendered comparison** (artifact https://claude.ai/artifact/3Qj7zFAB6hgg4oTZAWkZBY) offered four variants against the live control. The user picked **01 "Sans sentence, mono facts"**.
- **Rejected:**
  - **02 (rewrite the copy as terse mono facts):** it loses the voice PRODUCT.md asks for.
  - **03 (a fact line with a sentence beneath):** taller rows, and the unknown row would repeat its own pill.
  - **04 (drop what the row already says):** it loses "lychee-admin couldn't ask" as the meaning of UNKNOWN.
- **Frozen fixtures:** the user chose **declared substitutions** over retiring the 32 affected fixtures (see Decision 3).
- **The other half of that critique finding** (one control with different emphasis per page) is already settled. DESIGN.md names both compact-primary exceptions, the runbook's first Deploy and the retired notice's Prune, so nothing changes there.

## Why

The Mono-Carries-Facts rule says sentences are sans and machine facts are mono. Five kinds of line break it:
- the board's unknown sentence;
- the Prune caption;
- the add page's two error boxes;
- the retiring line;
- the deploy-trouble line's reason.

Separately, the read-only `<tag> available` is set in Ember Light, which the Ember Is Interactive rule forbids ("never colors … a value you can only read"). DESIGN.md's offer-line paragraph contradicts that rule by endorsing it.

## Goal

Every explanatory sentence in these lines is sans, with any machine fact inside it in mono. No read-only value wears Ember.

## Non-goals

- Gate strings, the reconciler's failed-step text, and command blocks. These are machine output and stay mono.
- The add page's "In this order" step labels.
- The add-site "error said twice" item.
- Parsing server error strings to set their facts in mono.

## Decisions

### 1. Markup

Sans here means the inherited Nunito. "A fact" means a `<span class="font-mono text-stone-50">`, the board's Chalk mono.

- **Offer line** (`OfferLine`, `src/client/components/DeployLines.tsx`; the board, the repository card and runbook step 4). The label becomes `<span class="text-[0.8rem] text-stone-400"><span class="font-mono text-stone-50">{tag}</span> available</span>`, in place of `font-mono text-rose-300`. The button is unchanged.
- **Unknown sentences** (`unknownSentence`, `src/views/boardRowModel.ts`; rendered in `BoardRows.tsx`). The `<p>` takes `BODY` instead of `SERVICE_DETAIL`. The text is unchanged, for both the container version and the systemd-unit version.
- **Prune caption** (`PruneLine`, `DeployLines.tsx`; the board and the retired notice). The caption becomes `<span class="text-[0.75rem] leading-snug text-stone-400">Deletes {fact name.yml} from {fact lychee-resources} once its container is confirmed down.</span>`. The non-breaking space and the nowrap tail go: sans wraps at word boundaries.
- **Retiring line** (`BoardRows.tsx`) and **deploy-trouble line** (`BoardRows.tsx`, `data-deploy-state`). The `<p>` drops `font-mono`, and the coloured key span (`● retiring`, `● deploy <word>`) gains `font-mono`. The `· reason` span stays as it is, so it renders in sans.
- **Error boxes** (`#preview-error` and `#add-site-error` in `src/client/pages/AddSitePage.tsx`): drop `font-mono` from `PREVIEW_ERROR_CLASS` and from the add-error class. The text stays plain, because it arrives from the server as a sentence.

### 2. Docs

- **`DESIGN.md`:**
  - The offer line: the available version becomes a Chalk mono fact followed by Smoke sans `available`, and Ember stays on the button.
  - The prune line's caption.
  - The deploy line and the retiring line: the key in mono, the reason in sans.
  - The add page's error box.
- **`.impeccable/design.json`:** re-derive the rule bodies, and rewrite any that changed.
- **`CLAUDE.md`:** the frozen-fixture rule gains the sanctioned substitution mechanism (Decision 3).

### 3. Frozen fixtures: declared substitutions

- **A new module, `src/client/test/redesigns.ts`.**
  - It exports `REDESIGNS: { id: string; since: string; why: string; from: RegExp; to: string }[]` and `applyRedesigns(html: string): string`, which applies every entry in order.
  - Each `from` is global and matches the frozen server markup, and `to` is the markup that replaces it.
  - Entries cover the offer label, the unknown sentence's `<p>`, the Prune caption, the deploy-line `<p>` and key, and the error boxes' class.
- **Every parity file reads its fixtures through `applyRedesigns`:** `BoardParity`, `SiteDetailParity` and `AddSiteParity`, plus any other whose fixtures an entry touches. The fixture files are never edited.
- **`src/client/test/redesigns.test.ts`** reads every file under `src/dev/fixtures/` from disk and checks three things:
  - each entry's `from` matches at least one fixture;
  - no fixture already contains an entry's `to`, so the fixture still holds the retired markup;
  - every entry has a non-empty `since` and `why`.

  It reads from disk because each test file runs in its own process, so one file can't see whether another file's substitutions matched.
- **Why not retire:** retiring would remove 32 whole-page references, the full add-site dual run among them, to change a few classes and one caption. The substitution keeps every other byte of those pages under parity, and the table is the record of each deliberate change.

### 4. Tests

- **Live markup tests** (`BoardMarkup`, `SiteDetailMarkup`, `RepositoryCard`, `RetiredNotice`, `BoardRetired`, `AddSiteMarkup`) that assert the old classes or the old caption text are updated to the new design. None is loosened.
- **New assertions:**
  - The offer label has no `rose` class, and its tag is a mono span.
  - The unknown `<p>` is `BODY`.
  - The Prune caption is sans, with the file and `lychee-resources` as mono spans.
  - The retiring and deploy lines' keys are mono and their reasons are not.
  - Both error boxes lack `font-mono`.
