import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { SitesPayload, SiteSummary } from "../../shared/sites";
import { sitesQueryKey } from "../api";
import { canonical } from "../test/canonical";
import { SiteList } from "../components/SiteList";
import { SitesPage } from "./SitesPage";

/*
 * The live sites list: /api/sites re-read every 15s, keeping the last good
 * list when a re-read fails, and updating rows in place by hostname. Its
 * markup against the server's is SiteListParity.test.tsx's; this checks the
 * page adds nothing to it at rest.
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;

const STATIC: SiteSummary = { hostname: "blog.lychee.land", type: "static", target: "/var/www/blog.lychee.land" };
const API: SiteSummary = { hostname: "api.lychee.land", type: "reverse-proxy", target: "4000" };
const GONE: SiteSummary = { hostname: "gone.lychee.land", type: "reverse-proxy", target: "4100" };

function payload(sites: SiteSummary[] = [STATIC, API, GONE]): SitesPayload {
  const statuses: SitesPayload["statuses"] = {};
  for (const s of sites) if (s.type === "reverse-proxy") statuses[s.hostname] = { kind: "tcp", responding: true };
  return { sites, statuses, problems: [], domain: "lychee.land", caddyfileError: null };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let current: SitesPayload;
let answer: () => Response;
let calls: string[] = [];
let client: QueryClient;

beforeEach(() => {
  calls = [];
  current = payload();
  answer = () => json(200, { ok: true, ...current });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return answer();
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

function mount(): HTMLElement {
  // retry off so a failure is an error at once; mutations collected at once.
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <SitesPage />
    </QueryClientProvider>,
  );
  return container;
}

const refetch = () =>
  act(async () => {
    await client.refetchQueries({ queryKey: sitesQueryKey() });
  });

const rowLink = (hostname: string) => document.querySelector<HTMLAnchorElement>(`a[href="/sites/${hostname}"]`);

function observerOptions() {
  const query = client.getQueryCache().find({ queryKey: sitesQueryKey() });
  assert.ok(query, "no sites query");
  const observer = query.observers[0];
  assert.ok(observer, "the page does not observe the sites query");
  return observer.options;
}

describe("SitesPage", () => {
  test("reads /api/sites and renders exactly SiteList's markup at rest, titled Sites", async () => {
    const container = mount();
    await waitFor(() => assert.ok(rowLink("api.lychee.land")), TIMEOUT);
    assert.ok(calls.includes("/api/sites"));
    assert.equal(document.title, "Sites");
    assert.equal(canonical(container.innerHTML), canonical(renderToStaticMarkup(<SiteList payload={current} />)));
    assert.ok(!screen.queryByRole("alert"));
  });

  test("a failed first load shows the alert alone", async () => {
    answer = () => json(500, { ok: false, reason: "boom" });
    mount();
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh the sites list: boom");
    assert.ok(!document.querySelector("h2"));
    assert.ok(!rowLink("api.lychee.land"));
  });

  test("a failed refetch keeps the rows and shows the alert above them; the next success clears it", async () => {
    mount();
    await waitFor(() => assert.ok(rowLink("api.lychee.land")), TIMEOUT);

    answer = () => json(502, { ok: false, reason: "Could not read the Caddyfile" });
    await refetch();
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh the sites list: Could not read the Caddyfile");
    const row = rowLink("api.lychee.land");
    assert.ok(row, "the rows were dropped");
    assert.ok(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING, "the alert is not above the rows");

    answer = () => json(200, { ok: true, ...current });
    await refetch();
    await waitFor(() => assert.ok(!screen.queryByRole("alert")), TIMEOUT);
    assert.ok(rowLink("api.lychee.land"));
  });

  test("a refresh that drops a site removes only its row, and focus stays where it was (Review Focus 2)", async () => {
    mount();
    await waitFor(() => assert.ok(rowLink("gone.lychee.land")), TIMEOUT);
    const blog = rowLink("blog.lychee.land");
    const api = rowLink("api.lychee.land");
    assert.ok(blog && api);
    act(() => api.focus());
    assert.ok(document.activeElement === api);

    current = payload([STATIC, API]);
    await refetch();
    await waitFor(() => assert.ok(!rowLink("gone.lychee.land")), TIMEOUT);
    assert.ok(rowLink("blog.lychee.land") === blog, "the blog row was rebuilt");
    assert.ok(rowLink("api.lychee.land") === api, "the api row was rebuilt");
    assert.ok(document.activeElement === api, "focus moved");
  });

  test("re-reads every 15s, not in the background, and on focus", async () => {
    mount();
    await waitFor(() => assert.ok(rowLink("api.lychee.land")), TIMEOUT);
    const options = observerOptions();
    const interval = options.refetchInterval;
    assert.equal(typeof interval === "function" ? "function" : interval, 15_000);
    assert.equal(options.refetchIntervalInBackground, false);
    assert.equal(options.refetchOnWindowFocus, true);
  });

  test("outside the router it takes no focus: only a client navigation moves it", async () => {
    mount();
    await waitFor(() => assert.ok(rowLink("api.lychee.land")), TIMEOUT);
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(document.activeElement === document.body);
    assert.ok(!document.querySelector("h2")?.hasAttribute("tabindex"));
  });
});
