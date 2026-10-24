import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { showToast } from "../toast";
import { QueryClient } from "@tanstack/react-query";
import type { AddSitePayload } from "../../shared/addSite";
import type { SitesPayload } from "../../shared/sites";
import { seedAddSitePayload, testShell } from "../../dev/testHelpers";
import { renderClientPage } from "../../views/clientShell";
import { RAIL_DOT } from "../../views/railModel";
import { seedHealth } from "../test/healthFixture";
import { siteOf } from "../clientNav";
import { isClientRoute, mountApp } from "../router";

/*
 * /sites/new as a client route, on SiteDetailRoutes.test.tsx's harness: the
 * server's shell for a URL, then the one root mounted over it, with fetch
 * answering the APIs. POST /sites can be held, so a test can leave the page
 * while the add is in flight and answer it afterwards.
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const originalFocus = HTMLElement.prototype.focus;
const originalAssign = Object.getOwnPropertyDescriptor(window.location, "assign");

type HappyDOM = { setURL(url: string): void; setViewport(v: { width: number }): void };
const happyDOM = (globalThis as unknown as { happyDOM: HappyDOM }).happyDOM;

let app: ReturnType<typeof mountApp> = null;
let client: QueryClient | null = null;
/** Every request, as `METHOD url`. */
let fetched: string[] = [];
let assigned: string[] = [];
let payload: AddSitePayload;
let sites: SitesPayload;
/** When set, POST /sites waits for the test to answer it. */
let holdAdd = false;
let heldAdd: ((response: Response) => void) | null = null;

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

before(async () => {
  payload = await seedAddSitePayload();
  // A browser never focuses what a closed <dialog> holds; happy-dom does.
  // Emulated, as the site page's tests do, so a mount-time autoFocus inside a
  // closed dialog cannot take focus from where the operator had it.
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
  holdAdd = false;
  heldAdd = null;
  happyDOM.setViewport({ width: 1024 });
  document.body.innerHTML = "";
  document.title = "";
  happyDOM.setURL("http://localhost/");
  window.history.replaceState(null, "");
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubFetch(): void {
  fetched = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    fetched.push(`${method} ${url}`);
    if (url === "/api/health") return json(200, { ok: true, ...seedHealth() });
    if (url === "/api/sites") return json(200, { ok: true, ...sites });
    if (url.startsWith("/api/sites/new")) return json(200, { ok: true, ...payload });
    if (url === "/sites/preview") return json(200, { ready: false });
    if (url === "/sites" && method === "POST") {
      if (holdAdd) return new Promise<Response>((resolve) => (heldAdd = resolve));
      const hostname = new URLSearchParams(String(init?.body)).get("hostname");
      return json(200, { hostname });
    }
    return json(404, { ok: false, reason: `unstubbed ${url}` });
  }) as typeof fetch;
}

/** The document the server sends for `path`, then the root mounted over it. */
function load(path: string, list: SitesPayload = SITES): void {
  sites = list;
  stubFetch();
  assigned = [];
  Object.defineProperty(window.location, "assign", { configurable: true, value: (href: string) => void assigned.push(href) });
  happyDOM.setURL(`http://localhost${path}`);
  const html =
    path === "/sites/new"
      ? renderClientPage("Add a site", "add-site", testShell({ current: null }))
      : renderClientPage("Sites", "sites", testShell({ current: { page: "sites" } }));
  document.title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
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

const form = () => document.getElementById("add-site-form") as HTMLFormElement | null;
const headline = () => document.getElementById("composed-hostname")?.closest("h2") ?? null;
const listHeading = () => document.querySelector<HTMLHeadingElement>("#app-root section h2");
const marked = () => Array.from(document.querySelectorAll('#rail a[aria-current="page"]')).map((a) => a.getAttribute("href"));
const reads = () => fetched.filter((f) => f.startsWith("GET /api/sites/new"));
const previews = () => fetched.filter((f) => f === "POST /sites/preview").length;
const label = (el: Element | null | undefined) =>
  el ? `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> "${(el.textContent ?? "").slice(0, 40)}"` : String(el);
/** By identity, with a short message: assert.equal on two DOM nodes stalls the runner printing them. */
function assertFocus(el: Element | null | undefined) {
  assert.ok(document.activeElement === el, `focus is on ${label(document.activeElement)}, not ${label(el)}`);
}
const railLive = () =>
  waitFor(() => assert.equal(document.querySelector('#rail [data-site="api.lychee.land"] [data-dot]')?.getAttribute("class"), RAIL_DOT.bad), TIMEOUT);
const showingForm = () => waitFor(() => assert.ok(form(), "no add form"), TIMEOUT);
const showingList = () => waitFor(() => assert.ok(document.querySelector('#app-root a[href="/sites/blog.lychee.land"]'), "no list"), TIMEOUT);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** From the list to the add page by its Add site button, in-app. */
async function arriveFromList(): Promise<void> {
  load("/");
  await railLive();
  await showingList();
  const add = document.querySelector('#app-root a[href="/sites/new"]');
  assert.ok(add, "no Add site");
  assert.equal(clickCancelled(add), true, "the click was left to the browser");
  await showingForm();
}

const cancelLink = () =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>('#add-site-form a[href="/"]')).find((a) => a.textContent === "Cancel") ?? null;

function type(hostname: string): void {
  const field = document.getElementById("hostname-field") as HTMLInputElement;
  act(() => {
    fireEvent.change(field, { target: { value: hostname } });
  });
}

describe("isClientRoute", () => {
  test("includes /sites/new, which is still never a site", () => {
    for (const path of ["/sites/new", "/sites/new?x=1", "/sites/new#h"]) assert.equal(isClientRoute(path), true, path);
    assert.equal(siteOf("/sites/new"), null);
    assert.equal(siteOf("/sites/NEW"), null);
  });
});

describe("the add page route", () => {
  test("a direct visit renders the page, titled Add a site, no row current, with no focus taken; one read, with ?refresh=1", async () => {
    load("/sites/new");
    await railLive();
    await showingForm();
    assert.equal(document.title, "Add a site");
    assert.deepEqual(marked(), []);
    await act(async () => {});
    assert.ok(document.activeElement !== headline(), "a document load took focus");
    assert.ok(!headline()?.hasAttribute("tabindex"));
    assert.deepEqual(reads(), ["GET /api/sites/new?refresh=1"]);
    assert.deepEqual(assigned, []);
  });

  test("list → Add site loads no document; title, no row current, focus on the headline; the arrival reads with ?refresh=1", async () => {
    await arriveFromList();
    assert.equal(window.location.pathname, "/sites/new");
    assert.equal(document.title, "Add a site");
    assert.deepEqual(marked(), []);
    await waitFor(() => assertFocus(headline()), TIMEOUT);
    assert.equal(headline()?.getAttribute("tabindex"), "-1");
    assert.deepEqual(reads(), ["GET /api/sites/new?refresh=1"]);
    assert.deepEqual(assigned, []);
  });

  test("the empty state's Add your first site loads no document", async () => {
    load("/", { ...SITES, sites: [], statuses: {} });
    const cta = await waitFor(() => document.getElementById("empty-state-cta") ?? assert.fail("no empty state"), TIMEOUT);
    assert.equal(clickCancelled(cta), true, "the click was left to the browser");
    await showingForm();
    assert.equal(document.title, "Add a site");
    await waitFor(() => assertFocus(headline()), TIMEOUT);
    assert.deepEqual(assigned, []);
  });

  test("an arrival keeps focus in a wide-screen #find", async () => {
    load("/");
    await railLive();
    await showingList();
    const find = document.querySelector<HTMLInputElement>("#find") as HTMLInputElement;
    act(() => find.focus());
    const add = document.querySelector('#app-root a[href="/sites/new"]') as HTMLAnchorElement;
    assert.equal(clickCancelled(add), true);
    await showingForm();
    await act(async () => {});
    assertFocus(find);
  });

  test("a second arrival reads again, with ?refresh=1, and takes focus again", async () => {
    await arriveFromList();
    assert.equal(clickCancelled(cancelLink() as HTMLAnchorElement), true);
    await showingList();
    const add = document.querySelector('#app-root a[href="/sites/new"]') as HTMLAnchorElement;
    assert.equal(clickCancelled(add), true);
    await showingForm();
    await waitFor(() => assertFocus(headline()), TIMEOUT);
    assert.deepEqual(reads(), ["GET /api/sites/new?refresh=1", "GET /api/sites/new?refresh=1"]);
  });

  for (const [name, find] of [
    ["Cancel", () => cancelLink()],
    ["the breadcrumb's sites link", () => document.querySelector('#app-root nav[aria-label="Breadcrumb"] a[href="/"]')],
  ] as const) {
    test(`${name} returns to the list in-app`, async () => {
      load("/sites/new");
      await railLive();
      await showingForm();
      const link = find();
      assert.ok(link, `no ${name}`);
      assert.equal(clickCancelled(link), true, "the click was left to the browser");
      await showingList();
      assert.ok(!form());
      assert.equal(window.location.pathname, "/");
      assert.equal(document.title, "Sites");
      assert.deepEqual(marked(), ["/"]);
      await waitFor(() => assertFocus(listHeading()), TIMEOUT);
      assert.deepEqual(assigned, []);
    });
  }

  test("a successful add is a full document load of the new site's page with ?created=1", async () => {
    await arriveFromList();
    type("shop");
    act(() => {
      fireEvent.submit(form() as HTMLFormElement);
    });
    await waitFor(() => assert.deepEqual(assigned, ["/sites/shop.lychee.land?created=1"]), TIMEOUT);
    assert.ok(fetched.includes("POST /sites"));
  });
});

describe("RF3: leaving mid-preview and mid-submit", () => {
  test("leaving inside the 250 ms debounce sends no preview after leaving", async () => {
    await arriveFromList();
    // The arrival preview has gone out and settled.
    await waitFor(() => assert.ok(previews() > 0), TIMEOUT);
    await act(async () => {});
    type("shop");
    const before = previews();
    assert.equal(clickCancelled(cancelLink() as HTMLAnchorElement), true);
    await showingList();
    await act(async () => {
      await sleep(400);
    });
    assert.equal(previews(), before, "a preview went out after the page had gone");
    assert.equal(window.location.pathname, "/");
  });

  test("an add that settles after another toast replaced its own leaves that toast alone", async () => {
    await arriveFromList();
    holdAdd = true;
    type("shop");
    act(() => {
      fireEvent.submit(form() as HTMLFormElement);
    });
    await waitFor(() => assert.ok(heldAdd, "POST /sites was not sent"), TIMEOUT);
    assert.equal(clickCancelled(cancelLink() as HTMLAnchorElement), true);
    await showingList();
    act(() => showToast("Deploying blog…", "info"));
    await act(async () => {
      heldAdd?.(json(500, { error: "boom" }));
      await sleep(50);
    });
    assert.equal(document.getElementById("flash-banner-message")?.textContent, "Deploying blog…");
    assert.ok(!document.getElementById("flash-banner")?.classList.contains("hidden"));
  });

  for (const [status, body] of [
    [200, { hostname: "shop.lychee.land" }],
    [500, { error: "boom", steps: [{ id: "backup", status: "ok" }] }],
  ] as const) {
    test(`an add answered ${status} after leaving settles its own toast: no navigation, no throw`, async () => {
      const failures: unknown[] = [];
      const record = (error: unknown) => void failures.push(error);
      process.on("unhandledRejection", record);
      process.on("uncaughtException", record);
      try {
        await arriveFromList();
        holdAdd = true;
        type("shop");
        act(() => {
          fireEvent.submit(form() as HTMLFormElement);
        });
        await waitFor(() => assert.ok(heldAdd, "POST /sites was not sent"), TIMEOUT);
        const toast = () => document.getElementById("flash-banner");
        assert.ok(toast() && !toast()?.classList.contains("hidden"), "the Adding… toast is not up");
        assert.equal(clickCancelled(cancelLink() as HTMLAnchorElement), true);
        await showingList();
        assert.ok(!form());
        await act(async () => {
          heldAdd?.(json(status, body));
          await sleep(50);
        });
        assert.deepEqual(assigned, []);
        // The Adding… toast was this add's own, so it settles it: gone on success, the error on failure.
        const message = document.getElementById("flash-banner-message")?.textContent;
        if (status === 200) {
          assert.ok(toast()?.classList.contains("hidden"), "the Adding… toast outlived a successful add");
        } else {
          assert.ok(!toast()?.classList.contains("hidden"), "the failure was not shown");
          assert.equal(message, "boom");
          assert.ok(!document.getElementById("flash-banner-close")?.classList.contains("hidden"), "no close button");
        }
        assert.equal(window.location.pathname, "/");
        assert.ok(document.querySelector('#app-root a[href="/sites/blog.lychee.land"]'), "the list went");
        assert.deepEqual(failures, []);
      } finally {
        process.off("unhandledRejection", record);
        process.off("uncaughtException", record);
      }
    });
  }
});
