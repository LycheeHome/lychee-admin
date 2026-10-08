import type { StatusTone } from "../lib/siteDisplay";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const BUTTON_PRIMARY =
  "font-sans font-semibold text-sm bg-rose-400 text-stone-900 border-none rounded-md min-h-10 px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-rose-300 motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-stone-500 disabled:bg-rose-400/40 disabled:hover:bg-rose-400/40";
export const BUTTON_SECONDARY =
  "font-sans font-semibold text-sm bg-stone-600 text-stone-50 border-none rounded-md min-h-10 px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-stone-700 motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-stone-500 disabled:bg-transparent disabled:hover:bg-transparent";
/**
 * Secondary's quiet look at the offer's size, for the prune control, which sits
 * beside BUTTON_OFFER on the services board. Derived from the two so colours,
 * hover, focus and disabled stay Secondary's and only the sizing is the
 * offer's; the sizing classes all appear literally in BUTTON_OFFER, so
 * Tailwind's source scan still sees them. A test pins that both replaces hit.
 */
export const BUTTON_SECONDARY_COMPACT = BUTTON_SECONDARY.replace("text-sm", "text-[0.8rem]").replace(
  "min-h-10 px-4 py-2.5",
  "min-h-8 px-3 py-1.5",
);
export const BUTTON_DANGER =
  "font-sans font-semibold text-[0.8rem] bg-transparent text-red-300 border border-red-800 rounded-md min-h-8 px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-red-900 hover:text-stone-50 motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-stone-500 disabled:border-stone-700 disabled:hover:bg-transparent disabled:hover:text-stone-500";
/**
 * A row's one affordance, for an action that is not destructive. Geometry is
 * BUTTON_DANGER's (the established small in-row control); colour is Ember's,
 * because the Ember Is Interactive Rule marks what you can act on and the
 * Scorch-Is-Not-Ember Rule keeps red for what destroys. Deploying a newer tag
 * is the first row control that is neither, so it could borrow neither
 * existing button's colour without lying about what it does.
 */
export const BUTTON_OFFER =
  "font-sans font-semibold text-[0.8rem] bg-transparent text-rose-300 border border-rose-800 rounded-md min-h-8 px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-rose-950 hover:text-rose-200 motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-stone-500 disabled:border-stone-700 disabled:hover:bg-transparent disabled:hover:text-stone-500";
export const INPUT =
  "font-mono bg-stone-900 border border-stone-700 rounded-md text-stone-50 px-2.5 py-2 text-sm placeholder:text-stone-400 focus:outline focus:outline-2 focus:outline-rose-400 focus:outline-offset-2";
export const FORM_LABEL = "flex flex-col gap-1.5 text-[0.85rem] text-stone-400";
export const STATUS_PILL_BASE =
  "inline-flex items-center gap-1 shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-transparent";
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
export const DETAIL_WIDTH = "max-w-[760px] mx-auto w-full";
/**
 * The page frame — the same 1080px the shell's <main> and the header band
 * already use. A page takes this when it has two kinds of content that belong
 * side by side; DETAIL_WIDTH is the reading column it caps to when it has one.
 */
export const FRAME_WIDTH = "max-w-[1080px] mx-auto w-full";
export const TYPE_PILL_STATIC = "border-stone-600 text-stone-50 bg-stone-700";
export const TYPE_PILL_PROXY = "border-transparent text-rose-300 bg-rose-950";

export const TONE_PILL: Record<StatusTone, string> = {
  ok: `${STATUS_PILL_BASE} text-green-300 bg-green-950/60`,
  bad: `${STATUS_PILL_BASE} text-red-300 bg-red-950/60`,
  neutral: `${STATUS_PILL_BASE} text-stone-300 bg-stone-700`,
};

/**
 * One row of the services board: a fixed status column, then the unit.
 *
 * The status column is LEFT-aligned in a fixed width, which is the deliberate
 * departure from the site list, where pills sit at the right edge. Site-list
 * rows are a single line, so a right-aligned pill sits against a clean edge.
 * These rows are two or three lines of ragged content, and a right-aligned
 * pill would float against nothing. A left column is what lets the eye run
 * down the page reading status alone, which is the whole argument for this
 * layout. Stacked below `sm`, where there is no width to align across.
 */
export const SERVICE_ROW =
  "grid grid-cols-1 sm:grid-cols-[9.5rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 items-start py-4 border-b border-stone-700 last:border-b-0";
/** The unit name: a machine fact, so mono, at Chalk because it is the value that matters. */
export const SERVICE_NAME = "font-mono text-base leading-6 text-stone-50 break-words m-0";
/** Detail and gate lines: Smoke (the dim-text floor), mono, wrapping rather than truncating. */
export const SERVICE_DETAIL = "font-mono text-[0.8rem] leading-relaxed text-stone-400 break-words m-0";

export const CARD = "bg-stone-800 border border-stone-700 rounded-[10px] p-5";
/**
 * The size, weight, and tracking every card label shares. Split out because
 * the Danger card needs the same type at a different colour and margin, and
 * Tailwind resolves competing utilities by stylesheet order, not by the order
 * they appear in a class attribute — so appending an override is unreliable.
 */
export const CARD_LABEL_BASE = "font-mono text-[0.75rem] font-medium uppercase tracking-[0.1em]";
export const CARD_LABEL = `${CARD_LABEL_BASE} text-stone-300 m-0 mb-3`;
/**
 * A group heading on the services board. Built from CARD_LABEL_BASE rather
 * than CARD_LABEL for the reason that split exists: CARD_LABEL carries the
 * margin of a card, these headings are in no card, and appending an override
 * is unreliable because Tailwind resolves competing utilities by stylesheet
 * order, not attribute order.
 */
export const GROUP_LABEL = `${CARD_LABEL_BASE} text-stone-300 m-0 mb-1`;

export const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-green-300",
  bad: "text-red-300",
  neutral: "text-stone-300",
};

export const ICONS = {
  plus: `<path d="M5 12h14" /><path d="M12 5v14" />`,
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />`,
  check: `<path d="M20 6 9 17l-5-5" />`,
  externalLink: `<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />`,
  chevronDown: `<path d="m6 9 6 6 6-6" />`,
  layoutGrid: `<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />`,
};

export function icon(name: keyof typeof ICONS): string {
  return `<svg class="w-[1em] h-[1em] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * A moment as an age, never a raw timestamp: "2 minutes ago", "in 3 minutes".
 * Deliberately has no staleness threshold and no change of appearance — the
 * number carries the verdict, and a cutoff would be an invented policy.
 * Returns null for anything unparseable so callers omit the fact rather than
 * print NaN. `now` is a parameter so the output is testable.
 *
 * Known limit: systemd renders timestamps in the host's local zone, and V8
 * parses only some zone abbreviations ("UTC", "PDT" yes; "CEST" no, giving
 * null and a silently omitted fact). lychee emits UTC, so this does not bite;
 * a host in another zone would need the timestamps requested differently.
 */
export function formatAge(when: Date | string | null | undefined, now: Date): string | null {
  if (when === null || when === undefined) return null;
  // systemd timestamps lead with a weekday ("Sat 2026-09-26 11:00:00 UTC"),
  // which Date.parse does not promise to accept.
  const text = typeof when === "string" ? when.replace(/^[A-Za-z]{3}\s+/, "") : when;
  const ms = (text instanceof Date ? text : new Date(text)).getTime();
  if (!Number.isFinite(ms)) return null;

  const delta = ms - now.getTime();
  const seconds = Math.round(Math.abs(delta) / 1000);
  if (seconds < 5) return "just now";

  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`;
  let span: string;
  if (seconds < 60) span = plural(seconds, "second");
  else if (seconds < 3600) span = plural(Math.round(seconds / 60), "minute");
  else if (seconds < 48 * 3600) span = plural(Math.round(seconds / 3600), "hour");
  else span = plural(Math.round(seconds / 86400), "day");
  return delta < 0 ? `${span} ago` : `in ${span}`;
}
