import assert from "node:assert/strict";
import type { RailData, ShellData } from "../views/shell";
import type { ClientAssets } from "../views/clientShell";

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
 * A shell for a renderer under test: the seeded sites, a readable inventory,
 * no current page and no client bundle, each overridable.
 */
export function testShell(overrides: Partial<RailData> & { assets?: ClientAssets | null } = {}): ShellData {
  const { assets = null, ...rail } = overrides;
  return {
    rail: {
      sites: SEEDED_RAIL_SITES.map((s) => ({ ...s })),
      hostAvailable: true,
      current: null,
      domain: "lychee.land",
      ...rail,
    },
    assets,
  };
}

/**
 * The retired breadcrumb dropdown's id, which tests assert no page carries.
 * Assembled rather than written out so that a grep of src and public for the
 * literal id stays empty: that grep is how its removal is checked.
 */
export const RETIRED_SWITCHER = new RegExp(["hostname", "switcher"].join("-"));

const RAIL = /<aside id="rail"[\s\S]*?<\/aside>/;
const TOP_BAR = /<header id="top-bar"[\s\S]*?<\/header>/;

/**
 * The page with the rail and the narrow-screen top bar cut out of it.
 * Assertions about a page's body would otherwise be satisfied by the shell
 * alone: the rail lists every site and carries "sites" and "Add site" links on
 * every page.
 *
 * The asserts are the point. `String.replace` returns its input unchanged when
 * the pattern misses and throws nothing, so if either id ever changes, every
 * caller would quietly revert to page-wide matching — the exact vacuity they
 * exist to prevent.
 */
export function withoutShell(html: string): string {
  assert.match(html, RAIL, "expected a rail to strip — anchor is stale");
  assert.match(html, TOP_BAR, "expected a top bar to strip — anchor is stale");
  return html.replace(RAIL, "").replace(TOP_BAR, "");
}
