import "./test/setup";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { installSharedBindings } from "./sharedBindings";
import { showToast } from "./toast";

const BODY = `
<div id="page-notice"><button type="button" id="page-notice-close">x</button></div>
<div id="flash-banner" class="hidden">
  <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
  <button type="button" id="flash-banner-action" class="hidden"></button>
  <button type="button" id="flash-banner-close" class="hidden">x</button>
</div>
<span id="copy-status"></span>
<pre id="cmd">echo hi</pre>
<button type="button" id="copy-btn" data-copy-target="cmd" aria-label="Copy command">
  <svg data-copy-icon="idle"></svg><svg data-copy-icon="copied" class="hidden"></svg>
</button>`;

const clipboard = (impl: (text: string) => Promise<void> | void) => {
  Object.defineProperty(globalThis.navigator, "clipboard", { value: { writeText: async (t: string) => impl(t) }, configurable: true });
};
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const btn = () => document.getElementById("copy-btn") as HTMLButtonElement;
const status = () => document.getElementById("copy-status")!.textContent;
const idle = () => btn().querySelector('[data-copy-icon="idle"]')!;
const copied = () => btn().querySelector('[data-copy-icon="copied"]')!;

let uninstall: () => void;
beforeEach(() => {
  document.body.innerHTML = BODY;
  uninstall = installSharedBindings(document);
});
afterEach(() => uninstall());

describe("copy buttons", () => {
  test("success shows Copied! and resets after 1500 ms", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let written = "";
    clipboard((text) => void (written = text));
    btn().click();
    await flush();
    assert.equal(written, "echo hi");
    assert.equal(btn().getAttribute("aria-label"), "Copied!");
    assert.equal(status(), "Copied to clipboard");
    assert.ok(idle().classList.contains("hidden"));
    assert.ok(!copied().classList.contains("hidden"));
    t.mock.timers.tick(1500);
    assert.equal(btn().getAttribute("aria-label"), "Copy command");
    assert.equal(status(), "");
    assert.ok(!idle().classList.contains("hidden"));
    assert.ok(copied().classList.contains("hidden"));
  });

  test("failure selects the text and says to press Ctrl+C", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    clipboard(() => {
      throw new Error("denied");
    });
    btn().click();
    await flush();
    assert.equal(btn().getAttribute("aria-label"), "Press Ctrl+C to copy");
    assert.equal(status(), "Text selected — press Ctrl+C to copy");
    assert.ok(!idle().classList.contains("hidden"));
    t.mock.timers.tick(1500);
    assert.equal(btn().getAttribute("aria-label"), "Copy command");
  });

  test("two clicks 500 ms apart rest 1500 ms after the second", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    clipboard(() => {});
    btn().click();
    await flush();
    t.mock.timers.tick(500);
    btn().click();
    await flush();
    t.mock.timers.tick(1499);
    assert.equal(btn().getAttribute("aria-label"), "Copied!");
    assert.equal(status(), "Copied to clipboard");
    t.mock.timers.tick(1);
    assert.equal(btn().getAttribute("aria-label"), "Copy command");
    assert.equal(status(), "");
    assert.ok(!idle().classList.contains("hidden"));
    assert.ok(copied().classList.contains("hidden"));
  });

  test("a click inside a button added later still works", async () => {
    clipboard(() => {});
    document.body.insertAdjacentHTML(
      "beforeend",
      `<pre id="late">y</pre><button id="late-btn" data-copy-target="late"><span id="inner">c</span></button>`,
    );
    document.getElementById("inner")!.click();
    await flush();
    assert.equal(document.getElementById("late-btn")!.getAttribute("aria-label"), "Copied!");
  });

  test("uninstalled, a click does nothing", async () => {
    clipboard(() => {});
    uninstall();
    btn().click();
    await flush();
    assert.equal(btn().getAttribute("aria-label"), "Copy command");
  });
});

describe("closes", () => {
  // The page notice is React's (PageNotice, with its own close; AppFrame.test.tsx's
  // "its close removes it"): the document-level binding must never remove a node React owns.
  test("#page-notice-close is left to React: the binding does not remove #page-notice", () => {
    document.getElementById("page-notice-close")!.click();
    assert.ok(document.getElementById("page-notice"));
  });

  test("#flash-banner-close hides the toast", () => {
    showToast("Failed", "error");
    const banner = document.getElementById("flash-banner")!;
    assert.ok(!banner.classList.contains("hidden"));
    document.getElementById("flash-banner-close")!.click();
    assert.ok(banner.classList.contains("hidden"));
  });
});
