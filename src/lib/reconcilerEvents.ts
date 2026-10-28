import type { FileSystem } from "./fileSystem";
import { EVENTS_PATH } from "./platform";

/**
 * The reconciler's history feed (lychee-contract A-HIST-1), published beside
 * the inventory: one lifetime per time a resource was declared, each with the
 * events the reconciler observed. Read defensively, like the inventory: a
 * missing or unreadable file is no history (null), a lifetime or event that
 * does not fit is dropped on its own, and a field this app does not use is
 * never carried. `gate` is dropped because nothing may branch on it (readers
 * use `gate_code`), and `last` is never read.
 */
export type ReconcilerEvent =
  | { at: string; type: "added" }
  | { at: string; type: "deployed"; from: string | null; to: string }
  | { at: string; type: "stopped" }
  | { at: string; type: "down"; from: string }
  | { at: string; type: "failed"; failed_step: string }
  | { at: string; type: "blocked"; gate_code: string }
  | { at: string; type: "awaiting-image" }
  | { at: string; type: "recovered"; from: string; from_gate_code: string | null; attempts: number }
  | { at: string; type: "removed" };

export interface Lifetime {
  id: string;
  name: string;
  kind: string;
  added_at: string;
  removed_at: string | null;
  /** False for a closed lifetime, and for the earlier of two open ones for one name (A-HIST-1). */
  open: boolean;
  /** File order, oldest first. */
  events: ReconcilerEvent[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

function parseEvent(raw: unknown): ReconcilerEvent | null {
  if (!isObj(raw) || !isStr(raw.at)) return null;
  const at = raw.at;
  switch (raw.type) {
    case "added":
    case "stopped":
    case "awaiting-image":
    case "removed":
      return { at, type: raw.type };
    case "deployed":
      return isStrOrNull(raw.from) && isStr(raw.to) ? { at, type: "deployed", from: raw.from, to: raw.to } : null;
    case "down":
      return isStr(raw.from) ? { at, type: "down", from: raw.from } : null;
    case "failed":
      return isStr(raw.failed_step) ? { at, type: "failed", failed_step: raw.failed_step } : null;
    case "blocked":
      return isStr(raw.gate_code) ? { at, type: "blocked", gate_code: raw.gate_code } : null;
    case "recovered":
      return isStr(raw.from) && isStrOrNull(raw.from_gate_code) && typeof raw.attempts === "number" && Number.isFinite(raw.attempts)
        ? { at, type: "recovered", from: raw.from, from_gate_code: raw.from_gate_code, attempts: raw.attempts }
        : null;
    default:
      return null;
  }
}

function parseLifetime(raw: unknown): Lifetime | null {
  if (!isObj(raw)) return null;
  const { id, name, kind, added_at, removed_at, events } = raw;
  if (!isStr(id) || !isStr(name) || !isStr(kind) || !isStr(added_at) || !Array.isArray(events)) return null;
  const closed = isStr(removed_at);
  return {
    id,
    name,
    kind,
    added_at,
    removed_at: closed ? removed_at : null,
    open: !closed,
    events: events.flatMap((e) => parseEvent(e) ?? []),
  };
}

/** Milliseconds for ordering; an unparseable added_at sorts earliest (-Infinity). */
function addedKey(l: Lifetime): number {
  const ms = Date.parse(l.added_at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function parseReconcilerEvents(raw: string): Lifetime[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || !Array.isArray(data.lifetimes)) return null;
  const lifetimes = data.lifetimes.flatMap((l) => parseLifetime(l) ?? []);
  // Only the latest open lifetime of a name is open (A-HIST-1).
  const latest = new Map<string, Lifetime>();
  for (const l of lifetimes) {
    if (!l.open) continue;
    const held = latest.get(l.name);
    if (!held || addedKey(l) >= addedKey(held)) latest.set(l.name, l);
  }
  for (const l of lifetimes) if (l.open && latest.get(l.name) !== l) l.open = false;
  return lifetimes;
}

export function readReconcilerEvents(fs: FileSystem, path: string = EVENTS_PATH): Lifetime[] | null {
  try {
    if (!fs.exists(path)) return null;
    return parseReconcilerEvents(fs.readFile(path));
  } catch {
    return null;
  }
}
