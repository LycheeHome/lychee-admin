import { load } from "js-yaml";
import type { ContainerEntry } from "./serviceInventory";
import { isValidHostname, maxSiteLabelLength, siteSuffixFor } from "./siteValidation";

// Defined beside the validator that refuses an over-long Next.js label, so the
// refusal at add-site and the null here can never disagree about the limit.
export { siteSuffixFor, maxSiteLabelLength };

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

const REPO_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

/** Mirrors the reconciler's ghcr path component: lowercased, fullmatch. */
export function normalizeRepo(input: string): { ok: true; repo: string } | { ok: false; reason: string } {
  const repo = input.trim().toLowerCase();
  if (repo === "") return { ok: false, reason: "Repository name is required." };
  if (!REPO_PATTERN.test(repo)) {
    return {
      ok: false,
      reason: "Repository must be lowercase letters and digits, separated by single '.', '_' or '-'.",
    };
  }
  return { ok: true, repo };
}

export interface DeclarationSummary {
  name: string;
  port: number | null;
  state: string;
  image: string;
}

/** Reads one resource declaration; null on a parse error or a non-mapping. Never throws. */
export function parseDeclaration(name: string, content: string): DeclarationSummary | null {
  let doc: unknown;
  try {
    doc = load(content);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const fields = doc as Record<string, unknown>;
  return {
    name,
    port: typeof fields.port === "number" && Number.isInteger(fields.port) ? fields.port : null,
    state: typeof fields.state === "string" ? fields.state : "",
    image: typeof fields.image === "string" ? fields.image : "",
  };
}

/**
 * The tag a declaration's `image:` line names, or null. Null for an absent or
 * missing declaration, a digest reference, or a line with no tag. The colon is
 * read only in the last path segment, so a registry port (`host:5000/app`) is
 * never mistaken for a tag.
 */
export function declaredTag(decl: DeclarationSummary | undefined): string | null {
  if (!decl || decl.state === "absent") return null;
  return imageTag(decl.image);
}

/**
 * The tag an image reference names, or null: declaredTag's reading without
 * the declaration's state, for the one question it cannot answer, whether a
 * retired (`state: absent`) declaration is tagged. The image is the parsed
 * YAML value, so an escape that hides a colon from a regex still reads.
 */
export function imageTag(image: string): string | null {
  if (image.includes("@")) return null;
  const segment = image.slice(image.lastIndexOf("/") + 1);
  const colon = segment.lastIndexOf(":");
  if (colon < 0) return null;
  const tag = segment.slice(colon + 1);
  return tag === "" ? null : tag;
}

/**
 * Whether the reconciler has confirmed a retired site's container down: its
 * inventory entry shows nothing installed and a last result of `deployed` (a
 * completed down) or `awaiting-image` (never installed). `awaiting-image`
 * alone is not proof, since a site Deploy just tagged still publishes the
 * previous tick's entry while it comes up; it counts only for a declaration
 * with no tag, which can never have been brought up. The one rule the prune
 * route and the services board both use, so the board never offers a Prune
 * the route refuses for this reason, nor hides one it would accept.
 */
export function confirmedDown(entry: ContainerEntry | undefined, declaration: DeclarationSummary | undefined): boolean {
  if (!entry || entry.version) return false;
  if (entry.result === "deployed") return true;
  return entry.result === "awaiting-image" && declaration !== undefined && imageTag(declaration.image) === null;
}

/**
 * A tag the app has committed to a declaration that the reconciler has not yet
 * reported. The declaration is the app's own commit, so it can be ahead of the
 * inventory; the inventory's `version` and `target` are what the reconciler has
 * already acted on. Null once either of those names the declared tag, so an
 * applied tag never reads as requested.
 */
export function pendingTag(entry: { version?: string; target?: string }, declared: string | null): string | null {
  if (declared === null) return null;
  return declared !== entry.target && declared !== entry.version ? declared : null;
}

/** Port -> declaration name. Every state counts: an absent declaration still reserves its port. */
export function claimedPorts(decls: DeclarationSummary[]): Map<number, string> {
  const claimed = new Map<number, string>();
  for (const decl of decls) {
    if (decl.port !== null && !claimed.has(decl.port)) claimed.set(decl.port, decl.name);
  }
  return claimed;
}
