import type { ApiError, ApiOk, BoardPayload, ServiceGroup } from "../shared/board";
import type { SitesPayload } from "../shared/sites";
import type { SiteDetailPayload } from "../shared/siteDetail";
import type { AddSitePayload } from "../shared/addSite";

/** The prefix every board query shares: a write invalidates by it, so no group's board is left stale. */
export const BOARD_QUERY_ROOT = ["board"] as const;

/** The one key a page reads its group's board under, so the writes invalidate exactly what pages read. */
export function boardQueryKey(group: ServiceGroup) {
  return [...BOARD_QUERY_ROOT, group] as const;
}

/** The prefix every site page's query shares: a write invalidates by it, so no site page is left stale. */
export const SITE_DETAIL_ROOT = ["site"] as const;

/** The one key a site's page is read under. */
export function siteDetailQueryKey(hostname: string) {
  return [...SITE_DETAIL_ROOT, hostname] as const;
}

/** The one key the sites list is read under. */
export function sitesQueryKey() {
  return ["sites"] as const;
}

/** The one key the add page's facts are read under. */
export function addSiteQueryKey() {
  return ["add-site"] as const;
}

/**
 * A GET that answers `ApiOk<T>`. Throws on any non-ok answer with the
 * server's own `reason`, or `HTTP <status>` when the body carries none (a
 * proxy error page, an unparsable body).
 */
async function getApi<T>(url: string): Promise<ApiOk<T>> {
  return readApi<T>(await fetch(url, { headers: { Accept: "application/json" } }));
}

/** getApi's reading of an answer already in hand. */
async function readApi<T>(res: Response): Promise<ApiOk<T>> {
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

/** What a site page's read found: the page's payload, or no such site. */
export type SiteDetailResult = { found: true; payload: SiteDetailPayload } | { found: false };

/**
 * GET /api/sites/:hostname. A `404` is `found: false`, never a throw: a site
 * removed elsewhere is a page (not found), not a failed read. `refresh` asks
 * the server to pull the lychee-resources clone first; only the route
 * loader's arrival read sends it, never a poll. An unreadable Caddyfile is
 * the payload's `caddyfileError`, as on the list.
 */
export async function fetchSiteDetail(hostname: string, refresh: boolean): Promise<SiteDetailResult> {
  const url = `/api/sites/${encodeURIComponent(hostname)}${refresh ? "?refresh=1" : ""}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return { found: false };
  const body = await readApi<SiteDetailPayload>(res);
  const payload = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "ok")) as SiteDetailPayload;
  return { found: true, payload };
}

/**
 * GET /api/sites/new: the facts the add page's form and preview need. An
 * unreadable Caddyfile is the payload's `caddyfileError`, never a throw.
 * `refresh` asks the server to pull the lychee-resources clone first, so the
 * port claims the page's preview and submit check are as fresh as the
 * arrival; only the route loader sends it.
 */
export async function fetchAddSite(refresh: boolean): Promise<AddSitePayload> {
  const body = await getApi<AddSitePayload>(`/api/sites/new${refresh ? "?refresh=1" : ""}`);
  return {
    domain: body.domain,
    portOwners: body.portOwners,
    paths: body.paths,
    steps: body.steps,
    caddyfileError: body.caddyfileError,
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
