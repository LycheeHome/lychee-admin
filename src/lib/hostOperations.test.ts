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
/** What systemd reports for a finished, unreferenced oneshot it has garbage-
 *  collected: `systemctl show` loads it afresh, with no times at all. */
const UNLOADED: OpUnitState = { activeState: "inactive", result: "success", startedAt: null, finishedAt: null };

const resultPath = (unit: string, action: HostAction) => `/var/lib/lychee-op/${unit}-${action}.result.json`;

/** A result file as lychee-ops' recorder writes it (A-OPS-1 Result). */
function resultFile(unit: string, action: HostAction, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    unit,
    action,
    result: "success",
    exit_status: 0,
    started_at: "2026-10-14T15:14:58Z",
    finished_at: "2026-10-14T15:15:03Z",
    ...fields,
  });
}

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

  test("the forced running state carries nothing from the previous run", async () => {
    // --no-block returns before systemd moves the unit, so the read right
    // after the start still sees the last run's failure and its log.
    const { requestAction } = await import("./hostOperations");
    const name = opUnitName(PAL, "update");
    const h = await harness({
      units: { [name]: { activeState: "failed", result: "exit-code", startedAt: "Tue 2026-10-13 09:00:00 UTC", finishedAt: "Tue 2026-10-13 09:00:05 UTC" } },
    });
    h.deps.fs.writeFile("/var/lib/lychee-op/palworld-palchuds-update.log", "old failure\n");
    const r = await requestAction(h.deps, PAL, "update", OPERATOR);
    assert.equal(r.ok, true);
    assert.ok(r.ok);
    assert.deepEqual(r.state, { unit: PAL, action: "update", state: "running", logTail: "" });
  });
});

describe("opLogPath", () => {
  test("builds the A-OPS-1 log path for a bare name", async () => {
    const { opLogPath } = await import("./hostOperations");
    assert.equal(opLogPath(PAL, "update"), "/var/lib/lychee-op/palworld-palchuds-update.log");
  });
  test("refuses what opUnitName refuses", async () => {
    const { opLogPath } = await import("./hostOperations");
    assert.throws(() => opLogPath("../etc/passwd", "start"));
    assert.throws(() => opLogPath("swee\n", "start"));
    assert.throws(() => opLogPath("swee", "rm" as HostAction));
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
    assert.equal(s.startedAt, "2026-10-13T10:00:00.000Z");
    assert.deepEqual(h.shows, [[opUnitName(PAL, "update")]]);

    // And a request made by this process does not override what systemd says.
    const { requestAction } = await import("./hostOperations");
    const done = await harness({ units: { [opUnitName(PAL, "start")]: UNLOADED } });
    done.deps.fs.writeFile(resultPath(PAL, "start"), resultFile(PAL, "start"));
    await requestAction(done.deps, PAL, "start", OPERATOR);
    const after = await (await import("./hostOperations")).readActionState(done.deps, PAL, "start");
    assert.equal(after.state, "succeeded");
  });

  test("maps systemd states when there is no result file", async () => {
    const { readActionState } = await import("./hostOperations");
    // Only `failed` survives without a file: a finished, inactive unit with
    // no result file is idle whatever systemd still says about it (the spec's
    // table, last row) — success is only ever read from the file.
    const cases: [OpUnitState | undefined, string][] = [
      [undefined, "idle"],
      [IDLE, "idle"],
      [RUNNING, "running"],
      [{ ...RUNNING, activeState: "active" }, "running"],
      [{ ...RUNNING, activeState: "deactivating" }, "running"],
      [{ activeState: "inactive", result: "success", startedAt: "a", finishedAt: "b" }, "idle"],
      [{ activeState: "failed", result: "exit-code", startedAt: "a", finishedAt: "b" }, "failed"],
      [{ activeState: "inactive", result: "timeout", startedAt: "a", finishedAt: "b" }, "idle"],
    ];
    for (const [unitState, expected] of cases) {
      const units: Record<string, OpUnitState> = unitState ? { [opUnitName(PAL, "stop")]: unitState } : {};
      const h = await harness({ units });
      const s = await readActionState(h.deps, PAL, "stop");
      assert.equal(s.state, expected, JSON.stringify(unitState));
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
    assert.deepEqual(reads.filter(([p]) => p === path), [[path, 64 * 1024]]);
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
    // The fake models systemd's garbage collection: the finished unit reads as
    // a fresh load, so `succeeded` can only have come from the result file.
    const unit = opUnitName(PAL, "restart");
    assert.deepEqual((await fakes.commands.readOpUnits([unit]))[unit], UNLOADED);
    const file = JSON.parse(fakes.fs.readFile(resultPath(PAL, "restart"))) as Record<string, unknown>;
    assert.deepEqual(Object.keys(file).sort(), ["action", "exit_status", "finished_at", "result", "started_at", "unit"]);
    assert.equal(file.result, "success");
    const s = await readActionState(deps, PAL, "restart");
    assert.equal(s.state, "succeeded");
    assert.equal(s.startedAt, new Date(file.started_at as string).toISOString());
    assert.equal(s.finishedAt, new Date(file.finished_at as string).toISOString());
    assert.notEqual(s.logTail, "");
    // Without the file the same unloaded unit would read idle: that is the bug.
    fakes.fs.rmRecursive(resultPath(PAL, "restart"));
    assert.equal((await readActionState(deps, PAL, "restart")).state, "idle");
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
    // A failed unit stays loaded in systemd, and the recorder wrote failed too.
    const unit = opUnitName(PAL, "update");
    assert.equal((await fakes.commands.readOpUnits([unit]))[unit]?.activeState, "failed");
    assert.equal((JSON.parse(fakes.fs.readFile(resultPath(PAL, "update"))) as { result: string }).result, "exit-code");
  });

  test("a start refused by the per-unit lock records failed for that action", async () => {
    const { requestAction, readActionState } = await import("./hostOperations");
    const { createFakes } = await import("../dev/fakes");
    const { createBackup } = await import("./backup");
    const { createLogger } = await import("./logger");
    const fakes = createFakes({}, { opRun: { delayMs: 60_000 } });
    fakes.fs.writeFile(INVENTORY_PATH, inventoryJson([PAL_ENTRY]));
    const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
    await requestAction(deps, PAL, "update", OPERATOR);
    // Bypass requestAction's busy check, as a second caller racing it would.
    await fakes.commands.startHostAction(PAL, "stop");
    assert.equal((await readActionState(deps, PAL, "stop")).state, "failed");
    assert.equal((JSON.parse(fakes.fs.readFile(resultPath(PAL, "stop"))) as { result: string }).result, "exit-code");
  });
});

describe("requestAction grants are own properties", () => {
  test("a unit named like an Object.prototype member never reads an inherited grant", async () => {
    const { requestAction } = await import("./hostOperations");
    const h = await harness({
      services: [{ name: "constructor", unit: "constructor.service", group: "service", reconciled: false, actions: ["start"] }],
    });
    const r = await requestAction(h.deps, "constructor", "start", { kind: "client", name: "swee", grants: {} });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.status, 403);
    assert.deepEqual(h.starts, []);
  });
});

describe("readLastRuns (the board's one batched read)", () => {
  const done = (startedAt: string, finishedAt: string, failed = false): OpUnitState => ({
    activeState: failed ? "failed" : "inactive",
    result: failed ? "exit-code" : "success",
    startedAt,
    finishedAt,
  });

  test("one systemd read covers every listed action of every action-bearing row", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({ services: [PAL_ENTRY, OTHER_ENTRY, { name: "swee", unit: "swee.service", group: "service", reconciled: true }] });
    await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(h.shows.length, 1);
    assert.deepEqual(
      [...h.shows[0]].sort(),
      [...["start", "stop", "restart", "update"].map((a) => opUnitName(PAL, a as HostAction)), opUnitName(OTHER, "start")].sort(),
    );
  });

  test("no action-bearing rows reads nothing", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({ services: [{ name: "swee", unit: "swee.service", group: "service", reconciled: true }] });
    assert.deepEqual(await readLastRuns(h.deps, readInventory(h.deps.fs).entries), {});
    assert.equal(h.shows.length, 0);
  });

  test("a running action wins over a later-finished one", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({
      units: {
        [opUnitName(PAL, "update")]: RUNNING,
        [opUnitName(PAL, "restart")]: UNLOADED,
      },
    });
    h.deps.fs.writeFile(resultPath(PAL, "restart"), resultFile(PAL, "restart", { started_at: "2026-10-13T11:00:00Z", finished_at: "2026-10-13T11:00:02Z" }));
    const runs = await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(runs[PAL]?.action, "update");
    assert.equal(runs[PAL]?.state, "running");
  });

  test("otherwise the latest finished run, with its log", async () => {
    const { readLastRuns, opLogPath } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({
      units: {
        [opUnitName(PAL, "update")]: UNLOADED,
        [opUnitName(PAL, "restart")]: done("Tue 2026-10-13 10:00:00 UTC", "Tue 2026-10-13 10:00:02 UTC", true),
        [opUnitName(PAL, "stop")]: IDLE,
      },
    });
    h.deps.fs.writeFile(resultPath(PAL, "update"), resultFile(PAL, "update", { started_at: "2026-10-13T09:00:00Z", finished_at: "2026-10-13T09:03:41Z" }));
    h.deps.fs.writeFile(opLogPath(PAL, "restart"), "Job failed\n");
    const runs = await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(runs[PAL]?.action, "restart");
    assert.equal(runs[PAL]?.state, "failed");
    assert.equal(runs[PAL]?.logTail, "Job failed\n");
    assert.equal(runs[PAL]?.finishedAt, "2026-10-13T10:00:02.000Z");
  });

  test("the most recent run is picked by the result file's times, for an unloaded unit too", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({
      units: {
        // Loaded and failed, an hour before the succeeded one.
        [opUnitName(PAL, "restart")]: done("Tue 2026-10-13 10:00:00 UTC", "Tue 2026-10-13 10:00:02 UTC", true),
        // Garbage-collected: systemd knows nothing of it but a fresh load.
        [opUnitName(PAL, "update")]: UNLOADED,
      },
    });
    h.deps.fs.writeFile(resultPath(PAL, "restart"), resultFile(PAL, "restart", { result: "exit-code", exit_status: 1, started_at: "2026-10-13T10:00:00Z", finished_at: "2026-10-13T10:00:02Z" }));
    h.deps.fs.writeFile(resultPath(PAL, "update"), resultFile(PAL, "update", { started_at: "2026-10-13T11:00:00Z", finished_at: "2026-10-13T11:04:10Z" }));
    const runs = await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(runs[PAL]?.action, "update");
    assert.equal(runs[PAL]?.state, "succeeded");
    assert.equal(runs[PAL]?.startedAt, "2026-10-13T11:00:00.000Z");
    assert.equal(runs[PAL]?.finishedAt, "2026-10-13T11:04:10.000Z");
  });

  test("a unit systemd has unloaded entirely still has its last run from the file", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    // readOpUnits omits it altogether: no state at all, only the file.
    const h = await harness({ units: {} });
    h.deps.fs.writeFile(resultPath(PAL, "stop"), resultFile(PAL, "stop"));
    const runs = await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(runs[PAL]?.action, "stop");
    assert.equal(runs[PAL]?.state, "succeeded");
    assert.equal(runs[PAL]?.finishedAt, "2026-10-14T15:15:03.000Z");
  });

  test("a stale file never outranks a running action, and its times are not used", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({ units: { [opUnitName(PAL, "update")]: RUNNING } });
    h.deps.fs.writeFile(resultPath(PAL, "update"), resultFile(PAL, "update", { started_at: "2026-10-14T00:00:00Z", finished_at: "2026-10-14T00:01:00Z" }));
    const runs = await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(runs[PAL]?.state, "running");
    assert.equal(runs[PAL]?.startedAt, "2026-10-13T10:00:00.000Z");
    assert.ok(!("finishedAt" in (runs[PAL] ?? {})));
  });

  test("never run means no entry", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({ units: { [opUnitName(PAL, "stop")]: IDLE } });
    assert.deepEqual(await readLastRuns(h.deps, readInventory(h.deps.fs).entries), {});
  });

  test("a failed systemd read degrades to no runs, never a throw", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({ overrides: { readOpUnits: () => Promise.reject(new Error("systemctl broke")) } });
    assert.deepEqual(await readLastRuns(h.deps, readInventory(h.deps.fs).entries), {});
  });
});

describe("timestamps leave the server as ISO 8601", () => {
  test("readActionState converts systemd's format; an unparseable one is omitted", async () => {
    const { readActionState } = await import("./hostOperations");
    const h = await harness({
      units: { [opUnitName(PAL, "restart")]: { activeState: "failed", result: "exit-code", startedAt: "Tue 2026-10-13 10:00:00 UTC", finishedAt: "Tue 2026-10-13 10:00:02 UTC" } },
    });
    const s = await readActionState(h.deps, PAL, "restart");
    assert.equal(s.startedAt, "2026-10-13T10:00:00.000Z");
    assert.equal(s.finishedAt, "2026-10-13T10:00:02.000Z");
    const junk = await harness({
      units: { [opUnitName(PAL, "restart")]: { activeState: "failed", result: "exit-code", startedAt: "a", finishedAt: "b" } },
    });
    const j = await readActionState(junk.deps, PAL, "restart");
    assert.equal(j.state, "failed");
    assert.ok(!("startedAt" in j) && !("finishedAt" in j));
  });

  test("readLastRuns converts too", async () => {
    const { readLastRuns } = await import("./hostOperations");
    const { readInventory } = await import("./serviceInventory");
    const h = await harness({ units: { [opUnitName(PAL, "update")]: RUNNING } });
    const runs = await readLastRuns(h.deps, readInventory(h.deps.fs).entries);
    assert.equal(runs[PAL]?.startedAt, "2026-10-13T10:00:00.000Z");
  });
});

describe("state from systemd and the result file (the spec's table)", () => {
  const STOP = opUnitName(PAL, "stop");
  const FAILED: OpUnitState = { activeState: "failed", result: "exit-code", startedAt: "Tue 2026-10-13 10:00:00 UTC", finishedAt: "Tue 2026-10-13 10:00:02 UTC" };

  async function read(unit: OpUnitState | undefined, file?: string) {
    const { readActionState } = await import("./hostOperations");
    const h = await harness({ units: unit ? { [STOP]: unit } : {} });
    if (file !== undefined) h.deps.fs.writeFile(resultPath(PAL, "stop"), file);
    return readActionState(h.deps, PAL, "stop");
  }

  test("activating, active, deactivating: running, and the file is not read (Review Focus 4)", async () => {
    const { readActionState } = await import("./hostOperations");
    for (const activeState of ["activating", "active", "deactivating"]) {
      const h = await harness({ units: { [STOP]: { ...RUNNING, activeState } } });
      // A stale result from the previous run, finished after this one started.
      h.deps.fs.writeFile(resultPath(PAL, "stop"), resultFile(PAL, "stop", { result: "exit-code", exit_status: 1, started_at: "2026-10-14T00:00:00Z", finished_at: "2026-10-14T00:01:00Z" }));
      const reads: string[] = [];
      const readTail = h.deps.fs.readTail.bind(h.deps.fs);
      h.deps.fs.readTail = (p, max) => {
        reads.push(p);
        return readTail(p, max);
      };
      const s = await readActionState(h.deps, PAL, "stop");
      assert.equal(s.state, "running", activeState);
      assert.equal(s.startedAt, "2026-10-13T10:00:00.000Z", activeState);
      assert.ok(!("finishedAt" in s), activeState);
      assert.ok(!reads.includes(resultPath(PAL, "stop")), `${activeState}: the result file was read`);
    }
  });

  test("otherwise, a file with result success: succeeded, with the file's times", async () => {
    for (const unit of [UNLOADED, undefined, { activeState: "inactive", result: "success", startedAt: "Tue 2026-10-13 08:00:00 UTC", finishedAt: "Tue 2026-10-13 08:00:01 UTC" }]) {
      const s = await read(unit, resultFile(PAL, "stop"));
      assert.equal(s.state, "succeeded", JSON.stringify(unit));
      assert.equal(s.startedAt, "2026-10-14T15:14:58.000Z");
      assert.equal(s.finishedAt, "2026-10-14T15:15:03.000Z");
    }
  });

  test("otherwise, a file with any other result: failed, with the file's times", async () => {
    for (const [unit, result] of [
      [UNLOADED, "exit-code"],
      [{ ...UNLOADED, result: "timeout" }, "timeout"],
      [undefined, "signal"],
      [UNLOADED, "oom-kill"],
    ] as const) {
      const s = await read(unit, resultFile(PAL, "stop", { result, exit_status: result === "exit-code" ? 1 : null }));
      assert.equal(s.state, "failed", `${unit?.activeState} ${result}`);
      // The file's times, not systemd's 10:00.
      assert.equal(s.startedAt, "2026-10-14T15:14:58.000Z");
      assert.equal(s.finishedAt, "2026-10-14T15:15:03.000Z");
    }
  });

  test("a file with null times gives a state with no times", async () => {
    const s = await read(UNLOADED, resultFile(PAL, "stop", { result: "timeout", exit_status: null, started_at: null, finished_at: null }));
    assert.equal(s.state, "failed");
    assert.ok(!("startedAt" in s) && !("finishedAt" in s));
  });

  test("ActiveState failed outranks any file: failed, with systemd's times", async () => {
    // A unit systemd still holds as failed is newer than any file: a recorder
    // that refused or never ran leaves the previous run's success on disk.
    for (const file of [
      resultFile(PAL, "stop"),
      resultFile(PAL, "stop", { result: "exit-code", exit_status: 1 }),
    ]) {
      const s = await read(FAILED, file);
      assert.equal(s.state, "failed", file);
      assert.equal(s.startedAt, "2026-10-13T10:00:00.000Z");
      assert.equal(s.finishedAt, "2026-10-13T10:00:02.000Z");
    }
    const bare = await read({ activeState: "failed", result: "start-limit-hit", startedAt: null, finishedAt: null }, resultFile(PAL, "stop"));
    assert.equal(bare.state, "failed");
    assert.ok(!("startedAt" in bare) && !("finishedAt" in bare));
  });

  test("ActiveState failed and no file: failed, with systemd's times", async () => {
    const s = await read(FAILED);
    assert.equal(s.state, "failed");
    assert.equal(s.startedAt, "2026-10-13T10:00:00.000Z");
    assert.equal(s.finishedAt, "2026-10-13T10:00:02.000Z");
  });

  test("otherwise and no file: idle", async () => {
    for (const unit of [UNLOADED, undefined, IDLE]) {
      const s = await read(unit);
      assert.equal(s.state, "idle", JSON.stringify(unit));
      assert.ok(!("startedAt" in s) && !("finishedAt" in s));
    }
  });

  // Review Focus 5: each of these is absent, so an unloaded unit reads idle and
  // a failed one reads failed with systemd's times — never succeeded, never a throw.
  const valid = JSON.parse(resultFile(PAL, "stop")) as Record<string, unknown>;
  const without = (key: string) => JSON.stringify(Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key)));
  const garbage: [string, string][] = [
    ["empty", ""],
    ["not JSON", "{\"unit\": "],
    ["JSON null", "null"],
    ["an array", JSON.stringify([valid])],
    ["a string", JSON.stringify("success")],
    ["another unit", resultFile("other-game", "stop")],
    ["another action", resultFile(PAL, "start")],
    ["unit not a string", resultFile(PAL, "stop", { unit: 7 })],
    ["unknown key", resultFile(PAL, "stop", { extra: true })],
    ["missing result", without("result")],
    ["missing exit_status", without("exit_status")],
    ["missing finished_at", without("finished_at")],
    ["result empty", resultFile(PAL, "stop", { result: "" })],
    ["result uppercase", resultFile(PAL, "stop", { result: "SUCCESS" })],
    ["result not a string", resultFile(PAL, "stop", { result: true })],
    ["exit_status a string", resultFile(PAL, "stop", { exit_status: "0" })],
    ["exit_status fractional", resultFile(PAL, "stop", { exit_status: 0.5 })],
    ["a time without Z", resultFile(PAL, "stop", { started_at: "2026-10-14T15:14:58" })],
    ["a time in systemd's format", resultFile(PAL, "stop", { finished_at: "Tue 2026-10-14 15:15:03 UTC" })],
    ["a time as a number", resultFile(PAL, "stop", { finished_at: 1760454903 })],
    ["over the 4 KB cap", resultFile(PAL, "stop") + " ".repeat(5000)],
  ];
  for (const [label, file] of garbage) {
    test(`a result file that is ${label} is absent`, async () => {
      assert.equal((await read(UNLOADED, file)).state, "idle");
      const f = await read(FAILED, file);
      assert.equal(f.state, "failed");
      assert.equal(f.finishedAt, "2026-10-13T10:00:02.000Z");
    });
  }

  test("an unreadable result file is absent, never an error", async () => {
    const { readActionState } = await import("./hostOperations");
    const h = await harness({ units: { [STOP]: UNLOADED } });
    const readTail = h.deps.fs.readTail.bind(h.deps.fs);
    h.deps.fs.readTail = (p, max) => {
      if (p.endsWith(".result.json")) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return readTail(p, max);
    };
    assert.equal((await readActionState(h.deps, PAL, "stop")).state, "idle");
  });

  test("the result file is read with a bounded read", async () => {
    const { readActionState } = await import("./hostOperations");
    const h = await harness({ units: { [STOP]: UNLOADED } });
    h.deps.fs.writeFile(resultPath(PAL, "stop"), resultFile(PAL, "stop"));
    const reads: [string, number][] = [];
    const readTail = h.deps.fs.readTail.bind(h.deps.fs);
    h.deps.fs.readTail = (p, max) => {
      reads.push([p, max]);
      return readTail(p, max);
    };
    h.deps.fs.readFile = () => {
      throw new Error("unbounded read");
    };
    assert.equal((await readActionState(h.deps, PAL, "stop")).state, "succeeded");
    const read = reads.find(([p]) => p === resultPath(PAL, "stop"));
    assert.ok(read, "the result file was not read through readTail");
    assert.ok(read[1] <= 4097, `cap ${read[1]}`);
  });
});
