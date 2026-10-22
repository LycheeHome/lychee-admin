import { config } from "../config";
import type { Deps } from "../deps";
import * as caddyfile from "../lib/caddyfile";
import { readInventory } from "../lib/serviceInventory";
import { isManagedHostname } from "../lib/siteValidation";
import type { RailCurrent, ShellData } from "../views/shell";

/**
 * What every page's shell needs, read cheaply: the Caddyfile and the
 * inventory file, synchronously, with no status checks (health is the
 * island's poll). Never throws: an unreadable Caddyfile is `sites: null` and
 * an unreadable inventory is `hostAvailable: false`, each its own line in the
 * rail.
 *
 * It lives beside the routes rather than in src/views/shell.ts because it
 * reads `config`, which demands the environment at import: a view module that
 * imported it would make every view test need that environment too.
 *
 * `assets` is read from `deps.clientAssets` on every call, never cached: the
 * dev server defines it as a getter that re-reads Vite's manifest.
 */
export function loadShell(deps: Deps, current: RailCurrent): ShellData {
  let sites: ShellData["rail"]["sites"] = null;
  try {
    sites = caddyfile
      .parseSites(deps.fs.readFile(config.caddyfilePath))
      .filter((site) => isManagedHostname(site.hostname, config.domain))
      .map((site) => ({ hostname: site.hostname, hint: site.type === "static" ? "static" : `:${site.target}` }));
  } catch {
    sites = null;
  }

  return {
    rail: { sites, hostAvailable: readInventory(deps.fs).available, current, domain: config.domain },
    assets: deps.clientAssets ?? null,
  };
}
