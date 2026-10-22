import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { RailData } from "../views/shell";
import { Rail } from "./components/Rail";
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
export function RailIsland({ rail }: { rail: RailData }) {
  const query = useHealth();
  const lastRead = query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toISOString() : null;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  // "The latest poll errored", by timestamps rather than `isError`: TanStack
  // puts a data-less errored query back to pending while it refetches, which
  // would blink the unavailable line off for the length of every retry.
  const latestErrored = query.isError || query.errorUpdatedAt > query.dataUpdatedAt;
  return (
    <Rail
      rail={rail}
      health={query.data ?? null}
      healthError={latestErrored}
      lastRead={lastRead}
      findHint={findHintFor(platform)}
    />
  );
}

/**
 * Takes over the server's `<aside id="rail">`: reads the rail data the
 * server put beside it (`#rail-data`) and renders the island into the aside,
 * which keeps its own id, attributes and classes. Returns null, leaving the
 * server rail as plain links, when either is missing or the data is unreadable.
 */
export function mountRailIsland(client: QueryClient, doc: Document = document): Root | null {
  const aside = doc.getElementById("rail");
  const script = doc.getElementById("rail-data");
  if (!aside || !script) return null;
  let rail: RailData;
  try {
    rail = JSON.parse(script.textContent ?? "") as RailData;
  } catch {
    return null;
  }
  const root = createRoot(aside);
  root.render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <RailIsland rail={rail} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return root;
}
