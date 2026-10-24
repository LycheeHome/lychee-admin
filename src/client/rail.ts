import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { RailPayload } from "../shared/rail";
import { RAIL_QUERY_KEY, fetchRail } from "./api";

/**
 * The rail's rows, read once per document load: they change only when a site
 * is added or removed, and every in-app write invalidates them (mutations.ts's
 * refresh). `staleTime: Infinity` keeps moves and focus from re-reading data
 * the frame already has; a read that failed has no data, which TanStack
 * always counts as stale, so the next focus reads it again (RF1). A failure
 * is never thrown to the page: the rail simply keeps its fixed parts.
 */
export function railQuery() {
  return {
    queryKey: RAIL_QUERY_KEY,
    queryFn: fetchRail,
    staleTime: Infinity,
    refetchOnWindowFocus: true,
  } as const;
}

export function useRail(): UseQueryResult<RailPayload> {
  return useQuery(railQuery());
}
