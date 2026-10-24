import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import type { SiteDetailFacts, SiteDetailPayload } from "../shared/siteDetail";
import type { AddSitePayload } from "../shared/addSite";

/**
 * Helpers shared by the `*.test.ts` files. This lives in `src/dev/` because
 * that directory is already excluded from `tsconfig.build.json` and from the
 * deploy rsync exactly as `*.test.ts` is, so nothing here can reach `dist/` or
 * `lychee` — and because the route tests already reach in here for the fakes.
 * Naming it `*.test.ts` instead would have made the test runner collect a file
 * containing no tests.
 */

/**
 * The rail's view of `src/dev/seed.ts`'s Caddyfile: its managed sites, in
 * Caddyfile order, with the hint each row prints. Written out rather than
 * parsed from the seed because the seed imports config, which a view test
 * cannot load without the environment the route tests set up.
 */
export const SEEDED_RAIL_SITES: ReadonlyArray<{ hostname: string; hint: string }> = [
  { hostname: "lychee.land", hint: "static" },
  { hostname: "blog.lychee.land", hint: "static" },
  { hostname: "api.lychee.land", hint: ":4000" },
  { hostname: "app.lychee.land", hint: ":3200" },
  { hostname: "preview.lychee.land", hint: ":3100" },
  { hostname: "broken.lychee.land", hint: ":3300" },
  { hostname: "gone.lychee.land", hint: ":3400" },
  { hostname: "legacy.lychee.land", hint: ":3001" },
];

/**
 * The retired breadcrumb dropdown's id, which tests assert no page carries.
 * Assembled rather than written out so that a grep of src and public for the
 * literal id stays empty: that grep is how its removal is checked.
 */
export const RETIRED_SWITCHER = new RegExp(["hostname", "switcher"].join("-"));

/**
 * A seed site and the facts `GET /api/sites/:hostname` would answer with for
 * it, gathered by the route's own `loadSiteDetail` against the dev fakes and
 * `src/dev/seed.ts`. Everything is imported lazily, after `./env` has set the
 * dev environment, because config reads the environment when it is first
 * loaded and the view tests that also import this file must not load it.
 *
 * A plain proxy's status is a real TCP probe of localhost, so a test that
 * cares whether `api.lychee.land` responds should override `status` itself.
 */
export async function seedSiteDetailFacts(hostname: string): Promise<{ site: Site; facts: SiteDetailFacts }> {
  await import("./env");
  const { createFakes } = await import("./fakes");
  const { applySeed, SEEDED_DECLARATIONS } = await import("./seed");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { parseSites } = await import("../lib/caddyfile");
  const { config } = await import("../config");
  const { loadSiteDetail } = await import("../routes/sites");
  const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
  applySeed(fakes.fs);
  const site = parseSites(fakes.fs.readFile(config.caddyfilePath)).find((s) => s.hostname === hostname);
  assert.ok(site, `no seed site ${hostname}`);
  const facts = await loadSiteDetail(site, {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  });
  return { site, facts };
}

/**
 * `GET /api/sites/:hostname`'s answer for a seed site, as the route builds it
 * (the site, its files path and the facts), with `override` merged over the
 * facts. The site page's React tests render this and compare it with the
 * retired renderSiteDetail's output for the same facts, frozen in
 * src/dev/fixtures/detail/.
 */
export async function seedSiteDetailPayload(
  hostname: string,
  override: Partial<SiteDetailFacts> = {},
): Promise<{ site: Site; payload: Extract<SiteDetailPayload, { caddyfileError: null }> }> {
  const { site, facts } = await seedSiteDetailFacts(hostname);
  const { computeFilesPath } = await import("../lib/caddyfile");
  const merged = { ...facts, ...override };
  return {
    site,
    payload: { site, filesPath: computeFilesPath(site, merged.sitesRoot), caddyfileError: null, ...merged },
  };
}

/**
 * `GET /api/sites/new`'s answer for the seed, built as the route builds it:
 * the managed sites of `src/dev/seed.ts`'s Caddyfile, their port owners from
 * the route's own `computePortOwners`, the configured paths and `ADD_STEPS`.
 * Lazy imports, for the reason `seedSiteDetailFacts` gives.
 */
export async function seedAddSitePayload(): Promise<AddSitePayload> {
  await import("./env");
  const { SEED_CADDYFILE } = await import("./seed");
  const { parseSites } = await import("../lib/caddyfile");
  const { isManagedHostname } = await import("../lib/siteValidation");
  const { ADD_STEPS } = await import("../lib/stepReport");
  const { config } = await import("../config");
  const { computePortOwners } = await import("../routes/sites");
  const sites = parseSites(SEED_CADDYFILE).filter((site) => isManagedHostname(site.hostname, config.domain));
  return {
    domain: config.domain,
    portOwners: computePortOwners(sites),
    paths: { caddyfilePath: config.caddyfilePath, tunnelConfigPath: config.tunnelConfigPath },
    steps: ADD_STEPS.map(({ id, label }) => ({ id, label })),
    caddyfileError: null,
  };
}
