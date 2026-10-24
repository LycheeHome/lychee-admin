import "../dev/env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseSites } from "../lib/caddyfile";
import { SEED_CADDYFILE } from "../dev/seed";
import { testShell } from "../dev/testHelpers";
import { renderClientPage } from "./clientShell";
import { renderRail, renderTopBar } from "./rail";
import { addedNotice } from "./siteDetailModel";
import { ADD_SITE_TITLE, SITES_HEADING_TEXT } from "./siteListModel";
import { GROUP_LABELS } from "./boardRowModel";
import type { RailData } from "./shell";

// The server shell's and rail's output, frozen before the static shell
// replaces them. Each fixture is the live renderer's output today; the file
// is deleted with the renderers.

const FIXTURES = path.join(__dirname, "..", "dev", "fixtures");
const read = (dir: string, name: string): string => {
  read.seen.add(`${dir}/${name}.html`);
  return fs.readFileSync(path.join(FIXTURES, dir, `${name}.html`), "utf8");
};
read.seen = new Set<string>();

const sites = parseSites(SEED_CADDYFILE);
const site = (h: string) => sites.find((s) => s.hostname === h)!;

/** layout()'s body from just after `<body ...>` up to the React mount point. */
function body(html: string): string {
  const afterOpen = html.indexOf(">", html.indexOf("<body")) + 1;
  return html.slice(afterOpen, html.indexOf('<div id="react-root">')).replace(/^\n/, "");
}

type Page = Parameters<typeof renderClientPage>[1];
const shell = (title: string, p: Page, overrides: Partial<RailData>, banner?: { message: string }): string =>
  body(renderClientPage(title, p, testShell(overrides), banner));

const removed = "Removed blog.lychee.land. Remember to remove the DNS record in Cloudflare manually.";

const SHELL_CASES: Record<string, () => string> = {
  sites: () => shell(SITES_HEADING_TEXT, "sites", { current: { page: "sites" } }),
  "sites-removed": () => shell(SITES_HEADING_TEXT, "sites", { current: { page: "sites" } }, { message: removed }),
  services: () => shell(GROUP_LABELS.service, "services", { current: { page: "services" } }),
  reconciler: () => shell(GROUP_LABELS.reconciler, "reconciler", { current: { page: "reconciler" } }),
  infrastructure: () => shell(GROUP_LABELS.infrastructure, "infrastructure", { current: { page: "infrastructure" } }),
  "site-static": () => shell("blog.lychee.land", "site", { current: { site: "blog.lychee.land" } }),
  "site-static-created": () =>
    shell("blog.lychee.land", "site", { current: { site: "blog.lychee.land" } }, { message: addedNotice(site("blog.lychee.land")) }),
  "site-next-created": () =>
    shell("app.lychee.land", "site", { current: { site: "app.lychee.land" } }, { message: addedNotice(site("app.lychee.land")) }),
  "add-site": () => shell(ADD_SITE_TITLE, "add-site", { current: null }),
  "site-unknown": () => shell("Site not found", "site", { current: null }),
  "caddyfile-unreadable": () => shell(SITES_HEADING_TEXT, "sites", { current: { page: "sites" }, sites: null }),
  "inventory-unavailable": () =>
    shell(GROUP_LABELS.service, "services", { current: { page: "services" }, hostAvailable: false }),
};

const RAIL_CASES: Record<string, Partial<RailData>> = {
  "seeded-sites": {},
  "unreadable-caddyfile": { sites: null },
  "missing-inventory": { hostAvailable: false },
  "current-page-sites": { current: { page: "sites" } },
  "current-page-services": { current: { page: "services" } },
  "current-page-reconciler": { current: { page: "reconciler" } },
  "current-page-infrastructure": { current: { page: "infrastructure" } },
  "current-site-api": { current: { site: "api.lychee.land" } },
  "current-site-broken": { current: { site: "broken.lychee.land" } },
  "no-current": { current: null },
  "long-hostname": { sites: [{ hostname: `${"a".repeat(63)}.lychee.land`, hint: "static" }] },
  "escaped-hostname": { sites: [{ hostname: `x"><b>.lychee.land`, hint: "static" }] },
};

describe("the frozen server shell", () => {
  for (const [name, live] of Object.entries(SHELL_CASES)) {
    test(name, () => {
      assert.ok(read("shell", name) === live(), `${name} no longer equals the live shell`);
    });
  }

  test("every page's mount point is the empty #app-root", () => {
    for (const name of Object.keys(SHELL_CASES)) {
      assert.match(read("shell", name), /<div id="app-root" class="contents" data-page="[a-z-]+"><\/div>\s*<\/main>/);
    }
  });
});

describe("the frozen server rail", () => {
  for (const [name, overrides] of Object.entries(RAIL_CASES)) {
    test(name, () => {
      assert.ok(read("rail", name) === renderRail(testShell(overrides).rail), `${name} no longer equals renderRail`);
    });
  }

  test("top-bar", () => {
    assert.ok(read("rail", "top-bar") === renderTopBar());
  });
});

// Last: node runs a file's tests in order, so every read has happened by now.
test("every fixture file is read", () => {
  const onDisk = ["shell", "rail"].flatMap((dir) =>
    fs.readdirSync(path.join(FIXTURES, dir)).map((f) => `${dir}/${f}`),
  );
  assert.deepEqual(onDisk.filter((f) => !read.seen.has(f)).sort(), []);
});
