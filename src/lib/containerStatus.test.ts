import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseComposePsOutput } from "./containerStatus";

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
