import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { HealthPayload } from "../shared/health";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

async function serve(opts: { inventory: boolean } = { inventory: true }) {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const { applySeed, SEEDED_DECLARATIONS, SEED_CADDYFILE } = await import("../dev/seed");
  const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
  if (opts.inventory) applySeed(fakes.fs);
  else {
    // No inventory file: the Caddyfile alone.
    const { config } = await import("../config");
    fakes.fs.writeFile(config.caddyfilePath, SEED_CADDYFILE);
  }
  const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
  const server: Server = createApp(deps).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

describe("GET /api/health", () => {
  const open: Array<{ close: () => Promise<void> }> = [];
  after(async () => {
    for (const s of open) await s.close();
  });
  async function start(opts?: { inventory: boolean }) {
    const s = await serve(opts);
    open.push(s);
    return s;
  }

  test("requires authentication", async () => {
    const s = await start();
    assert.equal((await fetch(`${s.base}/api/health`)).status, 401);
  });

  test("seeded sites carry the right tones", async () => {
    const s = await start();
    const res = await fetch(`${s.base}/api/health`, { headers: { Authorization: AUTH } });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: true } & HealthPayload;
    assert.equal(body.ok, true);
    const tone = (h: string) => body.sites.find((x) => x.hostname === h)?.tone;
    assert.equal(tone("api.lychee.land"), "bad");
    assert.equal(tone("app.lychee.land"), "ok");
    assert.equal(tone("preview.lychee.land"), "neutral");
    assert.equal(tone("lychee.land"), "none");
    assert.equal(body.sites.find((x) => x.hostname === "lychee.local"), undefined);
  });

  test("units include swee's blocked deploy and exclude site containers", async () => {
    const s = await start();
    const body = (await (await fetch(`${s.base}/api/health`, { headers: { Authorization: AUTH } })).json()) as HealthPayload;
    assert.ok(body.units);
    const swee = body.units.find((u) => u.name === "swee");
    assert.equal(swee?.trouble, "blocked");
    assert.equal(swee?.attention, true);
    assert.equal(body.units.find((u) => u.name === "broken-lychee-land"), undefined);
    assert.ok(body.units.find((u) => u.name === "palsave-api"));
  });

  test("a missing inventory gives units: null", async () => {
    const s = await start({ inventory: false });
    const body = (await (await fetch(`${s.base}/api/health`, { headers: { Authorization: AUTH } })).json()) as HealthPayload;
    assert.equal(body.units, null);
  });
});

describe("GET /api/health container reads", () => {
  test("each installed container is read at most once per poll, with unchanged results", async () => {
    const { createApp } = await import("../app");
    const { createBackup } = await import("../lib/backup");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");
    const { applySeed, SEEDED_DECLARATIONS } = await import("../dev/seed");
    const run = async (wrap: boolean) => {
      const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
      applySeed(fakes.fs);
      const calls: string[] = [];
      const commands = { ...fakes.commands };
      if (wrap) {
        const check = commands.checkResourceContainerStatus;
        const read = commands.readResourceStatus;
        commands.checkResourceContainerStatus = (p) => (calls.push(`check:${p}`), check(p));
        commands.readResourceStatus = (p) => (calls.push(`read:${p}`), read(p));
      }
      const deps: Deps = { commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
      const server: Server = createApp(deps).listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const body = (await (await fetch(`http://127.0.0.1:${address.port}/api/health`, { headers: { Authorization: AUTH } })).json()) as unknown;
      server.close();
      await once(server, "close");
      return { body, calls };
    };
    const { body, calls } = await run(true);
    const { body: plain } = await run(false);
    const reads = new Map<string, number>();
    for (const c of calls) {
      const project = c.slice(c.indexOf(":") + 1);
      reads.set(project, (reads.get(project) ?? 0) + 1);
    }
    assert.ok(calls.length > 0, "no container was read at all");
    for (const [project, n] of reads) assert.equal(n, 1, `${project} was read ${n} times: ${calls.join(", ")}`);
    const strip = (b: unknown) => ({ ...(b as object), now: undefined });
    assert.deepEqual(strip(body), strip(plain));
  });
});
