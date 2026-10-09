import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Comma-separated hostnames: trimmed, lowercased, empty entries dropped. */
export function parseHostnameList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),

  adminUsername: required("ADMIN_USERNAME"),
  adminPasswordHash: required("ADMIN_PASSWORD_HASH"),

  domain: required("DOMAIN"),
  // Hostnames add-site must refuse: ones served by config this app never
  // parses (admin.<domain> lives in its own Caddy file), which its duplicate
  // check therefore cannot see.
  reservedHostnames: parseHostnameList(process.env.RESERVED_HOSTNAMES),

  caddyfilePath: process.env.CADDYFILE_PATH ?? "/etc/caddy/Caddyfile",
  // The "sites" tunnel's config — split off from the lychee-ssh tunnel, which
  // carried ssh.lyly.dev until that tunnel was retired. Still its own file and
  // service, and this path must keep pointing at the sites tunnel's config.
  tunnelConfigPath: process.env.TUNNEL_CONFIG_PATH ?? "/etc/cloudflared/sites-config.yml",
  // Must stay "/var/www" — lychee-ops' lyly-admin-create-site-dir.sh hardcodes
  // this path (and the web:webdeploy owner/group) rather than taking it as
  // an argument, since sudoers can't safely wildcard-match arbitrary paths.
  sitesRoot: process.env.SITES_ROOT ?? "/var/www",

  backupDir: process.env.BACKUP_DIR ?? "/etc/lyly-admin/backups",
  logFile: process.env.LOG_FILE ?? "/var/log/lyly-admin/actions.log",
};
