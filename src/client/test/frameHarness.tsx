import { useMemo, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { ClientNavContext, type ClientNav } from "../clientNav";
import { AppFrame, type InitialNotice } from "../AppFrame";

/*
 * AppFrame inside a router, as the app's layout route will render it: the
 * ClientNav context AppLayout provides (pathname, key, navigate, and whether
 * the router is still on the document's first location), then the frame
 * around the route's page. Shared by the frame's parity and behaviour tests
 * until the router mounts AppFrame itself.
 */
export function FrameLayout({ notice, children }: { notice: InitialNotice; children?: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
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
      <AppFrame notice={notice}>{children ?? <Outlet />}</AppFrame>
    </ClientNavContext.Provider>
  );
}
