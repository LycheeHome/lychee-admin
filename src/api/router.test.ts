import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type express from "express";
import type { Deps } from "../deps";
import type { SystemCommands } from "../lib/systemCommands";
import type { OpUnitState } from "../lib/unitState";
import { type HostAction, opUnitName } from "../lib/platform";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;
const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";
const PAL = "palworld-palchuds";
const OTHER = "other-game";

const SERVICES = [
  { name: PAL, unit: `${PAL}.service`, group: "service", reconciled: false, actions: ["start", "stop", "restart", "update"] },
  { name: OTHER, unit: `${OTHER}.service`, group: "service", reconciled: false, actions: ["start"] },
  { name: "lychee-docs", kind: "container", container: "lychee-docs", group: "service", reconciled: false },
];

interface Served {
  deps: Deps;
  starts: [string, string][];
  call: (method: string, p: string, headers?: Record<string, string>) => Promise<{ status: number; text: string; json: () => unknown }>;
  close: () => Promise<void>;
}

async function listen(app: express.Express, deps: Deps, starts: [string, string][]): Promise<Served> {
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    deps,
    starts,
    call: async (method, p, headers = {}) => {
      const res = await fetch(`${base}${p}`, { method, headers, redirect: "manual" });
      const text = await res.text();
      return { status: res.status, text, json: () => JSON.parse(text) };
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function fixture(overrides: Partial<SystemCommands> = {}, units: Record<string, OpUnitState> = {}) {
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const starts: [string, string][] = [];
  const fakes = createFakes({
    startHostAction: (unit, action) => {
      starts.push([unit, action]);
      return Promise.resolve();
    },
    readOpUnits: (names) => Promise.resolve(Object.fromEntries(names.filter((n) => n in units).map((n) => [n, units[n]]))),
    ...overrides,
  });
  fakes.fs.writeFile(INVENTORY_PATH, JSON.stringify({ generated: "2026-10-13T00:00:00Z", services: SERVICES }));
  const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
  return { deps, starts };
}

async function serveApi(
  grants: Record<string, HostAction[]>,
  overrides: Partial<SystemCommands> = {},
  units: Record<string, OpUnitState> = {},
): Promise<Served> {
  const { createApiApp } = await import("./router");
  const { deps, starts } = await fixture(overrides, units);
  return listen(createApiApp(deps, { kind: "client", name: "swee", grants }), deps, starts);
}

const ALL: Record<string, HostAction[]> = { [PAL]: ["start", "stop", "restart", "update"], [OTHER]: ["start"] };
const route = (unit: string, action: string) => `/v1/units/${unit}/actions/${action}`;

describe("the routers are kept apart", () => {
  test("the API app has no pages, no static files, no site, deploy or services routes", async () => {
    const s = await serveApi(ALL);
    for (const [method, p] of [
      ["GET", "/"],
      ["GET", "/services"],
      ["GET", "/sites/new"],
      ["GET", "/style.css"],
      ["GET", "/app.js"],
      ["POST", "/sites"],
      ["POST", "/sites/blog.lychee.land/delete"],
      ["POST", "/services/swee/deploy"],
      ["GET", "/v1"],
    ]) {
      const r = await s.call(method, p, { Authorization: AUTH });
      assert.equal(r.status, 404, `${method} ${p}`);
      assert.deepEqual(r.json(), { error: "not found" }, `${method} ${p}`);
    }
    await s.close();
  });

  test("the API needs no Basic auth", async () => {
    const s = await serveApi(ALL);
    const r = await s.call("GET", route(PAL, "restart"));
    assert.equal(r.status, 200);
    await s.close();
  });

  test("the network app has no /v1", async () => {
    const { createApp } = await import("../app");
    const { deps, starts } = await fixture();
    const s = await listen(createApp(deps), deps, starts);
    for (const method of ["GET", "POST"]) {
      const r = await s.call(method, route(PAL, "restart"), { Authorization: AUTH });
      assert.equal(r.status, 404, method);
    }
    assert.deepEqual(starts, []);
    await s.close();
  });
});

describe("POST /v1/units/:unit/actions/:action", () => {
  test("202 with the state", async () => {
    const s = await serveApi(ALL);
    const r = await s.call("POST", route(PAL, "restart"));
    assert.equal(r.status, 202);
    assert.deepEqual(r.json(), { unit: PAL, action: "restart", state: "running", logTail: "" });
    assert.deepEqual(s.starts, [[PAL, "restart"]]);
    const audit = s.deps.fs.readFile(process.env.LOG_FILE as string);
    assert.match(audit, /"caller":"client:swee".*"outcome":"started"/);
    await s.close();
  });

  test("an unknown action is 404 before anything else", async () => {
    const s = await serveApi(ALL);
    for (const action of ["rm", "Start", "start.service", "constructor"]) {
      const r = await s.call("POST", route(PAL, action));
      assert.equal(r.status, 404, action);
      assert.ok(typeof (r.json() as { error: unknown }).error === "string");
    }
    assert.deepEqual(s.starts, []);
    await s.close();
  });

  test("a unit the inventory does not list, or does not list the action for, is 404", async () => {
    const s = await serveApi(ALL);
    for (const [unit, action] of [["nope", "start"], [OTHER, "stop"], ["lychee-docs", "start"], [`${PAL}.service`, "start"]]) {
      const r = await s.call("POST", route(unit, action));
      assert.equal(r.status, 404, `${unit} ${action}`);
    }
    assert.deepEqual(s.starts, []);
    await s.close();
  });

  test("not granted is 403 with {error}", async () => {
    const s = await serveApi({ [PAL]: ["restart"] });
    const r = await s.call("POST", route(PAL, "update"));
    assert.equal(r.status, 403);
    assert.deepEqual(r.json(), { error: "client:swee is not granted update on palworld-palchuds" });
    assert.deepEqual(s.starts, []);
    await s.close();
  });

  test("busy is 409 with {error}", async () => {
    const running: OpUnitState = { activeState: "activating", result: "success", startedAt: "x", finishedAt: null };
    const s = await serveApi(ALL, {}, { [opUnitName(PAL, "update")]: running });
    const r = await s.call("POST", route(PAL, "restart"));
    assert.equal(r.status, 409);
    assert.deepEqual(r.json(), { error: "an action is already running on palworld-palchuds" });
    await s.close();
  });

  test("a sudo failure is 502 with its error text", async () => {
    const { CommandError } = await import("../lib/systemCommands");
    const s = await serveApi(ALL, {
      startHostAction: () => Promise.reject(new CommandError("sudo failed", "", "sudo: a password is required")),
    });
    const r = await s.call("POST", route(PAL, "restart"));
    assert.equal(r.status, 502);
    assert.deepEqual(r.json(), { error: "sudo: a password is required" });
    await s.close();
  });

  test("an unexpected throw is a JSON 500 with no stack", async () => {
    const s = await serveApi(ALL);
    s.deps.logger.logHostAction = () => {
      throw new Error("disk full at /secret/path");
    };
    const r = await s.call("POST", route(PAL, "restart"));
    assert.equal(r.status, 500);
    assert.deepEqual(r.json(), { error: "internal error" });
    await s.close();
  });
});

describe("GET /v1/units/:unit/actions/:action", () => {
  test("the state and the log tail", async () => {
    const done: OpUnitState = { activeState: "inactive", result: "success", startedAt: "a", finishedAt: "b" };
    const s = await serveApi(ALL, {}, { [opUnitName(PAL, "restart")]: done });
    s.deps.fs.writeFile("/var/lib/lychee-op/palworld-palchuds-restart.log", "one\ntwo\n");
    const r = await s.call("GET", route(PAL, "restart"));
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { unit: PAL, action: "restart", state: "succeeded", startedAt: "a", finishedAt: "b", logTail: "one\ntwo\n" });
    await s.close();
  });

  test("a client may read state only for what it is granted: 403", async () => {
    const s = await serveApi({ [PAL]: ["restart"] });
    s.deps.fs.writeFile("/var/lib/lychee-op/palworld-palchuds-update.log", "secret\n");
    const r = await s.call("GET", route(PAL, "update"));
    assert.equal(r.status, 403);
    assert.doesNotMatch(r.text, /secret/);
    await s.close();
  });

  test("an unknown action, or a unit/action the inventory does not list, is 404", async () => {
    const s = await serveApi({ ...ALL, nope: ["start"], [OTHER]: ["start", "stop"] });
    for (const [unit, action] of [[PAL, "rm"], ["nope", "start"], [OTHER, "stop"], ["lychee-docs", "start"]]) {
      const r = await s.call("GET", route(unit, action));
      assert.equal(r.status, 404, `${unit} ${action}`);
      assert.ok(typeof (r.json() as { error: unknown }).error === "string");
    }
    await s.close();
  });

  test("an inventory name that is not a bare unit name is 404, not 500", async () => {
    const { createApiApp } = await import("./router");
    const { deps, starts } = await fixture();
    deps.fs.writeFile(
      INVENTORY_PATH,
      JSON.stringify({ generated: "2026-10-13T00:00:00Z", services: [{ name: "Bad_Name", unit: "x.service", group: "service", reconciled: false, actions: ["start"] }] }),
    );
    const s = await listen(createApiApp(deps, { kind: "client", name: "swee", grants: { Bad_Name: ["start"] } }), deps, starts);
    const r = await s.call("GET", route("Bad_Name", "start"));
    assert.equal(r.status, 404);
    await s.close();
  });

  test("systemd unreadable is 502, not 500", async () => {
    const s = await serveApi(ALL, { readOpUnits: () => Promise.reject(new Error("systemctl: timed out")) });
    const r = await s.call("GET", route(PAL, "restart"));
    assert.equal(r.status, 502);
    assert.match((r.json() as { error: string }).error, /timed out/);
    await s.close();
  });

  test("a read is not audited and starts nothing", async () => {
    const s = await serveApi(ALL);
    await s.call("GET", route(PAL, "restart"));
    assert.equal(s.deps.fs.exists(process.env.LOG_FILE as string), false);
    assert.deepEqual(s.starts, []);
    await s.close();
  });
});

describe("a malformed percent-escape", () => {
  test("answers 400 with no stack, on GET and POST", async () => {
    const s = await serveApi(ALL);
    try {
      for (const method of ["GET", "POST"]) {
        const r = await s.call(method, "/v1/units/%E0%A4%A/actions/start");
        assert.equal(r.status, 400, method);
        assert.deepEqual(r.json(), { error: "bad request" }, method);
      }
      assert.deepEqual(s.starts, []);
    } finally {
      await s.close();
    }
  });
});
