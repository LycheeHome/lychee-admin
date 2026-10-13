// The platform's shared constants, held once in this app. Literal values on
// purpose: this ships, so it never reads the contract at runtime. The tests
// compare every export to lychee-contract's constants.json, so drift fails CI.

export const IMAGE_PREFIX = "ghcr.io/lychee-home/";

// lychee-admin's own PORT and Caddy's admin API. A reserved or privileged port
// is the last guard before a declaration the reconciler's validator would
// refuse, and a refused declaration freezes the whole set for the tick.
export const RESERVED_PORTS: readonly number[] = [8787, 2019];
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
} as const;
