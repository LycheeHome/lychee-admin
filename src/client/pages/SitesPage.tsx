import { useEffect, useLayoutEffect, useRef } from "react";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useClientNav } from "../clientNav";
import { fetchSites, sitesQueryKey } from "../api";
import { BOARD_ALERT } from "../components/BoardRows";
import { SiteList } from "../components/SiteList";
import { SITES_HEADING_TEXT } from "../../views/siteListModel";

/** The list's re-read: the rail's own cadence. There is no fast mode: the list has no write of its own in flight. */
export const SITES_POLL_MS = 15_000;

/**
 * The sites list's query: the route loader primes it and the page observes
 * it. It re-reads every 15s, pauses while the tab is hidden and re-reads on
 * focus. `staleTime` is the board's, for the same reason: the page would
 * otherwise mount on the loader's fresh answer and fetch it again at once.
 */
export function sitesQuery() {
  return queryOptions({
    queryKey: sitesQueryKey(),
    queryFn: fetchSites,
    refetchInterval: SITES_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  });
}

const failedLine = (reason: string): string => `Couldn't refresh the sites list: ${reason}`;

/** Focus for an in-app arrival: focusable at runtime only, so the markup at rest stays the server's. */
function focusHeading(heading: HTMLHeadingElement | null): void {
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * The sites list at `/`.
 *
 * - Rows are keyed by hostname (SiteList), so a re-read updates pills and the
 *   host-trouble block in place and never moves focus.
 * - A failed re-read keeps the last good list and says so above it, until the
 *   next good read. A failed first read shows that line alone.
 * - On a client navigation here it takes the server's title and moves focus
 *   to the heading, as the board pages do; never out of a wide-screen find
 *   box. A document load takes no focus, as the server's page never did.
 */
export function SitesPage() {
  const query = useQuery(sitesQuery());
  const heading = useRef<HTMLHeadingElement>(null);

  // By timestamps rather than isError, and the reason kept across a retry's
  // gap, exactly as BoardPage does.
  const latestFailed = query.errorUpdatedAt > query.dataUpdatedAt;
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    if (query.error) lastReason.current = query.error.message;
  }, [query.error]);
  const reason = query.error?.message ?? lastReason.current;
  const alert = latestFailed && reason !== null ? failedLine(reason) : null;

  useLayoutEffect(() => {
    document.title = SITES_HEADING_TEXT;
  }, []);

  const nav = useClientNav();
  const arrivedInApp = nav !== null && !nav.documentLoad;

  // Once, when the heading first exists after an in-app arrival. A first read
  // that failed gives the move up: a list that turns up on a later poll is not
  // a navigation.
  const hasList = query.data !== undefined;
  const focused = useRef(!arrivedInApp);
  useEffect(() => {
    if (focused.current) return;
    if (!hasList) {
      if (latestFailed) focused.current = true;
      return;
    }
    focused.current = true;
    const active = document.activeElement;
    if (active?.id === "find" && !active.closest("dialog")) return;
    focusHeading(heading.current);
  }, [hasList, latestFailed]);

  // A move that stays on this page (the rail's sites heading, the wordmark)
  // does not remount it: focus goes to the heading again, as on the board,
  // which also keeps it off <body> when the drawer closes on such a move.
  const locationKey = nav?.locationKey;
  const shownKey = useRef(locationKey);
  useEffect(() => {
    if (locationKey === shownKey.current) return;
    shownKey.current = locationKey;
    focusHeading(heading.current);
  }, [locationKey]);

  const alertLine = alert ? (
    <div className="mb-6">
      <p role="alert" className={BOARD_ALERT}>
        {alert}
      </p>
    </div>
  ) : null;
  if (!query.data) return alertLine;
  return (
    <>
      {alertLine}
      <SiteList payload={query.data} headingRef={heading} />
    </>
  );
}
