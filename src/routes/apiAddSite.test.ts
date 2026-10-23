import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { ApiOk } from "../shared/board";
import type { AddSitePayload } from "../shared/addSite";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

type Fakes = ReturnType<typeof import("../dev/fakes").createFakes>;

async function serve(tweak: (fakes: Fakes, commands: Fakes["commands"]) => Fakes["commands"] = (_f, c) => c) {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const { applySeed, SEEDED_DECLARATIONS } = await import("../dev/seed");
  const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
  applySeed(fakes.fs);
  const commands = tweak(fakes, { ...fakes.commands });
  const deps: Deps = { commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
  const server: Server = createApp(deps).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    fakes,
    base: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

describe("GET /api/sites/new", () => {
  const open: Array<{ close: () => Promise<void> }> = [];
  after(async () => {
    for (const s of open) await s.close();
  });
  const counts = { pulls: 0 };
  async function start() {
    counts.pulls = 0;
    const s = await serve((_f, c) => ({
      ...c,
      refreshDeclarations: () => {
        counts.pulls++;
        return c.refreshDeclarations();
      },
    }));
    open.push(s);
    return s;
  }
  const get = async (base: string, query = "") => {
    const res = await fetch(`${base}/api/sites/new${query}`, { headers: { Authorization: AUTH } });
    return { res, body: (await res.json()) as ApiOk<AddSitePayload> };
  };

  test("answers the seed's domain, port owners, paths and steps", async () => {
    const s = await start();
    const { config } = await import("../config");
    const { ADD_STEPS } = await import("../lib/stepReport");
    const { computePortOwners } = await import("./sites");
    const caddyfile = await import("../lib/caddyfile");
    const { isManagedHostname } = await import("../lib/siteValidation");
    const sites = caddyfile
      .parseSites(s.fakes.fs.readFile(config.caddyfilePath))
      .filter((site) => isManagedHostname(site.hostname, config.domain));
    const { res, body } = await get(s.base);
    assert.equal(res.status, 200);
    assert.equal(body.domain, "lychee.land");
    assert.equal(body.caddyfileError, null);
    assert.deepEqual(body.portOwners, computePortOwners(sites));
    assert.deepEqual(body.paths, { caddyfilePath: config.caddyfilePath, tunnelConfigPath: config.tunnelConfigPath });
    assert.deepEqual(body.steps, ADD_STEPS.map(({ id, label }) => ({ id, label })));
  });

  test("an unreadable Caddyfile answers 200 with caddyfileError", async () => {
    const s = await start();
    const { config } = await import("../config");
    const { CommandError } = await import("../lib/systemCommands");
    const original = s.fakes.fs.readFile;
    s.fakes.fs.readFile = (p: string) => {
      if (p === config.caddyfilePath) throw new CommandError("cannot read", "", "denied");
      return original(p);
    };
    const { res, body } = await get(s.base);
    s.fakes.fs.readFile = original;
    assert.equal(res.status, 200);
    assert.equal(body.caddyfileError, "cannot read\ndenied");
    assert.equal(body.domain, "lychee.land");
  });

  test("?refresh=1 pulls once and a plain read never pulls", async () => {
    const s = await start();
    await get(s.base);
    await get(s.base);
    assert.equal(counts.pulls, 0);
    await get(s.base, "?refresh=1");
    assert.equal(counts.pulls, 1);
  });

  test("401 without credentials", async () => {
    const s = await start();
    assert.equal((await fetch(`${s.base}/api/sites/new`)).status, 401);
  });

  test("/api/sites/new is not read as a hostname", async () => {
    const s = await start();
    const { res, body } = await get(s.base);
    assert.equal(res.status, 200);
    assert.ok("portOwners" in body);
  });
});
