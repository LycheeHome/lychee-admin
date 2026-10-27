// What the ⌘K find panel lists, as data. Pure: no DOM, no React.
import type { ServiceGroup } from "../shared/board";
import type { HealthPayload, Tone, UnitHealth } from "../shared/health";
import type { RailData } from "../shared/rail";

export type FindItem =
  | {
      kind: "site";
      hostname: string;
      tone: Tone;
      /** The status phrase; empty for a static site, null when no health has been read. */
      label: string | null;
      href: string;
    }
  | {
      kind: "unit";
      name: string;
      group: ServiceGroup;
      tone: UnitHealth["tone"];
      label: string;
      trouble: UnitHealth["trouble"];
      href: string;
    };

export type FindGroupKey = "sites" | ServiceGroup;

/** Always in the order sites, service, reconciler, infrastructure; unit groups only when units were read. */
export type FindGroups = Array<{ key: FindGroupKey; items: FindItem[] }>;

const UNIT_GROUPS: readonly ServiceGroup[] = ["service", "reconciler", "infrastructure"];

const siteHref = (hostname: string): string => `/sites/${encodeURIComponent(hostname)}`;

const unitItem = (u: UnitHealth): FindItem => ({
  kind: "unit",
  name: u.name,
  group: u.group,
  tone: u.tone,
  label: u.label,
  trouble: u.trouble,
  href: u.href,
});

/**
 * A literal, case-insensitive substring test. Never a RegExp: the query is
 * typed by the operator, and `a.l` or `(` must mean exactly those characters.
 */
const matches = (needle: string) => (haystack: string): boolean => haystack.toLowerCase().includes(needle);

/** A site's container is listed as its site, never also as a unit. */
function group(units: UnitHealth[] | null, keep: (u: UnitHealth) => boolean): FindGroups {
  if (!units) return [];
  return UNIT_GROUPS.map((key) => ({
    key,
    items: units.filter((u) => u.group === key && u.site === null && keep(u)).map(unitItem),
  }));
}

/** With nothing typed: every site and unit that needs attention. Nothing at all before health is read. */
export function attentionResults(health: HealthPayload | null): FindGroups {
  if (!health) return [];
  const sites = health.sites
    .filter((s) => s.attention)
    .map((s): FindItem => ({ kind: "site", hostname: s.hostname, tone: s.tone, label: s.label, href: siteHref(s.hostname) }));
  return [{ key: "sites", items: sites }, ...group(health.units, (u) => u.attention)];
}

/**
 * A typed query, matched against hostnames and unit names. Sites come from
 * the health payload; before one has arrived, from the rail's own list,
 * without labels, and no units are listed.
 */
export function findResults(query: string, health: HealthPayload | null, railSites: RailData["sites"]): FindGroups {
  const hit = matches(query.trim().toLowerCase());
  const sites: FindItem[] = health
    ? health.sites
        .filter((s) => hit(s.hostname))
        .map((s) => ({ kind: "site", hostname: s.hostname, tone: s.tone, label: s.label, href: siteHref(s.hostname) }))
    : (railSites ?? [])
        .filter((s) => hit(s.hostname))
        .map((s) => ({ kind: "site", hostname: s.hostname, tone: "none", label: null, href: siteHref(s.hostname) }));
  return [{ key: "sites", items: sites }, ...group(health?.units ?? null, (u) => hit(u.name))];
}
