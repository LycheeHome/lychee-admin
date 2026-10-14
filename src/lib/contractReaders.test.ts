import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import yaml from "js-yaml";
import { listContractDir, loadContractText } from "../dev/contract";
import { readDeclarations } from "./declarationWriter";
import { parseInventory } from "./serviceInventory";
import type { DeclarationSummary } from "./siteResource";

// examples/resource-status and examples/app-status are deliberately not read
// here: the app never reads those files, they reach it only through the inventory.

const inventoryFiles = listContractDir("examples/inventory/valid").filter((f) => f.endsWith(".json"));

// Fails if the contract's valid inventory examples vanish, which would otherwise leave the loop below vacuous.
test("the contract ships valid inventory examples", () => {
  assert.ok(inventoryFiles.length > 0);
});

for (const file of inventoryFiles) {
  // Fails if parseInventory/toEntry starts dropping an entry kind, or rejects a field shape, the contract allows.
  test(`parseInventory keeps every entry of contract example ${file}`, () => {
    const raw = loadContractText(`examples/inventory/valid/${file}`);
    const expected = (JSON.parse(raw) as { services: Array<{ name: string }> }).services;
    const parsed = parseInventory(raw);
    assert.equal(parsed.available, true);
    assert.equal(parsed.entries.length, expected.length);
    assert.deepEqual(
      parsed.entries.map((e) => e.name),
      expected.map((e) => e.name),
    );
  });
}

// Fails if readDeclarations/parseDeclaration stops reading a declaration shape the contract allows
// (a non-site name, extra fields such as mounts, a tagless image, state: absent).
test("readDeclarations returns one summary per contract declaration example, as written", () => {
  const files = listContractDir("examples/declarations/valid").filter((f) => f.endsWith(".yml"));
  assert.ok(files.length > 0);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contract-decl-"));
  try {
    fs.mkdirSync(path.join(tmp, ".git"));
    for (const f of files) {
      fs.writeFileSync(path.join(tmp, f), loadContractText(`examples/declarations/valid/${f}`));
    }
    const got = readDeclarations(tmp);
    assert.ok(got);
    assert.equal(got.length, files.length);
    for (const f of files) {
      const name = f.slice(0, -".yml".length);
      const doc = yaml.load(loadContractText(`examples/declarations/valid/${f}`)) as Record<string, unknown>;
      const s: DeclarationSummary | undefined = got.find((d) => d.name === name);
      assert.ok(s, `no summary for ${f}`);
      assert.equal(s.port, doc.port ?? null);
      assert.equal(s.state, doc.state);
      assert.equal(s.image, doc.image);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Fails if parseOpResult rejects a result file the contract allows, or accepts
// one the contract's schema refuses (A-OPS-1 Result: an invalid file is absent).
test("parseOpResult reads every valid contract op-result example and rejects every invalid one", async () => {
  const { parseOpResult } = await import("./opResult");
  const valid = listContractDir("examples/op-result/valid").filter((f) => f.endsWith(".json"));
  const invalid = listContractDir("examples/op-result/invalid").filter((f) => f.endsWith(".json") && f !== "expected.json");
  assert.ok(valid.length > 0 && invalid.length > 0);
  for (const f of valid) {
    const raw = loadContractText(`examples/op-result/valid/${f}`);
    const doc = JSON.parse(raw) as { unit: string; action: "start"; result: string };
    const parsed = parseOpResult(raw, doc.unit, doc.action);
    assert.ok(parsed, f);
    assert.equal(parsed.result, doc.result, f);
  }
  for (const f of invalid) {
    const raw = loadContractText(`examples/op-result/invalid/${f}`);
    const doc = JSON.parse(raw) as { unit: string; action: "start" };
    assert.equal(parseOpResult(raw, doc.unit, doc.action), null, f);
  }
});
