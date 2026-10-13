import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import yaml from "js-yaml";
import { loadContractJson } from "../dev/contract";
import { SUDO_TABLE } from "./sudoCommands";

interface SudoJson {
  commands: { id: string; argv: string[] }[];
}

describe("agreements with lychee-contract", () => {
  test("SUDO_TABLE is the contract's sudo.json commands", () => {
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    const contract = loadContractJson<SudoJson>("sudo.json").commands.map(({ id, argv }) => ({ id, argv }));
    assert.deepEqual([...SUDO_TABLE].sort(byId), contract.sort(byId));
  });

  test("ci.yml has a job named for the contract's ci_job", () => {
    const { ci_job } = loadContractJson<{ ci_job: string }>("constants.json");
    const workflow = yaml.load(fs.readFileSync(".github/workflows/ci.yml", "utf8")) as { jobs: object };
    assert.ok(Object.keys(workflow.jobs).includes(ci_job));
  });

  test("config.ts reads no path from the environment", () => {
    const source = fs.readFileSync("src/config.ts", "utf8");
    for (const name of ["CADDYFILE_PATH", "TUNNEL_CONFIG_PATH", "SITES_ROOT"]) {
      assert.ok(!source.includes(name), `${name} should not appear in config.ts`);
    }
  });
});
