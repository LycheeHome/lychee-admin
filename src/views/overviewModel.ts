// What the overview page says, as data: the four-cell strip, the needs-attention
// rows, the rail's single signal, and their class strings (OverviewPage.tsx, Rail.tsx).
// No node imports: Vite bundles this file into the client.
import type { ActivityEvent } from "../shared/activity";
import type { HealthPayload, UnitHealth } from "../shared/health";
import { attentionCounts, isUnknown } from "./railModel";
import { CARD, CARD_LABEL_BASE, FOCUS_RING, FRAME_WIDTH, formatAge } from "./shared";

export type OverviewPage = "sites" | "services" | "reconciler" | "infrastructure";

export interface StripCell {
  page: OverviewPage;
  href: string;
  /** "8 sites", "1 unit"; null when there is nothing to show. */
  total: string | null;
  bad: number;
  unknown: number;
  note: string | null;
}

/** attentionCounts over the payload's own site hostnames: the one count the page and the signal share. */
export function overviewCounts(h: HealthPayload): ReturnType<typeof attentionCounts> {
  return attentionCounts(h, h.sites.map((s) => s.hostname));
}

const CELLS: { page: OverviewPage; href: string; group: UnitHealth["group"] | null }[] = [
  { page: "sites", href: "/sites", group: null },
  { page: "services", href: "/services", group: "service" },
  { page: "reconciler", href: "/reconciler", group: "reconciler" },
  { page: "infrastructure", href: "/infrastructure", group: "infrastructure" },
];

const noun = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function stripCells(h: HealthPayload | null, failed: boolean, now: Date): StripCell[] {
  if (!h || failed) {
    return CELLS.map((c) => ({ page: c.page, href: c.href, total: null, bad: 0, unknown: 0, note: null }));
  }
  const counts = overviewCounts(h);
  return CELLS.map(({ page, href, group }) => {
    const count = group === null ? counts.sites : counts[group];
    const total = group === null ? noun(h.sites.length, "site") : count && h.units ? noun(h.units.filter((u) => u.group === group).length, "unit") : null;
    if (!count) return { page, href, total: null, bad: 0, unknown: 0, note: "inventory unavailable" };
    const tick = page === "reconciler" && h.generated ? formatAge(h.generated, now) : null;
    const note = tick !== null ? `last tick ${tick}` : count.bad === 0 && count.unknown === 0 ? "all clear" : null;
    return { page, href, total, bad: count.bad, unknown: count.unknown, note };
  });
}

export interface AttentionRow {
  subject: string;
  href: string;
  word: string;
  tone: "bad" | "neutral";
  where: OverviewPage;
}

const PAGE_OF: Record<UnitHealth["group"], OverviewPage> = {
  service: "services",
  reconciler: "reconciler",
  infrastructure: "infrastructure",
};

const unitWord = (u: UnitHealth) => (u.trouble ? `deploy ${u.trouble}` : u.label);

export function attentionRows(h: HealthPayload): { bad: AttentionRow[]; unknown: AttentionRow[] } {
  const bad: AttentionRow[] = [];
  const unknown: AttentionRow[] = [];
  const units = h.units ?? [];
  for (const s of h.sites) {
    const own = units.filter((u) => u.site === s.hostname);
    const href = `/sites/${s.hostname}`;
    const row = (word: string, tone: AttentionRow["tone"]): AttentionRow => ({ subject: s.hostname, href, word, tone, where: "sites" });
    if (s.attention || own.some((u) => u.attention)) {
      const container = own.find((u) => u.attention);
      bad.push(row(s.attention ? s.label : unitWord(container!), "bad"));
    } else if (isUnknown(s) || own.some(isUnknown)) {
      unknown.push(row(isUnknown(s) ? s.label : own.find(isUnknown)!.label, "neutral"));
    }
  }
  for (const u of units) {
    if (u.site !== null) continue;
    const row = (tone: AttentionRow["tone"]): AttentionRow => ({ subject: u.name, href: u.href, word: unitWord(u), tone, where: PAGE_OF[u.group] });
    if (u.attention) bad.push(row("bad"));
    else if (isUnknown(u)) unknown.push(row("neutral"));
  }
  return { bad, unknown };
}

export interface OverviewSignal {
  tone: "bad" | "neutral";
  count: number | null;
  /** Appended to the link's accessible name, with its leading comma. */
  spoken: string;
}

/** The rail's one mark: the worst tone present, never a sum. Null when pending or clean. */
export function overviewSignal(h: HealthPayload | null, failed: boolean): OverviewSignal | null {
  if (failed) return { tone: "neutral", count: null, spoken: ", health unavailable" };
  if (!h) return null;
  const { bad, unknown } = overviewCounts(h).total;
  if (bad > 0) return { tone: "bad", count: bad, spoken: `, ${bad} ${bad === 1 ? "needs" : "need"} attention` };
  if (unknown > 0) return { tone: "neutral", count: unknown, spoken: `, ${unknown} couldn't be read` };
  return null;
}

// Class strings. Hearth Lift bg-stone-800, Hairline border-stone-700, Smoke text-stone-400,
// Smoke Light text-stone-300, Chalk text-stone-50, Scorch text-red-300.

/** The strip: the card's ground and edge with no padding, one flat card of four cells. */
export const STRIP = `${CARD.replace(" p-5", "")} grid grid-cols-2 sm:grid-cols-4 overflow-hidden`;
/**
 * One cell: a padded router link, hairline-ruled from its neighbours. Below
 * `sm` the strip is 2×2: a left rule on the 2nd and 4th cells and a top rule
 * on the 3rd and 4th, so no rule doubles the card's edge. From `sm` it is one
 * row: a left rule on cells 2–4 and no top rule.
 */
export const STRIP_CELL =
  "px-5 py-4 grid gap-1.5 content-start no-underline border-stone-700 " +
  "[&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t " +
  "sm:[&:nth-child(n+2)]:border-l sm:[&:nth-child(n+3)]:border-t-0 " +
  // The ring is drawn inside the cell: the strip clips its overflow.
  "hover:bg-stone-700/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-400 focus-visible:-outline-offset-2";
export const STRIP_LABEL = `${CARD_LABEL_BASE} text-stone-300 m-0`;
export const STRIP_TOTAL = "font-mono text-[0.95rem] text-stone-50 flex items-center gap-2 flex-wrap";
/** Keeps its line's height when empty so the cells stay level. */
export const STRIP_NOTE = "font-mono text-[0.75rem] text-stone-400 min-h-[1lh]";

/** The needs-attention heading, a section label in Scorch. */
export const ATTENTION_HEADING = `${CARD_LABEL_BASE} text-red-300 m-0 mb-2`;
/** The unknown rows' neutral subheading. */
export const ATTENTION_SUBHEAD = `${CARD_LABEL_BASE} text-stone-300 m-0 mb-2 [&:not(:first-child)]:mt-4`;
export const ATTENTION_LIST = "m-0 p-0 list-none";
/** The pill keeps its own width at the start of its 150px column. */
export const ATTENTION_PILL = "justify-self-start";
/** Pill column fixed at 150px so every pill's left edge lines up, then the subject, then where. */
export const ATTENTION_ROW =
  "grid grid-cols-[150px_minmax(0,1fr)_auto] gap-4 items-center py-2 border-b border-stone-700 " +
  `no-underline hover:bg-stone-700/40 ${FOCUS_RING}`;
/** The row's subject: a hostname or unit name, wrapping rather than widening the row. */
export const ATTENTION_SUBJECT = "font-mono text-[0.85rem] text-stone-50 [overflow-wrap:anywhere]";
export const ATTENTION_WHERE = "font-mono text-[0.75rem] text-stone-400 text-right";
/** The block's one line when the health poll has failed: neutral, never Scorch. */
export const ATTENTION_UNAVAILABLE = "m-0 font-mono text-[0.8rem] text-stone-400";

/** The page: the frame's width, its blocks stacked as a board page's are. */
export const OVERVIEW_PAGE = `${FRAME_WIDTH} flex flex-col gap-8`;
/** The `Overview` eyebrow: BoardRows' page heading, letter for letter. */
export const OVERVIEW_HEADING = "font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0";

export const ACTIVITY_HEADING = `${CARD_LABEL_BASE} text-stone-300 m-0 mb-2`;
/** A sentence under (or instead of) the table: sans, neutral. */
export const ACTIVITY_NOTE = "m-0 mt-3 text-[0.8rem] leading-snug text-stone-400 max-w-[25rem]";
/** Spaces a failed re-read's alert from the table it sits under. */
export const ACTIVITY_ALERT_SLOT = "mt-3";
export const ACTIVITY_TABLE = "w-full border-collapse text-left";
export const ACTIVITY_TH = `${CARD_LABEL_BASE} text-stone-300 font-medium py-2 pr-4 border-b border-stone-700`;
export const ACTIVITY_TD = "font-mono text-[0.8rem] text-stone-400 py-2 pr-4 border-b border-stone-700 align-top";
/** The kind chip: shaped, neutral, never a tone. */
export const ACTIVITY_KIND_TAG =
  "font-mono text-[0.72rem] text-stone-300 rounded-full border border-stone-600 px-2 inline-block";
export const ACTIVITY_OUTCOME: Record<ActivityEvent["tone"], string> = {
  ok: "font-mono text-[0.8rem] text-green-300",
  bad: "font-mono text-[0.8rem] text-red-300",
  neutral: "font-mono text-[0.8rem] text-stone-300",
};
/** A 63-character label must wrap inside its cell, not widen the page. */
export const ACTIVITY_SUBJECT = "font-mono text-[0.8rem] text-stone-50 [overflow-wrap:anywhere]";
export const ACTIVITY_SUBJECT_LINK = `${ACTIVITY_SUBJECT} no-underline hover:underline ${FOCUS_RING}`;

/** The overview row's signal slot in the rail: the dot, then the count. */
export const RAIL_SIGNAL = "ml-auto inline-flex items-center gap-1.5 shrink-0";
export const RAIL_SIGNAL_DOT: Record<"bad" | "neutral", string> = {
  bad: "inline-block size-1.5 rounded-full bg-red-300",
  neutral: "inline-block size-1.5 rounded-full bg-stone-400",
};
export const RAIL_SIGNAL_COUNT: Record<"bad" | "neutral", string> = {
  bad: "font-mono text-[0.72rem] text-red-300",
  neutral: "font-mono text-[0.72rem] text-stone-400",
};
/** The narrow top bar's menu-button badge: the same mark, pinned to the button's corner. */
export const MENU_BADGE: Record<"bad" | "neutral", string> = {
  bad: "absolute -top-1 -right-1 inline-flex items-center gap-1 rounded-full bg-stone-900 px-1 font-mono text-[0.65rem] text-red-300",
  neutral: "absolute -top-1 -right-1 inline-flex items-center gap-1 rounded-full bg-stone-900 px-1 font-mono text-[0.65rem] text-stone-400",
};
