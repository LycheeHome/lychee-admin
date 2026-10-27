import type { StatusTone } from "../lib/siteDisplay";
import { parseTimestamp } from "../lib/unitState";

export const BUTTON_PRIMARY =
  "font-sans font-semibold text-sm bg-rose-400 text-stone-900 border-none rounded-md min-h-10 px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-rose-300 motion-safe:transition-colors motion-safe:duration-150 motion-safe:active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-stone-500 disabled:bg-rose-400/40 disabled:hover:bg-rose-400/40 aria-disabled:cursor-not-allowed aria-disabled:text-stone-500 aria-disabled:bg-rose-400/40 aria-disabled:hover:bg-rose-400/40";
/**
 * Primary's Ember look at the offer's size, for a primary action inside a card
 * where the full-size button would outweigh its neighbours. Derived from
 * BUTTON_PRIMARY so colours, hover, focus and disabled stay Primary's and only
 * the sizing is the offer's; the sizing classes all appear literally in
 * BUTTON_OFFER, so Tailwind's source scan still sees them.
 */
export const BUTTON_PRIMARY_COMPACT = BUTTON_PRIMARY.replace("text-sm", "text-[0.8rem]").replace(
  "min-h-10 px-4 py-2.5",
  "min-h-8 px-3 py-1.5",
);
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
/** The red box a page uses to report a failed read; the list and the error page share it. */
export const ERROR_BOX =
  "font-mono text-[0.85rem] text-stone-50 bg-red-950/60 border border-red-400/70 rounded-md px-4 py-3 mb-5";
export const STATUS_PILL_BASE =
  "inline-flex items-center gap-1 shrink-0 font-mono text-[0.6875rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-transparent";
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";

/**
 * The page frame — the same 1080px the shell's <main> already uses, in the
 * content column beside the rail. Every page takes it, a site's page included,
 * so moving between pages keeps one left edge (until 2026-10-27 a site's page
 * centred a 760px column inside it, and its edge jumped 160px). Sentences hold
 * PROSE_MEASURE inside it.
 */
export const FRAME_WIDTH = "max-w-[1080px] mx-auto w-full";

// The page frame's class strings (AppFrame.tsx), the retired server shell's
// exactly, which the frozen shell fixtures pin.

/** The content column beside the rail, and the 1080px <main> inside it. */
export const SHELL_COLUMN = "min-w-0 px-6 pb-16";
export const SHELL_MAIN = "max-w-[1080px] mx-auto py-8 pb-8 flex flex-col gap-6";
/** The skip link: screen-reader only until focused, then fixed top-left; never a grid cell. */
export const SKIP_LINK =
  "sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 rounded-md bg-stone-800 border border-stone-700 px-3 py-2 text-[0.85rem] text-stone-50 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";

/** The × that dismisses the toast or the page notice. */
export const DISMISS_BUTTON =
  `shrink-0 text-stone-400 hover:text-stone-50 bg-transparent border-none cursor-pointer text-base leading-none ${FOCUS_RING}`;

/** The flash toast's box, without its tone (showToast() supplies that) or its initial `hidden`. */
export const FLASH_BANNER =
  "fixed top-6 left-1/2 -translate-x-1/2 z-50 w-[min(480px,calc(100vw-2rem))] font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 border shadow-lg shadow-black/40 flex items-center justify-between gap-3";

/** The in-flow page notice (`?created=1`, `?removed=`), lined up with the page beneath it. */
export const PAGE_NOTICE = `${FRAME_WIDTH} bg-rose-950/60 border border-rose-400/70 font-mono text-[0.85rem] text-stone-50 rounded-md px-4 py-3 flex items-start justify-between gap-3`;
/**
 * The measure every Smoke sentence holds: 25rem is about 70 characters of
 * Nunito at 0.8rem. In rem, not ch, because a ch is the width of a zero —
 * roughly 1.35 of Nunito's average letter — so `70ch` held about 95 letters.
 * Only the prose stops here; the card keeps the frame's width, and mono beside
 * it (commands, code, the request-path chain) stays full width.
 */
export const PROSE_MEASURE = "max-w-[25rem]";

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

/** A Smoke sentence inside a card or row, at the prose measure. */
export const BODY = `text-stone-400 text-[0.8rem] leading-snug m-0 ${PROSE_MEASURE}`;
/** A machine fact inline in a sentence: mono, at Chalk. */
export const MONO_FACT = "font-mono text-stone-50 break-all";
/**
 * A control's caption: one Nunito sentence at 0.75rem, with its facts as
 * CAPTION_FILE (a declaration's file name, which may break anywhere rather
 * than widen a narrow row) or CAPTION_KEEP (a short fixed fact, which keeps
 * together: `lychee-resources` broke at its hyphen at 390px).
 */
export const CAPTION = "text-[0.75rem] leading-snug text-stone-400";
export const CAPTION_FILE = "font-mono text-stone-50 [overflow-wrap:anywhere]";
export const CAPTION_KEEP = "font-mono text-stone-50 whitespace-nowrap";
/**
 * A path is a machine fact and is case-sensitive, so it takes the Micro-label
 * size and weight but never its uppercase — the one place in the system where
 * that transform is dropped. Used by add site's preview and the detail page's
 * scaffold files.
 */
export const PATH_LABEL = "font-mono text-[0.6875rem] font-medium tracking-[0.02em] text-stone-400 m-0 break-all";
/** A single-line copyable command box. */
export const CODE_LINE =
  "font-mono text-[0.72rem] bg-stone-900 border border-stone-700 rounded-md pl-2.5 pr-11 py-2.5 text-stone-50 overflow-x-auto whitespace-nowrap m-0";
/** The copy button the client binds by [data-copy-target] (sharedBindings.ts); callers append its position. */
export const COPY_BUTTON = `p-1 rounded-md bg-stone-800 border border-stone-700 text-stone-400 hover:text-stone-50 hover:bg-stone-700 cursor-pointer ${FOCUS_RING}`;
/**
 * Position for a copy button sitting in a single-line command box: vertically
 * centred, so it does not depend on the box's exact height.
 *
 * No font-size override here deliberately — the icon inherits 16px, matching
 * the multi-line workflow block's button, so all six copy buttons are one size.
 * That makes the button 26px, which CODE_LINE's py-2.5 is chosen to clear with
 * an even gap (6.6px above and below against 6px to the right), and pr-11 keeps
 * it off the command text. Those three values are coupled: changing the padding
 * on either the button or the box unbalances the gap.
 */
export const COPY_IN_LINE = "absolute top-1/2 -translate-y-1/2 right-1.5";

export const CARD = "bg-stone-800 border border-stone-700 rounded-[10px] p-5";
/**
 * The size, weight, and tracking every card label shares. Split out because
 * the Danger card needs the same type at a different colour and margin, and
 * Tailwind resolves competing utilities by stylesheet order, not by the order
 * they appear in a class attribute — so appending an override is unreliable.
 */
export const CARD_LABEL_BASE = "font-mono text-[0.75rem] font-medium uppercase tracking-[0.1em]";
export const CARD_LABEL = `${CARD_LABEL_BASE} text-stone-300 m-0 mb-3`;

export const TONE_TEXT: Record<StatusTone, string> = {
  ok: "text-green-300",
  bad: "text-red-300",
  neutral: "text-stone-300",
};

/**
 * The plus icon's path data, as data, so the React list can draw the same
 * icon without parsing markup. ICONS.plus is built from it.
 */
export const PLUS_PATHS: readonly string[] = ["M5 12h14", "M12 5v14"];

/** Every icon's <svg> class: one text line's height, never shrunk by flex. */
export const ICON_CLASS = "w-[1em] h-[1em] shrink-0";

export const ICONS = {
  plus: PLUS_PATHS.map((d) => `<path d="${d}" />`).join(""),
  trash: `<path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" />`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />`,
  check: `<path d="M20 6 9 17l-5-5" />`,
  externalLink: `<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />`,
  chevronDown: `<path d="m6 9 6 6 6-6" />`,
  menu: `<path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" />`,
  search: `<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />`,
  layoutGrid: `<rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" />`,
};

/**
 * A bad-tone status word as a predicate, so a unit and a container read alike
 * in What to check and in the sites list's host-trouble block. Only these four
 * are bad-tone unit or container states; any other word falls back to a plain
 * "is <word>" rather than a wrong claim; shared.test.ts pins the fallback.
 */
export function statePhrase(word: string): string {
  switch (word) {
    case "exited":
      return "has stopped";
    case "restarting":
      return "keeps restarting";
    case "paused":
      return "is paused";
    case "unhealthy":
      return "is running but failing its health check";
    default:
      return `is ${word}`;
  }
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

/**
 * How long something took, from two timestamps systemd or ISO: "2s",
 * "3m 41s", "1h 4m". Null when either end is unparseable or the span is
 * negative, so callers omit the fact rather than print nonsense.
 */
export function formatDuration(start: string | null | undefined, end: string | null | undefined): string | null {
  const from = parseTimestamp(start);
  const to = parseTimestamp(end);
  if (from === null || to === null || to < from) return null;
  const seconds = Math.round((to - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
