import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderRail } from "./rail";
import { BUTTON_PRIMARY } from "./shared";
import { RAIL_DOT } from "./railModel";
import { SEEDED_RAIL_SITES, testShell } from "../dev/testHelpers";
import type { RailData } from "./shell";

const rail = (overrides: Partial<RailData> = {}): string => renderRail(testShell(overrides).rail);

/** Each `<a …>…</a>` in the rail that carries `aria-current="page"`, by href. */
const currentHrefs = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\baria-current="page"[^>]*>/g)].map((m) => m[0].match(/href="([^"]+)"/)?.[1] ?? "");

describe("renderRail", () => {
  test("its root is the rail aside", () => {
    assert.match(rail(), /^\s*<aside id="rail" data-rail\b/);
    assert.match(rail(), /<\/aside>\s*$/);
  });

  test("lists the seeded sites in Caddyfile order, each linking to its page with a hollow dot", () => {
    const html = rail();
    const listed = [...html.matchAll(/data-site="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      listed,
      SEEDED_RAIL_SITES.map((s) => s.hostname),
    );
    for (const { hostname } of SEEDED_RAIL_SITES) {
      const row = html.match(new RegExp(`<a [^>]*data-site="${hostname.replace(/\./g, "\\.")}"[^>]*>[\\s\\S]*?</a>`))?.[0];
      assert.ok(row, `no row for ${hostname}`);
      assert.match(row, new RegExp(`href="/sites/${hostname.replace(/\./g, "\\.")}"`));
      assert.ok(row.includes(`<span class="${RAIL_DOT.none}" data-dot`), `${hostname}'s dot is not hollow`);
    }
  });

  test("each row carries its type hint", () => {
    const html = rail();
    assert.match(html, /data-site="blog\.lychee\.land"[\s\S]*?>static<\/span>/);
    assert.match(html, /data-site="api\.lychee\.land"[\s\S]*?>:4000<\/span>/);
  });

  test("a site page marks that row, and only that row", () => {
    assert.deepEqual(currentHrefs(rail({ current: { site: "broken.lychee.land" } })), ["/sites/broken.lychee.land"]);
  });

  test("the add-site page marks Add site", () => {
    assert.deepEqual(currentHrefs(rail({ current: { page: "new" } })), ["/sites/new"]);
  });

  test("the list page marks the sites heading", () => {
    assert.deepEqual(currentHrefs(rail({ current: { page: "sites" } })), ["/"]);
  });

  test("each board page marks its own link", () => {
    assert.deepEqual(currentHrefs(rail({ current: { page: "services" } })), ["/services"]);
    assert.deepEqual(currentHrefs(rail({ current: { page: "reconciler" } })), ["/reconciler"]);
    assert.deepEqual(currentHrefs(rail({ current: { page: "infrastructure" } })), ["/infrastructure"]);
  });

  test("no current page marks nothing", () => {
    assert.deepEqual(currentHrefs(rail({ current: null })), []);
  });

  test("an unreadable Caddyfile says so in place of the rows", () => {
    const html = rail({ sites: null });
    assert.match(html, /Can't read the Caddyfile/);
    assert.doesNotMatch(html, /data-site=/);
    // The heading and its count slot survive: the island still counts sites.
    assert.match(html, /data-count="sites"/);
  });

  test("a missing inventory says so, and the host links carry no counts", () => {
    const html = rail({ hostAvailable: false });
    assert.match(html, /Inventory unavailable/);
    assert.doesNotMatch(html, /data-count="(service|reconciler|infrastructure)"/);
    for (const href of ["/services", "/reconciler", "/infrastructure"]) assert.match(html, new RegExp(`href="${href}"`));
  });

  test("a readable inventory gives each host link a count slot", () => {
    const html = rail();
    assert.doesNotMatch(html, /Inventory unavailable/);
    for (const group of ["service", "reconciler", "infrastructure"]) assert.match(html, new RegExp(`data-count="${group}"`));
  });

  test("a long hostname wraps inside the rail instead of overflowing it", () => {
    const long = `${"a".repeat(63)}.lychee.land`;
    const html = rail({ sites: [{ hostname: long, hint: "static" }] });
    const row = html.match(/<a [^>]*data-site="a+\.lychee\.land"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    assert.match(row, /<span class="[^"]*\bmin-w-0 break-all\b[^"]*"><span class="text-stone-50">a{63}<\/span>/);
  });

  test("the hostname's label is Chalk and the shared suffix is not", () => {
    const html = rail();
    assert.match(html, /<span class="text-stone-50">api<\/span>\.lychee\.land/);
  });

  // Carried over from the breadcrumb dropdown the rail replaces.
  test("never truncates a hostname, and never dims a row below Smoke", () => {
    const rows = rail().match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? "";
    assert.ok(rows.includes("data-site="), "no site rows");
    assert.doesNotMatch(rows, /truncate/);
    assert.doesNotMatch(rows, /text-stone-500/);
  });

  test("carries no status: no pill, no tone word", () => {
    const html = rail();
    assert.doesNotMatch(html, /&#9679;/);
    assert.doesNotMatch(html, /running|responding|unhealthy/);
    for (const tone of ["ok", "bad", "neutral"] as const) assert.ok(!html.includes(RAIL_DOT[tone]), tone);
  });

  test("marks the current row on Hairline with the Ember Edge rule, never an ember fill", () => {
    const row = rail({ current: { site: "api.lychee.land" } }).match(/<a [^>]*aria-current="page"[^>]*>/)?.[0] ?? "";
    assert.match(row, /aria-\[current=page\]:bg-stone-700/);
    assert.match(row, /aria-\[current=page\]:border-l-rose-800/);
    assert.doesNotMatch(row, /bg-rose-950/);
  });

  test("every link carries the focus ring", () => {
    for (const tag of rail().match(/<a\b[^>]*>/g) ?? []) assert.match(tag, /focus-visible:outline-rose-400/, tag);
  });

  test("Add site is the rail's one primary action", () => {
    const html = rail();
    assert.equal(html.split(BUTTON_PRIMARY).length - 1, 1, "BUTTON_PRIMARY appears more than once");
    assert.match(html, new RegExp(`<a href="/sites/new" class="${BUTTON_PRIMARY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"[^>]*>[\\s\\S]*?Add site</a>`));
  });

  test("the find box prints the ⌘K hint", () => {
    const html = rail();
    assert.match(html, /<input id="find"[^>]*>/);
    assert.match(html, /⌘K/);
  });

  test("carries the wordmark as the page's h1, at its documented Display size", () => {
    const html = rail();
    assert.match(html, /<h1[^>]*>\s*<a href="\/" aria-label="lychee-admin" class="font-display text-2xl[^"]*">lychee<span class="font-mono[^"]*">admin<\/span><\/a>\s*<\/h1>/);
    assert.doesNotMatch(html, /font-display[^"]*font-(semibold|bold)/);
  });

  test("escapes hostnames", () => {
    const html = rail({ sites: [{ hostname: `x"><b>.lychee.land`, hint: "static" }] });
    assert.ok(!html.includes(`"><b>`));
  });
});
