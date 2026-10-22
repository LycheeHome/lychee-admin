import "./test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { Root } from "react-dom/client";
import { renderRail, renderRailData } from "../views/rail";
import { RAIL_DOT } from "../views/railModel";
import { testShell } from "../dev/testHelpers";
import { seedHealth } from "./test/healthFixture";
import { HEALTH_QUERY, fetchHealth } from "./health";
import { mountRailIsland } from "./RailIsland";

const originalFetch = globalThis.fetch;
let root: Root | null = null;
let client: QueryClient | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  // Drops the cache's timers, which would otherwise keep the process alive.
  client?.clear();
  client = null;
  globalThis.fetch = originalFetch;
  delete (navigator as unknown as Record<string, unknown>).platform;
  document.body.innerHTML = "";
});

type Answer = { status: number; body: unknown };

/** Stubs fetch with whatever `answer()` returns at call time, so a test can change it between polls. */
function stubFetch(answer: () => Answer): void {
  globalThis.fetch = (async () => {
    const { status, body } = answer();
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const ok = (): Answer => ({ status: 200, body: { ok: true, ...seedHealth() } });

/** Server markup, as layout() emits it, then the island mounted over it. */
function mount(): void {
  const rail = testShell({ current: { page: "sites" } }).rail;
  document.body.innerHTML = renderRail(rail) + renderRailData(rail);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() => {
    root = mountRailIsland(client as QueryClient);
  });
  assert.ok(root, "the island did not mount");
}

const dot = (hostname: string): string =>
  document.querySelector(`#rail [data-site="${hostname}"] [data-dot]`)?.getAttribute("class") ?? "";

const setPlatform = (value: string): void => {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
};

describe("the rail island", () => {
  test("takes over the server's rail and fills in the bad dot from the poll", async () => {
    stubFetch(ok);
    mount();
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.bad), { timeout: 5000 });
    assert.equal(dot("app.lychee.land"), RAIL_DOT.ok);
    // The aside itself stays the server's.
    assert.ok(document.querySelector("aside#rail[data-rail]"));
    assert.equal(document.querySelectorAll("#rail [data-site]").length, 8);
  });

  test("a failed poll after a good one never shows the remembered green", async () => {
    let answer = ok;
    stubFetch(() => answer());
    mount();
    await waitFor(() => assert.equal(dot("app.lychee.land"), RAIL_DOT.ok), { timeout: 5000 });

    answer = () => ({ status: 500, body: { ok: false, reason: "boom" } });
    await act(async () => {
      await client?.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    });
    await waitFor(() => assert.equal(dot("app.lychee.land"), RAIL_DOT.neutral), { timeout: 5000 });
    assert.match(document.querySelector("#rail")?.textContent ?? "", /health unavailable · last read (just now|\d+ seconds? ago)/);
    assert.equal(document.querySelector('#rail [data-count="sites"]')?.textContent, "");
  });

  test("a failed first poll stays unavailable while the next poll is in flight", async () => {
    stubFetch(() => ({ status: 500, body: { ok: false, reason: "boom" } }));
    mount();
    const line = () => document.querySelector("#rail [data-health-unavailable]")?.textContent ?? null;
    await waitFor(() => assert.equal(line(), "health unavailable"), { timeout: 5000 });

    // The next poll is held open. TanStack resets a data-less errored query
    // to pending while it refetches; the rail must still say unavailable.
    let answer: (r: Response) => void = () => {};
    globalThis.fetch = (() => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch;
    const refetch = client?.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    try {
      await waitFor(() => assert.equal(client?.getQueryState(HEALTH_QUERY.queryKey)?.fetchStatus, "fetching"), {
        timeout: 5000,
      });
      assert.equal(line(), "health unavailable");
      assert.equal(dot("api.lychee.land"), RAIL_DOT.neutral);
    } finally {
      // Settle the held poll so nothing is left in flight.
      answer(new Response(JSON.stringify({ ok: false, reason: "boom" }), { status: 500 }));
      await act(async () => {
        await refetch;
      });
    }
  });

  test("prints Ctrl K off Apple platforms", async () => {
    setPlatform("Win32");
    stubFetch(ok);
    mount();
    await waitFor(() => assert.equal(document.querySelector("#rail [data-find-hint]")?.textContent, "Ctrl K"), {
      timeout: 5000,
    });
  });

  test("prints ⌘K on Apple platforms", async () => {
    setPlatform("MacIntel");
    stubFetch(ok);
    mount();
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.bad), { timeout: 5000 });
    assert.equal(document.querySelector("#rail [data-find-hint]")?.textContent, "⌘K");
  });

  test("an errored poll between two good ones clears: the dots show their tones again", async () => {
    let answer = ok;
    stubFetch(() => answer());
    mount();
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.bad), { timeout: 5000 });

    answer = () => ({ status: 500, body: { ok: false, reason: "boom" } });
    await act(async () => {
      await client?.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    });
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.neutral), { timeout: 5000 });
    assert.ok(document.querySelector("#rail [data-health-unavailable]"), "the error state did not show");

    answer = ok;
    await act(async () => {
      await client?.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    });
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.bad), { timeout: 5000 });
    assert.equal(dot("app.lychee.land"), RAIL_DOT.ok);
    assert.equal(document.querySelector("#rail [data-health-unavailable]"), null);
    assert.equal(document.querySelector('#rail [data-count="sites"]')?.textContent, "2");
  });

  test("text typed into the server's find box before mount is kept, with its focus", async () => {
    stubFetch(ok);
    const rail = testShell({ current: { page: "sites" } }).rail;
    document.body.innerHTML = renderRail(rail) + renderRailData(rail);
    const server = document.querySelector<HTMLInputElement>("#find");
    assert.ok(server);
    server.value = "sw";
    server.focus();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root = mountRailIsland(client as QueryClient);
    });
    const input = document.querySelector<HTMLInputElement>("#rail #find");
    assert.ok(input);
    assert.notEqual(input, server, "the island did not replace the input");
    assert.equal(input.value, "sw");
    assert.equal(document.activeElement, input);
    await waitFor(() => assert.equal(input.getAttribute("aria-expanded"), "true"), { timeout: 5000 });
  });

  test("text typed without focus is kept, and the box stays closed", async () => {
    stubFetch(ok);
    const rail = testShell().rail;
    document.body.innerHTML = renderRail(rail) + renderRailData(rail);
    const server = document.querySelector<HTMLInputElement>("#find");
    assert.ok(server);
    server.value = "api";
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root = mountRailIsland(client as QueryClient);
    });
    const input = document.querySelector<HTMLInputElement>("#rail #find");
    assert.equal(input?.value, "api");
    assert.equal(input?.getAttribute("aria-expanded"), "false");
    // Let the first poll land: one left in flight at teardown keeps the runner alive.
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.bad), { timeout: 5000 });
  });

  test("⌘K from the page opens the island's find box", async () => {
    stubFetch(ok);
    mount();
    // Let the first poll land: one left in flight at teardown keeps the runner alive.
    await waitFor(() => assert.equal(dot("api.lychee.land"), RAIL_DOT.bad), { timeout: 5000 });
    const outside = document.createElement("textarea");
    document.body.appendChild(outside);
    act(() => outside.focus());
    act(() => {
      outside.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
    });
    const input = document.querySelector<HTMLInputElement>("#rail #find");
    assert.equal(document.activeElement, input);
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    assert.equal(document.activeElement, outside);
  });

  test("does nothing without the server's rail data", () => {
    document.body.innerHTML = '<aside id="rail" data-rail></aside>';
    client = new QueryClient();
    assert.equal(mountRailIsland(client), null);
  });
});

describe("the health query", () => {
  test("polls every 15s, only while visible, and again on focus", () => {
    assert.deepEqual(HEALTH_QUERY.queryKey, ["health"]);
    assert.equal(HEALTH_QUERY.refetchInterval, 15_000);
    assert.equal(HEALTH_QUERY.refetchIntervalInBackground, false);
    assert.equal(HEALTH_QUERY.refetchOnWindowFocus, true);
  });

  test("fetchHealth returns the payload without its envelope", async () => {
    stubFetch(ok);
    const health = await fetchHealth();
    assert.deepEqual(health, seedHealth());
  });

  test("fetchHealth throws the server's reason on a failed read", async () => {
    stubFetch(() => ({ status: 500, body: { ok: false, reason: "Could not read health: boom" } }));
    await assert.rejects(fetchHealth(), /Could not read health: boom/);
  });
});
