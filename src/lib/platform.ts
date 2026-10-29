// The platform's shared constants, held once in this app. Literal values on
// purpose: this ships, so it never reads the contract at runtime. The tests
// compare every export to lychee-contract's constants.json, so drift fails CI.

export const IMAGE_PREFIX = "ghcr.io/lycheehome/";

/** A resource name is capped at 63 characters (a DNS label, and the
 *  reconciler's own limit), so a site's label may use 63 minus the suffix. */
export const MAX_RESOURCE_NAME_LENGTH = 63;

/** Escapes a string for literal use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// lychee-admin's own PORT and Caddy's admin API. A reserved or privileged port
// is the last guard before a declaration the reconciler's validator would
// refuse, and a refused declaration freezes the whole set for the tick.
// Who each one is reserved for, so a refusal names one owner rather than
// hedging between two. RESERVED_PORTS is derived from it, in the same order.
export const RESERVED_PORT_OWNERS: ReadonlyMap<number, string> = new Map([
  [8787, "lychee-admin itself"],
  [2019, "Caddy's admin API"],
]);
export const RESERVED_PORTS: readonly number[] = [...RESERVED_PORT_OWNERS.keys()];
export const SITE_MIN_PORT = 1024;

export const FLOATING_TAGS: readonly string[] = ["latest"];
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** A tag this app may write: a real tag, and not a floating one. */
export function isValidTag(tag: string): boolean {
  return TAG_RE.test(tag) && !FLOATING_TAGS.includes(tag);
}

export const PATHS = {
  inventory: "/var/lib/lychee-inventory/services.json",
  resourceStatusDir: "/var/lib/lychee-resources",
  caddyfile: "/etc/caddy/Caddyfile",
  tunnelConfig: "/etc/cloudflared/sites-config.yml",
  sitesRoot: "/var/www",
  // The app never reads this: it exists so PATHS stays the contract's paths.
  appReleaseRoot: "/usr/local/lib/lychee-admin",
} as const;

/** The reconciler's history feed (A-HIST-1): lifetimes with their events. */
export const EVENTS_PATH = "/var/lib/lychee-inventory/events.json";

export const HOST_ACTIONS = ["start", "stop", "restart", "update"] as const;
export type HostAction = (typeof HOST_ACTIONS)[number];

const OP_UNIT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A bare name: what an inventory entry's `name` must be before it becomes
 *  part of a unit name or a filesystem path. */
export function isBareName(name: string): boolean {
  return OP_UNIT_RE.test(name);
}

const CLIENT_NAME_RE = /^[a-z][a-z0-9-]{0,30}$/;

/** A client's name, exactly as clients.schema.json has it: narrower than a
 *  bare name (a letter first, at most 31 characters, so `<client>-api` fits a
 *  32-character group name). lychee-ops refuses anything else, so this only
 *  keeps lychee-admin from accepting a name the contract does not. */
export function isClientName(name: string): boolean {
  return CLIENT_NAME_RE.test(name);
}

/** The one-shot unit that performs `action` on the inventory entry named
 *  `unit` (its bare name, never its `unit` value). Throws on anything but a
 *  bare name: the result becomes part of a root command line. */
export function opUnitName(unit: string, action: HostAction): string {
  if (!isBareName(unit)) throw new Error(`not a valid unit name: ${JSON.stringify(unit)}`);
  if (!HOST_ACTIONS.includes(action)) throw new Error(`not a host action: ${JSON.stringify(action)}`);
  return `lychee-op-${unit}-${action}.service`;
}

/** Where an action service records how it ended (A-OPS-1 Result,
 *  `op_result_path`). Validated through opUnitName, like opLogPath: throws on
 *  anything but a bare name and a host action, so no path is ever built from
 *  an unchecked name. */
export function opResultPath(unit: string, action: HostAction): string {
  opUnitName(unit, action);
  return `/var/lib/lychee-op/${unit}-${action}.result.json`;
}

/** Throws on anything but a client name: the result is a path lychee-admin
 *  unlinks a stale socket at. */
export function clientSocketPath(client: string): string {
  if (!isClientName(client)) throw new Error(`not a valid client name: ${JSON.stringify(client)}`);
  return `/run/lychee-admin/clients/${client}/api.sock`;
}

export const CLIENTS_FILE = "/etc/lychee-admin/clients.json";
