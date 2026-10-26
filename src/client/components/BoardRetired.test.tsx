import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import type { BoardPayload, BoardRow } from "../../shared/board";
import { TONE_PILL, TONE_TEXT } from "../../views/shared";
import { Board } from "./BoardRows";

/*
 * A retired site resource on the services board (spec 2026-10-26-board-retired):
 * `retired` with Prune once the reconciler has confirmed its container down,
 * the live state under a retiring line, with no Prune, until then. These
 * replace the frozen *-prunable-and-links fixtures, which showed that row as
 * `not deployed` beside its Prune.
 */

afterEach(() => cleanup());

const RETIRING_LINE = "● retiring · Prune follows once the reconciler confirms the container down";

function row(name: string, extra: Partial<BoardRow> = {}): BoardRow {
  return { name, kind: "container", container: name, group: "service", reconciled: true, status: "running", since: null, ...extra } as BoardRow;
}

function payload(rows: BoardRow[], extra: Partial<BoardPayload> = {}): BoardPayload {
  return {
    board: {
      inventoryAvailable: true,
      schedule: { next: null, last: null },
      timerUnit: null,
      generated: "2026-10-26T05:00:00Z",
      groups: [{ group: "service", rows }],
    },
    boardEmpty: false,
    now: "2026-10-26T05:00:30Z",
    domain: "lychee.land",
    prunable: [],
    retiring: [],
    managed: [],
    requested: {},
    lastRuns: {},
    ...extra,
  };
}

function board(p: BoardPayload): HTMLElement {
  return render(<Board payload={p} group="service" />).container;
}

const rowOf = (root: HTMLElement, name: string) => root.querySelector<HTMLElement>(`[data-service="${name}"]`)!;
const pillOf = (li: HTMLElement) => li.querySelector<HTMLElement>("[data-row-pill] span")!;

describe("a retired site resource on the board", () => {
  test("confirmed down: the pill is retired, neutral, with Prune and no retiring line", () => {
    const li = rowOf(board(payload([row("gone-lychee-land", { status: "not-created", result: "deployed" })], { prunable: ["gone-lychee-land"] })), "gone-lychee-land");
    assert.equal(pillOf(li).getAttribute("class"), TONE_PILL.neutral);
    assert.equal(pillOf(li).textContent, "● retired");
    assert.ok(li.querySelector('[data-prune="gone-lychee-land"]'));
    assert.ok(!li.querySelector("[data-retiring]"));
  });

  // Spec 2026-10-26-mono-sentences: a sentence in sans, its facts in mono.
  test("the prune caption is a sans sentence with its facts in mono", () => {
    const li = rowOf(board(payload([row("gone-lychee-land", { status: "not-created", result: "deployed" })], { prunable: ["gone-lychee-land"] })), "gone-lychee-land");
    const caption = li.querySelector<HTMLElement>("[data-prune-line] > span")!;
    assert.equal(caption.textContent, "Deletes gone-lychee-land.yml from lychee-resources once its container is confirmed down.");
    assert.equal(caption.getAttribute("class"), "text-[0.75rem] leading-snug text-stone-400");
    const facts = Array.from(caption.querySelectorAll("span")).map((s) => [s.textContent, s.getAttribute("class")]);
    // The short fixed fact keeps together (at 390px it broke at its hyphen);
    // the file name, which can be long, may still wrap.
    assert.deepEqual(facts, [
      ["gone-lychee-land.yml", "font-mono text-stone-50"],
      ["lychee-resources", "font-mono text-stone-50 whitespace-nowrap"],
    ]);
  });

  test("confirmed down with an exited or unknown live status still reads retired", () => {
    for (const status of ["exited", "unknown"] as const) {
      const li = rowOf(board(payload([row("gone-lychee-land", { status, result: "deployed" })], { prunable: ["gone-lychee-land"] })), "gone-lychee-land");
      assert.equal(pillOf(li).textContent, "● retired", status);
      cleanup();
    }
  });

  test("retiring: the live pill, the exact line, no Prune", () => {
    const li = rowOf(
      board(payload([row("up-lychee-land", { status: "running", version: "0.2.1", result: "deployed" })], { retiring: ["up-lychee-land"] })),
      "up-lychee-land",
    );
    assert.equal(pillOf(li).textContent, "● running");
    assert.equal(pillOf(li).getAttribute("class"), TONE_PILL.ok);
    const line = li.querySelector<HTMLElement>("[data-retiring]");
    assert.ok(line, "no retiring line");
    assert.equal(line.textContent, RETIRING_LINE);
    // The key is mono, the reason sans (spec 2026-10-26-mono-sentences).
    assert.equal(line.querySelector("span")?.getAttribute("class"), `font-mono ${TONE_TEXT.neutral}`);
    assert.ok(!(line.getAttribute("class") ?? "").includes("font-mono"), "the whole line is mono");
    assert.ok(!li.querySelector("[data-prune]"));
    const facts = Array.from(li.querySelectorAll("p")).find((p) => p.textContent === "0.2.1");
    assert.ok(facts, "no facts line");
    assert.ok(facts.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING, "the retiring line is above the facts");
  });

  test("a down that failed is retiring under its failed pill", () => {
    const li = rowOf(
      board(payload([row("gone-lychee-land", { status: "exited", version: "", target: "0.1.0", result: "failed" })], { retiring: ["gone-lychee-land"] })),
      "gone-lychee-land",
    );
    assert.equal(pillOf(li).textContent, "● failed");
    assert.equal(pillOf(li).getAttribute("class"), TONE_PILL.bad);
    assert.ok(li.querySelector("[data-retiring]"));
    assert.ok(!li.querySelector("[data-prune]"));
  });

  test("a non-site name in either set gets neither treatment", () => {
    const pal = () => [row("palsave-api", { status: "running", version: "v1", result: "deployed" })];
    const plain = pillOf(rowOf(board(payload(pal())), "palsave-api")).outerHTML;
    cleanup();
    const li = rowOf(board(payload(pal(), { prunable: ["palsave-api"], retiring: ["palsave-api"] })), "palsave-api");
    assert.ok(!li.querySelector("[data-retiring]"));
    assert.ok(!li.querySelector("[data-prune]"));
    assert.equal(pillOf(li).outerHTML, plain);
  });

  // Carried out of the retired *-prunable-and-links parity case.
  test("site names are linked only while managed", () => {
    const root = board(
      payload([row("app-lychee-land", { version: "0.1.0" }), row("other-lychee-land", { version: "0.1.0" })], { managed: ["app.lychee.land"] }),
    );
    assert.ok(rowOf(root, "app-lychee-land").querySelector('a[href="/sites/app.lychee.land"]'));
    assert.ok(!rowOf(root, "other-lychee-land").querySelector("a"));
  });
});
