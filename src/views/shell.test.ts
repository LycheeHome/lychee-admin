import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { renderSiteList, renderSiteDetail, renderSiteNotFound } from "./html";

const SITES: Site[] = [
  { hostname: "blog.lyly.dev", type: "static", target: "/var/www/blog.lyly.dev" },
  { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" },
  { hostname: "app.lyly.dev", type: "reverse-proxy", target: "3000", framework: "nextjs" },
];

const DETAIL_OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  caddyfilePath: "/etc/caddy/Caddyfile",
  sites: SITES,
};

/**
 * Every rail assertion is scoped to this slice rather than run against the
 * whole document. A page-wide match proves nothing here: "All sites" would
 * also be satisfied by the breadcrumb, and a hostname appears in the detail
 * page's heading, breadcrumb, Visit link and request-path hops. The regex is
 * non-greedy and the rail does not nest, so it captures exactly the rail.
 */
function rail(html: string): string {
  const match = /<aside id="site-nav"[\s\S]*?<\/aside>/.exec(html);
  assert.ok(match, "expected a rail with id=site-nav");
  return match[0];
}

describe("the rail", () => {
  test("renders on the site list", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    assert.match(html, /All sites/);
  });

  test("renders on a site detail page", () => {
    const html = rail(renderSiteDetail(SITES[0], DETAIL_OPTS));
    assert.match(html, /All sites/);
  });

  test("renders on the not-found page", () => {
    const html = rail(renderSiteNotFound("nope.lyly.dev", SITES));
    assert.match(html, /All sites/);
  });

  /**
   * Scoped to the nav block, not the whole rail: Task 5 adds a switcher whose
   * active row also carries aria-current, so a rail-wide assertion here would
   * start passing for the wrong reason on a detail page.
   */
  function navBlock(html: string): string {
    const match = /<nav id="nav-pages"[\s\S]*?<\/nav>/.exec(rail(html));
    assert.ok(match, "expected a nav with id=nav-pages");
    return match[0];
  }

  test("marks All sites current on the list page only", () => {
    assert.match(navBlock(renderSiteList(SITES, "lyly.dev", "/var/www")), /aria-current="page"/);
    assert.doesNotMatch(navBlock(renderSiteDetail(SITES[0], DETAIL_OPTS)), /aria-current="page"/);
  });

  test("carries the brand, which the page header no longer does", () => {
    const html = renderSiteList(SITES, "lyly.dev", "/var/www");
    assert.match(rail(html), /lyly<span class="text-rose-400">\.<\/span>admin/);
    assert.doesNotMatch(html, /<header/);
  });
});
