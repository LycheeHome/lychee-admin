import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuditLine } from "../lib/auditLog";
import type { Lifetime, ReconcilerEvent } from "../lib/reconcilerEvents";
import { buildActivity, shortAge, type ActivityContext } from "./activityModel";

const ctx: ActivityContext = {
  domain: "lychee.land",
  sites: new Set(["app.lychee.land", "blog.lychee.land"]),
  units: new Map([
    ["app-lychee-land", "/services#service-app-lychee-land"],
    ["swee", "/services#service-swee"],
  ]),
};

const T = "2026-10-28T10:00:00Z";

function life(name: string, events: ReconcilerEvent[], open = true): Lifetime {
  return { id: `${name}-1`, name, kind: "resource", added_at: T, removed_at: open ? null : T, open, events };
}

type Bare<T> = T extends unknown ? Omit<T, "at"> : never;

function rec(event: Bare<ReconcilerEvent>, name = "swee") {
  const [e] = buildActivity(null, [life(name, [{ at: T, ...event } as ReconcilerEvent])], ctx, 8);
  return e;
}

function app(line: Partial<AuditLine> & { action: string }) {
  return buildActivity([{ timestamp: T, ...line }], null, ctx, 8)[0];
}

const shape = (e: { kind: string; outcome: string; tone: string } | undefined) =>
  e && { kind: e.kind, outcome: e.outcome, tone: e.tone };

describe("reconciler events", () => {
  it("maps every event type", () => {
    assert.deepEqual(shape(rec({ type: "deployed", from: "0.1.0", to: "0.2.0" })), { kind: "deploy", outcome: "deployed 0.1.0 → 0.2.0", tone: "ok" });
    assert.deepEqual(shape(rec({ type: "deployed", from: null, to: "0.1.0" })), { kind: "deploy", outcome: "deployed 0.1.0", tone: "ok" });
    assert.deepEqual(shape(rec({ type: "failed", failed_step: "Start the container: dependency failed" })), { kind: "deploy", outcome: "failed at Start the container", tone: "bad" });
    assert.deepEqual(shape(rec({ type: "blocked", gate_code: "ci-pending" })), { kind: "deploy", outcome: "blocked · ci-pending", tone: "bad" });
    assert.deepEqual(shape(rec({ type: "awaiting-image" })), { kind: "deploy", outcome: "awaiting image", tone: "neutral" });
    assert.deepEqual(shape(rec({ type: "recovered", from: "x", from_gate_code: null, attempts: 1 })), { kind: "deploy", outcome: "recovered after 1 attempt", tone: "ok" });
    assert.deepEqual(shape(rec({ type: "recovered", from: "x", from_gate_code: null, attempts: 3 })), { kind: "deploy", outcome: "recovered after 3 attempts", tone: "ok" });
    assert.deepEqual(shape(rec({ type: "stopped" })), { kind: "stop", outcome: "stopped", tone: "neutral" });
    assert.deepEqual(shape(rec({ type: "down", from: "0.4.2" })), { kind: "stop", outcome: "down, was 0.4.2", tone: "neutral" });
    assert.deepEqual(shape(rec({ type: "added" })), { kind: "add", outcome: "declared", tone: "neutral" });
    assert.deepEqual(shape(rec({ type: "removed" })), { kind: "remove", outcome: "pruned", tone: "neutral" });
  });

  it("marks them as the reconciler's", () => {
    assert.equal(rec({ type: "stopped" }).who, "reconciler");
  });
});

describe("audit actions", () => {
  it("maps each base action", () => {
    assert.deepEqual(shape(app({ action: "add-site", hostname: "blog.lychee.land" })), { kind: "add", outcome: "added", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "remove-site" })), { kind: "remove", outcome: "removed", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "delete-site-files" })), { kind: "files", outcome: "files deleted", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "deploy-service", detail: "1.8.0" })), { kind: "deploy", outcome: "1.8.0 requested", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "deploy-service" })), { kind: "deploy", outcome: "requested", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "attach-site" })), { kind: "attach", outcome: "attached", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "detach-site" })), { kind: "remove", outcome: "retired", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "change-repository" })), { kind: "repository", outcome: "repository changed", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "prune-declaration" })), { kind: "prune", outcome: "pruned", tone: "neutral" });
  });

  it("refused-cross-site is dropped: its hostname is the request's Host header, not a subject", () => {
    assert.deepEqual(buildActivity([{ timestamp: T, action: "refused-cross-site", hostname: "admin.lychee.land" }], null, ctx, 8), []);
  });

  it("maps host actions by their outcome", () => {
    assert.deepEqual(shape(app({ action: "host-action", hostAction: "restart", outcome: "started", unit: "palworld" })), { kind: "host", outcome: "restart started", tone: "neutral" });
    assert.deepEqual(shape(app({ action: "host-action", hostAction: "restart", outcome: "refused: busy", unit: "palworld" })), { kind: "host", outcome: "restart refused", tone: "bad" });
  });

  it("maps each variant suffix to the bad tone", () => {
    assert.deepEqual(shape(app({ action: "add-site-failed" })), { kind: "add", outcome: "failed", tone: "bad" });
    assert.deepEqual(shape(app({ action: "remove-site-rolled-back" })), { kind: "remove", outcome: "rolled back", tone: "bad" });
    assert.deepEqual(shape(app({ action: "remove-site-rollback-failed" })), { kind: "remove", outcome: "rollback failed", tone: "bad" });
    assert.deepEqual(shape(app({ action: "prune-declaration-refused" })), { kind: "prune", outcome: "refused", tone: "bad" });
  });

  it("deploy-service-failed never shows its detail", () => {
    assert.equal(app({ action: "deploy-service-failed", detail: "1.8.0: boom" }).outcome, "failed");
  });

  it("an unknown audit action is dropped", () => {
    assert.deepEqual(buildActivity([{ timestamp: T, action: "reboot-host" }], null, ctx, 8), []);
  });
});

describe("order", () => {
  it("a tick's events come out newest first", () => {
    const out = buildActivity(null, [life("swee", [{ at: T, type: "added" }, { at: T, type: "deployed", from: null, to: "0.1.0" }])], ctx, 8);
    assert.deepEqual(out.map((e) => e.kind), ["deploy", "add"]);
  });

  it("a reconciler event ties ahead of an app event at the same time", () => {
    const out = buildActivity([{ timestamp: T, action: "deploy-service", unit: "swee" }], [life("swee", [{ at: T, type: "stopped" }])], ctx, 8);
    assert.deepEqual(out.map((e) => e.who), ["reconciler", "app"]);
  });

  it("mixed precision sorts by time, not text", () => {
    const out = buildActivity(
      [{ timestamp: "2026-10-28T10:00:02.500Z", action: "add-site", hostname: "blog.lychee.land" }],
      [life("swee", [{ at: "2026-10-28T10:00:02Z", type: "stopped" }])],
      ctx,
      8,
    );
    assert.deepEqual(out.map((e) => e.who), ["app", "reconciler"]);
  });

  it("an unparseable time is dropped", () => {
    const out = buildActivity([{ timestamp: "yesterday", action: "add-site" }], [life("swee", [{ at: "nope", type: "stopped" }, { at: T, type: "added" }])], ctx, 8);
    assert.equal(out.length, 1);
    assert.equal(out[0].outcome, "declared");
  });

  it("the limit keeps the newest", () => {
    const audit: AuditLine[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: `2026-10-28T10:00:${String(i).padStart(2, "0")}Z`,
      action: "add-site",
      hostname: "blog.lychee.land",
    }));
    const out = buildActivity(audit, null, ctx, 8);
    assert.equal(out.length, 8);
    assert.equal(out[0].at, "2026-10-28T10:00:09Z");
    assert.equal(out[7].at, "2026-10-28T10:00:02Z");
  });

  it("a closed lifetime and a re-added one both contribute, in time order", () => {
    const closed = life("app-lychee-land", [{ at: "2026-10-27T09:00:00Z", type: "added" }, { at: "2026-10-27T10:00:00Z", type: "removed" }], false);
    const reopened = life("app-lychee-land", [{ at: "2026-10-28T09:00:00Z", type: "added" }]);
    const out = buildActivity(null, [closed, reopened], ctx, 8);
    assert.deepEqual(out.map((e) => e.outcome), ["declared", "pruned", "declared"]);
    assert.deepEqual(out.map((e) => e.at), ["2026-10-28T09:00:00Z", "2026-10-27T10:00:00Z", "2026-10-27T09:00:00Z"]);
  });
});

describe("subject and link", () => {
  it("a site resource's subject is its hostname and links to its page", () => {
    const e = rec({ type: "added" }, "app-lychee-land");
    assert.equal(e.subject, "app.lychee.land");
    assert.equal(e.href, "/sites/app.lychee.land");
  });

  it("a plain unit links to its board row", () => {
    const e = rec({ type: "added" }, "swee");
    assert.equal(e.subject, "swee");
    assert.equal(e.href, "/services#service-swee");
  });

  it("an audit line links by its hostname, or by its unit", () => {
    assert.equal(app({ action: "add-site", hostname: "blog.lychee.land" }).href, "/sites/blog.lychee.land");
    assert.equal(app({ action: "host-action", unit: "swee", hostAction: "restart", outcome: "started" }).href, "/services#service-swee");
  });

  it("a pruned resource and a removed site have no link", () => {
    const pruned = buildActivity(null, [life("old-lychee-land", [{ at: T, type: "removed" }], false)], ctx, 8)[0];
    assert.equal(pruned.subject, "old.lychee.land");
    assert.equal(pruned.href, null);
    assert.equal(app({ action: "remove-site", hostname: "gone.lychee.land" }).href, null);
  });

  it("an unreadable Caddyfile means no site links", () => {
    const e = buildActivity(null, [life("app-lychee-land", [{ at: T, type: "added" }])], { ...ctx, sites: null }, 8)[0];
    assert.equal(e.href, "/services#service-app-lychee-land");
  });
});

describe("shortAge", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("reads now, minutes, hours and days", () => {
    assert.equal(shortAge("2026-10-28T11:59:30Z", now), "now");
    assert.equal(shortAge("2026-10-28T12:05:00Z", now), "now");
    assert.equal(shortAge("2026-10-28T11:54:50Z", now), "5m");
    assert.equal(shortAge("2026-10-28T09:00:00Z", now), "3h");
    assert.equal(shortAge("2026-10-27T10:00:00Z", now), "1d");
  });
});
