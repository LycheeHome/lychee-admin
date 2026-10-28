import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ApiError, ApiOk } from "../shared/board";
import type { HealthPayload } from "../shared/health";

/**
 * GET /api/health. Throws on any non-ok answer with the server's own
 * `reason`, or `HTTP <status>` when the body carries none (a proxy error
 * page, an unparsable body), exactly as fetchBoard does.
 */
export async function fetchHealth(): Promise<HealthPayload> {
  const res = await fetch("/api/health", { headers: { Accept: "application/json" } });
  let body: ApiOk<HealthPayload> | ApiError | null = null;
  try {
    body = (await res.json()) as ApiOk<HealthPayload> | ApiError;
  } catch {
    // Not JSON: fall through to the status.
  }
  if (!res.ok || !body || body.ok !== true) {
    const reason = body && body.ok === false && typeof body.reason === "string" ? body.reason : undefined;
    throw new Error(reason ?? `HTTP ${res.status}`);
  }
  return { sites: body.sites, units: body.units, generated: body.generated, now: body.now };
}

/**
 * The rail's poll: one batched read every 15s, paused while the tab is
 * hidden, and again whenever the window regains focus.
 */
export const HEALTH_QUERY = {
  queryKey: ["health"],
  queryFn: fetchHealth,
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;

export function useHealth(): UseQueryResult<HealthPayload> {
  return useQuery(HEALTH_QUERY);
}

/** `⌘K` on Apple platforms, `Ctrl K` everywhere else. */
export function findHintFor(platform: string): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘K" : "Ctrl K";
}

/** The rail's live props besides its rows: the health poll's reading, and the find box's printed shortcut. */
export interface RailHealth {
  health: HealthPayload | null;
  healthError: boolean;
  lastRead: string | null;
  findHint: string;
}

/** The health poll, read as the rail shows it (AppFrame hands it to Navigation). */
export function useRailHealth(): RailHealth {
  const query = useHealth();
  const lastRead = query.dataUpdatedAt > 0 ? new Date(query.dataUpdatedAt).toISOString() : null;
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  // "The latest poll errored", by timestamps rather than `isError`: TanStack
  // puts a data-less errored query back to pending while it refetches, which
  // would blink the unavailable line off for the length of every retry.
  const latestErrored = query.isError || query.errorUpdatedAt > query.dataUpdatedAt;
  return { health: query.data ?? null, healthError: latestErrored, lastRead, findHint: findHintFor(platform) };
}
