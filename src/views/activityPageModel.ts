/**
 * The activity page's pure parts: the URL's filters, the local-day grouping
 * and its labels, and the page's class strings. Node-free.
 */
import type { ActivityFilters } from "../shared/activity";
import { ACTIVITY_TH } from "./overviewModel";
import { CARD_LABEL_BASE, FOCUS_RING, FRAME_WIDTH, INPUT } from "./shared";

/** The URL's filters; who and kind stay strings so an unknown one reaches the server's 400. */
export type ActivityUrlFilters = Omit<ActivityFilters, "who" | "kind"> & {
  who: string | null;
  kind: string | null;
};

export function filtersFromSearch(search: URLSearchParams): ActivityUrlFilters {
  const get = (k: string): string | null => {
    const v = search.get(k);
    return v ? v : null;
  };
  return { subject: get("subject"), who: get("who"), kind: get("kind") };
}

export function searchFromFilters(f: ActivityUrlFilters): string {
  const p = new URLSearchParams();
  if (f.subject) p.set("subject", f.subject);
  if (f.who) p.set("who", f.who);
  if (f.kind) p.set("kind", f.kind);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasFilters(f: ActivityUrlFilters): boolean {
  return Boolean(f.subject || f.who || f.kind);
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD`. */
export function dayKey(at: string): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;

export function dayLabel(at: string, now: Date): string {
  const d = new Date(at);
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  const key = dayKey(at);
  if (key === dayKey(now.toISOString())) return `today · ${base}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  if (key === dayKey(yesterday.toISOString())) return `yesterday · ${base}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

export const ACTIVITY_PAGE = `${FRAME_WIDTH} flex flex-col gap-6`;
export const ACTIVITY_FILTERS = "flex flex-wrap items-end gap-4";
export const ACTIVITY_FILTER_LABEL = "grid gap-1";
export const ACTIVITY_FILTER_CAPTION = `${CARD_LABEL_BASE} text-stone-300`;
export const ACTIVITY_SELECT = `${INPUT} min-w-[150px] text-[0.8rem]`;
export const ACTIVITY_DAY_TH = `${ACTIVITY_TH} pt-6 text-left`;
export const ACTIVITY_DETAIL = "block max-w-[60ch] font-mono text-[0.75rem] text-stone-300 break-words whitespace-normal mt-1";
/**
 * The page's subject: a hostname breaks only when it cannot fit its column
 * (`break-word` leaves min-content at the whole word, where the overview's
 * `anywhere` cuts it to one character and let a long detail line squeeze it).
 */
export const ACTIVITY_PAGE_SUBJECT = "font-mono text-[0.8rem] text-stone-50 [overflow-wrap:break-word]";
export const ACTIVITY_PAGE_SUBJECT_LINK = `${ACTIVITY_PAGE_SUBJECT} no-underline hover:underline ${FOCUS_RING}`;
/** The paragraph holding the table's "see all activity" link. */
export const ACTIVITY_SEE_ALL_ROW = "m-0 mt-3";
/** Under the table: Show older (or the end-of-history line) with a failed page's alert beside it. */
export const ACTIVITY_PAGER = "mt-4 flex flex-wrap items-center gap-3";
export const ACTIVITY_END = "font-mono text-[0.75rem] text-stone-400";
export const ACTIVITY_SEE_ALL = `font-mono text-[0.75rem] text-stone-300 underline decoration-stone-600 underline-offset-4 ${FOCUS_RING}`;
