import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { SystemCommands } from "../lib/systemCommands";
import type { ServiceBoard } from "../lib/serviceBoard";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lyly.dev";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lyly-admin/actions.log";
process.env.CADDYFILE_PATH = "/etc/caddy/Caddyfile";
process.env.TUNNEL_CONFIG_PATH = "/etc/cloudflared/sites-config.yml";
process.env.SITES_ROOT = "/var/www";
process.env.BACKUP_DIR = "/etc/lyly-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;
const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";

function inventory(services: unknown[]): string {
  return JSON.stringify({ generated: "2026-10-02T04:58:02Z", services });
}

const RECONCILER = [
  { name: "lyly-reconcile-timer", unit: "lyly-reconcile.timer", group: "reconciler", reconciled: false },
  { name: "lyly-reconcile", unit: "lyly-reconcile.service", group: "reconciler", reconciled: false },
];
const SWEE = { name: "swee", unit: "swee.service", group: "service", reconciled: true, result: "skipped" };

async function serve(
  inventoryJson: string | null,
  overrides: Partial<SystemCommands>,
): Promise<{ base: string; get: (p: string) => Promise<Response>; close: () => Promise<void> }> {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const fakes = createFakes(overrides);
  if (inventoryJson !== null) fakes.fs.writeFile(INVENTORY_PATH, inventoryJson);
  const deps: Deps = {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  };
  const server: Server = createApp(deps).listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    get: (p) => fetch(`${base}${p}`, { headers: { Authorization: AUTH } }),
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function board(res: Response): Promise<ServiceBoard> {
  return JSON.parse(await res.text()) as ServiceBoard;
}

describe("GET /services", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  test("requires authentication", async () => {
    const s = await start(null, {});
    const res = await fetch(`${s.base}/services`);
    assert.equal(res.status, 401);
  });

  test("reads states once for every declared unit and finds the timer from the data", async () => {
    let stateCalls = 0;
    let requested: string[] = [];
    const timers: string[] = [];
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: (units) => {
        stateCalls++;
        requested = units;
        return Promise.resolve({ "swee.service": { status: "running", since: null } });
      },
      readTimerSchedule: (t) => {
        timers.push(t);
        return Promise.resolve({ next: new Date("2026-10-02T05:02:56Z"), last: null });
      },
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const b = await board(res);
    assert.equal(stateCalls, 1);
    assert.deepEqual(requested, ["lyly-reconcile.timer", "lyly-reconcile.service", "swee.service"]);
    assert.deepEqual(timers, ["lyly-reconcile.timer"]);
    assert.equal(b.schedule.next, "2026-10-02T05:02:56.000Z");
    assert.equal(b.groups[1].rows[0].status, "running");
  });

  test("a reconciler entry that is not a timer is not mistaken for one", async () => {
    const timers: string[] = [];
    const s = await start(inventory([RECONCILER[1], SWEE]), {
      readTimerSchedule: (t) => {
        timers.push(t);
        return Promise.resolve({ next: null, last: null });
      },
    });
    const b = await board(await s.get("/services"));
    assert.deepEqual(timers, []);
    assert.deepEqual(b.schedule, { next: null, last: null });
  });

  test("a timer in another group is not the reconciler's timer", async () => {
    const timers: string[] = [];
    const s = await start(
      inventory([{ name: "x", unit: "x.timer", group: "service", reconciled: false }]),
      { readTimerSchedule: (t) => (timers.push(t), Promise.resolve({ next: null, last: null })) },
    );
    await s.get("/services");
    assert.deepEqual(timers, []);
  });

  test("a missing inventory yields a page, not an error", async () => {
    const s = await start(null, {});
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const b = await board(res);
    assert.equal(b.inventoryAvailable, false);
    assert.deepEqual(b.groups, []);
  });

  test("unreadable systemctl degrades every row to unknown", async () => {
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: () => Promise.reject(new Error("systemctl not found")),
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const b = await board(res);
    const statuses = b.groups.flatMap((g) => g.rows.map((r) => r.status));
    assert.equal(statuses.length, 3);
    assert.ok(statuses.every((st) => st === "unknown"));
  });

  test("a failed schedule read leaves liveness intact", async () => {
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
      readTimerSchedule: () => Promise.reject(new Error("boom")),
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const b = await board(res);
    assert.deepEqual(b.schedule, { next: null, last: null });
    assert.equal(b.groups[1].rows[0].status, "running");
  });

  test("the two reads run concurrently", async () => {
    let releaseStates: () => void = () => undefined;
    let scheduleStarted = false;
    const s = await start(inventory(RECONCILER), {
      readUnitStates: () =>
        new Promise((resolve) => {
          releaseStates = () => resolve({});
        }),
      readTimerSchedule: () => {
        scheduleStarted = true;
        releaseStates();
        return Promise.resolve({ next: null, last: null });
      },
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    assert.ok(scheduleStarted);
  });
});
