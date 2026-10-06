import { load } from "js-yaml";
import { isValidHostname } from "./siteValidation";

/** Appended to a site's label to form its container-resource name. */
export const SITE_SUFFIX = "-lyly-dev";

/** 63 (DNS label / resource name cap) minus the suffix. */
const MAX_LABEL_LENGTH = 63 - SITE_SUFFIX.length;

/**
 * `test.lyly.dev` -> `test-lyly-dev`. Null for anything that is not a
 * single-label hostname under the managed domain, or whose label is too long
 * for the resulting name to fit.
 */
export function resourceNameFor(hostname: string, domain: string): string | null {
  if (!isValidHostname(hostname, domain)) return null;
  const label = hostname.slice(0, hostname.length - domain.length - 1).toLowerCase();
  if (label.length > MAX_LABEL_LENGTH) return null;
  return `${label}${SITE_SUFFIX}`;
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

/** Port -> declaration name. Every state counts: an absent declaration still reserves its port. */
export function claimedPorts(decls: DeclarationSummary[]): Map<number, string> {
  const claimed = new Map<number, string>();
  for (const decl of decls) {
    if (decl.port !== null && !claimed.has(decl.port)) claimed.set(decl.port, decl.name);
  }
  return claimed;
}
