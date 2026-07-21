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
  tunnelConfigPath: process.env.TUNNEL_CONFIG_PATH ?? "/etc/cloudflared/config.yml",
  sitesRoot: process.env.SITES_ROOT ?? "/var/www",
  tunnelId: process.env.TUNNEL_ID ?? "",

  siteOwnerUser: process.env.SITE_OWNER_USER ?? "web",
  siteOwnerGroup: process.env.SITE_OWNER_GROUP ?? "webdeploy",

  backupDir: process.env.BACKUP_DIR ?? "/etc/lyly-admin/backups",
  logFile: process.env.LOG_FILE ?? "/var/log/lyly-admin/actions.log",
};
