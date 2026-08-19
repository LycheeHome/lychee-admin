import yaml from "js-yaml";

interface IngressRule {
  hostname?: string;
  service: string;
}

interface TunnelConfig {
  tunnel?: string;
  "credentials-file"?: string;
  ingress: IngressRule[];
  [key: string]: unknown;
}

function parse(content: string): TunnelConfig {
  const parsed = yaml.load(content) as TunnelConfig;
  if (!parsed || !Array.isArray(parsed.ingress)) {
    throw new Error("Tunnel config.yml is missing an `ingress` list");
  }
  return parsed;
}

function stringify(config: TunnelConfig): string {
  return yaml.dump(config, { lineWidth: -1 });
}

/**
 * Inserts a new ingress rule immediately before the catch-all entry (the
 * final rule, which has no `hostname` — e.g. `service: http_status:404`).
 */
/**
 * The tunnel this config file belongs to. Read from the same file the app
 * writes ingress rules into, so the id shown on a site's page and used in its
 * DNS command cannot disagree with the tunnel actually carrying the hostname.
 *
 * Returns "" for a file with no `tunnel:` key rather than throwing: the id is
 * display and command text, not something a mutation depends on, and the
 * detail page degrades to Cloudflare-dashboard instructions without it.
 */
export function readTunnelId(content: string): string {
  try {
    return parse(content).tunnel ?? "";
  } catch {
    return "";
  }
}

export function addIngressRule(content: string, hostname: string, service: string): string {
  const config = parse(content);

  if (config.ingress.some((rule) => rule.hostname === hostname)) {
    throw new Error(`Ingress rule for ${hostname} already exists`);
  }

  const catchAllIndex = config.ingress.findIndex((rule) => !rule.hostname);
  const insertIndex = catchAllIndex === -1 ? config.ingress.length : catchAllIndex;

  config.ingress.splice(insertIndex, 0, { hostname, service });
  return stringify(config);
}

export function removeIngressRule(content: string, hostname: string): string {
  const config = parse(content);
  const nextIngress = config.ingress.filter((rule) => rule.hostname !== hostname);

  if (nextIngress.length === config.ingress.length) {
    throw new Error(`No ingress rule found for hostname: ${hostname}`);
  }

  config.ingress = nextIngress;
  return stringify(config);
}

export function ingressExists(content: string, hostname: string): boolean {
  return parse(content).ingress.some((rule) => rule.hostname === hostname);
}
