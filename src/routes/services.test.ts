import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { SystemCommands } from "../lib/systemCommands";
import type { ServiceGroup } from "../lib/serviceInventory";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;
const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";

function inventory(services: unknown[]): string {
  return JSON.stringify({ generated: "2026-10-02T04:58:02Z", services });
}

const RECONCILER = [
  { name: "lychee-reconcile-timer", unit: "lychee-reconcile.timer", group: "reconciler", reconciled: false },
  { name: "lychee-reconcile", unit: "lychee-reconcile.service", group: "reconciler", reconciled: false },
];
const SWEE = { name: "swee", unit: "swee.service", group: "service", reconciled: true, result: "skipped" };

async function serve(
  inventoryJson: string | null,
  overrides: Partial<SystemCommands>,
  seed: { opRun?: { delayMs?: number } } = {},
  clientDocument?: string | null,
): Promise<{ base: string; fs: Deps["fs"]; get: (p: string) => Promise<Response>; api: (group: ServiceGroup) => Promise<Response>; actions: () => string[]; audit: () => Record<string, unknown>[]; close: () => Promise<void> }> {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const fakes = createFakes(overrides, seed);
  if (inventoryJson !== null) fakes.fs.writeFile(INVENTORY_PATH, inventoryJson);
  const deps: Deps = {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  };
  deps.clientDocument = clientDocument;
  const server: Server = createApp(deps).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    fs: fakes.fs,
    get: (p) => fetch(`${base}${p}`, { headers: { Authorization: AUTH } }),
    api: (group) => fetch(`${base}/api/services?group=${group}`, { headers: { Authorization: AUTH } }),
    audit: () => {
      const file = process.env.LOG_FILE as string;
      if (!fakes.fs.exists(file)) return [];
      return fakes.fs.readFile(file).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    actions: () => {
      const file = process.env.LOG_FILE as string;
      if (!fakes.fs.exists(file)) return [];
      return fakes.fs
        .readFile(file)
        .split("\n")
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { action: string }).action);
    },
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

type BoardPath = "/services" | "/reconciler" | "/infrastructure";

/*
 * What a board page shows is rendered by the client now. The tests of a board
 * page's markup (pills, eyebrows, Prune, the requested line, host-action
 * state, site links) render GET /api/services through the React Board in
 * src/client/pages/BoardRoutes.test.tsx; the tests below that only count the
 * host reads behind that payload ask the JSON directly.
 */

describe("GET /services: the reads behind the board", () => {
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

  test("a timer in another group is not the reconciler's timer", async () => {
    const timers: string[] = [];
    const s = await start(
      inventory([{ name: "x", unit: "x.timer", group: "service", reconciled: false }]),
      { readTimerSchedule: (t) => (timers.push(t), Promise.resolve({ next: null, last: null })) },
    );
    await s.api("service");
    assert.deepEqual(timers, []);
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
    const res = await s.api("service");
    assert.equal(res.status, 200);
    assert.ok(scheduleStarted);
  });

  const CONTAINER = {
    name: "palsave-api", kind: "container", container: "palsave-api", group: "service", reconciled: true, version: "0.3.0",
  };

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
    const res = await s.api("service");
    assert.equal(res.status, 200);
    assert.equal(started, 2);
  });
});

describe("the three board pages", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  // Which rail item is current is React's now (the router tests).
  const PAGES: BoardPath[] = ["/services", "/reconciler"];

  for (const path of PAGES) {
    test(`${path} requires authentication`, async () => {
      const s = await start(null, {});
      assert.equal((await fetch(`${s.base}${path}`)).status, 401);
    });
  }

  test("every page reads the whole board: one systemctl call for every declared unit, shared within the cache window", async () => {
    const calls: string[][] = [];
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: (units) => (calls.push(units), Promise.resolve({})),
    });
    for (const group of ["service", "reconciler"] as const) await s.api(group);
    assert.equal(calls.length, 1);
    for (const units of calls) assert.deepEqual(units, ["lychee-reconcile.timer", "lychee-reconcile.service", "swee.service"]);
  });
});

// The board pages send the static document; staticShell.test.ts holds every
// client route's statuses, and the rail and titles are React's now
// (AppFrame.test.tsx, AppFrameParity.test.tsx, the router tests).
describe("GET /services, /reconciler and /infrastructure: the static document", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const DOCUMENT = "<!doctype html><!-- the static document -->";

  test("each board page answers 200 with the document, a missing inventory included", async () => {
    await current?.close();
    current = await serve(null, {}, {}, DOCUMENT);
    for (const path of ["/services", "/reconciler", "/infrastructure"]) {
      const res = await current.get(path);
      assert.equal(res.status, 200, path);
      assert.equal(await res.text(), DOCUMENT, path);
    }
  });

  test("each answers 500 when the document is missing", async () => {
    await current?.close();
    current = await serve(null, {}, {}, null);
    for (const path of ["/services", "/reconciler", "/infrastructure"]) {
      const res = await current.get(path);
      assert.equal(res.status, 500, path);
      assert.equal(await res.text(), "client bundle missing; run npm run build", path);
    }
  });

  test("the bundle's own files require authentication too", async () => {
    await current?.close();
    current = await serve(null, {}, {}, DOCUMENT);
    for (const path of ["/client/index.html", "/client/.vite/manifest.json", "/client/assets/main-abc.js", "/client/assets/main-def.css"]) {
      assert.equal((await fetch(`${current.base}${path}`)).status, 401, path);
    }
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

  test("a failed row with a newer tag accepts the deploy and writes that tag", async () => {
    const writes: Array<[string, string]> = [];
    const failed = { ...NOTES, target: "v1.5.0", available: "v1.6.0", result: "failed", failed_step: "Start the container: exit 1" };
    const res = await post([failed], { writeDeclarationTag: (n, t) => (writes.push([n, t]), Promise.resolve({ ok: true })) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, tag: "v1.6.0" });
    assert.deepEqual(writes, [["notes", "v1.6.0"]]);
  });

  test("a tag already requested is a 409 and writes nothing", async () => {
    let writes = 0;
    const overrides = { writeDeclarationTag: () => (writes++, Promise.resolve({ ok: true as const })) };
    assert.equal((await post([{ ...NOTES, target: "v1.5.0" }], overrides)).status, 409);
    assert.equal(writes, 0);
  });
});

describe("POST /resources/:name/prune", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const SITE = "test-lychee-land";
  const DOWN = { name: SITE, kind: "container", container: SITE, group: "service", reconciled: true, result: "deployed" };
  const DECL = [{ name: SITE, port: 3000, state: "absent", image: "ghcr.io/lycheehome/x" }];
  const CONFIRM_REASON = "the container hasn't been confirmed down yet; try after the next reconcile";

  async function post(inv: unknown[], overrides: Partial<SystemCommands>, name = SITE) {
    await current?.close();
    current = await serve(inventory(inv), overrides);
    return fetch(`${current.base}/resources/${name}/prune`, { method: "POST", headers: { Authorization: AUTH } });
  }
  function spy(result: Awaited<ReturnType<SystemCommands["pruneSiteDeclaration"]>> = { ok: true }) {
    const calls: string[] = [];
    const opts: unknown[] = [];
    return {
      calls,
      opts,
      overrides: {
        readDeclarations: () => Promise.resolve(DECL),
        pruneSiteDeclaration: (n: string, o?: { requireTagless?: boolean }) => (calls.push(n), opts.push(o), Promise.resolve(result)),
      },
    };
  }

  test("requires authentication", async () => {
    current = await serve(inventory([DOWN]), {});
    const res = await fetch(`${current.base}/resources/${SITE}/prune`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  test("a confirmed-down retired site is pruned", async () => {
    const { calls, overrides } = spy();
    const res = await post([DOWN], overrides);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(calls, [SITE]);
  });

  test("awaiting-image counts as confirmed down, but only for a tagless declaration", async () => {
    const { calls, opts, overrides } = spy();
    const res = await post([{ ...DOWN, result: "awaiting-image" }], overrides);
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [SITE]);
    assert.deepEqual(opts, [{ requireTagless: true }]);
  });

  test("deployed does not ask the writer for a tagless declaration", async () => {
    const { opts, overrides } = spy();
    await post([DOWN], overrides);
    assert.deepEqual(opts, [{ requireTagless: false }]);
  });

  test("awaiting-image with a writer tagged refusal is the not-confirmed-down 409", async () => {
    const res = await post(
      [{ ...DOWN, result: "awaiting-image" }],
      spy({ ok: false, code: "tagged", reason: "test-lychee-land.yml has a tag" }).overrides,
    );
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { ok: false, reason: CONFIRM_REASON });
  });

  test("an installed version, a failed result or no inventory entry is a 409 and writes nothing", async () => {
    const { calls, overrides } = spy();
    for (const inv of [[{ ...DOWN, version: "v1" }], [{ ...DOWN, result: "failed" }], []]) {
      const res = await post(inv, overrides);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { ok: false, reason: CONFIRM_REASON });
    }
    assert.equal(calls.length, 0);
  });

  test("an unreadable clone is a 502", async () => {
    const { calls, overrides } = spy();
    const res = await post([DOWN], { ...overrides, readDeclarations: () => Promise.resolve(null) });
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    assert.equal(calls.length, 0);
  });

  test("no such declaration is a 404", async () => {
    const { calls, overrides } = spy();
    const res = await post([DOWN], { ...overrides, readDeclarations: () => Promise.resolve([]) });
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  });

  test("writer refusals map: not-absent 409, missing 404, other 502", async () => {
    const reason = "writer said no";
    assert.equal((await post([DOWN], spy({ ok: false, reason, code: "not-absent" }).overrides)).status, 409);
    assert.equal((await post([DOWN], spy({ ok: false, reason, code: "missing" }).overrides)).status, 404);
    const res = await post([DOWN], spy({ ok: false, reason }).overrides);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { ok: false, reason });
  });

  test("a writer that throws still answers with a reason", async () => {
    const { overrides } = spy();
    const res = await post([DOWN], { ...overrides, pruneSiteDeclaration: () => Promise.reject(new Error("boom")) });
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { reason: string }).reason, /boom/);
  });

  test("a success logs prune-declaration exactly once", async () => {
    await post([DOWN], spy().overrides);
    assert.deepEqual(current?.actions(), ["prune-declaration"]);
  });

  test("a 404 (no declaration) and a 409 (not confirmed down) each log one prune-declaration-refused with a reason", async () => {
    await post([DOWN], { ...spy().overrides, readDeclarations: () => Promise.resolve([]) });
    assert.deepEqual(current?.actions(), ["prune-declaration-refused"]);
    await post([], spy().overrides);
    assert.deepEqual(current?.actions(), ["prune-declaration-refused"]);
    await post([DOWN], spy().overrides, "palsave-api");
    assert.deepEqual(current?.actions(), ["prune-declaration-refused"]);
  });

  test("a writer refusal that maps to 409 or 404 logs once, as refused", async () => {
    for (const code of ["not-absent", "missing", "tagged"] as const) {
      await post([DOWN], spy({ ok: false, reason: "no", code }).overrides);
      assert.deepEqual(current?.actions(), ["prune-declaration-refused"], code);
    }
    await post([DOWN], spy({ ok: false, reason: "disk" }).overrides);
    assert.deepEqual(current?.actions(), ["prune-declaration-failed"]);
  });

  test("a non-site name is a 404 before anything is read", async () => {
    let reads = 0;
    const { calls, overrides } = spy();
    const res = await post([DOWN], { ...overrides, readDeclarations: () => (reads++, Promise.resolve(DECL)) }, "palsave-api");
    assert.equal(res.status, 404);
    assert.equal(reads, 0);
    assert.equal(calls.length, 0);
  });
});

describe("host actions on the board", () => {
  const PAL = "palworld-palchuds";
  const GAME = {
    name: PAL,
    unit: `${PAL}.service`,
    group: "service",
    reconciled: false,
    actions: ["start", "stop", "restart", "update"],
  };
  const NO_ACTIONS = { name: "swee", unit: "swee.service", group: "service", reconciled: true, actions: ["start"] };
  const stateRoute = (unit: string, action: string) => `/services/${unit}/actions/${action}/state`;
  const actionRoute = (unit: string, action: string) => `/services/${unit}/actions/${action}`;
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  let starts: [string, string][] = [];
  after(async () => {
    await current?.close();
  });

  async function start(overrides: Partial<SystemCommands> = {}): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    starts = [];
    current = await serve(inventory([GAME, NO_ACTIONS]), {
      startHostAction: (unit, action) => {
        starts.push([unit, action]);
        return Promise.resolve();
      },
      readOpUnits: () => Promise.resolve({}),
      ...overrides,
    });
    return current;
  }

  function post(s: { base: string }, p: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${s.base}${p}`, { method: "POST", headers: { Authorization: AUTH, ...headers }, redirect: "manual" });
  }

  test("POST starts the action and redirects to /services with 303", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "restart"));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/services");
    assert.deepEqual(starts, [[PAL, "restart"]]);
  });

  test("POST with Accept: application/json answers 202 with the state", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "update"), { Accept: "application/json" });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, state: { unit: PAL, action: "update", state: "running", logTail: "" } });
    assert.deepEqual(starts, [[PAL, "update"]]);
  });

  test("POST is audited as the operator", async () => {
    const s = await start();
    await post(s, actionRoute(PAL, "stop"));
    const lines = s.audit();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].caller, "operator");
    assert.equal(lines[0].unit, PAL);
    assert.equal(lines[0].hostAction, "stop");
    assert.equal(lines[0].outcome, "started");
  });

  test("an unknown action is refused 404 and never reaches the audit log", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "rm -rf"));
    assert.equal(res.status, 404);
    assert.deepEqual(s.audit(), []);
  });

  test("refusals are JSON {ok:false, reason}, never a redirect: unknown unit, unknown action, unlisted action", async () => {
    const s = await start();
    for (const [unit, action] of [
      ["nope", "start"],
      [PAL, "reboot"],
      ["swee", "stop"],
    ]) {
      const res = await post(s, actionRoute(unit, action));
      assert.equal(res.status, 404, `${unit} ${action}`);
      const body = (await res.json()) as { ok: boolean; reason: string };
      assert.equal(body.ok, false);
      assert.equal(typeof body.reason, "string");
    }
    assert.deepEqual(starts, []);
  });

  test("409 is surfaced when an action is already running", async () => {
    const s = await start({
      readOpUnits: () =>
        Promise.resolve({
          [`lychee-op-${PAL}-stop.service`]: { activeState: "active", result: "success", startedAt: "x", finishedAt: null },
        }),
    });
    const res = await post(s, actionRoute(PAL, "start"), { Accept: "application/json" });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.match(body.reason, /already running/);
    assert.deepEqual(starts, []);
  });

  test("502 is surfaced when the start fails", async () => {
    const s = await start({ startHostAction: () => Promise.reject(new Error("sudo refused")) });
    const res = await post(s, actionRoute(PAL, "start"));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.match(body.reason, /sudo refused/);
  });

  test("a cross-site POST is refused 403 and starts nothing", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "start"), { "Sec-Fetch-Site": "cross-site" });
    assert.equal(res.status, 403);
    assert.deepEqual(starts, []);
  });

  test("POST requires authentication", async () => {
    const s = await start();
    const res = await fetch(`${s.base}${actionRoute(PAL, "start")}`, { method: "POST" });
    assert.equal(res.status, 401);
    assert.deepEqual(starts, []);
  });

  test("GET state answers the action's state as JSON", async () => {
    const s = await start({
      readOpUnits: () =>
        Promise.resolve({
          [`lychee-op-${PAL}-restart.service`]: {
            activeState: "inactive",
            result: "success",
            startedAt: null,
            finishedAt: null,
          },
        }),
    });
    s.fs.writeFile(
      `/var/lib/lychee-op/${PAL}-restart.result.json`,
      JSON.stringify({ unit: PAL, action: "restart", result: "success", exit_status: 0, started_at: "2026-10-14T15:14:58Z", finished_at: "2026-10-14T15:15:03Z" }),
    );
    const res = await s.get(stateRoute(PAL, "restart"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; state: { unit: string; action: string; state: string } };
    assert.equal(body.ok, true);
    assert.equal(body.state.unit, PAL);
    assert.equal(body.state.action, "restart");
    assert.equal(body.state.state, "succeeded");
  });

  test("GET state: unknown unit, unknown action, unlisted action and a bad name are 404 JSON", async () => {
    const s = await start();
    for (const [unit, action] of [
      ["nope", "start"],
      [PAL, "reboot"],
      ["swee", "stop"],
      ["..%2Fetc", "start"],
    ]) {
      const res = await s.get(stateRoute(unit, action));
      assert.equal(res.status, 404, `${unit} ${action}`);
      assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    }
  });

  test("GET state answers 502 when systemd cannot be read, never a 500", async () => {
    const s = await start({ readOpUnits: () => Promise.reject(new Error("systemctl broke")) });
    const res = await s.get(stateRoute(PAL, "start"));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.match(body.reason, /systemctl broke/);
  });

  test("GET state requires authentication", async () => {
    const s = await start();
    const res = await fetch(`${s.base}${stateRoute(PAL, "start")}`);
    assert.equal(res.status, 401);
  });
});

describe("GET /api/services", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  test("returns only the requested group's rows in the envelope", async () => {
    const { SEEDED_INVENTORY } = await import("../dev/seed");
    const s = await start(SEEDED_INVENTORY, {});
    const res = await s.get("/api/services?group=infrastructure");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      now: string;
      board: { groups: { group: string; rows: { name: string }[] }[] };
    };
    assert.equal(body.ok, true);
    assert.ok(!Number.isNaN(Date.parse(body.now)));
    assert.deepEqual(body.board.groups.map((g) => g.group), ["infrastructure"]);
    assert.deepEqual(body.board.groups[0].rows.map((r) => r.name), ["caddy", "cloudflared-sites"]);
  });

  test("an unknown group is a 400 with the error envelope", async () => {
    const s = await start(null, {});
    const res = await s.get("/api/services?group=nope");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.equal(typeof body.reason, "string");
  });

  test("requires authentication", async () => {
    const s = await start(null, {});
    assert.equal((await fetch(`${s.base}/api/services?group=service`)).status, 401);
  });

  test("a missing inventory still answers 200 with inventoryAvailable false", async () => {
    const s = await start(null, {});
    const res = await s.get("/api/services?group=service");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; board: { inventoryAvailable: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.board.inventoryAvailable, false);
  });
});

describe("GET /api/services boardEmpty", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  test("an inventory declaring only other groups is not an empty board", async () => {
    current = await serve(inventory([SWEE]), {});
    const body = (await (await current.get("/api/services?group=infrastructure")).json()) as {
      boardEmpty: boolean;
      board: { groups: { group: string }[] };
    };
    assert.equal(body.boardEmpty, false);
    assert.ok(!body.board.groups.some((g) => g.group === "infrastructure"));
  });

  test("an inventory with no entries is an empty board", async () => {
    await current?.close();
    current = await serve(inventory([]), {});
    const body = (await (await current.get("/api/services?group=service")).json()) as { boardEmpty: boolean };
    assert.equal(body.boardEmpty, true);
  });
});

describe("the shared board read", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const NOTES = { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
    version: "v1.4.0", target: "v1.4.0", available: "v1.5.0" };

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  test("one host read serves both endpoints within 5s", async () => {
    let reads = 0;
    const s = await start(inventory([SWEE]), {
      readUnitStates: () => (reads++, Promise.resolve({})),
    });
    s.fs.writeFile("/etc/caddy/Caddyfile", "http://app.lychee.land {\n  reverse_proxy localhost:3200\n}\n");
    assert.equal((await s.get("/api/health")).status, 200);
    assert.equal((await s.get("/api/services?group=service")).status, 200);
    assert.equal(reads, 1);
  });

  test("concurrent callers share one in-flight read", async () => {
    let reads = 0;
    const s = await start(inventory([SWEE]), {
      readUnitStates: () => (reads++, new Promise((r) => setTimeout(() => r({}), 50))),
    });
    s.fs.writeFile("/etc/caddy/Caddyfile", "http://app.lychee.land {\n  reverse_proxy localhost:3200\n}\n");
    await Promise.all([s.get("/api/health"), s.get("/api/services?group=service"), s.get("/api/services?group=reconciler")]);
    assert.equal(reads, 1);
  });

  test("a read after 5s refreshes", async () => {
    const { loadBoardPage } = await import("./services");
    const { createBackup } = await import("../lib/backup");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");
    let reads = 0;
    const fakes = createFakes({ readUnitStates: () => (reads++, Promise.resolve({})) });
    fakes.fs.writeFile(INVENTORY_PATH, inventory([SWEE]));
    const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
    let t = 1_000_000;
    const opts = { now: () => t };
    await loadBoardPage(deps, opts);
    t += 4_999;
    await loadBoardPage(deps, opts);
    assert.equal(reads, 1);
    t += 2;
    await loadBoardPage(deps, opts);
    assert.equal(reads, 2);
  });

  test("a write clears the cache", async () => {
    let reads = 0;
    let declared = "ghcr.io/lycheehome/notes:v1.4.0";
    const s = await start(inventory([NOTES]), {
      readUnitStates: () => (reads++, Promise.resolve({})),
      readDeclarations: () => Promise.resolve([{ name: "notes", port: 3000, state: "running", image: declared }]),
      writeDeclarationTag: (_n, tag) => {
        declared = `ghcr.io/lycheehome/notes:${tag}`;
        return Promise.resolve({ ok: true });
      },
    });
    const first = (await (await s.get("/api/services?group=service")).json()) as { requested: Record<string, string> };
    assert.deepEqual(first.requested, {});
    assert.equal(reads, 1);
    const res = await fetch(`${s.base}/services/notes/deploy`, { method: "POST", headers: { Authorization: AUTH } });
    assert.equal(res.status, 200);
    const second = (await (await s.get("/api/services?group=service")).json()) as { requested: Record<string, string> };
    assert.equal(reads, 2);
    assert.deepEqual(second.requested, { notes: "v1.5.0" });
  });

  test("prune and a host action clear the cache too", async () => {
    let reads = 0;
    const gone = { name: "gone-lychee-land", kind: "container", container: "gone-lychee-land", group: "service", reconciled: true, result: "deployed" };
    const s = await start(inventory([gone, { name: "palworld-palchuds", kind: "unit", unit: "palworld-palchuds.service", group: "service", reconciled: false, actions: ["start"] }]), {
      readUnitStates: () => (reads++, Promise.resolve({})),
      readDeclarations: () => Promise.resolve([{ name: "gone-lychee-land", port: 3400, state: "absent", image: "ghcr.io/lycheehome/gone" }]),
      pruneSiteDeclaration: () => Promise.resolve({ ok: true }),
    });
    await s.get("/api/services?group=service");
    await fetch(`${s.base}/resources/gone-lychee-land/prune`, { method: "POST", headers: { Authorization: AUTH } });
    await s.get("/api/services?group=service");
    assert.equal(reads, 2);
    await fetch(`${s.base}/services/palworld-palchuds/actions/start`, { method: "POST", headers: { Authorization: AUTH, Accept: "application/json" } });
    await s.get("/api/services?group=service");
    assert.equal(reads, 3);
  });

  test("the payload carries prunable, managed, domain, requested and lastRuns", async () => {
    const gone = { name: "gone-lychee-land", kind: "container", container: "gone-lychee-land", group: "service", reconciled: true, result: "deployed" };
    const pal = { name: "palworld-palchuds", kind: "unit", unit: "palworld-palchuds.service", group: "service", reconciled: false, actions: ["start", "stop"] };
    const s = await start(inventory([gone, NOTES, pal]), {
      readDeclarations: () =>
        Promise.resolve([
          { name: "gone-lychee-land", port: 3400, state: "absent", image: "ghcr.io/lycheehome/gone" },
          { name: "notes", port: 3000, state: "running", image: "ghcr.io/lycheehome/notes:v1.5.0" },
        ]),
      readOpUnits: (names) =>
        Promise.resolve(Object.fromEntries(names.map((n) => [n, { activeState: "inactive", result: "success", startedAt: null, finishedAt: null }]))),
    });
    s.fs.writeFile(
      "/var/lib/lychee-op/palworld-palchuds-stop.result.json",
      JSON.stringify({ unit: "palworld-palchuds", action: "stop", result: "success", exit_status: 0, started_at: "2026-10-14T15:14:58Z", finished_at: "2026-10-14T15:15:03Z" }),
    );
    const { config } = await import("../config");
    s.fs.writeFile(config.caddyfilePath, "http://blog.lychee.land {\n\troot * /var/www/blog.lychee.land\n\tfile_server\n}\n");
    const body = (await (await s.get("/api/services?group=service")).json()) as {
      prunable: string[]; managed: string[]; domain: string; requested: Record<string, string>; lastRuns: Record<string, { action: string; state: string }>;
    };
    assert.deepEqual(body.prunable, ["gone-lychee-land"]);
    assert.deepEqual(body.managed, ["blog.lychee.land"]);
    // The client maps a row's name to a managed hostname through it.
    assert.equal(body.domain, config.domain);
    assert.deepEqual(body.requested, { notes: "v1.5.0" });
    assert.equal(body.lastRuns["palworld-palchuds"].action, "stop");
    assert.equal(body.lastRuns["palworld-palchuds"].state, "succeeded");
  });

  test("the site page's writes clear the cache too: add, attach, repository, detach, delete, delete-files", async () => {
    let reads = 0;
    const s = await start(inventory([SWEE]), { readUnitStates: () => (reads++, Promise.resolve({})) });
    const { config } = await import("../config");
    s.fs.writeFile(config.caddyfilePath, "http://blog.lychee.land {\n\troot * /var/www/blog.lychee.land\n\tfile_server\n}\n");
    s.fs.writeFile(
      config.tunnelConfigPath,
      "tunnel: 11111111-2222-3333-4444-555555555555\ningress:\n  - hostname: blog.lychee.land\n    service: http://localhost:80\n  - service: http_status:404\n",
    );
    type Board = { managed: string[]; prunable: string[] };
    const board = async () => (await (await s.get("/api/services?group=service")).json()) as Board;
    const post = (p: string, fields: Record<string, string> = {}) =>
      fetch(`${s.base}${p}`, {
        method: "POST",
        headers: { Authorization: AUTH, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields).toString(),
      });

    assert.deepEqual((await board()).managed, ["blog.lychee.land"]);
    assert.equal(reads, 1);

    // Add: the new site is linked at once.
    assert.equal((await post("/sites", { hostname: "test.lychee.land", type: "reverse-proxy", port: "3000", framework: "nextjs" })).status, 200);
    assert.deepEqual((await board()).managed.sort(), ["blog.lychee.land", "test.lychee.land"]);
    assert.equal(reads, 2, "add: a fresh read");

    // Attach: a tagless running declaration changes nothing the board shows, but the read is fresh.
    assert.equal((await post("/sites/test.lychee.land/attach", { repo: "test-site" })).status, 200);
    await board();
    assert.equal(reads, 3, "attach: a fresh read");

    assert.equal((await post("/sites/test.lychee.land/repository", { repo: "test-site-2" })).status, 200);
    await board();
    assert.equal(reads, 4, "repository: a fresh read");

    // Remove: the Caddy block goes, then the declaration is retired.
    assert.equal((await post("/sites/test.lychee.land/delete")).status, 200);
    assert.deepEqual((await board()).managed, ["blog.lychee.land"], "delete: the removed site is no longer linked");
    assert.equal(reads, 5, "delete: a fresh read");

    assert.equal((await post("/sites/test.lychee.land/detach")).status, 200);
    assert.deepEqual((await board()).prunable, ["test-lychee-land"], "detach: the retired declaration is prunable");
    assert.equal(reads, 6, "detach: a fresh read");

    assert.equal((await post("/sites/blog.lychee.land/delete-files")).status, 200);
    await board();
    assert.equal(reads, 7, "delete-files: a fresh read");
  });
});
