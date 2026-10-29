import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { listContractDir, loadContractText } from "../dev/contract";
import { parseReconcilerEvents, readReconcilerEvents } from "./reconcilerEvents";

// fakes.ts imports config, which reads the environment when evaluated.
async function memoryFs() {
  process.env.ADMIN_USERNAME ??= "tester";
  process.env.ADMIN_PASSWORD_HASH ??= "x";
  process.env.DOMAIN ??= "lychee.land";
  const { createInMemoryFileSystem } = await import("../dev/fakes");
  return createInMemoryFileSystem();
}

const AT = "2026-10-01T00:00:00Z";
const life = (over: Record<string, unknown> = {}) => ({
  id: "a",
  name: "swee",
  kind: "container",
  added_at: AT,
  removed_at: null,
  events: [],
  ...over,
});
const file = (...lifetimes: unknown[]) => JSON.stringify({ lifetimes });

describe("parseReconcilerEvents", () => {
  test("every valid contract example parses", () => {
    for (const name of listContractDir("examples/events/valid")) {
      const text = loadContractText(`examples/events/valid/${name}`);
      const parsed = parseReconcilerEvents(text);
      assert.ok(parsed, name);
      assert.equal(parsed.length, JSON.parse(text).lifetimes.length, name);
    }
  });

  test("no invalid contract example throws", () => {
    for (const name of listContractDir("examples/events/invalid")) {
      if (name === "expected.json") continue;
      const text = loadContractText(`examples/events/invalid/${name}`);
      assert.doesNotThrow(() => parseReconcilerEvents(text), name);
    }
  });

  test("a missing file is no history", async () => {
    assert.equal(readReconcilerEvents(await memoryFs()), null);
  });

  test("a file that throws on read is no history", async () => {
    const fs = await memoryFs();
    fs.writeFile("/e.json", "{}");
    const throwing = { ...fs, exists: () => true, readFile: () => { throw new Error("EACCES"); } };
    assert.equal(readReconcilerEvents(throwing, "/e.json"), null);
  });

  test("unparseable JSON is no history", () => {
    assert.equal(parseReconcilerEvents("{"), null);
  });

  test("a wrong top-level shape is no history", () => {
    assert.equal(parseReconcilerEvents('{"lifetimes": 3}'), null);
    assert.equal(parseReconcilerEvents("[]"), null);
  });

  test("an unknown type and unknown fields are dropped", () => {
    const raw = file(life({ events: [{ at: AT, type: "added", extra: 1 }, { at: AT, type: "teleported" }] }));
    assert.deepEqual(parseReconcilerEvents(raw)![0].events, [{ at: AT, type: "added" }]);
  });

  test("a known type missing a required field drops that event, not the file", () => {
    const raw = file(life({ events: [{ at: AT, type: "deployed", from: null }, { at: AT, type: "added" }] }));
    assert.deepEqual(parseReconcilerEvents(raw)![0].events, [{ at: AT, type: "added" }]);
  });

  test("a down event with a null from is dropped: the schema requires a string", () => {
    const raw = file(life({ events: [{ at: AT, type: "down", from: null }, { at: AT, type: "added" }] }));
    assert.deepEqual(parseReconcilerEvents(raw)![0].events, [{ at: AT, type: "added" }]);
  });

  test("a lifetime missing a required field is dropped on its own", () => {
    const raw = file(life({ id: undefined }), life({ id: "b" }));
    assert.deepEqual(parseReconcilerEvents(raw)!.map((l) => l.id), ["b"]);
  });

  test("of two open lifetimes for one name, only the later added_at is open", () => {
    const raw = file(
      life({ id: "a", added_at: "2026-10-01T00:00:00Z" }),
      life({ id: "b", added_at: "2026-10-02T00:00:00Z" }),
      life({ id: "c", name: "other", removed_at: AT }),
    );
    assert.deepEqual(parseReconcilerEvents(raw)!.map((l) => l.open), [false, true, false]);
  });

  test("last is never read", () => {
    const parsed = parseReconcilerEvents(file(life({ last: "garbage" })))!;
    assert.equal(parsed.length, 1);
    assert.equal("last" in parsed[0], false);
  });

  test("blocked keeps gate_code and gate", () => {
    const raw = file(life({ events: [{ at: AT, type: "blocked", gate_code: "ci-pending", gate: "CI is still running" }] }));
    assert.deepEqual(parseReconcilerEvents(raw)![0].events[0], { at: AT, type: "blocked", gate_code: "ci-pending", gate: "CI is still running" });
  });

  test("every event type keeps exactly its fields", () => {
    const events = [
      { at: AT, type: "added" },
      { at: AT, type: "deployed", from: null, to: "1.0.0" },
      { at: AT, type: "stopped" },
      { at: AT, type: "down", from: "1.0.0" },
      { at: AT, type: "failed", failed_step: "pull" },
      { at: AT, type: "blocked", gate_code: "x" },
      { at: AT, type: "awaiting-image" },
      { at: AT, type: "recovered", from: "failed", from_gate_code: null, attempts: 2 },
      { at: AT, type: "removed" },
    ];
    assert.deepEqual(parseReconcilerEvents(file(life({ events })))![0].events, events);
  });
});
