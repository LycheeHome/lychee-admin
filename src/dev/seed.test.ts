import "./env";
import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { loadContractJson } from "./contract";
import { SEEDED_INVENTORY } from "./seed";

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
