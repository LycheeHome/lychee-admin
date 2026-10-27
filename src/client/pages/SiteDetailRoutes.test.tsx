import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { BoardPayload, BoardRow, ServiceGroup } from "../../shared/board";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import type { SitesPayload } from "../../shared/sites";
import { SEEDED_RAIL_SITES, seedSiteDetailPayload } from "../../dev/testHelpers";
import { RAIL_DOT } from "../../views/railModel";
import { addedNotice } from "../../views/siteDetailModel";
import { seedHealth } from "../test/healthFixture";
import { loadStaticDocument, railPayload } from "../test/staticDocument";
import { siteDetailQueryKey } from "../api";
import { siteOf } from "../clientNav";
import { isClientRoute, mountApp } from "../router";

/*
 * /sites/:hostname as a client route, on router.test.tsx's harness: the
 * static document at a URL, then the one root mounted on it, with fetch
 * answering the APIs from the dev seed.
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const originalFocus = HTMLElement.prototype.focus;
const originalAssign = Object.getOwnPropertyDescriptor(window.location, "assign");

type HappyDOM = { setURL(url: string): void; setViewport(v: { width: number }): void };
const happyDOM = (globalThis as unknown as { happyDOM: HappyDOM }).happyDOM;

let app: ReturnType<typeof mountApp> = null;
let client: QueryClient | null = null;
let fetched: string[] = [];
let assigned: string[] = [];
const details = new Map<string, Extract<SiteDetailPayload, { caddyfileError: null }>>();

before(async () => {
  for (const host of ["app.lychee.land", "blog.lychee.land"]) details.set(host, (await seedSiteDetailPayload(host)).payload);
  // A browser never focuses what a closed <dialog> holds (it is not
  // rendered); happy-dom does, so React's mount-time autoFocus on the remove
  // dialog's Cancel would take focus from wherever the operator had it.
  // Emulated, so the focus assertions below test the page, not happy-dom.
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (this.closest("dialog:not([open])")) return;
    originalFocus.call(this, options);
  };
});

after(() => {
  HTMLElement.prototype.focus = originalFocus;
});

afterEach(() => {
  if (app) act(() => app?.unmount());
  app = null;
  client?.clear();
  client = null;
  globalThis.fetch = originalFetch;
  if (originalAssign) Object.defineProperty(window.location, "assign", originalAssign);
  happyDOM.setViewport({ width: 1024 });
  document.body.innerHTML = "";
  document.title = "";
  happyDOM.setURL("http://localhost/");
  window.history.replaceState(null, "");
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SITES: SitesPayload = {
  sites: [
    { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" },
    { hostname: "app.lychee.land", type: "reverse-proxy", target: "3200", framework: "nextjs" },
  ],
  statuses: {},
  problems: [],
  domain: "lychee.land",
  caddyfileError: null,
};

function board(group: ServiceGroup): BoardPayload {
  const row = { name: "swee", kind: "unit", unit: "swee.service", group, reconciled: false, status: "running", since: null } as BoardRow;
  // A site resource's row, which the board links to its site's page.
  const site = { name: "app-lychee-land", kind: "unit", unit: "app-lychee-land.service", group, reconciled: false, status: "running", since: null } as BoardRow;
  return {
    board: { inventoryAvailable: true, schedule: { next: null, last: null }, timerUnit: null, generated: "2026-10-22T11:58:00Z", groups: [{ group, rows: [row, site] }] },
    boardEmpty: false,
    now: "2026-10-22T12:00:00Z",
    domain: "lychee.land",
    prunable: [], retiring: [],
    managed: ["app.lychee.land"],
    requested: {},
    lastRuns: {},
  };
}

function stubFetch(): void {
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url === "/api/health") return json(200, { ok: true, ...seedHealth() });
    if (url === "/api/rail") return json(200, { ok: true, ...railPayload(SEEDED_RAIL_SITES.map((s) => ({ ...s }))) });
    if (url === "/api/sites") return json(200, { ok: true, ...SITES });
    if (url.startsWith("/api/sites/")) {
      const host = decodeURIComponent(url.slice("/api/sites/".length).split("?")[0] ?? "");
      const payload = details.get(host);
      return payload ? json(200, { ok: true, ...payload }) : json(404, { ok: false, reason: `No site named ${host}` });
    }
    const group = new URLSearchParams(url.split("?")[1] ?? "").get("group") as ServiceGroup;
    return json(200, { ok: true, ...board(group) });
  }) as typeof fetch;
}

/**
 * The static document at `url`, then the root mounted on it. Every rail row
 * and notice is the client's; any notice is read off the URL.
 */
function load(url: string): void {
  stubFetch();
  assigned = [];
  Object.defineProperty(window.location, "assign", { configurable: true, value: (href: string) => void assigned.push(href) });
  happyDOM.setURL(`http://localhost${url}`);
  loadStaticDocument();
  // No `queries.gcTime: 0`: a route loader primes its page's query before the
  // page observes it, which a zero gcTime would collect in between.
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  act(() => {
    app = mountApp(client as QueryClient);
  });
  assert.ok(app, "the root did not mount");
}

const hostHeading = () => document.getElementById("site-hostname");
const railLink = (href: string) => document.querySelector<HTMLAnchorElement>(`#rail a[href="${href}"]`);
const marked = () => Array.from(document.querySelectorAll('#rail a[aria-current="page"]')).map((a) => a.getAttribute("href"));
const label = (el: Element | null | undefined) =>
  el ? `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> "${(el.textContent ?? "").slice(0, 40)}"` : String(el);
/** By identity, with a short message: assert.equal on two DOM nodes stalls the runner printing them. */
function assertFocus(el: Element | null | undefined) {
  assert.ok(document.activeElement === el, `focus is on ${label(document.activeElement)}, not ${label(el)}`);
}
const railLive = () =>
  waitFor(() => assert.equal(document.querySelector('#rail [data-site="api.lychee.land"] [data-dot]')?.getAttribute("class"), RAIL_DOT.bad), TIMEOUT);
/** Waits for the page of `<label>.lychee.land` (the heading dims the domain, so its text is the whole hostname). */
const showing = (label: string) =>
  waitFor(() => assert.equal(hostHeading()?.textContent, `${label}.lychee.land`), TIMEOUT);

/** Clicks `link` and says whether the router cancelled it; cancels it after, so happy-dom stays put. */
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

describe("isClientRoute", () => {
  test("includes a site's page, but never a deeper path; /sites/new is the add page, never a site", () => {
    for (const path of ["/sites/app.lychee.land", "/sites/App.Lychee.Land", "/sites/app%2Elychee.land?created=1#hop"]) {
      assert.equal(isClientRoute(path), true, path);
    }
    for (const path of ["/sites/", "/sites/a/b", "/sites/app.lychee.land/delete"]) {
      assert.equal(isClientRoute(path), false, path);
    }
    for (const path of ["/sites/new", "/sites/new?x=1"]) assert.equal(siteOf(path), null, path);
  });
});

describe("the site page route", () => {
  test("a direct visit renders the page, titled the hostname, its row current, with no focus taken", async () => {
    load("/sites/app.lychee.land");
    await showing("app");
    assert.equal(document.title, "app.lychee.land");
    assert.deepEqual(marked(), ["/sites/app.lychee.land"]);
    await act(async () => {});
    assert.ok(document.activeElement !== hostHeading(), "a document load took focus");
    assert.ok(!hostHeading()?.hasAttribute("tabindex"));
  });

  test("list → site loads no document; title, row and focus follow; the arrival reads with ?refresh=1", async () => {
    load("/");
    await railLive();
    const row = await waitFor(() => document.querySelector('main a[href="/sites/app.lychee.land"]') ?? assert.fail("no row"), TIMEOUT);
    assert.equal(clickCancelled(row), true, "the click was left to the browser");
    await showing("app");
    assert.equal(window.location.pathname, "/sites/app.lychee.land");
    assert.equal(document.title, "app.lychee.land");
    assert.deepEqual(marked(), ["/sites/app.lychee.land"]);
    await waitFor(() => assertFocus(hostHeading()), TIMEOUT);
    assert.equal(hostHeading()?.getAttribute("tabindex"), "-1");
    assert.ok(fetched.includes("/api/sites/app.lychee.land?refresh=1"));
    assert.deepEqual(assigned, []);
  });

  test("site → site loads no document and remounts the page for the new site", async () => {
    load("/sites/app.lychee.land");
    await railLive();
    await showing("app");
    const appDialog = document.getElementById("confirm-remove-dialog");
    assert.ok(appDialog);
    assert.equal(clickCancelled(railLink("/sites/blog.lychee.land") as HTMLAnchorElement), true);
    await showing("blog");
    assert.equal(document.title, "blog.lychee.land");
    assert.deepEqual(marked(), ["/sites/blog.lychee.land"]);
    await waitFor(() => assertFocus(hostHeading()), TIMEOUT);
    assert.ok(!appDialog.isConnected, "the remove dialog was carried over to another site");
    assert.ok(fetched.includes("/api/sites/blog.lychee.land?refresh=1"));
    assert.deepEqual(assigned, []);
  });

  test("site → /services loads no document", async () => {
    load("/sites/app.lychee.land");
    await railLive();
    await showing("app");
    assert.equal(clickCancelled(railLink("/services") as HTMLAnchorElement), true);
    await waitFor(() => assert.ok(document.querySelector('[data-service="swee"]')), TIMEOUT);
    assert.ok(!hostHeading());
    assert.equal(document.title, "Services");
    assert.deepEqual(marked(), ["/services"]);
    assert.deepEqual(assigned, []);
  });

  test("the board's site link is a router link", async () => {
    load("/services");
    await railLive();
    const link = await waitFor(
      () => document.querySelector('main a[href="/sites/app.lychee.land"]') ?? assert.fail("no site link"),
      TIMEOUT,
    );
    assert.equal(clickCancelled(link), true, "the click was left to the browser");
    await showing("app");
    await waitFor(() => assertFocus(hostHeading()), TIMEOUT);
    assert.deepEqual(assigned, []);
  });

  // Critique 2026-10-27: a move from find is the end of a search, so find
  // gives focus up and the site's page takes it, as any in-app move's does.
  test("find's Enter on a site closes find and focuses the site's hostname", async () => {
    load("/sites/app.lychee.land");
    await railLive();
    await showing("app");
    const find = document.querySelector<HTMLInputElement>("#find") as HTMLInputElement;
    act(() => find.focus());
    fireEvent.change(find, { target: { value: "blog" } });
    await waitFor(() => assert.ok(document.querySelector('[role="option"]')), TIMEOUT);
    act(() => {
      fireEvent.keyDown(find, { key: "Enter" });
    });
    await showing("blog");
    await waitFor(() => assertFocus(hostHeading()), TIMEOUT);
    assert.equal(find.value, "");
    assert.ok(document.querySelector('[role="listbox"]') === null, "find's panel is still open");
    assert.deepEqual(assigned, []);
  });

  // No server page is left; a URL no route matches stands in for one, since
  // the rule for leaving the client routes is still the router's.
  test("from a URL no route matches a site is a document load", async () => {
    load("/elsewhere");
    await railLive();
    assert.ok(!fetched.some((u) => u.startsWith("/api/sites/")));
    assert.equal(clickCancelled(railLink("/sites/app.lychee.land") as HTMLAnchorElement), false);
  });

  test("the loader reads with ?refresh=1 and the polls do not", async () => {
    load("/sites/app.lychee.land");
    await showing("app");
    assert.deepEqual(
      fetched.filter((u) => u.startsWith("/api/sites/")),
      ["/api/sites/app.lychee.land?refresh=1"],
    );
    await act(async () => {
      await client?.refetchQueries({ queryKey: siteDetailQueryKey("app.lychee.land") });
    });
    assert.deepEqual(
      fetched.filter((u) => u.startsWith("/api/sites/")),
      ["/api/sites/app.lychee.land?refresh=1", "/api/sites/app.lychee.land"],
    );
  });

  test("an unknown site shows the not-found body, titled Site not found, with no row current", async () => {
    load("/sites/nope.lychee.land");
    await waitFor(() => assert.equal(document.querySelector("main h2")?.textContent, "Site not found"), TIMEOUT);
    assert.equal(document.title, "Site not found");
    assert.deepEqual(marked(), []);
  });

  for (const url of ["/sites/App.Lychee.Land", "/sites/app%2Elychee.land"]) {
    test(`Review Focus 1: ${url} marks app.lychee.land's row and reads /api/sites/app.lychee.land`, async () => {
      load(url);
      await showing("app");
      assert.deepEqual(marked(), ["/sites/app.lychee.land"]);
      const reads = fetched.filter((u) => u.startsWith("/api/sites/")).map((u) => u.split("?")[0]);
      assert.ok(reads.length > 0 && reads.every((u) => u === "/api/sites/app.lychee.land"), reads.join(","));
      assert.equal(document.title, "app.lychee.land");
    });
  }

  test("Review Focus 5: ?created=1 leaves the URL, the notice stays until the first move away and does not come back", async () => {
    const site = details.get("app.lychee.land")?.site;
    assert.ok(site);
    const NOTICE = addedNotice(site);
    load("/sites/app.lychee.land?created=1&x=1#hop");
    assert.equal(window.location.search, "?x=1");
    assert.equal(window.location.hash, "#hop");
    await railLive();
    await showing("app");
    assert.equal(document.getElementById("page-notice-message")?.textContent, NOTICE);

    act(() => {
      fireEvent.click(railLink("/services") as HTMLAnchorElement);
    });
    await waitFor(() => assert.ok(document.querySelector('[data-service="swee"]')), TIMEOUT);
    assert.ok(!document.getElementById("page-notice"));

    act(() => {
      fireEvent.click(railLink("/sites/app.lychee.land") as HTMLAnchorElement);
    });
    await showing("app");
    assert.ok(!document.getElementById("page-notice"));
  });

  describe("the page's own links move in-app (spec §1)", () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    test("the breadcrumb's sites link goes to the list", async () => {
      load("/sites/app.lychee.land");
      await railLive();
      await showing("app");
      const crumb = document.querySelector('main nav[aria-label="Breadcrumb"] a[href="/"]');
      assert.ok(crumb, "no breadcrumb link");
      assert.equal(clickCancelled(crumb), true, "the click was left to the browser");
      await waitFor(() => assert.ok(document.querySelector('main a[href="/sites/blog.lychee.land"]')), TIMEOUT);
      assert.equal(window.location.pathname, "/");
      assert.equal(document.title, "Sites");
      assert.deepEqual(marked(), ["/"]);
      assert.deepEqual(assigned, []);
    });

    test("the resource row's link lands on its board row, targeted as a rail move's is", async () => {
      const scrolled: string[] = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this.id);
      };
      const name = details.get("app.lychee.land")?.resource?.name;
      assert.ok(name, "app has no resource");
      load("/sites/app.lychee.land");
      await railLive();
      await showing("app");
      const link = document.querySelector(`main a[href="/services#service-${name}"]`);
      assert.ok(link, "no resource link");
      assert.equal(clickCancelled(link), true, "the click was left to the browser");
      await waitFor(() => assert.ok(document.getElementById(`service-${name}`)), TIMEOUT);
      assert.equal(window.location.pathname, "/services");
      assert.equal(window.location.hash, `#service-${name}`);
      assert.equal(document.title, "Services");
      assert.deepEqual(marked(), ["/services"]);
      await waitFor(() => assert.ok(scrolled.includes(`service-${name}`), `scrolled: ${scrolled.join(",")}`), TIMEOUT);
      assert.deepEqual(assigned, []);
    });

    test("the not-found body's back link goes to the list", async () => {
      load("/sites/nope.lychee.land");
      await railLive();
      const back = await waitFor(
        () => document.querySelector('main a[href="/"]') ?? assert.fail("no back link"),
        TIMEOUT,
      );
      assert.equal(back.textContent, "← Back to sites");
      assert.equal(clickCancelled(back), true, "the click was left to the browser");
      await waitFor(() => assert.ok(document.querySelector('main a[href="/sites/blog.lychee.land"]')), TIMEOUT);
      assert.equal(document.title, "Sites");
      assert.deepEqual(assigned, []);
    });

    test("the Caddyfile error's back link goes to the list", async () => {
      details.set("err.lychee.land", { caddyfileError: "cannot read\ndenied", domain: "lychee.land" } as never);
      try {
        load("/sites/err.lychee.land");
        await railLive();
        const back = await waitFor(
          () => document.querySelector('main a[href="/"]') ?? assert.fail("no back link"),
          TIMEOUT,
        );
        assert.ok(document.querySelector("main")?.textContent?.includes("cannot read"));
        assert.equal(back.textContent, "← sites");
        assert.equal(clickCancelled(back), true, "the click was left to the browser");
        await waitFor(() => assert.ok(document.querySelector('main a[href="/sites/blog.lychee.land"]')), TIMEOUT);
        assert.equal(document.title, "Sites");
        assert.deepEqual(assigned, []);
      } finally {
        details.delete("err.lychee.land");
      }
    });
  });

  test("a hash-only move on the site page keeps its notice", async () => {
    load("/sites/app.lychee.land?created=1");
    await railLive();
    await showing("app");
    act(() => {
      fireEvent.click(railLink("/sites/app.lychee.land") as HTMLAnchorElement);
    });
    await act(async () => {});
    assert.ok(document.getElementById("page-notice"));
    await waitFor(() => assertFocus(hostHeading()), TIMEOUT);
  });
});
