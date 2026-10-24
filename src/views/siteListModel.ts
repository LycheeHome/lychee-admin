// The sites list's class strings, words and row logic. The React list
// (src/client/components/SiteList.tsx) renders from this; the retired server
// list did too, and its output is frozen in src/dev/fixtures/sites/, which
// SiteListParity.test.tsx compares the React list against. The site page
// takes FRAMEWORK_LABELS from here. No node imports: Vite bundles this file
// into the client.
import { BUTTON_PRIMARY, FOCUS_RING } from "./shared";

/** A framework's display name, as the list's address and the site page's last hop write it. */
export const FRAMEWORK_LABELS: Record<string, string> = {
  nextjs: "Next.js",
};

/** The fields of a site the list reads: both a Caddyfile Site and an API SiteSummary carry them. */
type ListedSite = { hostname: string; type: "static" | "reverse-proxy"; target: string; framework?: string };

/** A row's link: the site's page (a client route, moved to in-app by RailLink inside the router). */
export function siteHref(hostname: string): string {
  return `/sites/${encodeURIComponent(hostname)}`;
}

/**
 * The address states the type: a path reads as static and localhost:port as a
 * proxy, so neither needs a label — a path needs no "path:" in front of it,
 * and a port is meaningless without the host it is on.
 */
export function siteAddress(site: ListedSite): string {
  if (site.type === "static") return site.target;
  const frameworkLabel = site.framework ? FRAMEWORK_LABELS[site.framework] : undefined;
  return `localhost:${site.target}${frameworkLabel ? ` · ${frameworkLabel}` : ""}`;
}

/** The subdomain pattern the empty state names, e.g. `*.lychee.land`. */
export function domainPattern(domain: string): string {
  return `*.${domain}`;
}

/**
 * One site's row. Full-bleed hover (`-mx-3` against the row's own `px-3`) so
 * the highlight reaches the content column's edges rather than stopping at
 * the text, and a hairline under every row but the last.
 */
export const SITE_ROW =
  `flex items-center justify-between gap-5 py-4 px-3 -mx-3 rounded-md no-underline ` +
  `border-b border-stone-700 last:border-b-0 ` +
  `motion-safe:transition-colors motion-safe:duration-150 hover:bg-stone-800 ${FOCUS_RING}`;

/** The slot right-aligns the status pill so the column lines up; a static row leaves it empty. */
export const STATUS_SLOT = "flex justify-end";

/**
 * A comma only a screen reader hears. A row's accessible name is computed from
 * its contents, so without these the three facts run together as
 * "api.lychee.land localhost:4000 not responding". Separators rather than an
 * aria-label, deliberately: the name keeps deriving from the visible text, so
 * it cannot drift from what is on screen the way a hand-written label does.
 * `sr-only` is absolutely positioned, so it contributes nothing to the flex
 * layout it sits inside — no phantom gap.
 */
export const SPOKEN_COMMA_CLASS = "sr-only";
export const SPOKEN_COMMA_TEXT = ", ";

export const SITE_ROW_TEXT = "flex flex-col gap-1.5 min-w-0";
export const SITE_HOSTNAME = "font-display text-base leading-relaxed text-stone-50 break-words";
export const SITE_HOSTNAME_DIMMED = "text-stone-400";
export const SITE_ADDRESS = "font-mono text-stone-400 text-[0.8rem] leading-relaxed break-all";
export const SITE_ROW_SIDE = "flex items-center gap-3 shrink-0";
export const SITE_ROWS = "flex flex-col";

export const SITES_HEADING_ROW = "flex items-center justify-between gap-4 mb-5";
export const SITES_HEADING =
  "font-mono text-[0.85rem] font-medium uppercase tracking-[0.08em] text-stone-400 m-0";
export const SITES_HEADING_TEXT = "Sites";
/** The heading's Add site, and the empty state's: the page's one Ember action. */
export const ADD_SITE_BUTTON = `${BUTTON_PRIMARY} no-underline`;
export const ADD_SITE_TEXT = "Add site";
/** The page Add site opens: its title, which the server's shell and the client's in-app arrival both set. */
export const ADD_SITE_TITLE = "Add a site";

// The host-trouble block. Consequence first, in plain sans: it is what the
// operator needs to know, and only the machine fact (the unit and its state)
// is red.
export const HOST_PROBLEMS = "flex flex-col gap-1.5 pb-4 mb-5 border-b border-stone-700";
export const HOST_PROBLEM_LINE = "m-0 font-sans text-[0.85rem] leading-relaxed text-stone-50";
export const HOST_PROBLEM_UNIT = "font-mono text-red-300";
export const HOST_PROBLEM_LINK = `text-stone-300 underline hover:text-stone-50 ${FOCUS_RING}`;

export const EMPTY_STATE =
  "flex flex-col items-center text-center gap-4 border border-stone-700 rounded-[10px] bg-stone-800 px-6 py-6";
export const EMPTY_STATE_TITLE = "font-sans font-semibold text-base text-stone-50 m-0";
export const EMPTY_STATE_BODY = "text-stone-400 text-[0.8rem] m-0 max-w-[46ch]";
export const EMPTY_STATE_CODE = "font-mono text-[0.72rem] text-stone-300 bg-stone-900 rounded-[4px] px-1";
export const EMPTY_STATE_TITLE_TEXT = "No sites yet";
/** The body sentence either side of the domain pattern. */
export const EMPTY_STATE_LEAD = "A site is one ";
export const EMPTY_STATE_TAIL =
  " subdomain wired through Caddy and the sites tunnel — either a folder of static files, or a reverse proxy to a local port.";
export const EMPTY_STATE_CTA_TEXT = "Add your first site";
