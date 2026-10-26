/*
 * Declared redesigns of the frozen parity fixtures (src/dev/fixtures/).
 *
 * A frozen fixture is the last output of a retired server renderer and is
 * never edited or regenerated. A page deliberately redesigned is normally
 * retired with its fixtures; a change small enough to state as one
 * substitution is declared here instead, so every other byte of those pages
 * stays held to parity. The parity tests apply these to fixture text before
 * comparing. redesigns.test.ts reads every fixture from disk and fails if an
 * entry matches none (it is stale), matches outside its anchor, or if a
 * fixture already holds its new markup.
 */

export type Redesign = {
  id: string;
  /** The date the design changed. */
  since: string;
  /** Why, in a sentence: the decision this records. */
  why: string;
  /** Global; matches the frozen server markup. */
  from: RegExp;
  /** The markup that replaces it, as String.prototype.replace takes it. */
  to: string;
  /** A plain substring every match contains, and whose every occurrence is matched. */
  anchor: string;
};

export const REDESIGNS: Redesign[] = [];

export function applyWith(html: string, entries: readonly Redesign[]): string {
  return entries.reduce((out, r) => out.replace(r.from, r.to), html);
}

/** A frozen fixture's text with every declared redesign applied. */
export function applyRedesigns(html: string): string {
  return applyWith(html, REDESIGNS);
}
