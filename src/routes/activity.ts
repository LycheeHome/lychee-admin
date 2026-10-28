import { Router } from "express";
import { config } from "../config";
import * as caddyfile from "../lib/caddyfile";
import { readAuditTail } from "../lib/auditLog";
import { readReconcilerEvents } from "../lib/reconcilerEvents";
import { readInventory } from "../lib/serviceInventory";
import { isManagedHostname } from "../lib/siteValidation";
import type { Deps } from "../deps";
import type { ActivityPayload } from "../shared/activity";
import type { ApiError, ApiOk } from "../shared/board";
import { buildActivity } from "../views/activityModel";
import { unitHref } from "../views/railModel";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;
/** Lines read from the audit log: dropped actions (no event) sit among the ones that show. */
const AUDIT_LINES = 200;

/** `?limit=`: a positive integer up to 50; anything else is the default. */
export function parseLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  if (!(n >= 1)) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * GET /api/activity: the audit log and the reconciler's history feed, merged
 * newest first. Always 200: a source that cannot be read is reported in
 * `sources`, never as a status. Nothing is cached; both reads are local files.
 */
export function createActivityRouter(deps: Deps): Router {
  const router = Router();

  router.get("/api/activity", (req, res) => {
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
      const audit = readAuditTail(deps.fs, AUDIT_LINES);
      const lifetimes = readReconcilerEvents(deps.fs);
      const events = buildActivity(audit, lifetimes, { domain: config.domain, sites, units }, parseLimit(req.query.limit));
      const payload: ActivityPayload = {
        events,
        sources: { app: audit !== null, reconciler: lifetimes !== null },
        now: new Date().toISOString(),
      };
      return res.json({ ok: true, ...payload } satisfies ApiOk<ActivityPayload>);
    } catch (error) {
      return res.status(500).json({ ok: false, reason: `Could not read activity: ${String(error)}` } satisfies ApiError);
    }
  });

  return router;
}
