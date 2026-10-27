import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { showToast } from "../toast";
import { QueryClient } from "@tanstack/react-query";
import type { AddSitePayload } from "../../shared/addSite";
import type { SitesPayload } from "../../shared/sites";
import { SEEDED_RAIL_SITES, seedAddSitePayload } from "../../dev/testHelpers";
import { RAIL_DOT } from "../../views/railModel";
import { seedHealth } from "../test/healthFixture";
import { loadStaticDocument, railPayload } from "../test/staticDocument";
import { siteOf } from "../clientNav";
import { isClientRoute, mountApp } from "../router";

/*
 * /sites/new as a client route, on SiteDetailRoutes.test.tsx's harness: the
 * static document at a URL, then the one root mounted on it, with fetch
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

/** What POST /sites/preview answers; reset to "not ready" by every stub. */
let previewAnswer: unknown = { ready: false };

function stubFetch(): void {
  fetched = [];
  previewAnswer = { ready: false };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    fetched.push(`${method} ${url}`);
    if (url === "/api/health") return json(200, { ok: true, ...seedHealth() });
    if (url === "/api/rail") return json(200, { ok: true, ...railPayload(SEEDED_RAIL_SITES.map((s) => ({ ...s }))) });
    if (url === "/api/sites") return json(200, { ok: true, ...sites });
    if (url.startsWith("/api/sites/new")) return json(200, { ok: true, ...payload });
    if (url === "/sites/preview") return json(200, previewAnswer);
    if (url === "/sites" && method === "POST") {
      if (holdAdd) return new Promise<Response>((resolve) => (heldAdd = resolve));
      const hostname = new URLSearchParams(String(init?.body)).get("hostname");
      return json(200, { hostname });
    }
    return json(404, { ok: false, reason: `unstubbed ${url}` });
  }) as typeof fetch;
}

/** The static document at `path`, then the root mounted on it. */
function load(path: string, list: SitesPayload = SITES): void {
  sites = list;
  stubFetch();
  assigned = [];
  Object.defineProperty(window.location, "assign", { configurable: true, value: (href: string) => void assigned.push(href) });
  happyDOM.setURL(`http://localhost${path}`);
  loadStaticDocument();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  act(() => {
    app = mountApp(client as QueryClient);
  });
  assert.ok(app, "the root did not mount");
}

const form = () => document.getElementById("add-site-form") as HTMLFormElement | null;
const headline = () => document.getElementById("composed-hostname")?.closest("h2") ?? null;
const listHeading = () => document.querySelector<HTMLHeadingElement>("main section h2");
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
const showingList = () => waitFor(() => assert.ok(document.querySelector('main a[href="/sites/blog.lychee.land"]'), "no list"), TIMEOUT);
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
  const add = document.querySelector('main a[href="/sites/new"]');
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

// The typed label is one unit: a line breaks before the domain, never inside
// the label (critique 2026-10-26 minors, "01 Label kept whole": at 390px
// `preview-staging` broke at its hyphen).
describe("the composed headline", () => {
  test("holds the typed label whole, and wraps only where it cannot fit", async () => {
    load("/sites/new");
    await showingForm();
    type("preview-staging");
    const composed = () => document.getElementById("composed-hostname");
    await waitFor(() => assert.match(composed()?.textContent ?? "", /^preview-staging\.lychee\.land$/), TIMEOUT);
    assert.equal(
      composed()?.innerHTML,
      '<span class="inline-block max-w-full">preview-staging</span><span class="text-stone-500">.lychee.land</span>',
    );
    assert.ok(headline()?.classList.contains("[overflow-wrap:anywhere]"), headline()?.className);
  });
});

// Critique 2026-10-27 P2: the step a reverse proxy skips says so beside its
// label as soon as the type is chosen, not after a good preview, and in a
// word a listener hears, not a bare dash.
describe("the step a reverse proxy skips", () => {
  const filesStep = () => document.querySelector('#add-site-steps [data-step-id="files"]');
  const chooseType = (value: string) =>
    act(() => {
      fireEvent.click(document.querySelector(`input[name="type"][value="${value}"]`) as HTMLInputElement);
    });

  test("reads skipped as soon as reverse proxy is chosen, with no preview", async () => {
    load("/sites/new");
    await showingForm();
    assert.equal(filesStep()?.querySelector("[data-step-skipped]"), null, "skipped before a type that skips it");
    chooseType("reverse-proxy");
    const word = filesStep()?.querySelector("[data-step-skipped]");
    assert.ok(word, "no skipped word");
    assert.equal(word.textContent?.replace(/^·\s*/, ""), "skipped");
    assert.equal(filesStep()?.querySelector(".step-mark")?.textContent, "", "a bare mark beside the word");
    chooseType("static");
    assert.equal(filesStep()?.querySelector("[data-step-skipped]"), null, "still skipped for a static site");
  });
});

describe("a rejection said once", () => {
  const PORT_TAKEN = "Port 4000 is already used by api.lychee.land.";
  const panelLine = () =>
    Array.from(document.querySelectorAll("#write-preview p")).find((p) => /appears here\.$/.test(p.textContent ?? ""))?.textContent ?? null;
  const submit = () => document.getElementById("add-site-submit") as HTMLButtonElement;

  test("a port conflict the field already states: the panel points up, and a blocked submit goes to the port field", async () => {
    load("/sites/new");
    await showingForm();
    previewAnswer = { ready: false, error: PORT_TAKEN };
    type("shop");
    act(() => {
      fireEvent.click(document.querySelector('input[name="type"][value="reverse-proxy"]') as HTMLInputElement);
    });
    act(() => {
      fireEvent.change(document.getElementById("port-field") as HTMLInputElement, { target: { value: "4000" } });
    });
    await waitFor(() => assert.equal(submit().getAttribute("aria-disabled"), "true"), TIMEOUT);
    assert.equal(document.getElementById("port-error")?.textContent, PORT_TAKEN);
    assert.ok(document.getElementById("preview-error")?.classList.contains("hidden"), "the panel repeats the field");
    assert.equal(panelLine(), "Fix the port in the form and the block appears here.");
    assert.equal(submit().getAttribute("aria-describedby"), "port-error");
    act(() => {
      fireEvent.submit(form() as HTMLFormElement);
    });
    assert.equal(document.activeElement?.id, "port-field");
    assert.ok(!fetched.includes("POST /sites"), "a blocked submit posted");
  });

  // Critique 2026-10-26 P2: a hostname the page can already judge (its
  // characters) is said under the field, tied to it, and once.
  test("an invalid hostname is said under its field, and once", async () => {
    const BAD = `"shop!!" can only use letters, digits and hyphens, and can't start or end with a hyphen`;
    load("/sites/new");
    await showingForm();
    previewAnswer = { ready: false, error: BAD };
    type("Shop!!");
    const field = document.getElementById("hostname-field") as HTMLInputElement;
    assert.equal(document.getElementById("hostname-error")?.textContent, BAD);
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.match(field.getAttribute("aria-describedby") ?? "", /\bhostname-error\b/);
    await waitFor(() => assert.equal(submit().getAttribute("aria-disabled"), "true"), TIMEOUT);
    assert.ok(document.getElementById("preview-error")?.classList.contains("hidden"), "the panel repeats the field");
    assert.equal(panelLine(), "Fix the hostname in the form and the block appears here.");
    assert.equal(submit().getAttribute("aria-describedby"), "hostname-error");
    act(() => {
      fireEvent.submit(form() as HTMLFormElement);
    });
    assert.equal(document.activeElement?.id, "hostname-field");
    // Fixed, the field clears and stops claiming it's invalid.
    type("shop");
    assert.equal(document.getElementById("hostname-error")?.textContent, "");
    assert.equal(field.getAttribute("aria-invalid"), null);
  });

  test("a rejection no field states keeps the panel's box, and a blocked submit goes there", async () => {
    load("/sites/new");
    await showingForm();
    previewAnswer = { ready: false, error: "blog.lychee.land already exists in the Caddyfile" };
    type("blog");
    await waitFor(() => assert.equal(submit().getAttribute("aria-disabled"), "true"), TIMEOUT);
    assert.ok(!document.getElementById("preview-error")?.classList.contains("hidden"));
    assert.equal(panelLine(), "Fix the problem above and the block appears here.");
    assert.equal(submit().getAttribute("aria-describedby"), "preview-error");
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
    const add = document.querySelector('main a[href="/sites/new"]') as HTMLAnchorElement;
    assert.equal(clickCancelled(add), true);
    await showingForm();
    await act(async () => {});
    assertFocus(find);
  });

  test("a second arrival reads again, with ?refresh=1, and takes focus again", async () => {
    await arriveFromList();
    assert.equal(clickCancelled(cancelLink() as HTMLAnchorElement), true);
    await showingList();
    const add = document.querySelector('main a[href="/sites/new"]') as HTMLAnchorElement;
    assert.equal(clickCancelled(add), true);
    await showingForm();
    await waitFor(() => assertFocus(headline()), TIMEOUT);
    assert.deepEqual(reads(), ["GET /api/sites/new?refresh=1", "GET /api/sites/new?refresh=1"]);
  });

  for (const [name, find] of [
    ["Cancel", () => cancelLink()],
    ["the breadcrumb's sites link", () => document.querySelector('main nav[aria-label="Breadcrumb"] a[href="/"]')],
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

  // The page is gone as of the commit that removes it. An answer that lands
  // between that commit and React's passive effects (a MutationObserver
  // callback runs in exactly that gap) used to read the page as still
  // mounted and hide the toast that had replaced its own: CI saw it about
  // once in twenty loaded runs.
  test("an add answered in the commit that removes the page settles as gone", async () => {
    await arriveFromList();
    holdAdd = true;
    type("shop");
    act(() => {
      fireEvent.submit(form() as HTMLFormElement);
    });
    await waitFor(() => assert.ok(heldAdd, "POST /sites was not sent"), TIMEOUT);
    act(() => showToast("Deploying blog…", "info"));
    const observer = new MutationObserver(() => {
      if (form() || !heldAdd) return;
      observer.disconnect();
      heldAdd(json(500, { error: "boom" }));
      heldAdd = null;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      assert.equal(clickCancelled(cancelLink() as HTMLAnchorElement), true);
      await showingList();
      await act(async () => {
        await sleep(50);
      });
    } finally {
      observer.disconnect();
    }
    assert.equal(heldAdd, null, "the add was not answered in the commit that removed the page");
    assert.equal(document.getElementById("flash-banner-message")?.textContent, "Deploying blog…");
    assert.ok(!document.getElementById("flash-banner")?.classList.contains("hidden"), "the other page's toast was hidden");
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
        });
        // The Adding… toast was this add's own, so it settles it: gone on success, the error on failure.
        if (status === 200) {
          await waitFor(
            () => assert.ok(toast()?.classList.contains("hidden"), "the Adding… toast outlived a successful add"),
            { timeout: 5000 },
          );
        } else {
          await waitFor(
            () => assert.equal(document.getElementById("flash-banner-message")?.textContent, "boom"),
            { timeout: 5000 },
          );
          assert.ok(!toast()?.classList.contains("hidden"), "the failure was not shown");
          assert.ok(!document.getElementById("flash-banner-close")?.classList.contains("hidden"), "no close button");
        }
        assert.deepEqual(assigned, []);
        assert.equal(window.location.pathname, "/");
        assert.ok(document.querySelector('main a[href="/sites/blog.lychee.land"]'), "the list went");
        assert.deepEqual(failures, []);
      } finally {
        process.off("unhandledRejection", record);
        process.off("uncaughtException", record);
      }
    });
  }
});
