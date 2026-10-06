import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "../lib/fileSystem";
import { INVENTORY_PATH } from "../lib/serviceInventory";
import type { TimerSchedule, UnitState } from "../lib/unitState";

/**
 * Covers every branch parseSites has: the apex domain, a static subdomain, a
 * plain reverse proxy, a Next.js site carrying both marker comments, a
 * Next.js site carrying only the framework comment (the pre-healthcheck
 * legacy shape — sites created before the healthcheck-path field existed),
 * and one deliberately unmanaged block. lychee.local must never appear in
 * the site list — it is the live check that isManagedHostname still filters.
 *
 * Ports 4000, 3000, and 3001 leave 8787 (lyly-admin itself) and 2019
 * (Caddy's admin API) free, so the reserved-port rejection can be triggered
 * from the UI.
 */
export const SEED_CADDYFILE = `{
\tauto_https off
}

http://lyly.dev {
\troot * /var/www/lyly.dev
\tfile_server
}

http://blog.lyly.dev {
\troot * /var/www/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}

http://app.lyly.dev {
\t# lyly-admin-framework: nextjs
\t# lyly-admin-healthcheck: /api/health
\treverse_proxy localhost:3000
}

http://legacy.lyly.dev {
\t# lyly-admin-framework: nextjs
\treverse_proxy localhost:3001
}

http://lychee.local {
\troot * /var/www/lychee.local
\tfile_server
}
`;

/** lychee.local deliberately has no ingress rule — it is not tunnel-managed. */
export const SEED_TUNNEL_CONFIG = `tunnel: 11111111-2222-3333-4444-555555555555
credentials-file: /etc/cloudflared/11111111-2222-3333-4444-555555555555.json
ingress:
  - hostname: lyly.dev
    service: http://localhost:80
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - hostname: api.lyly.dev
    service: http://localhost:80
  - hostname: app.lyly.dev
    service: http://localhost:80
  - hostname: legacy.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

/**
 * The published inventory, as lychee-ops writes it each tick. Two entries are
 * deliberate, the way the unmanaged lychee.local block above is.
 *
 * palsave-api is seeded at the retry cap. The result is "blocked", not
 * "failed": failed is the pre-cap state while the reconciler is still retrying
 * and alerts are firing; blocked is the cap, where the play succeeds, the
 * notifications stop and the service stays down. CLAUDE.md calls that the
 * state that looks like success, and it has no UI anywhere today. Seeded so
 * the page's loudest case is visible in dev mode, not only in an incident.
 * failed_attempts is what separates this blocked from a CI-gate blocked.
 */
export const SEEDED_INVENTORY = JSON.stringify(
  {
    generated: new Date().toISOString(),
    services: [
      { name: "lyly-reconcile-timer", unit: "lyly-reconcile.timer", group: "reconciler", reconciled: false },
      { name: "lyly-admin", unit: "lyly-admin.service", group: "service", reconciled: true,
        version: "a428e84", commit: "a428e842a101eb4da22ca29469297d71d0eda150",
        result: "skipped", gate: "ok", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      { name: "swee", unit: "swee.service", group: "service", reconciled: true,
        version: "v2.11.4", target: "v2.12.0", commit: "af22c5683fcb100f8d27038fd2b71e744e46427a",
        // Pin moved, build blocked: must NOT read "applying", because nothing
        // is going to apply it. Neither the suite nor dev mode showed this
        // case before it was seeded.
        result: "blocked", gate: "job test concluded: failure for v2.12.0", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      { name: "palsave-api", unit: "palsave-api.service", group: "service", reconciled: true,
        version: "v0.2.0", commit: "9fbb23a8348ea8ef93b81f01c93e811e980bcb09",
        result: "blocked",
        // Verbatim from roles/palsave_api_app/tasks/decide_gate.yml:118-120 —
        // the real string, not a paraphrase. Its length and the embedded
        // recovery command are what the page has to lay out.
        gate: "v0.2.0 failed 3 times; not retrying (promote another tag, or rm /opt/palsave-api/.failed-tag)",
        last_run: "2026-10-02T04:58:02Z", failed_attempts: 3 },
      // Named for the instance, not the game — the producer derives both from
      // palworld_service, because a second Palworld server would be a second
      // unit and a row reading "palworld" would not say which.
      { name: "palworld-palchuds", unit: "palworld-palchuds.service", group: "service", reconciled: false },
      // A container with no status file yet: reconciled false, no version. Dev
      // fakes answer "unknown" for every container, so this is the neutral,
      // not-red row, which is the case a container row must get right.
      { name: "lyly-docs", kind: "container", container: "lyly-docs", group: "service", reconciled: false },
      // Installed behind what the registry offers, so the board shows an
      // upgradeable row and not only settled ones.
      { name: "lyly-notes", kind: "container", container: "lyly-notes", group: "service", reconciled: true,
        version: "v1.4.0", target: "v1.4.0", available: "v1.5.0",
        commit: "3c1d9e07b5a24f6e8d0a1b2c3d4e5f6071829304",
        result: "skipped", gate: "pin unchanged (v1.4.0)", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      { name: "caddy", unit: "caddy.service", group: "infrastructure", reconciled: false },
      { name: "cloudflared-sites", unit: "cloudflared-sites.service", group: "infrastructure", reconciled: false },
    ],
  },
  null,
  2,
);

/**
 * palsave-api.service is deliberately ABSENT: a declared unit with no live
 * state reads unknown, so dev mode renders that row without anyone having to
 * break the host. (Absent here, not `{status: "unknown"}`, because that is
 * what the real readUnitStates produces for a unit systemd omits.)
 */
export const seededUnitStates: Record<string, UnitState> = {
  "lyly-reconcile.timer": { status: "running", since: "Thu 2026-09-26 11:00:00 UTC" },
  "lyly-admin.service": { status: "running", since: "Sat 2026-09-26 11:02:00 UTC" },
  "swee.service": { status: "running", since: "Fri 2026-10-02 02:47:38 UTC" },
  "palworld-palchuds.service": { status: "running", since: "Thu 2026-10-01 06:54:00 UTC" },
  "caddy.service": { status: "running", since: "Sat 2026-09-26 11:00:00 UTC" },
  "cloudflared-sites.service": { status: "running", since: "Sat 2026-09-26 11:00:00 UTC" },
};

/** Relative to import time so dev mode always shows a plausible "next in…". */
export const SEEDED_TIMER_SCHEDULE: TimerSchedule = {
  last: new Date(Date.now() - 2 * 60_000),
  next: new Date(Date.now() + 3 * 60_000),
};

/**
 * The directories that exist on a real host: both static sites', and the
 * legacy Next.js site's, from when scaffolds were still written to /var/www.
 * app.lyly.dev deliberately has none — the remove dialog offers to delete
 * files only where they exist, and dev mode should show both cases.
 */
const SEEDED_SITE_DIRS = ["lyly.dev", "blog.lyly.dev", "legacy.lyly.dev"];

export function applySeed(fs: FileSystem): void {
  for (const hostname of SEEDED_SITE_DIRS) fs.mkdir(path.posix.join(config.sitesRoot, hostname));
  fs.writeFile(config.caddyfilePath, SEED_CADDYFILE);
  fs.writeFile(config.tunnelConfigPath, SEED_TUNNEL_CONFIG);
  fs.writeFile(INVENTORY_PATH, SEEDED_INVENTORY);
}
