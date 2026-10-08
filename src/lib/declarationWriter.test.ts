import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { load } from "js-yaml";
import {
  changeSiteRepository,
  createSiteDeclaration,
  pruneSiteDeclaration,
  readDeclarations,
  refreshDeclarations,
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
let calls: { args: string[]; cwd: string; sshCommand?: string; id?: string; timeoutMs?: number }[];

// A small model of the remote and the clone, so status, reset and untracked
// files behave as they do in real git: `upstream` is the remote's tree, `head`
// is the clone's last commit, and the clone's working tree is the directory.
let upstream: Map<string, string>;
let head: Map<string, string>;
let staged: Set<string>;

function workingTree(cwd: string): Map<string, string> {
  if (!fs.existsSync(cwd)) return new Map();
  return new Map(
    fs
      .readdirSync(cwd)
      .filter((f) => f !== ".git")
      .map((f) => [f, fs.readFileSync(path.join(cwd, f), "utf8")]),
  );
}

function checkout(cwd: string, tree: Map<string, string>) {
  for (const file of workingTree(cwd).keys()) {
    if (head.has(file) || staged.has(file)) fs.rmSync(path.join(cwd, file));
  }
  for (const [file, content] of tree) fs.writeFileSync(path.join(cwd, file), content);
  head = new Map(tree);
  staged = new Set();
}

function fakeGit(
  opts: {
    failOn?: string;
    unhealthy?: boolean;
    pullAdds?: Record<string, string>;
    id?: string;
    yieldEachCall?: boolean;
  } = {},
): GitRunner {
  return async (args, { cwd, env, timeoutMs }) => {
    calls.push({ args, cwd, sshCommand: env.GIT_SSH_COMMAND, id: opts.id, timeoutMs });
    if (opts.yieldEachCall) await new Promise((resolve) => setTimeout(resolve, 1));
    const verb = args.includes("commit") ? "commit" : args[0];
    if (opts.failOn === verb) throw Object.assign(new Error("git failed"), { stderr: "! [rejected] (fetch first)" });
    if (verb === "rev-parse" && opts.unhealthy) throw new Error("not a git repository");
    if (verb === "status") {
      const tree = workingTree(cwd);
      const dirty = [...new Set([...tree.keys(), ...head.keys()])].filter((f) => tree.get(f) !== head.get(f));
      return { stdout: dirty.map((f) => `${head.has(f) ? " M" : "??"} ${f}\n`).join(""), stderr: "" };
    }
    if (verb === "pull") {
      for (const [file, content] of Object.entries(opts.pullAdds ?? {})) upstream.set(file, content);
      checkout(cwd, upstream);
    }
    if (verb === "clone") {
      fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
      head = new Map();
      staged = new Set();
      checkout(cwd, upstream);
    }
    if (verb === "add") staged.add(args[args.length - 1]);
    if (verb === "rm") {
      const file = args[args.length - 1];
      fs.rmSync(path.join(cwd, file));
      staged.add(file);
    }
    if (verb === "commit") {
      const tree = workingTree(cwd);
      for (const file of staged) {
        if (tree.has(file)) head.set(file, tree.get(file)!);
        else head.delete(file);
      }
      staged = new Set();
    }
    if (verb === "push") upstream = new Map(head);
    if (verb === "reset") checkout(cwd, upstream);
    return { stdout: "", stderr: "" };
  };
}

function seedClone(extra: Record<string, string> = {}) {
  fs.mkdirSync(path.join(clone, ".git"), { recursive: true });
  upstream = new Map([["palsave-api.yml", DECLARATION], ...Object.entries(extra)]);
  head = new Map(upstream);
  staged = new Set();
  for (const [file, content] of upstream) fs.writeFileSync(path.join(clone, file), content);
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
  upstream = new Map([["palsave-api.yml", DECLARATION]]);
  head = new Map();
  staged = new Set();
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
    const git = fakeGit({ pullAdds: { "test-lyly-dev.yml": SITE_TAGLESS } });
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

  // The reconciler's validator refuses these (RESERVED_PORTS in lychee-ops'
  // validate_declarations.py), and one refused declaration freezes the set.
  test("refuses the validator's reserved ports, 8787 and 2019, before touching git", async () => {
    for (const port of [8787, 2019]) {
      const result = await createSiteDeclaration("test-lyly-dev", "test-site", port, { git: fakeGit(), clonePath: clone, keyPath: key });
      assert.equal(result.ok, false, String(port));
      assert.match((result as { reason: string }).reason, new RegExp(`${port}.*reserved`), String(port));
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

describe("changeSiteRepository", () => {
  const opts = (git = fakeGit()) => ({ git, clonePath: clone, keyPath: key });
  const read = () => fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8");

  test("rewrites only the repository of a tagless image, keeping every comment and other line", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await changeSiteRepository("test-lyly-dev", "Test-App", opts());
    assert.deepEqual(result, { ok: true });
    assert.equal(read(), SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site ", "ghcr.io/lycheehome/test-app "));
    assert.equal(commitMessage(), "test-lyly-dev: change repository to ghcr.io/lycheehome/test-app");
    assert.ok(calls.some((c) => c.args[0] === "push"));
  });

  test("keeps the quotes of a quoted tagless image", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site", `'ghcr.io/lycheehome/test-site'`) });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.deepEqual(result, { ok: true });
    assert.match(read(), /^image: 'ghcr\.io\/lycheehome\/test-app' {3}# tag written by Deploy$/m);
  });

  test("refuses a tagged declaration, saying a deployed image can't change repository", async () => {
    const tagged = SITE_TAGLESS.replace("test-site ", "test-site:0.1.0 ");
    seedClone({ "test-lyly-dev.yml": tagged });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /deployed images can't change repository; remove the site instead/);
      assert.equal(result.code, "tagged");
    }
    assert.equal(read(), tagged);
    assert.equal(commits().length, 0);
  });

  test("refuses a retired declaration", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running", "state: absent") });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /absent/);
    assert.equal(commits().length, 0);
  });

  test("refuses a missing declaration", async () => {
    seedClone();
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("refuses a name that is not a site name, before touching git", async () => {
    const result = await changeSiteRepository("palsave-api", "test-app", opts());
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  test("refuses a repository that fails normalizeRepo, before touching git", async () => {
    for (const repo of ["", "LycheeHome/test-app", "test app", "test--app", "ghcr.io/lycheehome/x"]) {
      const result = await changeSiteRepository("test-lyly-dev", repo, opts());
      assert.equal(result.ok, false, repo);
    }
    assert.equal(calls.length, 0);
  });

  test("refuses a tagless image outside ghcr.io/lycheehome", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site", "ghcr.io/someone/test-site") });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("refuses a YAML-escaped tag that only looks tagless, committing nothing", async () => {
    const escaped = SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site ", `"ghcr.io/lycheehome/test-site\\x3a0.1.0" `);
    assert.equal(load(escaped) && (load(escaped) as { image: string }).image, "ghcr.io/lycheehome/test-site:0.1.0");
    seedClone({ "test-lyly-dev.yml": escaped });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    assert.equal(read(), escaped);
    assert.equal(commits().length, 0);
    assert.ok(!calls.some((c) => c.args[0] === "push"));
  });

  test("refuses a multi-component repository instead of rewriting only its first part", async () => {
    const nested = SITE_TAGLESS.replace("ghcr.io/lycheehome/test-site", "ghcr.io/lycheehome/test-site/extra");
    seedClone({ "test-lyly-dev.yml": nested });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    assert.equal(read(), nested);
    assert.equal(commits().length, 0);
  });

  test("refuses two tagless image lines", async () => {
    seedClone({ "test-lyly-dev.yml": `${SITE_TAGLESS}image: ghcr.io/lycheehome/other\n` });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts());
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("the same repository is ok without committing", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await changeSiteRepository("test-lyly-dev", "test-site", opts());
    assert.deepEqual(result, { ok: true });
    assert.equal(commits().length, 0);
    assert.ok(!calls.some((c) => c.args[0] === "push"));
  });

  test("a rejected push resets to the upstream and is reported", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await changeSiteRepository("test-lyly-dev", "test-app", opts(fakeGit({ failOn: "push" })));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /rejected/);
    assert.deepEqual(resets().map((c) => c.args), [["reset", "--hard", "@{upstream}"]]);
    assert.equal(read(), SITE_TAGLESS);
  });
});

describe("pruneSiteDeclaration", () => {
  const opts = (git = fakeGit()) => ({ git, clonePath: clone, keyPath: key });
  const RETIRED = SITE_TAGLESS.replace("state: running   # flipped by Remove", "state: absent");
  const exists = (f = "test-lyly-dev.yml") => fs.existsSync(path.join(clone, f));

  test("deletes a retired declaration in one commit and pushes", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.deepEqual(result, { ok: true });
    assert.equal(commits().length, 1);
    assert.equal(commitMessage(), "test-lyly-dev: prune retired declaration");
    assert.ok(calls.some((c) => c.args[0] === "rm" && c.args.join(" ") === "rm -- test-lyly-dev.yml"));
    assert.ok(calls.some((c) => c.args[0] === "push"));
    assert.ok(!exists());
    assert.ok(!upstream.has("test-lyly-dev.yml"));
  });

  test("deletes exactly one file, leaving other declarations untouched", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED, "other-lyly-dev.yml": SITE_TAGLESS });
    await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.ok(exists("other-lyly-dev.yml"));
    assert.ok(exists("palsave-api.yml"));
    assert.deepEqual([...upstream.keys()].sort(), ["other-lyly-dev.yml", "palsave-api.yml"]);
  });

  test("refuses a declaration that is not absent, committing nothing", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "not-absent");
    assert.equal(commits().length, 0);
    assert.ok(exists());
  });

  test("allows a quoted, commented absent: the check is on the parsed value", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running   # flipped by Remove", `state: "absent" # retired`) });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.deepEqual(result, { ok: true });
    assert.ok(!exists());
  });

  test("refuses a state that only looks absent in text", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running", "state: running\n# state: absent") });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "not-absent");
  });

  test("refuses a duplicated state: key, committing nothing", async () => {
    seedClone({ "test-lyly-dev.yml": `${RETIRED}state: running\n` });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "not-absent");
    assert.equal(commits().length, 0);
    assert.ok(exists());
  });

  test("refuses state: Absent (capital A), committing nothing", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running   # flipped by Remove", "state: Absent") });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "not-absent");
    assert.equal(commits().length, 0);
    assert.ok(exists());
  });

  test("refuses a name that is not a site name, before touching git", async () => {
    const result = await pruneSiteDeclaration("palsave-api", opts());
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
  });

  test("a missing file is code: missing", async () => {
    seedClone();
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "missing");
    assert.equal(commits().length, 0);
  });

  const RETIRED_TAGGED = RETIRED.replace("ghcr.io/lycheehome/test-site ", "ghcr.io/lycheehome/test-site:0.1.0 ");

  test("requireTagless refuses a retired tagged declaration with code: tagged, committing nothing", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED_TAGGED });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts(), { requireTagless: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "tagged");
    assert.equal(commits().length, 0);
    assert.ok(!calls.some((c) => c.args[0] === "push"));
    assert.ok(exists());
  });

  test("requireTagless refuses a tag YAML parses but the text hides", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED.replace("ghcr.io/lycheehome/test-site ", `"ghcr.io/lycheehome/test-site\\x3a0.1.0" `) });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts(), { requireTagless: true });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "tagged");
    assert.equal(commits().length, 0);
  });

  test("requireTagless allows a retired tagless declaration", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts(), { requireTagless: true });
    assert.deepEqual(result, { ok: true });
    assert.equal(commits().length, 1);
    assert.ok(!exists());
  });

  test("without requireTagless a retired tagged declaration is pruned (the deployed path)", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED_TAGGED });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts());
    assert.deepEqual(result, { ok: true });
    assert.equal(commits().length, 1);
    assert.ok(!exists());
  });

  test("a rejected push resets to the upstream and the file is back", async () => {
    seedClone({ "test-lyly-dev.yml": RETIRED });
    const result = await pruneSiteDeclaration("test-lyly-dev", opts(fakeGit({ failOn: "push" })));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /rejected/);
    assert.deepEqual(resets().map((c) => c.args), [["reset", "--hard", "@{upstream}"]]);
    assert.equal(fs.readFileSync(path.join(clone, "test-lyly-dev.yml"), "utf8"), RETIRED);
  });
});

describe("readDeclarations", () => {
  test("summarizes every .yml in the clone without invoking git", () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS, "README.md": "not a declaration", "broken.yml": "a: [" });
    const decls = readDeclarations(clone)!.sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(decls, [
      { name: "palsave-api", port: null, state: "stopped", image: "ghcr.io/lycheehome/palsave-api:sha-old" },
      { name: "test-lyly-dev", port: 3000, state: "running", image: "ghcr.io/lycheehome/test-site" },
    ]);
    assert.equal(calls.length, 0);
  });

  // null and [] are different answers: null is "could not tell", [] is "the
  // clone is readable and declares nothing". A caller that confuses them
  // either treats a pruned site as attached forever, or a site it cannot see
  // as detached.
  test("returns null when the clone does not exist", () => {
    assert.equal(readDeclarations(path.join(root, "missing")), null);
  });

  test("returns null for a directory that is not a clone, such as one left by a failed re-clone", () => {
    fs.mkdirSync(clone, { recursive: true });
    assert.equal(readDeclarations(clone), null);
  });

  test("returns [] for a readable clone with no declarations", () => {
    seedClone();
    fs.rmSync(path.join(clone, "palsave-api.yml"));
    assert.deepEqual(readDeclarations(clone), []);
  });
});

describe("refreshDeclarations", () => {
  const opts = (git: GitRunner) => ({ git, clonePath: clone, keyPath: key });

  test("pulls a healthy clone, so a declaration pruned or added on GitHub is seen", async () => {
    seedClone();
    await refreshDeclarations(opts(fakeGit({ pullAdds: { "test-lyly-dev.yml": SITE_TAGLESS } })));
    assert.ok(calls.some((c) => c.args[0] === "pull"));
    assert.deepEqual(readDeclarations(clone)!.map((d) => d.name).sort(), ["palsave-api", "test-lyly-dev"]);
    assert.equal(commits().length, 0);
  });

  test("never throws, and a failed pull leaves the clone as it was", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const result = await refreshDeclarations(opts(fakeGit({ failOn: "pull" })));
    assert.equal(result, undefined);
    assert.deepEqual(readDeclarations(clone)!.map((d) => d.name).sort(), ["palsave-api", "test-lyly-dev"]);
  });

  test("never throws when the deploy key is missing", async () => {
    seedClone();
    await refreshDeclarations({ git: fakeGit(), clonePath: clone, keyPath: path.join(root, "nope") });
    assert.equal(calls.length, 0);
  });

  test("bounds every git call it makes with the given timeout", async () => {
    seedClone();
    await refreshDeclarations({ ...opts(fakeGit()), timeoutMs: 5000 });
    assert.ok(calls.length > 0);
    assert.ok(calls.every((c) => c.timeoutMs === 5000), JSON.stringify(calls.map((c) => c.timeoutMs)));
  });

  test("takes its turn on the clone queue: it never interleaves with a write", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    await Promise.all([
      writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit({ id: "W", yieldEachCall: true }), clonePath: clone, keyPath: key }),
      refreshDeclarations({ git: fakeGit({ id: "R", yieldEachCall: true }), clonePath: clone, keyPath: key }),
    ]);
    const ids = calls.map((c) => c.id);
    const switches = ids.filter((id, i) => i > 0 && id !== ids[i - 1]).length;
    assert.equal(switches, 1, `interleaved: ${ids.join("")}`);
  });
});

describe("a dirty or locked clone", () => {
  const opts = (git: GitRunner) => ({ git, clonePath: clone, keyPath: key });

  test("a failed add leaves no phantom declaration: the next operation re-clones and never pushes it", async () => {
    seedClone();
    const failed = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, opts(fakeGit({ failOn: "add" })));
    assert.equal(failed.ok, false);

    calls = [];
    const retag = await writeDeclarationTag("palsave-api", "sha-new", opts(fakeGit()));
    assert.deepEqual(retag, { ok: true });
    assert.ok(calls.some((c) => c.args[0] === "clone"), "dirty clone was not re-cloned");
    assert.equal(fs.existsSync(path.join(clone, "test-lyly-dev.yml")), false);
    assert.equal(upstream.has("test-lyly-dev.yml"), false);
    assert.deepEqual(readDeclarations(clone)!.map((d) => d.name), ["palsave-api"]);
  });

  test("after a failed add, the phantom cannot be pushed by a later state write", async () => {
    seedClone();
    await createSiteDeclaration("test-lyly-dev", "test-site", 3000, opts(fakeGit({ failOn: "add" })));
    const result = await setDeclarationState("test-lyly-dev", "absent", opts(fakeGit()));
    assert.equal(result.ok, false);
    assert.equal(calls.filter((c) => c.args[0] === "push").length, 0);
    assert.equal(upstream.has("test-lyly-dev.yml"), false);
  });

  test("after a failed add, the same create succeeds instead of refusing as 'exists'", async () => {
    seedClone();
    await createSiteDeclaration("test-lyly-dev", "test-site", 3000, opts(fakeGit({ failOn: "add" })));
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, opts(fakeGit()));
    assert.deepEqual(result, { ok: true });
    assert.equal(upstream.has("test-lyly-dev.yml"), true);
  });

  test("a failed commit resets to the upstream, leaving a clean clone", async () => {
    seedClone();
    const result = await createSiteDeclaration("test-lyly-dev", "test-site", 3000, opts(fakeGit({ failOn: "commit" })));
    assert.equal(result.ok, false);
    assert.deepEqual(resets().map((c) => c.args), [["reset", "--hard", "@{upstream}"]]);
    assert.equal(fs.existsSync(path.join(clone, "test-lyly-dev.yml")), false);

    calls = [];
    await writeDeclarationTag("palsave-api", "sha-new", opts(fakeGit()));
    assert.equal(calls.some((c) => c.args[0] === "clone"), false, "a clean clone should be pulled, not re-cloned");
  });

  test("a pre-existing index.lock triggers a re-clone", async () => {
    seedClone();
    fs.writeFileSync(path.join(clone, ".git", "index.lock"), "");
    const result = await writeDeclarationTag("palsave-api", "sha-new", opts(fakeGit()));
    assert.deepEqual(result, { ok: true });
    assert.ok(calls.some((c) => c.args[0] === "clone"));
    assert.equal(fs.existsSync(path.join(clone, ".git", "index.lock")), false);
  });

  test("a modified tracked file triggers a re-clone", async () => {
    seedClone();
    fs.writeFileSync(path.join(clone, "palsave-api.yml"), "edited by hand\n");
    const result = await writeDeclarationTag("palsave-api", "sha-new", opts(fakeGit()));
    assert.deepEqual(result, { ok: true });
    assert.ok(calls.some((c) => c.args[0] === "clone"));
  });

  test("a clean clone is pulled, not re-cloned", async () => {
    seedClone();
    await writeDeclarationTag("palsave-api", "sha-new", opts(fakeGit()));
    assert.equal(calls.some((c) => c.args[0] === "clone"), false);
    assert.ok(calls.some((c) => c.args[0] === "pull"));
  });
});

describe("concurrent writes", () => {
  test("two concurrent writes run their git sequences without interleaving", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS });
    const [a, b] = await Promise.all([
      writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit({ id: "A", yieldEachCall: true }), clonePath: clone, keyPath: key }),
      setDeclarationState("test-lyly-dev", "absent", { git: fakeGit({ id: "B", yieldEachCall: true }), clonePath: clone, keyPath: key }),
    ]);
    assert.deepEqual(a, { ok: true });
    assert.deepEqual(b, { ok: true });
    const ids = calls.map((c) => c.id);
    const switches = ids.filter((id, i) => i > 0 && id !== ids[i - 1]).length;
    assert.equal(switches, 1, `interleaved: ${ids.join("")}`);
    assert.equal(calls.filter((c) => c.args[0] === "push").length, 2);
  });

  test("a failed write does not block the next one", async () => {
    seedClone();
    const [a, b] = await Promise.all([
      writeDeclarationTag("palsave-api", "sha-new", { git: fakeGit({ failOn: "pull" }), clonePath: clone, keyPath: key }),
      writeDeclarationTag("palsave-api", "sha-newer", { git: fakeGit(), clonePath: clone, keyPath: key }),
    ]);
    assert.equal(a.ok, false);
    assert.deepEqual(b, { ok: true });
  });
});

describe("setDeclarationState with an empty value", () => {
  test("an empty state: line is refused", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running   # flipped by Remove", "state:   # flipped by Remove") });
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });

  test("a bare empty state: line is refused", async () => {
    seedClone({ "test-lyly-dev.yml": SITE_TAGLESS.replace("state: running   # flipped by Remove", "state:") });
    const result = await setDeclarationState("test-lyly-dev", "absent", { git: fakeGit(), clonePath: clone, keyPath: key });
    assert.equal(result.ok, false);
    assert.equal(commits().length, 0);
  });
});
