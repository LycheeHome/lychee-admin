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
  return { sites: body.sites, units: body.units, now: body.now };
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
