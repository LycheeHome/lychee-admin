import "./test/setup";
import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, type DataRouter, type RouteObject } from "react-router";
import type { BoardPayload, ServiceGroup } from "../shared/board";
import type { RailPayload } from "../shared/rail";
import type { SiteDetailPayload } from "../shared/siteDetail";
import type { SitesPayload } from "../shared/sites";
import { SEEDED_RAIL_SITES, seedSiteDetailPayload } from "../dev/testHelpers";
import { GROUP_LABELS } from "../views/boardRowModel";
import { RAIL_SIGNAL_DOT } from "../views/overviewModel";
import { addedNotice } from "../views/siteDetailModel";
import { RAIL_QUERY_KEY } from "./api";
import { readInitialNotice, type InitialNotice } from "./AppFrame";
import { BOARD_ROUTES, OVERVIEW_ROUTE, SITES_ROUTE } from "./clientNav";
import { HEALTH_QUERY } from "./health";
import { AddSitePage } from "./pages/AddSitePage";
import { BoardPage } from "./pages/BoardPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SiteDetailRoute } from "./pages/SiteDetailPage";
import { SitesPage } from "./pages/SitesPage";
import { stripNoticeParams } from "./router";
import { installSharedBindings } from "./sharedBindings";
import { seedHealth } from "./test/healthFixture";
import { FrameLayout } from "./test/frameHarness";
import { displayedAt } from "./test/visibility";
import { hideToast, showToast } from "./toast";

/*
 * AppFrame's behaviour: the rail before and after /api/rail answers, health
 * failing, the review's RF1, RF3 and RF4, the page notices, the rail's re-read
 * after a write, and every page's title on a document load. The frame is
 * mounted as the router's layout will mount it (test/frameHarness.tsx), with
 * the real pages beneath it and fetch answering from the dev seed.
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;

type HappyDOM = { setURL(url: string): void; setViewport(v: { width: number }): void };
const happyDOM = (globalThis as unknown as { happyDOM: HappyDOM }).happyDOM;

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;
const details = new Map<string, Detail>();

before(async () => {
  for (const host of ["app.lychee.land", "blog.lychee.land", "preview.lychee.land", "gone.lychee.land"]) {
    details.set(host, (await seedSiteDetailPayload(host)).payload);
  }
});

let client: QueryClient | null = null;
let router: DataRouter | null = null;
let uninstallBindings: (() => void) | null = null;

afterEach(() => {
  cleanup();
  router?.dispose();
  router = null;
  client?.clear();
  client = null;
  uninstallBindings?.();
  uninstallBindings = null;
  hideToast();
  globalThis.fetch = originalFetch;
  happyDOM.setViewport({ width: 1024 });
  happyDOM.setURL("http://localhost/");
  document.title = "";
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SEED_RAIL: RailPayload = { sites: SEEDED_RAIL_SITES.map((s) => ({ ...s })), hostAvailable: true, domain: "lychee.land" };

const SITES: SitesPayload = { sites: [], statuses: {}, problems: [], domain: "lychee.land", caddyfileError: null };

function board(group: ServiceGroup): BoardPayload {
  return {
    board: { inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: "2026-10-22T11:58:00Z", groups: [{ group, rows: [] }] },
    boardEmpty: false,
    now: "2026-10-22T12:00:00Z",
    domain: "lychee.land",
    prunable: [], retiring: [],
    managed: [],
    requested: {},
    lastRuns: {},
  };
}

interface Stub {
  /** Every URL fetched, in order. */
  fetched: string[];
  rail: () => Promise<Response>;
  health: () => Promise<Response>;
  /** A site page's read; the default answers from the seed. */
  site: (host: string) => Promise<Response>;
}

let stub: Stub;

function stubFetch(): Stub {
  const s: Stub = {
    fetched: [],
    rail: async () => json(200, { ok: true, ...SEED_RAIL }),
    health: async () => json(200, { ok: true, ...seedHealth() }),
    site: async (host) => {
      const payload = details.get(host);
      return payload ? json(200, { ok: true, ...payload }) : json(404, { ok: false, reason: `No site named ${host}` });
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    s.fetched.push(init?.method === "POST" ? `POST ${url}` : url);
    if (init?.method === "POST") return json(200, { ok: true });
    if (url === "/api/rail") return s.rail();
    if (url === "/api/health") return s.health();
    if (url === "/api/sites") return json(200, { ok: true, ...SITES });
    if (url.startsWith("/api/activity")) return json(200, { ok: true, events: [], sources: { app: true, reconciler: true }, now: "2026-10-22T12:00:00Z" });
    if (url.startsWith("/api/sites/new")) return json(500, { ok: false, reason: "not in this test" });
    if (url.startsWith("/api/sites/")) return s.site(decodeURIComponent(url.slice("/api/sites/".length).split("?")[0] ?? ""));
    const group = new URLSearchParams(url.split("?")[1] ?? "").get("group") as ServiceGroup;
    return json(200, { ok: true, ...board(group) });
  }) as typeof fetch;
  return s;
}

/** A promise and the function that settles it. */
function gate<T>(): { promise: Promise<T>; open: (value: T) => void } {
  let open!: (value: T) => void;
  const promise = new Promise<T>((r) => (open = r));
  return { promise, open };
}

function routes(notice: InitialNotice): RouteObject[] {
  return [
    {
      element: <FrameLayout notice={notice} />,
      children: [
        { path: OVERVIEW_ROUTE, element: <OverviewPage /> },
        { path: SITES_ROUTE, element: <SitesPage /> },
        ...Object.entries(BOARD_ROUTES).map(([path, group]) => ({ path, element: <BoardPage key={group} group={group} /> })),
        { path: "/sites/new", element: <AddSitePage /> },
        { path: "/sites/:hostname", element: <SiteDetailRoute /> },
      ],
    },
  ];
}

/**
 * The frame at `url`, as a document load: the notice read off the window,
 * the notice parameters stripped, then the router started on the clean URL.
 * The stub is installed beforehand by the caller (stubFetch) when it needs
 * to shape an answer before the first read.
 */
function mount(url: string, s: Stub = stubFetch()): void {
  stub = s;
  happyDOM.setURL(`http://localhost${url}`);
  const notice = readInitialNotice(window);
  stripNoticeParams(window);
  // Queries' gcTime 0 too: a read some tests leave gated is cancelled by
  // clear(), and its settling would otherwise schedule a 5-minute gc timer
  // that holds the runner open.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  router = createMemoryRouter(routes(notice), { initialEntries: [`${window.location.pathname}${window.location.search}`] });
  uninstallBindings = installSharedBindings(document);
  act(() => {
    render(
      <QueryClientProvider client={client as QueryClient}>
        <RouterProvider router={router as DataRouter} />
      </QueryClientProvider>,
    );
  });
}

const rail = () => document.getElementById("rail");
const rows = () => Array.from(document.querySelectorAll("#rail [data-site]")).map((a) => a.getAttribute("data-site"));
/** The rail's overview row, and its one signal: the dot's class, the visible count, and what a screen reader hears. */
const overviewRow = () => document.querySelector('#rail nav[aria-label="Overview"] > a');
const signalDot = () => overviewRow()?.querySelector("[data-signal] > span")?.getAttribute("class") ?? "";
const signalText = () => overviewRow()?.querySelector("[data-signal]")?.textContent ?? null;
function overviewName(): string | null {
  const row = overviewRow();
  if (!row) return null;
  const copy = row.cloneNode(true) as Element;
  for (const hidden of Array.from(copy.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
  return copy.textContent;
}
const count = (url: string) => stub.fetched.filter((u) => u === url).length;
const noticeText = () => document.getElementById("page-notice-message")?.textContent;

/** The rail's fixed parts: wordmark, find, the sites heading and the host links. */
function assertFixedParts(within: Element | null): void {
  assert.ok(within, "no rail");
  assert.ok(within.querySelector('a[aria-label="lychee-admin"]'), "no wordmark");
  assert.ok(within.querySelector("#find"), "no find box");
  assert.ok(Array.from(within.querySelectorAll('nav[aria-label="Sites"] a')).some((a) => a.textContent?.startsWith("sites")), "no sites heading");
  for (const href of ["/services", "/reconciler", "/infrastructure"]) assert.ok(within.querySelector(`a[href="${href}"]`), `no ${href} link`);
}

/** No site rows and no error line of any kind. */
function assertNoRowsNoError(within: Element | null): void {
  assert.ok(within);
  assert.ok(!within.querySelector("[data-site]"), "site rows before /api/rail answered");
  assert.ok(!(within.textContent ?? "").includes("health unavailable"), "a health error signal");
  assert.ok(!(within.textContent ?? "").includes("Can't read the Caddyfile"), "a Caddyfile error line");
  assert.ok(!(within.textContent ?? "").includes("Inventory unavailable"), "an inventory error line");
}

// Critique 2026-10-26: thirteen rail stops came before any content. A skip
// link, the first thing Tab reaches, goes straight to <main>; hidden until it
// is focused, and out of the body grid's flow so it takes no cell.
describe("the skip link", () => {
  test("is the first focusable element and points at <main>, which can take it", async () => {
    mount("/services");
    await waitFor(() => assert.ok(document.querySelector("main")), TIMEOUT);
    const first = document.querySelector<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    assert.equal(first?.textContent, "Skip to content");
    assert.equal(first?.getAttribute("href"), "#main");
    assert.match(first?.getAttribute("class") ?? "", /\bsr-only\b/);
    assert.match(first?.getAttribute("class") ?? "", /\bfocus:not-sr-only\b/);
    assert.match(first?.getAttribute("class") ?? "", /\bfocus:fixed\b/);
    const main = document.querySelector("main");
    assert.equal(main?.id, "main");
    assert.equal(main?.getAttribute("tabindex"), "-1");
  });
});

describe("the rail's data", () => {
  test("before /api/rail answers: the fixed parts, no rows and no error line; after it, the rows", async () => {
    const s = stubFetch();
    const answer = gate<Response>();
    s.rail = () => answer.promise;
    mount("/sites", s);
    await waitFor(() => assert.ok(count("/api/rail") === 1), TIMEOUT);
    assertFixedParts(rail());
    assertNoRowsNoError(rail());
    await act(async () => answer.open(json(200, { ok: true, ...SEED_RAIL })));
    await waitFor(() => assert.deepEqual(rows(), SEED_RAIL.sites!.map((x) => x.hostname)), TIMEOUT);
  });

  test("is read once per document load, not on every move", async () => {
    mount("/sites");
    await waitFor(() => assert.ok(rows().length > 0), TIMEOUT);
    await act(async () => void (await router!.navigate("/services")));
    await act(async () => void (await router!.navigate("/sites/app.lychee.land")));
    await waitFor(() => assert.equal(document.title, "app.lychee.land"), TIMEOUT);
    assert.equal(count("/api/rail"), 1);
  });

  test("health failing: the rows stay listed, and overview's signal says health is unavailable", async () => {
    const s = stubFetch();
    s.health = async () => json(500, { ok: false, reason: "boom" });
    mount("/sites", s);
    await waitFor(() => assert.equal(overviewName(), "overview, health unavailable"), TIMEOUT);
    assert.deepEqual(rows(), SEED_RAIL.sites!.map((x) => x.hostname));
    assert.equal(signalDot(), RAIL_SIGNAL_DOT.neutral);
    assert.ok(!rail()?.querySelector("[data-dot]"), "a site row carries a dot");
  });

  test("RF1: a failed /api/rail raises nothing and keeps the fixed parts; the next good read fills the rows", async () => {
    const s = stubFetch();
    let failing = true;
    s.rail = async () => (failing ? json(500, { ok: false, reason: "boom" }) : json(200, { ok: true, ...SEED_RAIL }));
    mount("/sites", s);
    await waitFor(() => assert.ok(client!.getQueryState(RAIL_QUERY_KEY)?.status === "error"), TIMEOUT);
    // Health answers too, so overview's signal is in by now.
    await waitFor(() => assert.ok(count("/api/health") >= 1), TIMEOUT);
    await act(async () => {});
    assertFixedParts(rail());
    assertNoRowsNoError(rail());
    failing = false;
    // A focus refetch: a query that never got data is stale, so focus reads it again.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => assert.deepEqual(rows(), SEED_RAIL.sites!.map((x) => x.hostname)), TIMEOUT);
    focusManager.setFocused(undefined);
  });

  test("RF3: the narrow drawer opened before /api/rail answers stays open and gains the rows", async () => {
    happyDOM.setViewport({ width: 600 });
    const s = stubFetch();
    const answer = gate<Response>();
    s.rail = () => answer.promise;
    mount("/sites", s);
    const menu = document.getElementById("rail-menu");
    assert.ok(menu, "no menu button");
    act(() => {
      fireEvent.click(menu);
    });
    const dialog = () => document.querySelector<HTMLDialogElement>("dialog");
    await waitFor(() => assert.ok(dialog()?.open), TIMEOUT);
    assertFixedParts(dialog());
    assertNoRowsNoError(dialog());
    await act(async () => answer.open(json(200, { ok: true, ...SEED_RAIL })));
    await waitFor(() => assert.ok(dialog()?.querySelector('[data-site="app.lychee.land"]')), TIMEOUT);
    assert.ok(dialog()?.open, "the drawer closed when the rows arrived");
    assert.equal(document.querySelectorAll("#find").length, 1);
  });

  test("RF4: a toast survives a frame re-render (a rail re-read and a health poll)", async () => {
    const s = stubFetch();
    mount("/sites", s);
    await waitFor(() => assert.ok(rows().length > 0), TIMEOUT);
    showToast("x", "error");
    const banner = document.getElementById("flash-banner");
    assert.ok(banner);
    const before = banner.className;
    const healthReads = count("/api/health");
    s.rail = async () => json(200, { ok: true, ...SEED_RAIL, sites: [...SEED_RAIL.sites!, { hostname: "new.lychee.land", hint: "static" }] });
    await act(async () => {
      await client!.invalidateQueries({ queryKey: RAIL_QUERY_KEY });
      await client!.invalidateQueries({ queryKey: HEALTH_QUERY.queryKey });
    });
    // The frame re-rendered: the new row is in, and health was read again.
    await waitFor(() => assert.ok(rows().includes("new.lychee.land")), TIMEOUT);
    assert.ok(count("/api/health") > healthReads, "health was not polled again");
    const after = document.getElementById("flash-banner");
    assert.ok(after === banner, "the toast host was replaced");
    assert.equal(after.className, before);
    assert.ok(!after.classList.contains("hidden"), "the toast was hidden");
    assert.ok(after.classList.contains("bg-red-950/60") && after.classList.contains("border-red-400/70"), "the error tone was lost");
    assert.equal(document.getElementById("flash-banner-message")?.textContent, "x");
    assert.ok(!document.getElementById("flash-banner-close")?.classList.contains("hidden"), "the close button was hidden");
  });
});

// Moved from the retired RailIsland.test.tsx, which held them against the
// server rail with the island portalled over it; here they hold AppFrame,
// which reads the same poll through useRailHealth.
describe("the rail's health", () => {
  const unavailable = () => overviewName() === "overview, health unavailable";
  const failing = async () => json(500, { ok: false, reason: "boom" });
  const good = async () => json(200, { ok: true, ...seedHealth() });
  const refetchHealth = () =>
    act(async () => {
      await client!.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    });

  test("the poll fills in overview's signal, on the rail and the menu button, and nothing else", async () => {
    mount("/sites");
    await waitFor(() => assert.equal(signalText(), "5"), TIMEOUT);
    assert.equal(signalDot(), RAIL_SIGNAL_DOT.bad);
    assert.equal(overviewName(), "overview, 5 need attention");
    assert.equal(document.querySelectorAll("#rail [data-site]").length, 8);
    assert.ok(!document.querySelector("#rail [data-dot], #rail [data-count], #top-bar [data-count]"), "a per-item mark");
    await waitFor(() => assert.equal(document.querySelector("#top-bar #rail-menu [data-signal]")?.textContent, "● 5"), TIMEOUT);
  });

  test("a failed poll after a good one never shows the remembered count", async () => {
    const s = stubFetch();
    mount("/sites", s);
    await waitFor(() => assert.equal(signalText(), "5"), TIMEOUT);
    s.health = failing;
    await refetchHealth();
    await waitFor(() => assert.ok(unavailable()), TIMEOUT);
    assert.equal(signalDot(), RAIL_SIGNAL_DOT.neutral);
    assert.equal(signalText(), "");
  });

  test("a failed first poll stays unavailable while the next poll is in flight", async () => {
    const s = stubFetch();
    s.health = failing;
    mount("/sites", s);
    await waitFor(() => assert.ok(unavailable()), TIMEOUT);
    await waitFor(() => assert.ok(rows().length > 0), TIMEOUT);
    // The next poll is held open. TanStack resets a data-less errored query
    // to pending while it refetches; the rail must still say unavailable.
    const held = gate<Response>();
    s.health = () => held.promise;
    const refetch = client!.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    try {
      await waitFor(() => assert.equal(client!.getQueryState(HEALTH_QUERY.queryKey)?.fetchStatus, "fetching"), TIMEOUT);
      assert.ok(unavailable(), "the signal stopped saying unavailable");
      assert.equal(signalDot(), RAIL_SIGNAL_DOT.neutral);
    } finally {
      // Settle the held poll so nothing is left in flight.
      held.open(json(500, { ok: false, reason: "boom" }));
      await act(async () => {
        await refetch;
      });
    }
  });

  test("an errored poll between two good ones clears: the signal shows its tone again", async () => {
    const s = stubFetch();
    mount("/sites", s);
    await waitFor(() => assert.equal(signalDot(), RAIL_SIGNAL_DOT.bad), TIMEOUT);
    s.health = failing;
    await refetchHealth();
    await waitFor(() => assert.equal(signalDot(), RAIL_SIGNAL_DOT.neutral), TIMEOUT);
    assert.ok(unavailable(), "the error state did not show");
    s.health = good;
    await refetchHealth();
    await waitFor(() => assert.equal(signalDot(), RAIL_SIGNAL_DOT.bad), TIMEOUT);
    assert.ok(!unavailable(), "the error state stayed");
    assert.equal(signalText(), "5");
  });

  for (const [platform, hint] of [
    ["Win32", "Ctrl K"],
    ["MacIntel", "⌘K"],
  ] as const) {
    test(`prints ${hint} on ${platform}`, async () => {
      Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
      try {
        mount("/sites");
        await waitFor(() => assert.equal(signalDot(), RAIL_SIGNAL_DOT.bad), TIMEOUT);
        assert.equal(document.querySelector("#rail [data-find-hint]")?.textContent, hint);
      } finally {
        delete (navigator as unknown as Record<string, unknown>).platform;
      }
    });
  }
});

// Moved from the retired RailIsland.test.tsx ("each width displays exactly
// one wordmark h1"), and from src/views/shell.test.ts's "the shell's h1",
// which counted the two h1s in the server shell's markup. Now the whole page is
// React's, so it holds every page type, body included.
describe("the page's h1", () => {
  const visibleH1s = (width: number) => Array.from(document.querySelectorAll("h1")).filter((h) => displayedAt(h, width));

  for (const url of ["/", "/sites", "/services", "/sites/app.lychee.land", "/sites/nope.lychee.land", "/sites/new"]) {
    test(`${url}: each width displays exactly one, the wordmark`, async () => {
      mount(url);
      await waitFor(() => assert.ok(rows().length > 0), TIMEOUT);
      // The page has rendered into <main>, past the toast host and the copy-status region.
      await waitFor(() => assert.ok((document.querySelector("main")?.children.length ?? 0) > 2), TIMEOUT);
      for (const width of [390, 899, 900, 1280]) {
        const shown = visibleH1s(width);
        assert.equal(shown.length, 1, `${width}px: ${shown.length} h1s displayed`);
        assert.equal(shown[0]?.querySelector('a[href="/"]')?.getAttribute("aria-label"), "lychee-admin", `${width}px`);
      }
      assert.ok(displayedAt(document.querySelector("#top-bar h1") as Element, 390));
      assert.ok(displayedAt(document.querySelector("#rail h1") as Element, 1280));
      assert.equal(document.querySelectorAll("h1").length, 2, "the page has an h1 of its own");
    });
  }
});

describe("readInitialNotice", () => {
  const at = (url: string) => {
    happyDOM.setURL(`http://localhost${url}`);
    return readInitialNotice(window);
  };

  test("removed on the list, created=1 on a site's page, and nothing else", () => {
    assert.deepEqual(at("/sites?removed=x.lychee.land"), { kind: "removed", host: "x.lychee.land" });
    assert.deepEqual(at("/sites/app.lychee.land?created=1"), { kind: "created" });
    assert.deepEqual(at("/sites/app.lychee.land?x=1&created=1#hop"), { kind: "created" });
    for (const url of [
      "/",
      "/?removed=x.lychee.land",
      "/sites",
      "/sites?removed=",
      "/sites?removed=a&removed=b",
      "/services?removed=x.lychee.land",
      "/sites/app.lychee.land?removed=x.lychee.land",
      "/sites/app.lychee.land?created=0",
      "/sites/app.lychee.land?created=1&created=1",
      "/sites/new?created=1",
      "/?created=1",
    ]) {
      assert.equal(at(url), null, url);
    }
  });
});

describe("the page notice", () => {
  const REMOVED = "Removed x.lychee.land. Remember to remove the DNS record in Cloudflare manually.";

  test("?removed= on /sites shows the notice", async () => {
    mount("/sites?removed=x.lychee.land");
    assert.equal(noticeText(), REMOVED);
    await waitFor(() => assert.equal(document.querySelector("main h2")?.textContent, "Sites"), TIMEOUT);
  });

  test("?removed= on / shows none", async () => {
    mount("/?removed=x.lychee.land");
    await waitFor(() => assert.equal(document.querySelector("main h2")?.textContent, "Overview"), TIMEOUT);
    assert.ok(!document.getElementById("page-notice"), "a removed notice on the overview");
  });

  test("?removed renders the removed notice, and the URL loses the parameter", async () => {
    mount("/sites?removed=x.lychee.land");
    assert.equal(noticeText(), REMOVED);
    assert.equal(window.location.search, "");
    const notice = document.getElementById("page-notice");
    assert.ok(notice);
    // Above the page, inside <main>, after the copy-status region.
    assert.ok(notice.parentElement?.tagName === "MAIN");
    assert.ok(notice.previousElementSibling?.id === "copy-status");
    // The frame's width, as every page's content is (critique 2026-10-26).
    assert.ok(notice.classList.contains("max-w-[1080px]"), notice.className);
    assert.ok(!notice.classList.contains("max-w-[760px]"), notice.className);
  });

  test("?created=1 renders addedNotice(site) once the site's payload is in", async () => {
    const s = stubFetch();
    const answer = gate<void>();
    const base = s.site;
    s.site = async (host) => {
      await answer.promise;
      return base(host);
    };
    mount("/sites/app.lychee.land?created=1", s);
    await waitFor(() => assert.ok(count("/api/sites/app.lychee.land") === 1), TIMEOUT);
    assert.ok(!document.getElementById("page-notice"), "a notice before the payload");
    await act(async () => answer.open());
    const site = details.get("app.lychee.land")!.site;
    await waitFor(() => assert.equal(noticeText(), addedNotice(site)), TIMEOUT);
    assert.equal(document.querySelectorAll("#page-notice").length, 1);
  });

  test("?created=1 on a site re-added over a retired declaration explains retired, not not deployed", async () => {
    mount("/sites/gone.lychee.land?created=1", stubFetch());
    await waitFor(() => assert.match(noticeText() ?? "", /shows as retired until its old declaration is pruned/), TIMEOUT);
    assert.doesNotMatch(noticeText() ?? "", /not deployed/);
  });

  // Express drew no notice for a site it could not find or a Caddyfile it
  // could not read; the frame must not either, once the page's read says so.
  test("?created=1 on an unknown site renders no notice", async () => {
    mount("/sites/nope.lychee.land?created=1");
    await waitFor(() => assert.equal(document.querySelector("main h2")?.textContent, "Site not found"), TIMEOUT);
    await act(async () => {});
    assert.ok(!document.getElementById("page-notice"), "a notice for a site that does not exist");
  });

  test("?created=1 with an unreadable Caddyfile renders no notice", async () => {
    const s = stubFetch();
    s.site = async () => json(200, { ok: true, caddyfileError: "cannot read\ndenied", domain: "lychee.land" });
    mount("/sites/app.lychee.land?created=1", s);
    await waitFor(() => assert.match(document.querySelector("main")?.textContent ?? "", /cannot read/), TIMEOUT);
    await act(async () => {});
    assert.ok(!document.getElementById("page-notice"), "a notice beside the Caddyfile error");
  });

  test("its close removes it", async () => {
    mount("/sites?removed=x.lychee.land");
    const close = document.getElementById("page-notice-close");
    assert.ok(close);
    act(() => {
      fireEvent.click(close);
    });
    assert.ok(!document.getElementById("page-notice"));
  });

  test("the first in-app move away removes it, and coming back does not bring it back", async () => {
    mount("/sites?removed=x.lychee.land");
    assert.equal(noticeText(), REMOVED);
    await act(async () => void (await router!.navigate("/sites#top")));
    assert.equal(noticeText(), REMOVED, "a move that stays on the page removed it");
    await act(async () => void (await router!.navigate("/services")));
    assert.ok(!document.getElementById("page-notice"), "still there after moving away");
    await act(async () => void (await router!.navigate("/sites")));
    assert.ok(!document.getElementById("page-notice"), "back after returning");
  });
});

describe("writes", () => {
  test("after a successful in-app write (Attach), /api/rail is read again", async () => {
    const preview = details.get("preview.lychee.land")!;
    details.set("preview.lychee.land", { ...preview, resource: undefined, detached: false });
    try {
      mount("/sites/preview.lychee.land");
      const form = await waitFor(() => {
        const f = document.querySelector<HTMLFormElement>("form[data-attach]");
        assert.ok(f);
        return f;
      }, TIMEOUT);
      await waitFor(() => assert.equal(count("/api/rail"), 1), TIMEOUT);
      details.set("preview.lychee.land", preview);
      fireEvent.change(document.getElementById("attach-repo")!, { target: { value: "preview-site" } });
      fireEvent.submit(form);
      await waitFor(() => assert.ok(stub.fetched.includes("POST /sites/preview.lychee.land/attach")), TIMEOUT);
      await waitFor(() => assert.equal(count("/api/rail"), 2), TIMEOUT);
    } finally {
      details.set("preview.lychee.land", preview);
    }
  });
});

describe("titles on a document load", () => {
  const CASES: Array<[string, string]> = [
    ["/", "overview · lychee admin"],
    ["/sites", "Sites"],
    ["/services", GROUP_LABELS.service],
    ["/reconciler", GROUP_LABELS.reconciler],
    ["/infrastructure", GROUP_LABELS.infrastructure],
    ["/sites/app.lychee.land", "app.lychee.land"],
    ["/sites/nope.lychee.land", "Site not found"],
    ["/sites/new", "Add a site"],
  ];
  for (const [url, title] of CASES) {
    test(`${url} is titled ${title}`, async () => {
      document.title = "lychee admin";
      mount(url);
      await waitFor(() => assert.equal(document.title, title), TIMEOUT);
    });
  }
});
