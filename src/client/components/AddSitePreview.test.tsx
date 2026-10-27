import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { ADD_STEPS } from "../../lib/stepReport";
import { resultMarks } from "../addSiteModel";
import { AddSitePreview, type AddSitePreviewProps } from "./AddSitePreview";

afterEach(() => cleanup());

const props = (over: Partial<AddSitePreviewProps>): AddSitePreviewProps => ({
  paths: { caddyfilePath: "/etc/caddy/Caddyfile", tunnelConfigPath: "/etc/cloudflared/sites-config.yml" },
  steps: [...ADD_STEPS],
  panel: { kind: "rest" },
  marks: {},
  skipped: [],
  previewErrorRef: null,
  previewErrorClass: "hidden",
  previewErrorText: "",
  ...over,
});

const row = (container: HTMLElement, id: string) => container.querySelector(`[data-step-id="${id}"]`);

// Critique 2026-10-27 P2: a skipped step says `skipped` beside its label, in a
// word a listener hears, and leaves the mark slot empty. The frozen dual run
// excludes the files row (AddSiteParity.test.tsx), so these hold it.
describe("the step list's skipped step", () => {
  test("a submit's result that skipped a step says so beside its label, over the type", () => {
    const marks = resultMarks([
      { id: "backup", status: "ok" },
      { id: "files", status: "skipped" },
      { id: "caddy", status: "failed" },
    ]);
    const { container } = render(<AddSitePreview {...props({ marks })} />);
    assert.equal(row(container, "files")?.querySelector("[data-step-skipped]")?.textContent, "· skipped");
    assert.equal(row(container, "files")?.querySelector(".step-mark")?.textContent, "");
    assert.equal(row(container, "caddy")?.querySelector(".step-mark")?.textContent, "✗");
  });

  test("a step the type skips but the submit ran shows the run's mark, not skipped", () => {
    const marks = resultMarks([{ id: "files", status: "ok" }]);
    const { container } = render(<AddSitePreview {...props({ marks, skipped: ["files"] })} />);
    assert.equal(row(container, "files")?.querySelector("[data-step-skipped]"), null);
    assert.equal(row(container, "files")?.querySelector(".step-mark")?.textContent, "✓");
  });

  test("the dot before the word is decoration", () => {
    const { container } = render(<AddSitePreview {...props({ skipped: ["files"] })} />);
    assert.equal(row(container, "files")?.querySelector('[data-step-skipped] [aria-hidden="true"]')?.textContent, "· ");
  });
});
