import { BODY } from "../../views/shared";

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

export const REDESIGNS: Redesign[] = [
  {
    id: "offer-tag",
    since: "2026-10-26",
    why: "The offered tag is a value you can only read, so it leaves Ember: a Chalk mono fact, then `available` in sans Smoke (spec 2026-10-26-mono-sentences).",
    from: /<span class="font-mono text-\[0\.8rem\] text-rose-300">([^<]+) available<\/span>/g,
    to: '<span class="text-[0.8rem] text-stone-400"><span class="font-mono text-stone-50">$1</span> available</span>',
    anchor: " available</span>",
  },
  {
    id: "unknown-sentence",
    since: "2026-10-26",
    why: "The board's \"couldn't read\" sentence is a sentence, so Body sans rather than the mono detail line (spec 2026-10-26-mono-sentences).",
    from: /<p class="font-mono text-\[0\.8rem\] leading-relaxed text-stone-400 break-words m-0">(lychee-admin couldn(?:'|&#39;)t read this [^<]+)<\/p>/g,
    to: `<p class="${BODY}">$1</p>`,
    anchor: "couldn",
  },
  {
    id: "deploy-line",
    since: "2026-10-26",
    why: "The deploy line's key is a machine word and stays mono; its reason is a phrase, so the line itself is sans (spec 2026-10-26-mono-sentences).",
    from: /<p class="font-mono text-\[0\.8rem\] leading-relaxed m-0" data-deploy-state(="")?><span class="([^"]+)">/g,
    to: '<p class="text-[0.8rem] leading-relaxed m-0" data-deploy-state$1><span class="font-mono $2">',
    anchor: "data-deploy-state",
  },
  // Two entries, by id: the repository card's attach and change-repository
  // errors share the class and are not part of this change.
  ...(["preview-error", "add-site-error"] as const).map(
    (id): Redesign => ({
      id: `error-box-sans:${id}`,
      since: "2026-10-26",
      why: "The add page's error box holds a sentence from the server, so sans (spec 2026-10-26-mono-sentences).",
      from: new RegExp(`(id="${id}"[^>]*class="(?:hidden )?)font-mono (text-\\[0\\.8rem\\] text-red-300)`, "g"),
      to: "$1$2",
      anchor: `id="${id}"`,
    }),
  ),
];

export function applyWith(html: string, entries: readonly Redesign[]): string {
  return entries.reduce((out, r) => out.replace(r.from, r.to), html);
}

/** A frozen fixture's text with every declared redesign applied. */
export function applyRedesigns(html: string): string {
  return applyWith(html, REDESIGNS);
}
