import "./test/setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { before, beforeEach, describe, test } from "node:test";
import { hideToast, showToast } from "./toast";

// The toast must be indistinguishable from public/app.js's showBanner, so the
// real script is loaded into the document and both write to the same banner.

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

type AppGlobals = { showBanner: (m: string, k: string, a?: { label: string; onClick: () => void }) => void; hideBanner: () => void };
const app = globalThis as unknown as AppGlobals;

before(() => {
  document.body.innerHTML = `${BANNER}<span id="copy-status" class="sr-only" role="status" aria-live="polite"></span>`;
  const source = readFileSync(path.join(__dirname, "../../public/app.js"), "utf8");
  // Indirect eval: global scope, as a <script> would run it.
  (0, eval)(source);
});

beforeEach(() => {
  app.hideBanner();
  document.getElementById("flash-banner-message")!.textContent = "";
});

const snapshot = () => document.getElementById("flash-banner")!.outerHTML;

describe("showToast", () => {
  for (const kind of ["info", "success", "error"] as const) {
    test(`${kind} writes exactly the markup app.js's showBanner writes`, () => {
      app.showBanner("Requesting 0.3.0 for app-lychee-land…", kind);
      const expected = snapshot();
      app.hideBanner();
      document.getElementById("flash-banner-message")!.textContent = "";
      showToast("Requesting 0.3.0 for app-lychee-land…", kind);
      assert.equal(snapshot(), expected);
    });
  }

  test("an action is labelled, revealed and run when pressed, like app.js's", () => {
    app.showBanner("Failed", "error", { label: "Retry", onClick: () => {} });
    const expected = snapshot();
    app.hideBanner();
    let ran = 0;
    showToast("Failed", "error", { label: "Retry", run: () => (ran += 1) });
    assert.equal(snapshot(), expected);
    (document.getElementById("flash-banner-action") as HTMLButtonElement).click();
    assert.equal(ran, 1);
  });

  test("the next toast drops the previous toast's action", () => {
    let ran = 0;
    showToast("Failed", "error", { label: "Retry", run: () => (ran += 1) });
    showToast("Requesting…", "info");
    const action = document.getElementById("flash-banner-action") as HTMLButtonElement;
    assert.ok(action.classList.contains("hidden"));
    assert.equal(action.textContent, "");
    action.click();
    assert.equal(ran, 0);
  });

  test("success dismisses itself after 4s, like app.js's", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    showToast("Done", "success");
    const banner = document.getElementById("flash-banner")!;
    assert.ok(!banner.classList.contains("hidden"));
    t.mock.timers.tick(3999);
    assert.ok(!banner.classList.contains("hidden"));
    t.mock.timers.tick(1);
    assert.ok(banner.classList.contains("hidden"));
  });
});

describe("hideToast", () => {
  test("leaves exactly the markup app.js's hideBanner leaves", () => {
    showToast("Requesting…", "info", { label: "Retry", run: () => {} });
    app.hideBanner();
    const expected = snapshot();
    showToast("Requesting…", "info", { label: "Retry", run: () => {} });
    hideToast();
    assert.equal(snapshot(), expected);
  });

  test("without a banner in the document, both are no-ops", () => {
    const saved = document.body.innerHTML;
    document.body.innerHTML = "";
    try {
      showToast("x", "info");
      hideToast();
    } finally {
      document.body.innerHTML = saved;
    }
  });
});
