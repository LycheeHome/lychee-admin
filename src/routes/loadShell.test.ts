import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Deps } from "../deps";
import { SEEDED_RAIL_SITES } from "../dev/testHelpers";

process.env.ADMIN_USERNAME ??= "tester";
process.env.ADMIN_PASSWORD_HASH ??= "$2b$04$abcdefghijklmnopqrstuuJ2r5o5H5n9e1d3pZ8jQ2QnV1wT7c1yG";
process.env.DOMAIN = "lychee.land";

async function deps(opts: { seed?: boolean; caddyfile?: boolean; inventory?: boolean } = {}): Promise<Deps> {
  const { createFakes } = await import("../dev/fakes");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { config } = await import("../config");
  const { SEED_CADDYFILE, SEEDED_INVENTORY } = await import("../dev/seed");
  const { INVENTORY_PATH } = await import("../lib/serviceInventory");
  const fakes = createFakes({}, {});
  if (opts.caddyfile !== false) fakes.fs.writeFile(config.caddyfilePath, SEED_CADDYFILE);
  if (opts.inventory !== false) fakes.fs.writeFile(INVENTORY_PATH, SEEDED_INVENTORY);
  return { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
}

describe("loadShell", () => {
  test("lists the managed sites in Caddyfile order with their hints", async () => {
    const { loadShell } = await import("./loadShell");
    const shell = loadShell(await deps(), { page: "sites" });
    assert.deepEqual(shell.rail.sites, SEEDED_RAIL_SITES);
    assert.equal(shell.rail.hostAvailable, true);
    assert.deepEqual(shell.rail.current, { page: "sites" });
    assert.equal(shell.rail.domain, "lychee.land");
    assert.equal(shell.assets, null);
  });

  test("an unreadable Caddyfile is sites: null, not a throw", async () => {
    const { loadShell } = await import("./loadShell");
    const shell = loadShell(await deps({ caddyfile: false }), null);
    assert.equal(shell.rail.sites, null);
    assert.equal(shell.rail.hostAvailable, true);
  });

  test("a missing inventory is hostAvailable: false", async () => {
    const { loadShell } = await import("./loadShell");
    assert.equal(loadShell(await deps({ inventory: false }), null).rail.hostAvailable, false);
  });
});
