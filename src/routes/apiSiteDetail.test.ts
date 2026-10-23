import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { ApiOk } from "../shared/board";
import type { SiteDetailPayload } from "../shared/siteDetail";

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


describe("GET /api/sites/:hostname", () => {
  const open: Array<{ close: () => Promise<void> }> = [];
  after(async () => {
    for (const s of open) await s.close();
  });
  const counts = { pulls: 0, unitReads: 0 };
  async function start() {
    counts.pulls = 0;
    counts.unitReads = 0;
    const { clearBoardCache } = await import("./services");
    clearBoardCache();
    const s = await serve((_f, c) => ({
      ...c,
      refreshDeclarations: () => {
        counts.pulls++;
        return c.refreshDeclarations();
      },
      readUnitStates: (units) => {
        counts.unitReads++;
        return c.readUnitStates(units);
      },
    }));
    open.push(s);
    return s;
  }
  const get = async (base: string, host: string, query = "") => {
    const res = await fetch(`${base}/api/sites/${host}${query}`, { headers: { Authorization: AUTH } });
    return { res, body: (await res.json()) as ApiOk<Extract<SiteDetailPayload, { site: unknown }>> };
  };

  test("each seed site answers 200 with its facts", async () => {
    const s = await start();
    const root = await get(s.base, "lychee.land");
    assert.equal(root.res.status, 200);
    assert.equal(root.body.site.hostname, "lychee.land");
    assert.ok(root.body.filesPath);
    assert.equal(root.body.filesExist, true);
    const app = await get(s.base, "app.lychee.land");
    assert.equal(app.body.resource?.version, "0.2.0");
    assert.equal(app.body.resource?.available, "0.3.0");
    const gone = await get(s.base, "gone.lychee.land");
    assert.equal(gone.body.detached, true);
    const api = await get(s.base, "api.lychee.land");
    assert.equal(api.body.status?.kind, "tcp");
  });

  test("an unknown hostname answers 404 { ok: false, reason }", async () => {
    const s = await start();
    const res = await fetch(`${s.base}/api/sites/nope.lychee.land`, { headers: { Authorization: AUTH } });
    assert.equal(res.status, 404);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.equal(typeof body.reason, "string");
  });

  test("the hostname is matched case-insensitively", async () => {
    const s = await start();
    const { res, body } = await get(s.base, "APP.lychee.land");
    assert.equal(res.status, 200);
    assert.equal(body.site.hostname, "app.lychee.land");
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
    const res = await fetch(`${s.base}/api/sites/app.lychee.land`, { headers: { Authorization: AUTH } });
    s.fakes.fs.readFile = original;
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; caddyfileError: string; domain: string };
    assert.equal(body.ok, true);
    assert.equal(body.caddyfileError, "cannot read\ndenied");
    assert.equal(body.domain, "lychee.land");
  });

  test("401 without credentials", async () => {
    const s = await start();
    assert.equal((await fetch(`${s.base}/api/sites/app.lychee.land`)).status, 401);
  });

  test("?refresh=1 pulls once and a plain read never pulls", async () => {
    const s = await start();
    await get(s.base, "app.lychee.land");
    await get(s.base, "app.lychee.land");
    assert.equal(counts.pulls, 0);
    await get(s.base, "app.lychee.land", "?refresh=1");
    assert.equal(counts.pulls, 1);
    await get(s.base, "lychee.land", "?refresh=1");
    assert.equal(counts.pulls, 1);
  });

  test("two reads within 5s make one host read", async () => {
    const s = await start();
    await get(s.base, "app.lychee.land");
    await get(s.base, "app.lychee.land");
    assert.equal(counts.unitReads, 1);
  });

  test("a refresh read evicts and re-reads", async () => {
    const s = await start();
    await get(s.base, "app.lychee.land");
    await get(s.base, "app.lychee.land", "?refresh=1");
    assert.equal(counts.unitReads, 2);
  });

  test("a write clears it", async () => {
    const s = await start();
    await get(s.base, "legacy.lychee.land");
    const res = await fetch(`${s.base}/sites/legacy.lychee.land/attach`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded", Origin: s.base },
      body: "repo=legacy",
    });
    assert.equal(res.status, 200);
    await get(s.base, "legacy.lychee.land");
    assert.equal(counts.unitReads, 2);
  });
});
