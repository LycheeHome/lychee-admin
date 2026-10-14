// Every argv this app runs through sudo, held once. Literal values on purpose:
// this ships, so it never reads the contract at runtime. SUDO_TABLE restates the
// same commands in sudo.json's form and the tests compare it to the contract's,
// so drift fails CI. lychee-ops' sudoers.example grants exactly these.

import { type HostAction, opUnitName, PATHS } from "./platform";

const WRITE_CONFIG = "/usr/local/sbin/lychee-admin-write-config";

export const SUDO = {
  caddyValidate: ["/usr/bin/caddy", "validate", "--config", PATHS.caddyfile],
  caddyReload: ["/usr/bin/systemctl", "reload", "caddy"],
  tunnelRestart: ["/usr/bin/systemctl", "restart", "cloudflared-sites"],
  createSiteDir: (hostname: string) => ["/usr/local/sbin/lychee-admin-create-site-dir", hostname],
  writeConfig: (path: string) => [WRITE_CONFIG, path],
  startOp: (unit: string, action: HostAction) => ["/usr/bin/systemctl", "start", "--no-block", opUnitName(unit, action)],
  resourceStatus: (project: string) => ["/usr/local/sbin/lychee-admin-resource-status", project],
};

export const SUDO_TABLE: { id: string; argv: string[] }[] = [
  { id: "caddy-validate", argv: SUDO.caddyValidate },
  { id: "caddy-reload", argv: SUDO.caddyReload },
  { id: "tunnel-restart", argv: SUDO.tunnelRestart },
  { id: "create-site-dir", argv: SUDO.createSiteDir("<hostname>") },
  { id: "write-caddyfile", argv: SUDO.writeConfig(PATHS.caddyfile) },
  { id: "write-tunnel-config", argv: SUDO.writeConfig(PATHS.tunnelConfig) },
  { id: "resource-status", argv: SUDO.resourceStatus("<project>") },
];
