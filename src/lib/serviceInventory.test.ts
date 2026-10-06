import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInventory, readInventory, INVENTORY_PATH } from "./serviceInventory";
import type { FileSystem } from "./fileSystem";

const VALID = JSON.stringify({
  generated: "2026-10-02T04:58:02Z",
  services: [
    {
      name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true,
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
    copyFile: () => {}, rmRecursive: () => {}, exists: () => true,
  };
}

test("parses a well-formed inventory and renames snake_case to camelCase", () => {
  const inv = parseInventory(VALID);
  assert.equal(inv.available, true);
  assert.equal(inv.generated, "2026-10-02T04:58:02Z");
  assert.equal(inv.entries.length, 2);
  assert.deepEqual(inv.entries[0], {
    name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true,
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
        name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true,
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

const GOOD = { name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: false };

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
    name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: false,
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
    name: "x", kind: "unit", unit: "x", group: "service", reconciled: false,
  });
  assert.deepEqual(parseInventory("nope").entries, []);
});

function inventoryOf(...services: unknown[]): string {
  return JSON.stringify({ generated: "2026-10-02T04:58:02Z", services });
}

test("an entry with kind container parses and keeps its project name", () => {
  const inv = parseInventory(
    inventoryOf({
      name: "palsave-api", kind: "container", container: "palsave-api", group: "service",
      reconciled: true, version: "0.3.0",
    }),
  );
  assert.deepEqual(inv.entries, [
    { name: "palsave-api", kind: "container", container: "palsave-api", group: "service", reconciled: true, version: "0.3.0" },
  ]);
  assert.ok(!("unit" in inv.entries[0]));
});

test("an entry with kind unit is unchanged", () => {
  const inv = parseInventory(
    inventoryOf({ name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: false }),
  );
  assert.deepEqual(inv.entries, [
    { name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: false },
  ]);
});

// Review Focus 1: a new app meeting an inventory published before `kind`
// existed. The two repos deploy independently, so this is a real state.
test("an entry with no kind is read as a unit", () => {
  const inv = parseInventory(
    inventoryOf({ name: "swee", unit: "swee.service", group: "service", reconciled: true, version: "v1" }),
  );
  assert.equal(inv.entries.length, 1);
  assert.equal(inv.entries[0].kind, "unit");
  assert.equal(inv.entries[0].kind === "unit" && inv.entries[0].unit, "swee.service");
  assert.equal(inv.entries[0].version, "v1");
});

test("an entry with kind container but no container field is dropped", () => {
  const inv = parseInventory(
    inventoryOf(
      // The unit field of a container entry is not a fallback for its name.
      { name: "a", kind: "container", unit: "a.service", group: "service", reconciled: true },
      { name: "b", kind: "container", group: "service", reconciled: true },
      { name: "keep", kind: "unit", unit: "keep.service", group: "service", reconciled: false },
    ),
  );
  assert.deepEqual(inv.entries.map((e) => e.name), ["keep"]);
});

test("a container project name outside the wrapper's charset is dropped", () => {
  for (const bad of ["-x", "X", "a.b", "a b", "a/b", "", "a".repeat(64)]) {
    const inv = parseInventory(
      inventoryOf({ name: "n", kind: "container", container: bad, group: "service", reconciled: true }),
    );
    assert.deepEqual(inv.entries, [], `accepted ${JSON.stringify(bad)}`);
  }
});

test("an unrecognised kind is dropped, not thrown on, and not read as a unit", () => {
  const inv = parseInventory(
    inventoryOf({ name: "x", kind: "vm", unit: "x.service", group: "service", reconciled: false }),
  );
  assert.deepEqual(inv.entries, []);
  assert.equal(inv.available, true);
});

test("the unit-name pattern is not applied to a container's project name", () => {
  // "palsave-api" has no .service suffix; it must parse as a container.
  const inv = parseInventory(
    inventoryOf({ name: "p", kind: "container", container: "palsave-api", group: "service", reconciled: false }),
  );
  assert.equal(inv.entries.length, 1);
});

const RECONCILED = { name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true };

test("target and available are parsed when present", () => {
  const [e] = parseInventory(inventoryOf({ ...RECONCILED, version: "v1", target: "v1", available: "v2" })).entries;
  assert.equal(e.target, "v1");
  assert.equal(e.available, "v2");
});

test("an empty target or available normalises to undefined", () => {
  // Pins the consumer's tolerance for every wire shape, including "" for
  // available, which the producer is not known to send. Not a claim that the
  // producer was run.
  for (const field of ["target", "available"] as const) {
    const [e] = parseInventory(inventoryOf({ ...RECONCILED, [field]: "" })).entries;
    assert.equal(e[field], undefined);
  }
  const [both] = parseInventory(inventoryOf({ ...RECONCILED, target: "", available: "" })).entries;
  assert.equal(both.target, undefined);
  assert.equal(both.available, undefined);
  const [e] = parseInventory(inventoryOf({ ...RECONCILED, target: "", available: "v2" })).entries;
  assert.equal(e.target, undefined);
  assert.equal(e.available, "v2");
});

test("an entry with neither still parses", () => {
  const [e] = parseInventory(inventoryOf({ ...RECONCILED, version: "v1" })).entries;
  assert.equal(e.version, "v1");
  assert.equal(e.target, undefined);
  assert.equal(e.available, undefined);
});

test("target and available parse on container entries too", () => {
  const [e] = parseInventory(
    inventoryOf({ name: "x", kind: "container", container: "x", group: "service", reconciled: true, target: "v1", available: "v2" }),
  ).entries;
  assert.equal(e.target, "v1");
  assert.equal(e.available, "v2");
});

test('the word "none" is never shown as a version', () => {
  // A declaration rejected because of its image once surfaced as a pinned
  // version that was a word; the board rendered `none` as if it were a tag.
  const [e] = parseInventory(inventoryOf({ ...RECONCILED, target: "none", available: "none" })).entries;
  assert.equal(e.target, undefined);
  assert.equal(e.available, undefined);
});

test('the word "none" is never shown as the installed version either', () => {
  // version comes from installed_tag through the same 'none' -> '' mapping as
  // target_tag, so it is the same sentinel path and the field read most.
  const [e] = parseInventory(inventoryOf({ ...RECONCILED, version: "none" })).entries;
  assert.equal(e.version, undefined);
});

test("deploy fields on an unreconciled entry are ignored", () => {
  // The producer emits none of these on an unreconciled row; if it ever did,
  // dropping them is the safe direction, and the reconciled gate is what
  // enforces it.
  const [e] = parseInventory(
    inventoryOf({ ...RECONCILED, reconciled: false, target: "v1", available: "v2" }),
  ).entries;
  assert.equal(e.reconciled, false);
  assert.equal(e.target, undefined);
  assert.equal(e.available, undefined);
});

test("failed_step is read into failedStep", () => {
  const inv = parseInventory(JSON.stringify({
    generated: "x",
    services: [{
      name: "test-lyly-dev", kind: "container", container: "test-lyly-dev", group: "service", reconciled: true,
      result: "failed", version: "", target: "0.1.0", gate: "", failed_step: "Pull the image: manifest unknown",
    }],
  }));
  assert.equal(inv.entries[0].failedStep, "Pull the image: manifest unknown");
  assert.equal(inv.entries[0].result, "failed");
});

// The producer omits failed_step unless a step failed, and an inventory
// published before it existed never carries it: absence is not an error.
test("a missing or empty failed_step leaves failedStep absent", () => {
  for (const extra of [{}, { failed_step: "" }, { failed_step: 3 }]) {
    const inv = parseInventory(JSON.stringify({
      generated: "x",
      services: [{ name: "swee", kind: "unit", unit: "swee.service", group: "service", reconciled: true, result: "failed", ...extra }],
    }));
    assert.equal(inv.entries.length, 1);
    assert.equal("failedStep" in inv.entries[0], false, JSON.stringify(extra));
  }
});
