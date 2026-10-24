import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { ApiOk } from "../shared/board";
import type { RailPayload } from "../shared/rail";
import { SEEDED_RAIL_SITES } from "../dev/testHelpers";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

describe("GET /api/rail", () => {
  const open: Array<() => Promise<void>> = [];
  after(async () => {
    for (const close of open) await close();
  });
  const calls = { units: 0, resource: 0 };

  async function start(opts: { caddyfile?: boolean; inventory?: boolean } = {}) {
    calls.units = calls.resource = 0;
    const { createApp } = await import("../app");
    const { createBackup } = await import("../lib/backup");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");
    const { applySeed, SEEDED_DECLARATIONS } = await import("../dev/seed");
    const { config } = await import("../config");
    const { INVENTORY_PATH } = await import("../lib/serviceInventory");
    const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
    applySeed(fakes.fs);
    if (opts.caddyfile === false) fakes.fs.rmRecursive(config.caddyfilePath);
    if (opts.inventory === false) fakes.fs.rmRecursive(INVENTORY_PATH);
    const c = fakes.commands;
    const commands: Deps["commands"] = {
      ...c,
      readUnitStates: (u) => {
        calls.units++;
        return c.readUnitStates(u);
      },
      checkResourceContainerStatus: (p) => {
        calls.resource++;
        return c.checkResourceContainerStatus(p);
      },
      readResourceStatus: (p) => {
        calls.resource++;
        return c.readResourceStatus(p);
      },
    };
    const deps: Deps = { commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
    const server: Server = createApp(deps).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    open.push(async () => {
      server.close();
      await once(server, "close");
    });
    return `http://127.0.0.1:${address.port}`;
  }
  const get = async (base: string, headers: Record<string, string> = { Authorization: AUTH }) => {
    const res = await fetch(`${base}/api/rail`, { headers });
    return { res, body: (await res.json().catch(() => null)) as ApiOk<RailPayload> };
  };

  test("lists the seed's managed sites in Caddyfile order with static or :port hints, excluding lychee.local", async () => {
    const { res, body } = await get(await start());
    assert.equal(res.status, 200);
    assert.deepEqual(body.sites, SEEDED_RAIL_SITES);
    assert.ok(!body.sites?.some((s) => s.hostname === "lychee.local"));
    assert.equal(body.hostAvailable, true);
    assert.equal(body.domain, "lychee.land");
  });

  test("an unreadable Caddyfile answers 200 with sites: null", async () => {
    const { res, body } = await get(await start({ caddyfile: false }));
    assert.equal(res.status, 200);
    assert.equal(body.sites, null);
  });

  test("an unavailable inventory answers 200 with hostAvailable: false", async () => {
    const { res, body } = await get(await start({ inventory: false }));
    assert.equal(res.status, 200);
    assert.equal(body.hostAvailable, false);
  });

  test("the wrapped command counters stay at zero on /api/rail, and the same counters rise on /api/health", async () => {
    const base = await start();
    await get(base);
    assert.deepEqual(calls, { units: 0, resource: 0 });
    // Positive control: the counters are wired, so their zero above means something.
    const health = await fetch(`${base}/api/health`, { headers: { Authorization: AUTH } });
    assert.equal(health.status, 200);
    assert.ok(calls.units > 0);
  });

  test("readRail's modules import no status machinery (TCP port check, cached statuses, container reads)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const banned = /portStatus|cachedStatuses|computeStatuses|readResourceStatus|checkResourceContainerStatus/;
    for (const file of ["rail.ts", "loadShell.ts"]) {
      const source = readFileSync(join(__dirname, file), "utf8");
      const imports = source.split("\n").filter((line) => /^\s*(import\b|\}\s*from\b)/.test(line));
      assert.ok(imports.length > 0, `${file} has import lines`);
      for (const line of imports) assert.ok(!banned.test(line), `${file}: ${line}`);
    }
    const body = readFileSync(join(__dirname, "rail.ts"), "utf8");
    assert.ok(!/checkPortOpen|cachedStatuses|computeStatuses/.test(body));
  });

  test("401 without credentials", async () => {
    const { res } = await get(await start(), {});
    assert.equal(res.status, 401);
  });
});
