import { StrictMode, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createBrowserRouter, Outlet, ScrollRestoration, useLocation, useNavigate, type DataRouter, type RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { BOARD_ROUTES, ClientNavContext, type ClientNav } from "./clientNav";
import { RailPortal } from "./RailIsland";
import { BoardPage, boardQuery } from "./pages/BoardPage";

export { BOARD_ROUTES, isClientRoute } from "./clientNav";

/*
 * The client's one React root and its router. Every page mounts it on the
 * empty `#react-root` the shell emits; it renders the rail into the server's
 * aside through a portal on every page, and the page content into
 * `#app-root` where the server put one, which it does only on the three board
 * pages. On any other URL the `*` route renders nothing and the rail's links
 * stay plain anchors, so the server page beneath is never replaced.
 */

const Nothing = () => null;

/** The layout every route shares: the rail, the page, and scroll restoration for back and forward. */
function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [appRoot] = useState(() => document.getElementById("app-root"));
  // Once the router has moved, it is never the document's first location
  // again, even back on that entry: from then on the router owns scrolling.
  const [firstKey] = useState(location.key);
  const [moved, setMoved] = useState(false);
  if (!moved && location.key !== firstKey) setMoved(true);
  const documentLoad = !moved && location.key === firstKey;
  const nav = useMemo<ClientNav>(
    () => ({ pathname: location.pathname, navigate: (href) => void navigate(href), documentLoad }),
    [location.pathname, navigate, documentLoad],
  );
  return (
    <ClientNavContext.Provider value={nav}>
      <RailPortal />
      {appRoot ? createPortal(<Outlet />, appRoot) : null}
      <ScrollRestoration />
    </ClientNavContext.Provider>
  );
}

/**
 * The routes: one layout, the three board pages and a catch-all. Each board
 * route's loader primes its group's board, so a move between pages shows the
 * cached board at once (then refreshes it), and the rows exist by the time the
 * router scrolls to a `#service-` hash. A failed read is not the loader's to
 * report: the page shows it, above the last good board or alone.
 */
export function appRoutes(client: QueryClient): RouteObject[] {
  return [
    {
      Component: AppLayout,
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
        { path: "*", Component: Nothing },
      ],
    },
  ];
}

export function createAppRouter(client: QueryClient): DataRouter {
  return createBrowserRouter(appRoutes(client));
}

/**
 * Mounts the one root on `#react-root`. Null, mounting nothing, where the
 * shell has no mount point. `unmount` also disposes the router, which listens
 * to the window's history.
 */
export function mountApp(client: QueryClient, doc: Document = document): { router: DataRouter; unmount: () => void } | null {
  const el = doc.getElementById("react-root");
  if (!el) return null;
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
