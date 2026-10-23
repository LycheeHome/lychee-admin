import "./test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { BoardPayload, BoardRow, ServiceGroup } from "../shared/board";
import { testShell } from "../dev/testHelpers";
import { renderClientPage } from "../views/clientShell";
import { layout, type RailCurrent } from "../views/shell";
import { RAIL_DOT } from "../views/railModel";
import { seedHealth } from "./test/healthFixture";
import { BOARD_ROUTES, isClientRoute, mountApp } from "./router";

/*
 * The single root: React Router between the three board pages, the rail as a
 * portal into the server's aside, and plain anchors everywhere a router link
 * would leave a server page's body on screen (Review Focus 3).
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalScrollTo = window.scrollTo;

type HappyDOM = { setURL(url: string): void; setViewport(v: { width: number }): void };
const happyDOM = (globalThis as unknown as { happyDOM: HappyDOM }).happyDOM;

let app: ReturnType<typeof mountApp> = null;
let client: QueryClient | null = null;
let fetched: string[] = [];

afterEach(() => {
  if (app) act(() => app?.unmount());
  app = null;
  client?.clear();
  client = null;
  globalThis.fetch = originalFetch;
  Element.prototype.scrollIntoView = originalScrollIntoView;
  window.scrollTo = originalScrollTo;
  window.scrollTo(0, 0);
  sessionStorage.clear();
  window.history.scrollRestoration = "auto";
  happyDOM.setViewport({ width: 1024 });
  document.body.innerHTML = "";
  document.title = "";
  happyDOM.setURL("http://localhost/");
  // setURL keeps history.state: without this, the next test's "fresh"
  // document load would carry the last test's router key.
  window.history.replaceState(null, "");
});

const ROWS: Record<ServiceGroup, string> = { service: "swee", reconciler: "lychee-watch", infrastructure: "caddy" };

function payload(group: ServiceGroup): BoardPayload {
  const row = { name: ROWS[group], kind: "unit", unit: `${ROWS[group]}.service`, group, reconciled: false, status: "running", since: null } as BoardRow;
  return {
    board: { inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: "2026-10-22T11:58:00Z", groups: [{ group, rows: [row] }] },
    boardEmpty: false,
    now: "2026-10-22T12:00:00Z",
    domain: "lychee.land",
    prunable: [],
    managed: [],
    requested: {},
    lastRuns: {},
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function stubFetch(): void {
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url === "/api/health") return json({ ok: true, ...seedHealth() });
    const group = new URLSearchParams(url.split("?")[1] ?? "").get("group") as ServiceGroup;
    return json({ ok: true, ...payload(group) });
  }) as typeof fetch;
}

const PAGE: Record<string, "services" | "reconciler" | "infrastructure"> = {
  "/services": "services",
  "/reconciler": "reconciler",
  "/infrastructure": "infrastructure",
};
const TITLE: Record<string, string> = { "/services": "Services", "/reconciler": "Reconciler", "/infrastructure": "Infrastructure" };

/** The document the server sends for `path`, as its body, then the one root mounted over it. */
function load(path: string): void {
  stubFetch();
  happyDOM.setURL(`http://localhost${path}`);
  path = path.split("#")[0] ?? path;
  const page = PAGE[path];
  const current: RailCurrent = page ? { page } : path.startsWith("/sites/") ? { site: decodeURIComponent(path.slice(7)) } : null;
  const shell = testShell({ current });
  const html = page
    ? renderClientPage(TITLE[path], page, shell)
    : layout("broken.lychee.land", "<p id=\"server-body\">a server page</p>", { shell });
  document.title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  // The body without its script tags, which happy-dom would try to fetch.
  document.body.innerHTML = html
    .replace(/^[\s\S]*<body[^>]*>/, "")
    .replace(/<\/body>[\s\S]*$/, "")
    .replace(/<script\b[^>]*\bsrc=[^>]*><\/script>/g, "");
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  act(() => {
    app = mountApp(client as QueryClient);
  });
  assert.ok(app, "the root did not mount");
}

const row = (name: string) => document.querySelector(`[data-service="${name}"]`);
/** What has focus, briefly, for a failure message. */
const focused = () => `focus is on ${document.activeElement?.outerHTML.slice(0, 80) ?? "nothing"}`;
const railLink = (href: string) => document.querySelector<HTMLAnchorElement>(`#rail a[href="${href}"]`);
const marked = () => Array.from(document.querySelectorAll("#rail a[aria-current=\"page\"]")).map((a) => a.getAttribute("href"));
/** The rail's dots are coloured once the island owns the rail and health has landed. */
const railLive = () =>
  waitFor(() => assert.equal(document.querySelector('#rail [data-site="api.lychee.land"] [data-dot]')?.getAttribute("class"), RAIL_DOT.bad), TIMEOUT);

describe("isClientRoute", () => {
  test("is true for exactly the three board pages, with or without a hash or query", () => {
    assert.deepEqual(Object.keys(BOARD_ROUTES).sort(), ["/infrastructure", "/reconciler", "/services"]);
    for (const path of ["/services", "/reconciler", "/infrastructure", "/reconciler#service-lychee-watch", "/services?x=1"]) {
      assert.equal(isClientRoute(path), true, path);
    }
    for (const path of ["/", "/sites/new", "/sites/broken.lychee.land", "/services/swee/deploy", "/servicesx", "https://example.com/services"]) {
      assert.equal(isClientRoute(path), false, path);
    }
  });
});

describe("the single root", () => {
  test("takes the server's rail over through one portal: one rail, one #find", async () => {
    load("/services");
    await railLive();
    assert.equal(document.querySelectorAll("#find").length, 1);
    assert.equal(document.querySelectorAll("#rail nav[aria-label=\"Host\"]").length, 1);
    assert.equal(document.querySelectorAll("#top-bar h1").length, 1);
    assert.ok(await waitFor(() => row("swee") ?? assert.fail("no board"), TIMEOUT));
  });

  test("a direct visit to each board URL renders its own board", async () => {
    for (const path of ["/services", "/reconciler", "/infrastructure"]) {
      load(path);
      const group = BOARD_ROUTES[path as keyof typeof BOARD_ROUTES];
      await waitFor(() => assert.ok(row(ROWS[group]), path), TIMEOUT);
      assert.equal(document.querySelectorAll("[data-service]").length, 1, path);
      assert.deepEqual(marked(), [path]);
      act(() => app?.unmount());
      app = null;
      client?.clear();
    }
  });

  test("from /services, the rail's reconciler link swaps the board without a document load; find keeps its node, focus and text", async () => {
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    const find = document.querySelector<HTMLInputElement>("#find");
    assert.ok(find);
    act(() => find.focus());
    fireEvent.change(find, { target: { value: "sw" } });

    const link = railLink("/reconciler");
    assert.ok(link);
    // fireEvent returns false when a handler cancelled the event: the router
    // took the click, so the browser never loads a document.
    let notCancelled = true;
    act(() => {
      notCancelled = fireEvent.click(link);
    });
    assert.equal(notCancelled, false, "the click was left to the browser");

    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    assert.ok(!row("swee"));
    assert.equal(window.location.pathname, "/reconciler");
    assert.equal(document.title, "Reconciler");
    assert.deepEqual(marked(), ["/reconciler"]);
    assert.equal(document.querySelector("#find"), find, "find was remounted");
    assert.equal(find.value, "sw");
    assert.equal(document.activeElement, find);
  });

  test("a navigation moves focus to the page heading, the group eyebrow", async () => {
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    const link = railLink("/infrastructure");
    assert.ok(link);
    act(() => {
      fireEvent.click(link);
    });
    await waitFor(() => assert.ok(row("caddy")), TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement?.textContent, "Infrastructure"), TIMEOUT);
    assert.equal(document.activeElement?.tagName, "H2");
    assert.equal(document.activeElement?.getAttribute("tabindex"), "-1");
    assert.equal(document.title, "Infrastructure");
    assert.deepEqual(marked(), ["/infrastructure"]);
  });

  test("history.back() returns to /services", async () => {
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    // The router's own entry for /services: its key and index.
    const entry = window.history.state as unknown;
    act(() => {
      fireEvent.click(railLink("/reconciler") as HTMLAnchorElement);
    });
    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    assert.notDeepEqual(window.history.state, entry);

    // happy-dom's history.back() leaves pushState's entries for about:blank
    // and fires no popstate, so it is done as a browser does it: the previous
    // entry's URL and state restored, then popstate.
    act(() => {
      window.history.replaceState(entry, "", "/services");
      window.dispatchEvent(new PopStateEvent("popstate", { state: entry }));
    });
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    assert.equal(window.location.pathname, "/services");
    assert.equal(document.title, "Services");
    assert.deepEqual(marked(), ["/services"]);
  });

  test("find's Enter on a unit in another group navigates in-app and scrolls to its row", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    const find = document.querySelector<HTMLInputElement>("#find") as HTMLInputElement;
    act(() => find.focus());
    fireEvent.change(find, { target: { value: "lychee-watch" } });
    await waitFor(() => assert.ok(document.querySelector('[role="option"]')), TIMEOUT);
    const loads = fetched.length;
    act(() => {
      fireEvent.keyDown(find, { key: "Enter" });
    });
    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    assert.equal(window.location.pathname, "/reconciler");
    assert.equal(window.location.hash, "#service-lychee-watch");
    await waitFor(() => assert.ok(scrolled.includes("service-lychee-watch"), `scrolled: ${scrolled.join(",")}`), TIMEOUT);
    // In-app: only the new group's board was fetched, no document came with it.
    assert.ok(fetched.slice(loads).every((u) => u.startsWith("/api/")));
    assert.equal(document.querySelector("#find"), find);
  });

  test("find's Enter on a row of this page moves focus to that row", async () => {
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    const find = document.querySelector<HTMLInputElement>("#find") as HTMLInputElement;
    act(() => find.focus());
    fireEvent.change(find, { target: { value: "swee" } });
    await waitFor(() => assert.ok(document.querySelector('[role="option"]')), TIMEOUT);
    act(() => {
      fireEvent.keyDown(find, { key: "Enter" });
    });
    await waitFor(() => assert.equal(window.location.hash, "#service-swee"), TIMEOUT);
    // assert.ok, not assert.equal: a failing equal on two DOM nodes renders
    // both happy-dom objects into its message, which takes minutes.
    await waitFor(() => assert.ok(document.activeElement === row("swee"), focused()), TIMEOUT);
    assert.equal(row("swee")?.getAttribute("tabindex"), "-1");
  });

  test("a same-path rail link lands focus on the page heading", async () => {
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    const link = railLink("/services") as HTMLAnchorElement;
    act(() => link.focus());
    assert.equal(document.activeElement, link);
    act(() => {
      fireEvent.click(link);
    });
    await waitFor(() => assert.equal(document.activeElement?.tagName, "H2"), TIMEOUT);
    assert.equal(document.activeElement?.textContent, "Services");
  });

  test("a document loaded with a #service- hash scrolls to its row once the rows are in", async () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    load("/reconciler#service-lychee-watch");
    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    await waitFor(() => assert.deepEqual(scrolled, ["service-lychee-watch"]), TIMEOUT);
  });

  test("on a server page (/sites/broken.lychee.land) the rail's services link is a plain anchor", async () => {
    load("/sites/broken.lychee.land");
    await railLive();
    assert.ok(document.getElementById("server-body"));
    const link = railLink("/services");
    assert.ok(link);
    // Record whether anything before the document cancelled the click, then
    // cancel it so happy-dom does not navigate the test document away.
    let cancelledBeforeUs: boolean | null = null;
    const record = (e: Event) => {
      cancelledBeforeUs = e.defaultPrevented;
      e.preventDefault();
    };
    document.addEventListener("click", record);
    try {
      act(() => {
        fireEvent.click(link);
      });
    } finally {
      document.removeEventListener("click", record);
    }
    assert.equal(cancelledBeforeUs, false, "a router took the click on a server page");
    assert.ok(document.getElementById("server-body"), "the server page's body was replaced");
    assert.equal(window.location.pathname, "/sites/broken.lychee.land");
    assert.deepEqual(marked(), ["/sites/broken.lychee.land"]);
    // Nothing on a server page reads a board.
    assert.ok(!fetched.some((u) => u.startsWith("/api/services")));
  });
});

/** Records every window.scrollTo(…, y) while still scrolling, so scrollY stays real. */
function recordScrolls(): number[] {
  const ys: number[] = [];
  window.scrollTo = ((...args: unknown[]) => {
    const y = typeof args[0] === "object" && args[0] !== null ? (args[0] as ScrollToOptions).top : args[1];
    if (typeof y === "number") ys.push(y);
    (originalScrollTo as (...a: unknown[]) => void).apply(window, args);
  }) as typeof window.scrollTo;
  return ys;
}

describe("scroll restoration", () => {
  // Every entry the router did not push itself has the key "default": a
  // position saved under it belongs to whatever page last unloaded.
  const stale = () => sessionStorage.setItem("react-router-scroll-positions", JSON.stringify({ default: 500 }));

  test("a fresh load of a board page does not restore the shared 'default' position", async () => {
    stale();
    const ys = recordScrolls();
    // A fresh document: no router key, so the router calls this entry "default".
    window.history.replaceState(null, "");
    assert.equal(window.history.state, null);
    load("/services");
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    await act(async () => {});
    assert.ok(!ys.includes(500), `scrolled to ${ys.join(",")}`);
    assert.equal(window.scrollY, 0);
  });

  test("a server page neither restores the shared position nor takes scrolling over from the browser", async () => {
    stale();
    const ys = recordScrolls();
    load("/sites/broken.lychee.land");
    await railLive();
    assert.ok(!ys.includes(500), `scrolled to ${ys.join(",")}`);
    assert.equal(window.scrollY, 0);
    assert.equal(window.history.scrollRestoration, "auto");
  });

  test("back to an entry the router left restores that entry's position", async () => {
    stale();
    load("/services");
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    act(() => window.scrollTo(0, 400));
    const entry = window.history.state as unknown;
    act(() => {
      fireEvent.click(railLink("/reconciler") as HTMLAnchorElement);
    });
    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    await waitFor(() => assert.equal(window.scrollY, 0), TIMEOUT);

    act(() => {
      window.history.replaceState(entry, "", "/services");
      window.dispatchEvent(new PopStateEvent("popstate", { state: entry }));
    });
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    await waitFor(() => assert.equal(window.scrollY, 400), TIMEOUT);
  });
});

describe("the narrow-screen drawer", () => {
  const dialog = () => document.querySelector("dialog");

  async function openOnBoard(opener: "#rail-menu" | "#rail-find"): Promise<void> {
    happyDOM.setViewport({ width: 600 });
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    act(() => {
      fireEvent.click(document.querySelector(opener) as HTMLElement);
    });
    await waitFor(() => assert.ok(dialog()?.open), TIMEOUT);
  }

  test("a rail link in the drawer closes it, and the new page's heading takes focus", async () => {
    await openOnBoard("#rail-menu");
    const link = dialog()?.querySelector<HTMLAnchorElement>('a[href="/reconciler"]');
    assert.ok(link);
    act(() => {
      fireEvent.click(link);
    });
    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    await waitFor(() => assert.ok(!dialog()), TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement?.textContent, "Reconciler"), TIMEOUT);
    assert.equal(document.activeElement?.tagName, "H2");
  });

  test("find's Enter in the drawer closes it, and the new page's heading takes focus", async () => {
    await openOnBoard("#rail-find");
    const find = dialog()?.querySelector<HTMLInputElement>("#find");
    assert.ok(find);
    await waitFor(() => assert.equal(document.activeElement, find), TIMEOUT);
    fireEvent.change(find, { target: { value: "lychee-watch" } });
    await waitFor(() => assert.ok(document.querySelector('[role="option"]')), TIMEOUT);
    act(() => {
      fireEvent.keyDown(find, { key: "Enter" });
    });
    await waitFor(() => assert.ok(row("lychee-watch")), TIMEOUT);
    await waitFor(() => assert.ok(!dialog()), TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement?.textContent, "Reconciler"), TIMEOUT);
    assert.equal(document.activeElement?.tagName, "H2");
  });

  test("find's Enter in the drawer on a row of this page closes it and lands focus on that row", async () => {
    await openOnBoard("#rail-find");
    const find = dialog()?.querySelector<HTMLInputElement>("#find");
    assert.ok(find);
    await waitFor(() => assert.equal(document.activeElement, find), TIMEOUT);
    fireEvent.change(find, { target: { value: "swee" } });
    await waitFor(() => assert.ok(document.querySelector('[role="option"]')), TIMEOUT);
    act(() => {
      fireEvent.keyDown(find, { key: "Enter" });
    });
    await waitFor(() => assert.equal(window.location.hash, "#service-swee"), TIMEOUT);
    assert.equal(window.location.pathname, "/services");
    await waitFor(() => assert.ok(!dialog()), TIMEOUT);
    await waitFor(() => assert.ok(document.activeElement === row("swee"), focused()), TIMEOUT);
    assert.equal(row("swee")?.getAttribute("tabindex"), "-1");
  });

  test("Escape still closes it and returns focus to its opener", async () => {
    await openOnBoard("#rail-menu");
    act(() => {
      fireEvent.keyDown(dialog() as HTMLDialogElement, { key: "Escape" });
    });
    await waitFor(() => assert.ok(!dialog()), TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement, document.querySelector("#rail-menu")), TIMEOUT);
  });
});
