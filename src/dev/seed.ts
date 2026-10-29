import path from "node:path";
import { config } from "../config";
import type { ContainerStatus } from "../lib/containerStatus";
import type { FileSystem } from "../lib/fileSystem";
import { EVENTS_PATH } from "../lib/platform";
import { INVENTORY_PATH } from "../lib/serviceInventory";
import type { DeclarationSummary } from "../lib/siteResource";
import type { TimerSchedule, UnitState } from "../lib/unitState";

/**
 * Covers every branch parseSites has: the apex domain, a static subdomain, a
 * plain reverse proxy, Next.js sites carrying both marker comments, a
 * Next.js site carrying only the framework comment (the pre-healthcheck
 * legacy shape — sites created before the healthcheck-path field existed),
 * and one deliberately unmanaged block. lychee.local must never appear in
 * the site list — it is the live check that isManagedHostname still filters.
 *
 * The four Next.js sites are the states a site's "From a repository" card
 * has, so dev mode shows each without anyone attaching or deploying:
 * legacy.lychee.land is unattached (the full runbook and the Attach control),
 * preview.lychee.land is attached and awaiting its first image (0.1.0 on offer),
 * app.lychee.land is attached and running 0.2.0 with 0.3.0 on offer, and
 * broken.lychee.land's first deploy failed: 0.1.0 is pinned and failing, nothing
 * is installed, and the fix, 0.1.1, is on offer beside the failure line.
 * gone.lychee.land ran, was removed, and has been added back: Remove deleted its
 * old block and retired its declaration (state: absent), the reconciler has
 * since taken the container down (its inventory entry shows a completed down
 * with nothing installed), and the block here is the re-add. So its page shows
 * the detached warning with Prune, and its board row carries Prune too.
 * Their declarations are SEEDED_DECLARATIONS below; their inventory entries
 * are in SEEDED_INVENTORY.
 *
 * Ports 4000, 3001, 3100, 3200, 3300 and 3400 leave 8787 (lychee-admin itself)
 * and 2019 (Caddy's admin API) free, so the reserved-port rejection can be
 * triggered from the UI. 3000 is free too, so adding a Next.js site on the
 * obvious port works; 3100, 3200, 3300 and 3400 are claimed by declarations
 * (3400 by a retired one), so add-site's declared-port refusal can be
 * triggered on any of them.
 */
export const SEED_CADDYFILE = `{
\tauto_https off
}

http://lychee.land {
\troot * /var/www/lychee.land
\tfile_server
}

http://blog.lychee.land {
\troot * /var/www/blog.lychee.land
\tfile_server
}

http://api.lychee.land {
\treverse_proxy localhost:4000
}

http://app.lychee.land {
\t# lychee-admin-framework: nextjs
\t# lychee-admin-healthcheck: /api/health
\treverse_proxy localhost:3200
}

http://preview.lychee.land {
\t# lychee-admin-framework: nextjs
\t# lychee-admin-healthcheck: /
\treverse_proxy localhost:3100
}

http://broken.lychee.land {
\t# lychee-admin-framework: nextjs
\t# lychee-admin-healthcheck: /api/health
\treverse_proxy localhost:3300
}

http://gone.lychee.land {
\t# lychee-admin-framework: nextjs
\t# lychee-admin-healthcheck: /
\treverse_proxy localhost:3400
}

http://legacy.lychee.land {
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
  - hostname: lychee.land
    service: http://localhost:80
  - hostname: blog.lychee.land
    service: http://localhost:80
  - hostname: api.lychee.land
    service: http://localhost:80
  - hostname: app.lychee.land
    service: http://localhost:80
  - hostname: legacy.lychee.land
    service: http://localhost:80
  - hostname: preview.lychee.land
    service: http://localhost:80
  - hostname: broken.lychee.land
    service: http://localhost:80
  - hostname: gone.lychee.land
    service: http://localhost:80
  - service: http_status:404
`;

/**
 * The published inventory, as lychee-ops writes it each tick, and checked
 * against the contract's inventory schema by seed.test.ts. Two entries are
 * deliberate, the way the unmanaged lychee.local block above is.
 *
 * palsave-api is a container row, as the producer publishes it (it is a
 * declared resource, not a unit), seeded `blocked`. Containers have no retry
 * cap (that is a unit-app mechanism), so this is the resource reconciler's own
 * blocked: the declaration was refused and nothing was applied this tick. The
 * gate string is long on purpose, so the page has to lay out the loudest case
 * in dev mode and not only in an incident. It also has no live container state
 * in seededResourceContainers, so its row reads the neutral "unknown".
 */
export const SEEDED_INVENTORY = JSON.stringify(
  {
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    services: [
      { name: "lychee-reconcile-timer", kind: "unit", unit: "lychee-reconcile.timer", group: "reconciler", reconciled: false },
      { name: "lychee-watch-timer", kind: "unit", unit: "lychee-watch.timer", group: "reconciler", reconciled: false },
      { name: "lychee-admin", kind: "unit", unit: "lychee-admin.service", group: "service", reconciled: true,
        version: "a428e84", target: "", commit: "a428e842a101eb4da22ca29469297d71d0eda150",
        result: "skipped", gate: "ok", gate_code: "up-to-date", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      { name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true,
        version: "v2.11.4", target: "v2.12.0", commit: "af22c5683fcb100f8d27038fd2b71e744e46427a",
        // Pin moved, build blocked: must NOT read "applying", because nothing
        // is going to apply it. Neither the suite nor dev mode showed this
        // case before it was seeded. The gate is the producer's form
        // (roles/swee_app/tasks/decide_gate.yml): "job <check> concluded: <verdicts>".
        result: "blocked", gate: "job test concluded: failure", gate_code: "ci-failed", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      // The retry cap, on a unit row: swee-staging is a second instance of the
      // swee app, seeded at the cap. The result is "blocked", not "failed":
      // failed is the pre-cap state while the reconciler is still retrying and
      // alerts are firing; blocked is the cap, where the play succeeds, the
      // notifications stop and the service stays down. CLAUDE.md calls that the
      // state that looks like success. failed_attempts is what separates this
      // blocked from a CI-gate blocked (swee above). Gate text is the template
      // in roles/swee_app/tasks/decide_gate.yml, variables filled; its length
      // and embedded recovery command are what the page has to lay out.
      { name: "swee-staging", kind: "unit", unit: "swee-staging.service", group: "service", reconciled: true,
        version: "v0.2.0", target: "", commit: "9fbb23a8348ea8ef93b81f01c93e811e980bcb09",
        result: "blocked", gate_code: "retry-capped",
        gate: "v0.3.0 failed 3 times; not retrying (promote another tag, or rm /opt/swee-staging/.failed-tag)",
        last_run: "2026-10-02T04:58:02Z", failed_attempts: 3 },
      { name: "palsave-api", kind: "container", container: "palsave-api", group: "service", reconciled: true,
        version: "0.2.0", target: "0.2.0", commit: "",
        result: "blocked", gate_code: "not-applied",
        // The form roles/resources_reconcile/tasks/reconcile.yml writes for a
        // refused declaration: "not applied: " plus the validator's reasons.
        gate: "not applied: port 8788 is claimed by another declaration (swee-lychee-land); image ghcr.io/lycheehome/palsave-api is not under the registry path the reconciler accepts",
        last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      // Named for the instance, not the game: the producer derives both from
      // palworld_service, because a second Palworld server would be a second
      // unit and a row reading "palworld" would not say which.
      { name: "palworld-palchuds", kind: "unit", unit: "palworld-palchuds.service", group: "service", reconciled: false,
        actions: ["start", "stop", "restart", "update"] },
      // A container with no status file yet: reconciled false, no version. Dev
      // fakes answer "unknown" for every container, so this is the neutral,
      // not-red row, which is the case a container row must get right.
      { name: "lychee-docs", kind: "container", container: "lychee-docs", group: "service", reconciled: false },
      // Installed behind what the registry offers, so the board shows an
      // upgradeable row and not only settled ones.
      { name: "lychee-notes", kind: "container", container: "lychee-notes", group: "service", reconciled: true,
        version: "1.4.0", target: "1.4.0", available: "1.5.0",
        commit: "",
        result: "skipped", gate: "pin unchanged (1.4.0)", gate_code: "up-to-date", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      // Two of the attached site resources (see SEED_CADDYFILE). preview is the
      // tagless declaration after the reconciler's first look: no compose
      // action, nothing installed, the pushed tag discovered. "" is what the
      // producer writes for "no tag", and the parser normalises it away.
      { name: "preview-lychee-land", kind: "container", container: "preview-lychee-land", group: "service", reconciled: true,
        version: "", target: "", available: "0.1.0",
        result: "awaiting-image", gate_code: "awaiting-image", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      // app is settled on 0.2.0 with a newer tag pushed, so its page shows the
      // installed card with the board's own offer line.
      { name: "app-lychee-land", kind: "container", container: "app-lychee-land", group: "service", reconciled: true,
        version: "0.2.0", target: "0.2.0", available: "0.3.0",
        commit: "5b7e2a9c0d14f3e68a9b1c2d3e4f5061728394a5",
        result: "skipped", gate: "pin unchanged (0.2.0)", gate_code: "up-to-date", last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      // broken's first deploy failed before the retry cap: 0.1.0 is pinned and
      // retried every tick, nothing is installed, and the operator has since
      // pushed 0.1.1. A failed first deploy publishes an empty gate, so the
      // failed step is the only explanation the inventory carries.
      { name: "broken-lychee-land", kind: "container", container: "broken-lychee-land", group: "service", reconciled: true,
        version: "", target: "0.1.0", available: "0.1.1",
        result: "failed", gate: "", gate_code: "ok",
        failed_step: "Start the container: dependency failed to start: container broken-lychee-land is unhealthy",
        last_run: "2026-10-02T04:58:02Z", failed_attempts: 1 },
      // gone is retired and confirmed down: its last run was a completed
      // `down` (result deployed) and nothing is installed, which is exactly
      // what the prune route accepts. Its declaration is state: absent.
      { name: "gone-lychee-land", kind: "container", container: "gone-lychee-land", group: "service", reconciled: true,
        version: "", target: "", result: "deployed", gate: "", gate_code: "ok",
        last_run: "2026-10-02T04:58:02Z", failed_attempts: 0 },
      { name: "caddy", kind: "unit", unit: "caddy.service", group: "infrastructure", reconciled: false },
      { name: "cloudflared-sites", kind: "unit", unit: "cloudflared-sites.service", group: "infrastructure", reconciled: false },
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
  "lychee-reconcile.timer": { status: "running", since: "Thu 2026-09-26 11:00:00 UTC" },
  "lychee-admin.service": { status: "running", since: "Sat 2026-09-26 11:02:00 UTC" },
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
 * The lychee-resources declarations for the three attached sites and the one
 * retired site, handed to
 * createFakes by the dev server only — route tests start from an empty clone.
 * preview's image is tagless, as Attach writes it; app's and broken's carry
 * the tag their one deploy wrote (broken's is the one that failed).
 */
export const SEEDED_DECLARATIONS: DeclarationSummary[] = [
  { name: "preview-lychee-land", port: 3100, state: "running", image: "ghcr.io/lycheehome/preview-site" },
  { name: "app-lychee-land", port: 3200, state: "running", image: "ghcr.io/lycheehome/app-site:0.2.0" },
  { name: "broken-lychee-land", port: 3300, state: "running", image: "ghcr.io/lycheehome/broken-site:0.1.0" },
  { name: "gone-lychee-land", port: 3400, state: "absent", image: "ghcr.io/lycheehome/gone-site:0.1.0" },
];

/**
 * Live container state for resources that have a container. app runs; broken's
 * failed start left its container exited, which is what the board's row reads
 * (its site page asks no container, since nothing is installed). preview has
 * never been deployed, and the board's lychee-docs and lychee-notes rows stay
 * "unknown", the neutral answer a container row must get right.
 */
export const seededResourceContainers: Record<string, ContainerStatus> = {
  "app-lychee-land": { state: "running", health: "healthy" },
  "broken-lychee-land": { state: "exited" },
  // Taken down by the reconciler: no container left, which reads not deployed.
  "gone-lychee-land": { state: "not-created" },
};

/**
 * The directories that exist on a real host: both static sites', and the
 * legacy Next.js site's, from when scaffolds were still written to /var/www.
 * app.lychee.land deliberately has none — the remove dialog offers to delete
 * files only where they exist, and dev mode should show both cases.
 */
const SEEDED_SITE_DIRS = ["lychee.land", "blog.lychee.land", "legacy.lychee.land"];

/** Relative to process start, like SEEDED_INVENTORY.generated; reconciler times have no milliseconds. */
const ago = (minutes: number, ms = false): string => {
  const iso = new Date(Date.now() - minutes * 60_000).toISOString();
  return ms ? iso : iso.replace(/\.\d{3}Z$/, "Z");
};

const BROKEN_FAILED_STEP = "Start the container: dependency failed to start: container broken-lychee-land is unhealthy";

const lifetime = (name: string, kind: "unit" | "container", addedAgo: number, events: object[], removedAgo?: number) => ({
  id: `00000000-0000-5000-8000-${String(Math.abs([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7))).padStart(12, "0").slice(0, 12)}`,
  name,
  kind,
  added_at: ago(addedAgo),
  removed_at: removedAgo === undefined ? null : ago(removedAgo),
  last: { result: "", version: "", gate_code: "", failed_step: "", state: "", failed_attempts: 0 },
  events,
});

/**
 * The reconciler's history feed (A-HIST-1) agreeing with SEEDED_INVENTORY: one
 * event of every type, one closed lifetime, and one tick (lychee-notes) where
 * a recovery and a deploy share an `at`.
 */
export const SEEDED_EVENTS = JSON.stringify(
  {
    lifetimes: [
      lifetime("swee", "unit", 3000, [
        { at: ago(3000), type: "added" },
        { at: ago(190), type: "deployed", from: "v2.10.0", to: "v2.11.4" },
        { at: ago(12), type: "blocked", gate_code: "ci-failed", gate: "job test concluded: failure" },
      ]),
      lifetime("broken-lychee-land", "container", 400, [
        { at: ago(400), type: "added" },
        { at: ago(45), type: "failed", failed_step: BROKEN_FAILED_STEP },
      ]),
      lifetime("lychee-notes", "container", 2000, [
        { at: ago(130), type: "blocked", gate_code: "ci-pending", gate: "CI is still running on the release commit" },
        { at: ago(70), type: "deployed", from: "1.3.0", to: "1.4.0" },
        { at: ago(70), type: "recovered", from: "blocked", from_gate_code: "ci-pending", attempts: 2 },
      ]),
      lifetime("gone-lychee-land", "container", 1500, [
        { at: ago(600), type: "deployed", from: null, to: "0.4.2" },
        { at: ago(240), type: "down", from: "0.4.2" },
      ]),
      lifetime("preview-lychee-land", "container", 300, [{ at: ago(30), type: "awaiting-image" }]),
      lifetime("lychee-docs", "container", 900, [{ at: ago(500), type: "stopped" }]),
      lifetime("app-lychee-land", "container", 1200, [{ at: ago(1000), type: "deployed", from: "0.1.0", to: "0.2.0" }]),
      lifetime(
        "old-lychee-land",
        "container",
        4000,
        [
          { at: ago(4000), type: "added" },
          { at: ago(3500), type: "removed" },
        ],
        3500,
      ),
    ],
  },
  null,
  2,
);

const auditLine = (minutes: number, entry: object): string =>
  JSON.stringify({ timestamp: ago(minutes, true), ...entry });

/** What createLogger writes, oldest first. */
export const SEEDED_AUDIT_LOG =
  [
    auditLine(2000, { action: "add-site", hostname: "blog.lychee.land" }),
    auditLine(300, { action: "remove-site-failed", hostname: "legacy.lychee.land", detail: "caddy validate: Error: adapting config using caddyfile: ambiguous site definition: http://legacy.lychee.land" }),
    auditLine(50, { action: "deploy-service", hostname: "broken-lychee-land", detail: "0.1.0" }),
    auditLine(20, { action: "host-action", caller: "operator", unit: "palworld-palchuds", hostAction: "restart", outcome: "started" }),
    // Logged with the request's Host header as hostname; the feed drops it.
    auditLine(5, { action: "refused-cross-site", hostname: "admin.lychee.land" }),
  ].join("\n") + "\n";

export function applySeed(fs: FileSystem): void {
  for (const hostname of SEEDED_SITE_DIRS) fs.mkdir(path.posix.join(config.sitesRoot, hostname));
  fs.writeFile(config.caddyfilePath, SEED_CADDYFILE);
  fs.writeFile(config.tunnelConfigPath, SEED_TUNNEL_CONFIG);
  fs.writeFile(INVENTORY_PATH, SEEDED_INVENTORY);
  fs.mkdir(path.posix.dirname(EVENTS_PATH));
  fs.writeFile(EVENTS_PATH, SEEDED_EVENTS);
  fs.mkdir(path.posix.dirname(config.logFile));
  fs.writeFile(config.logFile, SEEDED_AUDIT_LOG);
}
