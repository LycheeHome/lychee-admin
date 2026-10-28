import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ActivityPayload } from "../shared/activity";
import type { ApiError, ApiOk } from "../shared/board";

/** How many events the overview's table shows. */
export const ACTIVITY_LIMIT = 8;

/**
 * GET /api/activity. Throws on any non-ok answer with the server's own
 * `reason`, or `HTTP <status>` when the body carries none, exactly as
 * fetchHealth does.
 */
export async function fetchActivity(limit: number = ACTIVITY_LIMIT): Promise<ActivityPayload> {
  const res = await fetch(`/api/activity?limit=${limit}`, { headers: { Accept: "application/json" } });
  let body: ApiOk<ActivityPayload> | ApiError | null = null;
  try {
    body = (await res.json()) as ApiOk<ActivityPayload> | ApiError;
  } catch {
    // Not JSON: fall through to the status.
  }
  if (!res.ok || !body || body.ok !== true) {
    const reason = body && body.ok === false && typeof body.reason === "string" ? body.reason : undefined;
    throw new Error(reason ?? `HTTP ${res.status}`);
  }
  return { events: body.events, sources: body.sources, now: body.now };
}

/**
 * The overview's activity poll: every 15s while the tab is visible and again
 * on focus. The 2s `staleTime` is only so a route loader's read is not
 * fetched again on mount.
 */
export const ACTIVITY_QUERY = {
  queryKey: ["activity", ACTIVITY_LIMIT],
  queryFn: () => fetchActivity(ACTIVITY_LIMIT),
  refetchInterval: 15_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: 2_000,
} as const;

export function useActivity(): UseQueryResult<ActivityPayload> {
  return useQuery(ACTIVITY_QUERY);
}
