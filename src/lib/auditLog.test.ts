import assert from "node:assert/strict";
import { describe, test } from "node:test";

// auditLog.ts and fakes.ts import config, which reads the environment when evaluated.
async function load() {
  process.env.ADMIN_USERNAME ??= "tester";
  process.env.ADMIN_PASSWORD_HASH ??= "x";
  process.env.DOMAIN ??= "lychee.land";
  const { createInMemoryFileSystem } = await import("../dev/fakes");
  const { readAuditTail } = await import("./auditLog");
  return { fs: createInMemoryFileSystem(), readAuditTail };
}

const LOG = "/log/actions.log";
const TS = "2026-10-01T00:00:00.123Z";
const line = (action: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ timestamp: TS, action, ...over });

describe("readAuditTail", () => {
  test("returns the last n good lines, oldest first, skipping malformed ones without counting them", async () => {
    const { fs, readAuditTail } = await load();
    fs.writeFile(
      LOG,
      [line("A"), "not json", line("B"), '{"action":"x"}', line("C"), "[1]", line("D")].join("\n") + "\n",
    );
    assert.deepEqual(
      readAuditTail(fs, 3, LOG)?.map((l) => l.action),
      ["B", "C", "D"],
    );
  });

  test("n larger than the file returns every good line", async () => {
    const { fs, readAuditTail } = await load();
    fs.writeFile(LOG, line("A") + "\n" + line("B") + "\n");
    assert.equal(readAuditTail(fs, 50, LOG)?.length, 2);
  });

  test("a missing file is null", async () => {
    const { fs, readAuditTail } = await load();
    assert.equal(readAuditTail(fs, 8, LOG), null);
  });

  test("an unreadable file is null", async () => {
    const { fs, readAuditTail } = await load();
    fs.exists = () => true;
    fs.readFile = () => {
      throw new Error("EACCES");
    };
    assert.equal(readAuditTail(fs, 8, LOG), null);
  });

  test("non-string optional fields are dropped", async () => {
    const { fs, readAuditTail } = await load();
    fs.writeFile(LOG, line("add-site", { hostname: 7, detail: "d" }) + "\n");
    const [l] = readAuditTail(fs, 8, LOG) ?? [];
    assert.equal("hostname" in l, false);
    assert.equal(l.detail, "d");
  });
});
