import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { renderSiteList, renderSiteDetail, renderSiteNotFound, renderAddSite } from "./html";

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

  test("stays put on a long page rather than scrolling away with the content", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    // self-start matters as much as sticky: flex align-items:stretch would
    // otherwise size the aside to the document and sticky would do nothing.
    assert.match(html, /self-start/);
    assert.match(html, /sticky/);
    assert.match(html, /top-0/);
    assert.match(html, /h-screen/);
  });
});

describe("the site switcher", () => {
  test("lists every managed site", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    for (const site of SITES) {
      assert.match(html, new RegExp(`href="/sites/${site.hostname.replace(/\./g, "\\.")}"`));
    }
  });

  test("shows the active hostname closed, and marks only that row current", () => {
    const html = rail(renderSiteDetail(SITES[2], DETAIL_OPTS));
    assert.match(html, /<summary(?:(?!<\/summary>)[\s\S])*app\.lyly\.dev/);
    assert.match(html, /href="\/sites\/app\.lyly\.dev"[^>]*aria-current="page"/);
    assert.doesNotMatch(html, /href="\/sites\/api\.lyly\.dev"[^>]*aria-current="page"/);
  });

  test("keeps the active site listed rather than filtering it out", () => {
    const html = rail(renderSiteDetail(SITES[2], DETAIL_OPTS));
    const rows = html.match(/href="\/sites\/[a-z.]+\.lyly\.dev"/g) ?? [];
    assert.equal(rows.length, SITES.length);
  });

  test("prompts rather than naming a site when none is active", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    assert.match(html, /<summary(?:(?!<\/summary>)[\s\S])*Switch to site…/);
  });

  test("carries a type hint per row: STATIC, or the proxy port", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    assert.match(html, /blog\.lyly\.dev(?:(?!<\/a>)[\s\S])*STATIC/);
    assert.match(html, /api\.lyly\.dev(?:(?!<\/a>)[\s\S])*:4000/);
  });

  test("with no sites, offers a disabled trigger and no panel", () => {
    const html = rail(renderSiteList([], "lyly.dev", "/var/www"));
    assert.match(html, /No sites/);
    assert.doesNotMatch(html, /<details/);
    assert.doesNotMatch(html, /<ul/);
  });

  test("carries no liveness markers — the rail never status-checks", () => {
    const html = rail(renderSiteList(SITES, "lyly.dev", "/var/www"));
    for (const word of ["responding", "not deployed", "running", "unhealthy", "exited"]) {
      assert.doesNotMatch(html, new RegExp(word));
    }
  });
});

const PORT_OWNERS = { "8787": "reserved (lyly-admin itself)", "4000": "api.lyly.dev" };

describe("the add-site page", () => {
  test("renders the fields that used to live in the dialog", () => {
    const html = renderAddSite(SITES, "lyly.dev", PORT_OWNERS);
    assert.match(html, /name="hostname"/);
    assert.match(html, /name="type"[^>]*value="static"/);
    assert.match(html, /name="type"[^>]*value="reverse-proxy"/);
    assert.match(html, /id="port-field"/);
    assert.match(html, /id="framework-field"/);
    assert.match(html, /id="healthcheck-field"/);
    assert.match(html, /id="healthcheck-field-wrapper"/);
    assert.match(html, /id="port-owners-data"/);
    // These four are not named in the brief's list, but their loss would
    // silently kill progressive disclosure and port-conflict feedback with
    // no other test failing: the port/framework sync in app.js selects
    // .port-input and #healthcheck-field-wrapper, validatePortField selects
    // .port-error, and the submit handler's catch branch selects
    // #add-site-error.
    assert.match(html, /\bport-input\b/);
    assert.match(html, /\bport-error\b/);
    assert.match(html, /id="add-site-error"/);
  });

  test("posts to the unchanged endpoint", () => {
    assert.match(renderAddSite(SITES, "lyly.dev", PORT_OWNERS), /action="\/sites"/);
  });

  test("marks Add site current, and All sites not", () => {
    const html = rail(renderAddSite(SITES, "lyly.dev", PORT_OWNERS));
    assert.match(html, /href="\/sites\/new"[^>]*aria-current="page"/);
    assert.doesNotMatch(html, /href="\/"[^>]*aria-current="page"/);
  });

  test("the list page no longer carries the dialog", () => {
    const html = renderSiteList(SITES, "lyly.dev", "/var/www");
    assert.doesNotMatch(html, /add-site-dialog/);
    assert.doesNotMatch(html, /id="add-site-form"/);
  });

  test("the list page's own Add site button became a link", () => {
    // The rail carries its own "Add site" link, so this must assert against
    // the page body with the rail removed — otherwise it passes on the rail's
    // item whether or not the header button was ever converted.
    const body = renderSiteList(SITES, "lyly.dev", "/var/www").replace(
      /<aside id="site-nav"[\s\S]*?<\/aside>/,
      "",
    );
    assert.match(body, /<a href="\/sites\/new"[^>]*>(?:(?!<\/a>)[\s\S])*Add site<\/a>/);
    assert.doesNotMatch(body, /data-open-dialog="add-site-dialog"/);
  });
});
