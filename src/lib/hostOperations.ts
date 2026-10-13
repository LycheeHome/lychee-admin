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
import { readInventory } from "./serviceInventory";
import type { OpUnitState } from "./unitState";

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

/** The action service's own output (A-OPS-1). Only call with a name that has
 *  passed opUnitName. */
export function opLogPath(unit: string, action: HostAction): string {
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
  if (caller.kind === "client" && !(caller.grants[unit] ?? []).includes(hostAction)) {
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

  // systemd may not have moved the unit out of its previous state yet, and
  // that state could read as the last run's result; the job is queued, so the
  // honest answer to "what did my request do" is running. Polls read systemd.
  let state: ActionState;
  try {
    state = await readActionState(deps, unit, hostAction);
  } catch {
    state = { unit, action: hostAction, state: "running", logTail: "" };
  }
  return { ok: true, state: { ...state, state: "running" } };
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
 * Throws when `unit` is not a bare unit name (opUnitName), or when systemd
 * cannot be read; a caller maps those to 404 and 502.
 */
export async function readActionState(deps: Deps, unit: string, action: HostAction): Promise<ActionState> {
  const name = opUnitName(unit, action);
  const states = await deps.commands.readOpUnits([name]);
  const s = states[name];
  const result: ActionState = { unit, action, state: mapState(s), logTail: readLogTail(deps, unit, action) };
  if (s?.startedAt) result.startedAt = s.startedAt;
  if (s?.finishedAt && result.state !== "running") result.finishedAt = s.finishedAt;
  return result;
}
