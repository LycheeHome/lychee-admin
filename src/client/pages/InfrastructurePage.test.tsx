import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "../queryClient";
import { InfrastructurePage } from "./InfrastructurePage";

// The board's parity with the server, infrastructure included, is
// BoardParity.test.tsx's.

// node:test has no global afterEach for Testing Library to hook into.
afterEach(cleanup);

describe("InfrastructurePage", () => {
  test("a failed fetch renders the server's reason in an alert", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false, reason: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    // retry off so the test does not wait out the default one-second retry.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(
        <QueryClientProvider client={client}>
          <InfrastructurePage />
        </QueryClientProvider>,
      );
      // A generous timeout: the default 1s flakes when the whole suite runs in parallel.
      const alert = await screen.findByRole("alert", {}, { timeout: 5000 });
      assert.match(alert.textContent ?? "", /boom/);
    } finally {
      globalThis.fetch = original;
      cleanup();
      // Drops the cache's garbage-collection timers, which would otherwise
      // keep the test process alive for gcTime (five minutes).
      client.clear();
    }
  });

  test("a loaded payload renders the infrastructure board", async () => {
    const original = globalThis.fetch;
    const payload = {
      ok: true,
      board: {
        inventoryAvailable: true,
        schedule: { next: null, last: null },
        timerUnit: null,
        generated: null,
        groups: [{ group: "infrastructure", rows: [{ name: "caddy", kind: "unit", unit: "caddy.service", group: "infrastructure", reconciled: false, status: "running", since: null }] }],
      },
      boardEmpty: false,
      now: "2026-10-02T05:00:00Z",
      domain: "lychee.land",
      prunable: [],
      managed: [],
      requested: {},
      lastRuns: {},
    };
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
      render(
        <QueryClientProvider client={client}>
          <InfrastructurePage />
        </QueryClientProvider>,
      );
      assert.ok(await screen.findByText("caddy", {}, { timeout: 5000 }));
      assert.ok(screen.getByRole("heading", { name: "Infrastructure" }));
    } finally {
      globalThis.fetch = original;
      cleanup();
      client.clear();
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
