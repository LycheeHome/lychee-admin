import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard } from "./serviceBoard";
import type { ServiceInventory } from "./serviceInventory";
import type { TimerSchedule, UnitState } from "./unitState";

const inv: ServiceInventory = {
  generated: "2026-10-02T04:58:02Z",
  available: true,
  entries: [
    { name: "lyly-reconcile-timer", unit: "lyly-reconcile.timer", group: "reconciler", reconciled: false },
    { name: "lyly-reconcile", unit: "lyly-reconcile.service", group: "reconciler", reconciled: false },
    { name: "swee", unit: "swee.service", group: "service", reconciled: true, version: "v2.11.4" },
    { name: "caddy", unit: "caddy.service", group: "infrastructure", reconciled: false },
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
