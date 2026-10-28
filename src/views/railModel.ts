// What the navigation rail says, as data: tones, attention, the counting rule,
// unit hrefs and the rail's class strings (Rail.tsx, FindPanel.tsx). No node imports:
// Vite bundles this file into the client.
import type { Site } from "../lib/caddyfile";
import { describeStatus, type SiteStatus } from "../lib/siteDisplay";
import { hostnameForResource } from "../lib/siteNames";
import type { BoardRow, ServiceBoard, ServiceGroup } from "../shared/board";
import type { HealthPayload, SiteHealth, Tone, UnitHealth } from "../shared/health";
import type { ActionState } from "../lib/hostOperations";
import { rowShown, type RowShownContext } from "./boardRowModel";
import { FOCUS_RING, INPUT } from "./shared";

/** A static site (no status) is hollow and never needs attention. */
export function siteHealth(site: Site, status: SiteStatus | undefined): SiteHealth {
  if (!status) return { hostname: site.hostname, tone: "none", label: "", attention: false };
  const { pill, tone } = describeStatus(status);
  return { hostname: site.hostname, tone, label: pill, attention: tone === "bad" };
}

const GROUP_PAGE: Record<ServiceGroup, string> = {
  service: "/services",
  reconciler: "/reconciler",
  infrastructure: "/infrastructure",
};

/** A unit's board row: the page for its group, at the row's anchor. */
export function unitHref(name: string, group: ServiceGroup): string {
  return `${GROUP_PAGE[group]}#service-${name}`;
}

const NOTHING_SHOWN: RowShownContext = { prunable: new Set(), retiring: new Set(), domain: "", run: undefined };

/** What the board page knows beyond the rows themselves: the retired sets and each row's last host action. */
export interface BoardShown {
  prunable: ReadonlySet<string>;
  retiring: ReadonlySet<string>;
  lastRuns: Readonly<Record<string, ActionState>>;
}

/**
 * A unit needs attention when its board row does: a bad pill, or a last run
 * that is blocked or failed (not merely waiting). It reads the row's verdict
 * as the board does, so a page's count and its summary line agree.
 */
export function unitHealth(
  row: BoardRow,
  group: ServiceGroup,
  site: string | null = null,
  shown: RowShownContext = NOTHING_SHOWN,
): UnitHealth {
  const { labels, trouble: found } = rowShown(row, shown);
  const { pill, tone } = labels;
  const trouble = found && (found.word === "blocked" || found.word === "failed") && found.tone === "bad" ? found.word : null;
  return {
    name: row.name,
    group,
    tone,
    label: pill,
    trouble,
    href: unitHref(row.name, group),
    attention: tone === "bad" || trouble !== null,
    site,
  };
}

/**
 * The counting rule: each page counts what it shows, so a site's container is
 * a unit on its board page, marked with its site, and the overall count takes
 * it once, as that site.
 */
export function buildHealth(
  sites: Site[],
  statuses: Record<string, SiteStatus>,
  board: ServiceBoard,
  domain: string,
  now: Date,
  shown: BoardShown = { prunable: new Set(), retiring: new Set(), lastRuns: {} },
): HealthPayload {
  const managed = new Set(sites.map((s) => s.hostname));
  // Own properties only, as the board reads them: a row named `toString` has no run.
  const runOf = (name: string) => (Object.hasOwn(shown.lastRuns, name) ? shown.lastRuns[name] : undefined);
  const units = board.inventoryAvailable
    ? board.groups.flatMap((g) =>
        g.rows.map((row) => {
          const host = hostnameForResource(row.name, domain);
          const ctx = { prunable: shown.prunable, retiring: shown.retiring, domain, run: runOf(row.name) };
          return unitHealth(row, g.group, host && managed.has(host) ? host : null, ctx);
        }),
      )
    : null;
  return {
    sites: sites.map((s) => siteHealth(s, statuses[s.hostname])),
    units,
    generated: board.inventoryAvailable ? board.generated : null,
    now: now.toISOString(),
  };
}

/**
 * One group's count: what is bad (attention), and what could not be read.
 * The rail prints the two apart, Scorch and neutral, so it never shows a 0
 * over an unreadable unit (critique 2026-10-26 P1: a printed 0 is a claim of
 * health) and never sums an unknown into a Scorch number (2026-10-27 P1).
 */
export type GroupCount = { bad: number; unknown: number };

/** A neutral `unknown` that is not already counted as needing attention. */
export const isUnknown = (e: { label: string; attention: boolean }) => !e.attention && e.label === "unknown";

export function attentionCounts(
  h: HealthPayload,
  listed: Iterable<string>,
): {
  sites: GroupCount;
  service: GroupCount | null;
  reconciler: GroupCount | null;
  infrastructure: GroupCount | null;
  /** Everything once: the sites, and the units that are not a site's container. */
  total: GroupCount;
} {
  // Only sites the rail lists count: a health entry with no row to show for it
  // (a site added since the page loaded) would be an unexplained number.
  const listedSet = new Set(listed);
  const tally = <T extends { label: string; attention: boolean }>(entries: T[]): GroupCount => ({
    bad: entries.filter((e) => e.attention).length,
    unknown: entries.filter(isUnknown).length,
  });
  const count = (group: ServiceGroup): GroupCount | null => (h.units ? tally(h.units.filter((u) => u.group === group)) : null);
  const listedSites = h.sites.filter((s) => listedSet.has(s.hostname));
  const sites = tally(listedSites);
  const plain = h.units ? tally(h.units.filter((u) => u.site === null)) : { bad: 0, unknown: 0 };
  // Each site once, with its container: bad if either is, unknown only if
  // neither is bad and either could not be read. A site that reads running
  // while its container's deploy is blocked is one thing needing attention.
  const own = (hostname: string) => (h.units ?? []).filter((u) => u.site === hostname);
  const siteTotal = listedSites.reduce<GroupCount>(
    (sum, s) => {
      const parts = [s, ...own(s.hostname)];
      if (parts.some((p) => p.attention)) return { ...sum, bad: sum.bad + 1 };
      if (parts.some(isUnknown)) return { ...sum, unknown: sum.unknown + 1 };
      return sum;
    },
    { bad: 0, unknown: 0 },
  );
  return {
    sites,
    service: count("service"),
    reconciler: count("reconciler"),
    infrastructure: count("infrastructure"),
    total: { bad: siteTotal.bad + plain.bad, unknown: siteTotal.unknown + plain.unknown },
  };
}

// The rail's class strings: the retired server rail's exactly, which the frozen rail fixtures pin.
// The current-item treatment is the old header's: Chalk on Hairline with a 2px Ember Edge rule.
const RAIL_CURRENT =
  `aria-[current=page]:text-stone-50 aria-[current=page]:bg-stone-700 ` +
  `aria-[current=page]:border-l-2 aria-[current=page]:border-l-rose-800`;

export const RAIL_ROW =
  `flex items-center gap-2 font-mono text-[0.85rem] no-underline text-stone-400 rounded-md px-2 py-1 ` +
  `hover:text-stone-50 ${RAIL_CURRENT} ${FOCUS_RING}`;

export const RAIL_HEADING = `flex items-center justify-between font-mono text-[0.75rem] text-stone-400 px-2 py-1`;

/** A section heading that is also a link (`sites`): the heading's type, a row's current and focus treatment. */
export const RAIL_HEADING_LINK = `${RAIL_HEADING} no-underline rounded-md hover:text-stone-50 ${RAIL_CURRENT} ${FOCUS_RING}`;


/** The find box: the shared input, full width, with room on the right for the printed shortcut. */
export const RAIL_FIND = `${INPUT} w-full pr-10 text-[0.8rem]`;

/** The shortcut printed inside the find box, `⌘K` or `Ctrl K`. */
export const RAIL_FIND_HINT =
  "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[0.72rem] text-stone-400";

/**
 * A row's hostname. `overflow-wrap: anywhere`, never `break-all`: a name that
 * fits stays whole, and only one that cannot fit (a 63-character label) breaks
 * where it must. `min-w-0` lets it shrink inside the row's flex line.
 */
export const RAIL_HOSTNAME = "min-w-0 [overflow-wrap:anywhere]";

/** The width from which the rail is shown and the top bar hidden (`min-[900px]:`). */
export const RAIL_WIDE_QUERY = "(min-width: 900px)";

/**
 * The narrow-screen drawer: a modal `<dialog>` holding the rail, pinned to
 * the left edge at full height, on the rail's own Hearth with its Hairline
 * edge. `open:flex`, never `flex`, so the UA's closed `display: none` stands.
 */
export const RAIL_DRAWER =
  "fixed inset-y-0 left-0 m-0 p-0 h-dvh max-h-none w-[280px] max-w-[calc(100vw-3rem)] " +
  "font-sans bg-stone-900 text-stone-50 border-0 border-r border-stone-700 open:flex flex-col backdrop:bg-black/60";

/** The rail's `<aside>`: hidden below 900px, a sticky full-height column from there. */
export const RAIL_ASIDE =
  "hidden min-[900px]:flex flex-col sticky top-0 self-start h-screen border-r border-stone-700 bg-stone-900";

/** The narrow-screen top bar's `<header>`, which stands in for the rail below 900px. */
export const TOP_BAR =
  "min-[900px]:hidden flex items-center justify-between gap-4 px-4 py-3 border-b border-stone-700";

/** The narrow-screen top bar's menu button, which opens the rail as a drawer. */
export const RAIL_MENU = `inline-flex items-center justify-center size-9 rounded-md bg-transparent border border-stone-700 text-stone-400 hover:text-stone-50 hover:bg-stone-800 cursor-pointer text-lg ${FOCUS_RING}`;

/** A line the rail prints in place of what it could not read. A sentence, so sans. */
export const RAIL_NOTE = "m-0 px-2 py-1 font-sans text-[0.8rem] leading-snug text-stone-400";

/**
 * A row's right-aligned type hint, `static` or `:<port>`. Smoke Light, not
 * Smoke: on the current row's Hairline fill Smoke measures 3.98:1 and fails
 * AA at this size; Smoke Light clears it.
 */
export const RAIL_HINT = "ml-auto shrink-0 text-[0.72rem] text-stone-300";

export const RAIL_DOT: Record<Tone, string> = {
  ok: "inline-block size-2 shrink-0 rounded-full bg-green-300",
  bad: "inline-block size-2 shrink-0 rounded-full bg-red-300",
  neutral: "inline-block size-2 shrink-0 rounded-full bg-stone-400",
  none: "inline-block size-2 shrink-0 rounded-full border border-stone-600 bg-transparent",
};

/**
 * The ⌘K find panel. It floats above the page beside the rail, so it takes
 * the Overlay shadow (true float), on the rail's own Hearth with a Hairline,
 * as the old hostname dropdown did. Fixed, not absolute: the rail's scroll
 * container would clip it.
 */
export const FIND_PANEL =
  "fixed z-40 w-[420px] max-w-[calc(100vw-2rem)] bg-stone-900 border border-stone-700 rounded-[10px] shadow-lg shadow-black/40";

/** The listbox, scrolling inside the panel once it is taller than the viewport allows. */
export const FIND_LIST = "max-h-[calc(100vh-8rem)] overflow-y-auto p-1.5 flex flex-col gap-2";

/** A group's label (`sites`, `services`, …): mono, the rail heading's size. */
export const FIND_HEADING = "m-0 px-2 pt-1 pb-0.5 font-mono text-[0.72rem] text-stone-400";

/** One option. The highlight is the rail's current fill, Chalk on Hairline. */
export const FIND_OPTION =
  "flex items-center gap-3 font-mono text-[0.8rem] text-stone-400 rounded-md px-2 py-1.5 cursor-pointer " +
  "aria-selected:bg-stone-700 aria-selected:text-stone-50";

/** A group's (or the whole panel's) empty sentence. A sentence, so sans, as the rail's notes are. */
export const FIND_EMPTY = RAIL_NOTE;

/** `deploy blocked` / `deploy failed` beside a unit's pill, in Scorch. */
export const FIND_TROUBLE = "font-mono text-[0.72rem] text-red-300";

export const RAIL_COUNT_BAD ="font-mono text-[0.75rem] rounded-full px-1.5 bg-red-950/60 text-red-300";
/** The slot holding a count's chips, Scorch first, side by side. */
export const RAIL_COUNT_PAIR = "inline-flex items-center gap-1";
/** A count of units nobody could read: the neutral pill's colours on the bad chip's shape. Never Scorch. */
// The inset ring is its edge on the current row, whose ground is the same stone-700.
export const RAIL_COUNT_UNKNOWN =
  "font-mono text-[0.75rem] rounded-full px-1.5 bg-stone-700 text-stone-300 ring-1 ring-inset ring-stone-600";
