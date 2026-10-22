// What the navigation rail says, as data: tones, attention, the counting rule,
// unit hrefs and the class strings both rail renderers share. No node imports:
// Vite bundles this file into the client.
import type { Site } from "../lib/caddyfile";
import { describeStatus, deployTrouble, type SiteStatus } from "../lib/siteDisplay";
import { hostnameForResource } from "../lib/siteResource";
import type { BoardRow, ServiceBoard, ServiceGroup } from "../shared/board";
import type { HealthPayload, SiteHealth, Tone, UnitHealth } from "../shared/health";
import { rowLabels } from "./boardFacts";
import { FOCUS_RING } from "./shared";

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

export const RAIL_COUNT_BAD = "font-mono text-[0.75rem] rounded-full px-1.5 bg-red-950/60 text-red-300";
export const RAIL_COUNT_ZERO = "font-mono text-[0.75rem] text-stone-500";
