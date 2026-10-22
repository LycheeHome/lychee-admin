import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import type { BoardRow, ServiceBoard } from "../shared/board";
import * as railModel from "./railModel";
import { attentionCounts, buildHealth, siteHealth, unitHealth } from "./railModel";

// DESIGN.md's Dim-Text Rule: Smoke Deep (stone-500) is readable only at
// Headline size, and every rail string is far smaller. A disabled control is
// the rule's one exemption, so only the plain utility is refused, not
// `aria-disabled:` or `disabled:` variants of it.
describe("rail text clears the Dim-Text Rule", () => {
  test("no RAIL_* class string sets plain Smoke Deep text", () => {
    for (const [name, value] of Object.entries(railModel)) {
      if (!name.startsWith("RAIL_") || typeof value !== "string") continue;
      assert.doesNotMatch(value, /(^|\s)text-stone-500(\s|$)/, name);
    }
  });
});

const staticSite: Site = { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" };
const proxy: Site = { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" };

function row(over: Record<string, unknown>): BoardRow {
  return { name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true, status: "running", since: null, ...over } as BoardRow;
}

describe("siteHealth", () => {
  test("a static site is hollow and never needs attention", () => {
    assert.deepEqual(siteHealth(staticSite, undefined), { hostname: "blog.lychee.land", tone: "none", label: "", attention: false });
  });
  test("a proxy that does not respond is bad", () => {
    assert.deepEqual(siteHealth(proxy, { kind: "tcp", responding: false }), {
      hostname: "api.lychee.land", tone: "bad", label: "not responding", attention: true,
    });
  });
  test("awaiting image is neutral, not attention", () => {
    const h = siteHealth(proxy, { kind: "awaiting-image" });
    assert.equal(h.tone, "neutral");
    assert.equal(h.attention, false);
  });
});

describe("unitHealth", () => {
  test("a running row with a blocked deploy counts", () => {
    const h = unitHealth(row({ result: "blocked", gateCode: "ci-failed" }), "service");
    assert.equal(h.tone, "ok");
    assert.equal(h.trouble, "blocked");
    assert.equal(h.attention, true);
  });
  test("a merely waiting row does not", () => {
    const h = unitHealth(row({ result: "blocked", gateCode: "ci-pending" }), "service");
    assert.equal(h.trouble, null);
    assert.equal(h.attention, false);
  });
  test("a failed run counts", () => {
    assert.equal(unitHealth(row({ result: "failed" }), "service").trouble, "failed");
  });
  test("a bad tone counts without trouble", () => {
    const h = unitHealth(row({ status: "exited" }), "service");
    assert.deepEqual([h.tone, h.trouble, h.attention], ["bad", null, true]);
  });
  test("hrefs follow the group", () => {
    assert.equal(unitHealth(row({}), "service").href, "/services#service-swee");
    assert.equal(unitHealth(row({ name: "lychee-watch-timer" }), "reconciler").href, "/reconciler#service-lychee-watch-timer");
    assert.equal(unitHealth(row({ name: "caddy" }), "infrastructure").href, "/infrastructure#service-caddy");
  });
});

describe("buildHealth", () => {
  const board = (available: boolean): ServiceBoard => ({
    groups: [{ group: "service", rows: [row({}), row({ name: "broken-lychee-land", kind: "container" })] }],
    schedule: { next: null, last: null },
    timerUnit: null,
    generated: null,
    inventoryAvailable: available,
  });
  const broken: Site = { hostname: "broken.lychee.land", type: "reverse-proxy", target: "3300" };

  test("a site's container is counted once, as its site", () => {
    const h = buildHealth([broken], {}, board(true), "lychee.land", new Date(0));
    assert.deepEqual(h.units?.map((u) => u.name), ["swee"]);
    assert.equal(h.now, "1970-01-01T00:00:00.000Z");
  });
  test("units are null when the inventory is unavailable", () => {
    assert.equal(buildHealth([broken], {}, board(false), "lychee.land", new Date(0)).units, null);
  });
});

describe("attentionCounts", () => {
  test("null per group when units is null", () => {
    const h = { sites: [{ hostname: "a", tone: "bad" as const, label: "failed", attention: true }], units: null, now: "" };
    assert.deepEqual(attentionCounts(h, ["a"]), { sites: 1, service: null, reconciler: null, infrastructure: null });
  });
  test("sites the rail does not list are not counted", () => {
    const bad = { tone: "bad" as const, label: "failed", attention: true };
    const h = { sites: [{ hostname: "a", ...bad }, { hostname: "new", ...bad }], units: null, now: "" };
    assert.equal(attentionCounts(h, ["a", "b"]).sites, 1);
  });
  test("counts per group", () => {
    const u = unitHealth(row({ status: "exited" }), "service");
    const h = { sites: [], units: [u, unitHealth(row({}), "service")], now: "" };
    assert.deepEqual(attentionCounts(h, []), { sites: 0, service: 1, reconciler: 0, infrastructure: 0 });
  });
});
