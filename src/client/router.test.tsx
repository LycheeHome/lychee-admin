import "./test/setup";
import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { BoardPayload, BoardRow, ServiceGroup } from "../shared/board";
import type { SiteDetailPayload } from "../shared/siteDetail";
import type { SitesPayload } from "../shared/sites";
import { SEEDED_RAIL_SITES, seedSiteDetailPayload } from "../dev/testHelpers";
import { RAIL_DOT } from "../views/railModel";
import { seedHealth } from "./test/healthFixture";
import { STATIC_TITLE, loadStaticDocument, railPayload } from "./test/staticDocument";
import { BOARD_ROUTES, isClientRoute, mountApp } from "./router";

/*
 * The single root on the static document: a body holding only `#react-root`,
 * into which mountApp renders AppFrame (the top bar, the rail, <main>) around
 * the routed page. React Router moves between the client routes, and a URL
 * no route matches keeps its rail links plain anchors (Review Focus 3).
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
  railGate = null;
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
    prunable: [], retiring: [],
    managed: [],
    requested: {},
    lastRuns: {},
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const SITES: SitesPayload = {
  sites: [
    { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" },
    { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" },
  ],
  statuses: { "api.lychee.land": { kind: "tcp", responding: true } },
  problems: [],
  domain: "lychee.land",
  caddyfileError: null,
};

/** `GET /api/sites/:hostname`'s answers, by hostname; any other host is a 404. */
const details = new Map<string, Extract<SiteDetailPayload, { caddyfileError: null }>>();

before(async () => {
  details.set("app.lychee.land", (await seedSiteDetailPayload("app.lychee.land")).payload);
});

/** Holds `/api/rail` open until `release()`, so a test can look before it answers. */
let railGate: Promise<void> | null = null;

function stubFetch(): void {
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url === "/api/health") return json({ ok: true, ...seedHealth() });
    if (url === "/api/rail") {
      await railGate;
      return json({ ok: true, ...railPayload(SEEDED_RAIL_SITES.map((s) => ({ ...s }))) });
    }
    if (url === "/api/sites") return json({ ok: true, ...SITES });
    if (url.startsWith("/api/sites/")) {
      const host = decodeURIComponent(url.slice("/api/sites/".length).split("?")[0] ?? "");
      const found = details.get(host);
      return found
        ? json({ ok: true, ...found })
        : new Response(JSON.stringify({ ok: false, reason: `No site named ${host}` }), { status: 404 });
    }
    const group = new URLSearchParams(url.split("?")[1] ?? "").get("group") as ServiceGroup;
    return json({ ok: true, ...payload(group) });
  }) as typeof fetch;
}

/**
 * The static document every client route is served, at `path`, then the one
 * root mounted on it. Any notice (`?removed=` on the list, `?created=1` on a
 * site page) is read off the URL by the client, as in a browser.
 */
function load(path: string): void {
  stubFetch();
  happyDOM.setURL(`http://localhost${path}`);
  loadStaticDocument();
  // No `queries.gcTime: 0` here, unlike the frame's own tests: a route
  // loader primes its page's query before the page observes it, and with no
  // observer a zero gcTime collects it in between, so the page reads again
  // and a move back no longer shows the cache. Every test settles its reads
  // before teardown instead.
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  act(() => {
    app = mountApp(client as QueryClient);
  });
  assert.ok(app, "the root did not mount");
}

/**
 * A URL no client route matches. Express never serves the document there,
 * but the router's rule for one (the `*` route renders nothing, rail links
 * stay plain anchors, no scroll restoration) still holds.
 */
const SERVER_PAGE = "/elsewhere";

const row = (name: string) => document.querySelector(`[data-service="${name}"]`);
/** What has focus, briefly, for a failure message. */
const focused = () => `focus is on ${document.activeElement?.outerHTML.slice(0, 80) ?? "nothing"}`;
const railLink = (href: string) => document.querySelector<HTMLAnchorElement>(`#rail a[href="${href}"]`);
const marked = () => Array.from(document.querySelectorAll("#rail a[aria-current=\"page\"]")).map((a) => a.getAttribute("href"));
/** The rail's dots are coloured once its rows are in and health has landed. */
const railLive = () =>
  waitFor(() => assert.equal(document.querySelector('#rail [data-site="api.lychee.land"] [data-dot]')?.getAttribute("class"), RAIL_DOT.bad), TIMEOUT);

describe("isClientRoute", () => {
  test("is true for the sites list, the three board pages and the add page, with or without a hash or query", () => {
    assert.deepEqual(Object.keys(BOARD_ROUTES).sort(), ["/infrastructure", "/reconciler", "/services"]);
    for (const path of ["/", "/?removed=blog.lychee.land", "/#x", "/services", "/reconciler", "/infrastructure", "/reconciler#service-lychee-watch", "/services?x=1", "/sites/new", "/sites/new#x"]) {
      assert.equal(isClientRoute(path), true, path);
    }
    // "/" matches exactly, never as a prefix of every path.
    for (const path of ["", "//", SERVER_PAGE, "/sites/new/x", "/sites/x/y", "/services/swee/deploy", "/servicesx", "https://example.com/services", "https://example.com/"]) {
      assert.equal(isClientRoute(path), false, path);
    }
  });
});

describe("the sites list route", () => {
  const listRow = (hostname: string) => document.querySelector(`main a[href="/sites/${hostname}"]`);
  const NOTICE = "Removed a&b.lychee.land. Remember to remove the DNS record in Cloudflare manually.";

  /** Clicks `link` and says whether anything (the router) cancelled it; cancels it after, so happy-dom stays put. */
  function clickCancelled(link: Element): boolean {
    let cancelled: boolean | null = null;
    const record = (e: Event) => {
      cancelled = e.defaultPrevented;
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
    return cancelled === true;
  }

  test("a direct visit renders the list into <main>, titled Sites, with the sites heading current", async () => {
    load("/");
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    assert.ok(!document.getElementById("app-root"), "a server mount point is back");
    assert.equal(document.title, "Sites");
    assert.deepEqual(marked(), ["/"]);
    assert.ok(fetched.includes("/api/sites"));
  });

  test("/ to /services and back makes no document load, and the list shows at once from cache (Review Focus 5)", async () => {
    load("/");
    await railLive();
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    const entry = window.history.state as unknown;

    assert.equal(clickCancelled(railLink("/services") as HTMLAnchorElement), true, "the click was left to the browser");
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    assert.ok(!listRow("api.lychee.land"));
    assert.equal(document.title, "Services");
    assert.deepEqual(marked(), ["/services"]);

    const reads = fetched.filter((u) => u === "/api/sites").length;
    await act(async () => {
      window.history.replaceState(entry, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate", { state: entry }));
    });
    // From cache: in the same turn, with no new read of the list behind it.
    assert.ok(listRow("api.lychee.land"), "the list was not shown at once");
    assert.equal(fetched.filter((u) => u === "/api/sites").length, reads);
    assert.equal(window.location.pathname, "/");
    assert.equal(document.title, "Sites");
    assert.deepEqual(marked(), ["/"]);
  });

  test("the rail's sites heading from /services is a router link, and focus lands on the Sites heading", async () => {
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    assert.equal(clickCancelled(railLink("/") as HTMLAnchorElement), true, "the click was left to the browser");
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement?.textContent, "Sites"), TIMEOUT);
    assert.equal(document.activeElement?.tagName, "H2");
    assert.equal(document.activeElement?.getAttribute("tabindex"), "-1");
    assert.equal(document.title, "Sites");
    assert.deepEqual(marked(), ["/"]);
  });

  // Critique 2026-10-26: a document load of a board page took focus and drew
  // the browser's default ring on its eyebrow. A page load is the browser's to
  // announce; only an in-app navigation moves focus, as on the list.
  test("a direct visit to a board page takes no focus", async () => {
    load("/services");
    await waitFor(() => assert.ok(document.querySelector("[data-service]")), TIMEOUT);
    await act(async () => {});
    assert.ok(document.activeElement === document.body, focused());
  });

  test("a direct visit takes no focus, so the list at rest is the server's markup", async () => {
    load("/");
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    await act(async () => {});
    assert.ok(document.activeElement === document.body, focused());
    assert.ok(!document.querySelector("main h2")?.hasAttribute("tabindex"));
  });

  // A site row and Add site are router links now: SiteDetailRoutes.test.tsx
  // and AddSiteRoutes.test.tsx follow them.

  test("on load, ?removed leaves the URL; other parameters and the hash stay (Review Focus 3)", async () => {
    load("/?removed=a%26b.lychee.land&x=1#h");
    assert.equal(window.location.search, "?x=1");
    assert.equal(window.location.hash, "#h");
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    // Read off the URL before it was stripped, and kept on the page it was asked for.
    assert.equal(document.getElementById("page-notice-message")?.textContent, NOTICE);
  });

  test("?removed alone leaves a bare path", async () => {
    load("/?removed=blog.lychee.land");
    assert.equal(window.location.href, "http://localhost/");
    // Settled before teardown: unmounting mid-load leaves a timer behind.
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
  });

  test("the first client navigation away removes #page-notice, and returning to / does not bring it back", async () => {
    load("/?removed=a%26b.lychee.land");
    await railLive();
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    assert.ok(document.getElementById("page-notice"));

    act(() => {
      fireEvent.click(railLink("/services") as HTMLAnchorElement);
    });
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    assert.ok(!document.getElementById("page-notice"));

    act(() => {
      fireEvent.click(railLink("/") as HTMLAnchorElement);
    });
    await waitFor(() => assert.ok(listRow("api.lychee.land")), TIMEOUT);
    assert.ok(!document.getElementById("page-notice"));
  });

});

describe("the single root", () => {
  test("renders the whole body into #react-root: one top bar, one rail, one #find, one <main>", async () => {
    load("/services");
    await railLive();
    const root = document.getElementById("react-root");
    assert.ok(root);
    assert.equal(root.getAttribute("class"), "contents");
    // The frame's parts are the root's own children, so with `contents` they
    // are the body grid's items, as the server shell's were.
    assert.deepEqual(
      Array.from(root.children).map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`),
      ["a", "header#top-bar", "aside#rail", "div"],
    );
    assert.equal(root.children[0]?.textContent, "Skip to content");
    assert.ok(root.children[3]?.firstElementChild?.tagName === "MAIN");
    assert.equal(document.querySelectorAll("#find").length, 1);
    assert.equal(document.querySelectorAll("#rail nav[aria-label=\"Host\"]").length, 1);
    assert.equal(document.querySelectorAll("#top-bar h1").length, 1);
    assert.equal(document.querySelectorAll("main").length, 1);
    assert.equal(document.querySelectorAll("#flash-banner").length, 1);
    assert.equal(document.querySelectorAll("#copy-status").length, 1);
    assert.ok(await waitFor(() => row("swee") ?? assert.fail("no board"), TIMEOUT));
  });

  // Moved from the retired RailIsland.test.tsx.
  test("mounts nothing without the root's mount point", () => {
    document.body.innerHTML = '<aside id="rail" data-rail></aside>';
    client = new QueryClient();
    assert.ok(!mountApp(client));
    assert.equal(document.body.innerHTML, '<aside id="rail" data-rail=""></aside>');
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
    assert.ok(document.querySelector("#find") === find, "find was replaced");
    // Focus lands on the row the move named, as it does on the same page,
    // not on the new page's heading (critique 2026-10-27).
    await waitFor(() => assert.ok(document.activeElement === row("lychee-watch"), `focus on ${document.activeElement?.id || document.activeElement?.tagName}`), TIMEOUT);
    assert.equal(find.value, "");
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
    // Review 2026-10-27: focusable only while the move holds it, so a later
    // click inside the row neither focuses it nor draws its ring.
    act(() => find.focus());
    assert.equal(row("swee")?.hasAttribute("tabindex"), false);
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

  test("at a URL no route matches the rail's services link is a plain anchor", async () => {
    load(SERVER_PAGE);
    await railLive();
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
    assert.equal(cancelledBeforeUs, false, "a router took the click off the client routes");
    assert.equal(window.location.pathname, SERVER_PAGE);
    assert.deepEqual(marked(), []);
    // Nothing there reads a board.
    assert.ok(!fetched.some((u) => u.startsWith("/api/services")));
  });
});

describe("RF2: a document load on the static document", () => {
  test("at /sites/app.lychee.land the title is the hostname, and once /api/rail answers its row is current", async () => {
    let release: () => void = () => {};
    railGate = new Promise<void>((resolve) => (release = resolve));
    load("/sites/app.lychee.land");
    assert.equal(document.title, STATIC_TITLE);
    await waitFor(() => assert.equal(document.getElementById("site-hostname")?.textContent, "app.lychee.land"), TIMEOUT);
    assert.equal(document.title, "app.lychee.land");
    // Before /api/rail answers there is no row to mark.
    assert.ok(!document.querySelector('#rail [data-site="app.lychee.land"]'));
    release();
    await waitFor(
      () => assert.equal(document.querySelector('#rail a[data-site="app.lychee.land"]')?.getAttribute("aria-current"), "page"),
      TIMEOUT,
    );
    assert.deepEqual(marked(), ["/sites/app.lychee.land"]);
  });

  test("at an unknown host the title is Site not found and the not-found body shows", async () => {
    load("/sites/nope.lychee.land");
    await waitFor(() => assert.equal(document.querySelector("main h2")?.textContent, "Site not found"), TIMEOUT);
    assert.equal(document.title, "Site not found");
    assert.match(document.querySelector("main")?.textContent ?? "", /Back to sites/);
    await waitFor(() => assert.ok(document.querySelector('#rail [data-site="app.lychee.land"]')), TIMEOUT);
    assert.deepEqual(marked(), []);
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

  test("a URL no route matches neither restores the shared position nor takes scrolling over from the browser", async () => {
    stale();
    const ys = recordScrolls();
    load(SERVER_PAGE);
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

  // The move names a row, so focus lands on it on the new page too, as it
  // does on the same page (critique 2026-10-27); it used to be the heading.
  test("find's Enter in the drawer closes it, and the named row on the new page takes focus", async () => {
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
    await waitFor(() => assert.ok(document.activeElement === row("lychee-watch"), focused()), TIMEOUT);
    assert.equal(window.location.pathname, "/reconciler");
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

  test("⌘K from the page focuses #find on a wide screen, and opens the drawer on a narrow one", async () => {
    const pressK = (target: Element) =>
      act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true }));
      });
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    pressK(document.body);
    assert.ok(document.activeElement === document.querySelector("#rail #find"), focused());
    assert.ok(!dialog());
    act(() => app?.unmount());
    app = null;
    client?.clear();

    happyDOM.setViewport({ width: 600 });
    load("/services");
    await railLive();
    await waitFor(() => assert.ok(row("swee")), TIMEOUT);
    pressK(document.body);
    await waitFor(() => assert.ok(dialog()?.open), TIMEOUT);
    await waitFor(() => assert.ok(document.activeElement === dialog()?.querySelector("#find"), focused()), TIMEOUT);
    assert.equal(document.querySelectorAll("#find").length, 1);
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
