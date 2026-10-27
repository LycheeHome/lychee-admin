import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Site } from "../lib/caddyfile";
import type { BoardRow, ServiceBoard } from "../shared/board";
import type { ActionState } from "../lib/hostOperations";
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
  // The rail dot and find read this: a neutral dot (the same Smoke as not
  // deployed), the word for screen readers and find, and never an attention count.
  test("retired is neutral, labelled retired, and never attention", () => {
    assert.deepEqual(siteHealth(proxy, { kind: "retired" }), {
      hostname: "api.lychee.land", tone: "neutral", label: "retired", attention: false,
    });
  });
});

const SHOWN = { prunable: new Set<string>(), retiring: new Set<string>(), domain: "lychee.land", run: undefined };

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
  // The rail's count for a board page and that board's summary line must
  // name the same rows (critique 2026-10-27 P1), so a unit reads its row the
  // way the board does: a container with nothing installed by the
  // reconciler's verdict, a moving pin as applying.
  test("a container with nothing installed reads the reconciler's verdict, as its board row does", () => {
    const h = unitHealth(row({ name: "broken-lychee-land", kind: "container", status: "unknown", result: "failed", target: "0.1.0" }), "service");
    assert.deepEqual([h.label, h.tone, h.trouble, h.attention], ["failed", "bad", null, true]);
  });
  test("a moving pin reads applying, neutral, as its board row does", () => {
    const h = unitHealth(row({ version: "1.0.0", target: "1.1.0", result: "deployed" }), "service");
    assert.deepEqual([h.label, h.tone, h.attention], ["applying", "neutral", false]);
  });
  // Review 2026-10-27: what the board layers over the verdict, the rail reads too.
  test("a running host action reads its word, neutral, as its board row does", () => {
    const run = { action: "restart", state: "running", startedAt: "2026-10-27T00:00:00Z", unit: "palworld.service", logTail: "" } as ActionState;
    const h = unitHealth(row({ name: "palworld", status: "exited" }), "service", null, { ...SHOWN, run });
    assert.deepEqual([h.tone, h.attention], ["neutral", false]);
    assert.notEqual(h.label, "unknown");
  });
  test("a retired site row confirmed down reads retired, as its board row does", () => {
    const h = unitHealth(row({ name: "gone-lychee-land", kind: "container", status: "unknown" }), "service", "gone.lychee.land", {
      ...SHOWN,
      prunable: new Set(["gone-lychee-land"]),
    });
    assert.deepEqual([h.label, h.tone, h.attention], ["retired", "neutral", false]);
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

  // A board page's count includes its site rows, as the page does; each is
  // marked with its site, so the overall count still takes it once.
  test("a site's container is a unit marked with its site", () => {
    const h = buildHealth([broken], {}, board(true), "lychee.land", new Date(0));
    assert.deepEqual(h.units?.map((u) => [u.name, u.site]), [["swee", null], ["broken-lychee-land", "broken.lychee.land"]]);
    assert.equal(h.now, "1970-01-01T00:00:00.000Z");
  });
  test("a container named like a site the Caddyfile lacks is a plain unit", () => {
    const h = buildHealth([], {}, board(true), "lychee.land", new Date(0));
    assert.deepEqual(h.units?.map((u) => u.site), [null, null]);
  });
  test("units are null when the inventory is unavailable", () => {
    assert.equal(buildHealth([broken], {}, board(false), "lychee.land", new Date(0)).units, null);
  });
});

describe("attentionCounts", () => {
  test("null per group when units is null; the total is the sites alone", () => {
    const h = { sites: [{ hostname: "a", tone: "bad" as const, label: "failed", attention: true }], units: null, now: "" };
    assert.deepEqual(attentionCounts(h, ["a"]), {
      sites: { bad: 1, unknown: 0 },
      service: null,
      reconciler: null,
      infrastructure: null,
      total: { bad: 1, unknown: 0 },
    });
  });
  // Each page's count is what that page shows, so a site's container counts
  // under sites and on its board; the total counts each thing once, as its site.
  // Review 2026-10-27: a site that reads healthy while its container's deploy
  // is blocked is one thing needing attention, so the total counts it once.
  test("a healthy site whose container's deploy is blocked counts once in the total", () => {
    const blocked = { ...unitHealth(row({ name: "app-lychee-land", result: "blocked", gateCode: "ci-failed" }), "service"), site: "app.lychee.land" };
    assert.equal(blocked.attention, true);
    const h = {
      sites: [{ hostname: "app.lychee.land", tone: "ok" as const, label: "running", attention: false }],
      units: [blocked],
      now: "",
    };
    assert.deepEqual(attentionCounts(h, ["app.lychee.land"]).total, { bad: 1, unknown: 0 });
  });
  test("a site's container counts on its board page and once in the total", () => {
    const broken = { ...unitHealth(row({ name: "broken-lychee-land", status: "exited" }), "service"), site: "broken.lychee.land" };
    const h = {
      sites: [{ hostname: "broken.lychee.land", tone: "bad" as const, label: "failed", attention: true }],
      units: [broken, unitHealth(row({ status: "unknown" }), "service")],
      now: "",
    };
    const c = attentionCounts(h, ["broken.lychee.land"]);
    assert.deepEqual(c.sites, { bad: 1, unknown: 0 });
    assert.deepEqual(c.service, { bad: 1, unknown: 1 });
    assert.deepEqual(c.total, { bad: 1, unknown: 1 });
  });
  test("sites the rail does not list are not counted", () => {
    const bad = { tone: "bad" as const, label: "failed", attention: true };
    const h = { sites: [{ hostname: "a", ...bad }, { hostname: "new", ...bad }], units: null, now: "" };
    assert.deepEqual(attentionCounts(h, ["a", "b"]).sites, { bad: 1, unknown: 0 });
  });
  test("counts per group", () => {
    const u = unitHealth(row({ status: "exited" }), "service");
    const h = { sites: [], units: [u, unitHealth(row({}), "service")], now: "" };
    assert.deepEqual(attentionCounts(h, []), {
      sites: { bad: 0, unknown: 0 },
      service: { bad: 1, unknown: 0 },
      reconciler: { bad: 0, unknown: 0 },
      infrastructure: { bad: 0, unknown: 0 },
      total: { bad: 1, unknown: 0 },
    });
  });
  // Critique 2026-10-26 P1, variant 03: a unit or site whose state could not be
  // read is counted, apart from what is bad, so the rail never prints a 0 over it.
  // The current row's ground is stone-700, the neutral chip's own fill: without
  // an edge the chip vanished there and read as plain text. An inset ring keeps
  // the Scorch chip's size.
  test("the unknown chip keeps an edge on any row, current included", () => {
    const classes = railModel.RAIL_COUNT_UNKNOWN.split(" ");
    assert.ok(classes.includes("ring-1") && classes.includes("ring-inset"), railModel.RAIL_COUNT_UNKNOWN);
    assert.ok(classes.some((c) => c.startsWith("ring-stone-")), "the ring has no colour");
    assert.ok(!classes.some((c) => c.startsWith("border")), "a border would change the chip's size");
  });

  test("an unreadable unit or site is counted as unknown, apart from what is bad", () => {
    const unknownUnit = unitHealth(row({ status: "unknown" }), "reconciler");
    assert.equal(unknownUnit.label, "unknown");
    const h = {
      sites: [{ hostname: "a", tone: "neutral" as const, label: "unknown", attention: false }],
      units: [unknownUnit, unitHealth(row({ status: "exited" }), "service"), unitHealth(row({ status: "unknown" }), "service")],
      now: "",
    };
    assert.deepEqual(attentionCounts(h, ["a"]), {
      sites: { bad: 0, unknown: 1 },
      service: { bad: 1, unknown: 1 },
      reconciler: { bad: 0, unknown: 1 },
      infrastructure: { bad: 0, unknown: 0 },
      total: { bad: 1, unknown: 3 },
    });
  });
});
