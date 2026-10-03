import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getFrameworkScaffold, getScaffoldFiles } from "./frameworkScaffold";

describe("getFrameworkScaffold", () => {
  test("returns null for an unknown framework", () => {
    assert.equal(getFrameworkScaffold("sveltekit", "3000", "/"), null);
    assert.equal(getFrameworkScaffold("", "3000", "/"), null);
  });

  test("binds the container to localhost only, never all interfaces", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "/");
    assert.match(scaffold!.compose, /- "127\.0\.0\.1:3000:3000"/);
    assert.doesNotMatch(scaffold!.compose, /- "0\.0\.0\.0:/);
  });

  test("bakes the supplied healthcheck path into the Dockerfile", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "/api/health");
    assert.match(scaffold!.dockerfile, /HEALTHCHECK .*http:\/\/localhost:3000\/api\/health/);
  });

  test("uses exec-form CMD rather than a shell string", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "/");
    assert.match(scaffold!.dockerfile, /CMD \["npm","start"\]/);
  });

  test("generates nothing that assumes a CI runner the user does not have", () => {
    const files = getScaffoldFiles("nextjs", "3000", "/");
    assert.ok(files);
    for (const { name, content } of files) {
      // The org-level self-hosted runner was retired 2026-09-28, and a
      // scaffolded site in the user's own repo could never have reached it
      // anyway. Nothing generated here may name a runner or a workflow.
      assert.doesNotMatch(content, /self-hosted|runs-on/, `${name} assumes a CI runner`);
    }
  });

  test("reports the build and run commands it generated for", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "/");
    assert.equal(scaffold!.buildCommand, "npm run build");
    assert.equal(scaffold!.runCommand, "npm start");
    assert.match(scaffold!.dockerfile, /RUN npm run build/);
  });

  test("ignores node_modules and .next in the dockerignore", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "/");
    assert.match(scaffold!.dockerignore, /^node_modules$/m);
    assert.match(scaffold!.dockerignore, /^\.next$/m);
  });
});
