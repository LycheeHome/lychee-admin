import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActionState, BoardPayload, BoardRow, ServiceGroup } from "../../shared/board";
import { boardQueryKey } from "../api";
import { createQueryClient } from "../queryClient";
import { seedHealth } from "../test/healthFixture";
import { BoardPage } from "./BoardPage";
import { ACTION_POLL_MS, pollTimers } from "../components/HostActions";

/*
 * The live board page: one group's board, re-read every 15s (3s while a row
 * is in progress), keeping the last good board when a re-read fails, with its
 * own controls wired. The board's parity with the server, every group
 * included, is BoardParity.test.tsx's.
 */

afterEach(cleanup);

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const UNIT = "palworld-palchuds";

type Call = { method: string; url: string };
let calls: Call[] = [];
let current: BoardPayload;
let boardAnswer: () => Response;
let writeAnswer: () => Response;
let stateAnswer: () => Response;
let client: QueryClient;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function container(name: string, extra: Partial<BoardRow> = {}, group: ServiceGroup = "service"): BoardRow {
  return { name, kind: "container", container: name, group, reconciled: true, status: "running", since: null, ...extra } as BoardRow;
}

function unitRow(extra: Partial<BoardRow> = {}): BoardRow {
  return {
    name: UNIT,
    kind: "unit",
    unit: `${UNIT}.service`,
    group: "service",
    reconciled: false,
    // Stopped, so the strip offers Start, which posts without a confirmation.
    status: "exited",
    since: "2026-10-22T10:00:00Z",
    actions: ["start", "stop", "restart", "update"],
    ...extra,
  } as BoardRow;
}

function payload(rows: BoardRow[], extra: Partial<BoardPayload> = {}, group: ServiceGroup = "service"): BoardPayload {
  return {
    board: {
      inventoryAvailable: true,
      schedule: { next: null, last: null },
      timerUnit: null,
      generated: "2026-10-22T11:58:00Z",
      groups: [{ group, rows }],
    },
    boardEmpty: false,
    now: "2026-10-22T12:00:00Z",
    domain: "lychee.land",
    prunable: [], retiring: [],
    managed: [],
    requested: {},
    lastRuns: {},
    ...extra,
  };
}

const SETTLED = () => payload([container("notes", { version: "v1.4.0", target: "v1.4.0", result: "deployed" })]);
const APPLYING = () => payload([container("notes", { version: "v1.4.0", target: "v1.5.0", result: "deployed" })]);

before(() => {
  document.body.innerHTML = `<div id="flash-banner" class="hidden" role="status">
    <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden">x</button></div>`;
});

beforeEach(() => {
  calls = [];
  current = SETTLED();
  boardAnswer = () => json(200, { ok: true, ...current });
  writeAnswer = () => json(200, { ok: true });
  stateAnswer = () => json(200, { ok: true, state: { unit: UNIT, action: "start", state: "running", logTail: "", startedAt: new Date().toISOString() } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (method === "GET" && url.startsWith("/api/services")) return boardAnswer();
    if (method === "GET" && url === "/api/health") return json(200, { ok: true, ...seedHealth() });
    if (method === "GET" && url.endsWith("/state")) return stateAnswer();
    if (method === "POST" && url.includes("/actions/")) {
      return json(202, { ok: true, state: { unit: UNIT, action: "start", state: "running", logTail: "", startedAt: new Date().toISOString() } });
    }
    return writeAnswer();
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  client?.clear();
  document.title = "";
});

after(() => {
  globalThis.fetch = originalFetch;
});

function mount(group: ServiceGroup = "service"): QueryClient {
  // retry off so a failure is an error at once; mutations collected at once,
  // or their 5-minute gc timer holds the test process open.
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <BoardPage group={group} />
    </QueryClientProvider>,
  );
  return client;
}

const refetch = (group: ServiceGroup = "service") =>
  act(async () => {
    await client.refetchQueries({ queryKey: boardQueryKey(group) });
  });

/** The interval the mounted page's own observer would use right now. */
function interval(group: ServiceGroup = "service"): unknown {
  const query = client.getQueryCache().find({ queryKey: boardQueryKey(group) });
  assert.ok(query, "no board query");
  const observer = query.observers[0];
  assert.ok(observer, "the page does not observe its board");
  const option = observer.options.refetchInterval;
  return typeof option === "function" ? option(query) : option;
}

const ALERT = /^Couldn't refresh the services board: /;

describe("BoardPage", () => {
  test("a loaded payload renders the group's board under its eyebrow", async () => {
    current = payload([{ name: "caddy", kind: "unit", unit: "caddy.service", group: "infrastructure", reconciled: false, status: "running", since: null } as BoardRow], {}, "infrastructure");
    mount("infrastructure");
    assert.ok(await screen.findByText("caddy", {}, TIMEOUT));
    assert.ok(screen.getByRole("heading", { name: "Infrastructure" }));
    assert.ok(calls.some((c) => c.url === "/api/services?group=infrastructure"));
  });

  test("a failed first load shows the alert alone", async () => {
    boardAnswer = () => json(500, { ok: false, reason: "boom" });
    mount();
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh the services board: boom");
    assert.ok(!document.querySelector("h2"));
    assert.ok(!document.querySelector("[data-service]"));
  });

  test("a failed refetch keeps the last board and shows the alert above its rows; the next success clears it", async () => {
    mount();
    await waitFor(() => assert.ok(document.querySelector('[data-service="notes"]')), TIMEOUT);
    assert.ok(!screen.queryByRole("alert"));

    boardAnswer = () => json(502, { ok: false, reason: "Could not read services: boom" });
    await refetch();
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh the services board: Could not read services: boom");
    assert.match(alert.textContent ?? "", ALERT);
    assert.ok(document.querySelector('[data-service="notes"]'), "the board was replaced");
    // Above the rows.
    const list = document.querySelector("ul");
    assert.ok(list && alert.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING);

    boardAnswer = () => json(200, { ok: true, ...current });
    await refetch();
    await waitFor(() => assert.ok(!screen.queryByRole("alert")), TIMEOUT);
    assert.ok(document.querySelector('[data-service="notes"]'));
  });

  test("sets the server's title and focuses the eyebrow, which takes focus but is not in the tab order", async () => {
    mount("reconciler");
    current = payload([], {}, "reconciler");
    const heading = await screen.findByRole("heading", { name: "Reconciler" }, TIMEOUT);
    assert.equal(document.title, "Reconciler");
    await waitFor(() => assert.equal(document.activeElement, heading), TIMEOUT);
    assert.equal(heading.getAttribute("tabindex"), "-1");
  });

  test("never takes focus from the find box", async () => {
    const find = document.createElement("input");
    find.id = "find";
    document.body.appendChild(find);
    try {
      find.focus();
      mount();
      await screen.findByRole("heading", { name: "Services" }, TIMEOUT);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(document.activeElement, find);
    } finally {
      find.remove();
    }
  });
});

describe("BoardPage polling", () => {
  test("15s on a settled board, 3s while a row is applying, and 15s again once it settles", async () => {
    mount();
    await waitFor(() => assert.ok(document.querySelector('[data-service="notes"]')), TIMEOUT);
    assert.equal(interval(), 15_000);

    current = APPLYING();
    await refetch();
    await waitFor(() => assert.equal(interval(), 3_000), TIMEOUT);

    current = SETTLED();
    await refetch();
    await waitFor(() => assert.equal(interval(), 15_000), TIMEOUT);
  });

  test("a requested tag the version does not show yet polls at 3s", async () => {
    current = payload([container("notes", { version: "v1.4.0", target: "v1.4.0", available: "v1.5.0", result: "deployed" })], {
      requested: { notes: "v1.5.0" },
    });
    mount();
    await waitFor(() => assert.ok(document.querySelector('[data-service="notes"]')), TIMEOUT);
    assert.equal(interval(), 3_000);
  });

  test("a running action on a unit outside this page's group does not hold it at 3s", async () => {
    current = payload([container("lychee-reconcile", {}, "reconciler")], {
      lastRuns: { [UNIT]: { unit: UNIT, action: "restart", state: "running", logTail: "" } as ActionState },
    }, "reconciler");
    mount("reconciler");
    await waitFor(() => assert.ok(document.querySelector('[data-service="lychee-reconcile"]')), TIMEOUT);
    assert.equal(interval("reconciler"), 15_000);
  });

  test("pauses in the background and refetches on focus", async () => {
    mount();
    await waitFor(() => assert.ok(document.querySelector('[data-service="notes"]')), TIMEOUT);
    const query = client.getQueryCache().find({ queryKey: boardQueryKey("service") });
    const options = query?.observers[0]?.options;
    assert.equal(options?.refetchIntervalInBackground, false);
    assert.equal(options?.refetchOnWindowFocus, true);
  });
});

describe("BoardPage controls", () => {
  test("wires its own controls: Deploy on the page posts the write", async () => {
    current = payload([container("app-lychee-land", { version: "0.2.0", target: "0.2.0", available: "0.3.0", result: "deployed" })]);
    mount();
    const button = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>('[data-deploy="app-lychee-land"]');
      assert.ok(b);
      return b;
    }, TIMEOUT);
    fireEvent.click(button);
    await waitFor(
      () => assert.ok(calls.some((c) => c.method === "POST" && c.url === "/services/app-lychee-land/deploy")),
      TIMEOUT,
    );
  });

  test("wires its own controls: Start on a host-action strip posts the action", async () => {
    current = payload([unitRow()]);
    mount();
    const start = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>(`[data-host-actions="${UNIT}"] [data-host-action="start"]`);
      assert.ok(b);
      return b;
    }, TIMEOUT);
    fireEvent.click(start);
    await waitFor(
      () => assert.ok(calls.some((c) => c.method === "POST" && c.url === `/services/${UNIT}/actions/start`)),
      TIMEOUT,
    );
    // Let the strip settle into its run before teardown.
    await waitFor(() => assert.ok(document.querySelector(`[data-host-actions="${UNIT}"][data-running]`)), TIMEOUT);
  });

  test("a board refetch mid-run neither starts a second state poll nor restarts the first", async () => {
    // The state poll's own timers are held here instead of running on the
    // clock, so the test fires each poll itself and needs no sleeps: a second
    // poll would show up as a second held timer, a restart as a cleared one.
    // Held through the poll's own seam, never by delay: TanStack's stale timer
    // is 2000 ms too whenever a millisecond passes before it is set, and a
    // delay filter caught it as a second poll under load.
    const held = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextId = 1;
    const realTimers = { ...pollTimers };
    pollTimers.set = (fn, ms) => {
      assert.equal(ms, ACTION_POLL_MS);
      // Negative, so a held id can never be one a real timer handed out.
      const id = -nextId++;
      held.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    };
    pollTimers.clear = (id) => {
      const key = id as unknown as number;
      if (held.has(key)) {
        held.delete(key);
        cleared.push(key);
      }
    };
    const statePolls = () => calls.filter((c) => c.method === "GET" && c.url.endsWith("/state")).length;
    /** Fires the one held poll timer and waits for its fetch to have been made. */
    const firePoll = async (expected: number) => {
      assert.equal(held.size, 1, `held poll timers: ${held.size}`);
      const [[id, fn]] = [...held];
      held.delete(id);
      await act(async () => fn());
      await waitFor(() => assert.equal(statePolls(), expected), TIMEOUT);
    };

    try {
      current = payload([unitRow()]);
      mount();
      const start = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>(`[data-host-actions="${UNIT}"] [data-host-action="start"]`);
        assert.ok(b);
        return b;
      }, TIMEOUT);
      fireEvent.click(start);
      // The 202 starts the poll: one timer, nothing fetched yet.
      await waitFor(() => assert.equal(held.size, 1), TIMEOUT);
      assert.equal(statePolls(), 0);

      await firePoll(1);
      // The poll re-armed itself for its next tick.
      await waitFor(() => assert.equal(held.size, 1), TIMEOUT);
      const armed = [...held.keys()];

      // Between two polls the board is re-read and now shows the run too, as
      // the server's would: the page moves to 3s, and the poll is untouched.
      // A second row marks the re-read board as rendered: the cache landing is
      // not enough, the rows must have re-rendered with it.
      current = payload([unitRow(), container("marker")], {
        lastRuns: { [UNIT]: { unit: UNIT, action: "start", state: "running", logTail: "", startedAt: new Date().toISOString() } as ActionState },
      });
      await refetch();
      await waitFor(() => assert.ok(document.querySelector('[data-service="marker"]')), TIMEOUT);
      await act(async () => {});
      assert.equal(interval(), 3_000);
      assert.deepEqual([...held.keys()], armed, "the refetch armed a second poll or replaced the first");
      assert.deepEqual(cleared, []);
      assert.equal(statePolls(), 1);

      // The same poll's next tick: exactly one more state read.
      await firePoll(2);
    } finally {
      pollTimers.set = realTimers.set;
      pollTimers.clear = realTimers.clear;
    }
  });
});

describe("createQueryClient", () => {
  test("has the foundation's query defaults", () => {
    const queries = createQueryClient().getDefaultOptions().queries;
    assert.equal(queries?.staleTime, 0);
    assert.equal(queries?.refetchOnWindowFocus, true);
    assert.equal(queries?.retry, 1);
  });
});
