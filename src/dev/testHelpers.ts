import assert from "node:assert/strict";

/**
 * Helpers shared by the `*.test.ts` files. This lives in `src/dev/` because
 * that directory is already excluded from `tsconfig.build.json` and from the
 * deploy rsync exactly as `*.test.ts` is, so nothing here can reach `dist/` or
 * `lychee` — and because the route tests already reach in here for the fakes.
 * Naming it `*.test.ts` instead would have made the test runner collect a file
 * containing no tests.
 */

const RAIL = /<aside id="site-nav"[\s\S]*?<\/aside>/;

/**
 * The page with the rail cut out of it. Several assertions about a page's body
 * would otherwise be satisfied by the rail alone: the switcher prints every
 * managed hostname on every page, and the rail carries its own "Add site" link.
 *
 * The assert is the point. `String.replace` returns its input unchanged when
 * the pattern misses and throws nothing, so if the rail's id or element ever
 * changes, every caller would quietly revert to page-wide matching — the exact
 * vacuity they exist to prevent.
 */
export function withoutRail(html: string): string {
  assert.match(html, RAIL, "expected a rail to strip — anchor is stale");
  return html.replace(RAIL, "");
}
