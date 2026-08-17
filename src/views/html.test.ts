import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { renderSiteDetail } from "./html";

const OPTS = {
  sitesRoot: "/var/www",
  domain: "lyly.dev",
  tunnelId: "c7081f91-61c2-476b-8505-42d219bb6d7e",
  caddyfilePath: "/etc/caddy/Caddyfile",
};

const STATIC_SITE: Site = { hostname: "blog.lyly.dev", type: "static", target: "/var/www/blog.lyly.dev" };
const APEX_SITE: Site = { hostname: "lyly.dev", type: "static", target: "/var/www/lyly.dev" };
const PROXY_SITE: Site = { hostname: "api.lyly.dev", type: "reverse-proxy", target: "4000" };
const NEXT_SITE: Site = {
  hostname: "app.lyly.dev",
  type: "reverse-proxy",
  target: "3000",
  framework: "nextjs",
  healthcheckPath: "/api/health",
};

describe("renderSiteDetail header", () => {
  test("replaces the back link with a breadcrumb to the site list", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /aria-label="Breadcrumb"/);
    assert.match(html, /<a href="\/"[^>]*>sites<\/a>/);
    assert.doesNotMatch(html, /Back to sites/);
  });

  test("dims the managed domain suffix on a subdomain", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /blog<span class="text-stone-500">\.lyly\.dev<\/span>/);
  });

  test("leaves the apex domain undimmed — it has no subdomain", () => {
    const html = renderSiteDetail(APEX_SITE, OPTS);
    assert.match(html, /id="site-hostname"[^>]*>lyly\.dev</);
    assert.doesNotMatch(html, /<span class="text-stone-500"><\/span>/);
  });

  test("offers Visit as the primary action, opening the real hostname safely", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /href="https:\/\/blog\.lyly\.dev"/);
    assert.match(html, /rel="noopener noreferrer"/);
  });

  test("wires the hostname copy button to the existing generic handler", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /data-copy-target="site-hostname"/);
    assert.match(html, /id="site-hostname"/);
  });

  test("a static site gets a type pill and no state pill", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, />static</);
    assert.doesNotMatch(html, /data-state-pill/);
  });

  test("a container site's pill uses the canonical state word, not live", () => {
    const html = renderSiteDetail(NEXT_SITE, {
      ...OPTS,
      status: { kind: "container", state: "running", health: "unhealthy" },
    });
    assert.match(html, /data-state-pill[^>]*>[\s\S]*?unhealthy/);
    assert.doesNotMatch(html, /&#9679; live|>\s*live\s*</);
  });

  test("a plain proxy's pill reports responding", () => {
    const html = renderSiteDetail(PROXY_SITE, { ...OPTS, status: { kind: "tcp", responding: true } });
    assert.match(html, /data-state-pill[^>]*>[\s\S]*?responding/);
  });

  test("widens the column past the old 640px", () => {
    const html = renderSiteDetail(STATIC_SITE, OPTS);
    assert.match(html, /max-w-\[760px\]/);
  });
});
