import { createContext, useContext, type AnchorHTMLAttributes } from "react";
import { Link } from "react-router";
import type { ServiceGroup } from "../shared/board";

/*
 * Which URLs the client renders, and the one rule every in-app link and
 * navigation follows: the router handles a move only when both the page the
 * operator is on and the target are client routes. Anything else is a plain
 * document load, so a URL no route matches is answered by the server afresh
 * rather than left under a page the client cannot render (Review Focus 3).
 *
 * This module is the router's leaf: the rail and find import it, and the
 * router (router.tsx) provides the context, so neither imports the other.
 */

/** The board's three pages, by path; each renders one group. The other client routes are the overview (OVERVIEW_ROUTE), the sites list (SITES_ROUTE), the add page (ADD_SITE_ROUTE) and a site's page (SITE_ROUTE). */
export const BOARD_ROUTES = {
  "/services": "service",
  "/reconciler": "reconciler",
  "/infrastructure": "infrastructure",
} as const satisfies Record<string, ServiceGroup>;

export type BoardRoute = keyof typeof BOARD_ROUTES;

/** The overview's path. Matched exactly, like every route here: never as a prefix of every path. */
export const OVERVIEW_ROUTE = "/";

/** The sites list's path. Matched exactly, like every route here: never as a prefix of `/sites/…`. */
export const SITES_ROUTE = "/sites";

/** The add page. Registered before SITE_ROUTE, so "new" is never taken for a hostname. */
export const ADD_SITE_ROUTE = "/sites/new";

/** A site's page. `/sites/new` (ADD_SITE_ROUTE) is never this route. */
export const SITE_ROUTE = "/sites/:hostname";

/** The path part of a same-origin href (query and hash dropped), or null for anything absolute. */
function pathOf(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href.split(/[?#]/, 1)[0] ?? null;
}

/**
 * The hostname a site page's href names, decoded and lowercased (the server
 * matches hostnames case-insensitively), or null for anything else:
 * `/sites/new` (the add page, in any case), a deeper path, an empty or
 * undecodable segment.
 */
export function siteOf(href: string): string | null {
  const path = pathOf(href);
  const match = path?.match(/^\/sites\/([^/]+)$/);
  if (!match?.[1]) return null;
  let hostname: string;
  try {
    hostname = decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
  return hostname === "" || hostname === "new" || hostname.includes("/") ? null : hostname;
}

/** True when `href` is one of the pages the client renders (the overview, the sites list, a board page, the add page or a site's page), whatever query or hash it carries. */
export function isClientRoute(href: string): boolean {
  const path = pathOf(href);
  return (
    path !== null &&
    (path === OVERVIEW_ROUTE || path === SITES_ROUTE || path === ADD_SITE_ROUTE || Object.hasOwn(BOARD_ROUTES, path) || siteOf(path) !== null)
  );
}

/** The board route a path is, or null. */
export function boardRouteOf(href: string): BoardRoute | null {
  const path = pathOf(href);
  return path !== null && Object.hasOwn(BOARD_ROUTES, path) ? (path as BoardRoute) : null;
}

export interface ClientNav {
  /** The router's current pathname. */
  pathname: string;
  /** The router's current entry; it changes on every in-app move, a hash-only one included. */
  locationKey: string;
  /** The router's own navigate. */
  navigate: (href: string) => void;
  /**
   * The router is still on the location the document loaded at: nothing has
   * moved in-app yet. The router scrolls to a `#service-` hash on its own
   * moves, but not on the first document's, whose rows arrive after it looked.
   */
  documentLoad: boolean;
}

/**
 * Provided by the app's layout route, inside the router: null outside it (a
 * component rendered on its own, as the parity tests render the rail), which
 * makes every link a plain anchor.
 */
export const ClientNavContext = createContext<ClientNav | null>(null);

export function useClientNav(): ClientNav | null {
  return useContext(ClientNavContext);
}

/** Whether a move from where the router is to `href` stays in the app. */
function inApp(nav: ClientNav | null, href: string): nav is ClientNav {
  return nav !== null && isClientRoute(nav.pathname) && isClientRoute(href);
}

/** Opens `href`: the router's navigate between client routes, a document load otherwise. */
export function useOpen(): (href: string) => void {
  const nav = useClientNav();
  return (href) => {
    if (inApp(nav, href)) nav.navigate(href);
    else window.location.assign(href);
  };
}

type RailLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { href: string };

/**
 * A rail link: a router `<Link>` only between client routes, a plain anchor
 * everywhere else. `discover="none"` keeps the router's link markup exactly
 * the anchor's, which the rail parity test compares with the server's.
 */
export function RailLink({ href, ...rest }: RailLinkProps) {
  const nav = useClientNav();
  if (inApp(nav, href)) return <Link to={href} discover="none" {...rest} />;
  return <a href={href} {...rest} />;
}
