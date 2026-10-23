import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ActionState, BoardPayload, BoardRow } from "../shared/board";
import { boardInProgress } from "./board";

function row(name: string, extra: Partial<BoardRow> = {}): BoardRow {
  return { name, kind: "container", container: name, group: "service", reconciled: true, status: "running", since: null, ...extra } as BoardRow;
}

function payload(rows: BoardRow[], extra: Partial<BoardPayload> = {}): BoardPayload {
  return {
    board: {
      inventoryAvailable: true,
      schedule: { next: null, last: null },
      timerUnit: null,
      generated: null,
      groups: [{ group: "service", rows }],
    },
    boardEmpty: false,
    now: "2026-10-02T05:00:00Z",
    domain: "lychee.land",
    prunable: [],
    managed: [],
    requested: {},
    lastRuns: {},
    ...extra,
  };
}

const run = (state: ActionState["state"]): ActionState => ({ unit: "palworld", action: "restart", state, logTail: "" });

describe("boardInProgress", () => {
  test("false on a settled board", () => {
    const settled = payload([row("notes", { version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "deployed" })], {
      lastRuns: { palworld: run("succeeded") },
    });
    assert.equal(boardInProgress(settled), false);
  });

  test("false on an empty or unavailable board", () => {
    assert.equal(boardInProgress(payload([])), false);
    assert.equal(
      boardInProgress({ ...payload([]), board: { inventoryAvailable: false, schedule: { next: null, last: null }, timerUnit: null, generated: null, groups: [] } }),
      false,
    );
  });

  test("true with an applying row", () => {
    assert.equal(boardInProgress(payload([row("notes", { version: "v1.4.0", target: "v1.5.0", result: "deployed" })])), true);
  });

  test("a moved pin on a blocked row is not applying", () => {
    assert.equal(boardInProgress(payload([row("notes", { version: "v1.4.0", target: "v1.5.0", result: "blocked" })])), false);
  });

  test("true with a requested tag the row's version does not show", () => {
    assert.equal(boardInProgress(payload([row("notes", { version: "v1.4.0" })], { requested: { notes: "v1.5.0" } })), true);
  });

  test("false once the row's version shows the requested tag", () => {
    assert.equal(boardInProgress(payload([row("notes", { version: "v1.5.0" })], { requested: { notes: "v1.5.0" } })), false);
  });

  test("true with an active run on one of the payload's rows", () => {
    assert.equal(boardInProgress(payload([row("notes"), row("palworld")], { lastRuns: { palworld: run("running") } })), true);
  });

  test("a run on a unit outside the payload's group does not count", () => {
    // lastRuns carries every unit's run, but the payload is one group's page:
    // a running service action must not hold /reconciler at 3s.
    const reconciler = payload([row("lychee-reconcile", { group: "reconciler" })], { lastRuns: { palworld: run("running") } });
    reconciler.board.groups = [{ group: "reconciler", rows: reconciler.board.groups[0].rows }];
    assert.equal(boardInProgress(reconciler), false);
  });

  test("a requested tag for a unit outside the payload's group does not count", () => {
    assert.equal(boardInProgress(payload([row("notes", { version: "v1.4.0" })], { requested: { other: "v2.0.0" } })), false);
  });

  test("a failed or idle run is not active", () => {
    assert.equal(boardInProgress(payload([row("notes"), row("a"), row("b")], { lastRuns: { a: run("failed"), b: run("idle") } })), false);
  });
});
