import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  createBrowserRouter,
  Outlet,
  ScrollRestoration,
  useLocation,
  useNavigate,
  type DataRouter,
  type Location,
  type RouteObject,
} from "react-router";
import { RouterProvider } from "react-router/dom";
import { ADD_SITE_ROUTE, BOARD_ROUTES, ClientNavContext, OVERVIEW_ROUTE, SITE_ROUTE, SITES_ROUTE, isClientRoute, type ClientNav } from "./clientNav";
import { AppFrame, readInitialNotice, type InitialNotice } from "./AppFrame";
import { ACTIVITY_QUERY } from "./activity";
import { addSiteQueryKey, fetchAddSite, fetchSiteDetail, siteDetailQueryKey } from "./api";
import { HEALTH_QUERY } from "./health";
import { AddSitePage } from "./pages/AddSitePage";
import { BoardPage, boardQuery } from "./pages/BoardPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SiteDetailRoute } from "./pages/SiteDetailPage";
import { SitesPage, sitesQuery } from "./pages/SitesPage";
import { installSharedBindings } from "./sharedBindings";

export { BOARD_ROUTES, isClientRoute } from "./clientNav";

/*
 * The client's one React root and its router. Every client route is served
 * the same static document, whose body is only `#react-root`; the root
 * renders AppFrame into it (the top bar, the rail, and <main> with the toast
 * host, the copy-status region and the page notice) around the routed page:
 * the overview, the sites list, the three board pages, the add page and a
 * site's page. On
 * any other URL the route renders nothing inside the frame and the rail's
 * links stay plain anchors.
 */

const Nothing = () => null;

/** The layout every route shares: the frame around the page, and scroll restoration for back and forward. */
function AppLayout({ scrollKey, notice }: { scrollKey: (location: Location) => string; notice: InitialNotice }) {
  const location = useLocation();
  const navigate = useNavigate();
  // Once the router has moved, it is never the document's first location
  // again, even back on that entry: from then on the router owns scrolling.
  const [firstKey] = useState(location.key);
  const [moved, setMoved] = useState(false);
  if (!moved && location.key !== firstKey) setMoved(true);
  const documentLoad = !moved && location.key === firstKey;
  const nav = useMemo<ClientNav>(
    () => ({ pathname: location.pathname, locationKey: location.key, navigate: (href) => void navigate(href), documentLoad }),
    [location.pathname, location.key, navigate, documentLoad],
  );
  return (
    <ClientNavContext.Provider value={nav}>
      <AppFrame notice={notice}>
        <Outlet />
      </AppFrame>
      {isClientRoute(location.pathname) ? <ScrollRestoration getKey={scrollKey} /> : null}
    </ClientNavContext.Provider>
  );
}

/*
 * Scroll restoration is for the entries the router pushes between client
 * routes, and nothing else.
 *
 * - On a URL no route matches it is not rendered at all: rendered, it would switch the
 *   browser's own per-entry restoration off (`history.scrollRestoration =
 *   "manual"`) and save every unload under one shared key.
 * - Every entry the router did not push (a fresh document load, a reload of
 *   one) carries the key "default" (react-router 8.4.0, history.js), so the
 *   default key would hand each fresh load whatever position the last
 *   "default" page unloaded at. `getKey` gives that entry a key of this
 *   document's own instead: a fresh load finds nothing saved and starts at the
 *   top (or at its #hash row), while back to it within this document still
 *   restores. Router-pushed entries keep their own unique keys.
 */
function documentScrollKey(): (location: Location) => string {
  const documentEntry = `document-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  return (location) => (location.key === "default" ? documentEntry : location.key);
}

/**
 * The routes: one layout, the three board pages, the overview, the sites list, a site's
 * page, the add page, and a catch-all rendering nothing. Each board
 * route's loader primes its group's board, so a move between pages shows the
 * cached board at once (then refreshes it), and the rows exist by the time the
 * router scrolls to a `#service-` hash. A failed read is not the loader's to
 * report: the page shows it, above the last good board or alone.
 *
 * `notice` is what the document load's URL asked for (readInitialNotice),
 * read before stripNoticeParams dropped it; AppFrame shows it.
 */
export function appRoutes(client: QueryClient, notice: InitialNotice = null): RouteObject[] {
  return [
    {
      // One scroll key per router, which is one per document.
      element: <AppLayout scrollKey={documentScrollKey()} notice={notice} />,
      children: [
        ...Object.entries(BOARD_ROUTES).map(([path, group]): RouteObject => ({
          path,
          loader: async () => {
            const { queryKey, queryFn } = boardQuery(group);
            await client.ensureQueryData({ queryKey, queryFn }).catch(() => undefined);
            return null;
          },
          // While the first document's loader runs: the layout (the rail)
          // renders at once, the page when its board is in.
          HydrateFallback: Nothing,
          // Keyed by group, so each page mounts afresh: its title, its
          // heading focus and its host-action state are its own.
          element: <BoardPage key={group} group={group} />,
        })),
        {
          path: OVERVIEW_ROUTE,
          // Both of the overview's reads, primed together. Each failure is
          // the page's to show, and one never holds the other back.
          loader: async () => {
            await Promise.all([
              client.ensureQueryData(HEALTH_QUERY).catch(() => undefined),
              client.ensureQueryData(ACTIVITY_QUERY).catch(() => undefined),
            ]);
            return null;
          },
          HydrateFallback: Nothing,
          element: <OverviewPage />,
        },
        {
          path: SITES_ROUTE,
          // The board's loader, for the list: cached data shows at once on a
          // move back here, then refreshes.
          loader: async () => {
            const { queryKey, queryFn } = sitesQuery();
            await client.ensureQueryData({ queryKey, queryFn }).catch(() => undefined);
            return null;
          },
          HydrateFallback: Nothing,
          element: <SitesPage />,
        },
        {
          // Matched here, before the site route, so "new" is never captured
          // as a hostname. Every arrival reads with ?refresh=1, which pulls
          // the lychee-resources clone first, so the port claims the page's
          // preview and submit check are as fresh as the arrival. Always
          // fetched, never taken from cache; a failure is the page's to show.
          path: ADD_SITE_ROUTE,
          loader: async () => {
            await client
              .fetchQuery({ queryKey: addSiteQueryKey(), queryFn: () => fetchAddSite(true) })
              .catch(() => undefined);
            return null;
          },
          HydrateFallback: Nothing,
          element: <AddSitePage />,
        },
        {
          path: SITE_ROUTE,
          // Every arrival, a document load included, reads with ?refresh=1,
          // which pulls the lychee-resources clone first (a Next.js site's
          // declaration may have changed on GitHub). Always fetched, never
          // taken from cache; a failure is the page's to show.
          loader: async ({ params }) => {
            const hostname = (params.hostname ?? "").toLowerCase();
            await client
              .fetchQuery({ queryKey: siteDetailQueryKey(hostname), queryFn: () => fetchSiteDetail(hostname, true) })
              .catch(() => undefined);
            return null;
          },
          HydrateFallback: Nothing,
          element: <SiteDetailRoute />,
        },
        { path: "*", Component: Nothing },
      ],
    },
  ];
}

export function createAppRouter(client: QueryClient, notice: InitialNotice = null): DataRouter {
  return createBrowserRouter(appRoutes(client, notice));
}

/** The parameters that ask for a #page-notice. */
const NOTICE_PARAMS = ["removed", "created"];

/**
 * Drops `removed` and `created` from the URL, so a reload does not repeat the
 * notice they asked for. Every other parameter is kept as
 * written, and so are the hash and the history entry's state (the router's
 * key, on a back to this entry).
 */
export function stripNoticeParams(win: Window): void {
  const { pathname, search, hash } = win.location;
  const isNotice = (params: URLSearchParams) => NOTICE_PARAMS.some((name) => params.has(name));
  if (!isNotice(new URLSearchParams(search))) return;
  const kept = search
    .slice(1)
    .split("&")
    .filter((part) => part !== "" && !isNotice(new URLSearchParams(part)));
  win.history.replaceState(win.history.state, "", `${pathname}${kept.length ? `?${kept.join("&")}` : ""}${hash}`);
}

/**
 * Mounts the one root on `#react-root`, the static document's only content.
 * Null, mounting nothing, where there is no mount point. `unmount` also
 * disposes the router, which listens to the window's history.
 */
export function mountApp(client: QueryClient, doc: Document = document): { router: DataRouter; unmount: () => void } | null {
  const el = doc.getElementById("react-root");
  if (!el) return null;
  const win = doc.defaultView ?? window;
  // The notice first, off the URL as it arrived; then the URL is cleaned,
  // before the router reads it, so the router starts on the clean one.
  const notice = readInitialNotice(win);
  stripNoticeParams(win);
  const uninstallBindings = installSharedBindings(doc);
  const router = createAppRouter(client, notice);
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return {
    router,
    unmount: () => {
      root.unmount();
      router.dispose();
      uninstallBindings();
    },
  };
}
