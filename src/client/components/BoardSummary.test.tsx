import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import type { BoardPayload, BoardRow } from "../../shared/board";
import { Board } from "./BoardRows";

/*
 * The board leads with trouble (critique 2026-10-26 P1, variant 02): one line
 * under the eyebrow names the rows that need attention, each a link to its
 * row; the rows keep their inventory order. A row needs attention when what it
 * shows is bad: a Scorch pill or a Scorch deploy line.
 */

afterEach(() => cleanup());

function row(name: string, extra: Partial<BoardRow> = {}): BoardRow {
  return { name, kind: "container", container: name, group: "service", reconciled: true, status: "running", since: null, ...extra } as BoardRow;
}

function payload(rows: BoardRow[], extra: Partial<BoardPayload> = {}): BoardPayload {
  return {
    board: { inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: "2026-10-27T05:00:00Z", groups: [{ group: "service", rows }] },
    boardEmpty: false,
    now: "2026-10-27T05:00:30Z",
    domain: "lychee.land",
    prunable: [],
    retiring: [],
    managed: [],
    requested: {},
    lastRuns: {},
    ...extra,
  };
}

const summary = (p: BoardPayload) =>
  render(<Board payload={p} group="service" />).container.querySelector<HTMLElement>("[data-attention-summary]");

describe("the board's attention summary", () => {
  test("names the rows that need attention, in inventory order, each a link to its row", () => {
    const s = summary(
      payload([
        row("calm"),
        row("crashed", { status: "exited" }),
        row("blocked", { version: "v1", result: "blocked", gateCode: "ci-failed" } as Partial<BoardRow>),
        row("also-calm"),
      ]),
    );
    assert.ok(s, "no summary");
    assert.equal(s.textContent, "2 need attention: crashed, blocked.");
    assert.deepEqual(
      Array.from(s.querySelectorAll("a")).map((a) => [a.textContent, a.getAttribute("href")]),
      [
        ["crashed", "#service-crashed"],
        ["blocked", "#service-blocked"],
      ],
    );
  });

  test("one row reads in the singular", () => {
    const s = summary(payload([row("crashed", { status: "exited" }), row("calm")]));
    assert.equal(s?.textContent, "1 needs attention: crashed.");
  });

  test("absent when nothing needs attention, unknown and waiting rows included", () => {
    const s = summary(
      payload([
        row("calm"),
        row("unread", { status: "unknown" }),
        row("waiting", { version: "v1", result: "blocked", gateCode: "ci-pending" } as Partial<BoardRow>),
      ]),
    );
    assert.equal(s, null);
  });

  test("a retired row confirmed down reads retired, not trouble, and is not named", () => {
    const s = summary(payload([row("gone-lychee-land", { status: "exited", result: "deployed" })], { prunable: ["gone-lychee-land"] }));
    assert.equal(s, null);
  });

  test("the rows keep their inventory order", () => {
    const { container } = render(<Board payload={payload([row("a"), row("b", { status: "exited" }), row("c")])} group="service" />);
    assert.deepEqual(
      Array.from(container.querySelectorAll("[data-service]")).map((li) => li.getAttribute("data-service")),
      ["a", "b", "c"],
    );
  });
});
