import { after, afterEach, before, beforeEach, describe, test } from "node:test";
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
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.RESERVED_HOSTNAMES = "admin.lychee.land";
process.env.LOG_FILE = LOG_FILE;
process.env.CADDYFILE_PATH = CADDYFILE;
process.env.TUNNEL_CONFIG_PATH = TUNNEL_CONFIG;
process.env.SITES_ROOT = SITES_ROOT;
process.env.BACKUP_DIR = "/etc/lyly-admin/backups";

const SEED_CADDYFILE = `{
\tauto_https off
}

http://blog.lychee.land {
\troot * ${SITES_ROOT}/blog.lychee.land
\tfile_server
}

http://api.lychee.land {
\treverse_proxy localhost:4000
}

http://lychee.local {
\troot * /var/www/lychee.local
\tfile_server
}
`;

const SEED_TUNNEL = `tunnel: 11111111-2222-3333-4444-555555555555
ingress:
  - hostname: blog.lychee.land
    service: http://localhost:80
  - hostname: api.lychee.land
    service: http://localhost:80
  - service: http_status:404
`;

let fakeFs: ReturnType<typeof createInMemoryFileSystem>;
let fakeCommands: import("../lib/systemCommands").SystemCommands;
const createSiteDirectoryCalls: string[] = [];

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

  const fakes = createFakes({
    createSiteDirectory: (hostname) => {
      createSiteDirectoryCalls.push(hostname);
      fakeFs.mkdir(path.posix.join(SITES_ROOT, hostname));
      return Promise.resolve({ stdout: "", stderr: "" });
    },
  });
  fakeFs = fakes.fs;
  fakeCommands = fakes.commands;
  writeFixtures();
  await fakes.commands.createSiteDeclaration("palsave-api", "palsave-api", 8788);

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
  createSiteDirectoryCalls.length = 0;
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
    assert.match(page, /blog\.lychee\.land/);
    assert.match(page, /api\.lychee\.land/);
  });

  test("omits hostnames outside the managed domain", async () => {
    const body = await (await request("/")).text();
    assert.doesNotMatch(body, /lychee\.local/);
  });

  test("states the DNS reminder after a removal", async () => {
    const response = await request("/?removed=blog.lychee.land");
    const html = await response.text();
    assert.match(html, /id="page-notice"/);
    assert.match(html, /Remember to remove the DNS record/);
  });

  test("says nothing about DNS without a ?removed query", async () => {
    const html = await (await request("/")).text();
    assert.doesNotMatch(html, /id="page-notice"/);
  });
});

describe("status on the site list", () => {
  // "&#9679;" is the literal entity the pill span renders (see the pill
  // convention noted in src/views/html.test.ts) — a raw "●" character never
  // appears in this markup, so the regex matches the entity, not the glyph.
  // It's wrapped in its own aria-hidden span so the dot never joins the
  // pill's accessible name.
  test("reports each proxy site's status", async () => {
    const page = withoutHeader(await (await request("/")).text());
    // api.lychee.land is the seeded plain proxy on port 4000. Nothing listens
    // there during the test, so the tcp check resolves either way — the
    // assertion is that a canonical status word reached the card at all.
    assert.match(page, /<span aria-hidden="true">&#9679;<\/span> (responding|not responding)/);
  });

  test("says nothing about a static site's liveness", async () => {
    const page = withoutHeader(await (await request("/")).text());
    const card = page.match(/<a href="\/sites\/blog\.lychee\.land"[\s\S]*?<\/a>/)?.[0] ?? "";
    assert.ok(card, "expected a card for the static site");
    assert.doesNotMatch(card, /&#9679;/);
  });
});

describe("GET / when the Caddyfile can't be read", () => {
  // GET / became async when the status read was added. An async Express 4
  // handler that throws (rather than returning a rejected promise Express
  // can see) leaves the request hanging and crashes the process on the
  // unhandled rejection — the exact failure this app exists to surface, not
  // hide. This proves the try/catch around it turns that into an ordinary
  // 500 instead.
  test("returns 500 with the error text, rather than hanging or crashing the process", async () => {
    fakeFs.rmRecursive(CADDYFILE);

    const response = await request("/");

    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /ENOENT/);
  });

  // The DNS reminder is a fact about a removal that already completed, not
  // about whether the Caddyfile happens to be readable on this particular
  // request — so a 500 here must not swallow it.
  test("still states the DNS reminder even though the list itself can't render", async () => {
    fakeFs.rmRecursive(CADDYFILE);

    const response = await request("/?removed=blog.lychee.land");

    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /id="page-notice"/);
    assert.match(body, /Remember to remove the DNS record/);
  });
});

describe("GET /sites/new", () => {
  // GET /sites/new is async (it awaits a clone refresh). An unguarded throw
  // there hangs the request and crashes the process under Express 4. The
  // timeout turns a hang into a failure rather than a stuck test run.
  test("returns 500 with the error text when the Caddyfile can't be read, rather than hanging", async () => {
    fakeFs.rmRecursive(CADDYFILE);

    const response = await request("/sites/new", { signal: AbortSignal.timeout(3000) });

    assert.equal(response.status, 500);
    assert.match(await response.text(), /ENOENT/);
  });

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
    // 4000 is api.lychee.land in the fixture; 8787 is lyly-admin's own PORT.
    assert.match(page, /api\.lychee\.land/);
    assert.match(page, /8787/);
  });

  test("is not mistaken for a hostname by the detail route", async () => {
    const body = await (await request("/sites/new")).text();
    assert.doesNotMatch(body, /No managed site found/);
  });
});

describe("refreshing the lychee-resources clone", () => {
  const NEXT = `${SEED_CADDYFILE}
http://test.lychee.land {
\t# lyly-admin-framework: nextjs
\t# lyly-admin-healthcheck: /
\treverse_proxy localhost:3000
}
`;
  let saved: import("../lib/systemCommands").SystemCommands["refreshDeclarations"];
  let refreshes = 0;

  beforeEach(() => {
    writeFixtures(NEXT);
    refreshes = 0;
    saved = fakeCommands.refreshDeclarations;
    fakeCommands.refreshDeclarations = () => {
      refreshes += 1;
      return Promise.resolve();
    };
  });

  afterEach(() => {
    fakeCommands.refreshDeclarations = saved;
  });

  test("the add page refreshes the clone, so its preview and submit read a fresh one", async () => {
    assert.equal((await request("/sites/new")).status, 200);
    assert.equal(refreshes, 1);
  });

  test("a Next.js site's page refreshes the clone before reading its declaration", async () => {
    assert.equal((await request("/sites/test.lychee.land")).status, 200);
    assert.equal(refreshes, 1);
  });

  test("the preview, which runs per keystroke, and the submit never refresh", async () => {
    await request("/sites/preview", form({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "3300" }));
    await request("/sites", form({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "3300" }));
    assert.equal(refreshes, 0);
  });

  // The real refresh never rejects; this is the contract failing anyway.
  test("a refresh that fails still renders both pages", async () => {
    fakeCommands.refreshDeclarations = () => Promise.reject(new Error("network down"));
    assert.equal((await request("/sites/new")).status, 200);
    const response = await request("/sites/test.lychee.land");
    assert.equal(response.status, 200);
    assert.match(await response.text(), /From a repository/);
  });
});

describe("POST /sites — static", () => {
  const OK_ADD_STEPS = [
    { id: "backup", label: "Configs backed up", status: "ok" },
    { id: "caddyfile", label: "Caddyfile block appended", status: "ok" },
    { id: "files", label: "Site directory created", status: "ok" },
    { id: "tunnel", label: "Tunnel route added", status: "ok" },
    { id: "caddy", label: "Caddy validated and reloaded", status: "ok" },
    { id: "cloudflared", label: "cloudflared-sites restarted", status: "ok" },
  ];

  test("adds a Caddyfile block, an ingress rule, a directory, and a placeholder page", async () => {
    const response = await request("/sites", form({ hostname: "new.lychee.land", type: "static" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      added: true,
      hostname: "new.lychee.land",
      type: "static",
      target: `${SITES_ROOT}/new.lychee.land`,
      framework: "none",
      // Derived from the seeded tunnel config's `tunnel:` key, not from an
      // environment variable that could drift from it.
      tunnelId: "11111111-2222-3333-4444-555555555555",
      steps: OK_ADD_STEPS,
    });

    assert.match(fakeFs.readFile(CADDYFILE), /http:\/\/new\.lychee\.land \{/);
    assert.match(fakeFs.readFile(TUNNEL_CONFIG), /hostname: new\.lychee\.land/);
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "new.lychee.land")), true);
    assert.match(
      fakeFs.readFile(path.join(SITES_ROOT, "new.lychee.land", "index.html")),
      /Site created by lyly-admin/,
    );
  });

  test("a static site reports every step as ok", async () => {
    const response = await request("/sites", form({ hostname: "new.lychee.land", type: "static" }));
    const body = await json<{ steps: { status: string }[] }>(response);
    assert.ok(body.steps.every((step) => step.status === "ok"));
  });

  test("rejects a hostname outside the managed domain", async () => {
    const response = await request("/sites", form({ hostname: "evil.example.com", type: "static" }));
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /must be a subdomain of lychee\.land/);
  });

  test("rejects a hostname that already exists", async () => {
    const response = await request("/sites", form({ hostname: "blog.lychee.land", type: "static" }));
    assert.equal(response.status, 400);
    const body = await json<{ error: string }>(response);
    assert.match(body.error, /already exists in the Caddyfile/);
    // Nothing ran, so there is no backup to mention and no step report.
    assert.doesNotMatch(body.error, /Backed-up copies/);
    assert.deepEqual(createSiteDirectoryCalls, []);
  });

  test("an unreadable Caddyfile is still a 500, not an input error", async () => {
    fakeFs.rmRecursive(CADDYFILE);
    const response = await request("/sites", form({ hostname: "new.lychee.land", type: "static" }));
    assert.equal(response.status, 500);
    assert.match((await json<{ error: string }>(response)).error, /ENOENT/);
  });
});

describe("reserved hostnames", () => {
  test("the preview and the submit both refuse a reserved hostname, and the submit writes nothing", async () => {
    const preview = await json<{ ready: boolean; error: string }>(
      await request("/sites/preview", form({ hostname: "ADMIN.lychee.land", type: "static" })),
    );
    assert.equal(preview.ready, false);
    assert.equal(preview.error, '"admin.lychee.land" is reserved');

    const before = fakeFs.readFile(CADDYFILE);
    const submit = await request("/sites", form({ hostname: "ADMIN.lychee.land", type: "static" }));
    assert.equal(submit.status, 400);
    assert.equal((await json<{ error: string }>(submit)).error, '"admin.lychee.land" is reserved');
    assert.equal(fakeFs.readFile(CADDYFILE), before);
    assert.equal(fakeFs.readFile(TUNNEL_CONFIG), SEED_TUNNEL);
    assert.equal(createSiteDirectoryCalls.length, 0);
  });
});

describe("POST /sites — reverse proxy", () => {
  test("a Next.js site writes both marker comments and nothing to the host", async () => {
    const response = await request(
      "/sites",
      form({ hostname: "app.lychee.land", type: "reverse-proxy", port: "3000", framework: "nextjs", healthcheckPath: "/api/health" }),
    );
    assert.equal(response.status, 200);
    const body = await json<{ framework: string; steps: { id: string; status: string }[] }>(response);
    assert.equal(body.framework, "nextjs");
    assert.equal(body.steps.find((step) => step.id === "files")?.status, "skipped");

    const caddyfile = fakeFs.readFile(CADDYFILE);
    assert.match(caddyfile, /# lyly-admin-framework: nextjs/);
    assert.match(caddyfile, /# lyly-admin-healthcheck: \/api\/health/);

    const siteDir = path.join(SITES_ROOT, "app.lychee.land");
    assert.equal(fakeFs.hasDir(siteDir), false);
    assert.equal(fakeFs.hasFile(path.join(siteDir, "Dockerfile")), false);
    assert.equal(fakeFs.hasFile(path.join(siteDir, ".github/workflows/release.yml")), false);
    assert.deepEqual(createSiteDirectoryCalls, []);
  });

  test("a static site still creates its directory", async () => {
    await request("/sites", form({ hostname: "static.lychee.land", type: "static" }));
    assert.deepEqual(createSiteDirectoryCalls, ["static.lychee.land"]);
  });

  test("rejects a port claimed by a declaration, naming it", async () => {
    const response = await request("/sites", form({ hostname: "clash.lychee.land", type: "reverse-proxy", port: "8788" }));
    assert.equal(response.status, 400);
    assert.equal(
      (await json<{ error: string }>(response)).error,
      "Port 8788 is already claimed by palsave-api in lychee-resources.",
    );
  });

  test("an unreadable clone (null) degrades to no claims", async () => {
    const original = fakeCommands.readDeclarations;
    fakeCommands.readDeclarations = () => Promise.resolve(null);
    try {
      const response = await request("/sites", form({ hostname: "ok.lychee.land", type: "reverse-proxy", port: "8788" }));
      assert.equal(response.status, 200);
    } finally {
      fakeCommands.readDeclarations = original;
    }
  });

  test("refuses a Next.js site on a privileged port", async () => {
    const response = await request("/sites", form({ hostname: "low.lychee.land", type: "reverse-proxy", port: "80", framework: "nextjs" }));
    assert.equal(response.status, 400);
  });

  test("creates no directory for a reverse proxy with no framework", async () => {
    const response = await request("/sites", form({ hostname: "plain.lychee.land", type: "reverse-proxy", port: "5000" }));
    assert.equal(response.status, 200);
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "plain.lychee.land")), false);
  });

  test("a plain reverse-proxy site skips the directory step rather than failing it", async () => {
    const response = await request("/sites", form({ hostname: "new.lychee.land", type: "reverse-proxy", port: "4100" }));
    const body = await json<{ steps: { id: string; status: string }[] }>(response);
    const files = body.steps.find((step) => step.id === "files");
    assert.equal(files?.status, "skipped");
  });

  test("rejects a port already used by another reverse-proxy site", async () => {
    const response = await request("/sites", form({ hostname: "clash.lychee.land", type: "reverse-proxy", port: "4000" }));
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /already used by api\.lychee\.land/);
  });

  test("rejects a reserved port", async () => {
    const response = await request("/sites", form({ hostname: "clash.lychee.land", type: "reverse-proxy", port: "2019" }));
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /reserved/);
  });

  test("rejects a missing or out-of-range port", async () => {
    const missing = await request("/sites", form({ hostname: "clash.lychee.land", type: "reverse-proxy" }));
    assert.equal(missing.status, 400);
    const tooBig = await request("/sites", form({ hostname: "clash.lychee.land", type: "reverse-proxy", port: "70000" }));
    assert.equal(tooBig.status, 400);
  });

  test("rejects a malformed healthcheck path", async () => {
    const response = await request(
      "/sites",
      form({ hostname: "app.lychee.land", type: "reverse-proxy", port: "3000", framework: "nextjs", healthcheckPath: "no-leading-slash" }),
    );
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /is not a valid healthcheck path/);
  });
});

describe("POST /sites/:hostname/delete", () => {
  const OK_REMOVE_STEPS = [
    { id: "caddyfile", label: "Caddyfile block removed", status: "ok" },
    { id: "tunnel", label: "Tunnel route removed", status: "ok" },
    { id: "caddy", label: "Caddy validated and reloaded", status: "ok" },
    { id: "cloudflared", label: "cloudflared-sites restarted", status: "ok" },
  ];

  test("removes the Caddyfile block and the ingress rule", async () => {
    const response = await request("/sites/blog.lychee.land/delete", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      removed: true,
      needsFileConfirm: false,
      steps: OK_REMOVE_STEPS,
    });

    assert.doesNotMatch(fakeFs.readFile(CADDYFILE), /http:\/\/blog\.lychee\.land \{/);
    assert.doesNotMatch(fakeFs.readFile(TUNNEL_CONFIG), /hostname: blog\.lychee\.land/);
  });

  test("reports the path to confirm when file deletion was requested", async () => {
    const response = await request("/sites/blog.lychee.land/delete", form({ deleteFiles: "on" }));
    assert.deepEqual(await response.json(), {
      removed: true,
      needsFileConfirm: true,
      sitePath: `${SITES_ROOT}/blog.lychee.land`,
      steps: OK_REMOVE_STEPS,
    });
  });

  test("does not delete files as part of the same request", async () => {
    fakeFs.mkdir(path.join(SITES_ROOT, "blog.lychee.land"));
    fakeFs.writeFile(path.join(SITES_ROOT, "blog.lychee.land", "index.html"), "content");

    await request("/sites/blog.lychee.land/delete", form({ deleteFiles: "on" }));

    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "blog.lychee.land", "index.html")), true);
  });

  test("a successful removal reports all four steps as ok", async () => {
    const response = await request("/sites/blog.lychee.land/delete", form({}));
    const body = await json<{ steps: { id: string; status: string }[] }>(response);
    assert.deepEqual(
      body.steps.map((step) => [step.id, step.status]),
      [
        ["caddyfile", "ok"],
        ["tunnel", "ok"],
        ["caddy", "ok"],
        ["cloudflared", "ok"],
      ],
    );
  });

  test("a failed tunnel edit reports the failing step and leaves later steps not-run", async () => {
    // lychee.local has a Caddyfile block but deliberately no ingress rule
    // in SEED_TUNNEL, so removeIngressRule throws after the Caddyfile has
    // already been rewritten — same arrangement as the rollback test
    // "restores the Caddyfile when the tunnel edit fails during remove".
    const response = await request("/sites/lychee.local/delete", form({}));
    assert.equal(response.status, 500);
    const body = await json<{ steps: { id: string; status: string }[]; rolledBack: boolean }>(response);
    const byId = Object.fromEntries(body.steps.map((s) => [s.id, s.status]));
    assert.equal(byId.caddyfile, "ok");
    assert.equal(byId.tunnel, "failed");
    assert.equal(byId.caddy, "not-run");
    assert.equal(byId.cloudflared, "not-run");
    // caddyReloaded was still false, so the handler restored both files.
    assert.equal(body.rolledBack, true);
  });

  test("a failure after Caddy reloaded reports that the config was left in place", async () => {
    // Same arrangement as the rollback test "does not roll back once Caddy
    // has already reloaded, even if cloudflared then fails": a fake whose
    // restartCloudflared rejects, on its own app/server since every other
    // test in this file needs restartCloudflared to succeed.
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
      const formInit = form({});
      const response = await fetch(`${localBaseUrl}/sites/blog.lychee.land/delete`, {
        ...formInit,
        headers: { Authorization: AUTH, ...formInit.headers },
      });

      assert.equal(response.status, 500);
      const body = await json<{ steps: { id: string; status: string }[]; rolledBack: boolean }>(response);
      const byId = Object.fromEntries(body.steps.map((s) => [s.id, s.status]));
      assert.equal(byId.caddy, "ok");
      assert.equal(byId.cloudflared, "failed");
      assert.equal(body.rolledBack, false);
    } finally {
      localServer.close();
      await once(localServer, "close");
    }
  });
});

describe("POST /sites/:hostname/delete-files", () => {
  test("removes the site directory", async () => {
    fakeFs.mkdir(path.join(SITES_ROOT, "blog.lychee.land"));
    fakeFs.writeFile(path.join(SITES_ROOT, "blog.lychee.land", "index.html"), "content");

    const response = await request("/sites/blog.lychee.land/delete-files", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true });
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "blog.lychee.land")), false);
    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "blog.lychee.land", "index.html")), false);
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

    const response = await request("/sites", form({ hostname: "new.lychee.land", type: "static" }));

    assert.equal(response.status, 500);
    assert.equal(fakeFs.readFile(CADDYFILE), before);
    // Unlike the pre-backup-step rejections, the backup step did actually run
    // here (the failure is four steps later), so the response's mention of
    // backups is accurate rather than asserted unconditionally.
    const body = await json<{ error: string; steps: { id: string; status: string }[] }>(response);
    assert.equal(body.steps.find((step) => step.id === "backup")?.status, "ok");
    assert.match(body.error, /Backed-up copies/);
  });

  test("restores the Caddyfile when the tunnel edit fails during remove", async () => {
    // lychee.local has a Caddyfile block but deliberately no ingress rule,
    // so removeIngressRule throws after the Caddyfile has been rewritten.
    const before = fakeFs.readFile(CADDYFILE);

    const response = await request("/sites/lychee.local/delete", form({}));

    assert.equal(response.status, 500);
    assert.equal(fakeFs.readFile(CADDYFILE), before);
  });

  test("aborts before mutating anything when the tunnel config read fails, even though backup would have succeeded", async () => {
    // Regression for an ordering bug: the delete handler used to read
    // tunnelContent only after rewriting the Caddyfile, so a read failure
    // here left the Caddyfile edited-but-unapplied — the caddyfile step
    // reporting "ok" — with no rollback (the guard needs both contents) and
    // no step reporting it, so the operator would see nothing at all.
    // Reading tunnelContent up front, beside caddyfileContent, makes that
    // combination impossible: this now fails before anything is mutated.
    //
    // An earlier version of this test simulated the unreadable tunnel config
    // by deleting it — but backupFile() also reads that same path (via
    // fs.copyFile's readFile, see src/lib/backup.ts / src/dev/fakes.ts), and
    // it runs before either ordering's Caddyfile write. So it threw first in
    // both the fixed and the pre-fix handler, the Caddyfile was left
    // untouched either way, and the test passed even with the old,
    // buggy ordering restored. This version instead gives the route a
    // no-op backup (so backup itself can never be what fails) and an `fs`
    // whose readFile throws only for the tunnel config path — isolating the
    // one thing that actually distinguishes the two orderings: whether the
    // Caddyfile write step runs before or after the tunnel read.
    const { createApp } = await import("../app");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");

    const fakes = createFakes();
    fakes.fs.mkdir(SITES_ROOT);
    fakes.fs.writeFile(CADDYFILE, SEED_CADDYFILE);
    fakes.fs.writeFile(TUNNEL_CONFIG, SEED_TUNNEL);

    const readOnlyFailingForTunnel: typeof fakes.fs = {
      ...fakes.fs,
      readFile(target: string): string {
        if (target === TUNNEL_CONFIG) {
          throw new Error("simulated read failure for the tunnel config");
        }
        return fakes.fs.readFile(target);
      },
    };

    const app = createApp({
      commands: fakes.commands,
      fs: readOnlyFailingForTunnel,
      // A no-op: it never reads the tunnel config, so it always succeeds —
      // unlike the real backupFile, which would throw on the same read this
      // test is targeting and mask the ordering bug all over again.
      backup: { backupFile: () => "" },
      logger: createLogger(fakes.fs),
    });

    const localServer = app.listen(0);
    await once(localServer, "listening");
    const address = localServer.address();
    assert.ok(address && typeof address === "object");
    const localBaseUrl = `http://127.0.0.1:${address.port}`;

    const before = fakes.fs.readFile(CADDYFILE);

    try {
      const formInit = form({});
      const response = await fetch(`${localBaseUrl}/sites/blog.lychee.land/delete`, {
        ...formInit,
        headers: { Authorization: AUTH, ...formInit.headers },
      });

      assert.equal(response.status, 500);
      const body = await json<{ steps: { id: string; status: string }[] }>(response);
      const byId = Object.fromEntries(body.steps.map((s) => [s.id, s.status]));
      // Pre-fix, the Caddyfile write ran before the tunnel read, so this
      // would report "ok" here instead of "not-run".
      assert.equal(byId.caddyfile, "not-run");
      // Pre-fix, the write above would have actually landed, so this would
      // differ from `before` instead of matching it byte-for-byte.
      assert.equal(fakes.fs.readFile(CADDYFILE), before);
    } finally {
      localServer.close();
      await once(localServer, "close");
    }
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
      const formInit = form({ hostname: "new.lychee.land", type: "static" });
      const response = await fetch(`${localBaseUrl}/sites`, {
        ...formInit,
        headers: { Authorization: AUTH, ...formInit.headers },
      });

      assert.equal(response.status, 500);
      assert.match(fakes.fs.readFile(CADDYFILE), /http:\/\/new\.lychee\.land \{/);
    } finally {
      localServer.close();
      await once(localServer, "close");
    }
  });
});

describe("POST /sites/preview", () => {
  test("returns the Caddyfile block that POST /sites would append", async () => {
    const response = await request("/sites/preview", form({ hostname: "docs.lychee.land", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; preview: { caddy: { added: string[] } } }>(response);
    assert.equal(body.ready, true);
    assert.deepEqual(body.preview.caddy.added, [
      "http://docs.lychee.land {",
      `\troot * ${SITES_ROOT}/docs.lychee.land`,
      "\tfile_server",
      "}",
    ]);
  });

  test("writes nothing — the Caddyfile is byte-identical afterwards", async () => {
    const before = fakeFs.readFile(CADDYFILE);
    const beforeTunnel = fakeFs.readFile(TUNNEL_CONFIG);
    await request("/sites/preview", form({ hostname: "docs.lychee.land", type: "static" }));
    assert.equal(fakeFs.readFile(CADDYFILE), before);
    assert.equal(fakeFs.readFile(TUNNEL_CONFIG), beforeTunnel);
  });

  test("creates no site directory", async () => {
    await request("/sites/preview", form({ hostname: "docs.lychee.land", type: "static" }));
    // hasDir/hasFile, not exists — the in-memory fake exposes those two
    // (src/dev/fakes.ts), and the static-add test above already uses hasDir.
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "docs.lychee.land")), false);
    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "docs.lychee.land", "index.html")), false);
  });

  // The handler is async (it awaits the declared ports), so an unguarded
  // throw would hang the request and crash the process under Express 4.
  test("an unreadable Caddyfile answers with an error, rather than hanging", async () => {
    fakeFs.rmRecursive(CADDYFILE);
    const response = await request("/sites/preview", form({ hostname: "docs.lychee.land", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; error: string }>(response);
    assert.equal(body.ready, false);
    assert.match(body.error, /ENOENT/);
  });

  test("an empty hostname is not ready and not an error — the form is merely early", async () => {
    const response = await request("/sites/preview", form({ hostname: "", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; error?: string }>(response);
    assert.equal(body.ready, false);
    assert.equal(body.error, undefined);
  });

  test("reports a duplicate hostname before submit, in the submit's own words", async () => {
    const response = await request("/sites/preview", form({ hostname: "blog.lychee.land", type: "static" }));
    const body = await json<{ ready: boolean; error: string }>(response);
    assert.equal(body.ready, false);
    assert.equal(body.error, "blog.lychee.land already exists in the Caddyfile");
  });

  test("reports a port conflict with the same string the submit would return", async () => {
    const preview = await json<{ error: string }>(
      await request("/sites/preview", form({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "4000" })),
    );
    const submit = await json<{ error: string }>(
      await request("/sites", form({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "4000" })),
    );
    assert.equal(preview.error, submit.error);
  });

  test("rejects a declared port with the same string the submit returns", async () => {
    const fields = { hostname: "docs.lychee.land", type: "reverse-proxy", port: "8788" };
    const preview = await json<{ ready: boolean; error: string }>(await request("/sites/preview", form(fields)));
    const submit = await json<{ error: string }>(await request("/sites", form(fields)));
    assert.equal(preview.ready, false);
    assert.equal(preview.error, submit.error);
    assert.match(preview.error, /palsave-api in lychee-resources/);
  });

  test("a Next.js preview offers the files for the repository, not /var/www", async () => {
    const response = await request(
      "/sites/preview",
      form({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "4100", framework: "nextjs" }),
    );
    const body = await json<{ preview: { files: { path: string; creates: string[]; destination: string } } }>(response);
    assert.equal(body.preview.files.destination, "repository");
    assert.doesNotMatch(body.preview.files.path, /\/var\/www/);
    assert.equal(body.preview.files.creates.length, 3);
  });

  test("marks the directory step as not running for a plain reverse proxy", async () => {
    const response = await request(
      "/sites/preview",
      form({ hostname: "docs.lychee.land", type: "reverse-proxy", port: "4100" }),
    );
    const body = await json<{ preview: { steps: { id: string; willRun: boolean }[] } }>(response);
    const skipped = body.preview.steps.filter((step) => !step.willRun).map((step) => step.id);
    assert.deepEqual(skipped, ["files"]);
  });

  test("requires authentication like every other route", async () => {
    const response = await fetch(`${baseUrl}/sites/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ hostname: "docs.lychee.land" }).toString(),
    });
    assert.equal(response.status, 401);
  });
});

describe("audit log", () => {
  test("records a line for a successful add", async () => {
    await request("/sites", form({ hostname: "new.lychee.land", type: "static" }));
    const log = fakeFs.readFile(LOG_FILE);
    const entry = JSON.parse(log.trim().split("\n").at(-1)!);
    assert.equal(entry.action, "add-site");
    assert.equal(entry.hostname, "new.lychee.land");
    assert.ok(entry.timestamp);
  });
});

// --- Site resources: attach, awaiting image, deploy ------------------------

const INVENTORY = "/var/lib/lychee-inventory/services.json";

const NEXT_CADDYFILE = `${SEED_CADDYFILE}
http://test.lychee.land {
\t# lyly-admin-framework: nextjs
\t# lyly-admin-healthcheck: /
\treverse_proxy localhost:3000
}
`;

function writeInventory(services: unknown[]): void {
  fakeFs.writeFile(INVENTORY, JSON.stringify({ generated: "2026-10-05T10:00:00Z", services }));
}

function siteEntry(fields: Record<string, unknown>): Record<string, unknown> {
  return { name: "test-lychee-land", container: "test-lychee-land", kind: "container", group: "service", reconciled: true, ...fields };
}

const TEST_DECLARATION = { name: "test-lychee-land", port: 3000, state: "running", image: "ghcr.io/lycheehome/test-site" };

describe("GET /sites/:hostname — a Next.js site's resource", () => {
  type Commands = import("../lib/systemCommands").SystemCommands;
  let saved: Partial<Commands>;
  const calls: { resource: string[] } = { resource: [] };

  beforeEach(() => {
    writeFixtures(NEXT_CADDYFILE);
    fakeFs.rmRecursive(INVENTORY);
    calls.resource.length = 0;
    saved = {
      readDeclarations: fakeCommands.readDeclarations,
      checkResourceContainerStatus: fakeCommands.checkResourceContainerStatus,
    };
    fakeCommands.checkResourceContainerStatus = (project) => {
      calls.resource.push(project);
      return Promise.resolve({ state: "running", health: "healthy" });
    };
  });

  afterEach(() => {
    Object.assign(fakeCommands, saved);
    fakeFs.rmRecursive(INVENTORY);
  });

  function declarations(decls: unknown[]): void {
    fakeCommands.readDeclarations = () => Promise.resolve(decls as never);
  }

  async function page(): Promise<string> {
    const response = await request("/sites/test.lychee.land");
    assert.equal(response.status, 200);
    return withoutHeader(await response.text());
  }

  test("with no declaration, renders the three scaffold files and the attach control, and no compose command", async () => {
    declarations([]);
    const html = await page();
    for (const file of ["Dockerfile", ".dockerignore", ".github/workflows/release.yml"]) {
      assert.match(html, new RegExp(`>${file.replace(/\./g, "\\.")}<`));
    }
    assert.match(html, /HEALTHCHECK/);
    assert.match(html, /data-attach=/);
    assert.match(html, /name="repo"/);
    assert.doesNotMatch(html, /docker compose up/);
    assert.match(html, /data-state-pill><span aria-hidden="true">&#9679;<\/span> not deployed/);
  });

  test("before the reconciler's first tick, a written declaration reads awaiting image, not Attach again", async () => {
    declarations([TEST_DECLARATION]);
    const html = await page();
    assert.match(html, /data-state-pill><span aria-hidden="true">&#9679;<\/span> awaiting image/);
    assert.doesNotMatch(html, /data-attach=/);
    assert.doesNotMatch(html, /data-deploy=/);
  });

  test("awaiting image with a tag on offer renders the offer and a Deploy control for the resource", async () => {
    declarations([TEST_DECLARATION]);
    writeInventory([siteEntry({ result: "awaiting-image", available: "0.1.0" })]);
    const html = await page();
    assert.match(html, /awaiting image/);
    assert.match(html, /data-deploy="test-lychee-land"/);
    assert.match(html, /data-deploy-tag="0\.1\.0"/);
    assert.match(html, /0\.1\.0 available/);
    assert.doesNotMatch(html, /data-attach=/);
  });

  test("a deployed resource reads its last hop from the resource's container", async () => {
    declarations([TEST_DECLARATION]);
    writeInventory([siteEntry({ result: "deployed", version: "0.1.0", target: "0.1.0" })]);
    const html = await page();
    assert.deepEqual(calls.resource, ["test-lychee-land"]);
    assert.match(html, /running · healthy/);
  });

  test("legacy: a Next.js site with an old directory and no declaration still offers Attach", async () => {
    declarations([]);
    fakeFs.mkdir("/var/www/test.lychee.land");
    fakeFs.writeFile("/var/www/test.lychee.land/docker-compose.yml", "services: {}\n");
    const html = await page();
    assert.match(html, /data-attach=/);
  });

  test("a retired declaration renders as not attached, with Attach enabled and the prune warning beside it", async () => {
    declarations([{ ...TEST_DECLARATION, state: "absent" }]);
    writeInventory([siteEntry({ result: "deployed" })]);
    const html = await page();
    assert.doesNotMatch(html, /awaiting image/);
    assert.match(html, /not deployed/);
    assert.match(html, /prune/i);
    assert.match(html, /data-prune="test-lychee-land"/);
    const button = html.match(/<button[^>]*type="submit"[^>]*>Attach repository/);
    assert.ok(button, "no Attach button");
    assert.doesNotMatch(button[0], /\sdisabled(?=[\s>/])/);
  });

  // The reconciler removes a pruned site's status.json only once it proves the
  // site down (and not at all without that cleanup rule), so its entry can
  // outlive the declaration. A readable clone with no declaration is the
  // authority: the site is not attached, and Attach is offered again.
  test("a readable clone with no declaration is not attached, whatever a stale inventory entry says", async () => {
    declarations([]);
    writeInventory([siteEntry({ result: "deployed", version: "", target: "0.2.0" })]);
    const response = await request("/sites/test.lychee.land");
    const raw = await response.text();
    const html = withoutHeader(raw);
    assert.match(html, /data-attach=/);
    assert.doesNotMatch(html, /awaiting image/);
    assert.match(html, /data-state-pill><span aria-hidden="true">&#9679;<\/span> not deployed/);
    assert.doesNotMatch(raw, /<dialog[^>]*data-attached/);
  });

  test("an unreadable clone falls back to the inventory: an entry means attached", async () => {
    fakeCommands.readDeclarations = () => Promise.resolve(null);
    writeInventory([siteEntry({ result: "awaiting-image", available: "0.1.0" })]);
    const response = await request("/sites/test.lychee.land");
    const raw = await response.text();
    const html = withoutHeader(raw);
    assert.doesNotMatch(html, /data-attach=/);
    assert.match(html, /awaiting image/);
    assert.match(raw, /<dialog[^>]*data-attached="true"/);
  });

  test("an unreadable clone and no entry is not attached", async () => {
    fakeCommands.readDeclarations = () => Promise.resolve(null);
    const html = await page();
    assert.match(html, /data-attach=/);
    assert.doesNotMatch(html, /data-prune/);
  });

  test("awaiting with an entry and nothing available says no image was found, and offers to change the repository", async () => {
    declarations([TEST_DECLARATION]);
    writeInventory([siteEntry({ result: "awaiting-image" })]);
    const html = await page();
    assert.match(html, /No image found at <span[^>]*>ghcr\.io\/lycheehome\/test-site<\/span> yet/);
    assert.match(html, /data-change-repository="test\.lychee\.land"/);
    assert.match(html, /<input[^>]*name="repo"[^>]*value="test-site"/);
    assert.match(html, />Change repository</);
    assert.doesNotMatch(html, /data-attach=/);
  });

  test("before the reconciler's first tick, there is no change control and no 'No image found'", async () => {
    declarations([TEST_DECLARATION]);
    const html = await page();
    assert.doesNotMatch(html, /No image found/);
    assert.doesNotMatch(html, /data-change-repository=/);
  });

  test("with a tag on offer, there is no change control", async () => {
    declarations([TEST_DECLARATION]);
    writeInventory([siteEntry({ result: "awaiting-image", available: "0.1.0" })]);
    const html = await page();
    assert.doesNotMatch(html, /No image found/);
    assert.doesNotMatch(html, /data-change-repository=/);
  });

  test("once running, there is no change control", async () => {
    declarations([{ ...TEST_DECLARATION, image: "ghcr.io/lycheehome/test-site:0.1.0" }]);
    writeInventory([siteEntry({ result: "deployed", version: "0.1.0", target: "0.1.0" })]);
    const html = await page();
    assert.doesNotMatch(html, /No image found/);
    assert.doesNotMatch(html, /data-change-repository=/);
  });

  test("a failed first deploy has no change control", async () => {
    declarations([{ ...TEST_DECLARATION, image: "ghcr.io/lycheehome/test-site:0.1.0" }]);
    writeInventory([siteEntry({ result: "failed", version: "", target: "0.1.0", failed_step: "Pull the image: manifest unknown" })]);
    const html = await page();
    assert.doesNotMatch(html, /data-change-repository=/);
  });

  test("a failed first deploy reads failed, in the bad tone, and names the step and the journal", async () => {
    declarations([TEST_DECLARATION]);
    writeInventory([
      siteEntry({ result: "failed", version: "", target: "0.1.0", available: "0.1.0", gate: "", failed_step: "Pull the image: manifest unknown" }),
    ]);
    const html = await page();
    assert.doesNotMatch(html, /awaiting image/);
    const pill = html.match(/<span class="([^"]*)"[^>]*data-state-pill><span aria-hidden="true">&#9679;<\/span> failed<\/span>/);
    assert.ok(pill, "no failed pill");
    const { TONE_PILL } = await import("../views/shared");
    assert.equal(pill[1].includes(TONE_PILL.bad), true);
    assert.match(html, /Pull the image: manifest unknown/);
    assert.match(html, /journalctl -u lyly-reconcile/);
    assert.deepEqual(calls.resource, []);
  });

  test("a failed redeploy keeps the container's own pill and shows the failure in the card", async () => {
    declarations([TEST_DECLARATION]);
    writeInventory([siteEntry({ result: "failed", version: "0.1.0", target: "0.2.0", failed_step: "Start the container: exit 1" })]);
    const html = await page();
    assert.match(html, /data-state-pill><span aria-hidden="true">&#9679;<\/span> running/);
    assert.match(html, /Start the container: exit 1/);
    assert.match(html, /0\.2\.0/);
    assert.match(html, /journalctl -u lyly-reconcile/);
  });
});

describe("POST /sites/:hostname/attach", () => {
  type Commands = import("../lib/systemCommands").SystemCommands;
  let saved: Commands["createSiteDeclaration"];
  const created: [string, string, number][] = [];

  beforeEach(() => {
    writeFixtures(NEXT_CADDYFILE);
    created.length = 0;
    saved = fakeCommands.createSiteDeclaration;
    fakeCommands.createSiteDeclaration = (name, repo, port) => {
      created.push([name, repo, port]);
      return Promise.resolve({ ok: true });
    };
  });

  afterEach(() => {
    fakeCommands.createSiteDeclaration = saved;
  });

  test("writes the declaration with the site's own Caddy port", async () => {
    const response = await request("/sites/test.lychee.land/attach", form({ repo: "Test-Site", port: "9999" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { ok: true });
    assert.deepEqual(created, [["test-lychee-land", "test-site", 3000]]);
    const entry = JSON.parse(fakeFs.readFile(LOG_FILE).trim().split("\n").at(-1)!);
    assert.equal(entry.action, "attach-site");
  });

  test("a bad repository is a 400 and writes nothing", async () => {
    const response = await request("/sites/test.lychee.land/attach", form({ repo: "LycheeHome/test site" }));
    assert.equal(response.status, 400);
    const body = await json<{ ok: boolean; reason: string }>(response);
    assert.equal(body.ok, false);
    assert.ok(body.reason);
    assert.deepEqual(created, []);
  });

  test("a refused write is a 502 carrying the writer's reason", async () => {
    fakeCommands.createSiteDeclaration = () =>
      Promise.resolve({ ok: false, reason: "test-lychee-land.yml already exists with state: absent; prune it first." });
    const response = await request("/sites/test.lychee.land/attach", form({ repo: "test-site" }));
    assert.equal(response.status, 502);
    assert.deepEqual(await json(response), {
      ok: false,
      reason: "test-lychee-land.yml already exists with state: absent; prune it first.",
    });
    const entry = JSON.parse(fakeFs.readFile(LOG_FILE).trim().split("\n").at(-1)!);
    assert.equal(entry.action, "attach-site-failed");
  });

  test("an unknown site or a site that is not Next.js is a 404", async () => {
    for (const hostname of ["nope.lychee.land", "api.lychee.land", "blog.lychee.land"]) {
      const response = await request(`/sites/${hostname}/attach`, form({ repo: "test-site" }));
      assert.equal(response.status, 404, hostname);
    }
    assert.deepEqual(created, []);
  });
});

describe("POST /sites/:hostname/repository", () => {
  type Commands = import("../lib/systemCommands").SystemCommands;
  let saved: Commands["changeSiteRepository"];
  const changed: [string, string][] = [];

  beforeEach(() => {
    writeFixtures(NEXT_CADDYFILE);
    changed.length = 0;
    saved = fakeCommands.changeSiteRepository;
    fakeCommands.changeSiteRepository = (name, repo) => {
      changed.push([name, repo]);
      return Promise.resolve({ ok: true });
    };
  });

  afterEach(() => {
    fakeCommands.changeSiteRepository = saved;
  });

  const lastLog = () => JSON.parse(fakeFs.readFile(LOG_FILE).trim().split("\n").at(-1)!);

  test("changes the repository, normalized, for the site's own resource name", async () => {
    const response = await request("/sites/test.lychee.land/repository", form({ repo: " Test-App ", name: "other-lychee-land", port: "9999" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { ok: true });
    assert.deepEqual(changed, [["test-lychee-land", "test-app"]]);
    const entry = lastLog();
    assert.equal(entry.action, "change-repository");
    assert.match(entry.detail, /ghcr\.io\/lycheehome\/test-app/);
  });

  test("a bad repository is a 400 and writes nothing", async () => {
    const response = await request("/sites/test.lychee.land/repository", form({ repo: "LycheeHome/test app" }));
    assert.equal(response.status, 400);
    const body = await json<{ ok: boolean; reason: string }>(response);
    assert.equal(body.ok, false);
    assert.ok(body.reason);
    assert.deepEqual(changed, []);
  });

  test("a tagged declaration is a 409 carrying the writer's reason", async () => {
    const reason = "test-lychee-land.yml already has a tag: deployed images can't change repository; remove the site instead.";
    fakeCommands.changeSiteRepository = () => Promise.resolve({ ok: false, code: "tagged", reason });
    const response = await request("/sites/test.lychee.land/repository", form({ repo: "test-app" }));
    assert.equal(response.status, 409);
    assert.deepEqual(await json(response), { ok: false, reason });
    assert.equal(lastLog().action, "change-repository-failed");
  });

  test("a refused write is a 502 carrying the writer's reason", async () => {
    fakeCommands.changeSiteRepository = () => Promise.resolve({ ok: false, reason: "Push was rejected: fetch first" });
    const response = await request("/sites/test.lychee.land/repository", form({ repo: "test-app" }));
    assert.equal(response.status, 502);
    assert.deepEqual(await json(response), { ok: false, reason: "Push was rejected: fetch first" });
    assert.equal(lastLog().action, "change-repository-failed");
  });

  test("a writer that throws is a 502, not a crash", async () => {
    fakeCommands.changeSiteRepository = () => Promise.reject(new Error("boom"));
    const response = await request("/sites/test.lychee.land/repository", form({ repo: "test-app" }));
    assert.equal(response.status, 502);
    assert.equal(lastLog().action, "change-repository-failed");
  });

  test("an unknown site or a site that is not Next.js is a 404", async () => {
    for (const hostname of ["nope.lychee.land", "api.lychee.land", "blog.lychee.land"]) {
      const response = await request(`/sites/${hostname}/repository`, form({ repo: "test-app" }));
      assert.equal(response.status, 404, hostname);
    }
    assert.deepEqual(changed, []);
  });
});

describe("removing a Next.js site: the confirm dialog", () => {
  type Commands = import("../lib/systemCommands").SystemCommands;
  let saved: Commands["readDeclarations"];

  beforeEach(() => {
    writeFixtures(NEXT_CADDYFILE);
    saved = fakeCommands.readDeclarations;
  });

  afterEach(() => {
    fakeCommands.readDeclarations = saved;
  });

  function declarations(decls: unknown[]): void {
    fakeCommands.readDeclarations = () => Promise.resolve(decls as never);
  }

  async function dialog(): Promise<string> {
    const response = await request("/sites/test.lychee.land");
    assert.equal(response.status, 200);
    const match = (await response.text()).match(/<dialog id="confirm-remove-dialog"[\s\S]*?<\/dialog>/);
    assert.ok(match, "no confirm-remove dialog was rendered");
    return match[0];
  }

  const stepIds = (html: string): string[] => [...html.matchAll(/data-step-id="([a-z]+)"/g)].map((m) => m[1]);

  test("an attached site lists the declaration's retirement fifth, after the cloudflared-sites restart", async () => {
    declarations([TEST_DECLARATION]);
    const html = await dialog();
    assert.match(html, /<dialog[^>]*data-attached="true"/);
    assert.deepEqual(stepIds(html), ["caddyfile", "tunnel", "caddy", "cloudflared", "declaration"]);
  });

  test("an unattached site lists the existing four and is not marked attached", async () => {
    declarations([]);
    const html = await dialog();
    assert.doesNotMatch(html, /data-attached/);
    assert.deepEqual(stepIds(html), ["caddyfile", "tunnel", "caddy", "cloudflared"]);
  });

  test("a Next.js site with no directory renders no delete-files checkbox", async () => {
    declarations([]);
    assert.doesNotMatch(await dialog(), /id="confirm-remove-delete-files"/);
  });

  test("test.lychee.land's legacy directory still gets one", async () => {
    declarations([]);
    fakeFs.mkdir("/var/www/test.lychee.land");
    assert.match(await dialog(), /id="confirm-remove-delete-files"/);
  });
});

describe("POST /sites/:hostname/detach", () => {
  type Commands = import("../lib/systemCommands").SystemCommands;
  let saved: Pick<Commands, "readDeclarations" | "setDeclarationState">;
  const retired: [string, string][] = [];

  beforeEach(() => {
    writeFixtures(NEXT_CADDYFILE);
    retired.length = 0;
    saved = { readDeclarations: fakeCommands.readDeclarations, setDeclarationState: fakeCommands.setDeclarationState };
    fakeCommands.readDeclarations = () => Promise.resolve([TEST_DECLARATION]);
    fakeCommands.setDeclarationState = (name, state) => {
      retired.push([name, state]);
      return Promise.resolve({ ok: true });
    };
  });

  afterEach(() => {
    Object.assign(fakeCommands, saved);
  });

  function lastLogEntry(): { action: string; hostname: string; detail?: string } {
    return JSON.parse(fakeFs.readFile(LOG_FILE).trim().split("\n").at(-1)!);
  }

  test("sets the declaration to absent", async () => {
    const response = await request("/sites/test.lychee.land/detach", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await json(response), { ok: true });
    assert.deepEqual(retired, [["test-lychee-land", "absent"]]);
    assert.equal(lastLogEntry().action, "detach-site");
  });

  test("works after the Caddy block is gone, so a failed retirement can be retried", async () => {
    writeFixtures(SEED_CADDYFILE);
    const response = await request("/sites/test.lychee.land/detach", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(retired, [["test-lychee-land", "absent"]]);
  });

  test("no declaration is a 404 and calls nothing", async () => {
    fakeCommands.readDeclarations = () => Promise.resolve([]);
    const response = await request("/sites/test.lychee.land/detach", form({}));
    assert.equal(response.status, 404);
    assert.equal(((await json<{ ok: boolean }>(response)).ok), false);
    assert.deepEqual(retired, []);
  });

  test("a hostname outside the managed domain is a 404 and calls nothing", async () => {
    const response = await request("/sites/evil.example.com/detach", form({}));
    assert.equal(response.status, 404);
    assert.deepEqual(retired, []);
  });

  test("a refused write is a 502 carrying the writer's reason, and is logged", async () => {
    fakeCommands.setDeclarationState = () => Promise.resolve({ ok: false, reason: "push rejected" });
    const response = await request("/sites/test.lychee.land/detach", form({}));
    assert.equal(response.status, 502);
    assert.deepEqual(await json(response), { ok: false, reason: "push rejected" });
    assert.equal(lastLogEntry().action, "detach-site-failed");
  });

  test("an unreadable clone is a 502 saying so, not a 404 claiming nothing is declared", async () => {
    fakeCommands.readDeclarations = () => Promise.resolve(null);
    const response = await request("/sites/test.lychee.land/detach", form({}));
    assert.equal(response.status, 502);
    assert.match((await json<{ reason: string }>(response)).reason, /could not read the local lychee-resources clone/i);
    assert.deepEqual(retired, []);
    assert.equal(lastLogEntry().action, "detach-site-failed");
  });
});
