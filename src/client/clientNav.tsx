import { createContext, useContext, type AnchorHTMLAttributes } from "react";
import { Link } from "react-router";
import type { ServiceGroup } from "../shared/board";

/*
 * Which URLs the client renders, and the one rule every in-app link and
 * navigation follows: the router handles a move only when both the page the
 * operator is on and the target are client routes. Anything else is a plain
 * document load, so a server page's body can never be left on screen under a
 * route the client cannot render (Review Focus 3).
 *
 * This module is the router's leaf: the rail and find import it, and the
 * router (router.tsx) provides the context, so neither imports the other.
 */

/** The board's three pages, by path; each renders one group. */
export const BOARD_ROUTES = {
  "/services": "service",
  "/reconciler": "reconciler",
  "/infrastructure": "infrastructure",
} as const satisfies Record<string, ServiceGroup>;

export type BoardRoute = keyof typeof BOARD_ROUTES;

/** The path part of a same-origin href (query and hash dropped), or null for anything absolute. */
function pathOf(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  return href.split(/[?#]/, 1)[0] ?? null;
}

/** True when `href` is one of the pages the client renders, whatever query or hash it carries. */
export function isClientRoute(href: string): boolean {
  const path = pathOf(href);
  return path !== null && Object.hasOwn(BOARD_ROUTES, path);
}

/** The board route a path is, or null. */
export function boardRouteOf(href: string): BoardRoute | null {
  const path = pathOf(href);
  return path !== null && Object.hasOwn(BOARD_ROUTES, path) ? (path as BoardRoute) : null;
}

export interface ClientNav {
  /** The router's current pathname. */
  pathname: string;
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
