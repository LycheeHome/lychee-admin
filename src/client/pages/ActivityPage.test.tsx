import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter, useLocation, type DataRouter } from "react-router";
import type { ActivityEvent, ActivityPayload } from "../../shared/activity";
import { ClientNavContext } from "../clientNav";
import { ActivityPage } from "./ActivityPage";

/*
 * The page at /activity: filters in the URL, day headings, "Show older",
 * and every way a read can fail.
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const NOW = "2026-10-28T12:00:00.000Z";

const event = (extra: Partial<ActivityEvent>): ActivityEvent => ({
  at: "2026-10-28T11:55:00.000Z",
  who: "reconciler",
  kind: "deploy",
  subject: "app.lychee.land",
  href: "/sites/app.lychee.land",
  outcome: "deployed 0.1.0 → 0.2.0",
  tone: "ok",
  detail: null,
  ...extra,
});

const FAILED = event({
  at: "2026-10-28T11:00:00.000Z",
  who: "app",
  kind: "remove",
  subject: "gone.lychee.land",
  href: null,
  outcome: "failed",
  tone: "bad",
  detail: "caddy validate: unrecognized directive on line 9",
});

function payload(extra: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    now: NOW,
    next: null,
    subjects: ["app.lychee.land", "other.lychee.land"],
    sources: { app: true, reconciler: true },
    events: [
      event({}),
      FAILED,
      event({ at: "2026-10-27T11:00:00.000Z", who: "app", kind: "add", subject: "app.lychee.land", outcome: "added", tone: "neutral" }),
    ],
    ...extra,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let requested: string[];
/** What the stub answers for /api/activity; a function so a test can vary it per call. */
let answer: (url: URL) => Response | Promise<Response>;

/** A promise and the function that settles it. */
function gate<T>(): { promise: Promise<T>; open: (value: T) => void } {
  let open!: (value: T) => void;
  const promise = new Promise<T>((r) => (open = r));
  return { promise, open };
}
let client: QueryClient;
let router: DataRouter;

beforeEach(() => {
  requested = [];
  answer = () => json(200, { ok: true, ...payload() });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    requested.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/activity") return answer(url);
    return json(404, { ok: false, reason: "no" });
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

/** The page under a nav context whose locationKey follows the router, as the app's does. */
function Live({ documentLoad }: { documentLoad: boolean }) {
  const l = useLocation();
  return (
    <ClientNavContext.Provider value={{ pathname: l.pathname, locationKey: l.key, navigate: () => {}, documentLoad }}>
      <ActivityPage />
    </ClientNavContext.Provider>
  );
}

function mountLive(url = "/activity"): void {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  router = createMemoryRouter([{ path: "/activity", element: <Live documentLoad /> }], { initialEntries: [url] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function mount(url = "/activity", documentLoad = true): void {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  router = createMemoryRouter([{ path: "/activity", element: <ActivityPage /> }], { initialEntries: [url] });
  render(
    <QueryClientProvider client={client}>
      <ClientNavContext.Provider value={{ pathname: "/activity", locationKey: "k", navigate: () => {}, documentLoad }}>
        <RouterProvider router={router} />
      </ClientNavContext.Provider>
    </QueryClientProvider>,
  );
}

const bodyRows = () => Array.from(document.querySelectorAll("tbody tr"));
const dayRows = () => bodyRows().filter((r) => r.querySelector("th")).map((r) => r.textContent);
const dataRows = () => bodyRows().filter((r) => !r.querySelector("th"));
const select = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;
const loaded = () => waitFor(() => assert.ok(document.querySelector("table")), TIMEOUT);
const olderButton = () => screen.queryByRole("button", { name: "Show older" });

describe("ActivityPage", () => {
  test("eyebrow, three labelled selects, the table and day headings", async () => {
    mount();
    await loaded();
    assert.ok(screen.getByRole("heading", { name: "Activity" }));
    assert.equal(select("subject").options[0]?.textContent, "all subjects");
    assert.equal(select("who").options[0]?.textContent, "all");
    assert.equal(select("kind").options[0]?.textContent, "all");
    assert.deepEqual(Array.from(select("subject").options).map((o) => o.value), ["", "app.lychee.land", "other.lychee.land"]);
    assert.deepEqual(Array.from(select("who").options).map((o) => o.value), ["", "app", "reconciler"]);
    assert.equal(select("kind").options.length, 10);
    assert.equal(dataRows().length, 3);
    const days = dayRows();
    assert.equal(days.length, 2, "a heading per local day, no more");
    assert.match(days[0] ?? "", /^today · /);
    assert.match(days[1] ?? "", /^yesterday · /);
    // A failed row's detail is shown in full under its outcome.
    assert.ok(screen.getByText("caddy validate: unrecognized directive on line 9"));
    assert.ok(document.querySelector("table")?.parentElement?.classList.contains("overflow-x-auto"), "the table is not in the scroll box");
    assert.ok(screen.queryByText("clear filters") === null);
  });

  test("a URL subject that is not among the options is an extra, selected option", async () => {
    mount("/activity?subject=gone.lychee.land");
    await loaded();
    const s = select("subject");
    assert.equal(s.value, "gone.lychee.land");
    assert.ok(Array.from(s.options).some((o) => o.value === "gone.lychee.land"));
  });

  test("changing who rewrites the URL in place and re-requests page one", async () => {
    mount();
    await loaded();
    assert.ok(screen.queryByText("clear filters") === null);
    fireEvent.change(select("who"), { target: { value: "reconciler" } });
    await waitFor(() => assert.equal(router.state.location.search, "?who=reconciler"), TIMEOUT);
    assert.equal(router.state.historyAction, "REPLACE");
    await waitFor(() => assert.ok(requested.some((u) => u.includes("who=reconciler") && !u.includes("before="))), TIMEOUT);
    const clear = await screen.findByText("clear filters");
    fireEvent.click(clear);
    await waitFor(() => assert.equal(router.state.location.search, ""), TIMEOUT);
    await waitFor(() => assert.ok(screen.queryByText("clear filters") === null), TIMEOUT);
  });

  test("Show older appends without repeating a continuing day's heading, then Start of history", async () => {
    const first = payload({ next: "c1", events: [event({}), FAILED] });
    const second = payload({
      next: null,
      events: [
        event({ at: "2026-10-28T10:00:00.000Z", subject: "other.lychee.land", href: null }),
        event({ at: "2026-10-27T11:00:00.000Z", who: "app", kind: "add", outcome: "added", tone: "neutral" }),
      ],
    });
    answer = (url) => json(200, { ok: true, ...(url.searchParams.get("before") === "c1" ? second : first) });
    mount();
    await loaded();
    assert.equal(dataRows().length, 2);
    fireEvent.click(olderButton()!);
    await waitFor(() => assert.equal(dataRows().length, 4), TIMEOUT);
    assert.equal(dayRows().length, 2, "today's heading was repeated across the seam");
    await waitFor(() => assert.ok(screen.getByText("Start of history")), TIMEOUT);
    assert.ok(olderButton() === null);
  });

  test("a newest page that gains an event on re-read leaves every event once (seam)", async () => {
    const at = (n: number) => `2026-10-28T11:${String(50 - n).padStart(2, "0")}:00.000Z`;
    let log = [0, 1, 2, 3].map((n) => event({ at: at(n), subject: `s${n}.lychee.land`, href: null }));
    answer = (url) => {
      const before = url.searchParams.get("before");
      const start = before === null ? 0 : log.findIndex((e) => e.at === before) + 1;
      const events = log.slice(start, start + 2);
      const last = events[events.length - 1];
      const next = last && log.indexOf(last) < log.length - 1 ? last.at : null;
      return json(200, { ok: true, ...payload({ events, next }) });
    };
    mount();
    await loaded();
    fireEvent.click(olderButton()!);
    await waitFor(() => assert.equal(dataRows().length, 4), TIMEOUT);
    log = [event({ at: "2026-10-28T11:59:00.000Z", subject: "new.lychee.land", href: null }), ...log];
    await act(async () => {
      await client.refetchQueries({ queryKey: ["activity-page"] });
    });
    const subjects = (): Array<string | null | undefined> => dataRows().map((r) => r.children[3]?.textContent);
    await waitFor(() => assert.equal(subjects()[0], "new.lychee.land"), TIMEOUT);
    assert.equal(new Set(subjects()).size, subjects().length, `duplicates: ${subjects().join(",")}`);
    assert.deepEqual(subjects(), ["new.lychee.land", "s0.lychee.land", "s1.lychee.land", "s2.lychee.land"]);
  });

  test("a failed first load shows the alert alone", async () => {
    answer = () => json(500, { ok: false, reason: "audit gone" });
    mount();
    const alert = await screen.findByRole("alert", undefined, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh activity: audit gone");
    assert.ok(document.querySelector("table") === null);
  });

  test("a failed re-read keeps the last good table under the alert, which clears on success", async () => {
    mount();
    await loaded();
    answer = () => json(500, { ok: false, reason: "boom" });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["activity-page"] });
    });
    assert.equal((await screen.findByRole("alert")).textContent, "Couldn't refresh activity: boom");
    assert.equal(dataRows().length, 3);
    answer = () => json(200, { ok: true, ...payload() });
    await act(async () => {
      await client.refetchQueries({ queryKey: ["activity-page"] });
    });
    await waitFor(() => assert.ok(screen.queryByRole("alert") === null), TIMEOUT);
  });

  test("a failed Show older says so beside a button that stays", async () => {
    const first = payload({ next: "c1" });
    answer = (url) => (url.searchParams.get("before") ? json(500, { ok: false, reason: "nope" }) : json(200, { ok: true, ...first }));
    mount();
    await loaded();
    fireEvent.click(olderButton()!);
    assert.equal((await screen.findByRole("alert", undefined, TIMEOUT)).textContent, "Couldn't load older activity: nope");
    assert.ok(olderButton(), "Show older is missing");
    assert.equal(dataRows().length, 3);
  });

  test("a first-load alert survives a retry in flight", async () => {
    answer = () => json(500, { ok: false, reason: "audit gone" });
    mount();
    await screen.findByRole("alert", undefined, TIMEOUT);
    const g = gate<Response>();
    answer = () => g.promise;
    let retry!: Promise<unknown>;
    act(() => {
      retry = client.refetchQueries({ queryKey: ["activity-page"] });
    });
    await waitFor(() => assert.ok(requested.length >= 2), TIMEOUT);
    assert.equal(document.querySelector("[role=alert]")?.textContent, "Couldn't refresh activity: audit gone");
    await act(async () => {
      g.open(json(200, { ok: true, ...payload() }));
      await retry;
    });
    await waitFor(() => assert.ok(document.querySelector("[role=alert]") === null), TIMEOUT);
    assert.equal(dataRows().length, 3);
  });

  test("a re-read landing after a failed Show older never relabels its alert", async () => {
    const first = payload({ next: "c1" });
    answer = (url) => (url.searchParams.get("before") ? json(500, { ok: false, reason: "nope" }) : json(200, { ok: true, ...first }));
    mount();
    await loaded();
    fireEvent.click(olderButton()!);
    await screen.findByText("Couldn't load older activity: nope", undefined, TIMEOUT);
    const g = gate<Response>();
    answer = () => g.promise;
    let retry!: Promise<unknown>;
    act(() => {
      retry = client.refetchQueries({ queryKey: ["activity-page"] });
    });
    await waitFor(() => assert.ok(requested.length >= 3), TIMEOUT);
    const alerts = Array.from(document.querySelectorAll("[role=alert]")).map((a) => a.textContent);
    assert.deepEqual(alerts, ["Couldn't load older activity: nope"]);
    await act(async () => {
      g.open(json(200, { ok: true, ...first }));
      await retry;
    });
    await waitFor(() => assert.ok(document.querySelector("[role=alert]") === null), TIMEOUT);
  });

  test("returning to a cached filter set starts from one page again", async () => {
    const first = payload({ next: "c1", events: [event({}), FAILED] });
    const second = payload({ next: null, events: [event({ at: "2026-10-27T11:00:00.000Z", subject: "old.lychee.land", href: null })] });
    answer = (url) => json(200, { ok: true, ...(url.searchParams.get("before") === "c1" ? second : first) });
    mount();
    await loaded();
    fireEvent.click(olderButton()!);
    await waitFor(() => assert.equal(dataRows().length, 3), TIMEOUT);
    fireEvent.change(select("who"), { target: { value: "app" } });
    await waitFor(() => assert.equal(router.state.location.search, "?who=app"), TIMEOUT);
    await waitFor(() => assert.ok(olderButton() !== null && dataRows().length === 2), TIMEOUT);
    fireEvent.click(await screen.findByText("clear filters"));
    await waitFor(() => assert.equal(router.state.location.search, ""), TIMEOUT);
    await waitFor(() => assert.ok(screen.queryByText("clear filters") === null), TIMEOUT);
    assert.equal(dataRows().length, 2, "the cached second page came back");
    assert.ok(olderButton());
  });

  test("a 400 shows the server's reason and a clear filters link", async () => {
    answer = () => json(400, { ok: false, reason: "unknown kind: deploys" });
    mount("/activity?kind=deploys");
    const alert = await screen.findByRole("alert", undefined, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh activity: unknown kind: deploys");
    fireEvent.click(screen.getByText("clear filters"));
    await waitFor(() => assert.equal(router.state.location.search, ""), TIMEOUT);
  });

  test("empty states", async () => {
    answer = () => json(200, { ok: true, ...payload({ events: [] }) });
    mount("/activity?who=app");
    await screen.findByText("No activity matches these filters.", undefined, TIMEOUT);
    assert.ok(screen.getByText("clear filters"));
    cleanup();
    client.clear();
    mount();
    await screen.findByText("Nothing recorded yet.", undefined, TIMEOUT);
  });

  test("one source unreadable names it; both unreadable is one sentence", async () => {
    answer = () => json(200, { ok: true, ...payload({ sources: { app: true, reconciler: false } }) });
    mount();
    await screen.findByText("Reconciler history couldn't be read; showing app actions only, so this history is incomplete.", undefined, TIMEOUT);
    assert.equal(dataRows().length, 3);
    cleanup();
    client.clear();
    answer = () => json(200, { ok: true, ...payload({ sources: { app: false, reconciler: true } }) });
    mount();
    await screen.findByText("The audit log couldn't be read; showing reconciler events only, so this history is incomplete.", undefined, TIMEOUT);
    cleanup();
    client.clear();
    answer = () => json(200, { ok: true, ...payload({ events: [], sources: { app: false, reconciler: false } }) });
    mount();
    await screen.findByText("Activity couldn't be read.", undefined, TIMEOUT);
    assert.ok(document.querySelector("table") === null);
  });

  test("title, and focus on the eyebrow for an in-app arrival only", async () => {
    mount("/activity", true);
    await loaded();
    assert.equal(document.title, "activity · lychee admin");
    assert.notEqual(document.activeElement, screen.getByRole("heading", { name: "Activity" }));
    cleanup();
    client.clear();
    mount("/activity", false);
    await loaded();
    assert.equal(document.activeElement, screen.getByRole("heading", { name: "Activity" }));
  });

  test("changing a filter leaves focus on the select, with a live location key", async () => {
    mountLive();
    await loaded();
    const who = select("who");
    who.focus();
    const key = router.state.location.key;
    fireEvent.change(who, { target: { value: "app" } });
    await waitFor(() => assert.equal(router.state.location.search, "?who=app"), TIMEOUT);
    assert.notEqual(router.state.location.key, key, "the move must change the location key");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(document.activeElement, select("who"));
  });

  test("each day's rows are their own tbody under a rowgroup header", async () => {
    mount();
    await loaded();
    const bodies = Array.from(document.querySelectorAll("tbody"));
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every((b) => b.querySelector("th")?.getAttribute("scope") === "rowgroup"));
    assert.equal(document.querySelector("th[scope=colgroup]"), null);
  });

  test("Show older keeps focus usable: aria-disabled while fetching, then the first new row's link", async () => {
    const first = payload({ next: "c1", events: [event({}), FAILED] });
    const second = payload({ next: "c2", events: [event({ at: "2026-10-27T10:00:00.000Z", subject: "new.lychee.land", href: "/sites/new.lychee.land" })] });
    const g = gate<Response>();
    answer = (url) => (url.searchParams.get("before") === "c1" ? g.promise : json(200, { ok: true, ...first }));
    mount();
    await loaded();
    const btn = olderButton()!;
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => assert.equal(btn.getAttribute("aria-disabled"), "true"), TIMEOUT);
    assert.equal(btn.hasAttribute("disabled"), false);
    assert.equal(document.activeElement, btn);
    g.open(json(200, { ok: true, ...second }));
    await waitFor(() => assert.equal(dataRows().length, 3), TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement?.textContent, "new.lychee.land"), TIMEOUT);
  });

  test("Show older onto the last page with no link lands focus on Start of history", async () => {
    const first = payload({ next: "c1", events: [event({}), FAILED] });
    const second = payload({ next: null, events: [event({ at: "2026-10-27T10:00:00.000Z", subject: "plain.lychee.land", href: null })] });
    answer = (url) => json(200, { ok: true, ...(url.searchParams.get("before") === "c1" ? second : first) });
    mount();
    await loaded();
    const btn = olderButton()!;
    btn.focus();
    fireEvent.click(btn);
    const end = await screen.findByText("Start of history", undefined, TIMEOUT);
    await waitFor(() => assert.equal(document.activeElement, end), TIMEOUT);
  });
});
