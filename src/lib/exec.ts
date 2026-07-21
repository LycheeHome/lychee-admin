import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

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

export function validateCaddyfile(caddyfilePath: string): Promise<{ stdout: string; stderr: string }> {
  return run("sudo", ["/usr/bin/caddy", "validate", "--config", caddyfilePath]);
}

export function reloadCaddy(): Promise<{ stdout: string; stderr: string }> {
  return run("sudo", ["/usr/bin/systemctl", "reload", "caddy"]);
}

export function restartCloudflared(): Promise<{ stdout: string; stderr: string }> {
  return run("sudo", ["/usr/bin/systemctl", "restart", "cloudflared"]);
}

export function caddyStatus(): Promise<{ stdout: string; stderr: string }> {
  return run("sudo", ["/usr/bin/systemctl", "status", "caddy", "--no-pager"]);
}

/**
 * Creates a site directory owned by the dedicated web user/group with the
 * setgid bit so new files inherit the group. Requires a scoped sudoers entry
 * for /usr/bin/install restricted to paths under the sites root.
 */
export function createSiteDirectory(
  sitePath: string,
  owner: string,
  group: string,
): Promise<{ stdout: string; stderr: string }> {
  return run("sudo", ["/usr/bin/install", "-d", "-m", "2775", "-o", owner, "-g", group, sitePath]);
}
