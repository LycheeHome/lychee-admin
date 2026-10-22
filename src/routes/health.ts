import { Router } from "express";
import { config } from "../config";
import * as caddyfile from "../lib/caddyfile";
import { isManagedHostname } from "../lib/siteValidation";
import type { Deps } from "../deps";
import type { ApiError, ApiOk } from "../shared/board";
import type { HealthPayload } from "../shared/health";
import { buildHealth } from "../views/railModel";
import { loadBoardPage } from "./services";
import { computeStatuses } from "./sites";

/**
 * GET /api/health: one batched read of every site's and unit's health, for the
 * navigation rail's poll. It reuses computeStatuses and loadBoardPage, the
 * reads the sites list and the boards make, so the rail cannot disagree with
 * them. It never refreshes the lychee-resources clone: it runs every 15s.
 */
export function createHealthRouter(deps: Deps): Router {
  const router = Router();

  router.get("/api/health", async (_req, res) => {
    try {
      const sites = caddyfile
        .parseSites(deps.fs.readFile(config.caddyfilePath))
        .filter((site) => isManagedHostname(site.hostname, config.domain));
      const [statuses, page] = await Promise.all([computeStatuses(sites, deps), loadBoardPage(deps)]);
      const health = buildHealth(sites, statuses, page.board, config.domain, new Date());
      return res.json({ ok: true, ...health } satisfies ApiOk<HealthPayload>);
    } catch (error) {
      return res.status(500).json({ ok: false, reason: `Could not read health: ${String(error)}` } satisfies ApiError);
    }
  });

  return router;
}
