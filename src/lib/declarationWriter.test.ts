import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { load } from "js-yaml";
import {
  createSiteDeclaration,
  readDeclarations,
  setDeclarationState,
  writeDeclarationTag,
  type GitRunner,
} from "./declarationWriter";

const DECLARATION = `# Why this exists: a long explanatory comment
# that must survive a write.
name: palsave-api
image: ghcr.io/lycheehome/palsave-api:sha-old   # pinned
state: stopped
`;

let root: string;
let clone: string;
let key: string;
let calls: { args: string[]; cwd: string; sshCommand?: string }[];

function fakeGit(
  opts: { failOn?: string; unhealthy?: boolean; onPull?: (cwd: string) => void } = {},
): GitRunner {
  return async (args, { cwd, env }) => {
    calls.push({ args, cwd, sshCommand: env.GIT_SSH_COMMAND });
    const verb = args.includes("commit") ? "commit" : args[0];
    if (opts.failOn === verb) throw Object.assign(new Error("git failed"), { stderr: "! [rejected] (fetch first)" });
    if (verb === "rev-parse" && opts.unhealthy) throw new Error("not a git repository");
    if (verb === "pull") opts.onPull?.(cwd);
    if (verb === "clone") {
      fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "palsave-api.yml"), DECLARATION);
    }
    return { stdout: "", stderr: "" };
  };
}

function seedClone(extra: Record<string, string> = {}) {
  fs.mkdirSync(path.join(clone, ".git"), { recursive: true });
  fs.writeFileSync(path.join(clone, "palsave-api.yml"), DECLARATION);
  for (const [file, content] of Object.entries(extra)) fs.writeFileSync(path.join(clone, file), content);
}

const SITE_TAGLESS = `# Written by lyly-admin for test.lyly.dev.
name: test-lyly-dev
image: ghcr.io/lycheehome/test-site   # tag written by Deploy
state: running   # flipped by Remove
port: 3000
bind: 127.0.0.1
`;

const commits = () => calls.filter((c) => c.args.includes("commit"));
const commitMessage = () => {
  const commit = commits()[0];
  return commit?.args[commit.args.indexOf("-m") + 1];
};
const resets = () => calls.filter((c) => c.args[0] === "reset");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "decl-"));
  clone = path.join(root, "clone");
  key = path.join(root, "key");
  fs.writeFileSync(key, "k");
  calls = [];
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("writeDeclarationTag", () => {
  test("writes only the named declaration's tag, leaving other fields byte-identical", async () => {
    seedClone();
    const result = await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.deepEqual(result, { ok: true });
    assert.equal(
      fs.readFileSync(path.join(clone, "palsave-api.yml"), "utf8"),
      DECLARATION.replace("sha-old", "sha-new"),
    );
  });

  test("a rejected push is reported, not forced", async () => {
    seedClone();
    const result = await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit({ failOn: "push" }), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /rejected/);
    assert.equal(calls.filter((c) => c.args[0] === "push").length, 1);
  });

  test("a missing key returns ok:false with a stated reason", async () => {
    seedClone();
    const result = await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit(), clonePath: clone, keyPath: path.join(root, "nope") });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Deploy key not found/);
    assert.equal(calls.length, 0);
  });

  test("an unreadable clone is re-cloned rather than failing", async () => {
    seedClone();
    const result = await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit({ unhealthy: true }), clonePath: clone, keyPath: key });
    assert.deepEqual(result, { ok: true });
    assert.ok(calls.some((c) => c.args[0] === "clone"));
  });

  test("refuses a tag that is not a tag, before touching git", async () => {
    for (const bad of ["", "-x", "a:b", "a/b", "a b", "x".repeat(129)]) {
      const result = await writeDeclarationTag("palsave-api", bad, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.equal(result.ok, false, bad);
    }
    assert.equal(calls.length, 0);
  });

  test("never changes the registry or repository, only the part after the final colon", async () => {
    seedClone();
    await writeDeclarationTag("palsave-api", "v2", { git: fakeGit(), clonePath: clone, keyPath: key });
    const text = fs.readFileSync(path.join(clone, "palsave-api.yml"), "utf8");
    assert.match(text, /^image: ghcr\.io\/lycheehome\/palsave-api:v2 {3}# pinned$/m);
  });

  test("never invokes git with --force or +refspec", async () => {
    seedClone();
    await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit(), clonePath: clone, keyPath: key });
    await writeDeclarationTag("palsave-api", "sha-newer", { git: fakeGit({ failOn: "push" }), clonePath: clone, keyPath: key });
    assert.ok(calls.length > 0);
    for (const { args } of calls) {
      for (const arg of args) {
        assert.doesNotMatch(arg, /^--force|^-f$|^\+|force-with-lease/, `forbidden argv: ${args.join(" ")}`);
      }
    }
    const push = calls.find((c) => c.args[0] === "push");
    assert.deepEqual(push?.args, ["push", "origin", "HEAD"]);
  });

  test("every git invocation runs inside the resources clone, nowhere else", async () => {
    seedClone();
    await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit(), clonePath: clone, keyPath: key });
    await writeDeclarationTag("palsave-api", "sha-x", { git: fakeGit({ unhealthy: true }), clonePath: clone, keyPath: key });
    assert.ok(calls.length > 0);
    for (const { cwd, args } of calls) {
      assert.equal(cwd, clone, `git ${args.join(" ")} ran in ${cwd}`);
    }
  });

  test("ssh is told its key, its known_hosts and how to treat a new host, without relying on $HOME", async () => {
    seedClone();
    await writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.ok(calls.length > 0);
    for (const { args, sshCommand } of calls) {
      assert.ok(sshCommand, `git ${args.join(" ")} got no GIT_SSH_COMMAND`);
      assert.ok(sshCommand.includes(`-i ${key}`), `missing -i key: ${sshCommand}`);
      assert.ok(sshCommand.includes("-o IdentitiesOnly=yes"), `missing IdentitiesOnly: ${sshCommand}`);
      assert.ok(
        sshCommand.includes("-o UserKnownHostsFile=/etc/lyly-admin/known_hosts"),
        `missing UserKnownHostsFile: ${sshCommand}`,
      );
      assert.ok(
        sshCommand.includes("-o StrictHostKeyChecking=yes"),
        `missing StrictHostKeyChecking=yes: ${sshCommand}`,
      );
    }
  });
});

describe("createSiteDeclaration", () => {
  test("writes exactly the five site fields, commits an attach message and pushes", async () => {
    seedClone();
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.deepEqual(result, { ok: true });
    const text = fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8");
    assert.deepEqual(load(text), {
      name: "test-lyly-dev",
      image: "ghcr.io/lycheehome/test-site",
      state: "running",
      port: 3000,
      bind: "127.0.0.1",
    });
    assert.match(text, /^# .*lyly-admin.*test\.lyly\.dev/);
    assert.match(text.split("\n")[1], /^# .*tagless.*Deploy/);
    assert.equal(commitMessage(), "test-lyly-dev: attach ghcr.io/lycheehome/test-site");
    const push = calls.find((c) => c.args[0] === "push");
    assert.deepEqual(push?.args, ["push", "origin", "HEAD"]);
    const add = calls.find((c) => c.args[0] === "add");
    assert.deepEqual(add?.args, ["add", "--", "test-lyly-dev.yml"]);
  });

  test("normalizes the repository before writing it", async () => {
    seedClone();
    await createSiteDeclaration("test-lyly-dev", "  Test-Site ", 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
    const doc = load(fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8")) as { image: string };
    assert.equal(doc.image, "ghcr.io/lycheehome/test-site");
  });

  test("refuses when the declaration already exists, committing nothing", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 4000, { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /already exists/);
    assert.equal(commits().length, 0);
    assert.equal(fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8"), SITE_TAGLESS);
  });

  test("an existing absent declaration is refused with a pointer to prune it", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running", "state: absent") });
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 4000, { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /prune/);
    assert.equal(commits().length, 0);
  });

  test("refuses a port another declaration claims, naming it", async () => {
    seedClone({ "other-lyly-dev.yml": SITE_TAGLESS.replace(/test-lyly-dev/g, "other-lyly-dev") });
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /other-lyly-dev/);
    assert.equal(commits().length, 0);
    assert.equal(fs.existsSync(path.join(clone, "test-lyly-dev.yml")), false);
  });

  test("an absent declaration still reserves its port", async () => {
    seedClone({
      "other-lyly-dev.yml": SITE_TAGLESS.replace(/test-lyly-dev/g, "other-lyly-dev").replace("state: running", "state: absent"),
    });
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /other-lyly-dev/);
  });

  test("checks for conflicts after a fresh pull, not against a stale clone", async () => {
    seedClone();
    const git = fakeGit({
      onPull: (cwd) => fs.writeFileSync(path.join(cwd, "test-lyly-dev.yml"), SITE_TAGLESS),
    });
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 4000, { git, clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.ok(calls.some((c) => c.args[0] === "pull"));
    assert.equal(commits().length, 0);
  });

  test("refuses a name that is not a site name, before touching git", async () => {
    seedClone();
    for (const bad of [
      "test",
      "palsave-api",
      "-lyly-dev",
      "test-lyly-devx",
      "Test-lyly-dev",
      "test-lyly-dev.yml",
      "../test-lyly-dev",
      "-test-lyly-dev",
      "test--lyly-dev",
      `${"a".repeat(55)}-lyly-dev`,
    ]) {
      const result = await createSiteDeclaration(bad, "test-site", 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.equal(result.ok, false, bad);
    }
    assert.equal(calls.length, 0);
  });

  test("accepts a name at the 63-character cap", async () => {
    seedClone();
    const name = `${"a".repeat(54)}-lyly-dev`;
    assert.equal(name.length, 63);
    const result = await createSiteDeclaration(name, "test-site", 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.deepEqual(result, { ok: true });
  });

  test("refuses a repository that fails normalizeRepo, before touching git", async () => {
    for (const bad of ["", "has space", "a//b", "lycheehome/test-site", "-x"]) {
      const result = await createSiteDeclaration("test-lyly-dev", bad, 3000, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.equal(result.ok, false, bad);
    }
    assert.equal(calls.length, 0);
  });

  test("refuses privileged and out-of-range ports, before touching git", async () => {
    for (const bad of [0, 80, 443, 1023]) {
      const result = await createSiteDeclaration("test-lyly-dev", "test-site", bad, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.equal(result.ok, false, String(bad));
      if (!result.ok) assert.match(result.reason, /privileged/, String(bad));
    }
    for (const bad of [65536, 70000, 3000.5, Number.NaN, -1]) {
      const result = await createSiteDeclaration("test-lyly-dev", "test-site", bad, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.equal(result.ok, false, String(bad));
    }
    assert.equal(calls.length, 0);
  });

  test("accepts the port bounds 1024 and 65535", async () => {
    seedClone();
    for (const [name, port] of [["a-lyly-dev", 1024], ["b-lyly-dev", 65535]] as const) {
      const result = await createSiteDeclaration(name, "test-site", port, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.deepEqual(result, { ok: true }, String(port));
    }
  });

  test("a rejected push resets to the upstream and is reported", async () => {
    seedClone();
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, { git: fakeGit({ failOn: "push" }), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /rejected/);
    assert.deepEqual(resets().map((c) => c.args), [["reset", "--hard", "@{upstream}"]]);
  });
});

describe("writeDeclarationTag on a tagless image", () => {
  test("completes the tag, keeping the trailing comment", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await writeDeclarationTag("test-lyly-dev", "0.1.0", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.deepEqual(result, { ok: true });
    assert.equal(
      fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8"),
      SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site ", "ghcr.io/lycheehome/test-site:0.1.0 "),
    );
    assert.equal(commitMessage(), "test-lyly-dev: set image tag to 0.1.0");
  });

  test("completes a quoted tagless image inside its quotes", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site", `"ghcr.io/lycheehome/test-site"`) });
    await writeDeclarationTag("test-lyly-dev", "0.1.0", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.match(
      fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8"),
      /^image: "ghcr\.io\/lycheehome\/test-site:0\.1\.0" {3}# tag written by Deploy$/m,
    );
  });

  test("a tagged site file is retagged as before", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("test-site ", "test-site:0.1.0 ") });
    await writeDeclarationTag("test-lyly-dev", "0.2.0", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.match(
      fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8"),
      /^image: ghcr\.io\/lycheehome\/test-site:0\.2\.0 {3}# tag written by Deploy$/m,
    );
  });

  test("refuses a tagless image outside ghcr.io", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site", "docker.io/library/nginx") });
    const result = await writeDeclarationTag("test-lyly-dev", "0.1.0", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("refuses when there is one tagged and one tagless image line", async () => {
    seedClone({
      "test-lyly-dev.yml": `${SITE_TAGLESS}image: ghcr.io/lycheehome/other:1\n`,
    });
    const result = await writeDeclarationTag("test-lyly-dev", "0.1.0", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /2 image lines/);
    assert.equal(commits().length, 0);
  });

  test("a rejected push resets to the upstream", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await writeDeclarationTag("test-lyly-dev", "0.1.0", { git: fakeGit({ failOn: "push" }), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.deepEqual(resets().map((c) => c.args), [["reset", "--hard", "@{upstream}"]]);
  });
});

describe("setDeclarationState", () => {
  test("rewrites only the state line, keeping its comment", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.deepEqual(result, { ok: true });
    assert.equal(
      fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8"),
      SITE_TAGLESS.replace("state: running   # flipped by Remove", "state: absent   # flipped by Remove"),
    );
    assert.equal(commitMessage(), "test-lyly-dev: set state to absent");
    assert.ok(calls.some((c) => c.args[0] === "push"));
  });

  test("refuses when there is no state line", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace(/^state:.*\n/m, "") });
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("refuses when there are two state lines", async () => {
    seedClone({ "test-lyly-dev.yml": `${SITE_TAGLESS}state: stopped\n` });
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("refuses a missing declaration", async () => {
    seedClone();
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("refuses any state but absent, and a non-site name, before touching git", async () => {
    const asAny = setDeclarationState as (n: string, s: string, o: Parameters<typeof setDeclarationState>[2]) => ReturnType<typeof setDeclarationState>;
    const r1 = await asAny("test-lyly-dev", "running", { git: fakeGit(), clonePath: clone, keyPath: key });
    const r2 = await setDeclarationState("palsave-api", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(r1.ok, false);
    assert.equal(r2.ok, false);
    assert.equal(calls.length, 0);
  });

  test("a rejected push resets to the upstream", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit({ failOn: "push" }), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.deepEqual(resets().map((c) => c.args), [["reset", "--hard", "@{upstream}"]]);
  });
});

describe("readDeclarations", () => {
  test("summarizes every .yml in the clone without invoking git", () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS, "README.md": "not a declaration", "broken.yml": "a: [" });
    const decls = readDeclarations(clone).sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(decls, [
      { name: "palsave-api", port: null, state: "stopped", image: "ghcr.io/lycheehome/palsave-api:sha-old" },
      { name: "test-lyly-dev", port: 3000, state: "running", image: "ghcr.io/lycheehome/test-site" },
    ]);
    assert.equal(calls.length, 0);
  });

  test("returns [] when the clone does not exist", () => {
    assert.deepEqual(readDeclarations(path.join(root, "missing")), []);
  });
});
