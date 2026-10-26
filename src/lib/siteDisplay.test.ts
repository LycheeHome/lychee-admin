import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeStatus, deployTrouble, hostProblems, hostProblemUnits, splitHostnameForDisplay, troubleGate, undeployedStatus, visitIsForward, type SiteStatus } from "./siteDisplay";
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

  // Deliberately taken down is not a failure (the Three-Tone rule): a retired
  // declaration not yet pruned is neutral, but says so, so it never reads like
  // a site that was simply never attached.
  test("a retired declaration is neutral, and says retired", () => {
    assert.deepEqual(describeStatus({ kind: "retired" }), {
      pill: "retired",
      hop: "retired · not pruned",
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

describe("visitIsForward", () => {
  test("no status (a static site, or no status entry) keeps Visit forward", () => {
    assert.equal(visitIsForward(undefined), true);
  });

  test("serving states keep Visit forward", () => {
    assert.equal(visitIsForward({ kind: "tcp", responding: true }), true);
    assert.equal(visitIsForward({ kind: "container", state: "running" }), true);
    assert.equal(visitIsForward({ kind: "container", state: "running", health: "healthy" }), true);
  });

  test("every other state demotes Visit, neutral ones included", () => {
    const demoted: SiteStatus[] = [
      { kind: "failed" },
      { kind: "awaiting-image" },
      { kind: "tcp", responding: false },
      { kind: "container", state: "running", health: "unhealthy" },
      { kind: "container", state: "running", health: "starting" },
      { kind: "container", state: "exited" },
      { kind: "container", state: "restarting" },
      { kind: "container", state: "paused" },
      { kind: "container", state: "not-created" },
      { kind: "container", state: "unknown" },
    ];
    for (const s of demoted) assert.equal(visitIsForward(s), false, JSON.stringify(s));
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

describe("undeployedStatus", () => {
  test("nothing installed and the last run failed reads failed", () => {
    assert.deepEqual(undeployedStatus({ version: "", result: "failed" }), { kind: "failed" });
    assert.deepEqual(undeployedStatus({ result: "failed" }), { kind: "failed" });
  });

  test("nothing installed and awaiting an image reads awaiting-image", () => {
    assert.deepEqual(undeployedStatus({ version: "", result: "awaiting-image" }), { kind: "awaiting-image" });
  });

  test("nothing installed with any other result, or none, has no opinion", () => {
    assert.equal(undeployedStatus({ version: "", result: "deployed" }), null);
    assert.equal(undeployedStatus({}), null);
  });

  test("an installed version has no opinion, whatever the last result", () => {
    assert.equal(undeployedStatus({ version: "0.1.0", result: "failed" }), null);
  });
});

describe("deployTrouble", () => {
  const rows: Array<[string, "bad" | "neutral", "blocked" | "waiting", string]> = [
    ["ci-failed", "bad", "blocked", "CI failed"],
    ["ci-unknown", "bad", "blocked", "CI result unknown"],
    ["retry-capped", "bad", "blocked", "retry limit reached"],
    ["pin-unresolved", "bad", "blocked", "tag didn't resolve"],
    ["declaration-rejected", "bad", "blocked", "declaration rejected"],
    ["not-applied", "bad", "blocked", "not applied"],
    ["image-unavailable", "bad", "blocked", "image unavailable"],
    ["provenance-failed", "bad", "blocked", "provenance check failed"],
    ["token-missing", "bad", "blocked", "no GitHub token on the host"],
    ["env-mismatch", "bad", "blocked", ".env doesn't match"],
    ["ci-pending", "neutral", "waiting", "CI running"],
    ["host-pending", "neutral", "waiting", "waiting for systemd"],
  ];
  for (const [gateCode, tone, word, reason] of rows) {
    test(`blocked with ${gateCode} is ${tone} ${word}`, () => {
      assert.deepEqual(deployTrouble({ result: "blocked", gateCode }), { tone, word, reason });
    });
  }

  test("a failed run is bad with or without a code", () => {
    const failed = { tone: "bad", word: "failed", reason: "deploy failed" };
    assert.deepEqual(deployTrouble({ result: "failed" }), failed);
    assert.deepEqual(deployTrouble({ result: "failed", gateCode: "ok" }), failed);
  });

  test("blocked with a benign, unknown or missing code is no trouble", () => {
    for (const gateCode of ["ok", "up-to-date", "awaiting-image", "unknown", "made-up", undefined]) {
      assert.equal(deployTrouble({ result: "blocked", gateCode }), null, String(gateCode));
    }
  });

  test("a run that was not blocked or failed is no trouble", () => {
    assert.equal(deployTrouble({ result: "skipped", gateCode: "up-to-date" }), null);
    assert.equal(deployTrouble({ result: "deployed", gateCode: "ok" }), null);
  });

  test("an empty gate_code is no code", () => {
    assert.equal(deployTrouble({ result: "blocked", gateCode: "" }), null);
  });

  test("an unknown result never produces a line", () => {
    assert.equal(deployTrouble({ result: "unknown", gateCode: "ci-failed" }), null);
  });
});

describe("troubleGate", () => {
  test("a blocked or failed run shows its gate sentence, whatever the code", () => {
    for (const entry of [
      { result: "blocked", gateCode: "retry-capped", gate: "G" },
      { result: "blocked", gateCode: "not-applied", gate: "G" },
      { result: "blocked", gateCode: "ci-pending", gate: "G" },
      { result: "blocked", gateCode: "some-new-code", gate: "G" },
      { result: "blocked", gate: "G" },
      { result: "failed", gate: "G" },
    ]) {
      assert.equal(troubleGate(entry), "G", JSON.stringify(entry));
    }
  });

  test("a run with no trouble to explain shows no gate sentence", () => {
    for (const entry of [
      { result: "blocked", gateCode: "ci-failed", gate: "" },
      { result: "failed", gate: "" },
      { result: "skipped", gateCode: "up-to-date", gate: "pin unchanged (1.4.0)" },
      { result: "deployed", gateCode: "ok", gate: "ok" },
      { result: "awaiting-image", gateCode: "awaiting-image", gate: "no tag yet" },
      { gate: "G" },
    ]) {
      assert.equal(troubleGate(entry), null, JSON.stringify(entry));
    }
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
    const [p] = hostProblems(states({ "foo.service": "restarting" }), inv);
    assert.equal(p.name, "foo");
    assert.equal(p.word, "restarting");
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

  test("a third infrastructure unit is read, after the fixed ones and before reconciler problems", () => {
    const inv: ServiceInventory = {
      ...HOST_INVENTORY,
      entries: [...HOST_INVENTORY.entries, unitEntry("other-infra", "other.service", "infrastructure")],
    };
    const got = hostProblems(
      states({ "other.service": "exited", "lychee-watch.timer": "exited", "caddy.service": "exited" }),
      inv,
    );
    assert.deepEqual(got.map((p) => p.name), ["caddy", "other-infra", "lychee-watch-timer"]);
    assert.equal(got[1].consequence, "Every site is unreachable from outside");
    assert.equal(got[1].href, "/infrastructure");
    assert.equal(got[1].page, "infrastructure");
  });

  test("a fixed unit takes the inventory's name for it", () => {
    const inv: ServiceInventory = {
      ...HOST_INVENTORY,
      entries: [unitEntry("web-proxy", "caddy.service", "infrastructure")],
    };
    assert.equal(hostProblems(states({ "caddy.service": "exited" }), inv)[0].name, "web-proxy");
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
  test("a third infrastructure unit is included once", () => {
    const inv: ServiceInventory = {
      ...HOST_INVENTORY,
      entries: [...HOST_INVENTORY.entries, unitEntry("other-infra", "other.service", "infrastructure")],
    };
    const units = hostProblemUnits(inv);
    assert.equal(units.filter((u) => u === "other.service").length, 1);
    assert.equal(new Set(units).size, units.length);
  });

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
