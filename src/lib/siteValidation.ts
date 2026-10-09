import { hostnameExists, parseSites, type SiteType } from "./caddyfile";

/**
 * What an add-site request means once normalized — the shape both POST /sites
 * and POST /sites/preview work from. Extracted from the POST /sites handler
 * so the preview can never accept input the submit would reject, or reject
 * input the submit would accept.
 */
export interface SiteInput {
  hostname: string;
  type: SiteType;
  port: string;
  framework?: "nextjs";
  healthcheckPath?: string;
}

export interface SiteEnv {
  domain: string;
  sitesRoot: string;
  caddyfilePath: string;
  tunnelConfigPath: string;
  /** lyly-admin's own port and Caddy's admin API, which no site may claim. */
  reservedPorts: readonly number[];
}

export type Validation = { ok: true } | { ok: false; error: string };

const HEALTHCHECK_PATH_PATTERN = /^\/[A-Za-z0-9._~\-/]{0,199}$/;

/** A resource name is capped at 63 characters (a DNS label, and the
 *  reconciler's own limit), so a site's label may use 63 minus the suffix. */
export const MAX_RESOURCE_NAME_LENGTH = 63;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Appended to a site's label to form its container-resource name:
 *  `lychee.land` -> `-lychee-land`. */
export function siteSuffixFor(domain: string): string {
  return "-" + domain.replace(/\./g, "-");
}

/** A site's resource name in full: a DNS-label-shaped label plus the suffix. */
export function siteNamePatternFor(domain: string): RegExp {
  return new RegExp(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?${escapeRegex(siteSuffixFor(domain))}$`);
}

export function maxSiteLabelLength(domain: string): number {
  return MAX_RESOURCE_NAME_LENGTH - siteSuffixFor(domain).length;
}

export function isValidHostname(hostname: string, domain: string): boolean {
  const pattern = new RegExp(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.${escapeRegex(domain)}$`, "i");
  return pattern.test(hostname);
}

/**
 * Caddyfile blocks lyly-admin doesn't own (e.g. a manually added local-LAN
 * block like lychee.local) must never show up as a managed site, since
 * removing them here would still delete their local directory or tunnel
 * ingress rule.
 */
export function isManagedHostname(hostname: string, domain: string): boolean {
  return hostname === domain || isValidHostname(hostname, domain);
}

/**
 * The exact normalization POST /sites has always applied, moved verbatim so
 * both routes read a body the same way.
 */
export function readSiteInput(body: unknown): SiteInput {
  const fields = (body ?? {}) as Record<string, unknown>;
  const hostname = String(fields.hostname ?? "").trim().toLowerCase();
  const type: SiteType = fields.type === "reverse-proxy" ? "reverse-proxy" : "static";
  const port = String(fields.port ?? "").trim();
  const rawFramework = String(fields.framework ?? "").trim();
  const framework = type === "reverse-proxy" && rawFramework === "nextjs" ? ("nextjs" as const) : undefined;
  const rawHealthcheckPath = String(fields.healthcheckPath ?? "").trim();
  const healthcheckPath = framework === "nextjs" ? rawHealthcheckPath || "/" : undefined;
  return { hostname, type, port, framework, healthcheckPath };
}

/**
 * The checks that need nothing but the request itself. Split from
 * validateAgainstExisting so the ordering POST /sites has always used is
 * preserved: these three run before the Caddyfile is ever read, so a
 * malformed hostname still fails without touching the filesystem.
 */
export function validateSiteInput(input: SiteInput, env: SiteEnv): Validation {
  if (!isValidHostname(input.hostname, env.domain)) {
    return { ok: false, error: `"${input.hostname}" must be a subdomain of ${env.domain}` };
  }

  if (input.type === "reverse-proxy" && (!input.port || Number(input.port) < 1 || Number(input.port) > 65535)) {
    return { ok: false, error: "A valid local port is required for a reverse proxy site" };
  }

  // A Next.js site becomes the resource <label><suffix>. Refused here rather
  // than at Attach, so the site is never added in a shape it can never be
  // attached in; here rather than in the route, so preview and submit agree.
  if (input.framework === "nextjs") {
    const label = input.hostname.slice(0, input.hostname.length - env.domain.length - 1);
    const maxLabel = maxSiteLabelLength(env.domain);
    if (label.length > maxLabel) {
      return {
        ok: false,
        error: `A Next.js site's label can be at most ${maxLabel} characters (this one is ${label.length}): it becomes the resource name <label>${siteSuffixFor(env.domain)}, which is capped at ${MAX_RESOURCE_NAME_LENGTH}.`,
      };
    }
  }

  // The reconciler's validator rejects sites below 1024, and one rejected
  // declaration freezes every resource on the host for a tick.
  if (input.framework === "nextjs" && Number(input.port) < 1024) {
    return { ok: false, error: "A Next.js site needs a port of 1024 or above; lower ports are privileged" };
  }

  if (input.healthcheckPath && !HEALTHCHECK_PATH_PATTERN.test(input.healthcheckPath)) {
    return { ok: false, error: `"${input.healthcheckPath}" is not a valid healthcheck path` };
  }

  return { ok: true };
}

/** The checks that need the current Caddyfile to answer. */
export function validateAgainstExisting(
  input: SiteInput,
  caddyfileContent: string,
  env: SiteEnv,
  declaredPorts: Map<number, string>,
): Validation {
  if (hostnameExists(caddyfileContent, input.hostname)) {
    return { ok: false, error: `${input.hostname} already exists in the Caddyfile` };
  }

  if (input.type !== "reverse-proxy") return { ok: true };

  if (env.reservedPorts.includes(Number(input.port))) {
    return {
      ok: false,
      error: `Port ${input.port} is reserved (used by lyly-admin itself or Caddy's admin API)`,
    };
  }

  // Every claim counts, absent declarations included: two declarations on one
  // port make the reconciler reject both.
  const claimant = declaredPorts.get(Number(input.port));
  if (claimant) {
    return { ok: false, error: `Port ${input.port} is already claimed by ${claimant} in lychee-resources.` };
  }

  const conflicting = parseSites(caddyfileContent).find(
    (site) => site.type === "reverse-proxy" && site.target === input.port,
  );
  if (conflicting) {
    return { ok: false, error: `Port ${input.port} is already used by ${conflicting.hostname}` };
  }

  return { ok: true };
}
