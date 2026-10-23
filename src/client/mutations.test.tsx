import "./test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BoardPayload, BoardRow } from "../shared/board";
import { BoardPage } from "./pages/BoardPage";
import { useHealth } from "./health";
import { seedHealth } from "./test/healthFixture";

// The whole path under test: the real page and a stubbed fetch. The retired
// public/app.js used to be loaded into the document here too, because it
// bound [data-deploy] and [data-prune] at load and a click on React's button
// had to send exactly one write regardless; with it gone, the page's own
// handler is the only one there is, and every write is still counted.

afterEach(cleanup);

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const TOAST = () => document.getElementById("flash-banner-message")!.textContent;

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let current: BoardPayload;
let writeAnswer: () => Response | Promise<Response>;

function row(name: string, extra: Partial<BoardRow> = {}): BoardRow {
  return {
    name,
    kind: "container",
    container: name,
    group: "infrastructure",
    reconciled: true,
    status: "running",
    since: null,
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

const OFFERING = () =>
  payload([row("app-lychee-land", { version: "0.2.0", target: "0.2.0", available: "0.3.0", result: "deployed" })]);

before(() => {
  document.body.innerHTML = `<div id="flash-banner" class="hidden" role="status">
    <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden">x</button></div>
    <span id="copy-status"></span>`;
});

beforeEach(() => {
  calls = [];
  current = OFFERING();
  writeAnswer = () => json(200, { ok: true });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body });
    if (method === "GET" && url.startsWith("/api/services")) return json(200, { ok: true, ...current });
    if (method === "GET" && url === "/api/health") return json(200, { ok: true, ...seedHealth() });
    return writeAnswer();
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

const posts = () => calls.filter((c) => c.method === "POST");
const gets = (prefix: string) => calls.filter((c) => c.method === "GET" && c.url.startsWith(prefix));

/**
 * Unmount first, then drop the cache: clearing under a mounted observer lets
 * it schedule garbage-collection timers that keep the test process alive.
 */
function finish(client: QueryClient) {
  cleanup();
  client.clear();
}

/** Stands in for the rail island, which shares the client and so keeps the health query observed. */
function HealthObserver() {
  useHealth();
  return null;
}

function mount(): QueryClient {
  // A mutation still observed at unmount arms a 5-minute garbage-collection
  // timer that client.clear() leaves running, which held this file's process
  // open for five minutes after its last test: collect it at once instead.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <HealthObserver />
      <BoardPage group="infrastructure" />
    </QueryClientProvider>,
  );
  return client;
}

describe("Deploy", () => {
  test("one click sends one POST with no body, disables the button and toasts", async () => {
    let release!: () => void;
    writeAnswer = () => new Promise((r) => (release = () => r(json(200, { ok: true }))));
    const client = mount();
    try {
      const button = (await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT)) as HTMLButtonElement;
      fireEvent.click(button);
      fireEvent.click(button);
      assert.equal(TOAST(), "Requesting 0.3.0 for app-lychee-land…");
      await waitFor(() => assert.equal(button.disabled, true), TIMEOUT);
      await waitFor(() => assert.equal(posts().length, 1), TIMEOUT);
      assert.equal(posts()[0].url, "/services/app-lychee-land/deploy");
      assert.equal(posts()[0].body, undefined);
      // Settle the write and wait for the mutation to finish (the board still offers the tag, so the button returns), so nothing runs on into the next test.
      release();
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
      assert.equal(posts().length, 1);
    } finally {
      finish(client);
    }
  });

  test("on success the board refetches and the requested line replaces the offer", async () => {
    const client = mount();
    try {
      const button = await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT);
      const boardReads = gets("/api/services").length;
      const healthReads = gets("/api/health").length;
      current = payload(
        [row("app-lychee-land", { version: "0.2.0", target: "0.2.0", available: "0.3.0", result: "deployed" })],
        { requested: { "app-lychee-land": "0.3.0" } },
      );
      fireEvent.click(button);
      const line = await screen.findByText("· applies on the next run", {}, TIMEOUT);
      assert.ok(line);
      assert.equal(screen.queryByRole("button", { name: "Deploy 0.3.0" }), null);
      assert.ok(gets("/api/services").length > boardReads);
      assert.ok(gets("/api/health").length > healthReads);
      await waitFor(() => assert.ok(document.getElementById("flash-banner")!.classList.contains("hidden")), TIMEOUT);
      assert.equal(posts().length, 1);
    } finally {
      finish(client);
    }
  });

  test("the button stays disabled until the refetch lands", async () => {
    const client = mount();
    try {
      const button = (await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT)) as HTMLButtonElement;
      let release: (() => void) | undefined;
      const baseFetch = globalThis.fetch;
      let held = true;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (held && String(input).startsWith("/api/services")) {
          held = false;
          await new Promise<void>((r) => (release = r));
        }
        return baseFetch(input, init);
      }) as typeof fetch;
      fireEvent.click(button);
      // The write has answered and the board's re-read has started but not finished.
      await waitFor(() => assert.ok(release), TIMEOUT);
      assert.equal(posts().length, 1);
      assert.equal(button.disabled, true);
      release!();
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("a refusal shows the server's reason and re-enables the button", async () => {
    writeAnswer = () => json(409, { ok: false, reason: "a deploy is already requested" });
    const client = mount();
    try {
      const button = (await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT)) as HTMLButtonElement;
      fireEvent.click(button);
      await waitFor(() => assert.equal(TOAST(), "a deploy is already requested"), TIMEOUT);
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
      assert.ok(screen.getByRole("button", { name: "Deploy 0.3.0" }));
    } finally {
      finish(client);
    }
  });

  test("a refusal without a reason names the HTTP status", async () => {
    writeAnswer = () => new Response("bad gateway", { status: 502 });
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT));
      await waitFor(() => assert.equal(TOAST(), "Could not request 0.3.0 for app-lychee-land (HTTP 502)."), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("a network failure says the server could not be reached and re-enables the button", async () => {
    writeAnswer = () => {
      throw new TypeError("fetch failed");
    };
    const client = mount();
    try {
      const button = (await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT)) as HTMLButtonElement;
      fireEvent.click(button);
      await waitFor(() => assert.equal(TOAST(), "Could not reach the server to request 0.3.0 for app-lychee-land."), TIMEOUT);
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("a name with a dot reaches the URL encoded", async () => {
    current = payload([row("a.b", { version: "0.2.0", target: "0.2.0", available: "0.3.0", result: "deployed" })]);
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT));
      await waitFor(() => assert.equal(posts().length, 1), TIMEOUT);
      assert.equal(posts()[0].url, `/services/${encodeURIComponent("a.b")}/deploy`);
    } finally {
      finish(client);
    }
  });
});

describe("Deploy: focus and the fallback", () => {
  const REQUESTED = (tag = "0.3.0") =>
    payload([row("app-lychee-land", { version: "0.2.0", target: "0.2.0", available: tag, result: "deployed" })], {
      requested: { "app-lychee-land": tag },
    });

  test("after a successful Deploy the row's requested line has focus", async () => {
    const client = mount();
    try {
      const button = await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT);
      button.focus();
      current = REQUESTED();
      fireEvent.click(button);
      await waitFor(() => assert.ok(document.querySelector("[data-requested]")), TIMEOUT);
      await waitFor(() => assert.ok(document.activeElement === document.querySelector("[data-requested]")), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("when the re-read has no requested line, the fallback success toast stays and the button re-enables", async () => {
    const client = mount();
    try {
      const button = (await screen.findByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT)) as HTMLButtonElement;
      // The board still offers the tag and says nothing was requested.
      fireEvent.click(button);
      await waitFor(
        () => assert.equal(TOAST(), "Requested 0.3.0 for app-lychee-land. The reconciler applies it on its next run."),
        TIMEOUT,
      );
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
      assert.ok(!document.getElementById("flash-banner")!.classList.contains("hidden"));
    } finally {
      finish(client);
    }
  });

  test("deploying A while B is in flight sends both, and a second click on A sends nothing", async () => {
    current = payload([
      row("a-lychee-land", { version: "0.2.0", target: "0.2.0", available: "0.3.0", result: "deployed" }),
      row("b-lychee-land", { version: "0.2.0", target: "0.2.0", available: "0.3.0", result: "deployed" }),
    ]);
    const releases: Array<() => void> = [];
    writeAnswer = () => new Promise((r) => releases.push(() => r(json(200, { ok: true }))));
    const client = mount();
    try {
      const [b, a] = (await screen.findAllByRole("button", { name: "Deploy 0.3.0" }, TIMEOUT)).reverse() as HTMLButtonElement[];
      fireEvent.click(b);
      fireEvent.click(a);
      fireEvent.click(a);
      await waitFor(() => assert.equal(posts().length, 2), TIMEOUT);
      assert.deepEqual(posts().map((p) => p.url).sort(), ["/services/a-lychee-land/deploy", "/services/b-lychee-land/deploy"]);
      for (const release of releases) release();
      await waitFor(() => assert.equal(a.disabled, false), TIMEOUT);
      await waitFor(() => assert.equal(b.disabled, false), TIMEOUT);
      assert.equal(posts().length, 2);
    } finally {
      finish(client);
    }
  });
});

describe("Prune", () => {
  const prunable = () =>
    payload([row("gone-lychee-land", { status: "unknown", reconciled: true })], { prunable: ["gone-lychee-land"] });

  test("one click sends one POST, the board refetches and the prune line disappears", async () => {
    current = prunable();
    const client = mount();
    try {
      const button = await screen.findByRole("button", { name: "Prune old declaration" }, TIMEOUT);
      current = payload([row("gone-lychee-land", { status: "unknown", reconciled: true })]);
      fireEvent.click(button);
      await waitFor(() => assert.ok(!document.querySelector("[data-prune]"), "the prune line is still there"), TIMEOUT);
      assert.equal(posts().length, 1);
      assert.equal(posts()[0].url, "/resources/gone-lychee-land/prune");
      assert.equal(posts()[0].body, undefined);
    } finally {
      finish(client);
    }
  });

  test("a successful Prune confirms in a toast and keeps focus in its row", async () => {
    current = prunable();
    const client = mount();
    try {
      const button = await screen.findByRole("button", { name: "Prune old declaration" }, TIMEOUT);
      const rowEl = document.getElementById("service-gone-lychee-land")!;
      assert.ok(!rowEl.hasAttribute("tabindex"), "the markup carries no tabindex");
      current = payload([row("gone-lychee-land", { status: "unknown", reconciled: true })]);
      button.focus();
      fireEvent.click(button);
      await waitFor(() => assert.ok(!document.querySelector("[data-prune]"), "the prune line is still there"), TIMEOUT);
      await waitFor(() => assert.equal(TOAST(), "Pruned gone-lychee-land.yml from lychee-resources."), TIMEOUT);
      await waitFor(() => assert.ok(document.getElementById("service-gone-lychee-land")!.contains(document.activeElement), "focus is in the row"), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("a 409 shows the reason in the retired app.js's format and re-enables the button", async () => {
    current = prunable();
    writeAnswer = () => json(409, { ok: false, reason: "the container hasn't been confirmed down yet" });
    const client = mount();
    try {
      const button = (await screen.findByRole("button", { name: "Prune old declaration" }, TIMEOUT)) as HTMLButtonElement;
      fireEvent.click(button);
      await waitFor(
        () => assert.equal(TOAST(), "gone-lychee-land.yml was not pruned: the container hasn't been confirmed down yet"),
        TIMEOUT,
      );
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("a network failure shows the retired app.js's message", async () => {
    current = prunable();
    writeAnswer = () => {
      throw new TypeError("fetch failed");
    };
    const client = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Prune old declaration" }, TIMEOUT));
      await waitFor(() => assert.equal(TOAST(), "Could not reach the server to prune gone-lychee-land.yml."), TIMEOUT);
    } finally {
      finish(client);
    }
  });
});
