export type SiteType = "static" | "reverse-proxy";

export interface Site {
  hostname: string;
  type: SiteType;
  /** local path for static sites, local port for reverse proxies */
  target: string;
  /** only set for reverse-proxy sites scaffolded with a known framework, e.g. "nextjs" */
  framework?: string;
}

interface ParsedBlock {
  hostname: string;
  body: string;
  raw: string;
}

const SITE_HEADER = /^http:\/\/([a-zA-Z0-9.-]+)\s*\{/;

/**
 * Splits the Caddyfile into top-level `http://<hostname> { ... }` blocks.
 * Assumes the existing convention of one site per block with no nesting
 * beyond the site block itself (true of every block this app writes).
 */
function splitBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    const headerMatch = SITE_HEADER.exec(lines[i].trim());
    if (!headerMatch) {
      i++;
      continue;
    }

    const hostname = headerMatch[1];
    const bodyLines: string[] = [];
    const rawLines: string[] = [lines[i]];
    i++;

    let depth = 1;
    while (i < lines.length && depth > 0) {
      const line = lines[i];
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      if (depth > 0) bodyLines.push(line);
      rawLines.push(line);
      i++;
    }

    blocks.push({ hostname, body: bodyLines.join("\n"), raw: rawLines.join("\n") });
  }

  return blocks;
}

export function parseSites(content: string): Site[] {
  return splitBlocks(content).map((block) => {
    const proxyMatch = /reverse_proxy\s+localhost:(\d+)/.exec(block.body);
    if (proxyMatch) {
      const frameworkMatch = /#\s*lyly-admin-framework:\s*(\S+)/.exec(block.body);
      return {
        hostname: block.hostname,
        type: "reverse-proxy",
        target: proxyMatch[1],
        ...(frameworkMatch ? { framework: frameworkMatch[1] } : {}),
      };
    }

    const rootMatch = /root\s+\*\s+(\S+)/.exec(block.body);
    return { hostname: block.hostname, type: "static", target: rootMatch?.[1] ?? "" };
  });
}

function renderStaticBlock(hostname: string, sitePath: string): string {
  return `http://${hostname} {\n\troot * ${sitePath}\n\tfile_server\n}\n`;
}

function renderReverseProxyBlock(hostname: string, port: string, framework?: string): string {
  const frameworkComment = framework ? `\t# lyly-admin-framework: ${framework}\n` : "";
  return `http://${hostname} {\n${frameworkComment}\treverse_proxy localhost:${port}\n}\n`;
}

export function appendSite(
  content: string,
  site: { hostname: string; type: SiteType; target: string; framework?: string },
): string {
  const block =
    site.type === "static"
      ? renderStaticBlock(site.hostname, site.target)
      : renderReverseProxyBlock(site.hostname, site.target, site.framework);

  const trimmed = content.trimEnd();
  return `${trimmed}\n\n${block}`.trimEnd() + "\n";
}

export function removeSite(content: string, hostname: string): string {
  const blocks = splitBlocks(content);
  const target = blocks.find((block) => block.hostname === hostname);
  if (!target) {
    throw new Error(`No Caddyfile block found for hostname: ${hostname}`);
  }

  return content.replace(target.raw, "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function hostnameExists(content: string, hostname: string): boolean {
  return splitBlocks(content).some((block) => block.hostname === hostname);
}
