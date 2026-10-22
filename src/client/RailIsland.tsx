import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { RailData } from "../views/shell";
import { Navigation } from "./components/Rail";
import { useHealth } from "./health";

/** `⌘K` on Apple platforms, `Ctrl K` everywhere else. */
export function findHintFor(platform: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
}

/**
 * The rail, live: the server's rail data, re-rendered with the health poll.
 * Before the first answer it renders exactly what the server did (hollow
 * dots, empty counts), so taking over shifts nothing.
 */
export function RailIsland({
  rail,
  findInitial,
  topBar = null,
}: {
  rail: RailData;
  /** What the server's find box held, so text typed before the bundle loaded survives the takeover. */
  findInitial?: { query: string; focused: boolean };
  /** The server's narrow-screen top bar, taken over with the rail; null where there is none. */
  topBar?: Element | null;
}) {
  const query = useHealth();
  const lastRead = query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toISOString() : null;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  // "The latest poll errored", by timestamps rather than `isError`: TanStack
  // puts a data-less errored query back to pending while it refetches, which
  // would blink the unavailable line off for the length of every retry.
  const latestErrored = query.isError || query.errorUpdatedAt > query.dataUpdatedAt;
  return (
    <Navigation
      rail={rail}
      health={query.data ?? null}
      healthError={latestErrored}
      lastRead={lastRead}
      findHint={findHintFor(platform)}
      findInitial={findInitial}
      topBar={topBar}
    />
  );
}

interface ServerRail {
  aside: HTMLElement;
  rail: RailData;
  findInitial?: { query: string; focused: boolean };
  topBar: Element | null;
  /** The server's own children of the aside, removed once React's are in beside them. */
  serverNodes: ChildNode[];
}

/**
 * The server's `<aside id="rail">` and the rail data beside it
 * (`#rail-data`), read once. Null, leaving the server rail as plain links,
 * when either is missing or the data is unreadable.
 */
function readServerRail(doc: Document): ServerRail | null {
  const aside = doc.getElementById("rail");
  const script = doc.getElementById("rail-data");
  if (!aside || !script) return null;
  let rail: RailData;
  try {
    rail = JSON.parse(script.textContent ?? "") as RailData;
  } catch {
    return null;
  }
  // React's input replaces the server's: carry across what the operator
  // already typed into it, and whether they were still typing.
  const serverFind = aside.querySelector<HTMLInputElement>("#find");
  const findInitial = serverFind ? { query: serverFind.value, focused: doc.activeElement === serverFind } : undefined;
  return { aside, rail, findInitial, topBar: doc.getElementById("top-bar"), serverNodes: Array.from(aside.childNodes) };
}

/**
 * The rail, rendered from the app's one root into the server's aside through
 * a portal, so router links in it share the page's router. The aside keeps
 * its own id, attributes and classes; its server children are captured before
 * React's go in beside them and removed in the same commit, so the rail never
 * shows twice and there is only ever one `#find`. The narrow-screen
 * `<header id="top-bar">` is taken over by Navigation, the same way.
 */
export function RailPortal({ doc = document }: { doc?: Document }) {
  const [server] = useState(() => readServerRail(doc));
  useLayoutEffect(() => {
    for (const node of server?.serverNodes ?? []) node.parentNode?.removeChild(node);
  }, [server]);
  if (!server) return null;
  return createPortal(
    <RailIsland rail={server.rail} findInitial={server.findInitial} topBar={server.topBar} />,
    server.aside,
  );
}
