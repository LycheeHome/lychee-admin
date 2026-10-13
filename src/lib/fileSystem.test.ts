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
    process.env.DOMAIN ??= "lychee.land";
    const { createInMemoryFileSystem } = await import("../dev/fakes");
    const mem = createInMemoryFileSystem();
    mem.writeFile("/var/www/a.txt", "x");
    mem.mkdir("/var/www/site");
    assert.equal(mem.exists("/var/www/a.txt"), true);
    assert.equal(mem.exists("/var/www/site"), true);
    assert.equal(mem.exists("/var/www/missing"), false);
  });
});

describe("FileSystem.readTail", () => {
  test("the real implementation returns at most the last maxBytes bytes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lychee-tail-"));
    try {
      const file = path.join(dir, "a.log");
      fs.writeFileSync(file, "0123456789");
      assert.equal(realFileSystem.readTail(file, 4), "6789");
      assert.equal(realFileSystem.readTail(file, 100), "0123456789");
      fs.writeFileSync(path.join(dir, "empty.log"), "");
      assert.equal(realFileSystem.readTail(path.join(dir, "empty.log"), 4), "");
      assert.throws(() => realFileSystem.readTail(path.join(dir, "missing.log"), 4));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the in-memory fake agrees", async () => {
    process.env.ADMIN_USERNAME ??= "tester";
    process.env.ADMIN_PASSWORD_HASH ??= "x";
    process.env.DOMAIN ??= "lychee.land";
    const { createInMemoryFileSystem } = await import("../dev/fakes");
    const mem = createInMemoryFileSystem();
    mem.writeFile("/x.log", "0123456789");
    assert.equal(mem.readTail("/x.log", 4), "6789");
    assert.equal(mem.readTail("/x.log", 100), "0123456789");
    assert.throws(() => mem.readTail("/missing.log", 4));
  });
});
