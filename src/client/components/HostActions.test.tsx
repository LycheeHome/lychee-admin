import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, before, beforeEach, after, describe, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActionState, BoardPayload, BoardRow } from "../../shared/board";
import { renderServicesPage } from "../../views/html";
import { InfrastructurePage } from "../pages/InfrastructurePage";
import { Board } from "./BoardRows";
import type { HostActionsApi } from "../mutations";
import { useHealth } from "../health";
import { seedHealth } from "../test/healthFixture";
import { canonical } from "../test/canonical";

// The host-action strip on the React board: Start goes straight through;
// Stop, Restart and Update confirm inline; a 202 puts the row into its running
// state and polls the action's state every 2s through decidePoll until it
// settles, and settling re-fetches the board where app.js reloaded the page.

afterEach(cleanup);

const TIMEOUT = { timeout: 5000 };
const UNIT = "palworld-palchuds";
const originalFetch = globalThis.fetch;
const TOAST = () => document.getElementById("flash-banner-message")!.textContent;
const BANNER_HIDDEN = () => document.getElementById("flash-banner")!.classList.contains("hidden");

type Call = { method: string; url: string; accept: string | null };
let calls: Call[] = [];
let current: BoardPayload;
let postAnswer: () => Response | Promise<Response>;
let stateAnswer: () => Response | Promise<Response>;

function unitRow(extra: Partial<BoardRow> = {}): BoardRow {
  return {
    name: UNIT,
    kind: "unit",
    unit: `${UNIT}.service`,
    group: "infrastructure",
    reconciled: false,
    status: "running",
    since: "2026-10-22T10:00:00Z",
    actions: ["start", "stop", "restart", "update"],
    ...extra,
  } as BoardRow;
}

function payload(rows: BoardRow[], extra: Partial<BoardPayload> = {}): BoardPayload {
  return {
    board: {
      inventoryAvailable: true,
      schedule: { next: null, last: null },
      timerUnit: null,
      generated: "2026-10-22T11:58:00Z",
      groups: [{ group: "infrastructure", rows }],
    },
    boardEmpty: false,
    now: "2026-10-22T12:00:00Z",
    domain: "lychee.land",
    prunable: [],
    managed: [],
    requested: {},
    lastRuns: {},
    ...extra,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const runState = (action: ActionState["action"], state: ActionState["state"], extra: Partial<ActionState> = {}): ActionState => ({
  unit: UNIT,
  action,
  state,
  logTail: "",
  ...extra,
});

before(() => {
  document.body.innerHTML = `<div id="flash-banner" class="hidden" role="status">
    <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden">x</button></div>`;
});

beforeEach(() => {
  calls = [];
  current = payload([unitRow()]);
  document.getElementById("flash-banner")!.classList.add("hidden");
  document.getElementById("flash-banner-message")!.textContent = "";
  postAnswer = () => json(202, { ok: true, state: runState("stop", "running", { startedAt: new Date().toISOString() }) });
  stateAnswer = () => json(200, { ok: true, state: runState("stop", "running", { startedAt: new Date().toISOString(), logTail: "stopping\n" }) });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, url, accept: headers.get("accept") });
    if (method === "GET" && url.startsWith("/api/services")) return json(200, { ok: true, ...current });
    if (method === "GET" && url === "/api/health") return json(200, { ok: true, ...seedHealth() });
    if (method === "GET" && url.endsWith("/state")) return stateAnswer();
    return postAnswer();
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

const posts = () => calls.filter((c) => c.method === "POST");
const statePolls = () => calls.filter((c) => c.method === "GET" && c.url.endsWith("/state"));
const gets = (prefix: string) => calls.filter((c) => c.method === "GET" && c.url.startsWith(prefix));
const box = () => document.querySelector<HTMLElement>(`[data-host-actions="${UNIT}"]`)!;
const boxButtons = () => Array.from(box().querySelectorAll<HTMLButtonElement>("button"));
const pill = () => document.querySelector(`[data-service="${UNIT}"] [data-row-pill]`)!.textContent;
const confirmFor = (a: string) => box().querySelector<HTMLElement>(`[data-action-confirm="${a}"]`)!;

function finish(client: QueryClient) {
  cleanup();
  client.clear();
}

function HealthObserver() {
  useHealth();
  return null;
}

function mount(): QueryClient {
  // A host action's mutation is still observed when the row unmounts, and its
  // 5-minute garbage-collection timer, armed then, survives client.clear() and
  // would hold the test process open: collect it at once instead.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <HealthObserver />
      <InfrastructurePage />
    </QueryClientProvider>,
  );
  return client;
}

describe("host actions: posting", () => {
  test("Start posts once, at once, asking for JSON", async () => {
    current = payload([unitRow({ status: "exited" })]);
    postAnswer = () => json(202, { ok: true, state: runState("start", "running") });
    stateAnswer = () => json(200, { ok: true, state: runState("start", "running") });
    const client = mount();
    try {
      const start = await screen.findByRole("button", { name: "Start" }, TIMEOUT);
      fireEvent.click(start);
      fireEvent.click(start);
      await waitFor(() => assert.equal(posts().length, 1), TIMEOUT);
      assert.equal(posts()[0].url, `/services/${UNIT}/actions/start`);
      assert.equal(posts()[0].accept, "application/json");
      await waitFor(() => assert.equal(pill(), "● starting"), TIMEOUT);
      assert.equal(posts().length, 1);
    } finally {
      finish(client);
    }
  });

  test("Stop opens its confirmation with focus on Cancel; Esc closes it and focus returns to Stop", async () => {
    const client = mount();
    try {
      const stop = await screen.findByRole("button", { name: "Stop" }, TIMEOUT);
      stop.focus();
      fireEvent.click(stop);
      const confirm = confirmFor("stop");
      assert.equal(confirm.hidden, false);
      assert.equal(box().querySelector<HTMLElement>("[data-action-strip]")!.hidden, true);
      await waitFor(() => assert.ok(document.activeElement === confirm.querySelector("[data-action-cancel]")), TIMEOUT);
      fireEvent.keyDown(confirm, { key: "Escape" });
      await waitFor(() => assert.equal(confirmFor("stop").hidden, true), TIMEOUT);
      assert.equal(box().querySelector<HTMLElement>("[data-action-strip]")!.hidden, false);
      await waitFor(() => assert.ok(document.activeElement === screen.getByRole("button", { name: "Stop" })), TIMEOUT);
      assert.equal(posts().length, 0);
    } finally {
      finish(client);
    }
  });

  test("Cancel closes Restart's confirmation and focus returns to Restart", async () => {
    const client = mount();
    try {
      const restart = await screen.findByRole("button", { name: "Restart" }, TIMEOUT);
      fireEvent.click(restart);
      const confirm = confirmFor("restart");
      await waitFor(() => assert.ok(document.activeElement === confirm.querySelector("[data-action-cancel]")), TIMEOUT);
      fireEvent.click(confirm.querySelector("[data-action-cancel]")!);
      await waitFor(() => assert.equal(confirmFor("restart").hidden, true), TIMEOUT);
      await waitFor(() => assert.ok(document.activeElement === screen.getByRole("button", { name: "Restart" })), TIMEOUT);
      assert.equal(posts().length, 0);
    } finally {
      finish(client);
    }
  });

  test("the open confirmation is the server's markup with app.js's two toggles applied", async () => {
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Update" }, TIMEOUT));
      const html = renderServicesPage(
        current.board,
        new Date(current.now),
        new Set(),
        current.domain,
        current.lastRuns,
        "infrastructure",
        new Set(),
        new Map(),
        { rail: { sites: [], hostAvailable: true, current: { page: "infrastructure" }, domain: current.domain }, assets: null },
      );
      const template = document.createElement("template");
      template.innerHTML = html;
      const server = template.content.querySelector<HTMLElement>(`[data-host-actions="${UNIT}"]`)!;
      server.querySelector<HTMLElement>("[data-action-strip]")!.hidden = true;
      server.querySelector<HTMLElement>('[data-action-confirm="update"]')!.hidden = false;
      assert.equal(canonical(box().outerHTML), canonical(server.outerHTML));
    } finally {
      finish(client);
    }
  });

  test("confirming posts /services/palworld-palchuds/actions/stop", async () => {
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Stop" }, TIMEOUT));
      const go = confirmFor("stop").querySelector<HTMLButtonElement>("[data-action-go]")!;
      fireEvent.click(go);
      fireEvent.click(go);
      await waitFor(() => assert.equal(posts().length, 1), TIMEOUT);
      assert.equal(posts()[0].url, "/services/palworld-palchuds/actions/stop");
    } finally {
      finish(client);
    }
  });

  test("a unit name is encoded in both URLs", async () => {
    const name = "a.b c";
    current = payload([unitRow({ name, status: "exited" })]);
    postAnswer = () => json(202, { ok: true, state: { ...runState("start", "running"), unit: name } });
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Start" }, TIMEOUT));
      await waitFor(() => assert.equal(posts().length, 1), TIMEOUT);
      assert.equal(posts()[0].url, `/services/${encodeURIComponent(name)}/actions/start`);
      await waitFor(() => assert.equal(statePolls().length, 1), TIMEOUT);
      assert.equal(statePolls()[0].url, `/services/${encodeURIComponent(name)}/actions/start/state`);
    } finally {
      finish(client);
    }
  });

  test("while polling, the pill names the run, every button is disabled, and focus stays in the row", async () => {
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Stop" }, TIMEOUT));
      fireEvent.click(confirmFor("stop").querySelector("[data-action-go]")!);
      await waitFor(() => assert.equal(pill(), "● stopping"), TIMEOUT);
      assert.ok(boxButtons().length > 0);
      for (const b of boxButtons()) assert.equal(b.disabled, true, `${b.textContent} is enabled`);
      assert.equal(box().dataset.running, "stop");
      assert.equal(confirmFor("stop").hidden, true);
      assert.equal(box().querySelector<HTMLElement>("[data-action-busy]")!.hidden, false);
      const fact = box().querySelector<HTMLElement>("[data-action-fact]")!;
      assert.match(fact.textContent ?? "", /^stop running · started just now$/);
      assert.ok(document.activeElement === fact, "focus is on the run fact");
      // The first poll's answer reaches the tail; the board's own re-reads do not end the run.
      await waitFor(() => assert.equal(box().querySelector("[data-action-tail]")!.textContent, "stopping"), TIMEOUT);
      assert.equal(pill(), "● stopping");
    } finally {
      finish(client);
    }
  });

  test("a settled state re-fetches the board and health, and focus stays on the strip", async () => {
    const client = mount();
    try {
      const stop = await screen.findByRole("button", { name: "Stop" }, TIMEOUT);
      fireEvent.click(stop);
      fireEvent.click(confirmFor("stop").querySelector("[data-action-go]")!);
      await waitFor(() => assert.equal(pill(), "● stopping"), TIMEOUT);
      const boardReads = gets("/api/services").length;
      const healthReads = gets("/api/health").length;
      current = payload([unitRow({ status: "exited" })], {
        lastRuns: { [UNIT]: runState("stop", "succeeded", { startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), logTail: "ok\n" }) },
      });
      stateAnswer = () => json(200, { ok: true, state: runState("stop", "succeeded", { startedAt: new Date().toISOString() }) });
      await waitFor(() => assert.ok(gets("/api/services").length > boardReads), TIMEOUT);
      await waitFor(() => assert.ok(gets("/api/health").length > healthReads), TIMEOUT);
      const start = await screen.findByRole("button", { name: "Start" }, TIMEOUT);
      await waitFor(() => assert.equal(pill(), "● exited"), TIMEOUT);
      assert.equal((start as HTMLButtonElement).disabled, false);
      assert.ok(!box().dataset.running);
      await waitFor(() => assert.ok(document.activeElement === start, "focus is on the strip"), TIMEOUT);
      const polls = statePolls().length;
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(statePolls().length, polls, "the poll ended");
    } finally {
      finish(client);
    }
  });
});

describe("host actions: refusals", () => {
  for (const [label, answer, message] of [
    ["a refusal with a reason", () => json(409, { ok: false, reason: "an action is already running on palworld-palchuds" }), "an action is already running on palworld-palchuds"],
    ["a refusal without one", () => new Response("bad gateway", { status: 500 }), "Could not stop palworld-palchuds (HTTP 500)."],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
      "Could not reach the server to stop palworld-palchuds.",
    ],
  ] as const) {
    test(`${label}: the app.js toast, the strip back, focus on Stop`, async () => {
      postAnswer = answer;
      const client = mount();
      try {
        fireEvent.click(await screen.findByRole("button", { name: "Stop" }, TIMEOUT));
        fireEvent.click(confirmFor("stop").querySelector("[data-action-go]")!);
        await waitFor(() => assert.equal(TOAST(), message), TIMEOUT);
        assert.equal(BANNER_HIDDEN(), false);
        await waitFor(() => assert.equal(confirmFor("stop").hidden, true), TIMEOUT);
        await waitFor(() => assert.ok(boxButtons().every((b) => !b.disabled)), TIMEOUT);
        await waitFor(() => assert.ok(document.activeElement === screen.getByRole("button", { name: "Stop" })), TIMEOUT);
        assert.ok(!box().dataset.running);
        assert.equal(statePolls().length, 0);
      } finally {
        finish(client);
      }
    });
  }
});

describe("host actions: rendered mid-run", () => {
  test("a run the board already shows is followed, without a click, until it settles", async () => {
    current = payload([unitRow()], { lastRuns: { [UNIT]: runState("restart", "running", { startedAt: "2026-10-22T11:59:00Z" }) } });
    stateAnswer = () => {
      // The run has ended, so the board's next read no longer shows it.
      current = payload([unitRow()]);
      return json(200, { ok: true, state: runState("restart", "succeeded", { startedAt: "2026-10-22T11:59:00Z" }) });
    };
    const client = mount();
    try {
      await waitFor(() => assert.equal(pill(), "● restarting"), TIMEOUT);
      // clickedAt is null, so a settled answer ends the run at once.
      await waitFor(() => assert.equal(statePolls().length, 1), TIMEOUT);
      await waitFor(() => assert.equal(pill(), "● running"), TIMEOUT);
      assert.equal(statePolls()[0].url, `/services/${UNIT}/actions/restart/state`);
    } finally {
      finish(client);
    }
  });
});

/*
 * Fake timers. The board renders with a stub `hostActions`, so no query
 * client schedules timers of its own and every setTimeout is the poll's.
 */
describe("host actions: the poll always ends (fake timers)", () => {
  const T0 = Date.UTC(2026, 9, 22, 12, 0, 0);

  /** Lets fetch's body read and React's commit run without advancing the mocked clock. */
  async function flush() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    });
  }

  function stubApi(): HostActionsApi & { settles: number } {
    const api = {
      settles: 0,
      request: async (_name: string, action: ActionState["action"]) => runState(action, "running", { startedAt: new Date(Date.now()).toISOString() }),
      settle: async () => {
        api.settles += 1;
      },
    };
    return api;
  }

  async function startRestart(api: HostActionsApi) {
    render(<Board payload={payload([unitRow()])} group="infrastructure" controls={{ hostActions: api }} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    fireEvent.click(confirmFor("restart").querySelector("[data-action-go]")!);
    await flush();
    assert.equal(pill(), "● restarting");
  }

  test("60s of failed polls ends the poll and re-fetches the board, as app.js's reload did (no toast)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () => json(502, { ok: false, reason: "could not read palworld-palchuds's restart" });
    const api = stubApi();
    await startRestart(api);
    for (let i = 0; i < 40 && api.settles === 0; i++) {
      t.mock.timers.tick(2000);
      await flush();
    }
    assert.equal(api.settles, 1);
    // Every 2s from the click until a minute of failures: the 1st at 2s, the 31st at 62s.
    assert.equal(statePolls().length, 31);
    t.mock.timers.tick(20_000);
    await flush();
    assert.equal(statePolls().length, 31, "no poll after giving up");
    assert.equal(BANNER_HIDDEN(), true, "app.js reloaded without a toast");
  });

  test("network failures give up the same way", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () => {
      throw new TypeError("fetch failed");
    };
    const api = stubApi();
    await startRestart(api);
    for (let i = 0; i < 40 && api.settles === 0; i++) {
      t.mock.timers.tick(2000);
      await flush();
    }
    assert.equal(api.settles, 1);
    assert.equal(statePolls().length, 31);
  });

  test("the previous run's settled state is waited out five polls, then ends the poll", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () => json(200, { ok: true, state: runState("restart", "succeeded", { startedAt: "2026-10-22T09:00:00Z" }) });
    const api = stubApi();
    await startRestart(api);
    for (let i = 0; i < 4; i++) {
      t.mock.timers.tick(2000);
      await flush();
    }
    assert.equal(api.settles, 0);
    assert.equal(pill(), "● restarting");
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(api.settles, 1);
    assert.equal(statePolls().length, 5);
  });

  test("a 404 ends the poll at once", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () => json(404, { ok: false, reason: "no action restart" });
    const api = stubApi();
    await startRestart(api);
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(api.settles, 1);
    t.mock.timers.tick(10_000);
    await flush();
    assert.equal(statePolls().length, 1);
  });

  const MIDRUN = runState("restart", "running", { startedAt: "2026-10-22T11:59:00Z" });
  const midRun = (lastRun: ActionState) => payload([unitRow()], { lastRuns: { [UNIT]: lastRun } });
  const boardAt = (p: BoardPayload, api: HostActionsApi) => <Board payload={p} group="infrastructure" controls={{ hostActions: api }} />;
  const hostButtons = () => Array.from(box().querySelectorAll<HTMLButtonElement>("[data-host-action]"));

  test("a followed run the board's own re-read shows finished: the strip renders from the board and stops polling", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () => json(200, { ok: true, state: { ...MIDRUN, logTail: "x\n" } });
    const api = stubApi();
    const { rerender } = render(boardAt(midRun(MIDRUN), api));
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(statePolls().length, 1);
    assert.equal(box().querySelector("[data-action-tail]")!.textContent, "x", "the poll's answer is showing");
    // The board's re-read lands before the next poll, with the run over.
    rerender(boardAt(midRun({ ...MIDRUN, state: "succeeded", finishedAt: "2026-10-22T12:00:01Z", logTail: "ok\n" }), api));
    await flush();
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(pill(), "● running");
    assert.ok(hostButtons().length > 0);
    assert.ok(hostButtons().every((b) => !b.disabled), "every action is live again");
    assert.ok(!box().dataset.running);
    assert.ok(!document.querySelector<HTMLElement>("[data-action-busy]:not([hidden])"), "no busy note");
    assert.equal(statePolls().length, 1, "no poll after the board showed the run finished");
    assert.equal(api.settles, 0);
  });

  test("a followed run the board replaces with another: the strip follows the new one", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () => json(200, { ok: true, state: { ...MIDRUN, logTail: "x\n" } });
    const api = stubApi();
    const { rerender } = render(boardAt(midRun(MIDRUN), api));
    t.mock.timers.tick(2000);
    await flush();
    const update = runState("update", "running", { startedAt: "2026-10-22T12:00:01Z", logTail: "" });
    rerender(boardAt(midRun(update), api));
    await flush();
    assert.equal(pill(), "● updating");
    assert.equal(box().dataset.running, "update");
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(statePolls().at(-1)!.url, `/services/${UNIT}/actions/update/state`);
  });

  test("the poll settles a run the board still shows running: no flicker back and no second poll", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    stateAnswer = () =>
      json(200, { ok: true, state: { ...MIDRUN, state: "succeeded", finishedAt: "2026-10-22T12:00:01Z", logTail: "ok\n" } });
    const api = stubApi();
    const { rerender } = render(boardAt(midRun(MIDRUN), api));
    assert.equal(pill(), "● restarting");
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(api.settles, 1);
    // settle() has resolved, and the board's data has not caught up.
    assert.equal(pill(), "● running", "the settled run, not the board's stale running one");
    assert.ok(hostButtons().every((b) => !b.disabled));
    assert.match(box().querySelector("[data-action-fact]")!.textContent ?? "", /^restart succeeded/);
    // A re-render with the same stale data (the board's next poll) changes nothing.
    rerender(boardAt(midRun({ ...MIDRUN }), api));
    await flush();
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(pill(), "● running");
    assert.equal(statePolls().length, 1, "no second poll");
    assert.equal(api.settles, 1);
    // The board catches up: its own reading takes over.
    rerender(boardAt(midRun({ ...MIDRUN, state: "succeeded", finishedAt: "2026-10-22T12:00:01Z", logTail: "ok\n" }), api));
    await flush();
    assert.equal(pill(), "● running");
    assert.match(box().querySelector("[data-action-fact]")!.textContent ?? "", /^restart succeeded/);
    // And a new run the board shows later is followed again.
    rerender(boardAt(midRun(runState("restart", "running", { startedAt: "2026-10-22T12:05:00Z" })), api));
    await flush();
    assert.equal(pill(), "● restarting");
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(statePolls().length, 2);
  });

  test("unmounting mid-poll: no fetch fires after unmount", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    const api = stubApi();
    await startRestart(api);
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(statePolls().length, 1);
    cleanup();
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(statePolls().length, 1);
    assert.equal(api.settles, 0);
  });

  test("unmounting while a poll is in flight: its answer schedules nothing and settles nothing", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
    let release!: () => void;
    stateAnswer = () =>
      new Promise((r) => (release = () => r(json(200, { ok: true, state: runState("restart", "succeeded", { startedAt: new Date(Date.now()).toISOString() }) }))));
    const api = stubApi();
    await startRestart(api);
    t.mock.timers.tick(2000);
    await flush();
    assert.equal(statePolls().length, 1);
    cleanup();
    release();
    await flush();
    t.mock.timers.tick(30_000);
    await flush();
    assert.equal(statePolls().length, 1);
    assert.equal(api.settles, 0);
  });
});

describe("host actions: inert without controls", () => {
  test("no controls: clicking posts nothing and opens nothing", () => {
    render(<Board payload={payload([unitRow()])} group="infrastructure" />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    assert.equal(confirmFor("stop").hidden, true);
    assert.equal(posts().length, 0);
  });

  test("no controls and a run in progress: nothing polls", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 9, 22, 12) });
    render(<Board payload={payload([unitRow()], { lastRuns: { [UNIT]: runState("update", "running") } })} group="infrastructure" />);
    t.mock.timers.tick(10_000);
    await act(async () => {
      await new Promise((r) => setImmediate(r));
    });
    assert.equal(statePolls().length, 0);
  });
});
