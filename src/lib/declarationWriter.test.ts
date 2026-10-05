import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { writeDeclarationTag, type GitRunner } from "./declarationWriter";

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

function fakeGit(opts: { failOn?: string; unhealthy?: boolean } = {}): GitRunner {
  return async (args, { cwd, env }) => {
    calls.push({ args, cwd, sshCommand: env.GIT_SSH_COMMAND });
    const verb = args.includes("commit") ? "commit" : args[0];
    if (opts.failOn === verb) throw Object.assign(new Error("git failed"), { stderr: "! [rejected] (fetch first)" });
    if (verb === "rev-parse" && opts.unhealthy) throw new Error("not a git repository");
    if (verb === "clone") {
      fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "palsave-api.yml"), DECLARATION);
    }
    return { stdout: "", stderr: "" };
  };
}

function seedClone() {
  fs.mkdirSync(path.join(clone, ".git"), { recursive: true });
  fs.writeFileSync(path.join(clone, "palsave-api.yml"), DECLARATION);
}

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
        sshCommand.includes("-o StrictHostKeyChecking=accept-new"),
        `missing StrictHostKeyChecking=accept-new: ${sshCommand}`,
      );
    }
  });
});
