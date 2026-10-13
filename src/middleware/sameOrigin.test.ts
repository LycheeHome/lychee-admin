import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

let server: Server;
let port: number;
let logLines: () => Array<Record<string, string>>;

before(async () => {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const fakes = createFakes({});
  const deps: Deps = {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  };
  const file = process.env.LOG_FILE as string;
  logLines = () =>
    fakes.fs.exists(file)
      ? fakes.fs.readFile(file).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, string>)
      : [];
  server = createApp(deps).listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  port = address.port;
});

after(async () => {
  server.close();
  await once(server, "close");
});

function send(method: string, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: { Authorization: AUTH, ...headers } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const post = (headers: Record<string, string>) => send("POST", "/no-such-route", headers);
const HOST = "admin.lychee.land";

describe("sameOrigin", () => {
  test("same-origin Sec-Fetch-Site passes", async () => {
    assert.notEqual((await post({ "Sec-Fetch-Site": "same-origin" })).status, 403);
  });
  test("Sec-Fetch-Site none passes", async () => {
    assert.notEqual((await post({ "Sec-Fetch-Site": "none" })).status, 403);
  });
  test("cross-site Sec-Fetch-Site is 403", async () => {
    const res = await post({ "Sec-Fetch-Site": "cross-site" });
    assert.equal(res.status, 403);
    assert.equal(res.body, "Cross-site request refused");
  });
  test("same-site (another subdomain) is 403", async () => {
    assert.equal((await post({ "Sec-Fetch-Site": "same-site" })).status, 403);
  });
  test("cross-site Sec-Fetch-Site is refused even with a matching Origin", async () => {
    assert.equal((await post({ "Sec-Fetch-Site": "cross-site", Host: HOST, Origin: `https://${HOST}` })).status, 403);
  });
  test("Origin host equal to Host passes", async () => {
    assert.notEqual((await post({ Host: "localhost:8787", Origin: "http://localhost:8787" })).status, 403);
  });
  test("same-origin POST via the HTTPS name passes", async () => {
    assert.notEqual((await post({ Host: HOST, Origin: `https://${HOST}` })).status, 403);
  });
  test("Origin from another host is 403", async () => {
    assert.equal((await post({ Host: HOST, Origin: "https://evil.example" })).status, 403);
  });
  test("Origin: null is 403", async () => {
    assert.equal((await post({ Host: HOST, Origin: "null" })).status, 403);
  });
  test("an unparsable Origin is 403", async () => {
    assert.equal((await post({ Host: HOST, Origin: "::not a url" })).status, 403);
  });
  test("neither header passes", async () => {
    assert.notEqual((await post({})).status, 403);
  });
  test("GET is never checked", async () => {
    const res = await send("GET", "/no-such-route", { "Sec-Fetch-Site": "cross-site" });
    assert.notEqual(res.status, 403);
  });
  test("a refusal writes one log line", async () => {
    const before = logLines().length;
    await post({ "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" });
    const added = logLines().slice(before);
    assert.equal(added.length, 1);
    assert.equal(added[0].action, "refused-cross-site");
    assert.match(added[0].detail ?? "", /POST \/no-such-route/);
    assert.match(added[0].detail ?? "", /cross-site/);
    assert.match(added[0].detail ?? "", /evil\.example/);
  });
  test("Remove is refused cross-site end to end", async () => {
    const res = await send("POST", "/sites/blog.lychee.land/delete", { "Sec-Fetch-Site": "cross-site" });
    assert.equal(res.status, 403);
    assert.ok(!logLines().some((l) => l.action === "remove-site" || l.action === "remove-site-failed"));
  });
});
