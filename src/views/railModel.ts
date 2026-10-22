// What the navigation rail says, as data: tones, attention, the counting rule,
// unit hrefs and the class strings both rail renderers share. No node imports:
// Vite bundles this file into the client.
import type { Site } from "../lib/caddyfile";
import { describeStatus, deployTrouble, type SiteStatus } from "../lib/siteDisplay";
import { hostnameForResource } from "../lib/siteResource";
import type { BoardRow, ServiceBoard, ServiceGroup } from "../shared/board";
import type { HealthPayload, SiteHealth, Tone, UnitHealth } from "../shared/health";
import { rowLabels } from "./boardFacts";
import { BUTTON_SECONDARY_COMPACT, FOCUS_RING, INPUT } from "./shared";

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

/** A unit needs attention when it is bad, or its last run is blocked or failed (not merely waiting). */
export function unitHealth(row: BoardRow, group: ServiceGroup): UnitHealth {
  const { pill, tone } = rowLabels(row.status);
  const found = deployTrouble(row);
  const trouble = found && (found.word === "blocked" || found.word === "failed") && found.tone === "bad" ? found.word : null;
  return {
    name: row.name,
    group,
    tone,
    label: pill,
    trouble,
    href: `${GROUP_PAGE[group]}#service-${row.name}`,
    attention: tone === "bad" || trouble !== null,
  };
}

/**
 * The counting rule: a site's container is counted once, as its site, so board
 * rows whose resource is a managed site never appear among the units.
 */
export function buildHealth(
  sites: Site[],
  statuses: Record<string, SiteStatus>,
  board: ServiceBoard,
  domain: string,
  now: Date,
): HealthPayload {
  const managed = new Set(sites.map((s) => s.hostname));
  const units = board.inventoryAvailable
    ? board.groups.flatMap((g) =>
        g.rows
          .filter((row) => {
            const host = hostnameForResource(row.name, domain);
            return !(host && managed.has(host));
          })
          .map((row) => unitHealth(row, g.group)),
      )
    : null;
  return { sites: sites.map((s) => siteHealth(s, statuses[s.hostname])), units, now: now.toISOString() };
}

export function attentionCounts(h: HealthPayload): {
  sites: number;
  service: number | null;
  reconciler: number | null;
  infrastructure: number | null;
} {
  const count = (group: ServiceGroup): number | null =>
    h.units ? h.units.filter((u) => u.group === group && u.attention).length : null;
  return {
    sites: h.sites.filter((s) => s.attention).length,
    service: count("service"),
    reconciler: count("reconciler"),
    infrastructure: count("infrastructure"),
  };
}

// Class strings shared by both rail renderers (server rail.ts, client Rail.tsx).
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

/**
 * Add site, at the rail's foot: Secondary, not Ember. The rail is on every
 * page, and an always-present Ember button would compete with each page's own
 * primary (Visit, a Deploy offer, the add form's submit), undoing "Ember
 * follows state". It takes the rows' current-item treatment, so
 * `aria-current="page"` on /sites/new stays visible.
 */
export const RAIL_ADD_SITE = `${BUTTON_SECONDARY_COMPACT} no-underline w-full justify-center ${RAIL_CURRENT}`;

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
export const RAIL_COUNT_ZERO = "font-mono text-[0.75rem] text-stone-500";
