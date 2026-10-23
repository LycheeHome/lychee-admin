import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { RETIRED_SWITCHER, testShell, withoutShell } from "../dev/testHelpers";
import { renderSiteList, renderSiteDetail, renderAddSite, renderSiteNotFound } from "./html";
import { renderClientPage } from "./clientShell";
import type { ShellData } from "./shell";

const SITES: Site[] = [
  { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" },
  { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" },
  { hostname: "app.lychee.land", type: "reverse-proxy", target: "3000", framework: "nextjs" },
];

const DETAIL_OPTS = {
  sitesRoot: "/var/www",
  domain: "lychee.land",
  tunnelId: "11111111-2222-3333-4444-555555555555",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
  caddyfilePath: "/etc/caddy/Caddyfile",
};

const PORT_OWNERS = { "8787": "reserved (lychee-admin itself)", "4000": "api.lychee.land" };
const PATHS = {
  caddyfilePath: "/etc/caddy/Caddyfile",
  tunnelConfigPath: "/etc/cloudflared/sites-config.yml",
};

const list = (shell: ShellData = testShell({ current: { page: "sites" } })) =>
  renderSiteList(SITES, {}, "lychee.land", undefined, undefined, [], shell);
// A board page as its route serves it: the shell around the client's mount
// point (the board itself is the client's; see BoardRoutes.test.tsx).
const BOARD_TITLES = {
  service: ["Services", "services"],
  reconciler: ["Reconciler", "reconciler"],
  infrastructure: ["Infrastructure", "infrastructure"],
} as const;
const board = (group: "service" | "reconciler" | "infrastructure", shell: ShellData = testShell()) =>
  renderClientPage(BOARD_TITLES[group][0], BOARD_TITLES[group][1], shell);

const pages = (): Record<string, string> => ({
  list: list(),
  detail: renderSiteDetail(SITES[0], DETAIL_OPTS, testShell({ current: { site: SITES[0].hostname } })),
  add: renderAddSite(SITES, "lychee.land", PORT_OWNERS, PATHS, testShell({ current: null })),
  notFound: renderSiteNotFound("nope.lychee.land", testShell()),
  services: board("service"),
  reconciler: board("reconciler"),
  infrastructure: board("infrastructure"),
});

const RAIL = /<aside id="rail"[\s\S]*?<\/aside>/;
const TOP_BAR = /<header id="top-bar"[\s\S]*?<\/header>/;

describe("the rail shell", () => {
  test("every page renders the rail and the narrow-screen top bar", () => {
    for (const [name, html] of Object.entries(pages())) {
      assert.match(html, RAIL, name);
      assert.match(html, TOP_BAR, name);
    }
  });

  test("no page carries the header band or the hostname dropdown", () => {
    for (const [name, html] of Object.entries(pages())) {
      assert.doesNotMatch(html, /id="site-header"/, name);
      assert.doesNotMatch(html, RETIRED_SWITCHER, name);
    }
  });

  test("every page carries the rail's data for the island, as a sibling right after the aside", () => {
    for (const [name, html] of Object.entries(pages())) {
      assert.match(html, /<\/aside>\s*<script type="application\/json" id="rail-data">/, name);
      const aside = html.match(RAIL)?.[0] ?? "";
      assert.doesNotMatch(aside, /rail-data/, `${name}: the data is inside the aside`);
    }
  });

  test("the rail is the shell's, so it carries whatever the page's shell marks current", () => {
    const html = renderSiteDetail(SITES[0], DETAIL_OPTS, testShell({ current: { site: "broken.lychee.land" } }));
    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map((m) => m[0].match(/href="([^"]+)"/)?.[1]);
    assert.deepEqual(current, ["/sites/broken.lychee.land"]);
  });

  test("lays the rail and the content out as two columns from 900px", () => {
    const html = list();
    assert.match(html, /<body class="[^"]*min-\[900px\]:grid min-\[900px\]:grid-cols-\[250px_minmax\(0,1fr\)\]/);
    assert.match(html.match(RAIL)?.[0] ?? "", /^<aside id="rail" data-rail[^>]*class="hidden min-\[900px\]:flex[^"]*"/);
  });

  test("below 900px the top bar carries the wordmark and the menu button, and hides from 900px", () => {
    const bar = list().match(TOP_BAR)?.[0] ?? "";
    assert.match(bar, /^<header id="top-bar" class="min-\[900px\]:hidden /);
    assert.match(bar, /aria-label="lychee-admin"/);
    assert.match(bar, /<button type="button" id="rail-menu" aria-label="Open navigation"/);
  });

  test("keeps today's 1080px content column", () => {
    assert.match(withoutShell(list()), /<main class="max-w-\[1080px\] mx-auto /);
  });

  test("the flash toast stays fixed and centred, and the page notice in flow", () => {
    const html = renderSiteList(SITES, {}, "lychee.land", undefined, "Removed x", [], testShell());
    assert.match(html, /id="flash-banner"[^>]*fixed[^"]*left-1\/2/);
    assert.match(html, /<main[\s\S]*id="page-notice"/);
  });
});

describe("the client bundle", () => {
  const ASSETS = { script: "assets/main-abc.js", styles: ["assets/main-def.css"] };

  test("loads on every page whose shell has it, once each", () => {
    for (const [name, html] of Object.entries({
      list: list(testShell({ assets: ASSETS })),
      services: board("service", testShell({ assets: ASSETS })),
      notFound: renderSiteNotFound("nope.lychee.land", testShell({ assets: ASSETS })),
    })) {
      assert.equal(html.split('<script type="module" src="/client/assets/main-abc.js"></script>').length - 1, 1, name);
      assert.equal(html.split('<link rel="stylesheet" href="/client/assets/main-def.css" />').length - 1, 1, name);
    }
  });

  test("comes before the shell's own scripts", () => {
    const html = list(testShell({ assets: ASSETS }));
    assert.ok(html.indexOf("/client/assets/main-abc.js") < html.indexOf('src="/app.js"'));
  });

  test("is absent when the bundle is not built, leaving the rail as plain links", () => {
    const html = list(testShell({ assets: null }));
    assert.doesNotMatch(html, /\/client\//);
    assert.match(html, RAIL);
  });
});

describe("the flash toast", () => {
  test("carries a hidden action button, so a failure can offer its own recovery", () => {
    const html = list();
    const toast = html.match(/<div id="flash-banner"[\s\S]*?<\/div>/)?.[0] ?? "";
    const action = toast.match(/<button[^>]*id="flash-banner-action"[^>]*>/)?.[0];
    assert.ok(action, "no #flash-banner-action in the toast");
    assert.match(action, /type="button"/);
    assert.match(action, /\bhidden\b/);
    assert.ok(toast.indexOf("flash-banner-action") < toast.indexOf("flash-banner-close"), "the action precedes Dismiss");
  });
});

describe("the add-site page", () => {
  const add = () => renderAddSite(SITES, "lychee.land", PORT_OWNERS, PATHS, testShell({ current: null }));

  test("renders the fields that used to live in the dialog", () => {
    const html = add();
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
    assert.match(add(), /action="\/sites"/);
  });

  test("the list page no longer carries the dialog", () => {
    const html = list();
    assert.doesNotMatch(html, /add-site-dialog/);
    assert.doesNotMatch(html, /id="add-site-form"/);
  });

  test("the list page with sites links Add site from its own section header, as a page", () => {
    const body = withoutShell(list());
    assert.match(body, /href="\/sites\/new"/);
    assert.doesNotMatch(body, /data-open-dialog="add-site-dialog"/);
  });
});

describe("the shell's h1", () => {
  // Every page gets its h1 from the shell: the wordmark, once in the rail and
  // once in the narrow-screen top bar. The two are never displayed together
  // (the rail shows from 900px, the bar below it), which the client's
  // per-width visibility test checks; here, the markup carries exactly those two.
  const countH1 = (html: string) => (html.match(/<h1[\s>]/g) ?? []).length;

  test("renders exactly two on every page, one in the rail and one in the top bar", () => {
    for (const [name, html] of Object.entries(pages())) {
      assert.equal(countH1(html), 2, name);
      assert.equal(countH1(html.match(RAIL)?.[0] ?? ""), 1, `${name}: rail`);
      assert.equal(countH1(html.match(TOP_BAR)?.[0] ?? ""), 1, `${name}: top bar`);
      assert.equal(countH1(withoutShell(html)), 0, `${name}: the body has its own h1`);
    }
  });

  test("wraps the wordmark home link, inside the rail", () => {
    const rail = list().match(RAIL)?.[0] ?? "";
    assert.match(rail, /<h1[^>]*>\s*<a href="\/"[^>]*>lychee<span [^>]*>admin<\/span><\/a>\s*<\/h1>/);
  });
});
