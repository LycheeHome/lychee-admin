import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { withoutHeader } from "../dev/testHelpers";
import { renderSiteList, renderSiteDetail, renderAddSite, renderSiteNotFound } from "./html";

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

const HEADER = /<header id="site-header"[\s\S]*?<\/header>/;

function header(html: string): string {
  const match = html.match(HEADER);
  assert.ok(match, "expected a header band");
  return match[0];
}

describe("the header band", () => {
  test("renders on the site list", () => {
    assert.match(header(renderSiteList(SITES, {}, "lyly.dev")), /href="\/sites\/new"/);
  });

  test("renders on a site detail page", () => {
    assert.match(header(renderSiteDetail(SITES[0], DETAIL_OPTS)), /href="\/"/);
  });

  test("carries the wordmark at its documented Display size", () => {
    const block = header(renderSiteList(SITES, {}, "lyly.dev"));
    assert.match(block, /font-display text-2xl/);
    assert.match(block, /lyly<span class="text-rose-400">\.<\/span>admin/);
  });

  test("marks sites current on the list page only", () => {
    const list = header(renderSiteList(SITES, {}, "lyly.dev"));
    assert.match(list, /href="\/"[^>]*aria-current="page"/);
    const detail = header(renderSiteDetail(SITES[0], DETAIL_OPTS));
    assert.doesNotMatch(detail, /aria-current="page"/);
  });

  test("marks add site current on the add-site page", () => {
    const block = header(renderAddSite(SITES, "lyly.dev", PORT_OWNERS, PATHS));
    assert.match(block, /href="\/sites\/new"[^>]*aria-current="page"/);
  });

  test("lists no hostnames — the switcher is not in the header", () => {
    const block = header(renderSiteDetail(SITES[0], DETAIL_OPTS));
    for (const site of SITES) assert.doesNotMatch(block, new RegExp(site.hostname));
  });

  test("does not offset the page for a rail that no longer exists", () => {
    const html = renderSiteList(SITES, {}, "lyly.dev");
    assert.doesNotMatch(html, /id="site-nav"/);
    assert.doesNotMatch(html, /calc\(50% \+ 110px\)/);
    assert.match(html, /id="flash-banner"[^>]*left-1\/2/);
  });
});

const PORT_OWNERS = { "8787": "reserved (lyly-admin itself)", "4000": "api.lyly.dev" };
const PATHS = {
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
};

describe("the add-site page", () => {
  test("renders the fields that used to live in the dialog", () => {
    const html = renderAddSite(SITES, "lyly.dev", PORT_OWNERS, PATHS);
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
    assert.match(renderAddSite(SITES, "lyly.dev", PORT_OWNERS, PATHS), /action="\/sites"/);
  });

  test("marks Add site current, and All sites not", () => {
    const html = header(renderAddSite(SITES, "lyly.dev", PORT_OWNERS, PATHS));
    assert.match(html, /href="\/sites\/new"[^>]*aria-current="page"/);
    assert.doesNotMatch(html, /href="\/"[^>]*aria-current="page"/);
  });

  test("the list page no longer carries the dialog", () => {
    const html = renderSiteList(SITES, {}, "lyly.dev");
    assert.doesNotMatch(html, /add-site-dialog/);
    assert.doesNotMatch(html, /id="add-site-form"/);
  });

  test("the list page's own Add site button became a link", () => {
    // The header carries its own "sites" and "add site" links on every page,
    // so this must assert against the page body with the header removed —
    // otherwise it passes on the header's item whether or not the primary
    // button was ever converted.
    const body = withoutHeader(renderSiteList(SITES, {}, "lyly.dev"));
    assert.match(body, /<a href="\/sites\/new"[^>]*>(?:(?!<\/a>)[\s\S])*Add site<\/a>/);
    assert.doesNotMatch(body, /data-open-dialog="add-site-dialog"/);
  });
});

describe("the shell's h1", () => {
  // The rail-era shell rendered a plain <h1>lyly.admin</h1>; the header
  // rewrite made the wordmark a link and nothing took the h1 role, so every
  // document outline started at h2 — and the not-found page had no heading
  // at all. Restoring it as the shell's h1 (rather than promoting each
  // page's own topic heading) means every page gets exactly one, from one
  // edit in shell.ts.
  const countH1 = (html: string) => (html.match(/<h1[\s>]/g) ?? []).length;

  test("renders exactly one on the site list", () => {
    assert.equal(countH1(renderSiteList(SITES, {}, "lyly.dev")), 1);
  });

  test("renders exactly one on the add-site page", () => {
    assert.equal(countH1(renderAddSite(SITES, "lyly.dev", PORT_OWNERS, PATHS)), 1);
  });

  test("renders exactly one on a site detail page", () => {
    assert.equal(countH1(renderSiteDetail(SITES[0], DETAIL_OPTS)), 1);
  });

  test("renders exactly one on the not-found page", () => {
    assert.equal(countH1(renderSiteNotFound("nope.lyly.dev")), 1);
  });

  test("wraps the wordmark home link, not a page topic heading", () => {
    const html = header(renderSiteList(SITES, {}, "lyly.dev"));
    assert.match(
      html,
      /<h1[^>]*>\s*<a href="\/"[^>]*>lyly<span class="text-rose-400">\.<\/span>admin<\/a>\s*<\/h1>/,
    );
  });
});
