import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useClientNav } from "../clientNav";
import { fetchSiteDetail, siteDetailQueryKey, type SiteDetailResult } from "../api";
import { BOARD_ALERT } from "../components/BoardRows";
import { CaddyfileError, SiteDetail, SiteNotFound } from "../components/SiteDetail";
import { useSiteWriteInFlight, useSiteWrites } from "../siteWrites";

/** The page's re-read: the rail's own cadence. */
export const SITE_DETAIL_POLL_MS = 15_000;
/** While a requested tag has not yet applied, so the installed state turns up within seconds of the reconciler's run. */
export const SITE_DETAIL_FAST_MS = 3_000;

/** What would stop the page re-reading: one of its own writes in flight, or the remove dialog open. */
export type SiteDetailPause = { writing: boolean; dialogOpen: boolean };

/**
 * The page's polling interval (ruling R2): none while a write of the page's
 * is in flight (each success triggers its own re-read) or while the remove
 * dialog is open (the dialog's steps describe the page as it was opened);
 * 3s while the payload carries a requested tag; 15s otherwise.
 */
export function siteDetailInterval(data: SiteDetailResult | undefined, pause: SiteDetailPause): number | false {
  if (pause.writing || pause.dialogOpen) return false;
  const payload = data?.found ? data.payload : null;
  return payload && payload.caddyfileError === null && payload.resource?.requestedTag
    ? SITE_DETAIL_FAST_MS
    : SITE_DETAIL_POLL_MS;
}

/**
 * One site page's query: the route loader primes it (with `?refresh=1`) and
 * the page observes it (without). `staleTime` is the board's, so the page
 * does not mount on the loader's fresh answer and fetch it again at once.
 */
export function siteDetailQuery(hostname: string, pause: SiteDetailPause = { writing: false, dialogOpen: false }) {
  return queryOptions({
    queryKey: siteDetailQueryKey(hostname),
    queryFn: () => fetchSiteDetail(hostname, false),
    refetchInterval: (query) => siteDetailInterval(query.state.data, pause),
    refetchIntervalInBackground: false,
    // A focus or reconnect re-read ignores refetchInterval, so the pause has to reach both.
    refetchOnWindowFocus: !(pause.writing || pause.dialogOpen),
    refetchOnReconnect: !(pause.writing || pause.dialogOpen),
    staleTime: 2_000,
  });
}

const NOT_FOUND_TITLE = "Site not found";

/** Focus for an in-app arrival: focusable at runtime only, so the markup at rest stays the server's. */
function focusHeading(heading: HTMLHeadingElement | null): void {
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

/**
 * The route's element: the hostname from the URL, lowercased as the server
 * matches it, and the page keyed by it. A move from one site to another
 * therefore mounts a fresh page: its title, its heading focus, its writes'
 * state and its remove dialog (whose settled lock lives per instance) are
 * that site's own.
 */
export function SiteDetailRoute() {
  const hostname = (useParams().hostname ?? "").toLowerCase();
  return <SiteDetailPage key={hostname} hostname={hostname} />;
}

/**
 * The site page at `/sites/:hostname`.
 *
 * - A failed re-read keeps the last good page and says so above it, until the
 *   next good read. A failed first read shows that line alone.
 * - A read answering 404 (the site was removed elsewhere) is the not-found
 *   body, titled as the server titles it.
 * - On a client navigation here it takes the hostname as its title and moves
 *   focus to the hostname heading, as the list and board pages do; never out
 *   of a wide-screen find box. A document load takes no focus.
 */
export function SiteDetailPage({ hostname }: { hostname: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const writing = useSiteWriteInFlight(hostname);
  const query = useQuery(siteDetailQuery(hostname, { writing, dialogOpen }));
  const heading = useRef<HTMLHeadingElement>(null);
  // Stable for the page's life: the writes read it when they settle.
  const cardHeading = useRef<HTMLHeadingElement>(null);
  const writes = useSiteWrites(hostname, cardHeading);

  // By timestamps rather than isError, and the reason kept across a retry's
  // gap, exactly as SitesPage does.
  const latestFailed = query.errorUpdatedAt > query.dataUpdatedAt;
  const lastReason = useRef<string | null>(null);
  useEffect(() => {
    if (query.error) lastReason.current = query.error.message;
  }, [query.error]);
  const reason = query.error?.message ?? lastReason.current;
  const alert = latestFailed && reason !== null ? `Couldn't refresh ${hostname}: ${reason}` : null;

  const data = query.data;
  const notFound = data?.found === false;
  useLayoutEffect(() => {
    document.title = notFound ? NOT_FOUND_TITLE : hostname;
  }, [notFound, hostname]);

  const nav = useClientNav();
  const arrivedInApp = nav !== null && !nav.documentLoad;

  // Once, when the hostname heading first exists after an in-app arrival. A
  // first read that failed, or found no site to head, gives the move up.
  const hasPage = data?.found === true && data.payload.caddyfileError === null;
  const settled = data !== undefined || latestFailed;
  // The dialog goes with the page body: a body that has none cannot hold the
  // re-reads off.
  useEffect(() => {
    if (!hasPage) setDialogOpen(false);
  }, [hasPage]);

  const focused = useRef(!arrivedInApp);
  useEffect(() => {
    if (focused.current || !settled) return;
    focused.current = true;
    if (!hasPage) return;
    const active = document.activeElement;
    if (active?.id === "find" && !active.closest("dialog")) return;
    focusHeading(heading.current);
  }, [hasPage, settled]);

  // A move that stays on this site's page (its rail row, a hash) does not
  // remount it: focus goes to the heading again, as on the list.
  const locationKey = nav?.locationKey;
  const shownKey = useRef(locationKey);
  useEffect(() => {
    if (locationKey === shownKey.current) return;
    shownKey.current = locationKey;
    focusHeading(heading.current);
  }, [locationKey]);

  // A direct child of <main>'s column (the mount point is `contents`), as on the list.
  const alertLine = alert ? (
    <p role="alert" className={BOARD_ALERT}>
      {alert}
    </p>
  ) : null;
  if (!data) return alertLine;
  let body;
  if (!data.found) body = <SiteNotFound hostname={hostname} />;
  else if (data.payload.caddyfileError !== null) body = <CaddyfileError message={data.payload.caddyfileError} />;
  else
    body = (
      <SiteDetail
        payload={data.payload}
        headingRef={heading}
        writes={writes}
        cardHeadingRef={cardHeading}
        onRemoveDialogChange={setDialogOpen}
      />
    );
  return (
    <>
      {alertLine}
      {body}
    </>
  );
}
