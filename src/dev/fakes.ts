import path from "node:path";
import { config } from "../config";
import type { FileSystem } from "../lib/fileSystem";
import type { SystemCommands } from "../lib/systemCommands";

/**
 * Collapses both separators to "/" so that a path built with path.posix.join
 * and the same path built with native path.join land on one map key. On a
 * real filesystem the difference is cosmetic; against a Map it would create
 * a silent duplicate on Windows.
 *
 * Assumes POSIX-rooted inputs (e.g. "/var/www/x") — this app's paths always
 * are, so a Windows drive root like "C:\\" (which this would collapse to
 * "C:") is unreachable here and left unhandled.
 */
function normalizePath(target: string): string {
  const collapsed = target.split(/[\\/]+/).join("/");
  return collapsed.length > 1 ? collapsed.replace(/\/$/, "") : collapsed;
}

export function createInMemoryFileSystem(): FileSystem & {
  hasFile(target: string): boolean;
  hasDir(target: string): boolean;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  function readFile(target: string): string {
    const key = normalizePath(target);
    const content = files.get(key);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${key}'`) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  function writeFile(target: string, content: string): void {
    files.set(normalizePath(target), content);
  }

  function mkdir(target: string): void {
    dirs.add(normalizePath(target));
  }

  function appendFile(target: string, content: string): void {
    const key = normalizePath(target);
    files.set(key, (files.get(key) ?? "") + content);
  }

  function copyFile(source: string, destination: string): void {
    files.set(normalizePath(destination), readFile(source));
  }

  function rmRecursive(target: string): void {
    const key = normalizePath(target);
    const prefix = `${key}/`;
    for (const existing of [...files.keys()]) {
      if (existing === key || existing.startsWith(prefix)) files.delete(existing);
    }
    for (const existing of [...dirs]) {
      if (existing === key || existing.startsWith(prefix)) dirs.delete(existing);
    }
  }

  function hasFile(target: string): boolean {
    return files.has(normalizePath(target));
  }

  function hasDir(target: string): boolean {
    return dirs.has(normalizePath(target));
  }

  return { readFile, writeFile, mkdir, appendFile, copyFile, rmRecursive, hasFile, hasDir };
}

/**
 * Fakes for both outward-facing interfaces, sharing one store — the fake
 * createSiteDirectory must create its directory in the same filesystem the
 * routes then write scaffold files into.
 *
 * `overrides` lets a test replace one or more commands (e.g. to make
 * `restartCloudflared` reject) without having to reimplement the rest —
 * a minimal fault seam for exercising failure-branch behavior.
 */
export function createFakes(overrides: Partial<SystemCommands> = {}): {
  fs: ReturnType<typeof createInMemoryFileSystem>;
  commands: SystemCommands;
} {
  const fs = createInMemoryFileSystem();

  const commands: SystemCommands = {
    validateCaddyfile: (caddyfilePath) =>
      Promise.resolve({ stdout: `[mock] validated ${caddyfilePath}`, stderr: "" }),

    reloadCaddy: () => Promise.resolve({ stdout: "[mock] reloaded caddy", stderr: "" }),

    restartCloudflared: () => Promise.resolve({ stdout: "[mock] restarted cloudflared-sites", stderr: "" }),

    createSiteDirectory: (hostname) => {
      const directory = path.posix.join(config.sitesRoot, hostname);
      fs.mkdir(directory);
      return Promise.resolve({ stdout: `[mock] created ${directory}`, stderr: "" });
    },

    writeManagedConfig: (targetPath, content) => {
      fs.writeFile(targetPath, content);
      return Promise.resolve();
    },

    checkContainerStatus: () => Promise.resolve({ state: "running", health: "healthy" }),
    // Stub; the seed-backed version replaces this.
    readUnitStates: () => Promise.resolve({}),
    readTimerSchedule: () => Promise.resolve({ next: null, last: null }),
  };

  return { fs, commands: { ...commands, ...overrides } };
}
