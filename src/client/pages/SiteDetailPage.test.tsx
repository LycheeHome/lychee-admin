import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import { seedSiteDetailPayload } from "../../dev/testHelpers";
import { siteDetailQueryKey } from "../api";
import { BOARD_ALERT } from "../components/BoardRows";
import { SiteDetailPage, siteDetailInterval, siteDetailQuery, SITE_DETAIL_FAST_MS, SITE_DETAIL_POLL_MS } from "./SiteDetailPage";

/*
 * The live site page: GET /api/sites/:hostname re-read every 15s (3s while a
 * requested tag is in flight), never while one of the page's writes is in
 * flight or the remove dialog is open, keeping the last good page when a
 * re-read fails.
 */

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;

const TIMEOUT = { timeout: 5000 };
const HOST = "app.lychee.land";
const originalFetch = globalThis.fetch;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let seed: Detail;
let current: SiteDetailPayload;
let answer: () => Response | Promise<Response>;
let postAnswer: () => Response | Promise<Response>;
let calls: { method: string; url: string }[] = [];
let client: QueryClient;

before(async () => {
  seed = (await seedSiteDetailPayload(HOST)).payload;
  // The toast the writes use, as the shell renders it.
  document.body.innerHTML = `<div id="flash-banner" class="hidden" role="status">
    <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden">x</button></div>`;
});

beforeEach(() => {
  calls = [];
  current = seed;
  answer = () => json(200, { ok: true, ...current });
  postAnswer = () => json(200, { ok: true });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(input) });
    return method === "GET" ? answer() : postAnswer();
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  client?.clear();
  document.title = "";
});

after(() => {
  globalThis.fetch = originalFetch;
});

function mount(hostname = HOST): HTMLElement {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <SiteDetailPage hostname={hostname} />
    </QueryClientProvider>,
  );
  return container;
}

const reads = () => calls.filter((c) => c.method === "GET").length;
const heading = () => document.getElementById("site-hostname");
const refetch = () =>
  act(async () => {
    await client.refetchQueries({ queryKey: siteDetailQueryKey(HOST) });
  });

/** The interval the page's observer would schedule now, resolved against its query. */
function interval(): number | false | undefined {
  const query = client.getQueryCache().find({ queryKey: siteDetailQueryKey(HOST) });
  assert.ok(query, "no site query");
  const observer = query.observers[0];
  assert.ok(observer, "the page does not observe its query");
  const value = observer.options.refetchInterval;
  return typeof value === "function" ? (value(query as never) as number | false | undefined) : value;
}

function observerOptions() {
  const query = client.getQueryCache().find({ queryKey: siteDetailQueryKey(HOST) });
  assert.ok(query?.observers[0]);
  return query.observers[0].options;
}

describe("siteDetailInterval", () => {
  const found = (payload: SiteDetailPayload) => ({ found: true as const, payload });
  const idle = { writing: false, dialogOpen: false };

  test("is 15s, 3s while a tag is requested, and off while a write is in flight or the dialog is open", () => {
    assert.equal(SITE_DETAIL_POLL_MS, 15_000);
    assert.equal(SITE_DETAIL_FAST_MS, 3_000);
    assert.equal(siteDetailInterval(found(seed), idle), 15_000);
    assert.equal(siteDetailInterval(undefined, idle), 15_000);
    assert.equal(siteDetailInterval({ found: false }, idle), 15_000);
    assert.equal(siteDetailInterval(found({ caddyfileError: "x", domain: "lychee.land" }), idle), 15_000);
    assert.ok(seed.resource);
    const requested = found({ ...seed, resource: { ...seed.resource, requestedTag: "0.3.0" } });
    assert.equal(siteDetailInterval(requested, idle), 3_000);
    assert.equal(siteDetailInterval(requested, { writing: true, dialogOpen: false }), false);
    assert.equal(siteDetailInterval(found(seed), { writing: false, dialogOpen: true }), false);
  });
});

describe("siteDetailQuery's reconnect re-read pauses with the polling; focus is the page's", () => {
  const pauses = [
    { writing: true, dialogOpen: false },
    { writing: false, dialogOpen: true },
    { writing: true, dialogOpen: true },
  ];

  test("reconnect is off under either pause and on otherwise; the query's own focus re-read is always off", () => {
    for (const pause of pauses) {
      const options = siteDetailQuery(HOST, pause);
      assert.equal(options.refetchOnWindowFocus, false);
      assert.equal(options.refetchOnReconnect, false);
    }
    const idle = siteDetailQuery(HOST, { writing: false, dialogOpen: false });
    // The page's focus re-read pulls the clone, which TanStack's cannot.
    assert.equal(idle.refetchOnWindowFocus, false);
    assert.equal(idle.refetchOnReconnect, true);
  });
});

/** Let the page's read go stale, then fire a window-focus event. */
async function focusAfterStale(staleWait = 2_100): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, staleWait));
  });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise((r) => setTimeout(r, 150));
  });
}

describe("a focus re-read pulls the lychee-resources clone", () => {
  afterEach(() => focusManager.setFocused(undefined));

  test("a focus after staleTime re-reads with ?refresh=1", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    await focusAfterStale();
    await waitFor(() => assert.equal(reads(), 2), TIMEOUT);
    assert.equal(calls.at(-1)?.url, `/api/sites/${HOST}?refresh=1`);
  });

  test("a focus inside staleTime does not re-read", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    await focusAfterStale(0);
    assert.equal(reads(), 1);
  });

  test("no focus re-read while the remove dialog is open", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    act(() => {
      fireEvent.click(document.querySelector('[data-open-dialog="confirm-remove-dialog"]') as HTMLElement);
    });
    await waitFor(() => assert.equal(interval(), false), TIMEOUT);
    await focusAfterStale();
    assert.equal(reads(), 1);
  });

  test("no focus re-read while a write of the page's is in flight", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    let release: (r: Response) => void = () => {};
    postAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    act(() => {
      fireEvent.click(document.querySelector(`[data-deploy="${seed.resource?.name}"]`) as HTMLElement);
    });
    await waitFor(() => assert.equal(interval(), false), TIMEOUT);
    await focusAfterStale();
    assert.equal(reads(), 1);
    await act(async () => release(json(200, { ok: true })));
  });

  test("the 15s poll still reads without a pull", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    await act(async () => {
      t.mock.timers.tick(15_000);
    });
    await waitFor(() => assert.equal(reads(), 2), TIMEOUT);
    assert.equal(calls.at(-1)?.url, `/api/sites/${HOST}`);
  });

  test("a failed focus re-read shows the alert and keeps the page", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    answer = () => json(502, { ok: false, reason: "pull failed" });
    await focusAfterStale();
    await waitFor(() => assert.match(screen.getByRole("alert").textContent ?? "", /Couldn't refresh app\.lychee\.land: pull failed/), TIMEOUT);
    assert.ok(heading(), "the page went");
  });
});

describe("SiteDetailPage", () => {
  test("reads /api/sites/<hostname> without refresh and renders the page, titled the hostname", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    assert.deepEqual(
      calls.map((c) => c.url),
      [`/api/sites/${HOST}`],
    );
    assert.equal(document.title, HOST);
    assert.ok(!screen.queryByRole("alert"));
  });

  test("the observer's options: 15s, 3s with a requested tag, not in the background, reconnect, focus left to the page, 2s stale", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    assert.equal(interval(), 15_000);
    const options = observerOptions();
    assert.equal(options.refetchIntervalInBackground, false);
    assert.equal(options.refetchOnWindowFocus, false);
    assert.equal(options.refetchOnReconnect, true);
    assert.equal(options.staleTime, 2_000);

    assert.ok(seed.resource);
    current = { ...seed, resource: { ...seed.resource, requestedTag: "0.3.0" } };
    await refetch();
    assert.equal(interval(), 3_000);
  });

  test("off while the remove dialog is open, and back when it closes", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    act(() => {
      fireEvent.click(document.querySelector('[data-open-dialog="confirm-remove-dialog"]') as HTMLElement);
    });
    await waitFor(() => assert.equal(interval(), false), TIMEOUT);
    act(() => {
      fireEvent.click(document.querySelector('[data-close-dialog="confirm-remove-dialog"]') as HTMLElement);
    });
    await waitFor(() => assert.equal(interval(), 15_000), TIMEOUT);
  });

  test("off while a write of the page's is in flight", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    let release: (r: Response) => void = () => {};
    postAnswer = () => new Promise<Response>((resolve) => (release = resolve));
    const deploy = document.querySelector<HTMLButtonElement>(`[data-deploy="${seed.resource?.name}"]`);
    assert.ok(deploy, "app has no Deploy offer");
    act(() => {
      fireEvent.click(deploy);
    });
    await waitFor(() => assert.equal(interval(), false), TIMEOUT);
    await act(async () => release(json(200, { ok: true })));
    await waitFor(() => assert.equal(interval(), 15_000), TIMEOUT);
  });

  test("Review Focus 3: polling really pauses while the dialog is open, and resumes on close", async (t) => {
    t.mock.timers.enable({ apis: ["setInterval"] });
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    const tick = async (ms: number) => {
      await act(async () => {
        t.mock.timers.tick(ms);
      });
    };

    // The control: polling runs under the mocked clock.
    const first = reads();
    await tick(15_000);
    await waitFor(() => assert.equal(reads(), first + 1), TIMEOUT);

    act(() => {
      fireEvent.click(document.querySelector('[data-open-dialog="confirm-remove-dialog"]') as HTMLElement);
    });
    await waitFor(() => assert.equal(interval(), false), TIMEOUT);
    const open = reads();
    await tick(16_000);
    await tick(16_000);
    await act(async () => {});
    assert.equal(reads(), open, "a read was sent while the dialog was open");

    act(() => {
      fireEvent.click(document.querySelector('[data-close-dialog="confirm-remove-dialog"]') as HTMLElement);
    });
    await waitFor(() => assert.equal(interval(), 15_000), TIMEOUT);
    await tick(15_000);
    await waitFor(() => assert.equal(reads(), open + 1), TIMEOUT);
  });

  test("a failed refetch keeps the page under the alert; the next success clears it", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    answer = () => json(502, { ok: false, reason: "Could not read the Caddyfile" });
    await refetch();
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, `Couldn't refresh ${HOST}: Could not read the Caddyfile`);
    assert.equal(alert.getAttribute("class"), BOARD_ALERT);
    const h = heading();
    assert.ok(h, "the page was dropped");
    assert.ok(alert.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING, "the alert is not above the page");

    answer = () => json(200, { ok: true, ...current });
    await refetch();
    await waitFor(() => assert.ok(!screen.queryByRole("alert")), TIMEOUT);
    assert.ok(heading());
  });

  test("a failed first load shows the alert alone", async () => {
    answer = () => json(500, { ok: false, reason: "boom" });
    mount();
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, `Couldn't refresh ${HOST}: boom`);
    assert.ok(!heading());
    assert.ok(!document.querySelector("h2"));
  });

  test("a refetch answering 404 shows SiteNotFound, titled Site not found", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    answer = () => json(404, { ok: false, reason: `No site named ${HOST}` });
    await refetch();
    await waitFor(() => assert.ok(!heading()), TIMEOUT);
    assert.equal(document.querySelector("h2")?.textContent, "Site not found");
    assert.ok(document.body.textContent?.includes(`No managed site found for "${HOST}".`));
    assert.ok(!screen.queryByRole("alert"), "a 404 is a page, not a failed read");
    assert.equal(document.title, "Site not found");
  });

  test("a caddyfileError payload shows CaddyfileError, titled the hostname", async () => {
    current = { caddyfileError: "cannot read\ndenied", domain: "lychee.land" };
    mount();
    await waitFor(() => assert.ok(document.body.textContent?.includes("cannot read")), TIMEOUT);
    assert.ok(!heading());
    assert.ok(document.querySelector('a[href="/"]')?.textContent?.includes("sites"));
    assert.equal(document.title, HOST);
  });

  test("the page wires the card heading to its writes: after Prune removes its control, focus moves there", async () => {
    const gone = (await seedSiteDetailPayload("gone.lychee.land")).payload;
    current = gone;
    mount("gone.lychee.land");
    const prune = await waitFor(
      () => document.querySelector<HTMLButtonElement>("[data-prune]") ?? assert.fail("gone has no Prune"),
      TIMEOUT,
    );
    // What the next read answers once the declaration is pruned: no Prune.
    postAnswer = () => {
      current = { ...gone, detached: false };
      return json(200, { ok: true });
    };
    act(() => prune.focus());
    act(() => {
      fireEvent.click(prune);
    });
    const cardHeading = () => Array.from(document.querySelectorAll("h3")).find((h) => h.textContent === "From a repository");
    await waitFor(() => assert.ok(!document.querySelector("[data-prune]")), TIMEOUT);
    await waitFor(
      () => assert.ok(document.activeElement === cardHeading(), `focus is on <${document.activeElement?.tagName}>`),
      TIMEOUT,
    );
  });

  test("outside the router it takes no focus: only a client navigation moves it", async () => {
    mount();
    await waitFor(() => assert.ok(heading()), TIMEOUT);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(document.activeElement !== heading(), "the heading took focus");
    assert.ok(!heading()?.hasAttribute("tabindex"));
  });
});
