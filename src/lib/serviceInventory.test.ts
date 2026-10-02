import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInventory, readInventory, INVENTORY_PATH } from "./serviceInventory";
import type { FileSystem } from "./fileSystem";

const VALID = JSON.stringify({
  generated: "2026-10-02T04:58:02Z",
  services: [
    {
      name: "swee", unit: "swee.service", group: "service", reconciled: true,
      version: "v2.11.4", commit: "af22c56d1e0b4c7a9f3e5d2b8a6c4e1f0d9b7a35", result: "skipped",
      gate: "pin unchanged (v2.11.4)", last_run: "2026-10-02T04:58:02Z",
      failed_attempts: 0,
    },
    { name: "palworld", unit: "palworld-palchuds.service", group: "service", reconciled: false },
  ],
});

function fsReturning(content: string | (() => never)): FileSystem {
  return {
    readFile: typeof content === "string" ? () => content : content,
    writeFile: () => {}, mkdir: () => {}, appendFile: () => {},
    copyFile: () => {}, rmRecursive: () => {},
  };
}

test("parses a well-formed inventory and renames snake_case to camelCase", () => {
  const inv = parseInventory(VALID);
  assert.equal(inv.available, true);
  assert.equal(inv.generated, "2026-10-02T04:58:02Z");
  assert.equal(inv.entries.length, 2);
  assert.deepEqual(inv.entries[0], {
    name: "swee", unit: "swee.service", group: "service", reconciled: true,
    version: "v2.11.4", commit: "af22c56d1e0b4c7a9f3e5d2b8a6c4e1f0d9b7a35", result: "skipped",
    gate: "pin unchanged (v2.11.4)", lastRun: "2026-10-02T04:58:02Z",
    failedAttempts: 0,
  });
});

test("an unreconciled entry carries no deploy fields at all", () => {
  const inv = parseInventory(VALID);
  const palworld = inv.entries[1];
  assert.equal(palworld.reconciled, false);
  assert.equal(palworld.version, undefined);
  assert.equal(palworld.result, undefined);
});

test("empty strings from a never-installed service parse as not known", () => {
  // The producer emits the keys with "" rather than omitting them.
  const raw = JSON.stringify({
    generated: "2026-10-02T04:58:02Z",
    services: [
      {
        name: "swee", unit: "swee.service", group: "service", reconciled: true,
        version: "", commit: "", result: "unknown", gate: "", last_run: "",
        failed_attempts: 0,
      },
    ],
  });
  const entry = parseInventory(raw).entries[0];
  assert.equal(entry.version, undefined);
  assert.equal(entry.commit, undefined);
  assert.equal(entry.gate, undefined);
  assert.equal(entry.lastRun, undefined);
  // "unknown" and 0 are real values, not absences.
  assert.equal(entry.result, "unknown");
  assert.equal(entry.failedAttempts, 0);
});

test("malformed JSON degrades to unavailable rather than throwing", () => {
  const inv = parseInventory('{"generated": "2026-10-02T04:58:02Z", "servi');
  assert.equal(inv.available, false);
  assert.deepEqual(inv.entries, []);
  assert.equal(inv.generated, null);
});

test("valid JSON of the wrong shape degrades to unavailable", () => {
  assert.equal(parseInventory('{"services": "not an array"}').available, false);
  assert.equal(parseInventory("[]").available, false);
});

test("an entry with an unknown group is dropped, not rendered in a bad group", () => {
  const raw = JSON.stringify({
    generated: "x",
    services: [{ name: "a", unit: "a.service", group: "nonsense", reconciled: false }],
  });
  assert.deepEqual(parseInventory(raw).entries, []);
});

test("an entry whose unit is not a plausible unit name is dropped", () => {
  for (const unit of ["--help.service", "-x.service", "a b.service", "swee", "a.service;x", "../x.service"]) {
    const raw = JSON.stringify({
      generated: "x",
      services: [{ name: "a", unit, group: "service", reconciled: false }],
    });
    assert.deepEqual(parseInventory(raw).entries, [], unit);
  }
});

test("a missing inventory file degrades to unavailable rather than throwing", () => {
  const throwing = fsReturning(() => {
    const err = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  });
  const inv = readInventory(throwing, INVENTORY_PATH);
  assert.equal(inv.available, false);
  assert.deepEqual(inv.entries, []);
});

test("readInventory reads the documented path", () => {
  let seen = "";
  const spy = fsReturning(VALID);
  spy.readFile = (p: string) => { seen = p; return VALID; };
  readInventory(spy, INVENTORY_PATH);
  assert.equal(seen, "/var/lib/lychee-inventory/services.json");
});

const GOOD = { name: "swee", unit: "swee.service", group: "service", reconciled: false };

test("a null or string entry is skipped without dropping its neighbours", () => {
  const raw = JSON.stringify({
    generated: "x",
    services: [GOOD, null, "garbage", { ...GOOD, name: "other", unit: "other.service" }],
  });
  assert.deepEqual(parseInventory(raw).entries.map((e) => e.name), ["swee", "other"]);
});

test("an unreconciled entry's stray deploy fields are ignored", () => {
  const raw = JSON.stringify({
    generated: "x",
    services: [{ ...GOOD, version: "v1", commit: "abc", result: "deployed", failed_attempts: 2 }],
  });
  assert.deepEqual(parseInventory(raw).entries[0], {
    name: "swee", unit: "swee.service", group: "service", reconciled: false,
  });
});

test("a missing or non-string name drops the entry", () => {
  const raw = JSON.stringify({
    generated: "x",
    services: [{ unit: "a.service", group: "service", reconciled: false }, { ...GOOD, name: 7 }],
  });
  assert.deepEqual(parseInventory(raw).entries, []);
});

test("mutating one unavailable result cannot affect the next", () => {
  parseInventory("nope").entries.push({
    name: "x", unit: "x", group: "service", reconciled: false,
  });
  assert.deepEqual(parseInventory("nope").entries, []);
});
