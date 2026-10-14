import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import { CLIENTS_FILE } from "./platform";

process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("x", 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";
const PAL = "palworld-palchuds";

// Short root: a Unix socket path is limited to ~104 bytes on macOS.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lca-"));
after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

let n = 0;
function freshDir(): string {
  const dir = path.join(ROOT, String(n++));
  fs.mkdirSync(dir);
  return dir;
}

function collect(): { log: (m: string) => void; lines: string[] } {
  const lines: string[] = [];
  return { lines, log: (m) => lines.push(m) };
}

async function makeDeps(): Promise<Deps> {
  const { createBackup } = await import("./backup");
  const { createLogger } = await import("./logger");
  const { createFakes } = await import("../dev/fakes");
  const fakes = createFakes({}, { opRun: { delayMs: 60_000 } });
  fakes.fs.writeFile(
    INVENTORY_PATH,
    JSON.stringify({
      generated: "2026-10-13T00:00:00Z",
      services: [{ name: PAL, unit: `${PAL}.service`, group: "service", reconciled: false, actions: ["start", "stop", "restart", "update"] }],
    }),
  );
  return { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
}

/** A socket file nothing listens on: what a killed lychee-admin leaves. libuv
 *  unlinks a pipe on close, so listen elsewhere, move it, then close. */
async function staleSocketAt(target: string): Promise<void> {
  const elsewhere = `${target}.tmp`;
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(elsewhere, resolve));
  fs.renameSync(elsewhere, target);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.ok(fs.lstatSync(target).isSocket());
}

function request(socketPath: string, method: string, urlPath: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, method, path: urlPath }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    req.end();
  });
}

const closeAll = (servers: (http.Server | null)[]) =>
  Promise.all(servers.map((s) => (s ? new Promise<void>((r) => s.close(() => r())) : undefined)));

describe("readClients", () => {
  async function load() {
    const { createFakes } = await import("../dev/fakes");
    const { readClients } = await import("./clients");
    return { fakes: createFakes(), readClients };
  }

  test("reads clients.json once into names and grants", async () => {
    const { fakes, readClients } = await load();
    fakes.fs.writeFile(CLIENTS_FILE, JSON.stringify({ clients: [{ name: "swee", grants: { [PAL]: ["restart", "start"] } }] }));
    const c = collect();
    const clients = readClients(fakes.fs, c.log);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].name, "swee");
    assert.deepEqual({ ...clients[0].grants }, { [PAL]: ["restart", "start"] });
    assert.deepEqual(c.lines, []);
  });

  test("grants carry no inherited keys", async () => {
    const { fakes, readClients } = await load();
    fakes.fs.writeFile(CLIENTS_FILE, JSON.stringify({ clients: [{ name: "swee", grants: {} }] }));
    const [client] = readClients(fakes.fs, collect().log);
    assert.equal((client.grants as Record<string, unknown>).constructor, undefined);
  });

  test("a missing file, invalid JSON or a bad shape is logged and gives no clients", async () => {
    const bad: (string | null)[] = [
      null,
      "{not json",
      "[]",
      JSON.stringify({}),
      JSON.stringify({ clients: {} }),
      JSON.stringify({ clients: [{ name: "../swee", grants: {} }] }),
      JSON.stringify({ clients: [{ name: "Swee", grants: {} }] }),
      JSON.stringify({ clients: [{ name: "9bot", grants: {} }] }),
      JSON.stringify({ clients: [{ name: "a".repeat(32), grants: {} }] }),
      JSON.stringify({ clients: [{ name: "swee", grants: { [PAL]: ["rm"] } }] }),
      JSON.stringify({ clients: [{ name: "swee", grants: { "../x": ["start"] } }] }),
      JSON.stringify({ clients: [{ name: "swee", grants: { [PAL]: "start" } }] }),
      JSON.stringify({ clients: [{ name: "swee" }] }),
      JSON.stringify({ clients: [{ name: "swee", grants: {}, token: "x" }] }),
      JSON.stringify({ clients: [{ name: "swee", grants: {} }, { name: "swee", grants: {} }] }),
    ];
    for (const raw of bad) {
      const { fakes, readClients } = await load();
      if (raw !== null) fakes.fs.writeFile(CLIENTS_FILE, raw);
      const c = collect();
      assert.deepEqual(readClients(fakes.fs, c.log), [], String(raw));
      assert.equal(c.lines.length, 1, String(raw));
      assert.match(c.lines[0], /clients\.json/);
    }
  });

  test("callerFor names the client and carries its grants", async () => {
    const { callerFor } = await import("./clients");
    const grants = { [PAL]: ["start" as const] };
    assert.deepEqual(callerFor({ name: "swee", grants }), { kind: "client", name: "swee", grants });
  });
});

describe("listenClientSocket", () => {
  async function api() {
    const { createApiApp } = await import("../api/router");
    const { callerFor } = await import("./clients");
    return createApiApp(await makeDeps(), callerFor({ name: "swee", grants: {} }));
  }

  test("listens and sets the socket to 0666", async () => {
    const { listenClientSocket } = await import("./clients");
    const sock = path.join(freshDir(), "api.sock");
    const server = await listenClientSocket(await api(), sock, collect().log);
    assert.ok(server);
    assert.ok(fs.lstatSync(sock).isSocket());
    assert.equal(fs.lstatSync(sock).mode & 0o777, 0o666);
    await closeAll([server]);
  });

  test("a stale socket at the path is replaced", async () => {
    const { listenClientSocket } = await import("./clients");
    const sock = path.join(freshDir(), "api.sock");
    await staleSocketAt(sock);
    const c = collect();
    const server = await listenClientSocket(await api(), sock, c.log);
    assert.ok(server, c.lines.join("\n"));
    const r = await request(sock, "GET", "/nothing-here");
    assert.equal(r.status, 404);
    await closeAll([server]);
  });

  test("a non-socket file at the socket path is left alone", async () => {
    const { listenClientSocket } = await import("./clients");
    const dir = freshDir();
    const target = path.join(dir, "target");
    fs.writeFileSync(target, "precious\n");
    const cases: [string, string, (p: string) => void][] = [
      ["regular file", "file.sock", (p) => fs.writeFileSync(p, "planted\n")],
      ["symlink", "link.sock", (p) => fs.symlinkSync(target, p)],
      ["directory", "dir.sock", (p) => fs.mkdirSync(p)],
    ];
    for (const [label, name, plant] of cases) {
      const sock = path.join(dir, name);
      plant(sock);
      const before = fs.lstatSync(sock);
      const c = collect();
      const server = await listenClientSocket(await api(), sock, c.log);
      assert.equal(server, null, label);
      const now = fs.lstatSync(sock);
      assert.equal(now.ino, before.ino, label);
      assert.equal(now.mode, before.mode, label);
      assert.equal(c.lines.length, 1, label);
      assert.match(c.lines[0], /not a socket/, label);
    }
    assert.equal(fs.readFileSync(path.join(dir, "file.sock"), "utf8"), "planted\n");
    assert.equal(fs.readFileSync(target, "utf8"), "precious\n");
  });

  test("a missing directory is logged and skipped", async () => {
    const { listenClientSocket } = await import("./clients");
    const sock = path.join(ROOT, "no-such-client", "api.sock");
    const c = collect();
    assert.equal(await listenClientSocket(await api(), sock, c.log), null);
    assert.equal(c.lines.length, 1);
    assert.match(c.lines[0], /directory/);
    assert.equal(fs.existsSync(path.dirname(sock)), false);
  });
});

describe("startClientSockets", () => {
  test("a missing client directory is skipped and the app still starts", async () => {
    const { startClientSockets } = await import("./clients");
    const root = freshDir();
    fs.mkdirSync(path.join(root, "swee"));
    const c = collect();
    const servers = await startClientSockets(
      await makeDeps(),
      [
        { name: "ghost", grants: {} },
        { name: "swee", grants: { [PAL]: ["restart"] } },
      ],
      (name) => path.join(root, name, "api.sock"),
      c.log,
    );
    assert.equal(servers.length, 1);
    assert.equal(c.lines.length, 1);
    assert.match(c.lines[0], /ghost/);
    const r = await request(path.join(root, "swee", "api.sock"), "GET", `/v1/units/${PAL}/actions/restart`);
    assert.equal(r.status, 200);
    await closeAll(servers);
  });

  test("end to end over a real Unix socket: POST is 202 with the state, GET is the state and log tail", async () => {
    const { startClientSockets } = await import("./clients");
    const root = freshDir();
    fs.mkdirSync(path.join(root, "swee"));
    const deps = await makeDeps();
    const servers = await startClientSockets(
      deps,
      [{ name: "swee", grants: { [PAL]: ["restart"] } }],
      (name) => path.join(root, name, "api.sock"),
      collect().log,
    );
    const sock = path.join(root, "swee", "api.sock");
    const posted = await request(sock, "POST", `/v1/units/${PAL}/actions/restart`);
    assert.equal(posted.status, 202);
    assert.deepEqual(posted.body, { unit: PAL, action: "restart", state: "running", logTail: "" });

    const got = await request(sock, "GET", `/v1/units/${PAL}/actions/restart`);
    assert.equal(got.status, 200);
    const body = got.body as Record<string, unknown>;
    assert.equal(body.state, "running");
    assert.match(body.logTail as string, /restart palworld-palchuds: started/);

    // The audit names the socket's client.
    const audit = deps.fs.readFile(process.env.LOG_FILE as string);
    assert.match(audit, /"caller":"client:swee"/);

    const refused = await request(sock, "POST", `/v1/units/${PAL}/actions/update`);
    assert.equal(refused.status, 403);
    await closeAll(servers);
  });
});

describe("a client socket server cannot crash the process", () => {
  test("a later server error is logged, not thrown", async () => {
    const { listenClientSocket } = await import("./clients");
    const root = freshDir();
    fs.mkdirSync(path.join(root, "swee"));
    const sock = path.join(root, "swee", "api.sock");
    const c = collect();
    const { createApiApp } = await import("../api/router");
    const server = await listenClientSocket(createApiApp(await makeDeps(), { kind: "client", name: "swee", grants: {} }), sock, c.log);
    assert.ok(server);
    try {
      assert.doesNotThrow(() => server.emit("error", new Error("EMFILE: too many open files")));
      assert.equal(c.lines.length, 1);
      assert.match(c.lines[0], /EMFILE/);
    } finally {
      await closeAll([server]);
    }
  });
});
