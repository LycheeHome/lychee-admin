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

  test("states the DNS reminder after a removal", async () => {
    const response = await request("/?removed=blog.lyly.dev");
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
    // api.lyly.dev is the seeded plain proxy on port 4000. Nothing listens
    // there during the test, so the tcp check resolves either way — the
    // assertion is that a canonical status word reached the card at all.
    assert.match(page, /<span aria-hidden="true">&#9679;<\/span> (responding|not responding)/);
  });

  test("says nothing about a static site's liveness", async () => {
    const page = withoutHeader(await (await request("/")).text());
    const card = page.match(/<a href="\/sites\/blog\.lyly\.dev"[\s\S]*?<\/a>/)?.[0] ?? "";
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

    const response = await request("/?removed=blog.lyly.dev");

    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /id="page-notice"/);
    assert.match(body, /Remember to remove the DNS record/);
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
  const OK_ADD_STEPS = [
    { id: "backup", label: "Configs backed up", status: "ok" },
    { id: "caddyfile", label: "Caddyfile block appended", status: "ok" },
    { id: "files", label: "Site directory created", status: "ok" },
    { id: "tunnel", label: "Tunnel route added", status: "ok" },
    { id: "caddy", label: "Caddy validated and reloaded", status: "ok" },
    { id: "cloudflared", label: "cloudflared-sites restarted", status: "ok" },
  ];

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
      steps: OK_ADD_STEPS,
    });

    assert.match(fakeFs.readFile(CADDYFILE), /http:\/\/new\.lyly\.dev \{/);
    assert.match(fakeFs.readFile(TUNNEL_CONFIG), /hostname: new\.lyly\.dev/);
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "new.lyly.dev")), true);
    assert.match(
      fakeFs.readFile(path.join(SITES_ROOT, "new.lyly.dev", "index.html")),
      /Site created by lyly-admin/,
    );
  });

  test("a static site reports every step as ok", async () => {
    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "static" }));
    const body = await json<{ steps: { status: string }[] }>(response);
    assert.ok(body.steps.every((step) => step.status === "ok"));
  });

  test("rejects a hostname outside the managed domain", async () => {
    const response = await request("/sites", form({ hostname: "evil.example.com", type: "static" }));
    assert.equal(response.status, 400);
    assert.match((await json<{ error: string }>(response)).error, /must be a subdomain of lyly\.dev/);
  });

  test("rejects a hostname that already exists", async () => {
    const response = await request("/sites", form({ hostname: "blog.lyly.dev", type: "static" }));
    assert.equal(response.status, 500);
    const body = await json<{ error: string; steps: { id: string; status: string }[] }>(response);
    assert.match(body.error, /already exists in the Caddyfile/);
    // This throws before report.run("backup", ...) ever executes, so the
    // response must not claim backups were saved — see the "backup"
    // step's own status, which stays "not-run".
    assert.equal(body.steps.find((step) => step.id === "backup")?.status, "not-run");
    assert.doesNotMatch(body.error, /Backed-up copies/);
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

  test("a plain reverse-proxy site skips the directory step rather than failing it", async () => {
    const response = await request("/sites", form({ hostname: "new.lyly.dev", type: "reverse-proxy", port: "4100" }));
    const body = await json<{ steps: { id: string; status: string }[] }>(response);
    const files = body.steps.find((step) => step.id === "files");
    assert.equal(files?.status, "skipped");
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
  const OK_REMOVE_STEPS = [
    { id: "caddyfile", label: "Caddyfile block removed", status: "ok" },
    { id: "tunnel", label: "Tunnel route removed", status: "ok" },
    { id: "caddy", label: "Caddy validated and reloaded", status: "ok" },
    { id: "cloudflared", label: "cloudflared-sites restarted", status: "ok" },
  ];

  test("removes the Caddyfile block and the ingress rule", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      removed: true,
      needsFileConfirm: false,
      steps: OK_REMOVE_STEPS,
    });

    assert.doesNotMatch(fakeFs.readFile(CADDYFILE), /http:\/\/blog\.lyly\.dev \{/);
    assert.doesNotMatch(fakeFs.readFile(TUNNEL_CONFIG), /hostname: blog\.lyly\.dev/);
  });

  test("reports the path to confirm when file deletion was requested", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));
    assert.deepEqual(await response.json(), {
      removed: true,
      needsFileConfirm: true,
      sitePath: `${SITES_ROOT}/blog.lyly.dev`,
      steps: OK_REMOVE_STEPS,
    });
  });

  test("does not delete files as part of the same request", async () => {
    fakeFs.mkdir(path.join(SITES_ROOT, "blog.lyly.dev"));
    fakeFs.writeFile(path.join(SITES_ROOT, "blog.lyly.dev", "index.html"), "content");

    await request("/sites/blog.lyly.dev/delete", form({ deleteFiles: "on" }));

    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "blog.lyly.dev", "index.html")), true);
  });

  test("a successful removal reports all four steps as ok", async () => {
    const response = await request("/sites/blog.lyly.dev/delete", form({}));
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
      const response = await fetch(`${localBaseUrl}/sites/blog.lyly.dev/delete`, {
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
      const response = await fetch(`${localBaseUrl}/sites/blog.lyly.dev/delete`, {
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

describe("POST /sites/preview", () => {
  test("returns the Caddyfile block that POST /sites would append", async () => {
    const response = await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; preview: { caddy: { added: string[] } } }>(response);
    assert.equal(body.ready, true);
    assert.deepEqual(body.preview.caddy.added, [
      "http://docs.lyly.dev {",
      `\troot * ${SITES_ROOT}/docs.lyly.dev`,
      "\tfile_server",
      "}",
    ]);
  });

  test("writes nothing — the Caddyfile is byte-identical afterwards", async () => {
    const before = fakeFs.readFile(CADDYFILE);
    const beforeTunnel = fakeFs.readFile(TUNNEL_CONFIG);
    await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "static" }));
    assert.equal(fakeFs.readFile(CADDYFILE), before);
    assert.equal(fakeFs.readFile(TUNNEL_CONFIG), beforeTunnel);
  });

  test("creates no site directory", async () => {
    await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "static" }));
    // hasDir/hasFile, not exists — the in-memory fake exposes those two
    // (src/dev/fakes.ts), and the static-add test above already uses hasDir.
    assert.equal(fakeFs.hasDir(path.join(SITES_ROOT, "docs.lyly.dev")), false);
    assert.equal(fakeFs.hasFile(path.join(SITES_ROOT, "docs.lyly.dev", "index.html")), false);
  });

  test("an empty hostname is not ready and not an error — the form is merely early", async () => {
    const response = await request("/sites/preview", form({ hostname: "", type: "static" }));
    assert.equal(response.status, 200);
    const body = await json<{ ready: boolean; error?: string }>(response);
    assert.equal(body.ready, false);
    assert.equal(body.error, undefined);
  });

  test("reports a duplicate hostname before submit, in the submit's own words", async () => {
    const response = await request("/sites/preview", form({ hostname: "blog.lyly.dev", type: "static" }));
    const body = await json<{ ready: boolean; error: string }>(response);
    assert.equal(body.ready, false);
    assert.equal(body.error, "blog.lyly.dev already exists in the Caddyfile");
  });

  test("reports a port conflict with the same string the submit would return", async () => {
    const preview = await json<{ error: string }>(
      await request("/sites/preview", form({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4000" })),
    );
    const submit = await json<{ error: string }>(
      await request("/sites", form({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4000" })),
    );
    assert.equal(preview.error, submit.error);
  });

  test("marks the directory step as not running for a plain reverse proxy", async () => {
    const response = await request(
      "/sites/preview",
      form({ hostname: "docs.lyly.dev", type: "reverse-proxy", port: "4100" }),
    );
    const body = await json<{ preview: { steps: { id: string; willRun: boolean }[] } }>(response);
    const skipped = body.preview.steps.filter((step) => !step.willRun).map((step) => step.id);
    assert.deepEqual(skipped, ["files"]);
  });

  test("requires authentication like every other route", async () => {
    const response = await fetch(`${baseUrl}/sites/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ hostname: "docs.lyly.dev" }).toString(),
    });
    assert.equal(response.status, 401);
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
