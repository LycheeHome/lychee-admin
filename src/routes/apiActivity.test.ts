import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { ApiOk } from "../shared/board";
import type { ActivityPayload } from "../shared/activity";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;

const AUDIT_AT = "2026-10-20T10:00:00.123Z";
const AUDIT_LINE = JSON.stringify({ timestamp: AUDIT_AT, action: "add-site", hostname: "app.lychee.land" });
const feed = (at: string) =>
  JSON.stringify({
    lifetimes: [
      {
        id: "a",
        name: "swee",
        kind: "container",
        added_at: "2026-10-01T00:00:00Z",
        removed_at: null,
        events: [{ at, type: "stopped" }],
      },
    ],
  });

describe("GET /api/activity", () => {
  const open: Array<() => Promise<void>> = [];
  after(async () => {
    for (const close of open) await close();
  });

  async function start(opts: { audit?: string | null; events?: string | null; caddyfile?: boolean } = {}) {
    const { createApp } = await import("../app");
    const { createBackup } = await import("../lib/backup");
    const { createLogger } = await import("../lib/logger");
    const { createFakes } = await import("../dev/fakes");
    const { applySeed, SEEDED_DECLARATIONS } = await import("../dev/seed");
    const { config } = await import("../config");
    const { EVENTS_PATH } = await import("../lib/platform");
    const fakes = createFakes({}, { declarations: SEEDED_DECLARATIONS });
    applySeed(fakes.fs);
    fakes.fs.rmRecursive(config.logFile);
    fakes.fs.rmRecursive(EVENTS_PATH);
    if (opts.audit) fakes.fs.writeFile(config.logFile, `${opts.audit}\n`);
    if (opts.events) fakes.fs.writeFile(EVENTS_PATH, opts.events);
    let fs = fakes.fs;
    if (opts.caddyfile === false) {
      fs = {
        ...fakes.fs,
        readFile: (p: string) => {
          if (p === config.caddyfilePath) throw new Error("EACCES");
          return fakes.fs.readFile(p);
        },
      };
    }
    const deps: Deps = { commands: fakes.commands, fs, backup: createBackup(fs), logger: createLogger(fs), clientDocument: "<!doctype html><title>lychee admin</title>" };
    const server: Server = createApp(deps).listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    open.push(async () => {
      server.close();
      await once(server, "close");
    });
    return `http://127.0.0.1:${address.port}`;
  }
  const get = async (base: string, query = "") => {
    const res = await fetch(`${base}/api/activity${query}`, { headers: { Authorization: AUTH } });
    return { res, body: (await res.json()) as ApiOk<ActivityPayload> };
  };

  test("both sources", async () => {
    const { res, body } = await get(await start({ audit: AUDIT_LINE, events: feed("2026-10-21T00:00:00Z") }));
    assert.equal(res.status, 200);
    assert.deepEqual(body.sources, { app: true, reconciler: true });
    assert.equal(body.events.length, 2);
    assert.equal(body.events[0].who, "reconciler");
    assert.equal(body.events[1].who, "app");
    assert.ok(!Number.isNaN(Date.parse(body.now)));
  });

  test("no audit log", async () => {
    const { body } = await get(await start({ events: feed("2026-10-21T00:00:00Z") }));
    assert.deepEqual(body.sources, { app: false, reconciler: true });
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].who, "reconciler");
  });

  test("no events feed", async () => {
    const { body } = await get(await start({ audit: AUDIT_LINE }));
    assert.deepEqual(body.sources, { app: true, reconciler: false });
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].who, "app");
  });

  test("neither", async () => {
    const { res, body } = await get(await start());
    assert.equal(res.status, 200);
    assert.deepEqual(body.events, []);
    assert.deepEqual(body.sources, { app: false, reconciler: false });
  });

  test("limit default, cap and garbage", async () => {
    const { parseLimit } = await import("./activity");
    assert.equal(parseLimit(undefined), 8);
    assert.equal(parseLimit("0"), 8);
    assert.equal(parseLimit("x"), 8);
    assert.equal(parseLimit("12"), 12);
    assert.equal(parseLimit("999"), 50);
    const lines = [1, 2, 3].map((n) =>
      JSON.stringify({ timestamp: `2026-10-20T10:00:0${n}.000Z`, action: "add-site", hostname: "app.lychee.land" }),
    );
    const { body } = await get(await start({ audit: lines.join("\n") }), "?limit=2");
    assert.equal(body.events.length, 2);
  });

  test("an unreadable Caddyfile still answers, with no site links", async () => {
    const { res, body } = await get(await start({ audit: AUDIT_LINE, caddyfile: false }));
    assert.equal(res.status, 200);
    assert.equal(body.events.length, 1);
    assert.equal(body.events[0].subject, "app.lychee.land");
    assert.equal(body.events[0].href, null);
  });

  const getRaw = async (base: string, query: string) => {
    const res = await fetch(`${base}/api/activity${query}`, { headers: { Authorization: AUTH } });
    return { res, body: (await res.json()) as { ok: boolean; reason?: string } };
  };

  test("an unknown who, kind or cursor answers 400 naming the parameter", async () => {
    const base = await start({ audit: AUDIT_LINE });
    for (const [q, word] of [["?who=bot", "who"], ["?kind=deploys", "kind"], ["?before=garbage", "cursor"]] as const) {
      const { res, body } = await getRaw(base, q);
      assert.equal(res.status, 400);
      assert.equal(body.ok, false);
      assert.match(body.reason ?? "", new RegExp(word));
    }
  });

  test("a subject with no events is empty but subjects still lists everything", async () => {
    const { res, body } = await get(await start({ audit: AUDIT_LINE }), "?subject=nothing.lychee.land");
    assert.equal(res.status, 200);
    assert.deepEqual(body.events, []);
    assert.equal(body.next, null);
    assert.deepEqual(body.subjects, ["app.lychee.land"]);
  });

  test("who filter pages by cursor", async () => {
    const events = JSON.stringify({
      lifetimes: [
        {
          id: "a",
          name: "swee",
          kind: "container",
          added_at: "2026-10-01T00:00:00Z",
          removed_at: null,
          events: [1, 2, 3].map((n) => ({ at: `2026-10-2${n}T00:00:00Z`, type: "stopped" })),
        },
      ],
    });
    const base = await start({ audit: AUDIT_LINE, events });
    const first = await get(base, "?limit=2&who=reconciler");
    assert.equal(first.body.events.length, 2);
    assert.ok(first.body.events.every((e) => e.who === "reconciler"));
    assert.ok(first.body.next);
    const second = await get(base, `?limit=2&who=reconciler&before=${encodeURIComponent(first.body.next!)}`);
    assert.equal(second.body.events.length, 1);
    assert.equal(second.body.events[0].at, "2026-10-21T00:00:00Z");
    assert.equal(second.body.next, null);
  });

  test("the whole audit log is read, not a tail", async () => {
    const lines = Array.from({ length: 250 }, (_, n) =>
      JSON.stringify({
        timestamp: new Date(Date.UTC(2026, 9, 1, 0, 0, n)).toISOString(),
        action: "add-site",
        hostname: "app.lychee.land",
      }),
    );
    const base = await start({ audit: lines.join("\n") });
    let before = "";
    let total = 0;
    let oldest = "";
    for (let page = 0; page < 10; page++) {
      const { body } = await get(base, `?limit=50${before}`);
      total += body.events.length;
      if (body.events.length) oldest = body.events[body.events.length - 1].at;
      if (!body.next) break;
      before = `&before=${encodeURIComponent(body.next)}`;
    }
    assert.equal(total, 250);
    assert.equal(oldest, "2026-10-01T00:00:00.000Z");
  });

  test("the overview's limit=8 read pages on when more exist", async () => {
    const lines = Array.from({ length: 10 }, (_, n) =>
      JSON.stringify({ timestamp: `2026-10-20T10:00:0${n}.000Z`, action: "add-site", hostname: "app.lychee.land" }),
    );
    const { body } = await get(await start({ audit: lines.join("\n") }), "?limit=8");
    assert.equal(body.events.length, 8);
    assert.ok(body.next);
  });

  test("GET /activity answers the client document", async () => {
    const base = await start();
    const res = await fetch(`${base}/activity`, { headers: { Authorization: AUTH } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /html/);
    assert.match(await res.text(), /lychee admin/);
  });
});
