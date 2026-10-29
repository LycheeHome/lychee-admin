import assert from "node:assert/strict";
import { test } from "node:test";
import { dayKey, dayLabel, filtersFromSearch, hasFilters, searchFromFilters } from "./activityPageModel";

const iso = (y: number, m: number, d: number, h: number, mi: number) => new Date(y, m, d, h, mi).toISOString();
const now = new Date(2026, 9, 28, 23, 31);

test("filtersFromSearch and searchFromFilters round-trip, dropping empties", () => {
  const f = filtersFromSearch(new URLSearchParams("kind=deploy&subject=a.lychee.land&who="));
  assert.deepEqual(f, { subject: "a.lychee.land", who: null, kind: "deploy" });
  assert.equal(searchFromFilters(f), "?subject=a.lychee.land&kind=deploy");
  assert.equal(searchFromFilters({ subject: null, who: null, kind: null }), "");
  assert.equal(hasFilters(f), true);
  assert.equal(hasFilters({ subject: null, who: null, kind: null }), false);
});

test("unknown kind survives as given", () => {
  assert.equal(filtersFromSearch(new URLSearchParams("?kind=deploys")).kind, "deploys");
});

test("dayLabel", () => {
  assert.equal(dayLabel(iso(2026, 9, 28, 23, 18), now), "today · wed 28 oct");
  assert.equal(dayLabel(iso(2026, 9, 28, 0, 5), now), "today · wed 28 oct");
  assert.equal(dayLabel(iso(2026, 9, 27, 23, 59), now), "yesterday · tue 27 oct");
  assert.equal(dayLabel(iso(2026, 9, 26, 12, 0), now), "mon 26 oct");
  assert.equal(dayLabel(iso(2025, 11, 25, 12, 0), now), "thu 25 dec 2025");
});

test("dayKey is the local day", () => {
  assert.equal(dayKey(iso(2026, 9, 28, 0, 5)), "2026-10-28");
  assert.notEqual(dayKey(iso(2026, 9, 28, 0, 5)), dayKey(iso(2026, 9, 27, 23, 59)));
});
