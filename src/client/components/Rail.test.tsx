import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderRail, renderTopBar } from "../../views/rail";
import { RAIL_COUNT_BAD, RAIL_COUNT_ZERO, RAIL_DOT, attentionCounts } from "../../views/railModel";
import type { RailData } from "../../views/shell";
import type { HealthPayload } from "../../shared/health";
import { testShell } from "../../dev/testHelpers";
import { canonical } from "../test/canonical";
import { seedHealth } from "../test/healthFixture";
import { Navigation, Rail, TopBar } from "./Rail";

const setViewport = (width: number): void => {
  (globalThis as unknown as { happyDOM: { setViewport(v: { width: number }): void } }).happyDOM.setViewport({ width });
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  setViewport(1024);
});

const railData = (overrides: Partial<RailData> = {}): RailData => testShell(overrides).rail;

/** The server aside's inner markup: the island renders the aside's children, never the aside itself. */
function serverInner(rail: RailData): string {
  const template = document.createElement("template");
  template.innerHTML = renderRail(rail);
  const aside = template.content.querySelector("aside#rail");
  assert.ok(aside, "renderRail emitted no aside#rail");
  return aside.innerHTML;
}

function assertParity(rail: RailData): void {
  const client = renderToStaticMarkup(<Rail rail={rail} health={null} healthError={false} lastRead={null} />);
  assert.equal(canonical(client), canonical(serverInner(rail)));
}

const dotClass = (container: HTMLElement, hostname: string): string => {
  const dot = container.querySelector(`[data-site="${hostname}"] [data-dot]`);
  assert.ok(dot, `no dot for ${hostname}`);
  return dot.getAttribute("class") ?? "";
};

const count = (container: HTMLElement, name: string): Element | null => container.querySelector(`[data-count="${name}"]`);

describe("Rail parity with renderRail", () => {
  test("the seeded sites", () => {
    assertParity(railData());
  });

  test("an unreadable Caddyfile", () => {
    assertParity(railData({ sites: null }));
  });

  test("a missing inventory", () => {
    assertParity(railData({ hostAvailable: false }));
  });

  test("every current marker", () => {
    for (const current of [
      { page: "sites" },
      { page: "new" },
      { page: "services" },
      { page: "reconciler" },
      { page: "infrastructure" },
      { site: "api.lychee.land" },
    ] as RailData["current"][]) {
      assertParity(railData({ current }));
    }
  });

  test("the find box is a closed combobox in both renderers", () => {
    const rail = railData();
    const client = document.createElement("div");
    client.innerHTML = renderToStaticMarkup(<Rail rail={rail} health={null} healthError={false} lastRead={null} />);
    const server = document.createElement("div");
    server.innerHTML = serverInner(rail);
    for (const [side, root] of [
      ["client", client],
      ["server", server],
    ] as const) {
      const input = root.querySelector("#find");
      assert.ok(input, `${side}: no #find`);
      assert.equal(input.getAttribute("role"), "combobox", side);
      assert.equal(input.getAttribute("aria-expanded"), "false", side);
      assert.equal(input.getAttribute("aria-controls"), "find-list", side);
      assert.equal(input.getAttribute("aria-autocomplete"), "list", side);
      assert.equal(root.querySelector('[role="listbox"]'), null, `${side}: a closed box renders a list`);
    }
  });

  test("a mismatch is caught", () => {
    const client = renderToStaticMarkup(
      <Rail rail={railData({ current: { page: "new" } })} health={null} healthError={false} lastRead={null} />,
    );
    assert.notEqual(canonical(client), canonical(serverInner(railData())));
  });
});

describe("Rail with health", () => {
  test("a payload fills dots and counts, and zero counts stay quiet", () => {
    const { container } = render(<Rail rail={railData()} health={seedHealth()} healthError={false} lastRead={null} />);
    assert.equal(dotClass(container, "api.lychee.land"), RAIL_DOT.bad);
    assert.equal(dotClass(container, "app.lychee.land"), RAIL_DOT.ok);
    assert.equal(dotClass(container, "preview.lychee.land"), RAIL_DOT.neutral);
    assert.equal(dotClass(container, "blog.lychee.land"), RAIL_DOT.none);

    assert.equal(count(container, "sites")?.textContent, "2");
    assert.equal(count(container, "sites")?.getAttribute("class"), RAIL_COUNT_BAD);
    assert.equal(count(container, "service")?.textContent, "3");
    assert.equal(count(container, "service")?.getAttribute("class"), RAIL_COUNT_BAD);
    for (const zero of ["reconciler", "infrastructure"]) {
      assert.equal(count(container, zero)?.textContent, "0");
      assert.equal(count(container, zero)?.getAttribute("class"), RAIL_COUNT_ZERO);
    }
  });

  test("a dot's status is spoken, since its colour is not", () => {
    const { container } = render(<Rail rail={railData()} health={seedHealth()} healthError={false} lastRead={null} />);
    const row = container.querySelector('[data-site="api.lychee.land"]');
    assert.match(row?.textContent ?? "", /not responding/);
  });

  test("an errored poll shows no remembered green: neutral dots, no counts, the unavailable line", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    const lastRead = new Date(now.getTime() - 2 * 60_000).toISOString();
    const { container } = render(
      <Rail rail={railData()} health={seedHealth()} healthError={true} lastRead={lastRead} now={now} />,
    );
    for (const host of ["api.lychee.land", "app.lychee.land", "preview.lychee.land", "broken.lychee.land", "legacy.lychee.land"]) {
      assert.equal(dotClass(container, host), RAIL_DOT.neutral, `${host} is not neutral`);
    }
    for (const host of ["lychee.land", "blog.lychee.land"]) {
      assert.equal(dotClass(container, host), RAIL_DOT.none, `static ${host} is not hollow`);
    }
    for (const name of ["sites", "service", "reconciler", "infrastructure"]) {
      assert.equal(count(container, name)?.textContent, "", `${name} still shows a count`);
    }
    assert.match(container.textContent ?? "", /health unavailable · last read 2 minutes ago/);
    assert.doesNotMatch(container.textContent ?? "", /not responding/);
  });

  test("an errored poll before any read says only that health is unavailable", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={true} lastRead={null} />);
    assert.match(container.textContent ?? "", /health unavailable/);
    assert.doesNotMatch(container.textContent ?? "", /last read/);
    assert.equal(dotClass(container, "api.lychee.land"), RAIL_DOT.neutral);
  });

  test("the rail's list wins where the payload disagrees", () => {
    const health: HealthPayload = seedHealth();
    health.sites = health.sites.filter((s) => s.hostname !== "legacy.lychee.land");
    health.sites.push({ hostname: "removed.lychee.land", tone: "bad", label: "failed", attention: true });
    const { container } = render(<Rail rail={railData()} health={health} healthError={false} lastRead={null} />);
    assert.equal(dotClass(container, "legacy.lychee.land"), RAIL_DOT.none);
    assert.equal(container.querySelector('[data-site="removed.lychee.land"]'), null);
    assert.equal(container.querySelectorAll("[data-site]").length, 8);
    // The unlisted entry is ignored by the count as well: only the seed's two listed sites need attention.
    assert.equal(count(container, "sites")?.textContent, "2");
  });

  test("units unavailable: the sites count shows and the host counts are absent", () => {
    const health: HealthPayload = { ...seedHealth(), units: null };
    const { container } = render(<Rail rail={railData()} health={health} healthError={false} lastRead={null} />);
    assert.equal(count(container, "sites")?.textContent, "2");
    for (const name of ["service", "reconciler", "infrastructure"]) {
      assert.equal(count(container, name)?.textContent ?? "", "", `${name} shows a count`);
    }
  });

  test("the find hint is the one it is given", () => {
    const { container } = render(
      <Rail rail={railData()} health={null} healthError={false} lastRead={null} findHint="Ctrl K" />,
    );
    assert.equal(container.querySelector("[data-find-hint]")?.textContent, "Ctrl K");
  });

  // Task 3 broke a hostname that fits mid-word; it wraps only when it cannot fit.
  test("a hostname wraps only where it cannot fit, as the server's does", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} lastRead={null} />);
    const name = container.querySelector('[data-site="preview.lychee.land"] .min-w-0');
    assert.equal(name?.getAttribute("class"), "min-w-0 [overflow-wrap:anywhere]");
  });
});

/** The server top bar's inner markup: the island renders the header's children, never the header itself. */
function serverTopBarInner(): string {
  const template = document.createElement("template");
  template.innerHTML = renderTopBar();
  const header = template.content.querySelector("header#top-bar");
  assert.ok(header, "renderTopBar emitted no header#top-bar");
  return header.innerHTML;
}

describe("TopBar parity with renderTopBar", () => {
  test("before any health, React's top bar is the server's", () => {
    const client = renderToStaticMarkup(<TopBar health={null} healthError={false} hostnames={[]} onOpen={() => {}} />);
    assert.equal(canonical(client), canonical(serverTopBarInner()));
  });

  test("an errored poll renders the server's empty count slot", () => {
    const client = renderToStaticMarkup(<TopBar health={seedHealth()} healthError={true} hostnames={[]} onOpen={() => {}} />);
    assert.equal(canonical(client), canonical(serverTopBarInner()));
  });
});

/**
 * Server markup as layout() emits it (top bar, then the rail), with the
 * navigation mounted the way the island mounts it: onto the aside, with the
 * top bar taken over through a portal.
 */
function mountNavigation(health: HealthPayload | null = seedHealth(), healthError = false) {
  const rail = railData({ current: { page: "sites" } });
  document.body.innerHTML = `<textarea id="elsewhere"></textarea>${renderTopBar()}${renderRail(rail)}`;
  const aside = document.querySelector<HTMLElement>("aside#rail");
  const header = document.querySelector<HTMLElement>("header#top-bar");
  assert.ok(aside && header);
  const visits: string[] = [];
  render(
    <Navigation
      rail={rail}
      health={health}
      healthError={healthError}
      lastRead={null}
      topBar={header}
      navigate={(href) => visits.push(href)}
    />,
    { container: aside },
  );
  return { aside, header, visits };
}

const drawer = (): HTMLDialogElement | null => document.querySelector("dialog");
const finds = (): NodeListOf<HTMLInputElement> => document.querySelectorAll<HTMLInputElement>("#find");

function click(el: Element | null, init: MouseEventInit = {}): void {
  assert.ok(el, "nothing to click");
  act(() => {
    fireEvent.click(el, init);
  });
}

function press(target: Element | Document, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

/** The drawer's box, which happy-dom does not lay out: 280px wide, full height. */
function stubDrawerBox(dialog: HTMLDialogElement): void {
  dialog.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 280, bottom: 800, width: 280, height: 800, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe("the top bar and its drawer", () => {
  test("the island's top bar replaces the server's: one wordmark, one menu button", () => {
    const { header } = mountNavigation(null);
    assert.equal(header.querySelectorAll("h1").length, 1);
    assert.equal(header.querySelectorAll("#rail-menu").length, 1);
    assert.equal(header.querySelectorAll("#rail-find").length, 1);
  });

  test("the overall count is the sum of the attention counts", () => {
    const { header } = mountNavigation(seedHealth());
    const counts = attentionCounts(seedHealth(), railData().sites?.map((x) => x.hostname) ?? []);
    const sum = counts.sites + (counts.service ?? 0) + (counts.reconciler ?? 0) + (counts.infrastructure ?? 0);
    assert.equal(sum, 5);
    const slot = header.querySelector('[data-count="all"]');
    assert.equal(slot?.firstChild?.textContent, String(sum));
    assert.equal(slot?.getAttribute("class"), RAIL_COUNT_BAD);
  });

  test("an errored poll empties the overall count", () => {
    const { header } = mountNavigation(seedHealth(), true);
    assert.equal(header.querySelector('[data-count="all"]')?.textContent, "");
  });

  test("the menu button opens a modal dialog holding the rail's site rows", () => {
    const { aside } = mountNavigation();
    assert.equal(drawer(), null);
    click(document.querySelector("#rail-menu"));
    const dialog = drawer();
    assert.ok(dialog, "no dialog");
    assert.equal(dialog.open, true);
    assert.equal(dialog.querySelectorAll("[data-site]").length, 8);
    // The rail moved into the drawer: one find box, inside the dialog.
    assert.equal(finds().length, 1);
    assert.ok(dialog.contains(finds()[0] ?? null));
    assert.equal(aside.querySelector("[data-site]"), null);
  });

  test("Escape closes the drawer, puts the rail back and returns focus to the menu button", () => {
    const { aside } = mountNavigation();
    const menu = document.querySelector<HTMLElement>("#rail-menu");
    act(() => menu?.focus());
    click(menu);
    const dialog = drawer();
    assert.ok(dialog);
    press(dialog, "Escape");
    assert.equal(drawer(), null);
    assert.equal(finds().length, 1);
    assert.ok(aside.contains(finds()[0] ?? null));
    assert.equal(aside.querySelectorAll("[data-site]").length, 8);
    assert.equal(document.activeElement, document.querySelector("#rail-menu"));
  });

  test("a native close that skips cancel puts the rail back and leaves the menu button working", () => {
    const { aside } = mountNavigation();
    const menu = document.querySelector<HTMLElement>("#rail-menu");
    act(() => menu?.focus());
    click(menu);
    const dialog = drawer();
    assert.ok(dialog);
    act(() => dialog.close());
    assert.ok(drawer() === null, "the dialog stayed mounted after a native close");
    assert.ok(aside.contains(finds()[0] ?? null));
    assert.equal(aside.querySelectorAll("[data-site]").length, 8);
    assert.equal(document.activeElement, document.querySelector("#rail-menu"));
    click(document.querySelector("#rail-menu"));
    assert.ok(drawer()?.open, "the menu button no longer opens the drawer");
  });

  test("a click on the backdrop closes the drawer; a click inside it does not", () => {
    mountNavigation();
    click(document.querySelector("#rail-menu"));
    const dialog = drawer();
    assert.ok(dialog);
    stubDrawerBox(dialog);
    click(dialog, { clientX: 120, clientY: 300 });
    assert.ok(drawer(), "a click inside closed the drawer");
    click(dialog, { clientX: 340, clientY: 300 });
    assert.equal(drawer(), null);
  });

  test("the find button opens the drawer with find focused and open", () => {
    mountNavigation();
    click(document.querySelector("#rail-find"));
    const dialog = drawer();
    assert.ok(dialog);
    const input = finds()[0];
    assert.ok(input && dialog.contains(input));
    assert.equal(document.activeElement, input);
    assert.equal(input.getAttribute("aria-expanded"), "true");
  });

  test("below 900px ⌘K opens the drawer on find; Esc closes find, a second Esc the drawer, and focus goes back", () => {
    setViewport(390);
    mountNavigation();
    const elsewhere = document.querySelector<HTMLTextAreaElement>("#elsewhere");
    assert.ok(elsewhere);
    act(() => elsewhere.focus());
    press(elsewhere, "k", { metaKey: true });

    const dialog = drawer();
    assert.ok(dialog, "⌘K did not open the drawer");
    const input = finds()[0];
    assert.ok(input && dialog.contains(input));
    assert.equal(document.activeElement, input);
    assert.equal(input.getAttribute("aria-expanded"), "true");

    press(input, "Escape");
    assert.ok(drawer(), "the first Esc closed the drawer");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, input, "find lost focus inside the drawer");

    press(input, "Escape");
    assert.equal(drawer(), null);
    assert.equal(document.activeElement, elsewhere);
  });

  test("from 900px ⌘K focuses the rail's own find box and opens no drawer", () => {
    setViewport(1280);
    const { aside } = mountNavigation();
    const elsewhere = document.querySelector<HTMLTextAreaElement>("#elsewhere");
    assert.ok(elsewhere);
    act(() => elsewhere.focus());
    press(elsewhere, "k", { metaKey: true });
    assert.equal(drawer(), null);
    assert.equal(document.activeElement, aside.querySelector("#find"));
  });

  test("keeps exactly one document keydown listener through opening and closing the drawer", () => {
    const live = new Set<EventListenerOrEventListenerObject>();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    let peak = 0;
    document.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "keydown") live.add(fn);
      peak = Math.max(peak, live.size);
      add(type, fn, opts as AddEventListenerOptions);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "keydown") live.delete(fn);
      remove(type, fn, opts as EventListenerOptions);
    }) as typeof document.removeEventListener;
    try {
      mountNavigation();
      assert.equal(live.size, 1);
      click(document.querySelector("#rail-menu"));
      assert.equal(live.size, 1);
      const dialog = drawer();
      assert.ok(dialog);
      press(dialog, "Escape");
      assert.equal(live.size, 1);
      assert.equal(peak, 1);
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
  });
});
