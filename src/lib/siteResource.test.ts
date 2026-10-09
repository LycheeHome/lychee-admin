import assert from "node:assert/strict";
import { test } from "node:test";
import { claimedPorts, normalizeRepo, parseDeclaration, resourceNameFor } from "./siteResource";

test("maps a hostname to its resource name", () => {
  assert.equal(resourceNameFor("test.lyly.dev", "lyly.dev"), "test-lyly-dev");
  assert.equal(resourceNameFor("Test.lyly.dev", "lyly.dev"), "test-lyly-dev");
  assert.equal(resourceNameFor("a.b.lyly.dev", "lyly.dev"), null);
  assert.equal(resourceNameFor("x".repeat(55) + ".lyly.dev", "lyly.dev"), null);
  assert.equal(resourceNameFor("x".repeat(54) + ".lyly.dev", "lyly.dev")?.length, 63);
});

test("normalizes a repository name", () => {
  assert.deepEqual(normalizeRepo(" Test-Site "), { ok: true, repo: "test-site" });
  for (const bad of ["", "a/b", "../x", "x:1", "ghcr.io/lycheehome/x", "-x", "x-"]) {
    assert.equal(normalizeRepo(bad).ok, false, bad);
  }
});

test("claimedPorts counts absent declarations too", () => {
  const m = claimedPorts([
    { name: "palsave-api", port: 8788, state: "running", image: "" },
    { name: "old-lyly-dev", port: 3000, state: "absent", image: "" },
  ]);
  assert.equal(m.get(3000), "old-lyly-dev");
});

test("parseDeclaration tolerates garbage", () => {
  assert.equal(parseDeclaration("x", ": : :"), null);
  assert.equal(parseDeclaration("x", "- a\n- b"), null);
});

test("parseDeclaration reads a declaration", () => {
  assert.deepEqual(parseDeclaration("t", "port: 3000\nstate: running\nimage: ghcr.io/a/b:1\n"), {
    name: "t",
    port: 3000,
    state: "running",
    image: "ghcr.io/a/b:1",
  });
});

test("resourceNameFor derives the suffix from the domain", () => {
  assert.equal(resourceNameFor("blog.lychee.land", "lychee.land"), "blog-lychee-land");
  assert.equal(resourceNameFor("blog.example.test", "example.test"), "blog-example-test");
  assert.equal(resourceNameFor("x".repeat(52) + ".lychee.land", "lychee.land"), null);
  assert.equal(resourceNameFor("x".repeat(51) + ".lychee.land", "lychee.land")?.length, 63);
});
