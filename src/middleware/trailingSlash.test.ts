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
    clientDocument: "<!doctype html><title>doc</title>",
  };
  server = createApp(deps).listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as { port: number }).port;
});

after(() => server.close());

/** A raw request, so the path is sent exactly as written and redirects are not followed. */
function request(method: string, path: string, auth = true): Promise<{ status: number; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers: auth ? { Authorization: AUTH } : {} },
      (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("trailing-slash URLs", () => {
  test("a page with a trailing slash is sent to the page without it", async () => {
    assert.deepEqual(await request("GET", "/services/"), { status: 308, location: "/services" });
    assert.deepEqual(await request("GET", "/sites/app.lychee.land/"), { status: 308, location: "/sites/app.lychee.land" });
  });

  test("the query string survives the redirect", async () => {
    assert.deepEqual(await request("GET", "/sites/app.lychee.land/?created=1&x=1"), {
      status: 308,
      location: "/sites/app.lychee.land?created=1&x=1",
    });
  });

  test("several trailing slashes collapse to none", async () => {
    assert.deepEqual(await request("GET", "/services///"), { status: 308, location: "/services" });
  });

  test("HEAD redirects too, and an API path is treated the same", async () => {
    assert.deepEqual(await request("HEAD", "/services/"), { status: 308, location: "/services" });
    assert.deepEqual(await request("GET", "/api/rail/"), { status: 308, location: "/api/rail" });
  });

  test("/ itself is never redirected", async () => {
    assert.equal((await request("GET", "/")).status, 200);
  });

  test("a POST is never redirected", async () => {
    const res = await request("POST", "/sites/preview/");
    assert.notEqual(res.status, 308);
    assert.equal(res.location, undefined);
  });

  test("a path that would become protocol-relative is not redirected", async () => {
    for (const path of ["//evil.example/", "///evil.example/", "/\\evil.example/"]) {
      const res = await request("GET", path);
      assert.notEqual(res.status, 308, `${path} redirected to ${res.location}`);
      assert.ok(!res.location?.startsWith("//") && !res.location?.startsWith("/\\"), `${path} → ${res.location}`);
    }
  });

  test("the client bundle's own directory is left to the static server", async () => {
    // express.static answers /client/ before this middleware; a redirect to
    // /client here would loop with its redirect back to /client/.
    const res = await request("GET", "/client/");
    assert.notEqual(res.location, "/client");
  });

  test("stays behind basic auth", async () => {
    const res = await request("GET", "/services/", false);
    assert.equal(res.status, 401);
    assert.equal(res.location, undefined);
  });
});
