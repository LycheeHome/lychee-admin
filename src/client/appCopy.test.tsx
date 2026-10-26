import "./test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { act, cleanup, render } from "@testing-library/react";
import { Board } from "./components/BoardRows";
import { installSharedBindings } from "./sharedBindings";

// The bindings are installed once against a bare shell (just #copy-status),
// and the copy button is rendered by React AFTER that, so the only way it can
// copy is the document-level delegated listener.

afterEach(cleanup);
let uninstall: () => void = () => {};

const NOW = new Date("2026-10-02T05:00:00Z");
let writes: string[] = [];
let clipboardFails = false;

before(() => {
  document.body.innerHTML = '<span id="copy-status" class="sr-only" role="status" aria-live="polite"></span>';
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        if (clipboardFails) throw new Error("insecure context");
        writes.push(text);
      },
    },
  });
  uninstall = installSharedBindings(document);
});

after(() => uninstall());

/** A failed row renders the failure line's journal command and its copy button. */
function renderFailedRow() {
  const board = {
    inventoryAvailable: true,
    schedule: { next: null, last: null },
    timerUnit: null,
    generated: null,
    groups: [
      {
        group: "infrastructure" as const,
        rows: [
          {
            name: "caddy",
            kind: "unit" as const,
            unit: "caddy.service",
            group: "infrastructure" as const,
            reconciled: false,
            status: "running" as const,
            since: null,
            result: "failed",
          },
        ],
      },
    ],
  };
  return render(
    <Board
      payload={{ board, boardEmpty: false, now: NOW.toISOString(), domain: "lychee.land", prunable: [], retiring: [], managed: [], requested: {}, lastRuns: {} }}
      group="infrastructure"
    />,
  );
}

async function clickAndSettle(el: Element): Promise<void> {
  await act(async () => {
    // An SVG element has no click(); a bubbling event works for any element.
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("copy buttons rendered after the bindings were installed", () => {
  test("copy the command, swap the icon and announce it", async () => {
    writes = [];
    clipboardFails = false;
    const { container } = renderFailedRow();
    const button = container.querySelector('[data-copy-target="cmd-reconcile-log-caddy"]');
    assert.ok(button, "the failure line's copy button rendered");
    // Click the icon inside the button, as a pointer usually does.
    await clickAndSettle(button.querySelector('[data-copy-icon="idle"] svg')!);
    assert.deepEqual(writes, ['journalctl -u lychee-reconcile -u lychee-reconcile-app --since "1 hour ago"']);
    assert.equal(button.getAttribute("aria-label"), "Copied!");
    assert.equal(document.getElementById("copy-status")?.textContent, "Copied to clipboard");
    assert.ok(button.querySelector('[data-copy-icon="idle"]')?.classList.contains("hidden"));
    assert.ok(!button.querySelector('[data-copy-icon="copied"]')?.classList.contains("hidden"));
  });

  test("fall back to selecting the text when the clipboard is unavailable", async () => {
    writes = [];
    clipboardFails = true;
    const { container } = renderFailedRow();
    const button = container.querySelector('[data-copy-target="cmd-reconcile-log-caddy"]')!;
    await clickAndSettle(button);
    assert.deepEqual(writes, []);
    assert.equal(button.getAttribute("aria-label"), "Press Ctrl+C to copy");
    assert.equal(document.getElementById("copy-status")?.textContent, "Text selected — press Ctrl+C to copy");
    assert.ok(!button.querySelector('[data-copy-icon="idle"]')?.classList.contains("hidden"));
  });

  test("a click outside any copy button does nothing", async () => {
    writes = [];
    clipboardFails = false;
    const { container } = renderFailedRow();
    await clickAndSettle(container.querySelector("[data-service]")!);
    assert.deepEqual(writes, []);
  });
});
