import { describe, test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import { getFrameworkScaffold, getScaffoldFiles } from "./frameworkScaffold";

describe("getFrameworkScaffold", () => {
  test("returns null for an unknown framework", () => {
    assert.equal(getFrameworkScaffold("sveltekit", "/"), null);
    assert.equal(getFrameworkScaffold("", "/"), null);
  });

  test("bakes the supplied healthcheck path into the Dockerfile", () => {
    const scaffold = getFrameworkScaffold("nextjs", "/api/health");
    assert.match(scaffold!.dockerfile, /HEALTHCHECK .*http:\/\/localhost:3000\/api\/health/);
  });

  test("uses exec-form CMD rather than a shell string", () => {
    const scaffold = getFrameworkScaffold("nextjs", "/");
    assert.match(scaffold!.dockerfile, /CMD \["npm","start"\]/);
  });

  test("lists exactly the Dockerfile, .dockerignore and release workflow, in that order", () => {
    const files = getScaffoldFiles("nextjs", "/");
    assert.deepEqual(files!.map((file) => file.name), [
      "Dockerfile",
      ".dockerignore",
      ".github/workflows/release.yml",
    ]);
  });

  test("the Dockerfile copies every Next config flavour create-next-app can emit", () => {
    const { dockerfile } = getFrameworkScaffold("nextjs", "/")!;
    assert.match(dockerfile, /\/app\/next\.config\.js\*/);
    assert.match(dockerfile, /\/app\/next\.config\.mjs\*/);
    assert.match(dockerfile, /\/app\/next\.config\.ts\*/);
  });

  describe("release workflow", () => {
    const { workflow } = getFrameworkScaffold("nextjs", "/")!;
    const parsed = yaml.load(workflow) as {
      on: { push: { tags: string[] } };
      permissions: Record<string, string>;
      jobs: Record<string, { "runs-on": string; steps: { uses?: string }[] }>;
    };

    test("fires on a v*.*.* tag only", () => {
      assert.deepEqual(parsed.on.push.tags, ["v*.*.*"]);
    });

    test("runs on GitHub's own runner and nowhere else", () => {
      const runners = Object.values(parsed.jobs).map((job) => job["runs-on"]);
      assert.deepEqual(runners, ["ubuntu-latest"]);
    });

    test("holds exactly contents: read and packages: write", () => {
      assert.deepEqual(parsed.permissions, { contents: "read", packages: "write" });
    });

    test("uses no action but checkout", () => {
      const uses = Object.values(parsed.jobs).flatMap((job) =>
        job.steps.flatMap((step) => (step.uses ? [step.uses] : [])),
      );
      assert.ok(uses.length > 0);
      for (const entry of uses) assert.match(entry, /^actions\/checkout@/);
    });

    test("derives a plain X.Y.Z tag, a lowercase image and a source label", () => {
      assert.ok(workflow.includes("${GITHUB_REF_NAME#v}"));
      assert.ok(workflow.includes("${GITHUB_REPOSITORY,,}"));
      assert.ok(workflow.includes("org.opencontainers.image.source"));
    });

    const REGEX_TEXT = String.raw`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$`;

    test("refuses any version that is not plain semver, before docker build", () => {
      assert.ok(workflow.includes(REGEX_TEXT), "guard regex missing or its dots unescaped");
      const guard = workflow.indexOf(REGEX_TEXT);
      assert.ok(guard < workflow.indexOf("docker build"), "guard must precede docker build");
      assert.ok(guard > workflow.indexOf('VERSION="'), "guard must follow VERSION");
      assert.match(workflow, /exit 1/);
    });

    test("the guard's regex accepts X.Y.Z and rejects what the host would never offer", () => {
      const re = new RegExp(REGEX_TEXT);
      for (const ok of ["1.2.3", "0.10.0"]) assert.ok(re.test(ok), ok);
      for (const bad of ["01.2.3", "1.2.3-rc1", "1.2"]) assert.ok(!re.test(bad), bad);
    });
  });

  test("generates nothing that names a runner we do not have, the host, or compose", () => {
    const files = getScaffoldFiles("nextjs", "/");
    assert.ok(files);
    for (const { name, content } of files) {
      assert.doesNotMatch(content, /self-hosted|lychee|docker-compose/, `${name} names something it must not`);
    }
  });

  test("the dockerignore drops the compose file and keeps .github out of the image", () => {
    const { dockerignore } = getFrameworkScaffold("nextjs", "/")!;
    assert.doesNotMatch(dockerignore, /docker-compose\.yml/);
    assert.match(dockerignore, /^\.github$/m);
  });

  test("reports the build and run commands it generated for", () => {
    const scaffold = getFrameworkScaffold("nextjs", "/");
    assert.equal(scaffold!.buildCommand, "npm run build");
    assert.equal(scaffold!.runCommand, "npm start");
    assert.match(scaffold!.dockerfile, /RUN npm run build/);
  });

  test("ignores node_modules and .next in the dockerignore", () => {
    const scaffold = getFrameworkScaffold("nextjs", "/");
    assert.match(scaffold!.dockerignore, /^node_modules$/m);
    assert.match(scaffold!.dockerignore, /^\.next$/m);
  });
});
