// The server's rail: the navigation every page renders, with no health. Every
// dot is hollow and every count slot empty; the client island (Task 3) takes
// the markup over and fills them in from /api/health. Class strings come from
// railModel.ts so the island's first render can match this one exactly.
import { splitHostnameForDisplay } from "../lib/siteDisplay";
import type { RailCurrent, RailData } from "./shell";
import { FOCUS_RING, escapeHtml, icon } from "./shared";
import {
  RAIL_ADD_SITE,
  RAIL_DOT,
  RAIL_FIND,
  RAIL_FIND_HINT,
  RAIL_HEADING,
  RAIL_HEADING_LINK,
  RAIL_HINT,
  RAIL_MENU,
  RAIL_NOTE,
  RAIL_ROW,
} from "./railModel";

type RailPage = Extract<RailCurrent, { page: string }>["page"];

const isPage = (current: RailCurrent, page: RailPage): boolean =>
  current !== null && "page" in current && current.page === page;

const isSite = (current: RailCurrent, hostname: string): boolean =>
  current !== null && "site" in current && current.site === hostname;

const ariaCurrent = (on: boolean): string => (on ? ` aria-current="page"` : "");

/** A comma only a screen reader hears, so a row's name is not "api.lychee.land:4000". */
const SPOKEN_COMMA = `<span class="sr-only">, </span>`;

/**
 * "lychee" in the display face with "admin" as a quiet mono qualifier, and no
 * dot between them: the first site row is a hostname in a nearby face, and a
 * dotted mark directly above it read as another hostname. The aria-label
 * restores the name the visual gap leaves out.
 */
export function renderWordmark(): string {
  return `<a href="/" aria-label="lychee-admin" class="font-display text-2xl tracking-wide text-stone-50 m-0 no-underline ${FOCUS_RING}">lychee<span class="font-mono text-[0.85rem] tracking-[0.02em] text-stone-300 ml-[0.35em]">admin</span></a>`;
}

/**
 * One site, as a row: a dot, the hostname with its label in Chalk, and its
 * type hint. `min-w-0 break-all` on the hostname, never `truncate`: a 63-
 * character label must wrap inside 250px, and two long names that share a
 * prefix must not render identically.
 */
function siteRow(site: { hostname: string; hint: string }, rail: RailData): string {
  const { lead, dimmed } = splitHostnameForDisplay(site.hostname, rail.domain);
  const host = escapeHtml(site.hostname);
  return `<li><a href="/sites/${encodeURIComponent(site.hostname)}" class="${RAIL_ROW}" data-site="${host}"${ariaCurrent(isSite(rail.current, site.hostname))}><span class="${RAIL_DOT.none}" data-dot aria-hidden="true"></span><span class="min-w-0 break-all"><span class="text-stone-50">${escapeHtml(lead)}</span>${escapeHtml(dimmed)}</span>${SPOKEN_COMMA}<span class="${RAIL_HINT}">${escapeHtml(site.hint)}</span></a></li>`;
}

const HOST_LINKS: ReadonlyArray<{ href: string; label: string; page: RailPage; count: string }> = [
  { href: "/services", label: "services", page: "services", count: "service" },
  { href: "/reconciler", label: "reconciler", page: "reconciler", count: "reconciler" },
  { href: "/infrastructure", label: "infrastructure", page: "infrastructure", count: "infrastructure" },
];

/**
 * The rail: wordmark, find, sites, host, and Add site pinned at the foot.
 * Only rail markup goes inside the aside; anything the island needs beside it
 * (its JSON data) is a sibling after it.
 */
export function renderRail(rail: RailData): string {
  const sites =
    rail.sites === null
      ? `<p class="${RAIL_NOTE}">Can't read the Caddyfile</p>`
      : `<ul class="list-none m-0 p-0 flex flex-col gap-0.5">${rail.sites.map((s) => siteRow(s, rail)).join("")}</ul>`;

  const hostLinks = HOST_LINKS.map(
    (link) =>
      `<a href="${link.href}" class="${RAIL_ROW} justify-between"${ariaCurrent(isPage(rail.current, link.page))}>${link.label}${
        rail.hostAvailable ? `<span data-count="${link.count}"></span>` : ""
      }</a>`,
  ).join("");

  return `<aside id="rail" data-rail aria-label="Navigation" class="hidden min-[900px]:flex flex-col sticky top-0 self-start h-screen border-r border-stone-700 bg-stone-900">
    <div class="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 px-3 py-5">
      <h1 class="m-0 px-2 text-base font-normal leading-none">${renderWordmark()}</h1>
      <div class="relative">
        <input id="find" type="text" autocomplete="off" spellcheck="false" placeholder="find" aria-label="Find a site or unit" role="combobox" aria-expanded="false" aria-controls="find-list" aria-autocomplete="list" class="${RAIL_FIND}" />
        <kbd data-find-hint class="${RAIL_FIND_HINT}">⌘K</kbd>
      </div>
      <nav aria-label="Sites" class="flex flex-col gap-0.5">
        <a href="/" class="${RAIL_HEADING_LINK}"${ariaCurrent(isPage(rail.current, "sites"))}>sites<span data-count="sites"></span></a>
        ${sites}
      </nav>
      <nav aria-label="Host" class="flex flex-col gap-0.5">
        <p class="${RAIL_HEADING} m-0">host</p>
        ${hostLinks}${rail.hostAvailable ? "" : `\n        <p class="${RAIL_NOTE}">Inventory unavailable</p>`}
      </nav>
    </div>
    <div class="shrink-0 border-t border-stone-700 px-3 py-3">
      <a href="/sites/new" class="${RAIL_ADD_SITE}"${ariaCurrent(isPage(rail.current, "new"))}>${icon("plus")}Add site</a>
    </div>
  </aside>`;
}

/**
 * The rail's data for the client island, which re-renders the rail's markup
 * from it. A sibling after the aside, never inside it: the island owns the
 * aside's children. Every `<` is escaped as `<`, which JSON.parse reads
 * back as `<`, so no value (a hostname is user input) can close the script.
 */
export function renderRailData(rail: RailData): string {
  const json = JSON.stringify(rail).replace(/</g, "\\u003c");
  return `<script type="application/json" id="rail-data">${json}</script>`;
}

/**
 * Below 900px the rail is hidden and this bar stands in for it: the wordmark
 * and a menu button that will open the rail as a drawer. The wordmark here is
 * not an h1; the rail's is, so a page has exactly one.
 */
export function renderTopBar(): string {
  return `<header id="top-bar" class="min-[900px]:hidden flex items-center justify-between gap-4 px-4 py-3 border-b border-stone-700">
    ${renderWordmark()}
    <button type="button" id="rail-menu" aria-label="Open navigation" class="${RAIL_MENU}">${icon("menu")}</button>
  </header>`;
}
