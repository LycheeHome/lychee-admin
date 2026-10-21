import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import type { Deps } from "../deps";
import type { ClientAssets } from "../views/clientShell";
import type { SystemCommands } from "../lib/systemCommands";
import { withoutHeader } from "../dev/testHelpers";

const PASSWORD = "test-password";
process.env.ADMIN_USERNAME = "tester";
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
process.env.DOMAIN = "lychee.land";
process.env.PORT = "8787";
process.env.LOG_FILE = "/var/log/lychee-admin/actions.log";
process.env.BACKUP_DIR = "/etc/lychee-admin/backups";

const AUTH = `Basic ${Buffer.from(`tester:${PASSWORD}`).toString("base64")}`;
const INVENTORY_PATH = "/var/lib/lychee-inventory/services.json";

function inventory(services: unknown[]): string {
  return JSON.stringify({ generated: "2026-10-02T04:58:02Z", services });
}

const RECONCILER = [
  { name: "lychee-reconcile-timer", unit: "lychee-reconcile.timer", group: "reconciler", reconciled: false },
  { name: "lychee-reconcile", unit: "lychee-reconcile.service", group: "reconciler", reconciled: false },
];
const SWEE = { name: "swee", unit: "swee.service", group: "service", reconciled: true, result: "skipped" };

async function serve(
  inventoryJson: string | null,
  overrides: Partial<SystemCommands>,
  seed: { opRun?: { delayMs?: number } } = {},
  clientAssets?: ClientAssets | null,
): Promise<{ base: string; fs: Deps["fs"]; get: (p: string) => Promise<Response>; actions: () => string[]; audit: () => Record<string, unknown>[]; close: () => Promise<void> }> {
  const { createApp } = await import("../app");
  const { createBackup } = await import("../lib/backup");
  const { createLogger } = await import("../lib/logger");
  const { createFakes } = await import("../dev/fakes");
  const fakes = createFakes(overrides, seed);
  if (inventoryJson !== null) fakes.fs.writeFile(INVENTORY_PATH, inventoryJson);
  const deps: Deps = {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
    clientAssets,
  };
  const server: Server = createApp(deps).listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    fs: fakes.fs,
    get: (p) => fetch(`${base}${p}`, { headers: { Authorization: AUTH } }),
    audit: () => {
      const file = process.env.LOG_FILE as string;
      if (!fakes.fs.exists(file)) return [];
      return fakes.fs.readFile(file).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    actions: () => {
      const file = process.env.LOG_FILE as string;
      if (!fakes.fs.exists(file)) return [];
      return fakes.fs
        .readFile(file)
        .split("\n")
        .filter(Boolean)
        .map((l) => (JSON.parse(l) as { action: string }).action);
    },
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

/** The status word of each rendered row, in page order. */
function pills(html: string): string[] {
  return [...html.matchAll(/&#9679;<\/span> ([a-z ]+)<\/span>/g)].map((m) => m[1]);
}

describe("GET /services", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  test("requires authentication", async () => {
    const s = await start(null, {});
    const res = await fetch(`${s.base}/services`);
    assert.equal(res.status, 401);
  });

  test("reads states once for every declared unit and finds the timer from the data", async () => {
    let stateCalls = 0;
    let requested: string[] = [];
    const timers: string[] = [];
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: (units) => {
        stateCalls++;
        requested = units;
        return Promise.resolve({ "swee.service": { status: "running", since: null } });
      },
      readTimerSchedule: (t) => {
        timers.push(t);
        return Promise.resolve({ next: new Date(Date.now() + 180_000), last: null });
      },
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateCalls, 1);
    assert.deepEqual(requested, ["lychee-reconcile.timer", "lychee-reconcile.service", "swee.service"]);
    assert.deepEqual(timers, ["lychee-reconcile.timer"]);
    assert.deepEqual(pills(html), ["running"]);
    // The schedule is shown where the timer's row is: on the reconciler page.
    assert.match(await (await s.get("/reconciler")).text(), /next run in 3 minutes/);
  });

  test("a reconciler entry that is not a timer is not mistaken for one", async () => {
    const timers: string[] = [];
    const s = await start(inventory([RECONCILER[1], SWEE]), {
      readTimerSchedule: (t) => {
        timers.push(t);
        return Promise.resolve({ next: null, last: null });
      },
    });
    const html = await (await s.get("/reconciler")).text();
    assert.deepEqual(timers, []);
    assert.ok(!html.includes("next run"));
  });

  test("a timer in another group is not the reconciler's timer", async () => {
    const timers: string[] = [];
    const s = await start(
      inventory([{ name: "x", unit: "x.timer", group: "service", reconciled: false }]),
      { readTimerSchedule: (t) => (timers.push(t), Promise.resolve({ next: null, last: null })) },
    );
    await s.get("/services");
    assert.deepEqual(timers, []);
  });

  test("a missing inventory yields a page, not an error", async () => {
    const s = await start(null, {});
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("inventory-unavailable"));
    assert.deepEqual(pills(html), []);
  });

  test("unreadable systemctl degrades every row to unknown", async () => {
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: () => Promise.reject(new Error("systemctl not found")),
    });
    const statuses: string[] = [];
    for (const page of ["/services", "/reconciler"]) {
      const res = await s.get(page);
      assert.equal(res.status, 200);
      statuses.push(...pills(await res.text()));
    }
    assert.equal(statuses.length, 3);
    assert.ok(statuses.every((st) => st === "unknown"));
  });

  test("a failed schedule read leaves liveness intact", async () => {
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
      readTimerSchedule: () => Promise.reject(new Error("boom")),
    });
    const res = await s.get("/reconciler");
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes("next run"));
    assert.deepEqual(pills(await (await s.get("/services")).text()), ["running"]);
  });

  test("the two reads run concurrently", async () => {
    let releaseStates: () => void = () => undefined;
    let scheduleStarted = false;
    const s = await start(inventory(RECONCILER), {
      readUnitStates: () =>
        new Promise((resolve) => {
          releaseStates = () => resolve({});
        }),
      readTimerSchedule: () => {
        scheduleStarted = true;
        releaseStates();
        return Promise.resolve({ next: null, last: null });
      },
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    assert.ok(scheduleStarted);
  });

  const CONTAINER = {
    name: "palsave-api", kind: "container", container: "palsave-api", group: "service", reconciled: true, version: "0.3.0",
  };

  test("container rows render beside unit rows, and are not asked of systemctl", async () => {
    let requested: string[] = [];
    const projects: string[] = [];
    const s = await start(inventory([SWEE, CONTAINER]), {
      readUnitStates: (units) => {
        requested = units;
        return Promise.resolve({ "swee.service": { status: "running", since: null } });
      },
      readResourceStatus: (p) => {
        projects.push(p);
        return Promise.resolve("unhealthy");
      },
    });
    const html = await (await s.get("/services")).text();
    assert.deepEqual(requested, ["swee.service"]);
    assert.deepEqual(projects, ["palsave-api"]);
    assert.deepEqual(pills(html), ["running", "unhealthy"]);
  });

  test("a failed container status read degrades to unknown, not a 500", async () => {
    const s = await start(inventory([SWEE, CONTAINER]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
      readResourceStatus: () => Promise.reject(new Error("docker not found")),
    });
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    assert.deepEqual(pills(await res.text()), ["running", "unknown"]);
  });

  test("an unknown container renders neutral, not as a failure", async () => {
    const s = await start(inventory([CONTAINER]), {
      readResourceStatus: () => Promise.resolve("unknown"),
    });
    const html = await (await s.get("/services")).text();
    const { TONE_PILL } = await import("../views/shared");
    assert.ok(html.includes(TONE_PILL.neutral));
    assert.ok(!html.includes(TONE_PILL.bad));
  });

  test("an inventory with no kind still renders its units", async () => {
    const s = await start(inventory([SWEE]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
    });
    assert.deepEqual(pills(await (await s.get("/services")).text()), ["running"]);
  });

  test("container reads run concurrently with each other", async () => {
    const release: Array<() => void> = [];
    let started = 0;
    const s = await start(
      inventory([CONTAINER, { ...CONTAINER, name: "b", container: "b" }]),
      {
        readResourceStatus: () =>
          new Promise((resolve) => {
            started++;
            release.push(() => resolve("running"));
            if (started === 2) release.forEach((r) => r());
          }),
      },
    );
    const res = await s.get("/services");
    assert.equal(res.status, 200);
    assert.equal(started, 2);
  });
});

describe("the three board pages", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  /** The data-service names of the rendered rows, in page order. */
  const rows = (html: string): string[] => [...html.matchAll(/<li [^>]*data-service="([^"]+)"/g)].map((m) => m[1]);
  /** The page's eyebrow: the h2 that names its group. */
  const eyebrow = (html: string): string | undefined => html.match(/<h2 [^>]*>([^<]*)<\/h2>/)?.[1];
  const currentItems = (html: string): string[] =>
    [...html.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g)].map((m) => m[1]);

  const PAGES = [
    { path: "/services", eyebrow: "Services", only: ["lychee-admin", "swee", "palsave-api"], never: ["lychee-reconcile-timer", "caddy"] },
    { path: "/reconciler", eyebrow: "Reconciler", only: ["lychee-reconcile-timer", "lychee-watch-timer"], never: ["swee", "caddy"] },
  ];

  for (const page of PAGES) {
    test(`${page.path} renders only its own group's rows, under its own eyebrow`, async () => {
      const { SEEDED_INVENTORY } = await import("../dev/seed");
      const s = await start(SEEDED_INVENTORY, {});
      const res = await s.get(page.path);
      assert.equal(res.status, 200);
      const html = await res.text();
      const names = rows(html);
      for (const name of page.only) assert.ok(names.includes(name), `${page.path} is missing ${name}`);
      for (const name of page.never) assert.ok(!names.includes(name), `${page.path} shows ${name}`);
      assert.equal(eyebrow(html), page.eyebrow);
      assert.match(html, /Inventory written/);
      // One group per page, so no group heading beneath the eyebrow.
      assert.doesNotMatch(html, /<h3[^>]*>(Reconciler|Services|Infrastructure)<\/h3>/);
    });

    test(`${page.path} marks exactly its own header item current`, async () => {
      const { SEEDED_INVENTORY } = await import("../dev/seed");
      const s = await start(SEEDED_INVENTORY, {});
      assert.deepEqual(currentItems(await (await s.get(page.path)).text()), [page.path]);
    });

    test(`${page.path} explains a missing inventory instead of erroring`, async () => {
      const s = await start(null, {});
      const res = await s.get(page.path);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('id="inventory-unavailable"'));
      assert.equal(eyebrow(html), page.eyebrow);
    });

    test(`${page.path} requires authentication`, async () => {
      const s = await start(null, {});
      assert.equal((await fetch(`${s.base}${page.path}`)).status, 401);
    });
  }

  test("a readable inventory with nothing in a page's group says so in one sentence", async () => {
    const s = await start(inventory([SWEE]), {});
    for (const path of ["/reconciler"]) {
      const html = await (await s.get(path)).text();
      assert.ok(html.includes('id="group-empty"'), path);
      assert.ok(!html.includes('id="inventory-unavailable"'), path);
      assert.deepEqual(rows(html), [], path);
    }
    const services = await (await s.get("/services")).text();
    assert.ok(!services.includes('id="group-empty"'));
    assert.deepEqual(rows(services), ["swee"]);
  });

  test("every page reads the whole board once: one systemctl call for every declared unit", async () => {
    const calls: string[][] = [];
    const s = await start(inventory([...RECONCILER, SWEE]), {
      readUnitStates: (units) => (calls.push(units), Promise.resolve({})),
    });
    for (const path of ["/services", "/reconciler"]) await s.get(path);
    assert.equal(calls.length, 2);
    for (const units of calls) assert.deepEqual(units, ["lychee-reconcile.timer", "lychee-reconcile.service", "swee.service"]);
  });
});

describe("GET /infrastructure: the React mount", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const ASSETS: ClientAssets = { script: "assets/main-abc.js", styles: ["assets/main-def.css"] };

  test("serves the shell with the mount point and the bundle", async () => {
    current = await serve(null, {}, {}, ASSETS);
    const res = await current.get("/infrastructure");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('id="app-root" data-page="infrastructure"'));
    assert.ok(html.includes('<script type="module" src="/client/assets/main-abc.js">'));
    assert.match(html, /<a href="\/infrastructure"[^>]*aria-current="page"/);
    await current.close();
  });

  test("answers 500 when the bundle is missing", async () => {
    current = await serve(null, {}, {}, null);
    const res = await current.get("/infrastructure");
    assert.equal(res.status, 500);
    assert.equal(await res.text(), "client bundle missing; run npm run build");
    await current.close();
  });

  test("requires authentication", async () => {
    current = await serve(null, {}, {}, ASSETS);
    assert.equal((await fetch(`${current.base}/infrastructure`)).status, 401);
    await current.close();
  });
});

describe("GET /services: Prune on retired site rows", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const site = (name: string) => ({ name, kind: "container", container: name, group: "service", reconciled: true, result: "deployed" });
  const PALSAVE = { name: "palsave-api", unit: "palsave-api.service", group: "service", reconciled: true, result: "deployed" };
  const DECLS = [
    { name: "gone-lychee-land", port: 3400, state: "absent", image: "ghcr.io/lycheehome/gone" },
    { name: "app-lychee-land", port: 3200, state: "running", image: "ghcr.io/lycheehome/app:0.2.0" },
    { name: "palsave-api", port: 8788, state: "absent", image: "ghcr.io/lycheehome/palsave-api" },
  ];
  async function board(readDeclarations: SystemCommands["readDeclarations"]): Promise<string> {
    await current?.close();
    current = await serve(inventory([site("gone-lychee-land"), site("app-lychee-land"), PALSAVE]), { readDeclarations });
    const res = await current.get("/services");
    assert.equal(res.status, 200);
    return res.text();
  }
  const pruned = (html: string) => [...html.matchAll(/data-prune="([^"]+)"/g)].map((m) => m[1]);

  test("only a site whose declaration is absent gets the control", async () => {
    assert.deepEqual(pruned(await board(() => Promise.resolve(DECLS))), ["gone-lychee-land"]);
  });

  test("an unreadable clone shows no control anywhere", async () => {
    assert.deepEqual(pruned(await board(() => Promise.resolve(null))), []);
  });

  test("a declarations read that throws still renders the board, without the control", async () => {
    assert.deepEqual(pruned(await board(() => Promise.reject(new Error("boom")))), []);
  });
});

describe("POST /services/:name/deploy", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const NOTES = { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
    version: "v1.4.0", target: "v1.4.0", available: "v1.5.0" };

  async function post(inv: unknown[], overrides: Partial<SystemCommands>, name = "notes") {
    await current?.close();
    current = await serve(inventory(inv), overrides);
    return fetch(`${current.base}/services/${name}/deploy`, { method: "POST", headers: { Authorization: AUTH } });
  }

  test("requires authentication", async () => {
    current = await serve(inventory([NOTES]), {});
    const res = await fetch(`${current.base}/services/notes/deploy`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  test("writes the inventory's available tag, never one from the request", async () => {
    const writes: Array<[string, string]> = [];
    const res = await post([NOTES], { writeDeclarationTag: (n, t) => (writes.push([n, t]), Promise.resolve({ ok: true })) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, tag: "v1.5.0" });
    assert.deepEqual(writes, [["notes", "v1.5.0"]]);
  });

  test("a write failure renders the reason, not a 500", async () => {
    const res = await post([NOTES], { writeDeclarationTag: () => Promise.resolve({ ok: false, reason: "push rejected" }) });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { ok: false, reason: "push rejected" });
  });

  test("Deploy for a tag that no longer exists reports the apply failure", async () => {
    const reason = "No declaration named notes.yml in lychee-resources.";
    const res = await post([NOTES], { writeDeclarationTag: () => Promise.resolve({ ok: false, reason }) });
    assert.equal(((await res.json()) as { reason: string }).reason, reason);
  });

  test("a writer that throws despite its contract still answers with a reason", async () => {
    const res = await post([NOTES], { writeDeclarationTag: () => Promise.reject(new Error("boom")) });
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { reason: string }).reason, /boom/);
  });

  test("an unknown service, or one with nothing on offer, writes nothing", async () => {
    let writes = 0;
    const overrides = { writeDeclarationTag: () => (writes++, Promise.resolve({ ok: true as const })) };
    assert.equal((await post([NOTES], overrides, "ghost")).status, 404);
    assert.equal((await post([{ ...NOTES, available: undefined }], overrides)).status, 409);
    assert.equal((await post([{ ...NOTES, available: "v1.4.0" }], overrides)).status, 409);
    assert.equal(writes, 0);
  });

  test("a failed row with a newer tag accepts the deploy and writes that tag", async () => {
    const writes: Array<[string, string]> = [];
    const failed = { ...NOTES, target: "v1.5.0", available: "v1.6.0", result: "failed", failed_step: "Start the container: exit 1" };
    const res = await post([failed], { writeDeclarationTag: (n, t) => (writes.push([n, t]), Promise.resolve({ ok: true })) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, tag: "v1.6.0" });
    assert.deepEqual(writes, [["notes", "v1.6.0"]]);
  });

  test("a tag already requested is a 409 and writes nothing", async () => {
    let writes = 0;
    const overrides = { writeDeclarationTag: () => (writes++, Promise.resolve({ ok: true as const })) };
    assert.equal((await post([{ ...NOTES, target: "v1.5.0" }], overrides)).status, 409);
    assert.equal(writes, 0);
  });
});

describe("GET /services — a pending Deploy", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const ROW = { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
    version: "v1.4.0", target: "v1.4.0", available: "v1.5.0" };
  const ahead = [{ name: "notes", port: 3000, state: "running", image: "ghcr.io/lycheehome/notes:v1.5.0" }];

  async function rowHtml(overrides: Partial<SystemCommands>): Promise<string> {
    await current?.close();
    current = await serve(inventory([ROW]), overrides);
    const res = await current.get("/services");
    assert.equal(res.status, 200);
    return (await res.text()).replace(/<template[\s\S]*?<\/template>/g, "");
  }

  test("a declaration ahead of the inventory shows the requested line, not the offer", async () => {
    const html = await rowHtml({ readDeclarations: () => Promise.resolve(ahead) });
    assert.match(html, /data-requested/);
    assert.doesNotMatch(html, /data-deploy="notes"/);
  });

  test("an unreadable clone renders the offer", async () => {
    for (const readDeclarations of [() => Promise.resolve(null), () => Promise.reject(new Error("x"))]) {
      const html = await rowHtml({ readDeclarations });
      assert.doesNotMatch(html, /data-requested/);
      assert.match(html, /data-deploy="notes"/);
    }
  });
});

describe("POST /resources/:name/prune", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const SITE = "test-lychee-land";
  const DOWN = { name: SITE, kind: "container", container: SITE, group: "service", reconciled: true, result: "deployed" };
  const DECL = [{ name: SITE, port: 3000, state: "absent", image: "ghcr.io/lycheehome/x" }];
  const CONFIRM_REASON = "the container hasn't been confirmed down yet; try after the next reconcile";

  async function post(inv: unknown[], overrides: Partial<SystemCommands>, name = SITE) {
    await current?.close();
    current = await serve(inventory(inv), overrides);
    return fetch(`${current.base}/resources/${name}/prune`, { method: "POST", headers: { Authorization: AUTH } });
  }
  function spy(result: Awaited<ReturnType<SystemCommands["pruneSiteDeclaration"]>> = { ok: true }) {
    const calls: string[] = [];
    const opts: unknown[] = [];
    return {
      calls,
      opts,
      overrides: {
        readDeclarations: () => Promise.resolve(DECL),
        pruneSiteDeclaration: (n: string, o?: { requireTagless?: boolean }) => (calls.push(n), opts.push(o), Promise.resolve(result)),
      },
    };
  }

  test("requires authentication", async () => {
    current = await serve(inventory([DOWN]), {});
    const res = await fetch(`${current.base}/resources/${SITE}/prune`, { method: "POST" });
    assert.equal(res.status, 401);
  });

  test("a confirmed-down retired site is pruned", async () => {
    const { calls, overrides } = spy();
    const res = await post([DOWN], overrides);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(calls, [SITE]);
  });

  test("awaiting-image counts as confirmed down, but only for a tagless declaration", async () => {
    const { calls, opts, overrides } = spy();
    const res = await post([{ ...DOWN, result: "awaiting-image" }], overrides);
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [SITE]);
    assert.deepEqual(opts, [{ requireTagless: true }]);
  });

  test("deployed does not ask the writer for a tagless declaration", async () => {
    const { opts, overrides } = spy();
    await post([DOWN], overrides);
    assert.deepEqual(opts, [{ requireTagless: false }]);
  });

  test("awaiting-image with a writer tagged refusal is the not-confirmed-down 409", async () => {
    const res = await post(
      [{ ...DOWN, result: "awaiting-image" }],
      spy({ ok: false, code: "tagged", reason: "test-lychee-land.yml has a tag" }).overrides,
    );
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { ok: false, reason: CONFIRM_REASON });
  });

  test("an installed version, a failed result or no inventory entry is a 409 and writes nothing", async () => {
    const { calls, overrides } = spy();
    for (const inv of [[{ ...DOWN, version: "v1" }], [{ ...DOWN, result: "failed" }], []]) {
      const res = await post(inv, overrides);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { ok: false, reason: CONFIRM_REASON });
    }
    assert.equal(calls.length, 0);
  });

  test("an unreadable clone is a 502", async () => {
    const { calls, overrides } = spy();
    const res = await post([DOWN], { ...overrides, readDeclarations: () => Promise.resolve(null) });
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    assert.equal(calls.length, 0);
  });

  test("no such declaration is a 404", async () => {
    const { calls, overrides } = spy();
    const res = await post([DOWN], { ...overrides, readDeclarations: () => Promise.resolve([]) });
    assert.equal(res.status, 404);
    assert.equal(calls.length, 0);
  });

  test("writer refusals map: not-absent 409, missing 404, other 502", async () => {
    const reason = "writer said no";
    assert.equal((await post([DOWN], spy({ ok: false, reason, code: "not-absent" }).overrides)).status, 409);
    assert.equal((await post([DOWN], spy({ ok: false, reason, code: "missing" }).overrides)).status, 404);
    const res = await post([DOWN], spy({ ok: false, reason }).overrides);
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { ok: false, reason });
  });

  test("a writer that throws still answers with a reason", async () => {
    const { overrides } = spy();
    const res = await post([DOWN], { ...overrides, pruneSiteDeclaration: () => Promise.reject(new Error("boom")) });
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { reason: string }).reason, /boom/);
  });

  test("a success logs prune-declaration exactly once", async () => {
    await post([DOWN], spy().overrides);
    assert.deepEqual(current?.actions(), ["prune-declaration"]);
  });

  test("a 404 (no declaration) and a 409 (not confirmed down) each log one prune-declaration-refused with a reason", async () => {
    await post([DOWN], { ...spy().overrides, readDeclarations: () => Promise.resolve([]) });
    assert.deepEqual(current?.actions(), ["prune-declaration-refused"]);
    await post([], spy().overrides);
    assert.deepEqual(current?.actions(), ["prune-declaration-refused"]);
    await post([DOWN], spy().overrides, "palsave-api");
    assert.deepEqual(current?.actions(), ["prune-declaration-refused"]);
  });

  test("a writer refusal that maps to 409 or 404 logs once, as refused", async () => {
    for (const code of ["not-absent", "missing", "tagged"] as const) {
      await post([DOWN], spy({ ok: false, reason: "no", code }).overrides);
      assert.deepEqual(current?.actions(), ["prune-declaration-refused"], code);
    }
    await post([DOWN], spy({ ok: false, reason: "disk" }).overrides);
    assert.deepEqual(current?.actions(), ["prune-declaration-failed"]);
  });

  test("a non-site name is a 404 before anything is read", async () => {
    let reads = 0;
    const { calls, overrides } = spy();
    const res = await post([DOWN], { ...overrides, readDeclarations: () => (reads++, Promise.resolve(DECL)) }, "palsave-api");
    assert.equal(res.status, 404);
    assert.equal(reads, 0);
    assert.equal(calls.length, 0);
  });
});

describe("host actions on the board", () => {
  const PAL = "palworld-palchuds";
  const GAME = {
    name: PAL,
    unit: `${PAL}.service`,
    group: "service",
    reconciled: false,
    actions: ["start", "stop", "restart", "update"],
  };
  const NO_ACTIONS = { name: "swee", unit: "swee.service", group: "service", reconciled: true, actions: ["start"] };
  const stateRoute = (unit: string, action: string) => `/services/${unit}/actions/${action}/state`;
  const actionRoute = (unit: string, action: string) => `/services/${unit}/actions/${action}`;
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  let starts: [string, string][] = [];
  after(async () => {
    await current?.close();
  });

  async function start(overrides: Partial<SystemCommands> = {}): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    starts = [];
    current = await serve(inventory([GAME, NO_ACTIONS]), {
      startHostAction: (unit, action) => {
        starts.push([unit, action]);
        return Promise.resolve();
      },
      readOpUnits: () => Promise.resolve({}),
      ...overrides,
    });
    return current;
  }

  function post(s: { base: string }, p: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${s.base}${p}`, { method: "POST", headers: { Authorization: AUTH, ...headers }, redirect: "manual" });
  }

  test("POST starts the action and redirects to /services with 303", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "restart"));
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/services");
    assert.deepEqual(starts, [[PAL, "restart"]]);
  });

  test("POST with Accept: application/json answers 202 with the state", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "update"), { Accept: "application/json" });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { ok: true, state: { unit: PAL, action: "update", state: "running", logTail: "" } });
    assert.deepEqual(starts, [[PAL, "update"]]);
  });

  test("POST is audited as the operator", async () => {
    const s = await start();
    await post(s, actionRoute(PAL, "stop"));
    const lines = s.audit();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].caller, "operator");
    assert.equal(lines[0].unit, PAL);
    assert.equal(lines[0].hostAction, "stop");
    assert.equal(lines[0].outcome, "started");
  });

  test("an unknown action is refused 404 and never reaches the audit log", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "rm -rf"));
    assert.equal(res.status, 404);
    assert.deepEqual(s.audit(), []);
  });

  test("refusals are JSON {ok:false, reason}, never a redirect: unknown unit, unknown action, unlisted action", async () => {
    const s = await start();
    for (const [unit, action] of [
      ["nope", "start"],
      [PAL, "reboot"],
      ["swee", "stop"],
    ]) {
      const res = await post(s, actionRoute(unit, action));
      assert.equal(res.status, 404, `${unit} ${action}`);
      const body = (await res.json()) as { ok: boolean; reason: string };
      assert.equal(body.ok, false);
      assert.equal(typeof body.reason, "string");
    }
    assert.deepEqual(starts, []);
  });

  test("409 is surfaced when an action is already running", async () => {
    const s = await start({
      readOpUnits: () =>
        Promise.resolve({
          [`lychee-op-${PAL}-stop.service`]: { activeState: "active", result: "success", startedAt: "x", finishedAt: null },
        }),
    });
    const res = await post(s, actionRoute(PAL, "start"), { Accept: "application/json" });
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.match(body.reason, /already running/);
    assert.deepEqual(starts, []);
  });

  test("502 is surfaced when the start fails", async () => {
    const s = await start({ startHostAction: () => Promise.reject(new Error("sudo refused")) });
    const res = await post(s, actionRoute(PAL, "start"));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.match(body.reason, /sudo refused/);
  });

  test("a cross-site POST is refused 403 and starts nothing", async () => {
    const s = await start();
    const res = await post(s, actionRoute(PAL, "start"), { "Sec-Fetch-Site": "cross-site" });
    assert.equal(res.status, 403);
    assert.deepEqual(starts, []);
  });

  test("POST requires authentication", async () => {
    const s = await start();
    const res = await fetch(`${s.base}${actionRoute(PAL, "start")}`, { method: "POST" });
    assert.equal(res.status, 401);
    assert.deepEqual(starts, []);
  });

  test("GET state answers the action's state as JSON", async () => {
    const s = await start({
      readOpUnits: () =>
        Promise.resolve({
          [`lychee-op-${PAL}-restart.service`]: {
            activeState: "inactive",
            result: "success",
            startedAt: null,
            finishedAt: null,
          },
        }),
    });
    s.fs.writeFile(
      `/var/lib/lychee-op/${PAL}-restart.result.json`,
      JSON.stringify({ unit: PAL, action: "restart", result: "success", exit_status: 0, started_at: "2026-10-14T15:14:58Z", finished_at: "2026-10-14T15:15:03Z" }),
    );
    const res = await s.get(stateRoute(PAL, "restart"));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; state: { unit: string; action: string; state: string } };
    assert.equal(body.ok, true);
    assert.equal(body.state.unit, PAL);
    assert.equal(body.state.action, "restart");
    assert.equal(body.state.state, "succeeded");
  });

  test("GET state: unknown unit, unknown action, unlisted action and a bad name are 404 JSON", async () => {
    const s = await start();
    for (const [unit, action] of [
      ["nope", "start"],
      [PAL, "reboot"],
      ["swee", "stop"],
      ["..%2Fetc", "start"],
    ]) {
      const res = await s.get(stateRoute(unit, action));
      assert.equal(res.status, 404, `${unit} ${action}`);
      assert.equal(((await res.json()) as { ok: boolean }).ok, false);
    }
  });

  test("GET state answers 502 when systemd cannot be read, never a 500", async () => {
    const s = await start({ readOpUnits: () => Promise.reject(new Error("systemctl broke")) });
    const res = await s.get(stateRoute(PAL, "start"));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.match(body.reason, /systemctl broke/);
  });

  test("GET state requires authentication", async () => {
    const s = await start();
    const res = await fetch(`${s.base}${stateRoute(PAL, "start")}`);
    assert.equal(res.status, 401);
  });
});

describe("GET /services: host action state", () => {
  const PAL = "palworld-palchuds";
  const GAME = { name: PAL, unit: `${PAL}.service`, group: "service", reconciled: false, actions: ["start", "stop", "restart", "update"] };
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  test("the board reads every action's state in one call and shows a running one", async () => {
    const reads: string[][] = [];
    current = await serve(inventory([GAME]), {
      readOpUnits: (names) => {
        reads.push(names);
        return Promise.resolve({
          [`lychee-op-${PAL}-update.service`]: { activeState: "activating", result: "success", startedAt: "Tue 2026-10-13 10:00:00 UTC", finishedAt: null },
        });
      },
    });
    const html = await (await current.get("/services")).text();
    assert.equal(reads.length, 1);
    assert.equal(reads[0].length, 4);
    assert.ok(html.includes('data-running="update"'));
    assert.ok(html.includes(`an action is already running on ${PAL}`));
  });

  test("an unreadable systemd still renders the board and its buttons, without a last run", async () => {
    await current?.close();
    current = await serve(inventory([GAME]), { readOpUnits: () => Promise.reject(new Error("systemctl broke")) });
    const res = await current.get("/services");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('data-host-action="restart"'));
    assert.ok(!html.includes("data-running="));
    assert.ok(!html.includes("data-action-log"));
  });

  test("the last-run line shows a succeeded run whose unit systemd has unloaded", async () => {
    await current?.close();
    // A garbage-collected oneshot: `systemctl show` loads it afresh, no times.
    current = await serve(inventory([GAME]), {
      readOpUnits: (names) =>
        Promise.resolve(Object.fromEntries(names.map((n) => [n, { activeState: "inactive", result: "success", startedAt: null, finishedAt: null }]))),
    });
    current.fs.writeFile(
      `/var/lib/lychee-op/${PAL}-restart.result.json`,
      JSON.stringify({ unit: PAL, action: "restart", result: "success", exit_status: 0, started_at: "2026-10-14T15:14:58Z", finished_at: "2026-10-14T15:15:03Z" }),
    );
    current.fs.writeFile(`/var/lib/lychee-op/${PAL}-restart.log`, "restarted\n");
    const html = await (await current.get("/services")).text();
    assert.match(html, /restart <span class="[^"]*">succeeded<\/span>/);
    assert.ok(html.includes("took 5s"), "the duration comes from the file's times");
    assert.ok(html.includes("data-action-log"));
    assert.ok(!html.includes("data-running="));
  });

  test("dev fakes, end to end: start, running, then succeeded from the file after the unit is unloaded", async () => {
    await current?.close();
    current = await serve(inventory([GAME]), {}, { opRun: { delayMs: 30 } });
    const s = current;
    const started = await fetch(`${s.base}/services/${PAL}/actions/restart`, {
      method: "POST",
      headers: { Authorization: AUTH, Accept: "application/json" },
      redirect: "manual",
    });
    assert.equal(started.status, 202);
    const running = (await (await s.get(`/services/${PAL}/actions/restart/state`)).json()) as { state: { state: string } };
    assert.equal(running.state.state, "running");
    assert.ok((await (await s.get("/services")).text()).includes('data-running="restart"'));
    await new Promise((r) => setTimeout(r, 90));
    const done = (await (await s.get(`/services/${PAL}/actions/restart/state`)).json()) as {
      state: { state: string; startedAt?: string; finishedAt?: string };
    };
    assert.equal(done.state.state, "succeeded");
    assert.ok(done.state.startedAt && done.state.finishedAt);
    assert.ok(s.fs.exists(`/var/lib/lychee-op/${PAL}-restart.result.json`));
    assert.match(await (await s.get("/services")).text(), /restart <span class="[^"]*">succeeded<\/span>/);
  });
});

describe("GET /services: links to managed sites", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });
  const APP = { name: "app-lychee-land", kind: "container", container: "app-lychee-land", group: "service", reconciled: true, result: "deployed" };

  test("the board links a managed site's row", async () => {
    current = await serve(inventory([APP]), {});
    current.fs.writeFile(
      "/etc/caddy/Caddyfile",
      "{\n  auto_https off\n}\n\nhttp://app.lychee.land {\n  reverse_proxy localhost:3200\n}\n",
    );
    const res = await current.get("/services");
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('href="/sites/app.lychee.land"'));
  });

  test("an unreadable Caddyfile renders the board without site links", async () => {
    await current?.close();
    current = await serve(inventory([APP]), {});
    const res = await current.get("/services");
    assert.equal(res.status, 200);
    assert.ok(!withoutHeader(await res.text()).includes('href="/sites/'));
  });
});

describe("GET /api/services", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  async function start(...args: Parameters<typeof serve>): Promise<Awaited<ReturnType<typeof serve>>> {
    await current?.close();
    current = await serve(...args);
    return current;
  }

  test("returns only the requested group's rows in the envelope", async () => {
    const { SEEDED_INVENTORY } = await import("../dev/seed");
    const s = await start(SEEDED_INVENTORY, {});
    const res = await s.get("/api/services?group=infrastructure");
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      now: string;
      board: { groups: { group: string; rows: { name: string }[] }[] };
    };
    assert.equal(body.ok, true);
    assert.ok(!Number.isNaN(Date.parse(body.now)));
    assert.deepEqual(body.board.groups.map((g) => g.group), ["infrastructure"]);
    assert.deepEqual(body.board.groups[0].rows.map((r) => r.name), ["caddy", "cloudflared-sites"]);
  });

  test("an unknown group is a 400 with the error envelope", async () => {
    const s = await start(null, {});
    const res = await s.get("/api/services?group=nope");
    assert.equal(res.status, 400);
    const body = (await res.json()) as { ok: boolean; reason: string };
    assert.equal(body.ok, false);
    assert.equal(typeof body.reason, "string");
  });

  test("requires authentication", async () => {
    const s = await start(null, {});
    assert.equal((await fetch(`${s.base}/api/services?group=service`)).status, 401);
  });

  test("a missing inventory still answers 200 with inventoryAvailable false", async () => {
    const s = await start(null, {});
    const res = await s.get("/api/services?group=service");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; board: { inventoryAvailable: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.board.inventoryAvailable, false);
  });
});

describe("GET /api/services boardEmpty", () => {
  let current: Awaited<ReturnType<typeof serve>> | undefined;
  after(async () => {
    await current?.close();
  });

  test("an inventory declaring only other groups is not an empty board", async () => {
    current = await serve(inventory([SWEE]), {});
    const body = (await (await current.get("/api/services?group=infrastructure")).json()) as {
      boardEmpty: boolean;
      board: { groups: { group: string }[] };
    };
    assert.equal(body.boardEmpty, false);
    assert.ok(!body.board.groups.some((g) => g.group === "infrastructure"));
  });

  test("an inventory with no entries is an empty board", async () => {
    await current?.close();
    current = await serve(inventory([]), {});
    const body = (await (await current.get("/api/services?group=service")).json()) as { boardEmpty: boolean };
    assert.equal(body.boardEmpty, true);
  });
});
