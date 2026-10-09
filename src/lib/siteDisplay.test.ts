import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { describeStatus, splitHostnameForDisplay } from "./siteDisplay";

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
