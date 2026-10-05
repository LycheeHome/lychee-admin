import { execFile as execFileCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeDeclarationTag, type WriteResult } from "./declarationWriter";
import { parseComposePsOutput, parseServiceStatusOutput, type ContainerStatus } from "./containerStatus";
import {
  parseTimerSchedule,
  parseUnitShowOutput,
  UNIT_SHOW_PROPERTIES,
  type TimerSchedule,
  type UnitState,
  type ServiceStatus,
} from "./unitState";

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
 * How long a status read may take before it is abandoned. Only the reads get a
 * ceiling (the container status, the unit states and the timer schedule), and
 * deliberately so: they are read-only, unattended, and rendered on page load,
 * so a wedged Docker daemon or systemd would otherwise hold a page request
 * open with no limit.
 *
 * The mutating commands stay unbounded on purpose. `systemctl restart
 * cloudflared-sites` legitimately takes over ten seconds — its unit sets
 * TimeoutStopSec=10 — and killing it partway would report a failure for a
 * restart that then completes anyway, which is a worse outcome than waiting:
 * the operator would not know which of the two happened.
 */
const STATUS_READ_TIMEOUT_MS = 2000;

/**
 * Runs a single command via execFile (never a shell), so arguments can't be
 * reinterpreted by a shell. Every command run through `sudo` must have a
 * matching narrowly-scoped entry in the sudoers file — see lychee-ops'
 * sudoers.example. The unprivileged reads (`systemctl show`, `systemctl
 * list-timers`) run without sudo and deliberately have NO entry there: they
 * are world-readable, which is why the services page needs no new grant.
 * Do not add one.
 *
 * `timeoutMs` is opt-in per call rather than a default, for the reason above.
 * When it fires, execFile sends SIGTERM and rejects, which the caller sees as
 * an ordinary CommandError — so a timed-out read degrades exactly the way a
 * failed one already did.
 */
async function run(
  command: string,
  args: string[],
  { timeoutMs, cwd, env }: { timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFile(command, args, {
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(env === undefined ? {} : { env }),
    });
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
  readUnitStates(units: string[]): Promise<Record<string, UnitState>>;
  readResourceStatus(project: string): Promise<ServiceStatus>;
  readTimerSchedule(timer: string): Promise<TimerSchedule>;
  writeDeclarationTag(name: string, tag: string): Promise<WriteResult>;
}

export const realSystemCommands: SystemCommands = {
  validateCaddyfile(caddyfilePath) {
    return run("sudo", ["/usr/bin/caddy", "validate", "--config", caddyfilePath]);
  },

  reloadCaddy() {
    return run("sudo", ["/usr/bin/systemctl", "reload", "caddy"]);
  },

  /**
   * Restarts cloudflared-sites, not the box's original cloudflared.service —
   * lyly-admin only manages hostnames on the split-off "sites" tunnel
   * (see lychee-ops' cloudflared-sites.service). The split was drawn so this
   * could never interrupt ssh.lyly.dev; that tunnel is retired and host
   * access is Tailscale now, but the scope stays exactly as narrow as it was.
   */
  restartCloudflared() {
    return run("sudo", ["/usr/bin/systemctl", "restart", "cloudflared-sites"]);
  },

  /**
   * Creates /var/www/<hostname> owned web:webdeploy with the setgid bit so new
   * files inherit the group, via lychee-ops' lyly-admin-create-site-dir.sh. That
   * script (not sudoers) validates the hostname and hardcodes the owner/group —
   * sudoers can't safely restrict install(1)'s arguments to "some path under
   * /var/www" without wildcards, which aren't supported on every sudo build.
   */
  createSiteDirectory(hostname) {
    return run("sudo", ["/usr/local/sbin/lyly-admin-create-site-dir", hostname]);
  },

  /**
   * Writes `content` to a root-owned config file (the Caddyfile or the tunnel
   * config.yml) by piping it into lychee-ops' lyly-admin-write-config.sh via sudo.
   * That script only accepts these two exact paths — see sudoers.example.
   * Needed because /etc/caddy and /etc/cloudflared are root:root 755, so the
   * dedicated low-privilege app user has no direct write access to either file.
   */
  writeManagedConfig(targetPath, content) {
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
   * HEALTHCHECK) for a Next.js-scaffolded site via lychee-ops' lyly-admin-docker-status.sh.
   * Unlike every other function in this file, failures are swallowed into
   * { state: "unknown" } rather than thrown — this is best-effort display
   * data for the detail page, not a mutating action a caller needs to detect
   * and roll back. No raw stderr reaches the page. A timeout lands here too,
   * so a wedged daemon renders "can't check" instead of hanging the page.
   */
  async checkContainerStatus(hostname) {
    try {
      const { stdout } = await run(
        "sudo",
        ["/usr/local/sbin/lyly-admin-docker-status", hostname],
        { timeoutMs: STATUS_READ_TIMEOUT_MS },
      );
      return parseComposePsOutput(stdout);
    } catch {
      return { state: "unknown" };
    }
  },

  /**
   * One invocation for every unit, not one per unit: this runs on every render
   * of the services page, and the hostname dropdown already establishes that
   * per-row status checks are the thing to avoid.
   *
   * No sudo. `systemctl show` is world-readable; see unitState.ts for why this
   * is not `systemctl status`. Degrades to {} on any failure (missing binary,
   * timeout, garbage), so a page renders deploy state with neutral liveness
   * rather than erroring.
   */
  async readUnitStates(units) {
    if (units.length === 0) return {};
    try {
      const { stdout } = await run(
        "/usr/bin/systemctl",
        ["show", ...units, "-p", UNIT_SHOW_PROPERTIES.join(",")],
        { timeoutMs: STATUS_READ_TIMEOUT_MS },
      );
      return parseUnitShowOutput(stdout);
    } catch {
      return {};
    }
  },

  /**
   * One declared container service's state, via lychee-ops'
   * lyly-admin-resource-status (sudo-pinned: docker is not world-usable). Empty
   * output means no compose file there, which the shared parser reads as
   * not-created. Output goes through containerStatus.ts like the site path
   * does; a second parser would be a second thing to keep correct against
   * compose versions. Degrades to "unknown" on any failure, never throws: the
   * services page must not error, and an unreadable state is not evidence of
   * a stopped container.
   */
  async readResourceStatus(project) {
    try {
      const { stdout } = await run(
        "sudo",
        ["/usr/local/sbin/lyly-admin-resource-status", project],
        { timeoutMs: STATUS_READ_TIMEOUT_MS },
      );
      return parseServiceStatusOutput(stdout);
    } catch {
      return "unknown";
    }
  },

  /**
   * The reconciler timer's last and next firing. `list-timers`, not `show`:
   * the timer is monotonic, so `show` leaves NextElapseUSecRealtime empty.
   * No sudo. A non-timer, a missing unit, a timeout or garbage all degrade to
   * no schedule; liveness comes from readUnitStates and is unaffected.
   *
   * list-timers omits inactive timers unless given --all, so a stopped timer
   * also yields no schedule, not even `last`. That is acceptable (liveness
   * shows it as exited) and is not a bug to fix with --all, which would list
   * every timer on the host for one field.
   */
  async readTimerSchedule(timer) {
    try {
      const { stdout } = await run(
        "/usr/bin/systemctl",
        ["list-timers", timer, "--no-pager", "--output=json"],
        { timeoutMs: STATUS_READ_TIMEOUT_MS },
      );
      return parseTimerSchedule(stdout);
    } catch {
      return { next: null, last: null };
    }
  },

  /**
   * The app's one write capability: change a version tag in a declaration in
   * lychee-resources, which the reconciler then applies. No sudo. The app
   * writes a request and never the thing that acts on it; see declarationWriter.ts.
   */
  writeDeclarationTag(name, tag) {
    return writeDeclarationTag(name, tag, {
      git: (args, options) => run("git", args, options),
    });
  },
};
