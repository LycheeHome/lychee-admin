import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { renderServicesPage } from "../../views/html";
import type { BoardRow, ServiceBoard } from "../../shared/board";
import { InfrastructureBoard } from "../components/BoardRows";
import { createQueryClient } from "../queryClient";
import { InfrastructurePage } from "./InfrastructurePage";

// node:test has no global afterEach for Testing Library to hook into.
afterEach(cleanup);

const NOW = new Date("2026-10-02T05:00:00Z");
const NO_SCHEDULE = { next: null, last: null };

function unit(name: string, extra: Partial<BoardRow> = {}): BoardRow {
  return {
    name,
    kind: "unit",
    unit: `${name}.service`,
    group: "infrastructure",
    reconciled: false,
    status: "running",
    since: "2026-10-01T05:00:00Z",
    ...extra,
  } as BoardRow;
}

function infraBoard(rows: BoardRow[], extra: Partial<ServiceBoard> = {}): ServiceBoard {
  return {
    inventoryAvailable: true,
    schedule: NO_SCHEDULE,
    timerUnit: null,
    generated: "2026-10-02T04:58:02Z",
    groups: [{ group: "infrastructure", rows }],
    ...extra,
  };
}

// The board region: the frame the page body opens with, up to the end of
// <main>. React renders exactly that frame, so its whole output is compared.
const START = '<div class="max-w-[1080px] mx-auto w-full flex flex-col gap-8">';
const END = "</main>";

function serverRegion(html: string): string {
  const start = html.indexOf(START);
  const end = html.indexOf(END, start);
  assert.ok(start >= 0 && end > start, "board region markers not found in the server page");
  return html.slice(start, end);
}

/**
 * A canonical form of an HTML fragment, parsed by happy-dom so entities are
 * decoded identically on both sides (`&#9679;` and `●`, `'` and `&#x27;`).
 * Attributes are sorted by name; text collapses runs of whitespace to one
 * space, drops whitespace-only nodes, and trims at a parent's start and end,
 * which is the whitespace HTML renders the same either way. A space between
 * two inline siblings is kept.
 */
function canonical(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      let text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (text === " ") return "";
      if (!node.previousSibling) text = text.trimStart();
      if (!node.nextSibling) text = text.trimEnd();
      return text;
    }
    if (node.nodeType !== 1) return "";
    const el = node as Element;
    const attrs = Array.from(el.attributes)
      .map((a) => `${a.name}="${a.value}"`)
      .sort()
      .join(" ");
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.nodeName === "TEMPLATE" ? (el as HTMLTemplateElement).content.childNodes : el.childNodes)
      .map(walk)
      .join("");
    return `<${tag}${attrs ? ` ${attrs}` : ""}>${inner}</${tag}>`;
  };
  return Array.from(template.content.childNodes).map(walk).join("");
}

/** Asserts parity and returns the server's region, so a test can check its fixture reached the branch it names. */
function assertParity(board: ServiceBoard): string {
  const server = serverRegion(renderServicesPage(board, NOW, new Set(), "lychee.land", {}, "infrastructure"));
  const client = renderToStaticMarkup(
    <InfrastructureBoard board={board} boardEmpty={board.groups.length === 0} now={NOW} />,
  );
  assert.equal(canonical(client), canonical(server));
  return server;
}

describe("InfrastructureBoard parity with renderServicesPage", () => {
  test("two healthy rows", () => {
    assertParity(infraBoard([unit("caddy", { version: "v2.11.4" }), unit("cloudflared-sites")]));
  });

  test("a row whose state could not be read", () => {
    assertParity(infraBoard([unit("caddy", { status: "unknown", since: null })]));
  });

  test("an unavailable inventory", () => {
    assertParity({ groups: [], schedule: NO_SCHEDULE, timerUnit: null, generated: null, inventoryAvailable: false });
  });

  // Beyond the brief's three: the remaining branches the component renders.
  test("an available inventory that declares nothing anywhere", () => {
    assertParity({ groups: [], schedule: NO_SCHEDULE, timerUnit: null, generated: null, inventoryAvailable: true });
  });

  test("a readable inventory with nothing in this group", () => {
    assertParity(infraBoard([], { groups: [{ group: "service", rows: [unit("palworld", { group: "service" })] }] }));
  });

  test("blocked, failed and applying rows", () => {
    const server = assertParity(
      infraBoard([
        unit("caddy", { version: "v2.11.4", result: "blocked", gateCode: "ci-failed", gate: "job test concluded: failure" }),
        unit("cloudflared-sites", { version: "v1", target: "v2", result: "failed", failedStep: "pull: denied", failedAttempts: 2 }),
        unit("tunnel-b", { version: "v1", target: "v2", result: "deployed" }),
        unit("tunnel-c", { result: "blocked", gate: "something new" }),
        unit("tunnel-d", { result: "failed", status: "exited" }),
      ]),
    );
    for (const branch of ["data-deploy-state", "data-gate", "data-deploy-failed", "data-failed-step", "applying", "2 attempts", "blocked ·"]) {
      assert.ok(server.includes(branch), `fixture never reached ${branch}`);
    }
  });

  test("a mismatch is caught", () => {
    const board = infraBoard([unit("caddy")]);
    const server = serverRegion(renderServicesPage(board, NOW, new Set(), "lychee.land", {}, "infrastructure"));
    const other = renderToStaticMarkup(<InfrastructureBoard board={infraBoard([unit("caddy", { status: "exited" })])} boardEmpty={false} now={NOW} />);
    assert.notEqual(canonical(other), canonical(server));
  });
});

describe("InfrastructureBoard", () => {
  test("a row that lists host actions renders without an action strip", () => {
    const board = infraBoard([unit("caddy", { actions: ["restart"] } as Partial<BoardRow>)]);
    const { container } = render(<InfrastructureBoard board={board} boardEmpty={false} now={NOW} />);
    assert.ok(container.querySelector('[data-service="caddy"]'));
    assert.equal(container.querySelector("[data-action-strip]"), null);
    assert.equal(container.querySelector("[data-host-actions]"), null);
  });
});

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
      const alert = await screen.findByRole("alert");
      assert.match(alert.textContent ?? "", /boom/);
    } finally {
      globalThis.fetch = original;
      cleanup();
      // Drops the cache's garbage-collection timers, which would otherwise
      // keep the test process alive for gcTime (five minutes).
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
