import { RAIL_ROW } from "../../views/railModel";
import { BODY, BUTTON_SECONDARY, CAPTION, CAPTION_FILE, CAPTION_KEEP, SKIP_LINK } from "../../views/shared";

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

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";

const RAIL_WHY = "The rail is navigation plus one whole-host signal on overview (spec 2026-10-28-overview-page).";

/** A fixture link to the sites list, by its exact class string, moved from / to /sites. */
function sitesLink(id: string, className: string): Redesign {
  const old = `href="/" class="${className}"`;
  return {
    id,
    since: "2026-10-28",
    why: "The sites list moved to /sites when / became the overview (spec 2026-10-28-overview-page).",
    from: new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
    to: `href="/sites" class="${className}"`,
    anchor: old,
  };
}

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
    // The shell's body opens with the top bar, indented; the rail's own
    // top-bar fixture is the header alone, and gets no skip link.
    from: /^ {2}<header id="top-bar"/g,
    to: `  <a href="#main" class="${SKIP_LINK}">Skip to content</a><header id="top-bar"`,
    anchor: '  <header id="top-bar"',
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
    id: "rail-row-label",
    since: "2026-10-27",
    why: "A rail row shows its label alone, with the domain kept as screen-reader text, so rows stop wrapping (critique 2026-10-26 minors, \"01 Label only\").",
    from: /<wbr>(\.[^<]+)<\/span>/g,
    to: '<span class="sr-only">$1</span></span>',
    anchor: "<wbr>.",
  },
  {
    id: "rail-row-apex",
    since: "2026-10-27",
    why: "The apex row has no domain to hide, and nothing left to break at.",
    from: /<wbr><\/span>/g,
    to: "</span>",
    anchor: "<wbr></span>",
  },
  {
    id: "rail-heading-domain",
    since: "2026-10-27",
    why: "The sites heading names the domain once, hidden from assistive tech, since each row's name still carries it.",
    from: />sites<span data-count="sites"/g,
    to: '><span>sites<span data-rail-domain aria-hidden="true"> · lychee.land</span></span><span data-count="sites"',
    anchor: '>sites<span data-count="sites"',
  },
  {
    id: "type-option-static",
    since: "2026-10-27",
    why: "Both type options share one style: unchecked on a transparent ground, checked a Hairline fill with a Smoke Deep border (critique 2026-10-26 minors; neutral since critique 2026-10-27, when an Ember Edge border read as Scorch beside an invalid field).",
    from: /border border-stone-600 bg-stone-700\/50 px-3 py-2\.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-700\/80 has-\[:checked\]:bg-stone-700 has-\[:checked\]:border-stone-500/g,
    to: "border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800/40 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500",
    anchor: "bg-stone-700/50 px-3 py-2.5",
  },
  {
    id: "type-option-proxy",
    since: "2026-10-27",
    why: "The checked proxy option loses its Ember Deep wash, which read close to the error ground, and takes the static option's neutral checked style.",
    from: /border border-stone-700 bg-transparent px-3 py-2\.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800\/40 has-\[:checked\]:bg-rose-950\/50 has-\[:checked\]:border-rose-800\/70/g,
    to: "border border-stone-700 bg-transparent px-3 py-2.5 cursor-pointer motion-safe:transition-colors hover:bg-stone-800/40 has-[:checked]:bg-stone-700 has-[:checked]:border-stone-500",
    anchor: "has-[:checked]:bg-rose-950/50",
  },
  {
    id: "port-branch-rule",
    since: "2026-10-27",
    why: "The rule marking the proxy option's branch is Hairline Strong, not Ember Edge, which read as Scorch beside an invalid field (critique 2026-10-27).",
    from: /border-l-2 border-l-rose-800\/70 pl-3/g,
    to: "border-l-2 border-l-stone-600 pl-3",
    anchor: "border-l-rose-800/70",
  },
  {
    id: "type-option-radio",
    since: "2026-10-27",
    why: "The static radio is Ember when checked, as the proxy radio is.",
    from: /class="accent-stone-300 /g,
    to: 'class="accent-rose-400 ',
    anchor: "accent-stone-300",
  },
  {
    id: "site-headline-label",
    since: "2026-10-27",
    why: "A site's hostname headline holds its label as one unit and wraps only where it cannot fit, never mid-word as break-all did (critique 2026-10-26 minors, \"01 Label kept whole\").",
    from: /(id="site-hostname" class="[^"]*m-0) break-all">([^<]+)/g,
    to: '$1 [overflow-wrap:anywhere]"><span class="inline-block max-w-full">$2</span>',
    anchor: 'id="site-hostname" class=',
  },
  {
    id: "add-headline-wrap",
    since: "2026-10-27",
    why: "The add page's headline wraps only where it cannot fit, so a long label cannot overflow it.",
    from: /(<h2 class="[^"]*m-0)(">\s*<span id="composed-hostname")/g,
    to: "$1 [overflow-wrap:anywhere]$2",
    anchor: '<span id="composed-hostname"',
  },
  // The typed label is one unit, so at 390px a line breaks before the domain
  // and not at the label's hyphen; the dual run types `blog`, then `shop`.
  ...(["blog", "shop"] as const).map(
    (label): Redesign => ({
      id: `add-headline-label:${label}`,
      since: "2026-10-27",
      why: "The add page's composed headline holds the typed label as one unit (critique 2026-10-26 minors, \"01 Label kept whole\").",
      from: new RegExp(`(id="composed-hostname" data-domain="lychee\\.land">)${label}(<span class="text-stone-500">)`, "g"),
      to: `$1<span class="inline-block max-w-full">${label}</span>$2`,
      anchor: `data-domain="lychee.land">${label}<span`,
    }),
  ),
  {
    id: "service-row-focus",
    since: "2026-10-27",
    why: "A board row a move lands on shows the Ember focus ring, so the operator sees where find or a link took them (critique 2026-10-27).",
    from: /class="grid grid-cols-1 sm:grid-cols-\[9\.5rem_minmax\(0,1fr\)\] gap-x-4 gap-y-1\.5 items-start py-4 border-b border-stone-700 last:border-b-0"/g,
    to: 'class="grid grid-cols-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 items-start py-4 border-b border-stone-700 last:border-b-0 rounded-sm focus:outline focus:outline-2 focus:outline-rose-400 focus:outline-offset-2"',
    anchor: "items-start py-4 border-b border-stone-700 last:border-b-0",
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
  // The links back to the sites list, each anchored on its own exact class
  // string so the wordmark's and the rail heading's href="/" never match.
  // The breadcrumb's sites link, on a site's page and on the add page.
  sitesLink("sites-link:breadcrumb", `text-stone-400 no-underline hover:text-stone-50 hover:underline ${FOCUS}`),
  // The not-found body's "← Back to sites".
  sitesLink("sites-link:not-found", `${FOCUS} text-rose-400 no-underline font-mono text-[0.85rem] hover:underline`),
  // The Caddyfile error's "← sites".
  sitesLink("sites-link:caddyfile-error", `text-stone-400 no-underline font-mono text-[0.72rem] hover:text-stone-50 hover:underline ${FOCUS}`),
  // The add form's Cancel.
  sitesLink(
    "sites-link:add-cancel",
    `font-sans font-semibold text-sm bg-stone-600 text-stone-50 border-none rounded-md min-h-10 px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-stone-700 motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px ${FOCUS} disabled:cursor-not-allowed disabled:text-stone-500 disabled:bg-transparent disabled:hover:bg-transparent no-underline`,
  ),
  // The rail: navigation plus one whole-host signal on overview. These come
  // after rail-heading-domain, whose output still carries the sites slot.
  {
    id: "rail-no-count",
    since: "2026-10-28",
    why: RAIL_WHY,
    from: /\s*<span data-count="[a-z]+"><\/span>/g,
    to: "",
    anchor: '<span data-count="',
  },
  {
    id: "rail-no-dot",
    since: "2026-10-28",
    why: RAIL_WHY,
    // The frozen markup writes the empty attribute bare.
    from: /<span class="inline-block size-2 shrink-0 rounded-full border border-stone-600 bg-transparent" data-dot aria-hidden="true"><\/span>/g,
    to: "",
    anchor: 'data-dot aria-hidden="true"',
  },
  {
    id: "rail-sites-href",
    since: "2026-10-28",
    why: RAIL_WHY,
    from: /<a href="\/" class="flex items-center justify-between font-mono text-\[0\.75rem\]/g,
    to: '<a href="/sites" class="flex items-center justify-between font-mono text-[0.75rem]',
    anchor: '<a href="/" class="flex items-center justify-between font-mono text-[0.75rem]',
  },
  {
    id: "rail-overview-row",
    since: "2026-10-28",
    why: RAIL_WHY,
    // With health null the row carries no signal, so it is fixed text. The nav also holds the plain activity row (spec 2026-10-28-activity-page).
    from: /<nav aria-label="Sites"/g,
    // The row is a site row's RAIL_ROW, which the fixtures' own rows hold to its literal text.
    to: `<nav aria-label="Overview" class="flex flex-col gap-0.5"><a href="/" class="${RAIL_ROW} justify-between">overview</a><a href="/activity" class="${RAIL_ROW}">activity</a></nav><nav aria-label="Sites"`,
    anchor: '<nav aria-label="Sites"',
  },
  {
    id: "site-activity-link",
    since: "2026-10-28",
    why: "A site's page links to its own history: a Secondary Activity button before Visit, in one group in the header's action slot (spec 2026-10-28-activity-page).",
    // Captures the hostname and the whole Visit anchor, which keeps its own markup.
    from: /(<a href="https:\/\/([^"]+)" target="_blank" rel="noopener noreferrer" class="[^"]*">Visit [\s\S]*?<\/a>)/g,
    to: `<div class="flex items-center gap-2.5 shrink-0"><a href="/activity?subject=$2" class="${BUTTON_SECONDARY} no-underline shrink-0">Activity</a>$1</div>`,
    anchor: ">Visit ",
  },
];

export function applyWith(html: string, entries: readonly Redesign[]): string {
  return entries.reduce((out, r) => out.replace(r.from, r.to), html);
}

/** A frozen fixture's text with every declared redesign applied. */
export function applyRedesigns(html: string): string {
  return applyWith(html, REDESIGNS);
}
