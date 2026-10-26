import { Router } from "express";
import { config } from "../config";
import type { Deps } from "../deps";
import * as caddyfile from "../lib/caddyfile";
import { readInventory } from "../lib/serviceInventory";
import { isManagedHostname } from "../lib/siteValidation";
import type { ApiOk } from "../shared/board";
import type { RailPayload } from "../shared/rail";

/**
 * The rail's rows, read cheaply: the Caddyfile and the inventory file,
 * synchronously, with no status checks (health is the rail's poll). Never
 * throws: an unreadable Caddyfile is `sites: null` and an unreadable
 * inventory is `hostAvailable: false`.
 *
 * It lives beside the routes rather than in src/views because it reads
 * `config`, which demands the environment at import.
 */
export function readRail(deps: Deps): RailPayload {
  let sites: RailPayload["sites"] = null;
  try {
    sites = caddyfile
      .parseSites(deps.fs.readFile(config.caddyfilePath))
      .filter((site) => isManagedHostname(site.hostname, config.domain))
      .map((site) => ({ hostname: site.hostname, hint: site.type === "static" ? "static" : `:${site.target}` }));
  } catch {
    sites = null;
  }
  return { sites, hostAvailable: readInventory(deps.fs).available, domain: config.domain };
}

/** GET /api/rail: always 200, runs no status check. */
export function createRailRouter(deps: Deps): Router {
  const router = Router();
  router.get("/api/rail", (_req, res) => {
    res.json({ ok: true, ...readRail(deps) } satisfies ApiOk<RailPayload>);
  });
  return router;
}
