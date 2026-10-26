import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import type { BoardPayload, BoardRow } from "../../shared/board";
import { BODY, TONE_TEXT } from "../../views/shared";
import { Board } from "./BoardRows";

/*
 * Sentences in sans, machine facts in mono, and no read-only value in Ember
 * (spec 2026-10-26-mono-sentences; critique 2026-10-21 P2). The frozen board
 * fixtures hold the old markup; redesigns.ts declares the change for them.
 */

afterEach(() => cleanup());

function row(name: string, extra: Partial<BoardRow> = {}): BoardRow {
  return { name, kind: "container", container: name, group: "service", reconciled: true, status: "running", since: null, ...extra } as BoardRow;
}

function payload(rows: BoardRow[], extra: Partial<BoardPayload> = {}): BoardPayload {
  return {
    board: { inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: "2026-10-26T05:00:00Z", groups: [{ group: "service", rows }] },
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

const rowOf = (p: BoardPayload, name: string) => render(<Board payload={p} group="service" />).container.querySelector<HTMLElement>(`[data-service="${name}"]`)!;
const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);

describe("sentences in sans", () => {
  test("the offer's tag is a Chalk mono fact and the word is sans Smoke: no Ember on a read-only value", () => {
    const li = rowOf(payload([row("notes", { version: "1.4.0", available: "1.5.0", result: "deployed" })]), "notes");
    const label = li.querySelector("[data-offer] > span")!;
    assert.equal(label.textContent, "1.5.0 available");
    assert.ok(!classes(label).some((c) => c.includes("rose")), `the label is Ember: ${label.getAttribute("class")}`);
    assert.ok(!classes(label).includes("font-mono"));
    assert.ok(classes(label).includes("text-stone-400"));
    const tag = label.querySelector("span");
    assert.equal(tag?.textContent, "1.5.0");
    assert.deepEqual(classes(tag), ["font-mono", "text-stone-50"]);
  });

  test("the unknown sentence is Body, not mono", () => {
    const li = rowOf(payload([row("notes", { status: "unknown", version: "1.4.0", result: "deployed" })]), "notes");
    const p = Array.from(li.querySelectorAll("p")).find((x) => x.textContent?.startsWith("lychee-admin couldn't read"));
    assert.ok(p, "no unknown sentence");
    assert.equal(p.getAttribute("class"), BODY);
  });

  test("the deploy line's key is mono and its reason is not", () => {
    const li = rowOf(payload([row("swee", { version: "v2.11.4", result: "blocked", gateCode: "ci-pending", status: "running" } as Partial<BoardRow>)]), "swee");
    const line = li.querySelector("[data-deploy-state]")!;
    assert.ok(!classes(line).includes("font-mono"), "the whole line is mono");
    const key = line.querySelector("span")!;
    assert.deepEqual(classes(key), ["font-mono", ...TONE_TEXT.neutral.split(" ")]);
    const reason = line.querySelectorAll(":scope > span")[1];
    assert.ok(reason && !classes(reason).includes("font-mono"), "the reason is mono");
  });
});
