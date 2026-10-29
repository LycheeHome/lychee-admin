import { Router } from "express";
import { config } from "../config";
import * as caddyfile from "../lib/caddyfile";
import { readAuditTail } from "../lib/auditLog";
import { readReconcilerEvents } from "../lib/reconcilerEvents";
import { readInventory } from "../lib/serviceInventory";
import { isManagedHostname } from "../lib/siteValidation";
import type { Deps } from "../deps";
import {
  ACTIVITY_KINDS,
  ACTIVITY_WHO,
  type ActivityFilters,
  type ActivityKind,
  type ActivityPayload,
  type ActivityWho,
} from "../shared/activity";
import type { ApiError, ApiOk } from "../shared/board";
import { ActivityCursorError, buildActivity, pageActivity } from "../views/activityModel";
import { unitHref } from "../views/railModel";
import { sendClientDocument } from "./clientDocument";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

/** `?limit=`: a positive integer up to 50; anything else is the default. */
export function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(n >= 1)) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

const one = (raw: unknown): string | null => (typeof raw === "string" && raw !== "" ? raw : null);

/**
 * The query of GET /api/activity. Empty strings count as absent; an unknown
 * `who` or `kind` is refused by name. The cursor is checked by `pageActivity`.
 */
export function parseActivityQuery(
  q: Record<string, unknown>,
):
  | { ok: true; filters: ActivityFilters; before: string | null; limit: number }
  | { ok: false; reason: string } {
  const who = one(q.who);
  if (who !== null && !(ACTIVITY_WHO as readonly string[]).includes(who)) {
    return { ok: false, reason: `Unknown who "${who}"; expected ${ACTIVITY_WHO.join(" or ")}` };
  }
  const kind = one(q.kind);
  if (kind !== null && !(ACTIVITY_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, reason: `Unknown kind "${kind}"; expected one of ${ACTIVITY_KINDS.join(", ")}` };
  }
  return {
    ok: true,
    filters: { subject: one(q.subject), who: who as ActivityWho | null, kind: kind as ActivityKind | null },
    before: one(q.before),
    limit: parseLimit(q.limit),
  };
}

/**
 * GET /api/activity: the audit log and the reconciler's history feed, merged
 * newest first. Always 200: a source that cannot be read is reported in
 * `sources`, never as a status. Nothing is cached; both reads are local files.
 */
export function createActivityRouter(deps: Deps): Router {
  const router = Router();

  // The page itself is the client's: the same document, always 200.
  router.get("/activity", (_req, res) => sendClientDocument(res, deps));

  router.get("/api/activity", (req, res) => {
    const query = parseActivityQuery(req.query);
    if (!query.ok) return res.status(400).json({ ok: false, reason: query.reason } satisfies ApiError);
    try {
      let sites: Set<string> | null;
      try {
        sites = new Set(
          caddyfile
            .parseSites(deps.fs.readFile(config.caddyfilePath))
            .filter((site) => isManagedHostname(site.hostname, config.domain))
            .map((site) => site.hostname),
        );
      } catch {
        sites = null;
      }
      const inventory = readInventory(deps.fs);
      const units = new Map<string, string>();
      if (inventory.available) for (const entry of inventory.entries) units.set(entry.name, unitHref(entry.name, entry.group));
      const audit = readAuditTail(deps.fs, Number.POSITIVE_INFINITY);
      const lifetimes = readReconcilerEvents(deps.fs);
      const all = buildActivity(audit, lifetimes, { domain: config.domain, sites, units }, Number.POSITIVE_INFINITY);
      const page = pageActivity(all, { ...query.filters, before: query.before, limit: query.limit });
      const payload: ActivityPayload = {
        events: page.events,
        next: page.next,
        subjects: page.subjects,
        sources: { app: audit !== null, reconciler: lifetimes !== null },
        now: new Date().toISOString(),
      };
      return res.json({ ok: true, ...payload } satisfies ApiOk<ActivityPayload>);
    } catch (error) {
      if (error instanceof ActivityCursorError) {
        return res.status(400).json({ ok: false, reason: `Bad cursor: ${error.message}` } satisfies ApiError);
      }
      return res.status(500).json({ ok: false, reason: `Could not read activity: ${String(error)}` } satisfies ApiError);
    }
  });

  return router;
}
