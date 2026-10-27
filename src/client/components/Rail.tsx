import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { splitHostnameForDisplay } from "../../lib/siteDisplay";
import type { HealthPayload, Tone } from "../../shared/health";
import {
  RAIL_ASIDE,
  RAIL_DOT,
  RAIL_HEADING,
  RAIL_HEADING_LINK,
  RAIL_DRAWER,
  RAIL_COUNT_BAD,
  RAIL_COUNT_PAIR,
  RAIL_COUNT_UNKNOWN,
  RAIL_HINT,
  RAIL_HOSTNAME,
  RAIL_MENU,
  RAIL_NOTE,
  RAIL_ROW,
  RAIL_WIDE_QUERY,
  TOP_BAR,
  attentionCounts,
  type GroupCount,
} from "../../views/railModel";
import { FOCUS_RING, ICONS, formatAge } from "../../views/shared";
import type { RailCurrent, RailData } from "../../shared/rail";
import { FindPanel } from "./FindPanel";
import { ADD_SITE_ROUTE, RailLink, SITES_ROUTE, boardRouteOf, siteOf, useClientNav, type BoardRoute } from "../clientNav";

/*
 * The rail's children in JSX. With `health: null` its render equals the
 * retired server rail's, element for element, frozen in
 * src/dev/fixtures/rail/ and pinned by Rail.test.tsx and
 * AppFrameParity.test.tsx. Navigation (below) renders the aside around it.
 *
 * Every link goes through RailLink (clientNav.tsx): a router link only
 * between two client routes, otherwise a plain anchor, which is all the
 * parity tests (rendering outside any router) see.
 */

export interface RailProps {
  rail: RailData;
  /** The latest health payload, or null before the first answer. */
  health: HealthPayload | null;
  /** The latest poll failed. Old data is never shown as current when it did. */
  healthError: boolean;
  /** When health was last read successfully (ISO), for the unavailable line. */
  lastRead: string | null;
  /** The find box's printed shortcut: `⌘K` (the default) or `Ctrl K`. */
  findHint?: string;
  /** The reference time for "last read …"; now by default. */
  now?: Date;
  /** How the find box starts: the drawer's opens empty, focused when opened on find. */
  findInitial?: { query: string; focused: boolean };
  /** Opens a find result; by default the router between client routes, `location.assign` otherwise. */
  navigate?: (href: string) => void;
  /** This rail is the narrow-screen drawer's, not the aside's. */
  inDrawer?: boolean;
  /** ⌘K while the rail is collapsed (below 900px): open the drawer on find. */
  onNarrowShortcut?: (previous: Element | null) => void;
}

const isPage = (current: RailCurrent, page: string): boolean =>
  current !== null && "page" in current && current.page === page;

const isSite = (current: RailCurrent, hostname: string): boolean =>
  current !== null && "site" in current && current.site === hostname;

const ariaCurrent = (on: boolean): "page" | undefined => (on ? "page" : undefined);

function Wordmark() {
  return (
    <RailLink
      href="/"
      aria-label="lychee-admin"
      className={`font-display text-2xl tracking-wide text-stone-50 m-0 no-underline ${FOCUS_RING}`}
    >
      lychee<span className="font-mono text-[0.85rem] tracking-[0.02em] text-stone-300 ml-[0.35em]">admin</span>
    </RailLink>
  );
}

/** An icon from shared.ts's ICONS, as the retired server rail drew it. */
function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="w-[1em] h-[1em] shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

/**
 * A count slot. Null renders the server's empty slot (no reading, or a failed
 * one), and so does nothing to count: a row with nothing to report carries no
 * mark, seen or spoken. Otherwise what is bad is a Scorch chip
 * and what could not be read a neutral one beside it, never summed into one
 * Scorch number (critique 2026-10-27 P1), each saying what it counts. `lead`
 * is spoken before it, so a link reads "services, 4 need attention".
 */
function Count({ name, value, lead = ", " }: { name: string; value: GroupCount | null; lead?: string }) {
  if (value === null || (value.bad === 0 && value.unknown === 0)) return <span data-count={name} />;
  const spoken = lead ? <span className="sr-only">{lead}</span> : null;
  return (
    <>
      {spoken}
      <span data-count={name} className={RAIL_COUNT_PAIR}>
        {value.bad > 0 ? (
          <span data-count-bad="" className={RAIL_COUNT_BAD}>
            {value.bad}
            <span className="sr-only">{value.bad === 1 ? " needs attention" : " need attention"}</span>
          </span>
        ) : null}
        {value.bad > 0 && value.unknown > 0 ? <span className="sr-only">, </span> : null}
        {value.unknown > 0 ? (
          <span data-count-unknown="" className={RAIL_COUNT_UNKNOWN}>
            {value.unknown}
            <span className="sr-only"> unknown</span>
          </span>
        ) : null}
      </span>
    </>
  );
}

interface DotState {
  tone: Tone;
  /** The status phrase a screen reader hears in place of the dot's colour. */
  label: string;
}

const HOST_LINKS = [
  { href: "/services", label: "services", page: "services", count: "service" },
  { href: "/reconciler", label: "reconciler", page: "reconciler", count: "reconciler" },
  { href: "/infrastructure", label: "infrastructure", page: "infrastructure", count: "infrastructure" },
] as const;

/** Each board route's rail item. */
const ROUTE_PAGE: Record<BoardRoute, "services" | "reconciler" | "infrastructure"> = {
  "/services": "services",
  "/reconciler": "reconciler",
  "/infrastructure": "infrastructure",
};

export function Rail({
  rail,
  health,
  healthError,
  lastRead,
  findHint = "⌘K",
  now,
  findInitial,
  navigate,
  inDrawer,
  onNarrowShortcut,
}: RailProps) {
  // On a client route the router's location is where the operator is. The
  // add page marks nothing: the rail has no Add site, and its breadcrumb
  // carries the location. Anywhere else (outside a router, as the parity
  // tests render it) `rail.current` stands.
  const nav = useClientNav();
  const route = nav ? boardRouteOf(nav.pathname) : null;
  const site = nav ? siteOf(nav.pathname) : null;
  const current: RailCurrent = route
    ? { page: ROUTE_PAGE[route] }
    : nav?.pathname === SITES_ROUTE
      ? { page: "sites" }
      : nav?.pathname === ADD_SITE_ROUTE
        ? null
        : site
          ? { site }
          : rail.current;

  // A failed poll shows nothing it remembers: TanStack keeps the last data,
  // and a green dot from it would be a lie about now.
  const live = healthError ? null : health;
  const counts = live ? attentionCounts(live, (rail.sites ?? []).map((s) => s.hostname)) : null;
  const byHost = new Map((live?.sites ?? []).map((s) => [s.hostname, s]));

  // The rail's own list decides the rows; the payload only colours them. A
  // site the payload lacks stays hollow, and one it adds gets no row.
  const dotFor = (hostname: string, hint: string): DotState => {
    if (healthError) return hint === "static" ? { tone: "none", label: "" } : { tone: "neutral", label: "unknown" };
    const entry = byHost.get(hostname);
    return entry ? { tone: entry.tone, label: entry.label } : { tone: "none", label: "" };
  };

  const age = healthError && lastRead ? formatAge(lastRead, now ?? new Date()) : null;

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 px-3 py-5">
        <h1 className="m-0 px-2 text-base font-normal leading-none">
          <Wordmark />
        </h1>
        <FindPanel
          health={live}
          railSites={rail.sites}
          domain={rail.domain}
          findHint={findHint}
          navigate={navigate}
          initialQuery={findInitial?.query}
          initialFocused={findInitial?.focused}
          inDrawer={inDrawer}
          onNarrowShortcut={onNarrowShortcut}
        />
        <nav aria-label="Sites" className="flex flex-col gap-0.5">
          <RailLink href="/" className={RAIL_HEADING_LINK} aria-current={ariaCurrent(isPage(current, "sites"))}>
            {/* The domain is said once here, so a row can show its label alone. */}
            <span>
              sites
              {rail.domain ? (
                <span data-rail-domain="" aria-hidden="true">
                  {` · ${rail.domain}`}
                </span>
              ) : null}
            </span>
            <Count name="sites" value={counts ? counts.sites : null} />
          </RailLink>
          {rail.sites === null ? (
            <p className={RAIL_NOTE}>Can&apos;t read the Caddyfile</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {rail.sites.map((site) => {
                const { lead, dimmed } = splitHostnameForDisplay(site.hostname, rail.domain);
                const dot = dotFor(site.hostname, site.hint);
                return (
                  <li key={site.hostname}>
                    <RailLink
                      href={`/sites/${encodeURIComponent(site.hostname)}`}
                      className={RAIL_ROW}
                      data-site={site.hostname}
                      aria-current={ariaCurrent(isSite(current, site.hostname))}
                    >
                      <span className={RAIL_DOT[dot.tone]} data-dot="" aria-hidden="true" />
                      <span className={RAIL_HOSTNAME}>
                        <span className="text-stone-50">{lead}</span>
                        {/* Heard, not shown: the heading names the domain. */}
                        {dimmed ? <span className="sr-only">{dimmed}</span> : null}
                      </span>
                      <span className="sr-only">, </span>
                      <span className={RAIL_HINT}>{site.hint}</span>
                      {dot.label ? <span className="sr-only">, {dot.label}</span> : null}
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
          {healthError ? (
            <p className={RAIL_NOTE} data-health-unavailable="">
              {age ? `health unavailable · last read ${age}` : "health unavailable"}
            </p>
          ) : null}
        </nav>
        <nav aria-label="Host" className="flex flex-col gap-0.5">
          <p className={`${RAIL_HEADING} m-0`}>host</p>
          {HOST_LINKS.map((link) => (
            <RailLink
              key={link.href}
              href={link.href}
              className={`${RAIL_ROW} justify-between`}
              aria-current={ariaCurrent(isPage(current, link.page))}
            >
              {link.label}
              {rail.hostAvailable ? <Count name={link.count} value={counts ? counts[link.count] : null} /> : null}
            </RailLink>
          ))}
          {rail.hostAvailable ? null : <p className={RAIL_NOTE}>Inventory unavailable</p>}
        </nav>
      </div>
    </>
  );
}

export interface TopBarProps {
  health: HealthPayload | null;
  /** The hostnames the rail lists; health entries for any other are not counted. */
  hostnames: readonly string[];
  healthError: boolean;
  /** Open the rail as a drawer, from `opener`; on find when `focusFind`. */
  onOpen: (opener: HTMLElement, focusFind: boolean) => void;
}

/**
 * The narrow-screen top bar's children, the retired server top bar's element
 * for element (frozen in src/dev/fixtures/rail/top-bar.html, which the parity
 * tests pin): the wordmark h1, the overall attention count (sites plus
 * units), a find button and the menu button.
 */
export function TopBar({ health, hostnames, healthError, onOpen }: TopBarProps) {
  const counts = !healthError && health ? attentionCounts(health, hostnames) : null;
  const total: GroupCount | null = counts ? counts.total : null;
  return (
    <>
      <h1 className="m-0 text-base font-normal leading-none">
        <Wordmark />
      </h1>
      <div className="flex items-center gap-2">
        <Count name="all" value={total} lead="" />
        <button
          type="button"
          id="rail-find"
          aria-label="Find a site or unit"
          className={RAIL_MENU}
          onClick={(e) => onOpen(e.currentTarget, true)}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          id="rail-menu"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          className={RAIL_MENU}
          onClick={(e) => onOpen(e.currentTarget, false)}
        >
          <Icon name="menu" />
        </button>
      </div>
    </>
  );
}

/**
 * The drawer: a modal `<dialog>`, shown on mount, that closes on Escape or a
 * click on its backdrop. A backdrop click targets the dialog itself and lands
 * outside its box: the same bounding-rect check the remove dialog uses
 * (RemoveDialog.tsx). Shown in a layout effect, so it is open before find (a passive
 * effect) takes focus inside it.
 */
function Drawer({
  onClose,
  dialogRef: ref,
  children,
}: {
  onClose: () => void;
  /** The dialog, for Navigation to close at once when the router moves. */
  dialogRef: RefObject<HTMLDialogElement | null>;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, [ref]);

  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    const dialog = e.currentTarget;
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-label="Navigation"
      className={RAIL_DRAWER}
      onClick={onClick}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A close that skipped cancel (dialog.close(), older Chromium) would leave
      // the rail inside a closed dialog with the state still open.
      onClose={() => onClose()}
      onKeyDown={(e) => {
        // Find's own Escape (closing its open panel) comes first and is prevented.
        if (e.key !== "Escape" || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

/** The rail's props, less the ones Navigation decides itself (where find starts, and the drawer). */
export type NavigationProps = Omit<RailProps, "findInitial" | "inDrawer" | "onNarrowShortcut">;

interface DrawerState {
  /** What opened the drawer, which gets focus back when it closes. */
  opener: HTMLElement | null;
  /** Open on find (⌘K, the find button) rather than on the rail's first link. */
  focusFind: boolean;
}

/**
 * The narrow-screen `<header id="top-bar">` and the rail's
 * `<aside id="rail">`, with the drawer inside the header. AppFrame renders
 * it first in the body, so the two are the body grid's first items.
 *
 * The drawer holds the rail itself: while it is open the rail renders inside
 * the dialog and not in the aside, so there is only ever one rail, one `#find`
 * and one ⌘K listener in the document.
 */
export function Navigation(props: NavigationProps) {
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const open = (opener: Element | null, focusFind: boolean) => {
    setDrawer({ opener: opener instanceof HTMLElement && opener !== document.body ? opener : null, focusFind });
  };

  // Idempotent: Escape's cancel and a native `close` event can both arrive.
  // A close because the router moved returns focus nowhere: the new page's
  // heading takes it.
  const close = () => {
    if (!drawer) return;
    restoreTo.current = navigatedAway.current ? null : drawer.opener;
    setDrawer(null);
  };

  // Focus goes back to whatever opened the drawer, once the rail is back in the aside.
  useEffect(() => {
    if (drawer) return;
    navigatedAway.current = false;
    const target = restoreTo.current;
    restoreTo.current = null;
    if (target?.isConnected) target.focus();
  }, [drawer]);

  // An in-app move from inside the drawer (a rail link, find's Enter) leaves
  // the page behind it changed: the drawer closes. Natively first, in this
  // layout effect, so the page is no longer inert by the time the new page's
  // own effect moves focus to its heading; then in state.
  const isOpen = drawer !== null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigatedAway = useRef(false);
  const locationKey = useClientNav()?.locationKey;
  const seenKey = useRef(locationKey);
  useLayoutEffect(() => {
    if (locationKey === seenKey.current) return;
    seenKey.current = locationKey;
    if (!isOpen) return;
    navigatedAway.current = true;
    dialogRef.current?.close();
    setDrawer(null);
  }, [locationKey, isOpen]);

  // Widening past 900px brings the rail back beside the content: the drawer goes.
  useEffect(() => {
    if (!isOpen || typeof window.matchMedia !== "function") return;
    const wide = window.matchMedia(RAIL_WIDE_QUERY);
    const onChange = () => {
      if (wide.matches) setDrawer(null);
    };
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, [isOpen]);

  const rail = drawer ? (
    <Rail {...props} inDrawer findInitial={{ query: "", focused: drawer.focusFind }} />
  ) : (
    <Rail {...props} onNarrowShortcut={(previous) => open(previous, true)} />
  );

  return (
    <>
      <header id="top-bar" className={TOP_BAR}>
        <TopBar health={props.health} hostnames={(props.rail.sites ?? []).map((s) => s.hostname)} healthError={props.healthError} onOpen={open} />
        {drawer ? (
          <Drawer onClose={close} dialogRef={dialogRef}>
            {rail}
          </Drawer>
        ) : null}
      </header>
      <aside id="rail" data-rail="" aria-label="Navigation" className={RAIL_ASIDE}>
        {drawer ? null : rail}
      </aside>
    </>
  );
}
