import { MAX_RESOURCE_NAME_LENGTH, escapeRegex } from "./platform";

/*
 * Site names and hostnames: pure rules with no import beyond platform.ts, so
 * the client bundle can carry them. siteValidation.ts (which reads the
 * Caddyfile) and siteResource.ts (which parses YAML) re-export them for the
 * server; the client imports them from here. clientImports.test.ts fails if a
 * client module reaches js-yaml or a node: built-in again.
 */

/** Appended to a site's label to form its container-resource name:
 *  `lychee.land` -> `-lychee-land`. */
export function siteSuffixFor(domain: string): string {
  return "-" + domain.replace(/\./g, "-");
}

/** A site's resource name in full: a DNS-label-shaped label plus the suffix. */
export function siteNamePatternFor(domain: string): RegExp {
  return new RegExp(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?${escapeRegex(siteSuffixFor(domain))}$`);
}

// A site's resource name: a DNS-label-shaped site label plus the domain's
// suffix (siteNamePatternFor), capped at MAX_RESOURCE_NAME_LENGTH like every
// resource name. Narrower than the declaration writer's NAME_RE on purpose:
// creating and retiring are reachable only for sites, never for a declaration
// such as palsave-api that this app did not write. Here rather than in the
// writer because the client's services board reads it too, and the writer
// imports node modules.
export function isSiteName(name: string, domain: string): boolean {
  return name.length <= MAX_RESOURCE_NAME_LENGTH && siteNamePatternFor(domain).test(name);
}

export function maxSiteLabelLength(domain: string): number {
  return MAX_RESOURCE_NAME_LENGTH - siteSuffixFor(domain).length;
}

export function isValidHostname(hostname: string, domain: string): boolean {
  const pattern = new RegExp(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?\\.${escapeRegex(domain)}$`, "i");
  return pattern.test(hostname);
}

/**
 * Why a hostname is not a valid site hostname, in one sentence, or null when
 * it is. One message per real cause (critique 2026-10-26: invalid characters
 * were told they "must be a subdomain"). The validator and the add page's
 * hostname field both say this, so the two never word it differently.
 */
export function hostnameMessage(hostname: string, domain: string): string | null {
  if (isValidHostname(hostname, domain)) return null;
  const suffix = `.${domain}`.toLowerCase();
  const lower = hostname.toLowerCase();
  if (!lower.endsWith(suffix) || lower.length === suffix.length) return `"${hostname}" must be a subdomain of ${domain}`;
  const label = hostname.slice(0, hostname.length - suffix.length);
  if (label.includes(".")) return `"${label}" is more than one label: a site is a single name under ${domain}`;
  return `"${label}" can only use letters, digits and hyphens, and can't start or end with a hyphen`;
}

/**
 * Caddyfile blocks lychee-admin doesn't own (e.g. a manually added local-LAN
 * block like lychee.local) must never show up as a managed site, since
 * removing them here would still delete their local directory or tunnel
 * ingress rule.
 */
export function isManagedHostname(hostname: string, domain: string): boolean {
  return hostname === domain || isValidHostname(hostname, domain);
}

// Defined beside the validator that refuses an over-long Next.js label, so the
// refusal at add-site and the null here can never disagree about the limit.
/**
 * `test.lychee.land` -> `test-lychee-land`. Null for anything that is not a
 * single-label hostname under the managed domain, or whose label is too long
 * for the resulting name to fit.
 */
export function resourceNameFor(hostname: string, domain: string): string | null {
  if (!isValidHostname(hostname, domain)) return null;
  const label = hostname.slice(0, hostname.length - domain.length - 1).toLowerCase();
  if (label.length > maxSiteLabelLength(domain)) return null;
  return `${label}${siteSuffixFor(domain)}`;
}

/**
 * `test-lychee-land` -> `test.lychee.land`, the inverse of `resourceNameFor`
 * for a name that is a site's. Null when the suffix is absent or nothing is
 * left of it. Only a suffix strip: whether that hostname is one the app
 * manages is for the caller's managed set to say.
 */
export function hostnameForResource(name: string, domain: string): string | null {
  const suffix = siteSuffixFor(domain);
  if (!name.endsWith(suffix)) return null;
  const label = name.slice(0, name.length - suffix.length);
  return label === "" ? null : `${label}.${domain}`;
}
