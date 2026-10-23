import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { ApiOk } from "../shared/board";
import type { SitesPayload } from "../shared/sites";

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
  const server: Server = createApp(deps).listen(0);
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

describe("GET /api/sites", () => {
  const open: Array<{ close: () => Promise<void> }> = [];
  after(async () => {
    for (const s of open) await s.close();
  });
  async function start(tweak?: Parameters<typeof serve>[0]) {
    const s = await serve(tweak);
    open.push(s);
    return s;
  }
  const get = async (base: string) => {
    const res = await fetch(`${base}/api/sites`, { headers: { Authorization: AUTH } });
    return { res, body: (await res.json()) as ApiOk<SitesPayload> };
  };

  test("requires authentication", async () => {
    const s = await start();
    assert.equal((await fetch(`${s.base}/api/sites`)).status, 401);
  });

  test("lists the managed sites in Caddyfile order and not lychee.local", async () => {
    const s = await start();
    const { res, body } = await get(s.base);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.domain, "lychee.land");
    assert.equal(body.caddyfileError, null);
    const hosts = body.sites.map((x) => x.hostname);
    assert.ok(hosts.length > 0);
    assert.ok(!hosts.includes("lychee.local"));
    for (const h of ["api.lychee.land", "app.lychee.land", "preview.lychee.land", "broken.lychee.land", "gone.lychee.land"]) {
      assert.ok(hosts.includes(h), h);
    }
    const api = body.sites.find((x) => x.hostname === "api.lychee.land");
    assert.equal(api?.type, "reverse-proxy");
    assert.equal(typeof api?.target, "string");
  });

  test("statuses match what the list page shows for the seeded proxies", async () => {
    const s = await start();
    const { body } = await get(s.base);
    const { computeStatuses } = await import("./sites");
    const { config } = await import("../config");
    const caddyfile = await import("../lib/caddyfile");
    const { isManagedHostname } = await import("../lib/siteValidation");
    const sites = caddyfile
      .parseSites(s.fakes.fs.readFile(config.caddyfilePath))
      .filter((x) => isManagedHostname(x.hostname, config.domain));
    const direct = await computeStatuses(sites, {
      commands: s.fakes.commands,
      fs: s.fakes.fs,
    } as unknown as Deps);
    assert.deepEqual(body.statuses, JSON.parse(JSON.stringify(direct)));
    for (const h of ["api.lychee.land", "app.lychee.land", "preview.lychee.land", "broken.lychee.land", "gone.lychee.land"]) {
      assert.ok(body.statuses[h], `status for ${h}`);
    }
  });

  test("problems is empty when healthy and holds one line when caddy.service is down", async () => {
    const healthy = await start();
    assert.deepEqual((await get(healthy.base)).body.problems, []);
    const down = await start((_f, commands) => {
      const read = commands.readUnitStates;
      commands.readUnitStates = async (units) => {
        const states = await read(units);
        return { ...states, "caddy.service": { status: "exited", since: "now" } };
      };
      return commands;
    });
    const { body } = await get(down.base);
    assert.equal(body.problems.length, 1);
    assert.equal(body.problems[0].word, "exited");
  });

  test("an unreadable Caddyfile answers 200 with the error and empty arrays", async () => {
    const s = await start();
    const { config } = await import("../config");
    s.fakes.fs.rmRecursive(config.caddyfilePath);
    const { clearBoardCache } = await import("./services");
    clearBoardCache();
    const { res, body } = await get(s.base);
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.caddyfileError && body.caddyfileError.length > 0);
    assert.deepEqual(body.sites, []);
    assert.deepEqual(body.statuses, {});
    assert.deepEqual(body.problems, []);
  });

  test("health then sites within 5s make one status pass", async () => {
    let checks = 0;
    const s = await start((_f, commands) => {
      const check = commands.checkResourceContainerStatus;
      commands.checkResourceContainerStatus = (p) => (checks++, check(p));
      return commands;
    });
    await fetch(`${s.base}/api/health`, { headers: { Authorization: AUTH } });
    const afterHealth = checks;
    assert.ok(afterHealth > 0, "health read no container");
    await get(s.base);
    assert.equal(checks, afterHealth);
  });

  test("a site added through POST /sites shows on the next read, with its status", async () => {
    const s = await start();
    const first = await get(s.base);
    assert.ok(!first.body.sites.some((x) => x.hostname === "docs.lychee.land"));
    const post = await fetch(`${s.base}/sites`, {
      method: "POST",
      headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "5055" }).toString(),
    });
    assert.equal(post.status, 200, await post.clone().text());
    const second = await get(s.base);
    assert.ok(second.body.sites.some((x) => x.hostname === "docs.lychee.land"));
    assert.ok(second.body.statuses["docs.lychee.land"]);
  });
});
