import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeStatus, hostProblems, hostProblemUnits, splitHostnameForDisplay } from "./siteDisplay";
import type { InventoryEntry, ServiceInventory } from "./serviceInventory";
import type { UnitState } from "./unitState";

describe("describeStatus", () => {
  // Scorch is for something that tried and failed: a first deploy the
  // reconciler attempted and could not complete is exactly that, unlike
  // awaiting image, which has not been attempted yet.
  test("a failed deploy with nothing installed is bad, and says failed", () => {
    assert.deepEqual(describeStatus({ kind: "failed" }), {
      pill: "failed",
      hop: "deploy failed",
      tone: "bad",
    });
  });

  test("a site awaiting its first image is neutral, not a failure", () => {
    assert.deepEqual(describeStatus({ kind: "awaiting-image" }), {
      pill: "awaiting image",
      hop: "awaiting first image",
      tone: "neutral",
    });
  });

  test("a healthy running container is ok, and says so on both lines", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running", health: "healthy" }), {
      pill: "running",
      hop: "running · healthy",
      tone: "ok",
    });
  });

  test("a running container with no health data omits health rather than inventing it", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running" }), {
      pill: "running",
      hop: "running",
      tone: "ok",
    });
  });

  test("an unhealthy container leads with unhealthy in the pill", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running", health: "unhealthy" }), {
      pill: "unhealthy",
      hop: "running · unhealthy",
      tone: "bad",
    });
  });

  test("a starting health check is neutral, not a failure", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "running", health: "starting" }), {
      pill: "starting",
      hop: "running · health check starting",
      tone: "neutral",
    });
  });

  test("exited, restarting and paused are all bad", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "exited" }), {
      pill: "exited",
      hop: "exited",
      tone: "bad",
    });
    assert.deepEqual(describeStatus({ kind: "container", state: "restarting" }), {
      pill: "restarting",
      hop: "restarting · crash-looping",
      tone: "bad",
    });
    assert.deepEqual(describeStatus({ kind: "container", state: "paused" }), {
      pill: "paused",
      hop: "paused",
      tone: "bad",
    });
  });

  test("a never-created container is neutral — absence is not a failure", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "not-created" }), {
      pill: "not deployed",
      hop: "not deployed",
      tone: "neutral",
    });
  });

  test("an unreadable container status is neutral — not knowing is not a failure", () => {
    assert.deepEqual(describeStatus({ kind: "container", state: "unknown" }), {
      pill: "unknown",
      hop: "can't check",
      tone: "neutral",
    });
  });

  test("tcp checks use responding, never live or down", () => {
    assert.deepEqual(describeStatus({ kind: "tcp", responding: true }), {
      pill: "responding",
      hop: "responding",
      tone: "ok",
    });
    assert.deepEqual(describeStatus({ kind: "tcp", responding: false }), {
      pill: "not responding",
      hop: "not responding",
      tone: "bad",
    });
  });

  test("no state anywhere is described as live or down", () => {
    const states = ["running", "exited", "restarting", "paused", "not-created", "unknown"] as const;
    for (const state of states) {
      const { pill, hop } = describeStatus({ kind: "container", state });
      assert.doesNotMatch(`${pill} ${hop}`, /\b(live|down)\b/);
    }
  });
});

describe("splitHostnameForDisplay", () => {
  test("dims the managed domain suffix on a subdomain", () => {
    assert.deepEqual(splitHostnameForDisplay("blog.lychee.land", "lychee.land"), {
      lead: "blog",
      dimmed: ".lychee.land",
    });
  });

  test("keeps a multi-level subdomain whole in the bright part", () => {
    assert.deepEqual(splitHostnameForDisplay("a.b.lychee.land", "lychee.land"), {
      lead: "a.b",
      dimmed: ".lychee.land",
    });
  });

  test("the apex domain has nothing to dim", () => {
    assert.deepEqual(splitHostnameForDisplay("lychee.land", "lychee.land"), {
      lead: "lychee.land",
      dimmed: "",
    });
  });

  test("a hostname outside the managed domain is left alone", () => {
    assert.deepEqual(splitHostnameForDisplay("lychee.local", "lychee.land"), {
      lead: "lychee.local",
      dimmed: "",
    });
  });

  test("a hostname that merely ends in the domain's letters is not split", () => {
    assert.deepEqual(splitHostnameForDisplay("notlychee.land", "lychee.land"), {
      lead: "notlychee.land",
      dimmed: "",
    });
  });
});

const unitEntry = (name: string, unit: string, group: "reconciler" | "infrastructure"): InventoryEntry => ({
  kind: "unit",
  name,
  unit,
  group,
  reconciled: true,
});

const HOST_INVENTORY: ServiceInventory = {
  generated: null,
  available: true,
  entries: [
    unitEntry("lychee-reconcile-timer", "lychee-reconcile.timer", "reconciler"),
    unitEntry("lychee-watch-timer", "lychee-watch.timer", "reconciler"),
    unitEntry("caddy", "caddy.service", "infrastructure"),
    unitEntry("cloudflared-sites", "cloudflared-sites.service", "infrastructure"),
  ],
};

// A string, not UnitStatus: the board's vocabulary has words (paused) a unit
// state type does not, and hostProblems decides on the word alone.
const states = (m: Record<string, string>): Record<string, UnitState> =>
  Object.fromEntries(Object.entries(m).map(([k, status]) => [k, { status, since: null } as UnitState]));

describe("hostProblems", () => {
  test("caddy exited is a site-down problem", () => {
    assert.deepEqual(hostProblems(states({ "caddy.service": "exited" }), HOST_INVENTORY), [
      {
        name: "caddy",
        word: "exited",
        consequence: "Every site is unreachable from outside",
        page: "infrastructure",
        href: "/infrastructure",
      },
    ]);
  });

  test("the tunnel restarting is its own problem", () => {
    const [p] = hostProblems(states({ "cloudflared-sites.service": "restarting" }), HOST_INVENTORY);
    assert.equal(p.name, "cloudflared-sites");
    assert.equal(p.word, "restarting");
  });

  test("the watcher timer stopped delays changes", () => {
    const [p] = hostProblems(states({ "lychee-watch.timer": "exited" }), HOST_INVENTORY);
    assert.equal(p.name, "lychee-watch-timer");
    assert.equal(p.consequence, "Changes wait for the 15-minute full run");
    assert.equal(p.href, "/reconciler");
    assert.equal(p.page, "reconciler");
  });

  test("the full-run timer stopped", () => {
    const [p] = hostProblems(states({ "lychee-reconcile.timer": "exited" }), HOST_INVENTORY);
    assert.equal(p.name, "lychee-reconcile-timer");
    assert.equal(p.consequence, "The 15-minute full run has stopped");
  });

  test("the watcher is never misread as the full-run timer when inventory order flips", () => {
    const flipped: ServiceInventory = { ...HOST_INVENTORY, entries: [...HOST_INVENTORY.entries].reverse() };
    const [p] = hostProblems(states({ "lychee-watch.timer": "exited" }), flipped);
    assert.equal(p.consequence, "Changes wait for the 15-minute full run");
  });

  test("any other reconciler unit", () => {
    const inv: ServiceInventory = {
      ...HOST_INVENTORY,
      entries: [...HOST_INVENTORY.entries, unitEntry("foo", "foo.service", "reconciler")],
    };
    const [p] = hostProblems(states({ "foo.service": "paused" }), inv);
    assert.equal(p.name, "foo");
    assert.equal(p.word, "paused");
    assert.equal(p.consequence, "Deploys may not apply");
  });

  test("unknown, starting, running and absent are not problems", () => {
    const all = states({
      "caddy.service": "unknown",
      "cloudflared-sites.service": "starting",
      "lychee-reconcile.timer": "running",
    });
    assert.deepEqual(hostProblems(all, HOST_INVENTORY), []);
  });

  test("infrastructure precedes reconciler", () => {
    const got = hostProblems(states({ "lychee-watch.timer": "exited", "caddy.service": "exited" }), HOST_INVENTORY);
    assert.deepEqual(got.map((p) => p.name), ["caddy", "lychee-watch-timer"]);
  });

  test("two infrastructure problems keep fixed order", () => {
    const got = hostProblems(
      states({ "cloudflared-sites.service": "exited", "caddy.service": "exited" }),
      HOST_INVENTORY,
    );
    assert.deepEqual(got.map((p) => p.name), ["caddy", "cloudflared-sites"]);
  });

  test("an inventory entry for a fixed unit is not counted twice", () => {
    assert.equal(hostProblems(states({ "caddy.service": "exited" }), HOST_INVENTORY).length, 1);
  });

  test("no inventory falls back to the fixed units", () => {
    const got = hostProblems(states({ "caddy.service": "exited", "lychee-watch.timer": "exited" }), null);
    assert.deepEqual(got.map((p) => p.name), ["caddy"]);
  });

  test("an inventory with no entries behaves like none", () => {
    const empty: ServiceInventory = { generated: null, available: false, entries: [] };
    const got = hostProblems(states({ "caddy.service": "exited", "lychee-watch.timer": "exited" }), empty);
    assert.deepEqual(got.map((p) => p.name), ["caddy"]);
  });
});

describe("hostProblemUnits", () => {
  test("no inventory reads only the fixed units", () => {
    assert.deepEqual(hostProblemUnits(null), ["caddy.service", "cloudflared-sites.service"]);
  });

  test("an inventory adds its reconciler units, without duplicates", () => {
    assert.deepEqual(hostProblemUnits(HOST_INVENTORY), [
      "caddy.service",
      "cloudflared-sites.service",
      "lychee-reconcile.timer",
      "lychee-watch.timer",
    ]);
  });
});
