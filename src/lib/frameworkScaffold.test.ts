import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getFrameworkScaffold } from "./frameworkScaffold";

describe("getFrameworkScaffold", () => {
  test("returns null for an unknown framework", () => {
    assert.equal(getFrameworkScaffold("sveltekit", "3000", "app.lyly.dev", "/var/www", "/"), null);
    assert.equal(getFrameworkScaffold("", "3000", "app.lyly.dev", "/var/www", "/"), null);
  });

  test("binds the container to localhost only, never all interfaces", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.compose, /- "127\.0\.0\.1:3000:3000"/);
    assert.doesNotMatch(scaffold!.compose, /- "0\.0\.0\.0:/);
  });

  test("bakes the supplied healthcheck path into the Dockerfile", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/api/health");
    assert.match(scaffold!.dockerfile, /HEALTHCHECK .*http:\/\/localhost:3000\/api\/health/);
  });

  test("uses exec-form CMD rather than a shell string", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.dockerfile, /CMD \["npm","start"\]/);
  });

  test("points the deploy workflow at sitesRoot/hostname", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.deployWorkflow, /\/var\/www\/app\.lyly\.dev\//);
    assert.match(scaffold!.deployWorkflow, /name: Deploy app\.lyly\.dev/);
  });

  test("keeps the generated container files out of the deploy rsync", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    for (const excluded of ["Dockerfile", "docker-compose.yml", ".dockerignore"]) {
      assert.match(scaffold!.deployWorkflow, new RegExp(`--exclude='${excluded.replace(".", "\\.")}'`));
    }
  });

  test("reports the build and run commands it generated for", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.equal(scaffold!.buildCommand, "npm run build");
    assert.equal(scaffold!.runCommand, "npm start");
    assert.match(scaffold!.dockerfile, /RUN npm run build/);
  });

  test("ignores node_modules and .next in the dockerignore", () => {
    const scaffold = getFrameworkScaffold("nextjs", "3000", "app.lyly.dev", "/var/www", "/");
    assert.match(scaffold!.dockerignore, /^node_modules$/m);
    assert.match(scaffold!.dockerignore, /^\.next$/m);
  });
});
