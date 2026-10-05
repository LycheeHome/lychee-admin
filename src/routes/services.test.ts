import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { SystemCommands } from "../lib/systemCommands";

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

/** The status word of each rendered row, in page order. */
function pills(html: string): string[] {
  return [...html.matchAll(/&#9679;<\/span> ([a-z ]+)<\/span>/g)].map((m) => m[1]);
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
        return Promise.resolve({ next: new Date(Date.now() + 180_000), last: null });
      },
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateCalls, 1);
    assert.deepEqual(requested, ["lyly-reconcile.timer", "lyly-reconcile.service", "swee.service"]);
    assert.deepEqual(timers, ["lyly-reconcile.timer"]);
    assert.match(html, /next run in 3 minutes/);
    assert.deepEqual(pills(html).slice(-1), ["running"]);
  });

  test("a reconciler entry that is not a timer is not mistaken for one", async () => {
    const timers: string[] = [];
    const s = await start(inventory([RECONCILER[1], SWEE]), {
      readTimerSchedule: (t) => {
        timers.push(t);
        return Promise.resolve({ next: null, last: null });
      },
    });
    const html = await (await s.get("/services")).text();
    assert.deepEqual(timers, []);
    assert.ok(!html.includes("next run"));
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
    const html = await res.text();
    assert.ok(html.includes("inventory-unavailable"));
    assert.deepEqual(pills(html), []);
  });

  test("unreadable systemctl degrades every row to unknown", async () => {
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: () => Promise.reject(new Error("systemctl not found")),
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const statuses = pills(await res.text());
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
    const html = await res.text();
    assert.ok(!html.includes("next run"));
    assert.deepEqual(pills(html).slice(-1), ["running"]);
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

  const CONTAINER = {
    name: "palsave-api", kind: "container", container: "palsave-api", group: "service", reconciled: true, version: "0.3.0",
  };

  test("container rows render beside unit rows, and are not asked of systemctl", async () => {
    let requested: string[] = [];
    const projects: string[] = [];
    const s = await start(inventory([SWEE, CONTAINER]), {
      readUnitStates: (units) => {
        requested = units;
        return Promise.resolve({ "swee.service": { status: "running", since: null } });
      },
      readResourceStatus: (p) => {
        projects.push(p);
        return Promise.resolve("unhealthy");
      },
    });
    const html = await (await s.get("/services")).text();
    assert.deepEqual(requested, ["swee.service"]);
    assert.deepEqual(projects, ["palsave-api"]);
    assert.deepEqual(pills(html), ["running", "unhealthy"]);
  });

  test("a failed container status read degrades to unknown, not a 500", async () => {
    const s = await start(inventory([SWEE, CONTAINER]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
      readResourceStatus: () => Promise.reject(new Error("docker not found")),
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    assert.deepEqual(pills(await res.text()), ["running", "unknown"]);
  });

  test("an unknown container renders neutral, not as a failure", async () => {
    const s = await start(inventory([CONTAINER]), {
      readResourceStatus: () => Promise.resolve("unknown"),
    });
    const html = await (await s.get("/services")).text();
    const { TONE_PILL } = await import("../views/shared");
    assert.ok(html.includes(TONE_PILL.neutral));
    assert.ok(!html.includes(TONE_PILL.bad));
  });

  test("an inventory with no kind still renders its units", async () => {
    const s = await start(inventory([SWEE]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
    });
    assert.deepEqual(pills(await (await s.get("/services")).text()), ["running"]);
  });

  test("container reads run concurrently with each other", async () => {
    const release: Array<() => void> = [];
    let started = 0;
    const s = await start(
      inventory([CONTAINER, { ...CONTAINER, name: "b", container: "b" }]),
      {
        readResourceStatus: () =>
          new Promise((resolve) => {
            started++;
            release.push(() => resolve("running"));
            if (started === 2) release.forEach((r) => r());
          }),
      },
    );
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    assert.equal(started, 2);
  });
});

describe("POST /services/:name/deploy", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const NOTES = { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
    version: "v1.4.0", target: "v1.4.0", available: "v1.5.0" };

  async function post(inv: unknown[], overrides: Partial<SystemCommands>, name = "notes") {
    await current?.close();
    current = await serve(inventory(inv), overrides);
    return fetch(`${current.base}/services/${name}/deploy`, { method: "POST", headers: { Authorization: AUTH } });
  }

  test("requires authentication", async () => {
    current = await serve(inventory([NOTES]), {});
    const res = await fetch(`${current.base}/services/notes/deploy`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  test("writes the inventory's available tag, never one from the request", async () => {
    const writes: Array<[string, string]> = [];
    const res = await post([NOTES], { writeDeclarationTag: (n, t) => (writes.push([n, t]), Promise.resolve({ ok: true })) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, tag: "v1.5.0" });
    assert.deepEqual(writes, [["notes", "v1.5.0"]]);
  });

  test("a write failure renders the reason, not a 500", async () => {
    const res = await post([NOTES], { writeDeclarationTag: () => Promise.resolve({ ok: false, reason: "push rejected" }) });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { ok: false, reason: "push rejected" });
  });

  test("Deploy for a tag that no longer exists reports the apply failure", async () => {
    const reason = "No declaration named notes.yml in lychee-resources.";
    const res = await post([NOTES], { writeDeclarationTag: () => Promise.resolve({ ok: false, reason }) });
    assert.equal(((await res.json()) as { reason: string }).reason, reason);
  });

  test("a writer that throws despite its contract still answers with a reason", async () => {
    const res = await post([NOTES], { writeDeclarationTag: () => Promise.reject(new Error("boom")) });
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { reason: string }).reason, /boom/);
  });

  test("an unknown service, or one with nothing on offer, writes nothing", async () => {
    let writes = 0;
    const overrides = { writeDeclarationTag: () => (writes++, Promise.resolve({ ok: true as const })) };
    assert.equal((await post([NOTES], overrides, "ghost")).status, 404);
    assert.equal((await post([{ ...NOTES, available: undefined }], overrides)).status, 409);
    assert.equal((await post([{ ...NOTES, available: "v1.4.0" }], overrides)).status, 409);
    assert.equal(writes, 0);
  });
});
