import "./env";
import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { loadContractJson } from "./contract";
import { config } from "../config";
import { readAuditTail } from "../lib/auditLog";
import { EVENTS_PATH } from "../lib/platform";
import { readReconcilerEvents } from "../lib/reconcilerEvents";
import { buildActivity } from "../views/activityModel";
import { createInMemoryFileSystem } from "./fakes";
import { applySeed, SEEDED_EVENTS, SEEDED_INVENTORY } from "./seed";

// The inventory schema uses no `format` keywords (timestamps are patterns), so
// ajv-formats is deliberately not a dependency.
function compile() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addSchema(loadContractJson<object>("schemas/common.schema.json"));
  return { ajv, validate: ajv.compile(loadContractJson<object>("schemas/inventory.schema.json")) };
}

test("the seeded inventory validates against the contract's inventory schema", () => {
  const { ajv, validate } = compile();
  const ok = validate(JSON.parse(SEEDED_INVENTORY));
  assert.ok(ok, ajv.errorsText(validate.errors, { separator: "\n" }));
});

test("the seeded feed validates against the contract's events schema", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  // The events schema's one `format` is the lifetime id's uuid; checked by shape
  // here rather than by adding ajv-formats as a dependency.
  ajv.addFormat("uuid", /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  ajv.addSchema(loadContractJson<object>("schemas/common.schema.json"));
  const validate = ajv.compile(loadContractJson<object>("schemas/events.schema.json"));
  const ok = validate(JSON.parse(SEEDED_EVENTS));
  assert.ok(ok, ajv.errorsText(validate.errors, { separator: "\n" }));
});

test("container rows carry release tags in the contract's form", () => {
  const constants = loadContractJson<{ release_tag_pattern: string }>("constants.json");
  const pattern = new RegExp(constants.release_tag_pattern);
  const rows = (JSON.parse(SEEDED_INVENTORY) as { services: Record<string, unknown>[] }).services.filter(
    (s) => s.kind === "container",
  );
  assert.ok(rows.length > 0);
  for (const row of rows) {
    for (const key of ["version", "target", "available"]) {
      const v = row[key];
      if (typeof v === "string" && v !== "") assert.match(v, pattern, `${row.name}.${key}`);
    }
  }
});

function seeded() {
  const fs = createInMemoryFileSystem();
  applySeed(fs);
  return fs;
}

test("the seeded feed parses and holds every event type", () => {
  const lifetimes = readReconcilerEvents(seeded(), EVENTS_PATH);
  assert.ok(lifetimes);
  const types = new Set(lifetimes.flatMap((l) => l.events.map((e) => e.type)));
  assert.deepEqual(
    [...types].sort(),
    ["added", "awaiting-image", "blocked", "deployed", "down", "failed", "recovered", "removed", "stopped"],
  );
});

test("the seeded feed has a closed lifetime and a shared tick", () => {
  const lifetimes = readReconcilerEvents(seeded(), EVENTS_PATH) ?? [];
  const closed = lifetimes.filter((l) => !l.open);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].name, "old-lychee-land");
  assert.ok(closed[0].removed_at);
  const notes = lifetimes.find((l) => l.name === "lychee-notes");
  const events = notes?.events ?? [];
  const recIdx = events.findIndex((e) => e.type === "recovered");
  const depIdx = events.findIndex((e) => e.type === "deployed");
  assert.ok(recIdx >= 0 && depIdx >= 0);
  assert.equal(events[recIdx].at, events[depIdx].at);
  assert.ok(depIdx < recIdx, "A-HIST-1: deployed comes before recovered within a tick");
});

test("the seeded audit log reads back in full", () => {
  assert.equal(readAuditTail(seeded(), 50, config.logFile)?.length, 5);
});

test("seeded activity has both sources and fills the page", () => {
  const fs = seeded();
  const events = buildActivity(
    readAuditTail(fs, 50, config.logFile),
    readReconcilerEvents(fs, EVENTS_PATH),
    { domain: config.domain, sites: new Set(), units: new Map() },
    8,
  );
  assert.equal(events.length, 8);
  assert.deepEqual([...new Set(events.map((e) => e.who))].sort(), ["app", "reconciler"]);
});
