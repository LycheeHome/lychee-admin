import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { splitHostnameForDisplay } from "../../lib/siteDisplay";
import type { HealthPayload, Tone } from "../../shared/health";
import {
  RAIL_COUNT_BAD,
  RAIL_COUNT_ZERO,
  RAIL_DOT,
  RAIL_HEADING,
  RAIL_HEADING_LINK,
  RAIL_DRAWER,
  RAIL_HINT,
  RAIL_HOSTNAME,
  RAIL_MENU,
  RAIL_NOTE,
  RAIL_ROW,
  RAIL_WIDE_QUERY,
  attentionCounts,
} from "../../views/railModel";
import { FOCUS_RING, ICONS, formatAge } from "../../views/shared";
import type { RailCurrent, RailData } from "../../views/shell";
import { FindPanel } from "./FindPanel";

/*
 * The rail's children in JSX. It mirrors renderRail in src/views/rail.ts
 * element for element — with `health: null` its render equals the server
 * aside's inner markup, which the parity test pins — so a change to either
 * belongs in both until the server rail is retired. The aside itself stays
 * the server's: the island mounts onto it and renders only what is inside.
 */

export interface RailProps {
  rail: RailData;
  /** The latest health payload, or null before the first answer. */
  health: HealthPayload | null;
  /** The latest poll failed. Old data is never shown as current when it did. */
  healthError: boolean;
  /** When health was last read successfully (ISO), for the unavailable line. */
  lastRead: string | null;
  /** The find box's printed shortcut: `⌘K` (the server's) or `Ctrl K`. */
  findHint?: string;
  /** The reference time for "last read …"; now by default. */
  now?: Date;
  /** What the server's find box held when the island mounted over it. */
  findInitial?: { query: string; focused: boolean };
  /** Opens a find result; `location.assign` by default. */
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
    <a
      href="/"
      aria-label="lychee-admin"
      className={`font-display text-2xl tracking-wide text-stone-50 m-0 no-underline ${FOCUS_RING}`}
    >
      lychee<span className="font-mono text-[0.85rem] tracking-[0.02em] text-stone-300 ml-[0.35em]">admin</span>
    </a>
  );
}

/** shared.ts's icon(name), from the same path data. */
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
 * A count slot. Null renders the server's empty slot (no reading, or a
 * failed one); zero is quiet Smoke Deep; above zero is Scorch on its chip.
 */
function Count({ name, value }: { name: string; value: number | null }) {
  if (value === null) return <span data-count={name} />;
  return (
    <span data-count={name} className={value > 0 ? RAIL_COUNT_BAD : RAIL_COUNT_ZERO}>
      {value}
    </span>
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
          <a href="/" className={RAIL_HEADING_LINK} aria-current={ariaCurrent(isPage(rail.current, "sites"))}>
            sites
            <Count name="sites" value={counts ? counts.sites : null} />
          </a>
          {rail.sites === null ? (
            <p className={RAIL_NOTE}>Can&apos;t read the Caddyfile</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-0.5">
              {rail.sites.map((site) => {
                const { lead, dimmed } = splitHostnameForDisplay(site.hostname, rail.domain);
                const dot = dotFor(site.hostname, site.hint);
                return (
                  <li key={site.hostname}>
                    <a
                      href={`/sites/${encodeURIComponent(site.hostname)}`}
                      className={RAIL_ROW}
                      data-site={site.hostname}
                      aria-current={ariaCurrent(isSite(rail.current, site.hostname))}
                    >
                      <span className={RAIL_DOT[dot.tone]} data-dot="" aria-hidden="true" />
                      <span className={RAIL_HOSTNAME}>
                        <span className="text-stone-50">{lead}</span>
                        <wbr />
                        {dimmed}
                      </span>
                      <span className="sr-only">, </span>
                      <span className={RAIL_HINT}>{site.hint}</span>
                      {dot.label ? <span className="sr-only">, {dot.label}</span> : null}
                    </a>
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
            <a
              key={link.href}
              href={link.href}
              className={`${RAIL_ROW} justify-between`}
              aria-current={ariaCurrent(isPage(rail.current, link.page))}
            >
              {link.label}
              {rail.hostAvailable ? <Count name={link.count} value={counts ? counts[link.count] : null} /> : null}
            </a>
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
 * The narrow-screen top bar's children, mirroring renderTopBar in
 * src/views/rail.ts (the parity test pins it): the wordmark h1, the overall
 * attention count (sites plus units), a find button and the menu button.
 */
export function TopBar({ health, hostnames, healthError, onOpen }: TopBarProps) {
  const counts = !healthError && health ? attentionCounts(health, hostnames) : null;
  const total = counts
    ? counts.sites + (counts.service ?? 0) + (counts.reconciler ?? 0) + (counts.infrastructure ?? 0)
    : null;
  return (
    <>
      <h1 className="m-0 text-base font-normal leading-none">
        <Wordmark />
      </h1>
      <div className="flex items-center gap-2">
        {total === null ? (
          <span data-count="all" />
        ) : (
          <span data-count="all" className={total > 0 ? RAIL_COUNT_BAD : RAIL_COUNT_ZERO}>
            {total}
            <span className="sr-only"> need attention</span>
          </span>
        )}
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
 * outside its box: the same bounding-rect check public/app.js uses for its
 * modals. Shown in a layout effect, so it is open before find (a passive
 * effect) takes focus inside it.
 */
function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

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

export interface NavigationProps extends RailProps {
  /** The server's `<header id="top-bar">`, whose children this takes over; null where there is none. */
  topBar: Element | null;
}

interface DrawerState {
  /** What opened the drawer, which gets focus back when it closes. */
  opener: HTMLElement | null;
  /** Open on find (⌘K, the find button) rather than on the rail's first link. */
  focusFind: boolean;
}

/**
 * The rail and the top bar together, with the narrow-screen drawer between
 * them. Mounted on the rail's aside, it renders the rail there and the top
 * bar's children into the server's header through a portal, removing the
 * server's own once React's are in.
 *
 * The drawer holds the rail itself: while it is open the rail renders inside
 * the dialog and not in the aside, so there is only ever one rail, one `#find`
 * and one ⌘K listener in the document.
 */
export function Navigation({ topBar, ...props }: NavigationProps) {
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  // What the server's find box held applies once, to the aside's first render.
  const [findInitial, setFindInitial] = useState(props.findInitial);
  const restoreTo = useRef<HTMLElement | null>(null);

  // The server's top-bar children, captured before React's go in beside them
  // and removed in the same commit, so the bar never shows twice.
  const [serverBar] = useState(() => (topBar ? Array.from(topBar.childNodes) : []));
  useLayoutEffect(() => {
    for (const node of serverBar) node.parentNode?.removeChild(node);
  }, [serverBar]);

  const open = (opener: Element | null, focusFind: boolean) => {
    setFindInitial(undefined);
    setDrawer({ opener: opener instanceof HTMLElement && opener !== document.body ? opener : null, focusFind });
  };

  // Idempotent: Escape's cancel and a native `close` event can both arrive.
  const close = () => {
    if (!drawer) return;
    restoreTo.current = drawer.opener;
    setDrawer(null);
  };

  // Focus goes back to whatever opened the drawer, once the rail is back in the aside.
  useEffect(() => {
    if (drawer) return;
    const target = restoreTo.current;
    restoreTo.current = null;
    if (target?.isConnected) target.focus();
  }, [drawer]);

  // Widening past 900px brings the rail back beside the content: the drawer goes.
  const isOpen = drawer !== null;
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
    <Rail
      {...props}
      findInitial={findInitial}
      onNarrowShortcut={topBar ? (previous) => open(previous, true) : undefined}
    />
  );

  return (
    <>
      {drawer ? null : rail}
      {topBar
        ? createPortal(
            <>
              <TopBar health={props.health} hostnames={(props.rail.sites ?? []).map((s) => s.hostname)} healthError={props.healthError} onOpen={open} />
              {drawer ? <Drawer onClose={close}>{rail}</Drawer> : null}
            </>,
            topBar,
          )
        : null}
    </>
  );
}
