import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { createInMemoryFileSystem } from "../dev/fakes";
import { withoutHeader } from "../dev/testHelpers";

// --- Fixture layout -------------------------------------------------------
// These must match what config resolves to, since nothing redirects them
// any more. This must happen before the app modules are imported, because
// src/config.ts reads process.env when it is evaluated (see Step 1).

const CADDYFILE = "/etc/caddy/Caddyfile";
const TUNNEL_CONFIG = "/etc/cloudflared/sites-config.yml";
const SITES_ROOT = "/var/www";
const LOG_FILE = "/var/log/lyly-admin/actions.log";
const PASSWORD = "test-password";

process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lyly.dev";
process.env.PORT = "8787";
process.env.LOG_FILE = LOG_FILE;
process.env.CADDYFILE_PATH = CADDYFILE;
process.env.TUNNEL_CONFIG_PATH = TUNNEL_CONFIG;
process.env.SITES_ROOT = SITES_ROOT;
process.env.BACKUP_DIR = "/etc/lyly-admin/backups";

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

const SEED_TUNNEL = `tunnel: 11111111-2222-3333-4444-555555555555
ingress:
  - hostname: blog.lyly.dev
    service: http://localhost:80
  - hostname: api.lyly.dev
    service: http://localhost:80
  - service: http_status:404
`;

let fakeFs: ReturnType<typeof createInMemoryFileSystem>;

function writeFixtures(caddyfile = SEED_CADDYFILE, tunnel = SEED_TUNNEL): void {
  fakeFs.rmRecursive(SITES_ROOT);
  fakeFs.mkdir(SITES_ROOT);
  fakeFs.writeFile(CADDYFILE, caddyfile);
  fakeFs.writeFile(TUNNEL_CONFIG, tunnel);
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
  // Dynamic imports: config must not be evaluated until the assignments
  // above have run.
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");

  const fakes = createFakes();
  fakeFs = fakes.fs;
  writeFixtures();

  const app = createApp({
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
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

  test("rejects a request with the correct username but the wrong password", async () => {
    const wrongAuth = `Basic ${Buffer.from("tester:wrong-password").toString("base64")}`;
    const response = await fetch(`${baseUrl}/`, { headers: { Authorization: wrongAuth } });
    assert.equal(response.status, 401);
  });
});

describe("GET /", () => {
  test("lists managed sites", async () => {
    const body = await (await request("/")).text();
    // Stripped of the header: it carries its own "sites" and "add site"
    // links on every page, so matching the whole body would no longer prove
    // a card rendered — it would pass off the header alone.
    const page = withoutHeader(body);
    assert.match(page, /blog\.lyly\.dev/);
    assert.match(page, /api\.lyly\.dev/);
  });

  test("omits hostnames outside the managed domain", async () => {
    const body = await (await request("/")).text();
    assert.doesNotMatch(body, /lychee\.local/);
  });
});

describe("status on the site list", () => {
  // "&#9679;" is the literal entity the pill span renders (see the pill
  // convention noted in src/views/html.test.ts) — a raw "●" character never
  // appears in this markup, so the regex matches the entity, not the glyph.
  test("reports each proxy site's status", async () => {
    const page = withoutHeader(await (await request("/")).text());
    // api.lyly.dev is the seeded plain proxy on port 4000. Nothing listens
    // there during the test, so the tcp check resolves either way — the
    // assertion is that a canonical status word reached the card at all.
    assert.match(page, /&#9679; (responding|not responding)/);
  });

  test("says nothing about a static site's liveness", async () => {
    const page = withoutHeader(await (await request("/")).text());
    const card = page.match(/<a href="\/sites\/blog\.lyly\.dev"[\s\S]*?<\/a>/)?.[0] ?? "";
    assert.ok(card, "expected a card for the static site");
    assert.doesNotMatch(card, /&#9679;/);
  });
});

describe("GET /sites/new", () => {
  test("serves the add-site form with port-conflict data", async () => {
    const response = await request("/sites/new");
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /id="add-site-form"/);
    assert.match(body, /id="port-owners-data"/);
    // Stripped of the header: its "sites"/"add site" links carry no
    // hostnames, so this doesn't change what the assertion below proves, but
    // it keeps this test consistent with the others that strip it.
    const page = withoutHeader(body);
    // 4000 is api.lyly.dev in the fixture; 8787 is lyly-admin's own PORT.
    assert.match(page, /api\.lyly\.dev/);
    assert.match(page, /8787/);
  });

  test("is not mistaken for a hostname by the detail route", async () => {
    const body = await (await request("/sites/new")).text();
    assert.doesNotMatch(body, /No managed site found/);
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
      // Derived from the seeded tunnel config's `tunnel:` key, not from an
      // environment variable that could drift from it.
      tunnelId: "11111111-2222-3333-4444-555555555555",
    });

    assert.match(fakeFs.readFile(CADDYFILE), /http:\/\/new\.lyly\.dev \{/);
    assert.match(fakeFs.readFile(TUNNEL_CONFIG), /hostname: new\.lyly\.dev/);
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "new.lyly.dev")), true);
    assert.match(
      fakeFs.readFile(path.join(SITES_ROOT, "new.lyly.dev", "index.html")),
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

    const caddyfile = fakeFs.readFile(CADDYFILE);
    assert.match(caddyfile, /# lyly-admin-framework: nextjs/);
    assert.match(caddyfile, /# lyly-admin-healthcheck: \/api\/health/);

    const siteDir = path.join(SITES_ROOT, "app.lyly.dev");
    assert.equal(fakeFs.hasDir(siteDir), true);
    assert.match(fakeFs.readFile(path.join(siteDir, "Dockerfile")), /HEALTHCHECK .*\/api\/health/);
    assert.match(fakeFs.readFile(path.join(siteDir, "docker-compose.yml")), /127\.0\.0\.1:3000:3000/);
    assert.ok(fakeFs.hasFile(path.join(siteDir, ".dockerignore")));
  });

  test("creates no directory for a reverse proxy with no framework", async () => {
    const response = await request("/sites", form({ hostname: "plain.lyly.dev", type: "reverse-proxy", port: "5000" }));
    assert.equal(response.status, 200);
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "plain.lyly.dev")), false);
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

    assert.doesNotMatch(fakeFs.readFile(CADDYFILE), /http:\/\/blog\.lyly\.dev \{/);
    assert.doesNotMatch(fakeFs.readFile(TUNNEL_CONFIG), /hostname: blog\.lyly\.dev/);
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
    fakeFs.mkdir(path.join(SITES_ROOT, "blog.lyly.dev"));
    fakeFs.writeFile(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));

    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "blog.lyly.dev", "index.html")), true);
  });
});

describe("POST /sites/:hostname/delete-files", () => {
  test("removes the site directory", async () => {
    fakeFs.mkdir(path.join(SITES_ROOT, "blog.lyly.dev"));
    fakeFs.writeFile(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    const response = await request("/sites/blog.lyly.dev/delete-files", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "blog.lyly.dev")), false);
    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "blog.lyly.dev", "index.html")), false);
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
    writeFixtures(SEED_CADDYFILE, "tunnel: 11111111-2222-3333-4444-555555555555\n");
    const before = fakeFs.readFile(CADDYFILE);

    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));

    assert.equal(response.status, 500);
    assert.equal(fakeFs.readFile(CADDYFILE), before);
  });

  test("restores the Caddyfile when the tunnel edit fails during remove", async () => {
    // lychee.local has a Caddyfile block but deliberately no ingress rule,
    // so removeIngressRule throws after the Caddyfile has been rewritten.
    const before = fakeFs.readFile(CADDYFILE);

    const response = await request("/sites/lychee.local/delete", form({}));

    assert.equal(response.status, 500);
    assert.equal(fakeFs.readFile(CADDYFILE), before);
  });

  test("does not roll back once Caddy has already reloaded, even if cloudflared then fails", async () => {
    // A failure point after reloadCaddy() has resolved is the one case the
    // !caddyReloaded guard exists for: the live server already matches the
    // edited files, so restoring the old content here would desync them the
    // other way. This needs its own app/server (a fake with a rejecting
    // restartCloudflared) rather than the shared before/after ones, since
    // every other test in this file needs restartCloudflared to succeed.
    const { createApp } = await import("../app");
    const { createBackup } = await import("../lib/backup");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");

    const fakes = createFakes({
      restartCloudflared: () => Promise.reject(new Error("cloudflared-sites restart failed")),
    });
    fakes.fs.mkdir(SITES_ROOT);
    fakes.fs.writeFile(CADDYFILE, SEED_CADDYFILE);
    fakes.fs.writeFile(TUNNEL_CONFIG, SEED_TUNNEL);

    const app = createApp({
      commands: fakes.commands,
      fs: fakes.fs,
      backup: createBackup(fakes.fs),
      logger: createLogger(fakes.fs),
    });

    const localServer = app.listen(0);
    await once(localServer, "listening");
    const address = localServer.address();
    assert.ok(address && typeof address === "object");
    const localBaseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const formInit = form({ hostname: "new.lyly.dev", type: "static" });
      const response = await fetch(`${localBaseUrl}/sites`, {
        ...formInit,
        headers: { Authorization: AUTH, ...formInit.headers },
      });

      assert.equal(response.status, 500);
      assert.match(fakes.fs.readFile(CADDYFILE), /http:\/\/new\.lyly\.dev \{/);
    } finally {
      localServer.close();
      await once(localServer, "close");
    }
  });
});

describe("audit log", () => {
  test("records a line for a successful add", async () => {
    await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
    const log = fakeFs.readFile(LOG_FILE);
    const entry = JSON.parse(log.trim().split("\n").at(-1)!);
    assert.equal(entry.action, "add-site");
    assert.equal(entry.hostname, "new.lyly.dev");
    assert.ok(entry.timestamp);
  });
});
