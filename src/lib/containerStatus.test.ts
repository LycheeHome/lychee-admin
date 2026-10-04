import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseComposePsOutput, parseServiceStatusOutput } from "./containerStatus";

describe("parseComposePsOutput", () => {
  test("treats empty output as a container that was never created", () => {
    assert.deepEqual(parseComposePsOutput(""), { state: "not-created" });
    assert.deepEqual(parseComposePsOutput("   \n  "), { state: "not-created" });
  });

  test("reads state and health from a JSON array", () => {
    const raw = JSON.stringify([{ State: "running", Health: "healthy" }]);
    assert.deepEqual(parseComposePsOutput(raw), { state: "running", health: "healthy" });
  });

  test("reads state and health from a single JSON object", () => {
    const raw = JSON.stringify({ State: "running", Health: "starting" });
    assert.deepEqual(parseComposePsOutput(raw), { state: "running", health: "starting" });
  });

  test("reads the first entry of newline-delimited JSON", () => {
    const raw = `${JSON.stringify({ State: "restarting", Health: "unhealthy" })}\n${JSON.stringify({ State: "exited" })}`;
    assert.deepEqual(parseComposePsOutput(raw), { state: "restarting", health: "unhealthy" });
  });

  test("maps created to not-created and dead to exited", () => {
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "created" }])), {
      state: "not-created",
      health: undefined,
    });
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "dead" }])), {
      state: "exited",
      health: undefined,
    });
  });

  test("is case-insensitive about state and health", () => {
    const raw = JSON.stringify([{ State: "RUNNING", Health: "HEALTHY" }]);
    assert.deepEqual(parseComposePsOutput(raw), { state: "running", health: "healthy" });
  });

  test("returns unknown for an unrecognized state", () => {
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "confused" }])), {
      state: "unknown",
      health: undefined,
    });
  });

  test("returns unknown for unparseable output", () => {
    assert.deepEqual(parseComposePsOutput("not json at all"), { state: "unknown" });
  });

  test("treats an empty JSON array as not-created", () => {
    assert.deepEqual(parseComposePsOutput("[]"), { state: "not-created" });
  });

  test("omits health when Docker reports none", () => {
    assert.deepEqual(parseComposePsOutput(JSON.stringify([{ State: "running" }])), {
      state: "running",
      health: undefined,
    });
  });
});

// Review Focus 4: the service path reuses the one compose parser rather than
// growing a second that must be kept correct against compose versions.
describe("parseServiceStatusOutput", () => {
  const one = (state: string, health = "") => JSON.stringify({ State: state, Health: health });

  test("absorbs both compose output shapes through parseComposePsOutput", () => {
    assert.equal(parseServiceStatusOutput(`[${one("running", "healthy")}]`), "running");
    assert.equal(parseServiceStatusOutput(`${one("running", "healthy")}\n`), "running");
  });

  test("keeps the states that must not be flattened", () => {
    assert.equal(parseServiceStatusOutput(one("running", "unhealthy")), "unhealthy");
    assert.equal(parseServiceStatusOutput(one("running", "starting")), "starting");
    assert.equal(parseServiceStatusOutput(one("paused")), "paused");
    assert.equal(parseServiceStatusOutput(one("exited")), "exited");
  });

  test("empty output (no compose file) is not deployed; garbage is unknown", () => {
    assert.equal(parseServiceStatusOutput(""), "not-created");
    assert.equal(parseServiceStatusOutput("not json"), "unknown");
  });
});
