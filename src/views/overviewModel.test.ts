import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { HealthPayload, SiteHealth, UnitHealth } from "../shared/health";
import { attentionRows, overviewCounts, overviewSignal, stripCells } from "./overviewModel";

const NOW = new Date("2026-10-28T12:00:00Z");

const okSite = (hostname: string): SiteHealth => ({ hostname, tone: "ok", label: "running", attention: false });
const unit = (name: string, group: UnitHealth["group"], over: Partial<UnitHealth> = {}): UnitHealth => ({
  name, group, tone: "ok", label: "running", trouble: null, href: `/${group}s#service-${name}`, attention: false, site: null, ...over,
});
function payload(o: { sites?: SiteHealth[]; units?: UnitHealth[] | null; generated?: string | null }): HealthPayload {
  const units = o.units === undefined ? [] : o.units;
  return {
    sites: o.sites ?? [],
    units,
    generated: o.generated === undefined ? (units ? "2026-10-28T11:55:00Z" : null) : o.generated,
    now: NOW.toISOString(),
  };
}

const mixed = (): HealthPayload =>
  payload({
    sites: [
      okSite("a.lychee.land"),
      { hostname: "b.lychee.land", tone: "bad", label: "not responding", attention: true },
      { hostname: "c.lychee.land", tone: "neutral", label: "unknown", attention: false },
    ],
    units: [
      unit("swee", "service", { tone: "bad", label: "exited", attention: true }),
      unit("a-lychee-land", "service", { site: "a.lychee.land", tone: "bad", label: "running", trouble: "blocked", attention: true }),
      unit("timer", "reconciler", { tone: "neutral", label: "unknown" }),
      unit("caddy", "infrastructure"),
    ],
  });

describe("stripCells", () => {
  test("all clear: totals and all clear, last tick on the reconciler cell", () => {
    const h = payload({
      sites: [okSite("a.lychee.land"), okSite("b.lychee.land")],
      units: [unit("x", "service"), unit("y", "service"), unit("z", "infrastructure")],
    });
    const cells = stripCells(h, false, NOW);
    assert.deepEqual(cells.map((c) => c.page), ["sites", "services", "reconciler", "infrastructure"]);
    assert.deepEqual(cells.map((c) => c.href), ["/sites", "/services", "/reconciler", "/infrastructure"]);
    assert.equal(cells[0].total, "2 sites");
    assert.equal(cells[0].note, "all clear");
    assert.equal(cells[1].total, "2 units");
    assert.equal(cells[1].note, "all clear");
    assert.equal(cells[2].total, "0 units");
    assert.match(cells[2].note ?? "", /^last tick /);
    assert.equal(cells[3].note, "all clear");
  });
  test("bad and unknown chips come from the shared count", () => {
    const h = mixed();
    const c = overviewCounts(h);
    const cells = stripCells(h, false, NOW);
    assert.deepEqual([cells[0].bad, cells[0].unknown], [c.sites.bad, c.sites.unknown]);
    assert.deepEqual([cells[1].bad, cells[1].unknown], [c.service!.bad, c.service!.unknown]);
    assert.deepEqual([cells[2].bad, cells[2].unknown], [c.reconciler!.bad, c.reconciler!.unknown]);
    assert.deepEqual([cells[3].bad, cells[3].unknown], [c.infrastructure!.bad, c.infrastructure!.unknown]);
    assert.equal(cells[0].note, null);
  });
  test("no inventory: the unit cells say so", () => {
    const cells = stripCells(payload({ sites: [okSite("a.lychee.land")], units: null }), false, NOW);
    assert.equal(cells[0].total, "1 site");
    for (const c of cells.slice(1)) {
      assert.equal(c.total, null);
      assert.equal(c.note, "inventory unavailable");
      assert.deepEqual([c.bad, c.unknown], [0, 0]);
    }
  });
  test("a failed poll drops every count", () => {
    for (const h of [mixed(), null]) {
      for (const c of stripCells(h, true, NOW)) {
        assert.equal(c.total, null);
        assert.deepEqual([c.bad, c.unknown], [0, 0]);
        assert.equal(c.note, null);
      }
    }
  });
  test("before the first data every cell is empty", () => {
    for (const c of stripCells(null, false, NOW)) assert.equal(c.total, null);
  });
  test("singular nouns", () => {
    const cells = stripCells(payload({ sites: [okSite("a.lychee.land")], units: [unit("x", "service")] }), false, NOW);
    assert.equal(cells[0].total, "1 site");
    assert.equal(cells[1].total, "1 unit");
  });
});

describe("attentionRows", () => {
  test("a site and its blocked container are one bad row, worded by the container", () => {
    const h = payload({
      sites: [okSite("app.lychee.land")],
      units: [unit("app-lychee-land", "service", { site: "app.lychee.land", tone: "neutral", trouble: "blocked", attention: true })],
    });
    const { bad, unknown } = attentionRows(h);
    assert.deepEqual(bad, [
      { subject: "app.lychee.land", word: "deploy blocked", where: "sites", href: "/sites/app.lychee.land", tone: "bad" },
    ]);
    assert.deepEqual(unknown, []);
  });
  test("a site that is itself bad reads its own label", () => {
    const { bad } = attentionRows(mixed());
    assert.equal(bad.find((r) => r.subject === "b.lychee.land")?.word, "not responding");
  });
  test("rows count exactly what the total counts", () => {
    const h = mixed();
    const rows = attentionRows(h);
    assert.equal(rows.bad.length, overviewCounts(h).total.bad);
    assert.equal(rows.unknown.length, overviewCounts(h).total.unknown);
    assert.ok(rows.unknown.every((r) => r.tone === "neutral"));
  });
  test("rows keep payload order, sites before plain units", () => {
    const { bad, unknown } = attentionRows(mixed());
    assert.deepEqual(bad.map((r) => r.subject), ["a.lychee.land", "b.lychee.land", "swee"]);
    assert.deepEqual(unknown.map((r) => r.subject), ["c.lychee.land", "timer"]);
  });
  test("a plain unit's where is its page", () => {
    const { unknown, bad } = attentionRows(mixed());
    assert.equal(unknown.find((r) => r.subject === "timer")?.where, "reconciler");
    const swee = bad.find((r) => r.subject === "swee")!;
    assert.equal(swee.where, "services");
    assert.equal(swee.href, "/services#service-swee");
  });
});

describe("overviewSignal", () => {
  test("pending and clean give null", () => {
    assert.equal(overviewSignal(null, false), null);
    assert.equal(overviewSignal(payload({ sites: [okSite("a.lychee.land")] }), false), null);
  });
  test("a failed poll", () => {
    assert.deepEqual(overviewSignal(null, true), { tone: "neutral", count: null, spoken: ", health unavailable" });
  });
  test("bad count wins and is not summed with unknown", () => {
    const h = payload({
      units: [
        ...[1, 2, 3, 4, 5].map((i) => unit(`b${i}`, "service", { tone: "bad", attention: true })),
        ...[1, 2, 3].map((i) => unit(`u${i}`, "service", { tone: "neutral", label: "unknown" })),
      ],
    });
    assert.deepEqual(overviewSignal(h, false), { tone: "bad", count: 5, spoken: ", 5 need attention" });
  });
  test("one bad reads needs", () => {
    const h = payload({ units: [unit("b", "service", { tone: "bad", attention: true })] });
    assert.equal(overviewSignal(h, false)?.spoken, ", 1 needs attention");
  });
  test("unknown only is neutral", () => {
    const h = payload({ units: [1, 2, 3].map((i) => unit(`u${i}`, "service", { tone: "neutral", label: "unknown" })) });
    assert.deepEqual(overviewSignal(h, false), { tone: "neutral", count: 3, spoken: ", 3 couldn't be read" });
  });
});
