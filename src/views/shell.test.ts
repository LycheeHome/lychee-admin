import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import { RETIRED_SWITCHER, testShell, withoutShell } from "../dev/testHelpers";
import { renderClientPage } from "./clientShell";
import type { ShellData } from "./shell";
import { ADD_SITE_TITLE } from "./siteListModel";

const SITES: Site[] = [
  { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" },
  { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" },
  { hostname: "app.lychee.land", type: "reverse-proxy", target: "3000", framework: "nextjs" },
];

// The sites list as GET / serves it: the shell around the client's mount
// point (the list itself is the client's; see SiteListMarkup.test.tsx).
const list = (shell: ShellData = testShell({ current: { page: "sites" } })) => renderClientPage("Sites", "sites", shell);
// A board page as its route serves it: the shell around the client's mount
// point (the board itself is the client's; see BoardRoutes.test.tsx).
const BOARD_TITLES = {
  service: ["Services", "services"],
  reconciler: ["Reconciler", "reconciler"],
  infrastructure: ["Infrastructure", "infrastructure"],
} as const;
const board = (group: "service" | "reconciler" | "infrastructure", shell: ShellData = testShell()) =>
  renderClientPage(BOARD_TITLES[group][0], BOARD_TITLES[group][1], shell);
// A site's page as GET /sites/:hostname serves it, found or not: the shell
// around the client's mount point (the page is the client's; see
// SiteDetailParity.test.tsx and SiteDetailRules.test.tsx).
const site = (hostname: string, shell: ShellData = testShell({ current: { site: hostname } })) =>
  renderClientPage(hostname, "site", shell);
const notFound = (shell: ShellData = testShell()) => renderClientPage("Site not found", "site", shell);
// The add page as GET /sites/new serves it: the shell around the client's
// mount point (the page is the client's; see AddSiteMarkup.test.tsx and
// AddSiteParity.test.tsx). Nothing in the rail is current there.
const add = (shell: ShellData = testShell({ current: null })) => renderClientPage(ADD_SITE_TITLE, "add-site", shell);

const pages = (): Record<string, string> => ({
  list: list(),
  detail: site(SITES[0].hostname),
  add: add(),
  notFound: notFound(),
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
    const html = site(SITES[0].hostname, testShell({ current: { site: "broken.lychee.land" } }));
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

  // Was html.test.ts's, against the server add page; the site page's half is
  // "copy outcomes get a polite live region" below.
  test("the copy live region is on every page the shell renders, not only the site page", () => {
    for (const [name, html] of Object.entries(pages())) {
      const span = html.match(/<[a-z]+[^>]* id="copy-status"[^>]*>/)?.[0];
      assert.ok(span, `${name}: no element with id="copy-status"`);
      assert.match(span, /aria-live="polite"/, name);
    }
  });

  test("the flash toast stays fixed and centred, and the page notice in flow", () => {
    const html = renderClientPage("Sites", "sites", testShell(), { message: "Removed x" });
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
      notFound: notFound(testShell({ assets: ASSETS })),
      add: add(testShell({ current: null, assets: ASSETS })),
    })) {
      assert.equal(html.split('<script type="module" src="/client/assets/main-abc.js"></script>').length - 1, 1, name);
      assert.equal(html.split('<link rel="stylesheet" href="/client/assets/main-def.css" />').length - 1, 1, name);
    }
  });

  // public/app.js is retired: every page's behaviour is the bundle's, so the
  // bundle is the only script any page loads.
  test("is the only script a page loads, on every page", () => {
    for (const [name, html] of Object.entries({
      list: list(testShell({ assets: ASSETS })),
      add: add(testShell({ current: null, assets: ASSETS })),
      site: site(SITES[0].hostname, testShell({ current: { site: SITES[0].hostname }, assets: ASSETS })),
    })) {
      assert.deepEqual([...html.matchAll(/<script\b[^>]*\bsrc="([^"]*)"/g)].map((m) => m[1]), ["/client/assets/main-abc.js"], name);
    }
  });

  test("no page loads /app.js, built or not", () => {
    for (const [name, html] of Object.entries(pages())) assert.ok(!html.includes("/app.js"), name);
  });

  test("is absent when the bundle is not built, leaving the rail as plain links", () => {
    const html = list(testShell({ assets: null }));
    assert.doesNotMatch(html, /\/client\//);
    assert.match(html, RAIL);
  });
});

// Both were html.test.ts's, against the server site page: what they pin is
// the shell's, so they hold the shell GET /sites/:hostname serves now.
describe("the site page's shell", () => {
  test("copy outcomes get a polite live region, since the icon swap is silent", () => {
    const span = site("blog.lychee.land").match(/<[a-z]+[^>]* id="copy-status"[^>]*>/)?.[0];
    assert.ok(span, 'no element with id="copy-status" was rendered');
    assert.match(span, /role="status"/);
    assert.match(span, /aria-live="polite"/);
    assert.match(span, /class="[^"]*sr-only/);
  });

  test("the rail's current row states its port at readable contrast", () => {
    // Carried over from the breadcrumb dropdown the rail replaced: stone-400
    // on the highlighted (stone-700) row measured 3.98:1; stone-300 clears
    // 4.5:1. Anchored to the current row itself (aria-current="page"), not
    // the whole document — every other row uses the same hint span, so a
    // document-wide assertion would pass regardless of whether the current
    // row in particular carries the fix.
    const html = site("app.lychee.land");
    const currentRow = html.match(/<a[^>]*aria-current="page"[^>]*>[\s\S]*?<\/a>/);
    assert.ok(currentRow, "no current row was rendered");
    assert.match(currentRow[0], /data-site="app\.lychee\.land"/);
    assert.match(currentRow[0], /shrink-0 text-\[0\.72rem\] text-stone-300">:3200</);
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

// The add page's own form and its endpoint are the client's now:
// AddSiteMarkup.test.tsx.
describe("the add-site page", () => {
  test("is the shell around the client's mount point, with no server-rendered form", () => {
    const html = add();
    assert.match(html, /<div id="app-root" class="contents" data-page="add-site"><\/div>/);
    assert.doesNotMatch(html, /id="add-site-form"/);
    assert.doesNotMatch(html, /id="port-owners-data"/);
  });

  test("the list page no longer carries the dialog", () => {
    const html = list();
    assert.doesNotMatch(html, /add-site-dialog/);
    assert.doesNotMatch(html, /id="add-site-form"/);
  });

  // "The list page with sites links Add site from its own section header, as
  // a page" is the client list's now: SiteListMarkup.test.tsx.
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
