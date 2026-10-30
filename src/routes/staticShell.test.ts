import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import nodeFs from "node:fs";
import path from "node:path";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";

/*
 * Every client route is one static document: the Vite-built
 * public/client/index.html, read by Express (once at startup in production,
 * per request on the dev server) and sent as it is. React renders the whole
 * body from it, so the server decides only the status.
 */

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;
const ROOT = path.join(__dirname, "..", "..");
const DOCUMENT = "<!doctype html><title>lychee admin</title><!-- marker:static-shell -->";
const MISSING = "client bundle missing; run npm run build";

const CLIENT_ROUTES = ["/", "/sites", "/services", "/reconciler", "/infrastructure", "/sites/new", "/sites/blog.lychee.land", "/sites/api.lychee.land"];

describe("the client routes serve the static document", () => {
  const open: Array<() => Promise<void>> = [];
  after(async () => {
    for (const close of open) await close();
  });

  /** A seeded dev app whose document is whatever `document()` returns on each read. */
  async function start(document: () => string | null, opts: { caddyfile?: boolean } = {}) {
    const { createApp } = await import("../app");
    const { createBackup } = await import("../lib/backup");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");
    const { applySeed, SEEDED_DECLARATIONS } = await import("../dev/seed");
    const { config } = await import("../config");
    const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
    applySeed(fakes.fs);
    if (opts.caddyfile === false) fakes.fs.rmRecursive(config.caddyfilePath);
    const deps: Deps = { commands: fakes.commands, fs: fakes.fs, backup: createBackup(fakes.fs), logger: createLogger(fakes.fs) };
    // A getter, as the dev server defines it: the routes must read it per request.
    Object.defineProperty(deps, "clientDocument", { get: document });
    const server: Server = createApp(deps).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    open.push(async () => {
      server.close();
      await once(server, "close");
    });
    const base = `http://127.0.0.1:${address.port}`;
    return {
      base,
      get: (p: string, init: RequestInit = {}) => fetch(`${base}${p}`, { ...init, headers: { Authorization: AUTH, ...(init.headers ?? {}) } }),
    };
  }

  test("every client route answers 200 with the document, as HTML", async () => {
    const app = await start(() => DOCUMENT);
    for (const route of CLIENT_ROUTES) {
      const res = await app.get(route);
      assert.equal(res.status, 200, route);
      assert.match(res.headers.get("content-type") ?? "", /^text\/html/, route);
      assert.equal(await res.text(), DOCUMENT, route);
    }
  });

  test("GET /sites serves the client document with 200", async () => {
    const app = await start(() => DOCUMENT);
    const res = await app.get("/sites");
    assert.equal(res.status, 200);
    assert.equal(await res.text(), DOCUMENT);
  });

  test("GET /sites/ redirects 308 to /sites", async () => {
    const app = await start(() => DOCUMENT);
    const res = await app.get("/sites/", { redirect: "manual" });
    assert.equal(res.status, 308);
    assert.equal(res.headers.get("location"), "/sites");
  });

  test("a query string changes nothing: ?removed and ?created=1 are the client's to read", async () => {
    const app = await start(() => DOCUMENT);
    for (const route of ["/sites?removed=blog.lychee.land", "/sites/blog.lychee.land?created=1", "/sites/BLOG.lychee.land"]) {
      const res = await app.get(route);
      assert.equal(res.status, 200, route);
      assert.equal(await res.text(), DOCUMENT, route);
    }
  });

  test("an unknown site answers 404 with the same document", async () => {
    const app = await start(() => DOCUMENT);
    for (const route of ["/sites/unknown.lychee.land", "/sites/lychee.local"]) {
      const res = await app.get(route);
      assert.equal(res.status, 404, route);
      assert.equal(await res.text(), DOCUMENT, route);
    }
  });

  test("an unreadable Caddyfile answers 200 everywhere: the pages show its error", async () => {
    const app = await start(() => DOCUMENT, { caddyfile: false });
    for (const route of [...CLIENT_ROUTES, "/sites/unknown.lychee.land"]) {
      const res = await app.get(route);
      assert.equal(res.status, 200, route);
      assert.equal(await res.text(), DOCUMENT, route);
    }
  });

  test("with no document, every client route answers 500 with the text", async () => {
    const app = await start(() => null);
    for (const route of [...CLIENT_ROUTES, "/sites/unknown.lychee.land"]) {
      const res = await app.get(route);
      assert.equal(res.status, 500, route);
      assert.equal(await res.text(), MISSING, route);
    }
  });

  test("reads the document on every request, so the dev server's rebuilds are picked up", async () => {
    let current: string | null = null;
    const app = await start(() => current);
    assert.equal((await app.get("/services")).status, 500);
    current = "<!doctype html><!-- one -->";
    assert.equal(await (await app.get("/services")).text(), current);
    current = "<!doctype html><!-- two -->";
    assert.equal(await (await app.get("/sites/blog.lychee.land")).text(), current);
  });

  test("every client route requires authentication", async () => {
    const app = await start(() => DOCUMENT);
    for (const route of CLIENT_ROUTES) assert.equal((await fetch(`${app.base}${route}`)).status, 401, route);
  });

  test("/api/sites and a write route are unaffected by the document", async () => {
    const app = await start(() => null);
    const sites = await app.get("/api/sites");
    assert.equal(sites.status, 200);
    const body = (await sites.json()) as { ok: boolean; sites: Array<{ hostname: string }> };
    assert.equal(body.ok, true);
    assert.ok(body.sites.some((s) => s.hostname === "blog.lychee.land"));
    const preview = await app.get("/sites/preview", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ hostname: "docs.lychee.land", type: "static" }).toString(),
    });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type") ?? "", /json/);
  });
});

describe("index.html, the Vite input", () => {
  const source = nodeFs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const viteConfig = nodeFs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");

  test("carries the retired server shell's <html>, metas, fonts and /style.css, titled lychee admin", () => {
    assert.match(source, /^<!doctype html>\n<html lang="en" class="\[color-scheme:dark\]">/);
    assert.ok(source.includes('<meta charset="utf-8" />'));
    assert.ok(source.includes('<meta name="viewport" content="width=device-width, initial-scale=1" />'));
    assert.ok(source.includes('<link rel="preconnect" href="https://fonts.googleapis.com" />'));
    assert.ok(source.includes('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />'));
    assert.ok(
      source.includes(
        'href="https://fonts.googleapis.com/css2?family=Poetsen+One&family=Nunito:ital,wght@0,400;0,500;0,600;0,700;1,500&family=DM+Mono:wght@300;400;500&display=swap"',
      ),
    );
    assert.match(source, /<link rel="stylesheet" href="\/style\.css"[^>]*>/);
    assert.ok(source.includes("<title>lychee admin</title>"));
  });

  // The body is only the root and the entry script: the bundle is the only
  // script any page loads (no /app.js, no actionPoll.js), which the retired
  // shell.test.ts and clientShell.test.ts checked of the server's pages.
  // Plus, since 2026-10-29, the collapsed rail's narrower grid (spec
  // 2026-10-29-collapsible-rail), which Navigation turns on with data-rail.
  test("its body has the retired shell's classes and holds only the root and the entry script", () => {
    const body = source.match(/<body class="([^"]*)">([\s\S]*)<\/body>/);
    assert.ok(body, "no <body class> in index.html");
    assert.equal(
      body[1],
      "min-h-screen bg-stone-900 font-sans text-stone-50 m-0 min-[900px]:grid min-[900px]:grid-cols-[250px_minmax(0,1fr)] min-[900px]:data-[rail=collapsed]:grid-cols-[56px_minmax(0,1fr)]",
    );
    assert.equal(
      body[2].trim().replace(/\s*\n\s*/g, "\n"),
      '<div id="react-root" class="contents"></div>\n<script type="module" src="/src/client/main.tsx"></script>',
    );
  });

  // R2: CI runs npm test before npm run build, so this pins the inputs that
  // make every built tag absolute; the built-output test below checks the
  // result whenever a build is present.
  test("the entry is absolute and the build's base is /client/, so a deep path loads the bundle", () => {
    assert.match(viteConfig, /\bbase: "\/client\/"/);
    assert.match(viteConfig, /\binput: "index\.html"/);
    assert.match(viteConfig, /\boutDir: "public\/client"/);
    assert.match(viteConfig, /\bmanifest: true/);
    assert.ok(source.includes('src="/src/client/main.tsx"'));
  });

  test("RF5: the built document's scripts and stylesheets load from any depth", (t) => {
    const built = path.join(ROOT, "public", "client", "index.html");
    if (!nodeFs.existsSync(built)) {
      t.skip("public/client/index.html is absent (run npm run build); the source assertions above still hold");
      return;
    }
    const html = nodeFs.readFileSync(built, "utf8");
    const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    const sheets = [...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 1, "the build wrote no script tag");
    for (const url of [...scripts, ...sheets]) {
      if (url.startsWith("https://fonts.googleapis.com/")) continue;
      assert.ok(url === "/style.css" || url.startsWith("/client/assets/"), url);
    }
    assert.ok(sheets.includes("/style.css"));
    assert.ok(html.includes('<div id="react-root" class="contents"></div>'));
  });
});
