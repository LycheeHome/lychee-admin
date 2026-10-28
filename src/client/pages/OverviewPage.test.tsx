import "../test/setup";
import assert from "node:assert/strict";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityEvent, ActivityPayload } from "../../shared/activity";
import type { HealthPayload, UnitHealth } from "../../shared/health";
import { ACTIVITY_SCROLL } from "../../views/overviewModel";
import { ACTIVITY_QUERY } from "../activity";
import { HEALTH_QUERY } from "../health";
import { seedHealth } from "../test/healthFixture";
import { OverviewPage } from "./OverviewPage";

/*
 * The overview at `/`: the strip, needs attention and recent activity, read
 * from two queries that fail independently (Review Focus 3).
 */

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const NOW = "2026-10-28T12:00:00.000Z";
const LONG = `${"a".repeat(63)}.lychee.land`;

const unit = (name: string, group: UnitHealth["group"], extra: Partial<UnitHealth> = {}): UnitHealth => ({
  name,
  group,
  tone: "ok",
  label: "running",
  trouble: null,
  href: `/${group === "service" ? "services" : group}#service-${name}`,
  attention: false,
  site: null,
  ...extra,
});

function clearHealth(): HealthPayload {
  return {
    now: NOW,
    generated: "2026-10-28T11:58:00.000Z",
    sites: [{ hostname: "app.lychee.land", tone: "ok", label: "running", attention: false }],
    units: [unit("palworld", "service"), unit("lychee-watch", "reconciler"), unit("caddy", "infrastructure")],
  };
}

/** Two bad rows (api, broken) and one unknown (ntfy). */
function troubleHealth(): HealthPayload {
  return {
    now: NOW,
    generated: "2026-10-28T11:58:00.000Z",
    sites: [
      { hostname: "api.lychee.land", tone: "bad", label: "not responding", attention: true },
      { hostname: "app.lychee.land", tone: "ok", label: "running", attention: false },
      { hostname: "broken.lychee.land", tone: "bad", label: "failed", attention: true },
    ],
    units: [
      unit("palworld", "service"),
      unit("ntfy", "service", { tone: "neutral", label: "unknown" }),
      unit("lychee-watch", "reconciler"),
      unit("caddy", "infrastructure"),
    ],
  };
}

const event = (extra: Partial<ActivityEvent>): ActivityEvent => ({
  at: "2026-10-28T11:55:00.000Z",
  who: "reconciler",
  kind: "deploy",
  subject: "app.lychee.land",
  href: "/sites/app.lychee.land",
  outcome: "deployed 0.1.0 → 0.2.0",
  tone: "ok",
  ...extra,
});

function activity(extra: Partial<ActivityPayload> = {}): ActivityPayload {
  return {
    now: NOW,
    sources: { app: true, reconciler: true },
    events: [
      event({}),
      event({ at: "2026-10-28T09:00:00Z", who: "app", kind: "remove", subject: "gone.lychee.land", href: null, outcome: "retired", tone: "neutral" }),
      event({ at: "2026-10-27T08:00:00Z", who: "app", kind: "add", subject: LONG, href: `/sites/${LONG}`, outcome: "added", tone: "neutral" }),
    ],
    ...extra,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let health: HealthPayload | null;
let act_: ActivityPayload | null;
let client: QueryClient;

beforeEach(() => {
  health = troubleHealth();
  act_ = activity();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/health")) return health ? json(200, { ok: true, ...health }) : json(500, { ok: false, reason: "boom" });
    if (url.startsWith("/api/activity")) return act_ ? json(200, { ok: true, ...act_ }) : json(500, { ok: false, reason: "audit gone" });
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

/** Primes each query the way a route loader would; a null leaves it to fetch (and fail). */
function mount(prime: { health?: HealthPayload | null; activity?: ActivityPayload | null } = {}): HTMLElement {
  // gcTime 0, as AppFrame's tests do: a primed query's collection timer would
  // otherwise outlive the test and keep the runner from exiting.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  const h = prime.health === undefined ? health : prime.health;
  const a = prime.activity === undefined ? act_ : prime.activity;
  if (h) client.setQueryData(HEALTH_QUERY.queryKey, h);
  if (a) client.setQueryData(ACTIVITY_QUERY.queryKey, a);
  const { container } = render(
    <QueryClientProvider client={client}>
      <OverviewPage />
    </QueryClientProvider>,
  );
  return container;
}

const cells = () => Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-strip] a"));
const chips = () => document.querySelectorAll("[data-strip] [data-count-bad], [data-strip] [data-count-unknown]");
const table = () => document.querySelector("table");
const bodyRows = () => Array.from(document.querySelectorAll("tbody tr"));

describe("OverviewPage", () => {
  test("title and heading", async () => {
    mount();
    assert.equal(document.title, "overview · lychee admin");
    assert.ok(screen.getByRole("heading", { name: "Overview" }));
  });

  test("four cells link to their pages, in rail order", () => {
    mount();
    assert.deepEqual(
      cells().map((a) => a.getAttribute("href")),
      ["/sites", "/services", "/reconciler", "/infrastructure"],
    );
  });

  test("all clear shows no attention block", () => {
    health = clearHealth();
    mount();
    assert.ok(!document.querySelector("[data-attention]"));
    assert.ok(!screen.queryByText(/need(s)? attention/));
  });

  test("bad rows first, then unknown under its subheading", () => {
    mount();
    const block = document.querySelector("[data-attention]");
    assert.ok(block, "no attention block");
    const headings = Array.from(block.querySelectorAll("h3")).map((h) => h.textContent);
    assert.deepEqual(headings, ["2 need attention", "1 couldn't be read"]);
    const rows = Array.from(block.querySelectorAll<HTMLAnchorElement>("a"));
    assert.deepEqual(
      rows.map((r) => r.children[1]?.textContent),
      ["api.lychee.land", "broken.lychee.land", "ntfy"],
    );
    assert.deepEqual(
      rows.map((r) => r.getAttribute("href")),
      ["/sites/api.lychee.land", "/sites/broken.lychee.land", "/services#service-ntfy"],
    );
    for (const r of rows) assert.match(r.firstElementChild?.className ?? "", /rounded-full/, "the pill is not first");
    assert.match(rows[0].firstElementChild!.textContent ?? "", /not responding/);
    assert.match(rows[0].firstElementChild!.className, /text-red-300/);
    assert.match(rows[2].firstElementChild!.className, /text-stone-300/);
    assert.equal(rows[2].lastElementChild?.textContent, "services");
  });

  test("a single bad row reads needs", () => {
    health = troubleHealth();
    health.sites = health.sites.filter((s) => s.hostname !== "broken.lychee.land");
    mount();
    assert.ok(screen.getByRole("heading", { name: "1 needs attention" }));
  });

  test("a failed health poll replaces the attention block and keeps the activity table (Review Focus 3)", async () => {
    health = null;
    mount({ health: null });
    await waitFor(() => assert.ok(screen.getByText("health unavailable")), TIMEOUT);
    assert.ok(table(), "the activity table went");
    assert.equal(bodyRows().length, 3);
    assert.equal(chips().length, 0, "the strip kept stale counts");
    assert.ok(!screen.queryByText(/need(s)? attention/));
    assert.equal(cells().length, 4);
  });

  test("a failed health re-read after a good one says when it last read", async () => {
    mount();
    assert.ok(chips().length > 0);
    health = null;
    await act(async () => {
      await client.refetchQueries({ queryKey: HEALTH_QUERY.queryKey });
    });
    await waitFor(() => assert.ok(screen.getByText(/^health unavailable · last read /)), TIMEOUT);
    assert.equal(chips().length, 0);
  });

  test("a failed activity re-read keeps the table under an alert and leaves the strip alone (Review Focus 3)", async () => {
    mount();
    const chipsBefore = chips().length;
    assert.ok(chipsBefore > 0);
    act_ = null;
    await act(async () => {
      await client.refetchQueries({ queryKey: ACTIVITY_QUERY.queryKey });
    });
    const alert = await screen.findByRole("alert", {}, TIMEOUT);
    assert.equal(alert.textContent, "Couldn't refresh activity: audit gone");
    assert.ok(table(), "the table was dropped");
    assert.equal(bodyRows().length, 3);
    assert.equal(chips().length, chipsBefore, "the strip changed");
    assert.ok(document.querySelector("[data-attention]"), "the attention block went");

    act_ = activity();
    await act(async () => {
      await client.refetchQueries({ queryKey: ACTIVITY_QUERY.queryKey });
    });
    await waitFor(() => assert.ok(!screen.queryByRole("alert")), TIMEOUT);
  });

  test("activity empty", () => {
    act_ = activity({ events: [] });
    mount();
    assert.ok(screen.getByText("Nothing recorded yet."));
    assert.ok(!table());
  });

  test("reconciler history unreadable", () => {
    act_ = activity({ sources: { app: true, reconciler: false } });
    mount();
    const line = screen.getByText("Reconciler history couldn't be read; showing app actions only.");
    const t = table();
    assert.ok(t);
    assert.ok(t.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING, "the line is not under the table");
  });

  test("audit log unreadable", () => {
    act_ = activity({ sources: { app: false, reconciler: true } });
    mount();
    assert.ok(screen.getByText("The audit log couldn't be read; showing reconciler events only."));
    assert.ok(table());
  });

  test("both unreadable", () => {
    act_ = activity({ events: [], sources: { app: false, reconciler: false } });
    mount();
    assert.ok(screen.getByText("Activity couldn't be read."));
    assert.ok(!table());
    assert.ok(!screen.queryByText(/showing/));
    assert.ok(!screen.queryByText("Nothing recorded yet."));
  });

  test("the table scrolls in its own box", () => {
    mount();
    assert.equal(table()?.parentElement?.className, ACTIVITY_SCROLL);
  });

  test("the table's header cells", () => {
    mount();
    assert.deepEqual(
      Array.from(document.querySelectorAll("thead th")).map((th) => th.textContent),
      ["when", "who", "kind", "subject", "outcome"],
    );
    assert.ok(screen.getByRole("heading", { name: "Recent activity" }));
  });

  test("the table is named by its heading", () => {
    mount();
    assert.ok(screen.getByRole("table", { name: "Recent activity" }));
  });

  test("an outcome carries its word and its tone class", () => {
    mount();
    const cell = screen.getByText("deployed 0.1.0 → 0.2.0");
    assert.match(cell.className, /text-green-300/);
  });

  test("a subject with no href is not a link", () => {
    mount();
    const subject = screen.getByText("gone.lychee.land");
    assert.equal(subject.tagName, "SPAN");
    assert.ok(!subject.closest("a"));
    assert.equal(screen.getAllByText("app.lychee.land").find((e) => e.closest("table"))?.tagName, "A");
  });

  test("a 63-character subject wraps inside its cell (Review Focus 5)", () => {
    mount();
    const subject = screen.getByText(LONG);
    assert.ok(subject.className.split(" ").includes("[overflow-wrap:anywhere]"));
  });

  test("the age is a time element with the exact time as its title", () => {
    mount();
    const times = Array.from(document.querySelectorAll("tbody time"));
    assert.equal(times.length, 3);
    const at = "2026-10-28T11:55:00.000Z";
    assert.equal(times[0].getAttribute("datetime"), at);
    assert.equal(times[0].getAttribute("title"), new Date(at).toLocaleString());
    assert.deepEqual(times.map((t) => t.textContent), ["5m", "3h", "1d"]);
  });

  test("outside the router it takes no focus", async () => {
    mount();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(document.activeElement === document.body);
  });

  test("the seeded health renders without throwing", () => {
    health = seedHealth();
    mount();
    assert.ok(document.querySelector("[data-attention]"));
  });
});
