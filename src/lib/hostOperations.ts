// Host operations: start a declared action on a declared unit, and read back
// how it is going. Shared by the board (operator) and the client sockets.
//
// Holds no state. Each action is its own systemd service
// (`lychee-op-<unit>-<action>.service`) and outlives this process — every
// deploy restarts lychee-admin, often mid-update — so systemd is the only
// source of truth for whether an action is running or how it ended.
//
// The inventory's `actions` and the caller's grants are checked here as
// defence in depth and for a clean error; sudo refuses anything lychee-ops
// did not declare regardless.

import type { Deps } from "../deps";
import { CommandError } from "./systemCommands";
import { HOST_ACTIONS, type HostAction, opUnitName } from "./platform";
import { type InventoryEntry, readInventory } from "./serviceInventory";
import { type OpUnitState, parseTimestamp, toIsoTimestamp } from "./unitState";

export type Caller = { kind: "operator" } | { kind: "client"; name: string; grants: Record<string, HostAction[]> };

export interface ActionState {
  unit: string;
  action: HostAction;
  state: "idle" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  logTail: string;
}

export type ActionResult =
  | { ok: true; state: ActionState }
  | { ok: false; status: 403 | 404 | 409 | 502; message: string };

export const LOG_TAIL_LINES = 50;
export const LOG_TAIL_MAX_BYTES = 64 * 1024;

/** The action service's own output (A-OPS-1). Validated by construction:
 *  throws on whatever opUnitName refuses, so no path is ever built from an
 *  unchecked name. */
export function opLogPath(unit: string, action: HostAction): string {
  opUnitName(unit, action);
  return `/var/lib/lychee-op/${unit}-${action}.log`;
}

function callerLabel(caller: Caller): string {
  return caller.kind === "operator" ? "operator" : `client:${caller.name}`;
}

const RUNNING_STATES = new Set(["activating", "active", "deactivating", "reloading"]);

function errorText(error: unknown): string {
  if (error instanceof CommandError) return error.stderr.trim() || error.message;
  return error instanceof Error ? error.message : String(error);
}

export function isHostAction(action: string): action is HostAction {
  return (HOST_ACTIONS as readonly string[]).includes(action);
}

/** Own properties only: a unit named like an Object.prototype member must
 *  never read back an inherited value as a grant, however the grants object
 *  was built. */
function grantedActions(caller: Extract<Caller, { kind: "client" }>, unit: string): readonly string[] {
  return Object.hasOwn(caller.grants, unit) ? caller.grants[unit] : [];
}

export async function requestAction(
  deps: Deps,
  unit: string,
  action: string,
  caller: Caller,
): Promise<ActionResult> {
  const audit = (outcome: string) =>
    deps.logger.logHostAction({ caller: callerLabel(caller), unit, hostAction: action, outcome });
  const refuse = (status: 403 | 404 | 409 | 502, message: string): ActionResult => {
    audit(`refused: ${message}`);
    return { ok: false, status, message };
  };

  // 1. The inventory must list the action for this entry, found by its bare
  //    name — never by its `unit` value. `actions: []` is the same as absent.
  const entry = readInventory(deps.fs).entries.find((e) => e.name === unit);
  if (!entry || entry.kind !== "unit") return refuse(404, `no unit named ${unit}`);
  const listed: readonly string[] = entry.actions ?? [];
  if (!listed.includes(action)) return refuse(404, `${unit} has no action ${action}`);
  const hostAction = action as HostAction;

  // 2. A client must be granted it. A grant the inventory does not back never
  //    gets here: it was a 404 above.
  if (caller.kind === "client" && !grantedActions(caller, unit).includes(hostAction)) {
    return refuse(403, `${callerLabel(caller)} is not granted ${action} on ${unit}`);
  }

  // The names below become part of a root command line; an inventory name
  // that is not a bare unit name is refused here, before any systemd read or
  // sudo call.
  let opUnits: string[];
  try {
    opUnits = HOST_ACTIONS.map((a) => opUnitName(unit, a));
  } catch {
    return refuse(404, `${unit} is not a valid unit name`);
  }

  // 3. Busy: any action on this unit, not just this one — the lock is per
  //    unit. An unreadable state is refused rather than read as idle.
  let states: Record<string, OpUnitState>;
  try {
    states = await deps.commands.readOpUnits(opUnits);
  } catch (error) {
    return refuse(502, `could not read ${unit}'s actions: ${errorText(error)}`);
  }
  if (opUnits.some((name) => RUNNING_STATES.has(states[name]?.activeState ?? ""))) {
    return refuse(409, `an action is already running on ${unit}`);
  }

  // 4–5. Start it. --no-block: this returns once systemd has queued the job.
  try {
    await deps.commands.startHostAction(unit, hostAction);
  } catch (error) {
    return refuse(502, errorText(error));
  }
  audit("started");

  // systemd may not have moved the unit out of its previous state yet, so
  // anything read now — its state, times and log — could be the last run's.
  // The job is queued, so the honest answer to "what did my request do" is
  // running, with nothing carried over. Polls read systemd.
  return { ok: true, state: { unit, action: hostAction, state: "running", logTail: "" } };
}

function mapState(s: OpUnitState | undefined): ActionState["state"] {
  if (!s) return "idle";
  if (RUNNING_STATES.has(s.activeState)) return "running";
  if (s.activeState === "failed") return "failed";
  if (s.result !== "" && s.result !== "success") return "failed";
  if (s.finishedAt !== null) return "succeeded";
  return "idle";
}

function readLogTail(deps: Deps, unit: string, action: HostAction): string {
  let raw: string;
  try {
    raw = deps.fs.readTail(opLogPath(unit, action), LOG_TAIL_MAX_BYTES);
  } catch {
    return "";
  }
  let lines = raw.split("\n");
  // A full window may start mid-line (or mid-character): drop that fragment.
  if (Buffer.byteLength(raw) >= LOG_TAIL_MAX_BYTES && lines.length > 1) lines = lines.slice(1);
  const trailingNewline = lines.at(-1) === "";
  if (trailingNewline) lines.pop();
  const tail = lines.slice(-LOG_TAIL_LINES).join("\n");
  return tail === "" ? "" : trailingNewline ? `${tail}\n` : tail;
}

/**
 * Start and finish times as ISO 8601, never systemd's own format: these leave
 * the server (board JSON, the socket API, the page) and a browser cannot be
 * trusted to parse "Tue 2026-10-13 10:00:00 UTC" (Safari cannot). A running
 * action has no finish yet; an unparseable time is omitted.
 */
function withTimes(state: ActionState, s: OpUnitState | undefined): void {
  const startedAt = toIsoTimestamp(s?.startedAt);
  const finishedAt = state.state === "running" ? undefined : toIsoTimestamp(s?.finishedAt);
  if (startedAt) state.startedAt = startedAt;
  if (finishedAt) state.finishedAt = finishedAt;
}

/**
 * Throws when `unit` is not a bare unit name (opUnitName), or when systemd
 * cannot be read; a caller maps those to 404 and 502.
 */
export async function readActionState(deps: Deps, unit: string, action: HostAction): Promise<ActionState> {
  const name = opUnitName(unit, action);
  const states = await deps.commands.readOpUnits([name]);
  const s = states[name];
  const result: ActionState = { unit, action, state: mapState(s), logTail: readLogTail(deps, unit, action) };
  withTimes(result, s);
  return result;
}

/**
 * The services board's view: for every unit entry that lists actions, its most
 * recent run — a running one wins, otherwise the latest by finish (or start)
 * time; a unit whose actions have never run has no entry. One `systemctl show`
 * for every listed action of every such row, then one log read per row shown.
 * Never throws: a systemd read that fails, or a name opUnitName refuses, is
 * simply no entry, so the board renders without a last-run line rather than
 * erroring.
 */
export async function readLastRuns(deps: Deps, entries: readonly InventoryEntry[]): Promise<Record<string, ActionState>> {
  const rows: { name: string; ops: [HostAction, string][] }[] = [];
  for (const e of entries) {
    if (e.kind !== "unit" || !e.actions || e.actions.length === 0) continue;
    try {
      rows.push({ name: e.name, ops: e.actions.map((a): [HostAction, string] => [a, opUnitName(e.name, a)]) });
    } catch {
      // Not a bare unit name: no state to read, and nothing a request could start.
    }
  }
  if (rows.length === 0) return {};

  let states: Record<string, OpUnitState>;
  try {
    states = await deps.commands.readOpUnits(rows.flatMap((r) => r.ops.map(([, unit]) => unit)));
  } catch {
    return {};
  }

  const when = (s: OpUnitState | undefined) => parseTimestamp(s?.finishedAt) ?? parseTimestamp(s?.startedAt) ?? -Infinity;
  const runs: Record<string, ActionState> = {};
  for (const row of rows) {
    const candidates = row.ops
      .map(([action, unit]) => ({ action, s: states[unit], state: mapState(states[unit]) }))
      .filter((c) => c.state !== "idle");
    if (candidates.length === 0) continue;
    const pick =
      candidates.find((c) => c.state === "running") ??
      candidates.reduce((latest, c) => (when(c.s) > when(latest.s) ? c : latest));
    const run: ActionState = { unit: row.name, action: pick.action, state: pick.state, logTail: readLogTail(deps, row.name, pick.action) };
    withTimes(run, pick.s);
    runs[row.name] = run;
  }
  return runs;
}

export type StateResult =
  | { ok: true; state: ActionState }
  | { ok: false; status: 403 | 404 | 502; message: string };

/**
 * A read with the same checks requestAction makes, in the same order, shared
 * by the board and the client sockets: the raw action is a host action, the
 * inventory lists it for an entry of that bare name, a client is granted it.
 * Then the two ways readActionState throws are told apart without parsing a
 * message: a name opUnitName refuses is 404, systemd not answering is 502.
 * Never throws.
 */
export async function readCheckedActionState(
  deps: Deps,
  unit: string,
  rawAction: string,
  caller: Caller,
): Promise<StateResult> {
  if (!isHostAction(rawAction)) return { ok: false, status: 404, message: `no action ${rawAction}` };
  const action = rawAction;
  const entry = readInventory(deps.fs).entries.find((e) => e.name === unit);
  if (!entry || entry.kind !== "unit") return { ok: false, status: 404, message: `no unit named ${unit}` };
  if (!(entry.actions ?? []).includes(action)) return { ok: false, status: 404, message: `${unit} has no action ${action}` };
  if (caller.kind === "client" && !grantedActions(caller, unit).includes(action)) {
    return { ok: false, status: 403, message: `${callerLabel(caller)} is not granted ${action} on ${unit}` };
  }
  try {
    opUnitName(unit, action);
  } catch {
    return { ok: false, status: 404, message: `${unit} is not a valid unit name` };
  }
  try {
    return { ok: true, state: await readActionState(deps, unit, action) };
  } catch (error) {
    return { ok: false, status: 502, message: `could not read ${unit}'s actions: ${errorText(error)}` };
  }
}
