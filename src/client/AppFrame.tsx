import { memo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BUTTON_OFFER, DISMISS_BUTTON, FLASH_BANNER, SHELL_COLUMN, SHELL_MAIN } from "../views/shared";
import { addedNotice } from "../views/siteDetailModel";
import type { RailData } from "../views/shell";
import { fetchSiteDetail, siteDetailQueryKey } from "./api";
import { SITES_ROUTE, siteOf, useClientNav } from "./clientNav";
import { Navigation } from "./components/Rail";
import { PageNotice } from "./components/PageNotice";
import { useRail } from "./rail";
import { useRailHealth } from "./RailIsland";

/*
 * React's whole body: what layout() in src/views/shell.ts renders around a
 * page, element for element and class for class (AppFrameParity.test.tsx
 * pins it against the frozen shell): the narrow-screen top bar, the rail,
 * then the content column's <main> holding the toast host, the copy-status
 * region, the page notice and the routed page.
 *
 * It renders inside the router, beneath the layout route's ClientNav
 * context, so the rail's links are router links and its current item follows
 * the router's location.
 */

/** The notice a document load asked for, read off its URL once, before stripNoticeParams drops it. */
export type InitialNotice = { kind: "removed"; host: string } | { kind: "created" } | null;

/**
 * What the server drew a #page-notice for: `?removed=<host>` on the list
 * (`/`), `?created=1` on a site's page, each given exactly once, as Express
 * reads them (a repeated parameter is an array there, and no notice).
 */
export function readInitialNotice(win: Window): InitialNotice {
  const { pathname, search } = win.location;
  const params = new URLSearchParams(search);
  const removed = params.getAll("removed");
  if (pathname === SITES_ROUTE && removed.length === 1 && removed[0]) return { kind: "removed", host: removed[0] };
  const created = params.getAll("created");
  if (siteOf(pathname) !== null && created.length === 1 && created[0] === "1") return { kind: "created" };
  return null;
}

/**
 * The flash toast's host, as renderFlashBanner drew it: empty and hidden
 * until showToast() (toast.ts) fills it by id. Memoised with no props, so it
 * renders once and never again: toast.ts owns its classes and text from then
 * on, and a re-render of the frame (a rail re-read, a health poll) must
 * never write them back.
 */
const ToastHost = memo(function ToastHost() {
  return (
    <div id="flash-banner" className={`hidden ${FLASH_BANNER}`} role="status" aria-live="polite">
      <span className="flex items-center gap-2 min-w-0">
        <span
          id="flash-banner-progress"
          className="hidden shrink-0 h-1.5 w-1.5 rounded-full bg-stone-50 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        <span id="flash-banner-message" />
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <button type="button" id="flash-banner-action" className={`hidden ${BUTTON_OFFER}`} />
        <button type="button" id="flash-banner-close" className={`hidden ${DISMISS_BUTTON}`} aria-label="Dismiss">
          &times;
        </button>
      </span>
    </div>
  );
});

/**
 * Where a copy button's outcome is announced (sharedBindings.ts writes it):
 * the icon swap says nothing to a screen reader, and on plain HTTP the
 * outcome is always "press Ctrl+C". Memoised like the toast host, since
 * its text is written outside React.
 */
const CopyStatus = memo(function CopyStatus() {
  return <span id="copy-status" className="sr-only" role="status" aria-live="polite" />;
});

/** The notice's text: the removed sentence at once; the created one once that site's page payload is in. */
function useNoticeMessage(notice: InitialNotice, firstPath: string | null): string | null {
  const createdHost = notice?.kind === "created" && firstPath ? siteOf(firstPath) : null;
  // Reads the site page's own query from the cache, never fetching it: the
  // page reads it, and the notice waits for that read.
  const site = useQuery({
    queryKey: siteDetailQueryKey(createdHost ?? ""),
    queryFn: () => fetchSiteDetail(createdHost ?? "", false),
    enabled: false,
  });
  if (!notice) return null;
  if (notice.kind === "removed") return `Removed ${notice.host}. Remember to remove the DNS record in Cloudflare manually.`;
  const data = site.data;
  return createdHost && data?.found && data.payload.caddyfileError === null ? addedNotice(data.payload.site) : null;
}

export function AppFrame({ notice, children }: { notice: InitialNotice; children: ReactNode }) {
  const railQuery = useRail();
  const live = useRailHealth();
  const pathname = useClientNav()?.pathname ?? null;

  // The notice belongs to the document it was asked for: the first in-app
  // move to another path removes it for good, as its close does. A move that
  // stays on the path (a hash) keeps it.
  const [firstPath] = useState(pathname);
  const [dismissed, setDismissed] = useState(false);
  if (!dismissed && notice !== null && pathname !== firstPath) setDismissed(true);
  const message = useNoticeMessage(dismissed ? null : notice, firstPath);

  // Until /api/rail answers, and after a failed read, the rail shows its
  // fixed parts: an empty list (no rows, and no Caddyfile line) and the host
  // links with their count slots. The current item is the router's.
  const data = railQuery.data;
  const rail: RailData = {
    sites: data ? data.sites : [],
    hostAvailable: data ? data.hostAvailable : true,
    current: null,
    domain: data?.domain ?? "",
  };

  return (
    <>
      <Navigation owned topBar={null} rail={rail} {...live} />
      <div className={SHELL_COLUMN}>
        <main className={SHELL_MAIN}>
          <ToastHost />
          <CopyStatus />
          {message !== null ? <PageNotice message={message} onClose={() => setDismissed(true)} /> : null}
          {children}
        </main>
      </div>
    </>
  );
}
