import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { renderRail, renderRailData, renderTopBar } from "./rail";
import { BUTTON_PRIMARY } from "./shared";
import { RAIL_DOT, RAIL_FIND, RAIL_MENU } from "./railModel";
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

  // Add site lives on the sites page, not in the rail: the rail is navigation
  // only, so /sites/new has no rail item to mark and its breadcrumb carries
  // the location, as a site page's does.
  test("carries no Add site link", () => {
    assert.doesNotMatch(rail(), /href="\/sites\/new"/);
    assert.doesNotMatch(rail(), /Add site/);
  });

  test("the add-site page marks nothing", () => {
    assert.deepEqual(currentHrefs(rail({ current: null })), []);
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

  test("the island's data is a JSON script that round-trips the rail and never closes early", () => {
    const data: RailData = { ...testShell().rail, sites: [{ hostname: "</script><b>x</b>.lychee.land", hint: "static" }] };
    const html = renderRailData(data);
    const m = html.match(/^<script type="application\/json" id="rail-data">([\s\S]*)<\/script>$/);
    assert.ok(m, html);
    assert.ok(!m[1].includes("<"), "an unescaped < reached the script body");
    assert.deepEqual(JSON.parse(m[1]), data);
  });

  // `overflow-wrap: anywhere`, never `break-all`: a hostname that fits (as
  // preview.lychee.land does) must not be split mid-word, and only one that
  // cannot fit, such as a 63-character label, breaks where it has to.
  test("a long hostname wraps inside the rail instead of overflowing it, and only when it cannot fit", () => {
    const long = `${"a".repeat(63)}.lychee.land`;
    const html = rail({ sites: [{ hostname: long, hint: "static" }] });
    const row = html.match(/<a [^>]*data-site="a+\.lychee\.land"[^>]*>[\s\S]*?<\/a>/)?.[0] ?? "";
    assert.match(row, /<span class="min-w-0 \[overflow-wrap:anywhere\]"><span class="text-stone-50">a{63}<\/span>/);
    assert.doesNotMatch(rail(), /break-all/);
  });

  test("a hostname's first break is before its domain suffix, never mid-word", () => {
    assert.match(rail(), /<span class="text-stone-50">preview<\/span><wbr>\.lychee\.land<\/span>/);
  });

  test("the hostname's label is Chalk and the shared suffix is not", () => {
    const html = rail();
    assert.match(html, /<span class="text-stone-50">api<\/span><wbr>\.lychee\.land/);
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

  // The rail is on every page, so an Ember button there would compete with each
  // page's own primary (Visit, a Deploy offer, the add form's submit).
  test("spends no Ember", () => {
    const html = rail();
    assert.ok(!html.includes(BUTTON_PRIMARY), "the rail carries BUTTON_PRIMARY");
    assert.doesNotMatch(html, /\bbg-rose-400\b/);
  });

  test("the find box and the menu button carry their shared class strings", () => {
    assert.ok(rail().includes(`<input id="find" type="text" autocomplete="off" spellcheck="false" placeholder="find" aria-label="Find a site or unit" role="combobox" aria-expanded="false" aria-controls="find-list" aria-autocomplete="list" class="${RAIL_FIND}" />`));
    assert.ok(renderTopBar().includes(`id="rail-menu" aria-label="Open navigation" aria-haspopup="dialog" class="${RAIL_MENU}"`));
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

describe("renderTopBar", () => {
  const bar = renderTopBar();

  // Below 900px the rail's h1 is hidden with the rail, so the bar's wordmark
  // is the page's heading there; from 900px the bar is hidden instead.
  test("carries the wordmark as an h1, at the rail's Display size", () => {
    assert.match(bar, /<h1 class="m-0 text-base font-normal leading-none"><a href="\/" aria-label="lychee-admin" class="font-display text-2xl[^"]*">lychee<span class="font-mono[^"]*">admin<\/span><\/a><\/h1>/);
  });

  test("carries an empty overall count slot, a find button and the menu button, in that order", () => {
    const right = bar.match(/<\/h1>([\s\S]*)<\/header>/)?.[1] ?? "";
    const order = [...right.matchAll(/data-count="all"|id="rail-find"|id="rail-menu"/g)].map((m) => m[0]);
    assert.deepEqual(order, ['data-count="all"', 'id="rail-find"', 'id="rail-menu"']);
    assert.match(right, /<span data-count="all"><\/span>/);
    assert.ok(right.includes(`<button type="button" id="rail-find" aria-label="Find a site or unit" class="${RAIL_MENU}">`));
    assert.ok(right.includes(`<button type="button" id="rail-menu" aria-label="Open navigation" aria-haspopup="dialog" class="${RAIL_MENU}">`));
  });
});
