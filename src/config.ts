import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),

  adminUsername: required("ADMIN_USERNAME"),
  adminPasswordHash: required("ADMIN_PASSWORD_HASH"),

  domain: process.env.DOMAIN ?? "lyly.dev",

  caddyfilePath: process.env.CADDYFILE_PATH ?? "/etc/caddy/Caddyfile",
  // The "sites" tunnel's config — split off from the lychee-ssh tunnel so
  // restarting cloudflared for a site change never drops ssh.lyly.dev.
  tunnelConfigPath: process.env.TUNNEL_CONFIG_PATH ?? "/etc/cloudflared/sites-config.yml",
  // Must stay "/var/www" — lychee-ops' lyly-admin-create-site-dir.sh hardcodes
  // this path (and the web:webdeploy owner/group) rather than taking it as
  // an argument, since sudoers can't safely wildcard-match arbitrary paths.
  sitesRoot: process.env.SITES_ROOT ?? "/var/www",

  backupDir: process.env.BACKUP_DIR ?? "/etc/lyly-admin/backups",
  logFile: process.env.LOG_FILE ?? "/var/log/lyly-admin/actions.log",
};
