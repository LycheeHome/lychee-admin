import { config } from "../config";
import type { FileSystem } from "../lib/fileSystem";

/**
 * Covers every branch parseSites has: the apex domain, a static subdomain, a
 * plain reverse proxy, a Next.js site carrying both marker comments, a
 * Next.js site carrying only the framework comment (the pre-healthcheck
 * legacy shape — sites created before the healthcheck-path field existed),
 * and one deliberately unmanaged block. lychee.local must never appear in
 * the site list — it is the live check that isManagedHostname still filters.
 *
 * Ports 4000, 3000, and 3001 leave 8787 (lyly-admin itself) and 2019
 * (Caddy's admin API) free, so the reserved-port rejection can be triggered
 * from the UI.
 */
export const SEED_CADDYFILE = `{
\tauto_https off
}

http://lyly.dev {
\troot * /var/www/lyly.dev
\tfile_server
}

http://blog.lyly.dev {
\troot * /var/www/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}

http://app.lyly.dev {
\t# lyly-admin-framework: nextjs
\t# lyly-admin-healthcheck: /api/health
\treverse_proxy localhost:3000
}

http://legacy.lyly.dev {
\t# lyly-admin-framework: nextjs
\treverse_proxy localhost:3001
}

http://lychee.local {
\troot * /var/www/lychee.local
\tfile_server
}
`;

/** lychee.local deliberately has no ingress rule — it is not tunnel-managed. */
export const SEED_TUNNEL_CONFIG = `tunnel: 11111111-2222-3333-4444-555555555555
credentials-file: /etc/cloudflared/11111111-2222-3333-4444-555555555555.json
ingress:
  - hostname: lyly.dev
    service: http://localhost:80
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - hostname: api.lyly.dev
    service: http://localhost:80
  - hostname: app.lyly.dev
    service: http://localhost:80
  - hostname: legacy.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

export function applySeed(fs: FileSystem): void {
  fs.writeFile(config.caddyfilePath, SEED_CADDYFILE);
  fs.writeFile(config.tunnelConfigPath, SEED_TUNNEL_CONFIG);
}
