import { Router } from "express";
import { config } from "../config";
import * as caddyfile from "../lib/caddyfile";
import { toRowStatus, type ContainerStatus } from "../lib/containerStatus";
import { isManagedHostname } from "../lib/siteValidation";
import type { Deps } from "../deps";
import type { ApiError, ApiOk } from "../shared/board";
import type { HealthPayload } from "../shared/health";
import { buildHealth } from "../views/railModel";
import { loadBoardPage } from "./services";
import { cachedStatuses } from "./sites";

/**
 * GET /api/health: one batched read of every site's and unit's health, for the
 * navigation rail's poll. It reuses cachedStatuses and loadBoardPage, the
 * reads the sites list and the boards make, so the rail cannot disagree with
 * them. It never refreshes the lychee-resources clone: it runs every 15s.
 */
/**
 * Deps whose container reads share one wrapper call per compose project for
 * the length of a request. A site's page-status read (checkResourceContainerStatus)
 * and the board's row read (readResourceStatus) are the same sudo wrapper, and
 * the poll runs both; concurrent callers share the in-flight promise.
 */
function withSharedContainerReads(deps: Deps): Deps {
  const reads = new Map<string, Promise<ContainerStatus>>();
  const check = (project: string): Promise<ContainerStatus> => {
    let read = reads.get(project);
    if (!read) {
      read = deps.commands.checkResourceContainerStatus(project);
      reads.set(project, read);
    }
    return read;
  };
  return {
    ...deps,
    commands: {
      ...deps.commands,
      checkResourceContainerStatus: check,
      readResourceStatus: async (project) => toRowStatus(await check(project)),
    },
  };
}

export function createHealthRouter(deps: Deps): Router {
  const router = Router();

  router.get("/api/health", async (_req, res) => {
    try {
      const sites = caddyfile
        .parseSites(deps.fs.readFile(config.caddyfilePath))
        .filter((site) => isManagedHostname(site.hostname, config.domain));
      const shared = withSharedContainerReads(deps);
      const [statuses, page] = await Promise.all([cachedStatuses(sites, shared), loadBoardPage(shared)]);
      const health = buildHealth(sites, statuses, page.board, config.domain, new Date());
      return res.json({ ok: true, ...health } satisfies ApiOk<HealthPayload>);
    } catch (error) {
      return res.status(500).json({ ok: false, reason: `Could not read health: ${String(error)}` } satisfies ApiError);
    }
  });

  return router;
}
