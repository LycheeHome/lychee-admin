import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { HealthPayload } from "../shared/health";
import { SEEDED_RAIL_SITES } from "../dev/testHelpers";
import { seedHealth } from "./test/healthFixture";
import { attentionResults, findResults, type FindGroups, type FindItem } from "./find";

const railSites = SEEDED_RAIL_SITES.map((s) => ({ ...s }));

const names = (groups: FindGroups, key: FindGroups[number]["key"]): string[] | undefined =>
  groups.find((g) => g.key === key)?.items.map((i: FindItem) => (i.kind === "site" ? i.hostname : i.name));

const keys = (groups: FindGroups): string[] => groups.map((g) => g.key);

const calm = (): HealthPayload => {
  const h = seedHealth();
  h.sites = h.sites.map((s) => ({ ...s, attention: false, tone: s.tone === "bad" ? "ok" : s.tone }));
  h.units = (h.units ?? []).map((u) => ({ ...u, attention: false, tone: "ok", trouble: null }));
  return h;
};

describe("attentionResults", () => {
  test("lists the seed's bad sites and troubled services, groups in order", () => {
    const groups = attentionResults(seedHealth());
    assert.deepEqual(keys(groups), ["sites", "service", "reconciler", "infrastructure"]);
    assert.deepEqual(names(groups, "sites"), ["api.lychee.land", "broken.lychee.land"]);
    assert.deepEqual(names(groups, "service"), ["swee", "swee-staging", "palsave-api"]);
    assert.deepEqual(names(groups, "reconciler"), []);
    assert.deepEqual(names(groups, "infrastructure"), []);
  });

  test("with nothing needing attention, every group is empty", () => {
    const groups = attentionResults(calm());
    assert.ok(groups.length > 0);
    for (const g of groups) assert.deepEqual(g.items, [], `${g.key} is not empty`);
  });

  test("an item carries its tone, label, trouble and href", () => {
    const groups = attentionResults(seedHealth());
    const swee = groups.find((g) => g.key === "service")?.items[0];
    assert.deepEqual(swee, {
      kind: "unit",
      name: "swee",
      group: "service",
      tone: "ok",
      label: "running",
      trouble: "blocked",
      href: "/services#service-swee",
    });
    const broken = groups.find((g) => g.key === "sites")?.items[1];
    assert.deepEqual(broken, {
      kind: "site",
      hostname: "broken.lychee.land",
      tone: "bad",
      label: "failed",
      href: "/sites/broken.lychee.land",
    });
  });

  test("with no health, nothing is listed", () => {
    assert.deepEqual(attentionResults(null), []);
  });

  test("with units unavailable, only sites are listed", () => {
    const groups = attentionResults({ ...seedHealth(), units: null });
    assert.deepEqual(keys(groups), ["sites"]);
  });
});

describe("findResults", () => {
  test("`sw` matches no sites and two services", () => {
    const groups = findResults("sw", seedHealth(), railSites);
    assert.deepEqual(keys(groups), ["sites", "service", "reconciler", "infrastructure"]);
    assert.deepEqual(names(groups, "sites"), []);
    assert.deepEqual(names(groups, "service"), ["swee", "swee-staging"]);
    assert.deepEqual(names(groups, "reconciler"), []);
    assert.deepEqual(names(groups, "infrastructure"), []);
  });

  test("matches a healthy unit too: find is every unit, not only attention", () => {
    assert.deepEqual(names(findResults("cad", seedHealth(), railSites), "infrastructure"), ["caddy"]);
  });

  test("`a.l` and `(` match literally and never throw", () => {
    const h = seedHealth();
    // A RegExp would read `a.l` as "a, anything, l" and match these.
    h.sites.push({ hostname: "axl.lychee.land", tone: "ok", label: "running", attention: false });
    h.units?.push({
      name: "abl",
      group: "infrastructure",
      tone: "ok",
      label: "running",
      trouble: null,
      href: "/infrastructure#service-abl",
      attention: false,
    });
    h.sites.push({ hostname: "data.lychee.land", tone: "ok", label: "running", attention: false });
    const dotted = findResults("a.l", h, railSites);
    assert.deepEqual(names(dotted, "sites"), ["data.lychee.land"]);
    assert.deepEqual(names(dotted, "infrastructure"), []);

    assert.doesNotThrow(() => findResults("(", h, railSites));
    for (const g of findResults("(", h, railSites)) assert.deepEqual(g.items, []);
    assert.doesNotThrow(() => findResults("[", h, railSites));
  });

  test("with no health, sites come from the rail's list without labels, and no unit groups", () => {
    const groups = findResults("api", null, railSites);
    assert.deepEqual(keys(groups), ["sites"]);
    assert.deepEqual(groups[0]?.items, [
      { kind: "site", hostname: "api.lychee.land", tone: "none", label: null, href: "/sites/api.lychee.land" },
    ]);
  });

  test("with no health and an unreadable Caddyfile, nothing is listed", () => {
    assert.deepEqual(findResults("api", null, null), [{ key: "sites", items: [] }]);
  });

  test("with units unavailable, only sites are listed", () => {
    const groups = findResults("a", { ...seedHealth(), units: null }, railSites);
    assert.deepEqual(keys(groups), ["sites"]);
    assert.ok((groups[0]?.items.length ?? 0) > 0);
  });

  test("matching is case-insensitive, both ways", () => {
    assert.deepEqual(names(findResults("SWEE", seedHealth(), railSites), "service"), ["swee", "swee-staging"]);
    const h = seedHealth();
    h.units?.push({
      name: "Upper-Case",
      group: "reconciler",
      tone: "ok",
      label: "running",
      trouble: null,
      href: "/reconciler#service-Upper-Case",
      attention: false,
    });
    assert.deepEqual(names(findResults("upper", h, railSites), "reconciler"), ["Upper-Case"]);
  });

  test("a site href is encoded", () => {
    const groups = findResults("api", seedHealth(), railSites);
    const api = groups[0]?.items[0];
    assert.equal(api?.href, "/sites/api.lychee.land");
  });
});
