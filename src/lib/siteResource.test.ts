import assert from "node:assert/strict";
import { test } from "node:test";
import { describe } from "node:test";
import {
  claimedPorts,
  confirmedDown,
  declaredTag,
  hostnameForResource,
  imageTag,
  normalizeRepo,
  parseDeclaration,
  pendingTag,
  resourceNameFor,
} from "./siteResource";

test("maps a hostname to its resource name", () => {
  assert.equal(resourceNameFor("test.lychee.land", "lychee.land"), "test-lychee-land");
  assert.equal(resourceNameFor("Test.lychee.land", "lychee.land"), "test-lychee-land");
  assert.equal(resourceNameFor("a.b.lychee.land", "lychee.land"), null);
  assert.equal(resourceNameFor("x".repeat(52) + ".lychee.land", "lychee.land"), null);
  assert.equal(resourceNameFor("x".repeat(51) + ".lychee.land", "lychee.land")?.length, 63);
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
    { name: "old-lychee-land", port: 3000, state: "absent", image: "" },
  ]);
  assert.equal(m.get(3000), "old-lychee-land");
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

test("hostnameForResource inverts resourceNameFor", () => {
  for (const h of ["test.lychee.land", "a-b.lychee.land"]) {
    assert.equal(hostnameForResource(resourceNameFor(h, "lychee.land")!, "lychee.land"), h);
  }
});

test("a non-site name maps to nothing", () => {
  assert.equal(hostnameForResource("palsave-api", "lychee.land"), null);
});

test("no resource name maps to the apex", () => {
  assert.equal(hostnameForResource("lychee-land", "lychee.land"), null);
});

describe("declaredTag", () => {
  const decl = (image: string, state = "present") => ({ name: "x", port: 3000, state, image });

  test("reads the tag from the last path segment", () => {
    assert.equal(declaredTag(decl("ghcr.io/lycheehome/app:0.3.0")), "0.3.0");
    assert.equal(declaredTag(decl("host:5000/app:1.2.0")), "1.2.0");
  });

  test("a registry port is never read as a tag", () => {
    assert.equal(declaredTag(decl("ghcr.io/lycheehome/app")), null);
    assert.equal(declaredTag(decl("host:5000/app")), null);
  });

  test("an empty tag is no tag", () => {
    assert.equal(declaredTag(decl("ghcr.io/lycheehome/app:")), null);
  });

  test("a digest is not a tag", () => {
    assert.equal(declaredTag(decl("ghcr.io/lycheehome/app@sha256:abc")), null);
  });

  test("an absent or missing declaration has no tag", () => {
    assert.equal(declaredTag(decl("ghcr.io/lycheehome/app:0.3.0", "absent")), null);
    assert.equal(declaredTag(undefined), null);
  });
});

describe("imageTag", () => {
  test("reads a tag from the last path segment, with no declaration or state involved", () => {
    assert.equal(imageTag("ghcr.io/lycheehome/app:0.3.0"), "0.3.0");
    assert.equal(imageTag("host:5000/app:1.2.0"), "1.2.0");
    for (const image of ["ghcr.io/lycheehome/app", "host:5000/app", "ghcr.io/lycheehome/app:", "ghcr.io/lycheehome/app@sha256:abc"]) {
      assert.equal(imageTag(image), null, image);
    }
  });
});

describe("confirmedDown", () => {
  const entry = (over: Record<string, unknown> = {}) =>
    ({ name: "gone-lychee-land", kind: "container", container: "gone-lychee-land", group: "service", reconciled: true, ...over }) as never;
  const decl = (image: string) => ({ name: "gone-lychee-land", port: 3400, state: "absent", image });
  const TAGLESS = decl("ghcr.io/lycheehome/gone");

  test("a completed down with nothing installed is confirmed", () => {
    assert.equal(confirmedDown(entry({ result: "deployed" }), TAGLESS), true);
  });

  test("awaiting-image is confirmed only for a tagless declaration", () => {
    assert.equal(confirmedDown(entry({ result: "awaiting-image" }), TAGLESS), true);
    // The tag is read from the image even though the declaration is absent.
    assert.equal(confirmedDown(entry({ result: "awaiting-image" }), decl("ghcr.io/lycheehome/gone:0.1.0")), false);
    assert.equal(confirmedDown(entry({ result: "awaiting-image" }), undefined), false);
  });

  test("an installed version, a failed down, no result or no entry is not confirmed", () => {
    assert.equal(confirmedDown(entry({ result: "deployed", version: "0.1.0" }), TAGLESS), false);
    assert.equal(confirmedDown(entry({ result: "failed" }), TAGLESS), false);
    assert.equal(confirmedDown(entry(), TAGLESS), false);
    assert.equal(confirmedDown(undefined, TAGLESS), false);
  });
});

describe("pendingTag", () => {
  test("a declared tag already applied is not pending", () => {
    assert.equal(pendingTag({ target: "0.3.0" }, "0.3.0"), null);
    assert.equal(pendingTag({ version: "0.3.0" }, "0.3.0"), null);
  });

  test("nothing declared is nothing pending", () => {
    assert.equal(pendingTag({ version: "0.2.0" }, null), null);
  });

  test("a declared tag differing from both version and target is pending", () => {
    assert.equal(pendingTag({ version: "0.2.0", target: "0.2.0" }, "0.3.0"), "0.3.0");
  });

  test("an entry with no version or target leaves the declared tag pending", () => {
    assert.equal(pendingTag({}, "0.1.0"), "0.1.0");
  });
});
