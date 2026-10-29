import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ActivityPayload } from "../shared/activity";
import type { ApiError, ApiOk } from "../shared/board";
import type { ActivityUrlFilters } from "../views/activityPageModel";

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
  return { events: body.events, next: body.next, subjects: body.subjects, sources: body.sources, now: body.now };
}

/** How many events one page of /activity asks for. */
export const ACTIVITY_PAGE_SIZE = 50;

/** GET /api/activity for the page: filters plus a cursor; same error contract as fetchActivity. */
export async function fetchActivityPage(f: ActivityUrlFilters, before: string | null): Promise<ActivityPayload> {
  const p = new URLSearchParams({ limit: String(ACTIVITY_PAGE_SIZE) });
  if (f.subject) p.set("subject", f.subject);
  if (f.who) p.set("who", f.who);
  if (f.kind) p.set("kind", f.kind);
  if (before) p.set("before", before);
  const res = await fetch(`/api/activity?${p.toString()}`, { headers: { Accept: "application/json" } });
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
  return { events: body.events, next: body.next, subjects: body.subjects, sources: body.sources, now: body.now };
}

/** The page's infinite query: cursor-paged, polled like the overview's. */
export function activityPageQuery(f: ActivityUrlFilters) {
  return {
    queryKey: ["activity-page", f.subject, f.who, f.kind] as const,
    queryFn: ({ pageParam }: { pageParam: string | null }) => fetchActivityPage(f, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ActivityPayload): string | null => last.next,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
  };
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
