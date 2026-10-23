import { StrictMode, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
import { BOARD_ROUTES, ClientNavContext, SITES_ROUTE, isClientRoute, type ClientNav } from "./clientNav";
import { RailPortal } from "./RailIsland";
import { BoardPage, boardQuery } from "./pages/BoardPage";
import { SitesPage, sitesQuery } from "./pages/SitesPage";

export { BOARD_ROUTES, isClientRoute } from "./clientNav";

/*
 * The client's one React root and its router. Every page mounts it on the
 * empty `#react-root` the shell emits; it renders the rail into the server's
 * aside through a portal on every page, and the page content into
 * `#app-root` where the server put one, which it does only on the sites list
 * and the three board pages. On any other URL the `*` route renders nothing and the rail's links
 * stay plain anchors, so the server page beneath is never replaced.
 */

const Nothing = () => null;

/** The layout every route shares: the rail, the page, and scroll restoration for back and forward. */
function AppLayout({ scrollKey }: { scrollKey: (location: Location) => string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [appRoot] = useState(() => document.getElementById("app-root"));
  // Once the router has moved, it is never the document's first location
  // again, even back on that entry: from then on the router owns scrolling.
  const [firstKey] = useState(location.key);
  const [moved, setMoved] = useState(false);
  if (!moved && location.key !== firstKey) setMoved(true);
  const documentLoad = !moved && location.key === firstKey;
  // The server's `?removed` notice belongs to the document it was rendered
  // for: the first in-app move away from the list removes it, so neither the
  // next page nor a move back to the list shows it again. Only a move: a
  // server page's own notice (`?created=1`) is never touched, because nothing
  // moves in-app from a server page.
  useLayoutEffect(() => {
    if (moved && location.pathname !== SITES_ROUTE) document.getElementById("page-notice")?.remove();
  }, [moved, location.pathname]);
  const nav = useMemo<ClientNav>(
    () => ({ pathname: location.pathname, locationKey: location.key, navigate: (href) => void navigate(href), documentLoad }),
    [location.pathname, location.key, navigate, documentLoad],
  );
  return (
    <ClientNavContext.Provider value={nav}>
      <RailPortal />
      {appRoot ? createPortal(<Outlet />, appRoot) : null}
      {isClientRoute(location.pathname) ? <ScrollRestoration getKey={scrollKey} /> : null}
    </ClientNavContext.Provider>
  );
}

/*
 * Scroll restoration is for the entries the router pushes between client
 * routes, and nothing else.
 *
 * - On a server page it is not rendered at all: rendered, it would switch the
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
 * The routes: one layout, the three board pages, the sites list and a
 * catch-all. Each board
 * route's loader primes its group's board, so a move between pages shows the
 * cached board at once (then refreshes it), and the rows exist by the time the
 * router scrolls to a `#service-` hash. A failed read is not the loader's to
 * report: the page shows it, above the last good board or alone.
 */
export function appRoutes(client: QueryClient): RouteObject[] {
  return [
    {
      // One scroll key per router, which is one per document.
      element: <AppLayout scrollKey={documentScrollKey()} />,
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
        { path: "*", Component: Nothing },
      ],
    },
  ];
}

export function createAppRouter(client: QueryClient): DataRouter {
  return createBrowserRouter(appRoutes(client));
}

/**
 * Drops `removed` from the URL, so a reload does not repeat the notice the
 * server rendered for it. Every other parameter is kept as written, and so
 * are the hash and the history entry's state (the router's key, on a back to
 * this entry).
 */
export function stripRemovedParam(win: Window): void {
  const { pathname, search, hash } = win.location;
  if (!new URLSearchParams(search).has("removed")) return;
  const kept = search
    .slice(1)
    .split("&")
    .filter((part) => part !== "" && !new URLSearchParams(part).has("removed"));
  win.history.replaceState(win.history.state, "", `${pathname}${kept.length ? `?${kept.join("&")}` : ""}${hash}`);
}

/**
 * Mounts the one root on `#react-root`. Null, mounting nothing, where the
 * shell has no mount point. `unmount` also disposes the router, which listens
 * to the window's history.
 */
export function mountApp(client: QueryClient, doc: Document = document): { router: DataRouter; unmount: () => void } | null {
  const el = doc.getElementById("react-root");
  if (!el) return null;
  // Before the router reads the URL, so it starts on the clean one.
  stripRemovedParam(doc.defaultView ?? window);
  const router = createAppRouter(client);
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
    },
  };
}
