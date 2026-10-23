import type { ApiError, ApiOk, BoardPayload, ServiceGroup } from "../shared/board";
import type { SitesPayload } from "../shared/sites";

/** The prefix every board query shares: a write invalidates by it, so no group's board is left stale. */
export const BOARD_QUERY_ROOT = ["board"] as const;

/** The one key a page reads its group's board under, so the writes invalidate exactly what pages read. */
export function boardQueryKey(group: ServiceGroup) {
  return [...BOARD_QUERY_ROOT, group] as const;
}

/** The one key the sites list is read under. */
export function sitesQueryKey() {
  return ["sites"] as const;
}

/**
 * A GET that answers `ApiOk<T>`. Throws on any non-ok answer with the
 * server's own `reason`, or `HTTP <status>` when the body carries none (a
 * proxy error page, an unparsable body).
 */
async function getApi<T>(url: string): Promise<ApiOk<T>> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  let body: ApiOk<T> | ApiError | null = null;
  try {
    body = (await res.json()) as ApiOk<T> | ApiError;
  } catch {
    // Not JSON: fall through to the status.
  }
  if (!res.ok || !body || body.ok !== true) {
    const reason = body && body.ok === false && typeof body.reason === "string" ? body.reason : undefined;
    throw new Error(reason ?? `HTTP ${res.status}`);
  }
  return body;
}

/** GET /api/services for one group. */
export async function fetchBoard(group: ServiceGroup): Promise<BoardPayload> {
  const body = await getApi<BoardPayload>(`/api/services?group=${encodeURIComponent(group)}`);
  return {
    board: body.board,
    boardEmpty: body.boardEmpty,
    now: body.now,
    prunable: body.prunable,
    managed: body.managed,
    domain: body.domain,
    requested: body.requested,
    lastRuns: body.lastRuns,
  };
}

/**
 * GET /api/sites. An unreadable Caddyfile is not a throw: the server answers
 * 200 with `caddyfileError` set, and the list shows it.
 */
export async function fetchSites(): Promise<SitesPayload> {
  const body = await getApi<SitesPayload>("/api/sites");
  return {
    sites: body.sites,
    statuses: body.statuses,
    problems: body.problems,
    domain: body.domain,
    caddyfileError: body.caddyfileError,
  };
}
