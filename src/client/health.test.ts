import "./test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { seedHealth } from "./test/healthFixture";
import { HEALTH_QUERY, fetchHealth, findHintFor } from "./health";

// Moved from the retired RailIsland.test.tsx: the health query's own shape,
// its fetch, and the find hint's platform rule. How the rail shows the poll
// is AppFrame.test.tsx's ("the rail's health").

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
}

describe("the health query", () => {
  test("polls every 15s, only while visible, and again on focus", () => {
    assert.deepEqual(HEALTH_QUERY.queryKey, ["health"]);
    assert.equal(HEALTH_QUERY.refetchInterval, 15_000);
    assert.equal(HEALTH_QUERY.refetchIntervalInBackground, false);
    assert.equal(HEALTH_QUERY.refetchOnWindowFocus, true);
  });

  test("fetchHealth returns the payload without its envelope", async () => {
    stubFetch(200, { ok: true, ...seedHealth() });
    const health = await fetchHealth();
    assert.deepEqual(health, seedHealth());
  });

  test("fetchHealth throws the server's reason on a failed read", async () => {
    stubFetch(500, { ok: false, reason: "Could not read health: boom" });
    await assert.rejects(fetchHealth(), /Could not read health: boom/);
  });
});

describe("findHintFor", () => {
  test("⌘K on Apple platforms, Ctrl K everywhere else", () => {
    for (const apple of ["MacIntel", "iPhone", "iPad", "iPod"]) assert.equal(findHintFor(apple), "⌘K", apple);
    for (const other of ["Win32", "Linux x86_64", ""]) assert.equal(findHintFor(other), "Ctrl K", other);
  });
});
