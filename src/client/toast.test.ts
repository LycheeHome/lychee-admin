import "./test/setup";
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { hideToast, showToast } from "./toast";

const BANNER = `<div id="flash-banner" class="hidden fixed top-6" role="status" aria-live="polite">
  <span class="flex items-center gap-2 min-w-0">
    <span id="flash-banner-progress" class="hidden shrink-0"></span>
    <span id="flash-banner-message"></span>
  </span>
  <span class="flex items-center gap-2 shrink-0">
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden" aria-label="Dismiss">&times;</button>
  </span>
</div>`;

const el = (id: string) => document.getElementById(id)!;
const hidden = (id: string) => el(id).classList.contains("hidden");

beforeEach(() => {
  document.body.innerHTML = BANNER;
});

describe("showToast", () => {
  test("info: rose tone, progress dot, no close, no auto dismissal", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    showToast("Working…", "info");
    const banner = el("flash-banner");
    assert.ok(!hidden("flash-banner"));
    assert.ok(banner.classList.contains("bg-rose-950") && banner.classList.contains("border-rose-400/70"));
    assert.ok(!banner.classList.contains("bg-red-950/60"));
    assert.ok(!hidden("flash-banner-progress"));
    assert.ok(hidden("flash-banner-close"));
    assert.equal(el("flash-banner-message").textContent, "Working…");
    t.mock.timers.tick(60000);
    assert.ok(!hidden("flash-banner"));
  });

  test("error: red tone, close shown, no progress dot", () => {
    showToast("Failed", "error");
    const banner = el("flash-banner");
    assert.ok(banner.classList.contains("bg-red-950/60") && banner.classList.contains("border-red-400/70"));
    assert.ok(!banner.classList.contains("bg-rose-950"));
    assert.ok(hidden("flash-banner-progress"));
    assert.ok(!hidden("flash-banner-close"));
  });

  test("success: rose tone, no progress, no close", () => {
    showToast("Done", "success");
    assert.ok(el("flash-banner").classList.contains("bg-rose-950"));
    assert.ok(hidden("flash-banner-progress"));
    assert.ok(hidden("flash-banner-close"));
  });

  test("an action is labelled, revealed and run when pressed", () => {
    let ran = 0;
    showToast("Failed", "error", { label: "Retry", run: () => (ran += 1) });
    assert.ok(!hidden("flash-banner-action"));
    assert.equal(el("flash-banner-action").textContent, "Retry");
    el("flash-banner-action").click();
    assert.equal(ran, 1);
  });

  test("the next toast drops the previous toast's action", () => {
    let ran = 0;
    showToast("Failed", "error", { label: "Retry", run: () => (ran += 1) });
    showToast("Requesting…", "info");
    assert.ok(hidden("flash-banner-action"));
    assert.equal(el("flash-banner-action").textContent, "");
    el("flash-banner-action").click();
    assert.equal(ran, 0);
  });

  test("success dismisses itself after 4s", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    showToast("Done", "success");
    t.mock.timers.tick(3999);
    assert.ok(!hidden("flash-banner"));
    t.mock.timers.tick(1);
    assert.ok(hidden("flash-banner"));
  });
});

describe("hideToast", () => {
  test("hides the banner, the progress dot and the action, and clears the action", () => {
    let ran = 0;
    showToast("Working…", "info", { label: "Retry", run: () => (ran += 1) });
    hideToast();
    assert.ok(hidden("flash-banner"));
    assert.ok(hidden("flash-banner-progress"));
    assert.ok(hidden("flash-banner-action"));
    el("flash-banner-action").click();
    assert.equal(ran, 0);
  });

  test("without a banner in the document, both are no-ops", () => {
    document.body.innerHTML = "";
    showToast("x", "info");
    hideToast();
  });
});
