import assert from "node:assert/strict";
import { describe, test } from "node:test";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { SystemCommands } from "./systemCommands";
import type { OpUnitState } from "./unitState";
import { type HostAction, opUnitName } from "./platform";

process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("x", 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";
const PAL = "palworld-palchuds";
const OTHER = "other-game";

function inventoryJson(services: unknown[]): string {
  return JSON.stringify({ generated: "2026-10-13T00:00:00Z", services });
}

const PAL_ENTRY = {
  name: PAL,
  unit: "palworld-palchuds.service",
  group: "service",
  reconciled: false,
  actions: ["start", "stop", "restart", "update"],
};
const OTHER_ENTRY = { name: OTHER, unit: "other-game.service", group: "service", reconciled: false, actions: ["start"] };

const IDLE: OpUnitState = { activeState: "inactive", result: "success", startedAt: null, finishedAt: null };
const RUNNING: OpUnitState = { activeState: "activating", result: "success", startedAt: "Tue 2026-10-13 10:00:00 UTC", finishedAt: null };

interface Harness {
  deps: Deps;
  starts: [string, string][];
  shows: string[][];
  audit: () => Record<string, unknown>[];
}

async function harness(
  opts: {
    services?: unknown[] | null;
    units?: Record<string, OpUnitState>;
    overrides?: Partial<SystemCommands>;
  } = {},
): Promise<Harness> {
  const { createBackup } = await import("./backup");
  const { createLogger } = await import("./logger");
  const { createFakes } = await import("../dev/fakes");
  const starts: [string, string][] = [];
  const shows: string[][] = [];
  const units = opts.units ?? {};
  const fakes = createFakes({
    startHostAction: (unit, action) => {
      starts.push([unit, action]);
      return Promise.resolve();
    },
    readOpUnits: (names) => {
      shows.push(names);
      return Promise.resolve(Object.fromEntries(names.filter((n) => n in units).map((n) => [n, units[n]])));
    },
    ...opts.overrides,
  });
  const services = opts.services === undefined ? [PAL_ENTRY, OTHER_ENTRY] : opts.services;
  if (services !== null) fakes.fs.writeFile(INVENTORY_PATH, inventoryJson(services));
  const deps: Deps = {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  };
  return {
    deps,
    starts,
    shows,
    audit: () => {
      const file = process.env.LOG_FILE as string;
      if (!fakes.fs.exists(file)) return [];
      return fakes.fs
        .readFile(file)
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    },
  };
}

const OPERATOR = { kind: "operator" } as const;
const swee = (grants: Record<string, HostAction[]>) => ({ kind: "client", name: "swee", grants }) as const;

describe("opUnitName refuses what is not a bare name or a host action", () => {
  test("an unknown action throws", () => {
    assert.throws(() => opUnitName("swee", "rm" as HostAction));
  });
  test("a trailing newline in the unit throws", () => {
    assert.throws(() => opUnitName("swee\n", "start"));
  });
});

describe("requestAction", () => {
  test("404 for a unit the inventory does not list", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r = await requestAction(h.deps, "nope", "start", OPERATOR);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 404);
    assert.deepEqual(h.starts, []);
  });

  test("404 for an action the inventory does not list for that unit", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r = await requestAction(h.deps, OTHER, "stop", OPERATOR);
    assert.equal(!r.ok && r.status, 404);
    assert.deepEqual(h.starts, []);
  });

  test("404 for a container entry, and for actions: [] (same as absent)", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness({
      services: [
        { name: "box", kind: "container", container: "box", group: "service", reconciled: true },
        { name: "empty", unit: "empty.service", group: "service", reconciled: false, actions: [] },
      ],
    });
    assert.equal((await requestAction(h.deps, "box", "start", OPERATOR)).ok, false);
    const r = await requestAction(h.deps, "empty", "start", OPERATOR);
    assert.equal(!r.ok && r.status, 404);
    assert.deepEqual(h.starts, []);
  });

  test("404 when the inventory is unavailable", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness({ services: null });
    const r = await requestAction(h.deps, PAL, "start", OPERATOR);
    assert.equal(!r.ok && r.status, 404);
  });

  test("identity is the entry's name, never its unit value", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r = await requestAction(h.deps, "palworld-palchuds.service", "start", OPERATOR);
    assert.equal(!r.ok && r.status, 404);
    await requestAction(h.deps, PAL, "start", OPERATOR);
    assert.deepEqual(h.starts, [[PAL, "start"]]);
  });

  test("a grant without an inventory action is 404", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r = await requestAction(h.deps, OTHER, "update", swee({ [OTHER]: ["start", "update"] }));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 404);
    assert.deepEqual(h.starts, []);
  });

  test("403 for a client not granted the action", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r1 = await requestAction(h.deps, PAL, "update", swee({ [PAL]: ["start", "restart"] }));
    assert.equal(!r1.ok && r1.status, 403);
    const r2 = await requestAction(h.deps, PAL, "start", swee({ [OTHER]: ["start"] }));
    assert.equal(!r2.ok && r2.status, 403);
    assert.deepEqual(h.starts, []);
  });

  test("a granted client is started", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r = await requestAction(h.deps, PAL, "restart", swee({ [PAL]: ["restart"] }));
    assert.equal(r.ok, true);
    assert.deepEqual(h.starts, [[PAL, "restart"]]);
  });

  test("the operator is never 403", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    for (const a of ["start", "stop", "restart", "update"]) {
      const r = await requestAction(h.deps, PAL, a, OPERATOR);
      assert.equal(r.ok, true, a);
    }
  });

  test("busy is per unit", async () => {
    const { requestAction } = await import("./hostOperations");
    // Another action on the same unit is running: 409, nothing started.
    const busy = await harness({ units: { [opUnitName(PAL, "update")]: RUNNING } });
    const r = await requestAction(busy.deps, PAL, "start", OPERATOR);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.status, 409);
    assert.equal(!r.ok && r.message, `an action is already running on ${PAL}`);
    assert.deepEqual(busy.starts, []);
    // Every one of the unit's four op services is consulted.
    assert.deepEqual(
      [...busy.shows[0]].sort(),
      ["restart", "start", "stop", "update"].map((a) => opUnitName(PAL, a as HostAction)).sort(),
    );

    for (const activeState of ["active", "deactivating"]) {
      const h = await harness({ units: { [opUnitName(PAL, "stop")]: { ...RUNNING, activeState } } });
      const r2 = await requestAction(h.deps, PAL, "start", OPERATOR);
      assert.equal(!r2.ok && r2.status, 409, activeState);
    }

    // Another unit's running action does not block this one.
    const other = await harness({ units: { [opUnitName(OTHER, "start")]: RUNNING } });
    const r3 = await requestAction(other.deps, PAL, "start", OPERATOR);
    assert.equal(r3.ok, true);
    assert.deepEqual(other.starts, [[PAL, "start"]]);
  });

  test("a finished or failed earlier run is not busy", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness({
      units: {
        [opUnitName(PAL, "update")]: { activeState: "failed", result: "exit-code", startedAt: "a", finishedAt: "b" },
        [opUnitName(PAL, "start")]: { activeState: "inactive", result: "success", startedAt: "a", finishedAt: "b" },
      },
    });
    assert.equal((await requestAction(h.deps, PAL, "start", OPERATOR)).ok, true);
  });

  test("an inventory name failing the unit pattern is 404, never a sudo call", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness({
      services: [{ name: "Bad_Name", unit: "bad.service", group: "service", reconciled: false, actions: ["start"] }],
    });
    const r = await requestAction(h.deps, "Bad_Name", "start", OPERATOR);
    assert.equal(!r.ok && r.status, 404);
    assert.deepEqual(h.starts, []);
  });

  test("a sudo failure is 502 carrying the error text", async () => {
    const { requestAction } = await import("./hostOperations");
    const { CommandError } = await import("./systemCommands");
    const h = await harness({
      overrides: {
        startHostAction: () =>
          Promise.reject(new CommandError("Command failed", "", "sudo: a password is required\n")),
      },
    });
    const r = await requestAction(h.deps, PAL, "start", OPERATOR);
    assert.equal(!r.ok && r.status, 502);
    assert.match(!r.ok ? r.message : "", /sudo: a password is required/);
  });

  test("an unreadable op-unit state is refused (fail closed), never a blind start", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness({ overrides: { readOpUnits: () => Promise.reject(new Error("systemctl timed out")) } });
    const r = await requestAction(h.deps, PAL, "start", OPERATOR);
    assert.equal(!r.ok && r.status, 502);
    assert.deepEqual(h.starts, []);
  });

  test("started and every refused reason are audited with the caller label", async () => {
    const { requestAction } = await import("./hostOperations");
    const { CommandError } = await import("./systemCommands");
    const h = await harness({ units: { [opUnitName(OTHER, "start")]: RUNNING } });
    await requestAction(h.deps, PAL, "start", OPERATOR);
    await requestAction(h.deps, PAL, "update", swee({ [PAL]: ["start"] }));
    await requestAction(h.deps, "nope", "start", swee({}));
    await requestAction(h.deps, OTHER, "start", OPERATOR);
    const failing = await harness({
      overrides: { startHostAction: () => Promise.reject(new CommandError("boom", "", "denied")) },
    });
    await requestAction(failing.deps, PAL, "stop", swee({ [PAL]: ["stop"] }));

    const lines = [...h.audit(), ...failing.audit()];
    assert.equal(lines.length, 5);
    for (const l of lines) {
      assert.equal(l.action, "host-action");
      assert.equal(typeof l.timestamp, "string");
    }
    assert.deepEqual(
      lines.map((l) => [l.caller, l.unit, l.hostAction, (l.outcome as string).replace(/^(refused):.*/, "$1")]),
      [
        ["operator", PAL, "start", "started"],
        ["client:swee", PAL, "update", "refused"],
        ["client:swee", "nope", "start", "refused"],
        ["operator", OTHER, "start", "refused"],
        ["client:swee", PAL, "stop", "refused"],
      ],
    );
    assert.match(lines[3].outcome as string, /^refused: an action is already running on other-game$/);
    assert.match(lines[4].outcome as string, /^refused: .*denied/);
  });

  test("the result of a start is a running state", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness();
    const r = await requestAction(h.deps, PAL, "update", OPERATOR);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.state.state, "running");
    assert.equal(r.ok && r.state.unit, PAL);
    assert.equal(r.ok && r.state.action, "update");
  });
});

describe("readActionState", () => {
  test("state is read from systemd, not from memory", async () => {
    // A process that never requested anything (lychee-admin just restarted
    // mid-update) still reads the running action from systemd.
    const { readActionState } = await import("./hostOperations");
    const h = await harness({ units: { [opUnitName(PAL, "update")]: RUNNING } });
    const s = await readActionState(h.deps, PAL, "update");
    assert.equal(s.state, "running");
    assert.equal(s.startedAt, RUNNING.startedAt);
    assert.deepEqual(h.shows, [[opUnitName(PAL, "update")]]);

    // And a request made by this process does not override what systemd says.
    const { requestAction } = await import("./hostOperations");
    const done = await harness({
      units: { [opUnitName(PAL, "start")]: { activeState: "inactive", result: "success", startedAt: "a", finishedAt: "b" } },
    });
    await requestAction(done.deps, PAL, "start", OPERATOR);
    const after = await (await import("./hostOperations")).readActionState(done.deps, PAL, "start");
    assert.equal(after.state, "succeeded");
  });

  test("maps systemd states", async () => {
    const { readActionState } = await import("./hostOperations");
    const cases: [OpUnitState | undefined, string][] = [
      [undefined, "idle"],
      [IDLE, "idle"],
      [RUNNING, "running"],
      [{ ...RUNNING, activeState: "active" }, "running"],
      [{ ...RUNNING, activeState: "deactivating" }, "running"],
      [{ activeState: "inactive", result: "success", startedAt: "a", finishedAt: "b" }, "succeeded"],
      [{ activeState: "failed", result: "exit-code", startedAt: "a", finishedAt: "b" }, "failed"],
      [{ activeState: "inactive", result: "timeout", startedAt: "a", finishedAt: "b" }, "failed"],
    ];
    for (const [unitState, expected] of cases) {
      const units: Record<string, OpUnitState> = unitState ? { [opUnitName(PAL, "stop")]: unitState } : {};
      const h = await harness({ units });
      const s = await readActionState(h.deps, PAL, "stop");
      assert.equal(s.state, expected, JSON.stringify(unitState));
      if (expected === "succeeded" || expected === "failed") {
        assert.equal(s.startedAt, "a");
        assert.equal(s.finishedAt, "b");
      }
    }
  });

  test("log tail: last 50 lines, missing file is empty", async () => {
    const { readActionState } = await import("./hostOperations");
    const h = await harness();
    assert.equal((await readActionState(h.deps, PAL, "update")).logTail, "");
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i}`);
    h.deps.fs.writeFile(`/var/lib/lychee-op/${PAL}-update.log`, lines.join("\n") + "\n");
    const tail = (await readActionState(h.deps, PAL, "update")).logTail;
    assert.deepEqual(tail.split("\n").filter(Boolean), lines.slice(70));
  });

  test("log tail is capped at 64 KB and reads only the file's tail", async () => {
    const { readActionState } = await import("./hostOperations");
    const h = await harness();
    const path = `/var/lib/lychee-op/${PAL}-update.log`;
    // 10 lines of 10 KB each: 50 lines would be 100 KB, so the cap decides.
    const long = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(10_000));
    h.deps.fs.writeFile(path, long.join("\n") + "\n");
    const reads: [string, number][] = [];
    const readTail = h.deps.fs.readTail.bind(h.deps.fs);
    h.deps.fs.readTail = (p, max) => {
      reads.push([p, max]);
      return readTail(p, max);
    };
    const tail = (await readActionState(h.deps, PAL, "update")).logTail;
    assert.ok(Buffer.byteLength(tail) <= 64 * 1024);
    assert.deepEqual(reads, [[path, 64 * 1024]]);
    // A partial first line from the byte cut is dropped, so every line is whole.
    for (const l of tail.split("\n").filter(Boolean)) assert.equal(l.length, 10_000);
    assert.equal(tail.split("\n").filter(Boolean).at(-1), long[9]);
  });

  test("an unreadable log is empty, not an error", async () => {
    const { readActionState } = await import("./hostOperations");
    const h = await harness();
    h.deps.fs.readTail = () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    };
    assert.equal((await readActionState(h.deps, PAL, "start")).logTail, "");
  });
});

describe("dev fakes run an action through a full cycle", () => {
  test("running, then succeeded, with a log", async () => {
    const { requestAction, readActionState } = await import("./hostOperations");
    const { createFakes } = await import("../dev/fakes");
    const { createBackup } = await import("./backup");
    const { createLogger } = await import("./logger");
    const fakes = createFakes({}, { opRun: { delayMs: 20 } });
    fakes.fs.writeFile(INVENTORY_PATH, inventoryJson([PAL_ENTRY]));
    const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
    assert.equal((await readActionState(deps, PAL, "restart")).state, "idle");
    assert.equal((await requestAction(deps, PAL, "restart", OPERATOR)).ok, true);
    assert.equal((await readActionState(deps, PAL, "restart")).state, "running");
    const busy = await requestAction(deps, PAL, "stop", OPERATOR);
    assert.equal(!busy.ok && busy.status, 409);
    await new Promise((r) => setTimeout(r, 60));
    const s = await readActionState(deps, PAL, "restart");
    assert.equal(s.state, "succeeded");
    assert.notEqual(s.logTail, "");
  });

  test("a configured failure ends failed", async () => {
    const { requestAction, readActionState } = await import("./hostOperations");
    const { createFakes } = await import("../dev/fakes");
    const { createBackup } = await import("./backup");
    const { createLogger } = await import("./logger");
    const fakes = createFakes({}, { opRun: { delayMs: 10, fail: (_u, a) => a === "update" } });
    fakes.fs.writeFile(INVENTORY_PATH, inventoryJson([PAL_ENTRY]));
    const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
    await requestAction(deps, PAL, "update", OPERATOR);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await readActionState(deps, PAL, "update")).state, "failed");
  });
});
