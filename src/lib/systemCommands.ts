import { execFile as execFileCb, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { config } from "../config";
import { parseComposePsOutput, type ContainerStatus } from "./containerStatus";

const execFile = promisify(execFileCb);

/**
 * Temporary: retained only until src/dev/ supplies fake implementations and
 * the route tests switch to them. Removed in the same change that adds
 * src/dev/fakes.ts — production mock behavior is then unreachable by
 * construction rather than guarded by an environment variable.
 */
const MOCK_SYSTEM = process.env.MOCK_SYSTEM === "true";

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

/**
 * Runs a single privileged command via execFile (never a shell), so arguments
 * can't be reinterpreted by a shell. Every command here must have a matching
 * narrowly-scoped entry in the sudoers file — see deploy/sudoers.example.
 */
async function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFile(command, args);
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message: string };
    throw new CommandError(err.message, err.stdout ?? "", err.stderr ?? "");
  }
}

/**
 * The privileged operations lyly-admin performs on its host. Injected rather
 * than imported directly so the dev entry point can substitute fakes — see
 * src/dev/fakes.ts.
 */
export interface SystemCommands {
  validateCaddyfile(caddyfilePath: string): Promise<{ stdout: string; stderr: string }>;
  reloadCaddy(): Promise<{ stdout: string; stderr: string }>;
  restartCloudflared(): Promise<{ stdout: string; stderr: string }>;
  createSiteDirectory(hostname: string): Promise<{ stdout: string; stderr: string }>;
  writeManagedConfig(targetPath: string, content: string): Promise<void>;
  checkContainerStatus(hostname: string): Promise<ContainerStatus>;
}

export const realSystemCommands: SystemCommands = {
  validateCaddyfile(caddyfilePath) {
    if (MOCK_SYSTEM) {
      return Promise.resolve({ stdout: `[mock] validated ${caddyfilePath}`, stderr: "" });
    }
    return run("sudo", ["/usr/bin/caddy", "validate", "--config", caddyfilePath]);
  },

  reloadCaddy() {
    if (MOCK_SYSTEM) {
      return Promise.resolve({ stdout: "[mock] reloaded caddy", stderr: "" });
    }
    return run("sudo", ["/usr/bin/systemctl", "reload", "caddy"]);
  },

  /**
   * Restarts cloudflared-sites, not the box's original cloudflared.service —
   * lyly-admin only manages hostnames on the split-off "sites" tunnel
   * (see deploy/cloudflared-sites.service), so this never interrupts
   * ssh.lyly.dev, which stays on its own separate tunnel/service.
   */
  restartCloudflared() {
    if (MOCK_SYSTEM) {
      return Promise.resolve({ stdout: "[mock] restarted cloudflared-sites", stderr: "" });
    }
    return run("sudo", ["/usr/bin/systemctl", "restart", "cloudflared-sites"]);
  },

  /**
   * Creates /var/www/<hostname> owned web:webdeploy with the setgid bit so new
   * files inherit the group, via deploy/lyly-admin-create-site-dir.sh. That
   * script (not sudoers) validates the hostname and hardcodes the owner/group —
   * sudoers can't safely restrict install(1)'s arguments to "some path under
   * /var/www" without wildcards, which aren't supported on every sudo build.
   */
  createSiteDirectory(hostname) {
    if (MOCK_SYSTEM) {
      fs.mkdirSync(path.join(config.sitesRoot, hostname), { recursive: true });
      return Promise.resolve({ stdout: `[mock] created ${path.join(config.sitesRoot, hostname)}`, stderr: "" });
    }
    return run("sudo", ["/usr/local/sbin/lyly-admin-create-site-dir", hostname]);
  },

  /**
   * Writes `content` to a root-owned config file (the Caddyfile or the tunnel
   * config.yml) by piping it into deploy/lyly-admin-write-config.sh via sudo.
   * That script only accepts these two exact paths — see sudoers.example.
   * Needed because /etc/caddy and /etc/cloudflared are root:root 755, so the
   * dedicated low-privilege app user has no direct write access to either file.
   */
  writeManagedConfig(targetPath, content) {
    if (MOCK_SYSTEM) {
      fs.writeFileSync(targetPath, content);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const child = spawn("sudo", ["/usr/local/sbin/lyly-admin-write-config", targetPath]);

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (error) => reject(new CommandError(error.message, "", stderr)));

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new CommandError(`lyly-admin-write-config exited with code ${code}`, "", stderr));
        }
      });

      child.stdin.end(content);
    });
  },

  /**
   * Reads container lifecycle state + Docker health (if the image defines a
   * HEALTHCHECK) for a Next.js-scaffolded site via deploy/lyly-admin-docker-status.sh.
   * Unlike every other function in this file, failures are swallowed into
   * { state: "unknown" } rather than thrown — this is best-effort display
   * data for the detail page, not a mutating action a caller needs to detect
   * and roll back. No raw stderr reaches the page.
   */
  async checkContainerStatus(hostname) {
    if (MOCK_SYSTEM) {
      return { state: "running", health: "healthy" };
    }
    try {
      const { stdout } = await run("sudo", ["/usr/local/sbin/lyly-admin-docker-status", hostname]);
      return parseComposePsOutput(stdout);
    } catch {
      return { state: "unknown" };
    }
  },
};
