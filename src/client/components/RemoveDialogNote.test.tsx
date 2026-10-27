import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { seedSiteDetailPayload } from "../../dev/testHelpers";
import { SiteDetail } from "./SiteDetail";

afterEach(() => cleanup());

// The remove dialog's step-5 note names three machine facts; each is mono
// (the Mono-Carries-Facts rule; critique 2026-10-26 found lychee-resources in sans).
test("the remove dialog's step-5 note sets every fact in mono, lychee-resources included", async () => {
  const { payload } = await seedSiteDetailPayload("app.lychee.land");
  const { container } = render(<SiteDetail payload={payload} />);
  const note = Array.from(container.querySelectorAll("dialog p")).find((p) => p.textContent?.startsWith("Step 5 is what stops the container"));
  assert.ok(note, "no step-5 note");
  assert.deepEqual(
    Array.from(note.querySelectorAll("span.font-mono")).map((s) => s.textContent),
    ["state: absent", "app-lychee-land.yml", "lychee-resources"],
  );
});
