import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { realFileSystem } from "./fileSystem";

describe("FileSystem.exists", () => {
  test("the real implementation sees files and directories, and absence", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyly-exists-"));
    try {
      fs.writeFileSync(path.join(dir, "a.txt"), "x");
      assert.equal(realFileSystem.exists(path.join(dir, "a.txt")), true);
      assert.equal(realFileSystem.exists(dir), true);
      assert.equal(realFileSystem.exists(path.join(dir, "nope")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the in-memory fake sees files and directories, and absence", async () => {
    // fakes.ts imports config, which reads the environment when evaluated.
    process.env.ADMIN_USERNAME ??= "tester";
    process.env.ADMIN_PASSWORD_HASH ??= "x";
    process.env.DOMAIN ??= "lyly.dev";
    const { createInMemoryFileSystem } = await import("../dev/fakes");
    const mem = createInMemoryFileSystem();
    mem.writeFile("/var/www/a.txt", "x");
    mem.mkdir("/var/www/site");
    assert.equal(mem.exists("/var/www/a.txt"), true);
    assert.equal(mem.exists("/var/www/site"), true);
    assert.equal(mem.exists("/var/www/missing"), false);
  });
});
