import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { offeredTag } from "./boardFacts";

// Moved from html.test.ts, which imported offeredTag through html.ts's
// re-export; that went with the server site page. The board and the site
// page both decide their offer with it.
describe("offeredTag", () => {
  test("a failed row offers a tag that is neither installed nor the one that failed", () => {
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result: "failed" }), "v1.6.0");
    assert.equal(offeredTag({ target: "0.1.0", available: "0.1.1", result: "failed" }), "0.1.1");
  });

  test("a failed row never re-offers the tag that failed, nor the installed one", () => {
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.5.0", available: "v1.5.0", result: "failed" }), null);
    assert.equal(offeredTag({ target: "0.1.0", available: "0.1.0", result: "failed" }), null);
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.5.0", available: "v1.4.0", result: "failed" }), null);
  });

  test("blocked, deployed and applying rows behave as before", () => {
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "blocked" }), "v1.5.0");
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.5.0", available: "v1.5.0", result: "blocked" }), null);
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "deployed" }), "v1.5.0");
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.4.0", available: "v1.4.0", result: "deployed" }), null);
    // Applying: a clean run with a moved pin. Nothing is offered on top of it.
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result: "deployed" }), null);
    assert.equal(offeredTag({ version: "v1.4.0", target: "v1.5.0", available: "v1.6.0", result: "skipped" }), null);
  });
});
