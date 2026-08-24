import type { StatusTone } from "../lib/siteDisplay";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const BUTTON_PRIMARY =
  "font-sans font-semibold text-sm bg-rose-400 text-stone-900 border-none rounded-md px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-rose-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
export const BUTTON_SECONDARY =
  "font-sans font-semibold text-sm bg-transparent text-stone-400 border border-stone-600 rounded-md px-4 py-2.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-stone-700 hover:text-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
export const BUTTON_DANGER =
  "font-sans font-semibold text-[0.8rem] bg-transparent text-red-300 border border-red-800 rounded-md px-3 py-1.5 cursor-pointer inline-flex items-center gap-1.5 hover:bg-red-900 hover:text-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
export const INPUT =
  "font-mono bg-stone-900 border border-stone-700 rounded-md text-stone-50 px-2.5 py-2 text-sm placeholder:text-stone-400 focus:outline focus:outline-2 focus:outline-rose-400 focus:outline-offset-2";
export const FORM_LABEL = "flex flex-col gap-1.5 text-[0.85rem] text-stone-400";
export const STATUS_PILL_BASE =
  "inline-flex items-center gap-1 shrink-0 font-mono text-[0.65rem] uppercase tracking-[0.06em] px-2.5 py-1 rounded-full border border-transparent";
export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:outline-offset-2";
export const DETAIL_WIDTH = "max-w-[760px] mx-auto w-full";
export const TYPE_PILL_STATIC = "border-stone-600 text-stone-50 bg-stone-700";
export const TYPE_PILL_PROXY = "border-transparent text-rose-300 bg-rose-950";

export const TONE_PILL: Record<StatusTone, string> = {
  ok: `${STATUS_PILL_BASE} text-green-300 bg-green-950/60`,
  bad: `${STATUS_PILL_BASE} text-red-300 bg-red-950/60`,
  neutral: `${STATUS_PILL_BASE} text-stone-300 bg-stone-700`,
};

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
