import "dotenv/config";
import { PATHS } from "./lib/platform";

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

  // Fixed on the host, not configured: the config-writing wrapper and the
  // sudoers grant are pinned to these exact paths (see platform.ts).
  caddyfilePath: PATHS.caddyfile,
  tunnelConfigPath: PATHS.tunnelConfig,
  sitesRoot: PATHS.sitesRoot,

  backupDir: process.env.BACKUP_DIR ?? "/etc/lychee-admin/backups",
  logFile: process.env.LOG_FILE ?? "/var/log/lychee-admin/actions.log",
};
