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

interface InventoryEntryBase {
  name: string;
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
  /** What the declaration pins, as opposed to `version`, which is what is
   *  installed; the two differ while a deploy is pending or has failed. */
  target?: string;
  /** The newest tag the registry offers. Absent means no upgrade is on offer,
   *  not that anything is wrong. */
  available?: string;
}

/** A systemd unit, read with `systemctl show`. */
export interface UnitEntry extends InventoryEntryBase {
  kind: "unit";
  unit: string;
}

/** A compose project, read through the sudo-pinned service-status wrapper.
 *  `container` is the compose project name, which is also the wrapper's
 *  argument and the key of the board's container-state map. */
export interface ContainerEntry extends InventoryEntryBase {
  kind: "container";
  container: string;
}

/**
 * A union rather than optional `unit`/`container` fields, so the compiler names
 * every site that reads `.unit` without narrowing. Optional fields would have
 * let each of those sites compile and render `undefined` for a container.
 */
export type InventoryEntry = UnitEntry | ContainerEntry;

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

/** A version-shaped field. Beyond "" it refuses the word "none": a version
 *  that is not a version is not shown. This is the consumer's own invariant,
 *  kept whatever the producer emits, because a declaration rejected for its
 *  image once surfaced as a pinned version reading `none` on the board. */
function knownVersion(value: unknown): string | undefined {
  const v = knownString(value);
  return v === "none" ? undefined : v;
}

/** A systemd unit name: restricted characters, a known suffix, and so never a
 *  leading "-" that systemctl would read as an option. Defensive only (execFile,
 *  no shell, no sudo, root-owned source), but it costs one regex. */
const UNIT_NAME = /^[A-Za-z0-9:_.@][A-Za-z0-9:_.@-]*\.(service|timer|socket|target|mount|path)$/;

/** A compose project name, matching what lyly-admin-resource-status accepts:
 *  [a-z0-9-], no leading "-", at most 63 characters. Validated here as well as
 *  in the wrapper so a malformed name is dropped rather than passed to sudo. */
const CONTAINER_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

function toEntry(raw: Record<string, unknown>): InventoryEntry | null {
  const name = typeof raw.name === "string" ? raw.name : "";
  const group = typeof raw.group === "string" ? raw.group : "";
  if (!name || !GROUPS.includes(group)) return null;

  // A missing kind is a unit, not an error: this app deploys independently of
  // lychee-ops, so it will meet inventories published before `kind` existed,
  // and treating those as unrecognised would empty the board of every service.
  // The reverse skew (an old app, a new inventory) needs no code: the old
  // parser requires a `unit` matching UNIT_NAME, which container entries lack,
  // so it drops them without throwing.
  const kind = raw.kind === undefined ? "unit" : raw.kind;
  const base = { name, group: group as ServiceGroup, reconciled: raw.reconciled === true };

  let entry: InventoryEntry;
  if (kind === "unit") {
    const unit = typeof raw.unit === "string" ? raw.unit : "";
    if (!UNIT_NAME.test(unit)) return null;
    entry = { ...base, kind: "unit", unit };
  } else if (kind === "container") {
    const container = typeof raw.container === "string" ? raw.container : "";
    if (!CONTAINER_NAME.test(container)) return null;
    entry = { ...base, kind: "container", container };
  } else {
    return null;
  }
  if (!entry.reconciled) return entry;

  const version = knownString(raw.version);
  const commit = knownString(raw.commit);
  const gate = knownString(raw.gate);
  const lastRun = knownString(raw.last_run);
  const target = knownVersion(raw.target);
  const available = knownVersion(raw.available);
  if (target !== undefined) entry.target = target;
  if (available !== undefined) entry.available = available;
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
