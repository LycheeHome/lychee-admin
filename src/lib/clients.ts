// The clients that may call host operations, and the Unix socket each one is
// served on. lychee-ops declares the clients in clients.json and creates each
// client's directory (0750 lychee-admin:<client>-api); lychee-admin creates the
// socket inside it. A request's socket is its caller: there are no tokens.

import nodeFs from "node:fs";
import type { RequestListener, Server } from "node:http";
import http from "node:http";
import path from "node:path";
import type { Deps } from "../deps";
import { createApiApp } from "../api/router";
import type { FileSystem } from "./fileSystem";
import type { Caller } from "./hostOperations";
import { CLIENTS_FILE, HOST_ACTIONS, type HostAction, isBareName } from "./platform";

export interface ClientConfig {
  name: string;
  grants: Record<string, HostAction[]>;
}

export type Log = (message: string) => void;

const defaultLog: Log = (m) => console.error(m);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Throws with the reason when `raw` is not exactly the A-OPS-1 shape. */
function parseClients(raw: string): ClientConfig[] {
  const doc: unknown = JSON.parse(raw);
  if (!isObject(doc) || !Array.isArray(doc.clients)) throw new Error("expected {\"clients\": [...]}");
  const seen = new Set<string>();
  return doc.clients.map((c: unknown, i: number) => {
    if (!isObject(c)) throw new Error(`clients[${i}] is not an object`);
    const extra = Object.keys(c).filter((k) => k !== "name" && k !== "grants");
    if (extra.length) throw new Error(`clients[${i}] has unexpected keys: ${extra.join(", ")}`);
    const name = c.name;
    if (typeof name !== "string" || !isBareName(name)) throw new Error(`clients[${i}] has an invalid name`);
    if (seen.has(name)) throw new Error(`client ${name} is declared twice`);
    seen.add(name);
    if (!isObject(c.grants)) throw new Error(`client ${name} has no grants object`);
    // No prototype: a unit named like an Object.prototype member must not
    // read back as a grant.
    const grants: Record<string, HostAction[]> = Object.create(null);
    for (const [unit, actions] of Object.entries(c.grants)) {
      if (!isBareName(unit)) throw new Error(`client ${name} grants an invalid unit name`);
      if (!Array.isArray(actions) || !actions.every((a) => (HOST_ACTIONS as readonly unknown[]).includes(a))) {
        throw new Error(`client ${name} grants something other than ${HOST_ACTIONS.join("/")} on ${unit}`);
      }
      grants[unit] = [...new Set(actions as HostAction[])];
    }
    return { name, grants };
  });
}

/**
 * Read once at start: lychee-ops restarts lychee-admin when the file changes.
 * Missing, unreadable or invalid → logged, and no client is served; the app
 * itself still starts. Never a partial list: a file that is wrong anywhere is
 * not trusted anywhere.
 */
export function readClients(fs: FileSystem, log: Log = defaultLog, file: string = CLIENTS_FILE): ClientConfig[] {
  try {
    return parseClients(fs.readFile(file));
  } catch (error) {
    log(`lychee-admin: no client sockets: could not use ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export function callerFor(client: ClientConfig): Caller {
  return { kind: "client", name: client.name, grants: client.grants };
}

/**
 * Serve `app` on a Unix socket at `socketPath`, or skip with a log line and
 * resolve null. Whatever is at the path is removed only if lstat says it is a
 * socket — a stale one from the last run. Anything else (a file, a symlink, a
 * directory: a mistake, or something planted) is never touched, and the
 * client is not served. The socket is 0666 because lychee-admin is not in the
 * client's group and cannot hand the file to it; the 0750 directory is what
 * restricts who reaches it.
 */
export async function listenClientSocket(
  app: RequestListener,
  socketPath: string,
  log: Log = defaultLog,
): Promise<Server | null> {
  const skip = (reason: string) => {
    log(`lychee-admin: not serving ${socketPath}: ${reason}`);
    return null;
  };
  const dir = path.dirname(socketPath);
  try {
    if (!nodeFs.statSync(dir).isDirectory()) return skip(`${dir} is not a directory`);
  } catch (error) {
    return skip(`its directory ${dir} is not there (${(error as NodeJS.ErrnoException).code ?? error})`);
  }
  let existing: nodeFs.Stats | null = null;
  try {
    existing = nodeFs.lstatSync(socketPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return skip(`could not lstat it (${(error as NodeJS.ErrnoException).code ?? error})`);
    }
  }
  if (existing) {
    if (!existing.isSocket()) return skip("something that is not a socket is there; leaving it alone");
    try {
      nodeFs.unlinkSync(socketPath);
    } catch (error) {
      return skip(`could not remove the stale socket (${(error as NodeJS.ErrnoException).code ?? error})`);
    }
  }

  const server = http.createServer(app);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        // After listen, an error (EMFILE on accept, say) must be logged, not
        // thrown: an unhandled 'error' would take the operator's app down.
        server.on("error", (e) => log(`lychee-admin: client socket ${socketPath}: ${e.message}`));
        resolve();
      });
    });
  } catch (error) {
    return skip(`listen failed (${(error as NodeJS.ErrnoException).code ?? error})`);
  }
  try {
    nodeFs.chmodSync(socketPath, 0o666);
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return skip(`chmod 0666 failed (${(error as NodeJS.ErrnoException).code ?? error})`);
  }
  return server;
}

/** One API app and socket per client. A client that cannot be served is
 *  logged and skipped; the others, and the network app, are unaffected. */
export async function startClientSockets(
  deps: Deps,
  clients: ClientConfig[],
  socketPathFor: (client: string) => string,
  log: Log = defaultLog,
): Promise<Server[]> {
  const servers: Server[] = [];
  for (const client of clients) {
    let socketPath: string;
    try {
      socketPath = socketPathFor(client.name);
    } catch (error) {
      log(`lychee-admin: not serving client ${client.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const server = await listenClientSocket(createApiApp(deps, callerFor(client)), socketPath, (m) =>
      log(`${m} (client ${client.name})`),
    );
    if (server) servers.push(server);
  }
  return servers;
}
