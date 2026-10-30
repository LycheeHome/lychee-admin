import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { splitHostnameForDisplay } from "../../lib/siteDisplay";
import type { HealthPayload } from "../../shared/health";
import {
  RAIL_ASIDE,
  RAIL_DIVIDER,
  RAIL_DRAWER,
  RAIL_HEAD,
  RAIL_HINT,
  RAIL_HOSTNAME,
  RAIL_ICON,
  RAIL_MENU,
  RAIL_NOTE,
  RAIL_PLACE,
  RAIL_PLACES,
  RAIL_ROW,
  RAIL_TOGGLE,
  RAIL_WIDE_QUERY,
  TOP_BAR,
  type RailPlace,
} from "../../views/railModel";
import { MENU_BADGE, RAIL_SIGNAL, RAIL_SIGNAL_COUNT, RAIL_SIGNAL_DOT, overviewSignal } from "../../views/overviewModel";
import { FOCUS_RING, ICON_CLASS, ICONS } from "../../views/shared";
import type { RailCurrent, RailData } from "../../shared/rail";
import { FindPanel } from "./FindPanel";
import {
  ADD_SITE_ROUTE,
  ACTIVITY_ROUTE,
  OVERVIEW_ROUTE,
  RailLink,
  SITES_ROUTE,
  boardRouteOf,
  siteOf,
  useClientNav,
  type BoardRoute,
} from "../clientNav";

/*
 * The rail's children in JSX. With `health: null` its render equals the
 * retired server rail's, element for element, frozen in
 * src/dev/fixtures/rail/ and pinned by Rail.test.tsx and
 * AppFrameParity.test.tsx, through the declared redesigns (the `rail-*`
 * entries in test/redesigns.ts): no dots or count slots, the overview row,
 * and `sites` on /sites. Navigation (below) renders the aside around it.
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
  /** The find box's printed shortcut: `⌘K` (the default) or `Ctrl K`. */
  findHint?: string;
  /** How the find box starts: the drawer's opens empty, focused when opened on find. */
  findInitial?: { query: string; focused: boolean };
  /** Opens a find result; by default the router between client routes, `location.assign` otherwise. */
  navigate?: (href: string) => void;
  /** This rail is the narrow-screen drawer's, not the aside's. */
  inDrawer?: boolean;
  /** ⌘K while the rail is collapsed (below 900px): open the drawer on find. */
  onNarrowShortcut?: (previous: Element | null) => void;
  /** The wide rail is the icon strip (spec 2026-10-29-collapsible-rail). */
  collapsed?: boolean;
  /** The collapse button was pressed; it is passed so focus can follow it. */
  onToggle?: (button: HTMLButtonElement) => void;
  /** The strip's find button was pressed. */
  onFindOpen?: (button: HTMLButtonElement) => void;
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

/** An icon from shared.ts's ICONS, as the retired server rail drew it; a place row's at RAIL_ICON. */
function Icon({ name, className = ICON_CLASS }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg
      className={className}
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
 * The whole host's one signal, on the overview row (spec 2026-10-28-overview-page):
 * a dot and the worst tone's count, seen but hidden from assistive tech, which
 * hears the spoken phrase instead. Nothing at all when overviewSignal says so
 * (before the first answer, or with nothing to report).
 */
function Signal({ signal }: { signal: ReturnType<typeof overviewSignal> }) {
  if (!signal) return null;
  return (
    <>
      <span data-signal="" aria-hidden="true" className={RAIL_SIGNAL}>
        <span className={RAIL_SIGNAL_DOT[signal.tone]} />
        {signal.count === null ? null : <span className={RAIL_SIGNAL_COUNT[signal.tone]}>{signal.count}</span>}
      </span>
      <span className="sr-only">{signal.spoken}</span>
    </>
  );
}

const placeOf = (place: RailPlace) => RAIL_PLACES.find((p) => p.place === place)!;

/**
 * A place row: its icon, then its word. No `justify-between`, which the
 * frozen overview and host rows carried: beside an icon it would push the
 * word to the row's far edge. Overview's signal keeps right with its own
 * `ml-auto`.
 */
function PlaceLink({ place, current, children }: { place: RailPlace; current: RailCurrent; children?: ReactNode }) {
  return (
    <RailLink href={placeOf(place).href} className={RAIL_PLACE} aria-current={ariaCurrent(isPage(current, place))}>
      <Icon name={place} className={RAIL_ICON} />
      {place}
      {children}
    </RailLink>
  );
}

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
  findHint = "⌘K",
  findInitial,
  navigate,
  inDrawer,
  onNarrowShortcut,
  onToggle,
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
    : nav?.pathname === OVERVIEW_ROUTE
      ? { page: "overview" }
      : nav?.pathname === ACTIVITY_ROUTE
        ? { page: "activity" }
        : nav?.pathname === SITES_ROUTE
        ? { page: "sites" }
        : nav?.pathname === ADD_SITE_ROUTE
          ? null
          : site
            ? { site }
            : rail.current;

  // A failed poll shows nothing it remembers: TanStack keeps the last data,
  // and anything drawn from it would be a lie about now.
  const live = healthError ? null : health;
  const signal = overviewSignal(health, healthError);
  const heading = (
    <h1 className="m-0 px-2 text-base font-normal leading-none">
      <Wordmark />
    </h1>
  );

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-5 px-3 py-5">
        {inDrawer ? (
          heading
        ) : (
          // The drawer has no collapse: below 900px the rail is never a strip.
          <div className={RAIL_HEAD}>
            {heading}
            <button
              type="button"
              id="rail-toggle"
              className={RAIL_TOGGLE}
              aria-label="Collapse sidebar"
              aria-expanded="true"
              aria-controls="rail"
              onClick={(e) => onToggle?.(e.currentTarget)}
            >
              <Icon name="panelClose" />
            </button>
          </div>
        )}
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
        <nav aria-label="Overview" className="flex flex-col gap-0.5">
          <PlaceLink place="overview" current={current}>
            <Signal signal={signal} />
          </PlaceLink>
          <PlaceLink place="activity" current={current} />
        </nav>
        <nav aria-label="Sites" className="flex flex-col gap-0.5">
          <PlaceLink place="sites" current={current} />
          {rail.sites === null ? (
            <p className={RAIL_NOTE}>Can&apos;t read the Caddyfile</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {rail.sites.map((site) => {
                const { lead, dimmed } = splitHostnameForDisplay(site.hostname, rail.domain);
                return (
                  <li key={site.hostname}>
                    <RailLink
                      href={`/sites/${encodeURIComponent(site.hostname)}`}
                      className={RAIL_ROW}
                      data-site={site.hostname}
                      aria-current={ariaCurrent(isSite(current, site.hostname))}
                    >
                      <span className={RAIL_HOSTNAME}>
                        <span className="text-stone-50">{lead}</span>
                        {/* Heard, not shown: every row shares the domain, so a row shows its label alone. */}
                        {dimmed ? <span className="sr-only">{dimmed}</span> : null}
                      </span>
                      <span className="sr-only">, </span>
                      <span className={RAIL_HINT}>{site.hint}</span>
                    </RailLink>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
        <div aria-hidden="true" className={RAIL_DIVIDER} />
        <nav aria-label="Host" className="flex flex-col gap-0.5">
          {RAIL_PLACES.filter((p) => p.group === "host").map((p) => (
            <PlaceLink key={p.place} place={p.place} current={current} />
          ))}
          {rail.hostAvailable ? null : <p className={RAIL_NOTE}>Inventory unavailable</p>}
        </nav>
      </div>
    </>
  );
}

export interface TopBarProps {
  health: HealthPayload | null;
  healthError: boolean;
  /** Open the rail as a drawer, from `opener`; on find when `focusFind`. */
  onOpen: (opener: HTMLElement, focusFind: boolean) => void;
}

/**
 * The narrow-screen top bar's children, the retired server top bar's element
 * for element (frozen in src/dev/fixtures/rail/top-bar.html, which the parity
 * tests pin, less its empty count slot): the wordmark h1, a find button and
 * the menu button, which carries the overview row's signal as a badge, since
 * it opens the drawer holding that row. The signal counts the payload's own
 * sites, as the overview page does.
 */
export function TopBar({ health, healthError, onOpen }: TopBarProps) {
  const signal = overviewSignal(health, healthError);
  return (
    <>
      <h1 className="m-0 text-base font-normal leading-none">
        <Wordmark />
      </h1>
      <div className="flex items-center gap-2">
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
          aria-label={signal ? `Open navigation${signal.spoken}` : "Open navigation"}
          aria-haspopup="dialog"
          // `relative` only with a badge to place: without one the button is the server's.
          className={signal ? `${RAIL_MENU} relative` : RAIL_MENU}
          onClick={(e) => onOpen(e.currentTarget, false)}
        >
          <Icon name="menu" />
          {signal ? (
            <span data-signal="" aria-hidden="true" className={MENU_BADGE[signal.tone]}>
              {signal.count === null ? "●" : `● ${signal.count}`}
            </span>
          ) : null}
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
        <TopBar health={props.health} healthError={props.healthError} onOpen={open} />
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
