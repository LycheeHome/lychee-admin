import type { FileSystem } from "./fileSystem";

/**
 * The inventory lyly-admin reads is published by lychee-ops on every reconcile
 * tick (roles/inventory). It is the DECLARED set — what should be running —
 * and carries deploy state where a service has any.
 *
 * It is deliberately a published file rather than something read with
 * privilege: deploy state only changes when the reconciler writes it, so its
 * freshness is bounded by the tick by construction and a privileged reader
 * would buy nothing. Liveness is a separate, live source (see unitState.ts).
 */
export const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";

export type ServiceGroup = "reconciler" | "service" | "infrastructure";

const GROUPS: readonly string[] = ["reconciler", "service", "infrastructure"];

export interface InventoryEntry {
  name: string;
  unit: string;
  group: ServiceGroup;
  /** False for anything nothing deploys — palworld, Caddy, the tunnel. A
   *  state worth showing, not a missing value. */
  reconciled: boolean;
  /** The optional fields below mean "known or not known": the producer writes
   *  "" for a service that has never completed an install, and that is
   *  normalised to undefined here so no page renders an empty version. */
  version?: string;
  commit?: string;
  result?: string;
  gate?: string;
  lastRun?: string;
  failedAttempts?: number;
}

export interface ServiceInventory {
  /** ISO timestamp of the tick that wrote the file, or null when unavailable.
   *  Rendered as an age: a frozen inventory is how a dead reconciler becomes
   *  visible, which it otherwise is not. */
  generated: string | null;
  entries: InventoryEntry[];
  available: boolean;
}

/**
 * A fresh object per call, not a shared constant: callers build page groups
 * from `entries`, and an in-place sort or push on a shared array would corrupt
 * every later unavailable result in the process, surfacing only after the
 * inventory had once been unreadable. Object.freeze was the alternative and
 * was rejected because it fails loudly, and a loud failure here is a thrown
 * TypeError on a page that must never error; a fresh object makes the
 * mutation harmless instead.
 */
function unavailable(): ServiceInventory {
  return { generated: null, entries: [], available: false };
}

/** A string field where "" on the wire means "not known". Deliberately not
 *  used for result: the producer's "unknown" is a real value, not an absence. */
function knownString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function toEntry(raw: Record<string, unknown>): InventoryEntry | null {
  const name = typeof raw.name === "string" ? raw.name : "";
  const unit = typeof raw.unit === "string" ? raw.unit : "";
  const group = typeof raw.group === "string" ? raw.group : "";
  if (!name || !unit || !GROUPS.includes(group)) return null;

  const entry: InventoryEntry = {
    name,
    unit,
    group: group as ServiceGroup,
    reconciled: raw.reconciled === true,
  };
  if (!entry.reconciled) return entry;

  const version = knownString(raw.version);
  const commit = knownString(raw.commit);
  const gate = knownString(raw.gate);
  const lastRun = knownString(raw.last_run);
  if (version !== undefined) entry.version = version;
  if (commit !== undefined) entry.commit = commit;
  if (gate !== undefined) entry.gate = gate;
  if (lastRun !== undefined) entry.lastRun = lastRun;
  if (typeof raw.result === "string") entry.result = raw.result;
  if (typeof raw.failed_attempts === "number") entry.failedAttempts = raw.failed_attempts;
  return entry;
}

export function parseInventory(raw: string): ServiceInventory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return unavailable();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return unavailable();

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.services)) return unavailable();

  const entries = obj.services
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map(toEntry)
    .filter((e): e is InventoryEntry => e !== null);

  return {
    generated: typeof obj.generated === "string" ? obj.generated : null,
    entries,
    available: true,
  };
}

/**
 * Degrades rather than throwing, the same way readTunnelId() degrades to
 * dashboard instructions rather than erroring a site page. A missing inventory
 * means lychee-ops has not shipped the role yet, or the reconciler has never
 * run — neither is a reason for the page to fail.
 */
export function readInventory(fs: FileSystem, path: string = INVENTORY_PATH): ServiceInventory {
  try {
    return parseInventory(fs.readFile(path));
  } catch {
    return unavailable();
  }
}
