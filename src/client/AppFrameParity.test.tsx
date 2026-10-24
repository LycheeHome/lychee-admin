import "./test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import type { RailPayload } from "../shared/rail";
import type { SiteDetailPayload } from "../shared/siteDetail";
import { SEEDED_RAIL_SITES, seedSiteDetailPayload } from "../dev/testHelpers";
import type { RailCurrent, RailData } from "../shared/rail";
import { RAIL_QUERY_KEY, siteDetailQueryKey } from "./api";
import type { InitialNotice } from "./AppFrame";
import { Navigation } from "./components/Rail";
import { canonical } from "./test/canonical";
import { FrameLayout } from "./test/frameHarness";

/*
 * AppFrame against the server shell it replaced. Each fixture in
 * src/dev/fixtures/shell/ is that shell's body for one page type, from just
 * after <body> to the React mount point: the last output of the retired
 * renderer, generated from it and checked byte-equal to it before it was
 * deleted, and never regenerated, since there is nothing left to generate
 * them from. The React side is AppFrame, health-free, at that page's path,
 * fed the same rail data and the same notice, with the server's empty
 * #app-root as its children, so only the frame is compared.
 *
 * Normalisation, and the only one besides unwrapping the test container:
 * the shell wrote `<script type="application/json" id="rail-data">` beside
 * the aside, the server rail's data for the retired island, which AppFrame
 * replaces with GET /api/rail and does not render. On the fixture side only,
 * the script must occur exactly once; its JSON's `sites`, `hostAvailable`
 * and `domain` must deep-equal the RailPayload this test hands AppFrame, and
 * its `current` the rail item this path marks; only then is that one element
 * removed before comparing. So the fixture's data and the React side's input
 * are provably the same.
 *
 * Both sides compare under canonical() and canonical({ inlineWhitespace }).
 * The ⌘K hint is the server's on an Apple platform, so navigator.platform is
 * stubbed to one.
 */

const FIXTURES = path.join(__dirname, "..", "dev", "fixtures");
const seen = new Set<string>();
function fixture(dir: "shell" | "rail", name: string): string {
  seen.add(`${dir}/${name}.html`);
  return readFileSync(path.join(FIXTURES, dir, `${name}.html`), "utf8");
}

const SEED_RAIL: RailPayload = {
  sites: SEEDED_RAIL_SITES.map((s) => ({ ...s })),
  hostAvailable: true,
  domain: "lychee.land",
};

const removed = "blog.lychee.land";

interface ShellCase {
  path: string;
  /** The rail item the path marks, as the server's rail data records it. */
  current: RailCurrent;
  page: string;
  rail?: Partial<RailPayload>;
  notice?: InitialNotice;
  /** The site whose page payload a created notice is drawn from. */
  site?: string;
}

const SHELL_CASES: Record<string, ShellCase> = {
  sites: { path: "/", current: { page: "sites" }, page: "sites" },
  "sites-removed": { path: "/", current: { page: "sites" }, page: "sites", notice: { kind: "removed", host: removed } },
  services: { path: "/services", current: { page: "services" }, page: "services" },
  reconciler: { path: "/reconciler", current: { page: "reconciler" }, page: "reconciler" },
  infrastructure: { path: "/infrastructure", current: { page: "infrastructure" }, page: "infrastructure" },
  "site-static": { path: "/sites/blog.lychee.land", current: { site: "blog.lychee.land" }, page: "site" },
  "site-static-created": {
    path: "/sites/blog.lychee.land",
    current: { site: "blog.lychee.land" },
    page: "site",
    notice: { kind: "created" },
    site: "blog.lychee.land",
  },
  "site-next-created": {
    path: "/sites/app.lychee.land",
    current: { site: "app.lychee.land" },
    page: "site",
    notice: { kind: "created" },
    site: "app.lychee.land",
  },
  "add-site": { path: "/sites/new", current: null, page: "add-site" },
  "site-unknown": { path: "/sites/unknown.lychee.land", current: null, page: "site" },
  "caddyfile-unreadable": { path: "/", current: { page: "sites" }, page: "sites", rail: { sites: null } },
  "inventory-unavailable": { path: "/services", current: { page: "services" }, page: "services", rail: { hostAvailable: false } },
};

const details = new Map<string, Extract<SiteDetailPayload, { caddyfileError: null }>>();
const originalFetch = globalThis.fetch;
let client: QueryClient | null = null;

before(async () => {
  for (const host of ["blog.lychee.land", "app.lychee.land"]) details.set(host, (await seedSiteDetailPayload(host)).payload);
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
  // Health never answers: the frame is compared in its health-free state.
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
});

after(() => {
  delete (navigator as unknown as Record<string, unknown>).platform;
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  cleanup();
  client?.clear();
  client = null;
});

const RAIL_DATA = /<script type="application\/json" id="rail-data">([\s\S]*?)<\/script>/g;

/** The fixture, with its rail-data script checked against the React side's input and then removed. */
function serverFrame(name: string, payload: RailPayload, current: RailCurrent): string {
  const html = fixture("shell", name);
  const scripts = Array.from(html.matchAll(RAIL_DATA));
  assert.equal(scripts.length, 1, `${name}: expected exactly one #rail-data script`);
  const data = JSON.parse(scripts[0]![1]!) as RailData;
  assert.deepEqual(
    { sites: data.sites, hostAvailable: data.hostAvailable, domain: data.domain },
    payload,
    `${name}: the fixture's rail data is not the payload AppFrame was given`,
  );
  assert.deepEqual(data.current, current, `${name}: the fixture's current is not this path's`);
  return html.replace(RAIL_DATA, "");
}

/**
 * Equal under both canonical modes. Reported as the first point of
 * divergence with some context either side, not assert.equal's diff: the
 * whole frame is one ~10KB line, and diffing it stalls the runner.
 */
function assertSame(client: string, server: string): void {
  for (const options of [{}, { inlineWhitespace: true }]) {
    const a = canonical(client, options);
    const b = canonical(server, options);
    if (a === b) continue;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    const at = (s: string) => s.slice(Math.max(0, i - 200), i + 200);
    assert.fail(`differs at ${i} (${JSON.stringify(options)})\n  react:  …${at(a)}…\n  server: …${at(b)}…`);
  }
}

function clientFrame(c: ShellCase, payload: RailPayload): string {
  // Queries' gcTime 0 too: health's read never answers here, and clear()
  // cancelling it schedules a fresh 5-minute gc timer as the cancelled fetch
  // settles, which would hold the runner open.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } } });
  client.setQueryData(RAIL_QUERY_KEY, payload);
  if (c.site) client.setQueryData(siteDetailQueryKey(c.site), { found: true, payload: details.get(c.site) });
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <FrameLayout notice={c.notice ?? null}>
            <div id="app-root" className="contents" data-page={c.page} />
          </FrameLayout>
        ),
      },
    ],
    { initialEntries: [c.path] },
  );
  let container: HTMLElement | null = null;
  act(() => {
    container = render(
      <QueryClientProvider client={client as QueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ).container;
  });
  return (container as HTMLElement | null)?.innerHTML ?? "";
}

describe("AppFrame parity with the frozen server shell", () => {
  for (const [name, c] of Object.entries(SHELL_CASES)) {
    test(name, () => {
      const payload: RailPayload = { ...SEED_RAIL, ...c.rail };
      const server = serverFrame(name, payload, c.current);
      const client = clientFrame(c, payload);
      assertSame(client, server);
    });
  }
});

const RAIL_CASES: Record<string, Partial<RailData>> = {
  "seeded-sites": {},
  "unreadable-caddyfile": { sites: null },
  "missing-inventory": { hostAvailable: false },
  "current-page-sites": { current: { page: "sites" } },
  "current-page-services": { current: { page: "services" } },
  "current-page-reconciler": { current: { page: "reconciler" } },
  "current-page-infrastructure": { current: { page: "infrastructure" } },
  "current-site-api": { current: { site: "api.lychee.land" } },
  "current-site-broken": { current: { site: "broken.lychee.land" } },
  "no-current": { current: null },
  "long-hostname": { sites: [{ hostname: `${"a".repeat(63)}.lychee.land`, hint: "static" }] },
  "escaped-hostname": { sites: [{ hostname: `x"><b>.lychee.land`, hint: "static" }] },
};

/** The frame's own top bar and aside, health-free and outside any router (plain anchors, the rail's own `current`). */
function navigation(rail: RailData): HTMLElement {
  let container: HTMLElement | null = null;
  act(() => {
    container = render(<Navigation rail={rail} health={null} healthError={false} lastRead={null} />).container;
  });
  return container as unknown as HTMLElement;
}

// src/dev/fixtures/rail/ is the retired server rail's output, frozen the same
// way as the shell fixtures: the whole aside per case, and the top bar.
describe("the frame's rail parity with the frozen server rail", () => {
  for (const [name, overrides] of Object.entries(RAIL_CASES)) {
    test(name, () => {
      const rail: RailData = { ...SEED_RAIL, sites: SEED_RAIL.sites!.map((s) => ({ ...s })), current: null, ...overrides };
      const aside = navigation(rail).querySelector("aside#rail");
      assert.ok(aside, "no aside#rail");
      assertSame(aside.outerHTML, fixture("rail", name));
    });
  }

  test("top-bar", () => {
    const rail: RailData = { ...SEED_RAIL, current: null };
    const header = navigation(rail).querySelector("header#top-bar");
    assert.ok(header, "no header#top-bar");
    assertSame(header.outerHTML, fixture("rail", "top-bar"));
  });
});

describe("the fixtures", () => {
  test("every shell and rail fixture was read", () => {
    const onDisk = (["shell", "rail"] as const).flatMap((dir) =>
      readdirSync(path.join(FIXTURES, dir))
        .filter((f) => f.endsWith(".html"))
        .map((f) => `${dir}/${f}`),
    );
    assert.deepEqual(onDisk.filter((f) => !seen.has(f)).sort(), []);
    assert.equal(onDisk.length, 25);
  });
});
