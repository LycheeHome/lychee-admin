import type { ApiError, ApiOk, BoardPayload, ServiceGroup } from "../shared/board";

/**
 * GET /api/services for one group. Throws on any non-ok answer with the
 * server's own `reason`, or `HTTP <status>` when the body carries none (a
 * proxy error page, an unparsable body).
 */
export async function fetchBoard(group: ServiceGroup): Promise<BoardPayload> {
  const res = await fetch(`/api/services?group=${encodeURIComponent(group)}`, {
    headers: { Accept: "application/json" },
  });
  let body: ApiOk<BoardPayload> | ApiError | null = null;
  try {
    body = (await res.json()) as ApiOk<BoardPayload> | ApiError;
  } catch {
    // Not JSON: fall through to the status.
  }
  if (!res.ok || !body || body.ok !== true) {
    const reason = body && body.ok === false && typeof body.reason === "string" ? body.reason : undefined;
    throw new Error(reason ?? `HTTP ${res.status}`);
  }
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
