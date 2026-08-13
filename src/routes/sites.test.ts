import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";

// --- Fixture layout -------------------------------------------------------
// Every path config reads is redirected into one temp directory. This must
// happen before the app modules are imported, because src/config.ts reads
// process.env when it is evaluated (see Step 1).

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "lyly-admin-test-"));
const CADDYFILE = path.join(TEMP_ROOT, "Caddyfile");
const TUNNEL_CONFIG = path.join(TEMP_ROOT, "sites-config.yml");
const SITES_ROOT = path.join(TEMP_ROOT, "www");
const PASSWORD = "test-password";

process.env.MOCK_SYSTEM = "true";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lyly.dev";
process.env.PORT = "8787";
process.env.CADDYFILE_PATH = CADDYFILE;
process.env.TUNNEL_CONFIG_PATH = TUNNEL_CONFIG;
process.env.SITES_ROOT = SITES_ROOT;
process.env.BACKUP_DIR = path.join(TEMP_ROOT, "backups");
process.env.LOG_FILE = path.join(TEMP_ROOT, "actions.log");

const SEED_CADDYFILE = `{
\tauto_https off
}

http://blog.lyly.dev {
\troot * ${SITES_ROOT}/blog.lyly.dev
\tfile_server
}

http://api.lyly.dev {
\treverse_proxy localhost:4000
}

http://lychee.local {
\troot * /var/www/lychee.local
\tfile_server
}
`;

const SEED_TUNNEL = `tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e
ingress:
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - hostname: api.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

function writeFixtures(caddyfile = SEED_CADDYFILE, tunnel = SEED_TUNNEL): void {
  fs.rmSync(SITES_ROOT, { recursive: true, force: true });
  fs.mkdirSync(SITES_ROOT, { recursive: true });
  fs.writeFileSync(CADDYFILE, caddyfile);
  fs.writeFileSync(TUNNEL_CONFIG, tunnel);
}

// --- Server harness -------------------------------------------------------

let server: Server;
let baseUrl: string;

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

function request(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { Authorization: AUTH, ...(init.headers ?? {}) },
  });
}

function form(fields: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  };
}

// This repo's @types/node (via undici-types) types Response#json() as
// Promise<unknown> rather than lib.dom's Promise<any>, so reading a field
// off the parsed body needs a narrowing helper purely to satisfy tsc — no
// runtime behavior here differs from calling response.json() directly.
async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

before(async () => {
  writeFixtures();

  // Dynamic imports: config must not be evaluated until the assignments
  // above have run. Task 7 replaces this block with createApp(deps).
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { realFileSystem } = await import("../lib/fileSystem");
  const { realSystemCommands } = await import("../lib/systemCommands");

  const app = createApp({
    commands: realSystemCommands,
    fs: realFileSystem,
    backup: createBackup(realFileSystem),
    logger: createLogger(realFileSystem),
  });

  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
  fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  writeFixtures();
});

// --- Tests ----------------------------------------------------------------

describe("authentication", () => {
  test("rejects an unauthenticated request", async () => {
    const response = await fetch(`${baseUrl}/`);
    assert.equal(response.status, 401);
  });
});

describe("GET /", () => {
  test("lists managed sites", async () => {
    const body = await (await request("/")).text();
    assert.match(body, /blog\.lyly\.dev/);
    assert.match(body, /api\.lyly\.dev/);
  });

  test("omits hostnames outside the managed domain", async () => {
    const body = await (await request("/")).text();
    assert.doesNotMatch(body, /lychee\.local/);
  });
});

describe("POST /sites — static", () => {
  test("adds a Caddyfile block, an ingress rule, a directory, and a placeholder page", async () => {
    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      added: true,
      hostname: "new.lyly.dev",
      type: "static",
      target: `${SITES_ROOT}/new.lyly.dev`,
      framework: "none",
      tunnelId: "c7081f91-61c2-476b-8505-42d219bb6d7e",
    });

    assert.match(fs.readFileSync(CADDYFILE, "utf8"), /http:\/\/new\.lyly\.dev \{/);
    assert.match(fs.readFileSync(TUNNEL_CONFIG, "utf8"), /hostname: new\.lyly\.dev/);
    assert.match(
      fs.readFileSync(path.join(SITES_ROOT, "new.lyly.dev", "index.html"), "utf8"),
      /Site created by lyly-admin/,
    );
  });

  test("rejects a hostname outside the managed domain", async () => {
    const response = await request("/sites", form({ hostname: "evil.example.com", type: "static" }));
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /must be a subdomain of lyly\.dev/);
  });

  test("rejects a hostname that already exists", async () => {
    const response = await request("/sites", form({ hostname: "blog.lyly.dev", type: "static" }));
    assert.equal(response.status, 500);
    assert.match((await json<{ error: string }>(response)).error, /already exists in the Caddyfile/);
  });
});

describe("POST /sites — reverse proxy", () => {
  test("writes the Next.js scaffold and both marker comments", async () => {
    const response = await request(
      "/sites",
      form({ hostname: "app.lyly.dev", type: "reverse-proxy", port: "3000", framework: "nextjs", healthcheckPath: "/api/health" }),
    );
    assert.equal(response.status, 200);
    assert.equal((await json<{ framework: string }>(response)).framework, "nextjs");

    const caddyfile = fs.readFileSync(CADDYFILE, "utf8");
    assert.match(caddyfile, /# lyly-admin-framework: nextjs/);
    assert.match(caddyfile, /# lyly-admin-healthcheck: \/api\/health/);

    const siteDir = path.join(SITES_ROOT, "app.lyly.dev");
    assert.match(fs.readFileSync(path.join(siteDir, "Dockerfile"), "utf8"), /HEALTHCHECK .*\/api\/health/);
    assert.match(fs.readFileSync(path.join(siteDir, "docker-compose.yml"), "utf8"), /127\.0\.0\.1:3000:3000/);
    assert.ok(fs.existsSync(path.join(siteDir, ".dockerignore")));
  });

  test("creates no directory for a reverse proxy with no framework", async () => {
    const response = await request("/sites", form({ hostname: "plain.lyly.dev", type: "reverse-proxy", port: "5000" }));
    assert.equal(response.status, 200);
    assert.equal(fs.existsSync(path.join(SITES_ROOT, "plain.lyly.dev")), false);
  });

  test("rejects a port already used by another reverse-proxy site", async () => {
    const response = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy", port: "4000" }));
    assert.equal(response.status, 500);
    assert.match((await json<{ error: string }>(response)).error, /already used by api\.lyly\.dev/);
  });

  test("rejects a reserved port", async () => {
    const response = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy", port: "2019" }));
    assert.equal(response.status, 500);
    assert.match((await json<{ error: string }>(response)).error, /reserved/);
  });

  test("rejects a missing or out-of-range port", async () => {
    const missing = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy" }));
    assert.equal(missing.status, 400);
    const tooBig = await request("/sites", form({ hostname: "clash.lyly.dev", type: "reverse-proxy", port: "70000" }));
    assert.equal(tooBig.status, 400);
  });

  test("rejects a malformed healthcheck path", async () => {
    const response = await request(
      "/sites",
      form({ hostname: "app.lyly.dev", type: "reverse-proxy", port: "3000", framework: "nextjs", healthcheckPath: "no-leading-slash" }),
    );
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /is not a valid healthcheck path/);
  });
});

describe("POST /sites/:hostname/delete", () => {
  test("removes the Caddyfile block and the ingress rule", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { removed: true, needsFileConfirm: false });

    assert.doesNotMatch(fs.readFileSync(CADDYFILE, "utf8"), /http:\/\/blog\.lyly\.dev \{/);
    assert.doesNotMatch(fs.readFileSync(TUNNEL_CONFIG, "utf8"), /hostname: blog\.lyly\.dev/);
  });

  test("reports the path to confirm when file deletion was requested", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));
    assert.deepEqual(await response.json(), {
      removed: true,
      needsFileConfirm: true,
      sitePath: `${SITES_ROOT}/blog.lyly.dev`,
    });
  });

  test("does not delete files as part of the same request", async () => {
    fs.mkdirSync(path.join(SITES_ROOT, "blog.lyly.dev"), { recursive: true });
    fs.writeFileSync(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));

    assert.equal(fs.existsSync(path.join(SITES_ROOT, "blog.lyly.dev", "index.html")), true);
  });
});

describe("POST /sites/:hostname/delete-files", () => {
  test("removes the site directory", async () => {
    fs.mkdirSync(path.join(SITES_ROOT, "blog.lyly.dev"), { recursive: true });
    fs.writeFileSync(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    const response = await request("/sites/blog.lyly.dev/delete-files", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.equal(fs.existsSync(path.join(SITES_ROOT, "blog.lyly.dev")), false);
  });

  test("refuses a hostname outside the managed domain", async () => {
    const response = await request("/sites/evil.example.com/delete-files", form({}));
    assert.equal(response.status, 400);
  });
});

describe("rollback", () => {
  test("restores the Caddyfile when the tunnel edit fails during add", async () => {
    // A tunnel config with no `ingress` key makes addIngressRule throw at
    // step 4 — after the Caddyfile has been written, before caddy validate.
    writeFixtures(SEED_CADDYFILE, "tunnel: c7081f91-61c2-476b-8505-42d219bb6d7e\n");
    const before = fs.readFileSync(CADDYFILE, "utf8");

    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));

    assert.equal(response.status, 500);
    assert.equal(fs.readFileSync(CADDYFILE, "utf8"), before);
  });

  test("restores the Caddyfile when the tunnel edit fails during remove", async () => {
    // lychee.local has a Caddyfile block but deliberately no ingress rule,
    // so removeIngressRule throws after the Caddyfile has been rewritten.
    const before = fs.readFileSync(CADDYFILE, "utf8");

    const response = await request("/sites/lychee.local/delete", form({}));

    assert.equal(response.status, 500);
    assert.equal(fs.readFileSync(CADDYFILE, "utf8"), before);
  });
});

describe("audit log", () => {
  test("records a line for a successful add", async () => {
    await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
    const log = fs.readFileSync(path.join(TEMP_ROOT, "actions.log"), "utf8");
    const entry = JSON.parse(log.trim().split("\n").at(-1)!);
    assert.equal(entry.action, "add-site");
    assert.equal(entry.hostname, "new.lyly.dev");
    assert.ok(entry.timestamp);
  });
});
