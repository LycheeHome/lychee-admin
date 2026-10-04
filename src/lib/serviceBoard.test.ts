import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard, findTimerUnit } from "./serviceBoard";
import type { ServiceInventory } from "./serviceInventory";
import type { ServiceStatus, TimerSchedule, UnitState } from "./unitState";

const inv: ServiceInventory = {
  generated: "2026-10-02T04:58:02Z",
  available: true,
  entries: [
    { name: "lyly-reconcile-timer", kind: "unit", unit: "lyly-reconcile.timer", group: "reconciler", reconciled: false },
    { name: "lyly-reconcile", kind: "unit", unit: "lyly-reconcile.service", group: "reconciler", reconciled: false },
    { name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true, version: "v2.11.4" },
    { name: "caddy", kind: "unit", unit: "caddy.service", group: "infrastructure", reconciled: false },
  ],
};

const states: Record<string, UnitState> = {
  "lyly-reconcile.timer": { status: "running", since: null },
  "lyly-reconcile.service": { status: "exited", since: null },
  "swee.service": { status: "running", since: "Fri 2026-10-02 02:47:38 UTC" },
  "caddy.service": { status: "running", since: "Sat 2026-09-26 11:00:00 UTC" },
};

const none: TimerSchedule = { next: null, last: null };

test("groups rows in the fixed order reconciler, service, infrastructure", () => {
  const board = buildBoard(inv, states, none);
  assert.deepEqual(board.groups.map((g) => g.group), ["reconciler", "service", "infrastructure"]);
});

test("the schedule belongs to the board, not to any row", () => {
  const schedule: TimerSchedule = {
    next: new Date("2026-10-02T05:02:56Z"),
    last: new Date("2026-10-02T04:57:56Z"),
  };
  const board = buildBoard(inv, states, schedule);
  assert.deepEqual(board.schedule, schedule);
  for (const g of board.groups) {
    for (const row of g.rows) {
      assert.ok(!("nextElapse" in row) && !("lastTrigger" in row) && !("next" in row));
    }
  }
});

test("joins live status onto each inventory entry", () => {
  const swee = buildBoard(inv, states, none).groups[1].rows[0];
  assert.equal(swee.name, "swee");
  assert.equal(swee.status, "running");
  assert.equal(swee.since, "Fri 2026-10-02 02:47:38 UTC");
  assert.equal(swee.version, "v2.11.4");
});

test("a declared unit with no live state reads unknown, not missing", () => {
  const board = buildBoard(inv, {}, none);
  for (const group of board.groups) {
    for (const row of group.rows) {
      assert.equal(row.status, "unknown");
      assert.equal(row.since, null);
    }
  }
});

test("a live unit absent from the inventory is not rendered and does not throw", () => {
  const board = buildBoard(inv, { ...states, "stranger.service": { status: "running", since: null } }, none);
  const names = board.groups.flatMap((g) => g.rows.map((r) => r.name));
  assert.ok(!names.includes("stranger"));
  assert.equal(names.length, 4);
});

test("an empty group is dropped rather than rendered with no rows", () => {
  const board = buildBoard({ ...inv, entries: [inv.entries[1]] }, states, none);
  assert.deepEqual(board.groups.map((g) => g.group), ["reconciler"]);
});

test("an unavailable inventory still yields a board, with no rows", () => {
  const board = buildBoard({ generated: null, entries: [], available: false }, states, none);
  assert.equal(board.inventoryAvailable, false);
  assert.deepEqual(board.groups, []);
  assert.equal(board.generated, null);
});

const container = (
  name: string,
  group: "service" | "reconciler" = "service",
  extra: Record<string, unknown> = {},
): ServiceInventory["entries"][number] =>
  ({ name, kind: "container", container: name, group, reconciled: false, ...extra }) as ServiceInventory["entries"][number];

test("a container row with no live state reads unknown, not exited", () => {
  const board = buildBoard({ ...inv, entries: [container("palsave-api")] }, {}, none, {});
  const row = board.groups[0].rows[0];
  assert.equal(row.status, "unknown");
  assert.equal(row.since, null);
});

test("a container row reads its own state, keyed by project name, with since null", () => {
  const board = buildBoard(
    { ...inv, entries: [container("palsave-api"), container("other")] },
    // A unit state under the same key must not leak into a container row.
    { "palsave-api": { status: "running", since: "Fri 2026-10-02 02:47:38 UTC" } },
    none,
    { "palsave-api": "unhealthy", other: "not-created" },
  );
  const [a, b] = board.groups[0].rows;
  assert.equal(a.status, "unhealthy");
  assert.equal(a.since, null);
  assert.equal(b.status, "not-created");
});

test("findTimerUnit ignores container entries", () => {
  const onlyContainer: ServiceInventory = { ...inv, entries: [container("lyly-reconcile", "reconciler")] };
  assert.equal(findTimerUnit(onlyContainer), null);
  // A container listed ahead of the timer must not hide it or throw on .unit.
  const both: ServiceInventory = { ...inv, entries: [container("lyly-reconcile", "reconciler"), inv.entries[0]] };
  assert.equal(findTimerUnit(both), "lyly-reconcile.timer");
});

test("the board renders unit and container rows in the same groups", () => {
  const mixed: ServiceInventory = { ...inv, entries: [inv.entries[2], container("palsave-api")] };
  const statuses: Record<string, ServiceStatus> = { "palsave-api": "running" };
  const board = buildBoard(mixed, states, none, statuses);
  assert.deepEqual(board.groups.map((g) => g.group), ["service"]);
  assert.deepEqual(board.groups[0].rows.map((r) => [r.name, r.status]), [
    ["swee", "running"],
    ["palsave-api", "running"],
  ]);
});
