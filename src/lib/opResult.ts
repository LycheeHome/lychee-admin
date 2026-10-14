// A host action's result file (A-OPS-1 Result): what an action service records
// as it exits, so how it ended survives systemd unloading the unit. Pure, so
// the contract's own examples can be run through it with no app config.

import { HOST_ACTIONS, type HostAction, isBareName } from "./platform";

/** A result file is about 200 bytes; anything larger is not one. */
export const OP_RESULT_MAX_BYTES = 4 * 1024;

/** How an action ended, as its service recorded it (A-OPS-1 Result). */
export interface OpResult {
  result: string;
  exitStatus: number | null;
  startedAt: string | null;
  finishedAt: string | null;
}

const OP_RESULT_KEYS = ["unit", "action", "result", "exit_status", "started_at", "finished_at"];
const OP_RESULT_RE = /^[a-z][a-z-]*$/;
const OP_RESULT_TIME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;

/**
 * A result file's text, checked in code against the same constraints as the
 * contract's op-result schema (exactly its six keys, each of its type and
 * pattern), and against the unit and action its path names: a file recorded
 * for another action is not this one's. null for anything else — absent,
 * never an error.
 */
export function parseOpResult(raw: string, unit: string, action: HostAction): OpResult | null {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  const keys = Object.keys(d);
  if (keys.length !== OP_RESULT_KEYS.length || !OP_RESULT_KEYS.every((k) => Object.hasOwn(d, k))) return null;
  if (typeof d.unit !== "string" || !isBareName(d.unit) || d.unit !== unit) return null;
  if (d.action !== action || !(HOST_ACTIONS as readonly unknown[]).includes(d.action)) return null;
  if (typeof d.result !== "string" || !OP_RESULT_RE.test(d.result)) return null;
  if (d.exit_status !== null && !Number.isInteger(d.exit_status)) return null;
  const time = (v: unknown): v is string | null => v === null || (typeof v === "string" && OP_RESULT_TIME_RE.test(v));
  if (!time(d.started_at) || !time(d.finished_at)) return null;
  return { result: d.result, exitStatus: d.exit_status as number | null, startedAt: d.started_at, finishedAt: d.finished_at };
}
