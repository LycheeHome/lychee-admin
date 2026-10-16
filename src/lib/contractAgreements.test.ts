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

  test("ci.yml has the contract's release job, gated on test and on pushes to main", () => {
    const c = loadContractJson<{ ci_job: string; release_job: string; release_image: string }>("constants.json");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wf = yaml.load(fs.readFileSync(".github/workflows/ci.yml", "utf8")) as any;
    const job = wf.jobs[c.release_job];
    assert.ok(job, "release job missing");
    assert.equal(job.name, undefined); // a name: override replaces the reported name
    assert.deepEqual([job.needs].flat(), [c.ci_job]);
    assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
    assert.deepEqual(job.permissions, { contents: "read", packages: "write", "id-token": "write", attestations: "write" });
    assert.deepEqual(wf.permissions, { contents: "read" });
    assert.ok(JSON.stringify(job.steps).includes(c.release_image));
    const push = job.steps.find((step: { id?: string }) => step.id === "push");
    assert.equal(push.with.provenance, false);
    assert.equal(push.with.platforms, "linux/amd64");
    assert.equal(push.with.tags, `${c.release_image}:sha-\${{ github.sha }}`);
  });

  // lychee installs what the release job signs, so a moved tag on any action
  // there would change what the provenance check vouches for.
  test("every action in ci.yml is pinned to a full commit SHA", () => {
    const uses = [...fs.readFileSync(".github/workflows/ci.yml", "utf8").matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0);
    for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, ref);
  });

  test("config.ts reads no path from the environment", () => {
    const source = fs.readFileSync("src/config.ts", "utf8");
    for (const name of ["CADDYFILE_PATH", "TUNNEL_CONFIG_PATH", "SITES_ROOT"]) {
      assert.ok(!source.includes(name), `${name} should not appear in config.ts`);
    }
  });
});
