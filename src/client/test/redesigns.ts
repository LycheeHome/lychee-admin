import { BODY, CAPTION, CAPTION_FILE, CAPTION_KEEP, SKIP_LINK } from "../../views/shared";

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
  {
    id: "attach-caption",
    since: "2026-10-26",
    why: "The attach caption is a sentence, so sans with its facts in mono, as the Prune caption is (mono-sentences follow-up).",
    from: /<p class="font-mono text-\[0\.72rem\] text-stone-400 m-0 break-all">writes ([^<]+)\.yml to lychee-resources · no tag until the first deploy<\/p>/g,
    to: `<p class="${CAPTION} m-0">Writes <span class="${CAPTION_FILE}">$1.yml</span> to <span class="${CAPTION_KEEP}">lychee-resources</span>, with no tag until the first deploy.</p>`,
    anchor: "no tag until the first deploy",
  },
  {
    id: "change-repository-caption",
    since: "2026-10-26",
    why: "The change-repository caption is a sentence, so sans with its file in mono (mono-sentences follow-up).",
    from: /<p class="font-mono text-\[0\.72rem\] text-stone-400 m-0 break-all">rewrites the image line in ([^<]+)\.yml · only while it has no tag<\/p>/g,
    to: `<p class="${CAPTION} m-0">Rewrites the image line in <span class="${CAPTION_FILE}">$1.yml</span>, only while it has no tag.</p>`,
    anchor: "only while it has no tag",
  },
  {
    id: "hostname-error-slot",
    since: "2026-10-27",
    why: "The hostname field gains its own error, as the port has: described by it, in a hidden status slot after the field's row (critique 2026-10-26, hostname errors).",
    from: /(aria-describedby=")hostname-suffix(")([\s\S]*?<span id="hostname-suffix"[^>]*>[^<]*<\/span>\s*<\/span>)/g,
    to: '$1hostname-suffix hostname-error$2$3<span id="hostname-error" class="hidden text-red-300 text-[0.8rem]" role="status" aria-live="polite"></span>',
    anchor: 'aria-describedby="hostname-suffix"',
  },
  {
    id: "static-step-facts",
    since: "2026-10-27",
    why: "The static site's manual step sets its path and file as code, the Mono-Carries-Facts rule (critique 2026-10-26).",
    from: /Put your site(&#x27;|')s files in ([^ <]+)\/\. lychee-admin created a placeholder index\.html there/g,
    to: 'Put your site$1s files in <code class="font-mono text-[0.72rem] text-stone-300 bg-stone-900 rounded-[4px] px-1">$2/</code>. lychee-admin created a placeholder <code class="font-mono text-[0.72rem] text-stone-300 bg-stone-900 rounded-[4px] px-1">index.html</code> there',
    anchor: "files in ",
  },
  {
    id: "remove-note-repository",
    since: "2026-10-27",
    why: "The remove dialog's step-5 note sets lychee-resources in mono like its other facts (critique 2026-10-26).",
    from: /<\/span> in lychee-resources, and the reconciler takes/g,
    to: '</span> in <span class="font-mono text-stone-50">lychee-resources</span>, and the reconciler takes',
    anchor: " in lychee-resources, and the reconciler takes",
  },
  {
    id: "skip-link",
    since: "2026-10-27",
    why: "A skip link is the frame's first Tab stop, past the rail to <main> (critique 2026-10-26: thirteen rail stops before content).",
    from: /<header id="top-bar"/g,
    to: `<a href="#main" class="${SKIP_LINK}">Skip to content</a><header id="top-bar"`,
    anchor: '<header id="top-bar"',
  },
  {
    id: "main-target",
    since: "2026-10-27",
    why: "<main> is the skip link's target: an id, and focusable without entering the tab order.",
    from: /<main class="max-w-\[1080px\] mx-auto py-8 pb-8 flex flex-col gap-6">/g,
    to: '<main id="main" tabindex="-1" class="max-w-[1080px] mx-auto py-8 pb-8 flex flex-col gap-6">',
    anchor: '<main class="max-w-[1080px] mx-auto py-8 pb-8 flex flex-col gap-6">',
  },
  {
    id: "detail-frame",
    since: "2026-10-27",
    why: "A site's page takes the 1080px frame every other page takes, so its left edge no longer jumps 160px (critique 2026-10-26 minors: \"02 Full frame\").",
    from: /class="max-w-\[760px\] mx-auto w-full flex flex-col gap-5"/g,
    to: 'class="max-w-[1080px] mx-auto w-full flex flex-col gap-5"',
    anchor: 'class="max-w-[760px] mx-auto w-full flex flex-col gap-5"',
  },
  {
    id: "notice-frame",
    since: "2026-10-27",
    why: "The page notice follows the page it sits above onto the frame.",
    from: /class="max-w-\[760px\] mx-auto w-full bg-rose-950\/60/g,
    to: 'class="max-w-[1080px] mx-auto w-full bg-rose-950/60',
    anchor: 'class="max-w-[760px] mx-auto w-full bg-rose-950/60',
  },
  {
    id: "not-found-frame",
    since: "2026-10-27",
    why: "The not-found body takes the frame too, rather than a centred 640px column.",
    from: /class="max-w-\[640px\] mx-auto w-full flex flex-col gap-4"/g,
    to: 'class="max-w-[1080px] mx-auto w-full flex flex-col gap-4"',
    anchor: 'class="max-w-[640px] mx-auto w-full flex flex-col gap-4"',
  },
  {
    id: "port-said-once",
    since: "2026-10-26",
    why: "A port conflict the field already states is said once: the submit points to the field's error, the panel's box hides, and the panel's line points up (critique 2026-10-21, \"the add-site error is said twice\").",
    // The submit's describedby, then the panel's box holding a port sentence,
    // then the panel's line: the three are one rejection, in document order.
    // `hidden` is appended, as the page's class toggle appends it.
    from: /(aria-describedby=")preview-error("[\s\S]*?id="preview-error" role="status" tabindex="-1" class="(?:font-mono )?text-\[0\.8rem\] text-red-300[^"]*)("[^>]*>Port \d+[^<]*<\/p>[\s\S]*?)Fix the problem above/g,
    to: "$1port-error$2 hidden$3Fix the port in the form",
    anchor: 'm-0">Port ',
  },
  // By id: the two add-page boxes (2026-10-26), then the repository card's
  // attach and change-repository errors (the follow-up the same day).
  ...(["preview-error", "add-site-error", "attach-error", "change-repo-error"] as const).map(
    (id): Redesign => ({
      id: `error-box-sans:${id}`,
      since: "2026-10-26",
      why: "An error box holds a sentence from the server or the writer, so sans (spec 2026-10-26-mono-sentences and its follow-up).",
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
