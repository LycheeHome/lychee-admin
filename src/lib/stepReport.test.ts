import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ADD_STEPS, REMOVE_STEPS, createStepReport } from "./stepReport";

const DEFS = [
  { id: "one", label: "First" },
  { id: "two", label: "Second" },
];

describe("createStepReport", () => {
  test("un-run steps report not-run, never ok", async () => {
    const report = createStepReport(DEFS);
    await report.run("one", async () => undefined);
    assert.deepEqual(report.steps(), [
      { id: "one", label: "First", status: "ok" },
      { id: "two", label: "Second", status: "not-run" },
    ]);
  });

  test("a failing step records failed and rethrows, leaving later steps not-run", async () => {
    const report = createStepReport(DEFS);
    await assert.rejects(
      () => report.run("one", async () => { throw new Error("boom"); }),
      /boom/,
    );
    assert.deepEqual(report.steps(), [
      { id: "one", label: "First", status: "failed" },
      { id: "two", label: "Second", status: "not-run" },
    ]);
  });

  test("skip distinguishes deliberately-inapplicable from blocked", async () => {
    const report = createStepReport(DEFS);
    report.skip("one");
    assert.equal(report.steps()[0].status, "skipped");
    assert.equal(report.steps()[1].status, "not-run");
  });

  test("run returns the wrapped value", async () => {
    const report = createStepReport(DEFS);
    assert.equal(await report.run("one", async () => 42), 42);
  });

  test("an unknown id is a programming error, not a silent no-op", async () => {
    const report = createStepReport(DEFS);
    await assert.rejects(() => report.run("nope", async () => undefined), /Unknown step "nope"/);
    assert.throws(() => report.skip("nope"), /Unknown step "nope"/);
  });

  test("the remove steps match the four the dialog promises, in order", () => {
    assert.deepEqual(
      REMOVE_STEPS.map((step) => step.label),
      [
        "Caddyfile block removed",
        "Tunnel route removed",
        "Caddy validated and reloaded",
        "cloudflared-sites restarted",
      ],
    );
  });

  test("the add steps name the sites tunnel, never just the tunnel", () => {
    const labels = ADD_STEPS.map((step) => step.label).join(" ");
    assert.match(labels, /cloudflared-sites restarted/);
    assert.doesNotMatch(labels, /\bthe tunnel\b/);
  });
});
