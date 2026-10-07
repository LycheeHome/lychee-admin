import path from "node:path";
import { config } from "../config";
import { toRowStatus } from "../lib/containerStatus";
import type { FileSystem } from "../lib/fileSystem";
import type { DeclarationSummary } from "../lib/siteResource";
import type { SystemCommands } from "../lib/systemCommands";
import { SEEDED_TIMER_SCHEDULE, seededResourceContainers, seededUnitStates } from "./seed";

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

  function exists(target: string): boolean {
    return hasFile(target) || hasDir(target);
  }

  return { readFile, writeFile, mkdir, appendFile, copyFile, rmRecursive, exists, hasFile, hasDir };
}

/**
 * Fakes for both outward-facing interfaces, sharing one store — the fake
 * createSiteDirectory must create its directory in the same filesystem the
 * routes then write a static site's placeholder page into.
 *
 * `overrides` lets a test replace one or more commands (e.g. to make
 * `restartCloudflared` reject) without having to reimplement the rest —
 * a minimal fault seam for exercising failure-branch behavior.
 *
 * `declarations` pre-populates the fake lychee-resources clone. Only the dev
 * server passes it (SEEDED_DECLARATIONS); tests start from an empty clone so
 * that no seeded port claim or name can change what they assert.
 */
export function createFakes(
  overrides: Partial<SystemCommands> = {},
  seed: { declarations?: DeclarationSummary[] } = {},
): {
  fs: ReturnType<typeof createInMemoryFileSystem>;
  commands: SystemCommands;
} {
  const fs = createInMemoryFileSystem();
  // Stands in for the lychee-resources clone, so attach/remove round-trip in
  // dev and in route tests. Mirrors the real writer's refusals that matter to
  // a caller (existing name, claimed port), not its validation.
  const declarations = new Map<string, DeclarationSummary>(
    (seed.declarations ?? []).map((d) => [d.name, { ...d }]),
  );

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

    readUnitStates: (units) =>
      Promise.resolve(
        Object.fromEntries(
          units.flatMap((u) => (u in seededUnitStates ? [[u, seededUnitStates[u]]] : [])),
        ),
      ),
    // Only seeded containers have state; for every other one "unknown" is the
    // honest neutral answer. The board and a site's page read the same map, so
    // dev mode can never show one container two ways.
    checkResourceContainerStatus: (project) =>
      Promise.resolve(seededResourceContainers[project] ?? { state: "unknown" }),
    readResourceStatus: (project) =>
      Promise.resolve(project in seededResourceContainers ? toRowStatus(seededResourceContainers[project]) : "unknown"),
    readTimerSchedule: () => Promise.resolve(SEEDED_TIMER_SCHEDULE),
    writeDeclarationTag: (name, tag) => {
      const decl = declarations.get(name);
      if (decl) {
        const base = decl.image.replace(/:[^:/]*$/, "");
        declarations.set(name, { ...decl, image: `${base}:${tag}` });
      }
      return Promise.resolve({ ok: true });
    },
    createSiteDeclaration: (name, repo, port) => {
      const existing = declarations.get(name);
      if (existing) {
        return Promise.resolve({
          ok: false,
          reason:
            existing.state === "absent"
              ? `${name}.yml already exists with state: absent; prune it from lychee-resources first.`
              : `A declaration named ${name}.yml already exists in lychee-resources.`,
        });
      }
      const claimant = [...declarations.values()].find((d) => d.port === port);
      if (claimant) {
        return Promise.resolve({ ok: false, reason: `Port ${port} is already claimed by ${claimant.name}.` });
      }
      declarations.set(name, { name, port, state: "running", image: `ghcr.io/lycheehome/${repo.trim().toLowerCase()}` });
      return Promise.resolve({ ok: true });
    },
    setDeclarationState: (name, state) => {
      const decl = declarations.get(name);
      if (!decl) return Promise.resolve({ ok: false, reason: `No declaration named ${name}.yml in lychee-resources.` });
      declarations.set(name, { ...decl, state });
      return Promise.resolve({ ok: true });
    },
    // Mirrors the refusals a caller branches on: missing, retired, tagged (with
    // its code, so the route's 409 is reachable in dev).
    changeSiteRepository: (name, repo) => {
      const decl = declarations.get(name);
      if (!decl) return Promise.resolve({ ok: false, reason: `No declaration named ${name}.yml in lychee-resources.` });
      if (decl.state === "absent") {
        return Promise.resolve({ ok: false, reason: `${name}.yml is retired (state: absent); its repository can't be changed.` });
      }
      if (/:[^:/]*$/.test(decl.image)) {
        return Promise.resolve({
          ok: false,
          code: "tagged",
          reason: `${name}.yml already has a tag: deployed images can't change repository; remove the site instead.`,
        });
      }
      declarations.set(name, { ...decl, image: `ghcr.io/lycheehome/${repo.trim().toLowerCase()}` });
      return Promise.resolve({ ok: true });
    },
    readDeclarations: () => Promise.resolve([...declarations.values()].map((d) => ({ ...d }))),
    // The fake clone is always readable and has no remote to pull from.
    refreshDeclarations: () => Promise.resolve(),
  };

  return { fs, commands: { ...commands, ...overrides } };
}
