import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import bcrypt from "bcrypt";
import { renderToStaticMarkup } from "react-dom/server";
import type { Deps } from "../../deps";
import type { SystemCommands } from "../../lib/systemCommands";
import type { BoardPayload, ServiceGroup } from "../../shared/board";
import { TONE_PILL } from "../../views/shared";
import { Board } from "../components/BoardRows";

/*
 * The board's routes end to end, as the browser sees them: the app (with the
 * dev fakes) answers GET /api/services, and the React Board the page mounts
 * renders that payload. These were src/routes/services.test.ts's board tests,
 * which rendered the same payload through the server's renderServicesPage
 * until it was retired; the assertions are theirs. They live here, not
 * there, because the server program has no DOM lib to type the client with.
 *
 * Deliberately no "../test/setup": happy-dom would replace the global fetch
 * these tests use against the real server, and static rendering needs no DOM.
 */

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

type BoardPath = "/services" | "/reconciler" | "/infrastructure";
const BOARD_GROUP: Record<BoardPath, ServiceGroup> = { "/services": "service", "/reconciler": "reconciler", "/infrastructure": "infrastructure" };

interface Served {
  base: string;
  fs: Deps["fs"];
  get: (p: string) => Promise<Response>;
  /** A board page's markup: GET /api/services for its group, rendered by Board. */
  board: (p: BoardPath) => Promise<Response>;
  close: () => Promise<void>;
}

async function serve(
  inventoryJson: string | null,
  overrides: Partial<SystemCommands>,
  seed: { opRun?: { delayMs?: number } } = {},
): Promise<Served> {
  const { createApp } = await import("../../app");
  const { createBackup } = await import("../../lib/backup");
  const { createLogger } = await import("../../lib/logger");
  const { createFakes } = await import("../../dev/fakes");
  const fakes = createFakes(overrides, seed);
  if (inventoryJson !== null) fakes.fs.writeFile(INVENTORY_PATH, inventoryJson);
  const deps: Deps = {
    commands: fakes.commands,
    fs: fakes.fs,
    backup: createBackup(fakes.fs),
    logger: createLogger(fakes.fs),
  };
  const server: Server = createApp(deps).listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const get = (p: string) => fetch(`${base}${p}`, { headers: { Authorization: AUTH } });
  return {
    base,
    fs: fakes.fs,
    get,
    board: async (p) => {
      const group = BOARD_GROUP[p];
      const res = await get(`/api/services?group=${group}`);
      if (!res.ok) return res;
      const payload = (await res.json()) as BoardPayload;
      // Without controls: the markup of the board's first paint.
      const html = renderToStaticMarkup(<Board payload={payload} group={group} />);
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    },
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

/** The status word of each rendered row, in page order. */
function pills(html: string): string[] {
  return [...html.matchAll(/data-row-pill[^>]*><span [^>]*><span aria-hidden="true">●<\/span> ([a-z ]+)<\/span>/g)].map((m) => m[1]);
}

/** One server per test, closed before the next starts and after the suite. */
function servers(): (...args: Parameters<typeof serve>) => Promise<Served> {
  let current: Served | undefined;
  after(async () => {
    await current?.close();
  });
  return async (...args) => {
    await current?.close();
    current = await serve(...args);
    return current;
  };
}

describe("GET /services: the board", () => {
  const start = servers();

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
    const res = await s.board("/services");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(stateCalls, 1);
    assert.deepEqual(requested, ["lychee-reconcile.timer", "lychee-reconcile.service", "swee.service"]);
    assert.deepEqual(timers, ["lychee-reconcile.timer"]);
    assert.deepEqual(pills(html), ["running"]);
    // The schedule is shown where the timer's row is: on the reconciler page.
    assert.match(await (await s.board("/reconciler")).text(), /next run in 3 minutes/);
  });

  test("a reconciler entry that is not a timer is not mistaken for one", async () => {
    const timers: string[] = [];
    const s = await start(inventory([RECONCILER[1], SWEE]), {
      readTimerSchedule: (t) => {
        timers.push(t);
        return Promise.resolve({ next: null, last: null });
      },
    });
    const html = await (await s.board("/reconciler")).text();
    assert.deepEqual(timers, []);
    assert.ok(!html.includes("next run"));
  });

  test("a missing inventory yields a page, not an error", async () => {
    const s = await start(null, {});
    const res = await s.board("/services");
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
    for (const page of ["/services", "/reconciler"] as const) {
      const res = await s.board(page);
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
    const res = await s.board("/reconciler");
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes("next run"));
    assert.deepEqual(pills(await (await s.board("/services")).text()), ["running"]);
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
    const html = await (await s.board("/services")).text();
    assert.deepEqual(requested, ["swee.service"]);
    assert.deepEqual(projects, ["palsave-api"]);
    assert.deepEqual(pills(html), ["running", "unhealthy"]);
  });

  test("a failed container status read degrades to unknown, not a 500", async () => {
    const s = await start(inventory([SWEE, CONTAINER]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
      readResourceStatus: () => Promise.reject(new Error("docker not found")),
    });
    const res = await s.board("/services");
    assert.equal(res.status, 200);
    assert.deepEqual(pills(await res.text()), ["running", "unknown"]);
  });

  test("an unknown container renders neutral, not as a failure", async () => {
    const s = await start(inventory([CONTAINER]), {
      readResourceStatus: () => Promise.resolve("unknown"),
    });
    const html = await (await s.board("/services")).text();
    assert.ok(html.includes(TONE_PILL.neutral));
    assert.ok(!html.includes(TONE_PILL.bad));
  });

  test("an inventory with no kind still renders its units", async () => {
    const s = await start(inventory([SWEE]), {
      readUnitStates: () => Promise.resolve({ "swee.service": { status: "running", since: null } }),
    });
    assert.deepEqual(pills(await (await s.board("/services")).text()), ["running"]);
  });
});

describe("the three board pages: what each renders", () => {
  const start = servers();

  /** The data-service names of the rendered rows, in page order. */
  const rows = (html: string): string[] => [...html.matchAll(/<li [^>]*data-service="([^"]+)"/g)].map((m) => m[1]);
  /** The page's eyebrow: the h2 that names its group. */
  const eyebrow = (html: string): string | undefined => html.match(/<h2 [^>]*>([^<]*)<\/h2>/)?.[1];

  const PAGES: Array<{ path: BoardPath; eyebrow: string; only: string[]; never: string[] }> = [
    { path: "/services", eyebrow: "Services", only: ["lychee-admin", "swee", "palsave-api"], never: ["lychee-reconcile-timer", "caddy"] },
    { path: "/reconciler", eyebrow: "Reconciler", only: ["lychee-reconcile-timer", "lychee-watch-timer"], never: ["swee", "caddy"] },
  ];

  for (const page of PAGES) {
    test(`${page.path} renders only its own group's rows, under its own eyebrow`, async () => {
      const { SEEDED_INVENTORY } = await import("../../dev/seed");
      const s = await start(SEEDED_INVENTORY, {});
      const res = await s.board(page.path);
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

    test(`${page.path} explains a missing inventory instead of erroring`, async () => {
      const s = await start(null, {});
      const res = await s.board(page.path);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('id="inventory-unavailable"'));
      assert.equal(eyebrow(html), page.eyebrow);
    });
  }

  test("a readable inventory with nothing in a page's group says so in one sentence", async () => {
    const s = await start(inventory([SWEE]), {});
    for (const path of ["/reconciler"] as const) {
      const html = await (await s.board(path)).text();
      assert.ok(html.includes('id="group-empty"'), path);
      assert.ok(!html.includes('id="inventory-unavailable"'), path);
      assert.deepEqual(rows(html), [], path);
    }
    const services = await (await s.board("/services")).text();
    assert.ok(!services.includes('id="group-empty"'));
    assert.deepEqual(rows(services), ["swee"]);
  });
});

describe("GET /services: Prune on retired site rows", () => {
  const start = servers();
  const site = (name: string) => ({ name, kind: "container", container: name, group: "service", reconciled: true, result: "deployed" });
  const PALSAVE = { name: "palsave-api", unit: "palsave-api.service", group: "service", reconciled: true, result: "deployed" };
  const DECLS = [
    { name: "gone-lychee-land", port: 3400, state: "absent", image: "ghcr.io/lycheehome/gone" },
    { name: "app-lychee-land", port: 3200, state: "running", image: "ghcr.io/lycheehome/app:0.2.0" },
    { name: "palsave-api", port: 8788, state: "absent", image: "ghcr.io/lycheehome/palsave-api" },
  ];
  async function board(readDeclarations: SystemCommands["readDeclarations"]): Promise<string> {
    const s = await start(inventory([site("gone-lychee-land"), site("app-lychee-land"), PALSAVE]), { readDeclarations });
    const res = await s.board("/services");
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

describe("GET /services — a pending Deploy", () => {
  const start = servers();
  const ROW = { name: "notes", kind: "container", container: "notes", group: "service", reconciled: true,
    version: "v1.4.0", target: "v1.4.0", available: "v1.5.0" };
  const ahead = [{ name: "notes", port: 3000, state: "running", image: "ghcr.io/lycheehome/notes:v1.5.0" }];

  async function rowHtml(overrides: Partial<SystemCommands>): Promise<string> {
    const s = await start(inventory([ROW]), overrides);
    const res = await s.board("/services");
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

describe("GET /services: host action state", () => {
  const PAL = "palworld-palchuds";
  const GAME = { name: PAL, unit: `${PAL}.service`, group: "service", reconciled: false, actions: ["start", "stop", "restart", "update"] };
  const start = servers();

  test("the board reads every action's state in one call and shows a running one", async () => {
    const reads: string[][] = [];
    const s = await start(inventory([GAME]), {
      readOpUnits: (names) => {
        reads.push(names);
        return Promise.resolve({
          [`lychee-op-${PAL}-update.service`]: { activeState: "activating", result: "success", startedAt: "Tue 2026-10-13 10:00:00 UTC", finishedAt: null },
        });
      },
    });
    const html = await (await s.board("/services")).text();
    assert.equal(reads.length, 1);
    assert.equal(reads[0].length, 4);
    assert.ok(html.includes('data-running="update"'));
    assert.ok(html.includes(`an action is already running on ${PAL}`));
  });

  test("an unreadable systemd still renders the board and its buttons, without a last run", async () => {
    const s = await start(inventory([GAME]), { readOpUnits: () => Promise.reject(new Error("systemctl broke")) });
    const res = await s.board("/services");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('data-host-action="restart"'));
    assert.ok(!html.includes("data-running="));
    assert.ok(!html.includes("data-action-log"));
  });

  test("the last-run line shows a succeeded run whose unit systemd has unloaded", async () => {
    // A garbage-collected oneshot: `systemctl show` loads it afresh, no times.
    const s = await start(inventory([GAME]), {
      readOpUnits: (names) =>
        Promise.resolve(Object.fromEntries(names.map((n) => [n, { activeState: "inactive", result: "success", startedAt: null, finishedAt: null }]))),
    });
    s.fs.writeFile(
      `/var/lib/lychee-op/${PAL}-restart.result.json`,
      JSON.stringify({ unit: PAL, action: "restart", result: "success", exit_status: 0, started_at: "2026-10-14T15:14:58Z", finished_at: "2026-10-14T15:15:03Z" }),
    );
    s.fs.writeFile(`/var/lib/lychee-op/${PAL}-restart.log`, "restarted\n");
    const html = await (await s.board("/services")).text();
    assert.match(html, /restart <span class="[^"]*">succeeded<\/span>/);
    assert.ok(html.includes("took 5s"), "the duration comes from the file's times");
    assert.ok(html.includes("data-action-log"));
    assert.ok(!html.includes("data-running="));
  });

  test("dev fakes, end to end: start, running, then succeeded from the file after the unit is unloaded", async () => {
    const s = await start(inventory([GAME]), {}, { opRun: { delayMs: 30 } });
    const started = await fetch(`${s.base}/services/${PAL}/actions/restart`, {
      method: "POST",
      headers: { Authorization: AUTH, Accept: "application/json" },
      redirect: "manual",
    });
    assert.equal(started.status, 202);
    const running = (await (await s.get(`/services/${PAL}/actions/restart/state`)).json()) as { state: { state: string } };
    assert.equal(running.state.state, "running");
    assert.ok((await (await s.board("/services")).text()).includes('data-running="restart"'));
    // Poll until the 30ms fake run settles, bounded at 5s, rather than one
    // fixed sleep, which a loaded machine can outrun.
    type Done = { state: { state: string; startedAt?: string; finishedAt?: string } };
    let done: Done = running as Done;
    for (const deadline = Date.now() + 5000; done.state.state === "running" && Date.now() < deadline; ) {
      await new Promise((r) => setTimeout(r, 20));
      done = (await (await s.get(`/services/${PAL}/actions/restart/state`)).json()) as Done;
    }
    assert.equal(done.state.state, "succeeded");
    assert.ok(done.state.startedAt && done.state.finishedAt);
    assert.ok(s.fs.exists(`/var/lib/lychee-op/${PAL}-restart.result.json`));
    assert.match(await (await s.board("/services")).text(), /restart <span class="[^"]*">succeeded<\/span>/);
  });
});

describe("GET /services: links to managed sites", () => {
  const start = servers();
  const APP = { name: "app-lychee-land", kind: "container", container: "app-lychee-land", group: "service", reconciled: true, result: "deployed" };

  // The rendered board has no shell, so no rail listing the same hostname:
  // what the server-rendered version had to strip with withoutShell.
  test("the board links a managed site's row", async () => {
    const s = await start(inventory([APP]), {});
    s.fs.writeFile(
      "/etc/caddy/Caddyfile",
      "{\n  auto_https off\n}\n\nhttp://app.lychee.land {\n  reverse_proxy localhost:3200\n}\n",
    );
    const res = await s.board("/services");
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('href="/sites/app.lychee.land"'));
  });

  test("an unreadable Caddyfile renders the board without site links", async () => {
    const s = await start(inventory([APP]), {});
    const res = await s.board("/services");
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes('href="/sites/'));
  });
});
