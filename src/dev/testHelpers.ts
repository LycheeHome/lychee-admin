import assert from "node:assert/strict";

/**
 * Helpers shared by the `*.test.ts` files. This lives in `src/dev/` because
 * that directory is already excluded from `tsconfig.build.json` and from the
 * deploy rsync exactly as `*.test.ts` is, so nothing here can reach `dist/` or
 * `lychee` — and because the route tests already reach in here for the fakes.
 * Naming it `*.test.ts` instead would have made the test runner collect a file
 * containing no tests.
 */

const HEADER = /<header id="site-header"[\s\S]*?<\/header>/;

/**
 * The page with the header band cut out of it. Assertions about a page's body
 * would otherwise be satisfied by the header alone: it carries its own "sites"
 * and "add site" links on every page.
 *
 * The assert is the point. `String.replace` returns its input unchanged when
 * the pattern misses and throws nothing, so if the header's id ever changes,
 * every caller would quietly revert to page-wide matching — the exact vacuity
 * they exist to prevent.
 */
export function withoutHeader(html: string): string {
  assert.match(html, HEADER, "expected a header to strip — anchor is stale");
  return html.replace(HEADER, "");
}
