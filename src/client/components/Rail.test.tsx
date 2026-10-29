import "../test/setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { MENU_BADGE, RAIL_SIGNAL_COUNT, RAIL_SIGNAL_DOT } from "../../views/overviewModel";
import { BUTTON_PRIMARY, FOCUS_RING } from "../../views/shared";
import { ClientNavContext } from "../clientNav";
import type { RailData } from "../../shared/rail";
import type { HealthPayload } from "../../shared/health";
import { SEEDED_RAIL_SITES } from "../../dev/testHelpers";
import { canonical } from "../test/canonical";
import { applyRedesigns } from "../test/redesigns";
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

/** The seeded sites, a readable inventory and no current item, each overridable. */
const railData = (overrides: Partial<RailData> = {}): RailData => ({
  sites: SEEDED_RAIL_SITES.map((s) => ({ ...s })),
  hostAvailable: true,
  current: null,
  domain: "lychee.land",
  ...overrides,
});

/*
 * The retired server rail's output, frozen in src/dev/fixtures/rail/ (the
 * whole aside per case, and the top bar); AppFrameParity.test.tsx reads every
 * one of them and checks none goes unread. Rail renders the aside's children
 * and TopBar the header's, so each is compared with the fixture's inner markup.
 */
const RAIL_FIXTURES = path.join(__dirname, "..", "..", "dev", "fixtures", "rail");

function fixtureInner(name: string, selector: string): string {
  const template = document.createElement("template");
  template.innerHTML = applyRedesigns(readFileSync(path.join(RAIL_FIXTURES, `${name}.html`), "utf8"));
  const root = template.content.querySelector(selector);
  assert.ok(root, `${name}.html has no ${selector}`);
  return root.innerHTML;
}

/** The server aside's inner markup for a rail fixture. */
const serverInner = (name: string): string => fixtureInner(name, "aside#rail");

function assertParity(rail: RailData, name: string): void {
  const client = renderToStaticMarkup(<Rail rail={rail} health={null} healthError={false} />);
  assert.equal(canonical(client), canonical(serverInner(name)), name);
}

/** The seed's health (5 bad: two sites, three services) plus `unknown` units that could not be read. */
function healthWith(unknown: number, bad = true): HealthPayload {
  const h = seedHealth();
  const base = (h.units ?? [])[0]!;
  const units = bad
    ? [...(h.units ?? [])]
    : (h.units ?? []).map((u) => ({ ...u, tone: "ok" as const, label: "running", attention: false, trouble: null }));
  for (let i = 0; i < unknown; i++) {
    units.push({ ...base, name: `unread-${i}`, tone: "neutral", label: "unknown", attention: false, trouble: null });
  }
  const sites = bad ? h.sites : h.sites.map((s) => (s.attention ? { ...s, tone: "ok" as const, label: "running", attention: false } : s));
  return { ...h, sites, units };
}

/** Nothing bad and nothing unread. */
const cleanHealth = (): HealthPayload => healthWith(0, false);

/** What a screen reader hears for `el`: its text, less anything aria-hidden. */
function accessibleName(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const hidden of Array.from(copy.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
  return copy.textContent ?? "";
}

/** The rail's overview row. */
const overviewRow = (root: ParentNode): HTMLAnchorElement => {
  const row = root.querySelector<HTMLAnchorElement>('nav[aria-label="Overview"] > a');
  assert.ok(row, "no overview row");
  return row;
};

describe("Rail parity with the frozen server rail", () => {
  test("the seeded sites", () => {
    assertParity(railData(), "seeded-sites");
  });

  test("an unreadable Caddyfile", () => {
    assertParity(railData({ sites: null }), "unreadable-caddyfile");
  });

  test("a missing inventory", () => {
    assertParity(railData({ hostAvailable: false }), "missing-inventory");
  });

  test("every current marker", () => {
    for (const [current, name] of [
      [{ page: "sites" }, "current-page-sites"],
      [{ page: "services" }, "current-page-services"],
      [{ page: "reconciler" }, "current-page-reconciler"],
      [{ page: "infrastructure" }, "current-page-infrastructure"],
      [{ site: "api.lychee.land" }, "current-site-api"],
      [{ site: "broken.lychee.land" }, "current-site-broken"],
      [null, "no-current"],
    ] as Array<[RailData["current"], string]>) {
      assertParity(railData({ current }), name);
    }
  });

  test("the find box is a closed combobox, in React and in the frozen rail", () => {
    const rail = railData();
    const client = document.createElement("div");
    client.innerHTML = renderToStaticMarkup(<Rail rail={rail} health={null} healthError={false} />);
    const server = document.createElement("div");
    server.innerHTML = serverInner("seeded-sites");
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
      <Rail rail={railData({ current: { site: "api.lychee.land" } })} health={null} healthError={false} />,
    );
    assert.notEqual(canonical(client), canonical(serverInner("seeded-sites")));
  });

  // Moved from the retired src/views/shell.test.ts ("the rail's current row
  // states its port at readable contrast"), carried over from the breadcrumb
  // dropdown the rail replaced: stone-400 on the highlighted (stone-700) row
  // measured 3.98:1; stone-300 clears 4.5:1. Anchored to the current row
  // itself, since every row uses the same hint span.
  test("the current row states its port at readable contrast", () => {
    const { container } = render(
      <Rail rail={railData({ current: { site: "app.lychee.land" } })} health={null} healthError={false} />,
    );
    const rows = container.querySelectorAll('a[aria-current="page"]');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.getAttribute("data-site"), "app.lychee.land");
    const hint = Array.from(rows[0]?.querySelectorAll("span") ?? []).find((s) => s.textContent === ":3200");
    assert.equal(hint?.getAttribute("class"), "ml-auto shrink-0 text-[0.72rem] text-stone-300");
  });

  // Moved from the retired src/views/rail.test.ts, which held it of the
  // server rail; carried over from the breadcrumb dropdown the rail replaced.
  test("never truncates a hostname, and never dims a row below Smoke", () => {
    const html = renderToStaticMarkup(<Rail rail={railData()} health={seedHealth()} healthError={false} />);
    const rows = html.match(/<ul[\s\S]*?<\/ul>/)?.[0] ?? "";
    assert.ok(rows.includes("data-site="), "no site rows");
    assert.doesNotMatch(rows, /truncate/);
    assert.doesNotMatch(rows, /text-stone-500/);
  });
});

describe("Rail with health", () => {
  // The rail is navigation plus one whole-host signal, on overview (spec
  // 2026-10-28-overview-page): no row or host link carries a mark of its own.
  test("site rows carry no dot", () => {
    for (const [health, healthError] of [
      [null, false],
      [seedHealth(), false],
      [healthWith(3), false],
      [cleanHealth(), false],
      [seedHealth(), true],
      [null, true],
    ] as Array<[HealthPayload | null, boolean]>) {
      const { container, unmount } = render(<Rail rail={railData()} health={health} healthError={healthError} />);
      assert.equal(container.querySelectorAll("[data-site]").length, 8);
      // By identity: assert.equal on a DOM node stalls the runner printing it.
      assert.ok(container.querySelector("[data-dot]") === null, "a site row carries a dot");
      unmount();
    }
  });

  test("host links carry no count", () => {
    for (const healthError of [false, true]) {
      const { container, unmount } = render(<Rail rail={railData()} health={healthWith(3)} healthError={healthError} />);
      assert.ok(container.querySelector("[data-count]") === null, "a count slot");
      assert.ok(container.querySelector("[data-health-unavailable]") === null, "the unavailable line");
      for (const label of ["services", "reconciler", "infrastructure"]) {
        assert.equal(container.querySelector(`a[href="/${label}"]`)?.textContent, label);
      }
      unmount();
    }
  });

  test("overview sits above sites and links to /", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const navs = Array.from(container.querySelectorAll("nav")).map((n) => n.getAttribute("aria-label"));
    assert.deepEqual(navs, ["Overview", "Sites", "Host"]);
    const row = overviewRow(container);
    assert.equal(row.getAttribute("href"), "/");
    assert.equal(row.textContent, "overview");
  });

  test("sites links to /sites", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const heading = container.querySelector('nav[aria-label="Sites"] > a');
    assert.equal(heading?.getAttribute("href"), "/sites");
  });

  test("before the first answer the overview row has no signal", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    assert.ok(container.querySelector("[data-signal]") === null, "a signal before any answer");
    assert.equal(accessibleName(overviewRow(container)), "overview");
  });

  test("bad: a Scorch dot and the bad count, spoken as need attention", () => {
    const { container } = render(<Rail rail={railData()} health={healthWith(3)} healthError={false} />);
    const signal = overviewRow(container).querySelector("[data-signal]");
    assert.ok(signal);
    assert.equal(signal.getAttribute("aria-hidden"), "true");
    assert.equal(signal.textContent, "5");
    assert.equal(signal.querySelector(".bg-red-300")?.getAttribute("class"), RAIL_SIGNAL_DOT.bad);
    assert.equal(signal.querySelector(".font-mono")?.getAttribute("class"), RAIL_SIGNAL_COUNT.bad);
    assert.equal(accessibleName(overviewRow(container)), "overview, 5 need attention");
    // The signal is the overview row's alone: nothing else in the rail is marked.
    assert.equal(container.querySelectorAll("[data-signal]").length, 1);
  });

  test("unknown only: a neutral dot and the unknown count", () => {
    const { container } = render(<Rail rail={railData()} health={healthWith(3, false)} healthError={false} />);
    const signal = overviewRow(container).querySelector("[data-signal]");
    assert.ok(signal);
    assert.equal(signal.textContent, "3");
    assert.equal(signal.querySelector(".bg-stone-400")?.getAttribute("class"), RAIL_SIGNAL_DOT.neutral);
    assert.equal(signal.querySelector(".font-mono")?.getAttribute("class"), RAIL_SIGNAL_COUNT.neutral);
    assert.equal(accessibleName(overviewRow(container)), "overview, 3 couldn't be read");
  });

  test("clean: nothing", () => {
    const { container } = render(<Rail rail={railData()} health={cleanHealth()} healthError={false} />);
    assert.ok(container.querySelector("[data-signal]") === null, "a signal over nothing");
    assert.equal(accessibleName(overviewRow(container)), "overview");
  });

  test("a failed poll: a neutral dot and no number, even with old data", () => {
    for (const health of [healthWith(3), null]) {
      const { container, unmount } = render(<Rail rail={railData()} health={health} healthError={true} />);
      const signal = overviewRow(container).querySelector("[data-signal]");
      assert.ok(signal);
      assert.equal(signal.querySelector("span")?.getAttribute("class"), RAIL_SIGNAL_DOT.neutral);
      assert.ok(signal.querySelector(".bg-red-300") === null, "a remembered Scorch");
      assert.doesNotMatch(signal.textContent ?? "", /\d/);
      assert.equal(accessibleName(overviewRow(container)), "overview, health unavailable");
      unmount();
    }
  });

  test("overview is current on /, activity on /activity, sites on /sites", () => {
    for (const [pathname, href] of [
      ["/", "/"],
      ["/activity", "/activity"],
      ["/sites", "/sites"],
    ] as const) {
      const { container, unmount } = render(
        <MemoryRouter initialEntries={[pathname]}>
          <ClientNavContext.Provider value={{ pathname, locationKey: "k", navigate: () => {}, documentLoad: true }}>
            <Rail rail={railData()} health={null} healthError={false} />
          </ClientNavContext.Provider>
        </MemoryRouter>,
      );
      const current = Array.from(container.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute("href"));
      assert.deepEqual(current, [href], pathname);
      unmount();
    }
  });

  test("an activity row follows overview as a plain router link with no mark", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <ClientNavContext.Provider value={{ pathname: "/", locationKey: "k", navigate: () => {}, documentLoad: true }}>
          <Rail rail={railData()} health={seedHealth()} healthError={false} />
        </ClientNavContext.Provider>
      </MemoryRouter>,
    );
    const links = Array.from(container.querySelectorAll('nav[aria-label="Overview"] > a'));
    assert.deepEqual(links.map((a) => a.getAttribute("href")), ["/", "/activity"]);
    assert.equal(links[1]?.textContent, "activity");
    assert.equal(links[1]?.children.length, 0, "the activity row carries a mark");
  });

  test("the find hint is the one it is given", () => {
    const { container } = render(
      <Rail rail={railData()} health={null} healthError={false} findHint="Ctrl K" />,
    );
    assert.equal(container.querySelector("[data-find-hint]")?.textContent, "Ctrl K");
  });

  // Task 3 broke a hostname that fits mid-word; it wraps only when it cannot fit.
  test("a hostname wraps only where it cannot fit, as the server's does", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const name = container.querySelector('[data-site="preview.lychee.land"] .min-w-0');
    assert.equal(name?.getAttribute("class"), "min-w-0 [overflow-wrap:anywhere]");
  });
});

// A row shows the label alone (critique 2026-10-26 minors, "01 Label only"),
// and since 2026-10-29 the heading no longer names the domain either. The
// full hostname stays the row's text for assistive tech, as sr-only text, so
// its name is unchanged.
describe("rail rows show the label only", () => {
  const rowOf = (container: HTMLElement, hostname: string): HTMLElement => {
    const row = container.querySelector<HTMLElement>(`[data-site="${hostname}"]`);
    assert.ok(row, `no row for ${hostname}`);
    return row;
  };

  test("a subdomain's row shows its label, with the domain as screen-reader text", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const row = rowOf(container, "preview.lychee.land");
    const name = row.querySelector(".min-w-0");
    assert.equal(name?.querySelector(".text-stone-50")?.textContent, "preview");
    const domain = name?.querySelector(".sr-only");
    assert.equal(domain?.textContent, ".lychee.land");
    assert.equal(name?.querySelector("wbr"), null, "nothing visible is left to wrap at");
    assert.ok(row.textContent?.startsWith("preview.lychee.land, :3100"), row.textContent ?? "");
  });

  test("the apex row shows the whole name and hides nothing", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const name = rowOf(container, "lychee.land").querySelector(".min-w-0");
    assert.equal(name?.textContent, "lychee.land");
    assert.equal(name?.querySelector(".sr-only"), null);
  });

  test("the sites heading is the word alone, with no domain beside it", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const heading = container.querySelector('nav[aria-label="Sites"] > a[href="/sites"]');
    assert.ok(heading);
    assert.equal(heading.textContent, "sites");
    assert.equal(heading.querySelector("[data-rail-domain]"), null);
  });
});

/** The frozen server top bar's inner markup: TopBar renders the header's children. */
const serverTopBarInner = (): string => fixtureInner("top-bar", "header#top-bar");

describe("TopBar parity with the frozen server top bar", () => {
  test("before any health, React's top bar is the server's", () => {
    const client = renderToStaticMarkup(<TopBar health={null} healthError={false} onOpen={() => {}} />);
    assert.equal(canonical(client), canonical(serverTopBarInner()));
  });

  test("with nothing to report, the menu button is the server's", () => {
    const client = renderToStaticMarkup(<TopBar health={cleanHealth()} healthError={false} onOpen={() => {}} />);
    assert.equal(canonical(client), canonical(serverTopBarInner()));
  });
});

/**
 * The navigation as AppFrame renders it (its own top bar, then its own
 * aside), beside a textarea elsewhere on the page to take focus from.
 */
function mountNavigation(health: HealthPayload | null = seedHealth(), healthError = false) {
  const rail = railData({ current: { page: "sites" } });
  document.body.innerHTML = `<textarea id="elsewhere"></textarea>`;
  const visits: string[] = [];
  render(
    <Navigation rail={rail} health={health} healthError={healthError} navigate={(href) => visits.push(href)} />,
  );
  const aside = document.querySelector<HTMLElement>("aside#rail");
  const header = document.querySelector<HTMLElement>("header#top-bar");
  assert.ok(aside && header);
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
  test("the top bar comes once: one header, one wordmark, one menu button", () => {
    const { header } = mountNavigation(null);
    assert.equal(document.querySelectorAll("header#top-bar").length, 1);
    assert.equal(document.querySelectorAll("aside#rail").length, 1);
    assert.equal(header.querySelectorAll("h1").length, 1);
    assert.equal(header.querySelectorAll("#rail-menu").length, 1);
    assert.equal(header.querySelectorAll("#rail-find").length, 1);
  });

  // The same signal as the rail's overview row, on the button that opens the
  // drawer holding it.
  test("the menu button carries the same signal", () => {
    const { header } = mountNavigation(healthWith(3));
    const menu = header.querySelector("#rail-menu");
    assert.ok(menu);
    const badge = menu.querySelector("[data-signal]");
    assert.equal(badge?.textContent, "● 5");
    assert.equal(badge?.getAttribute("aria-hidden"), "true");
    assert.equal(badge?.getAttribute("class"), MENU_BADGE.bad);
    assert.equal(menu.getAttribute("aria-label"), "Open navigation, 5 need attention");
    assert.ok((menu.getAttribute("class") ?? "").split(" ").includes("relative"), "the badge has no box to sit in");
    // The top bar carries no other mark.
    assert.ok(header.querySelector("[data-count]") === null, "the top bar's count");
    assert.equal(header.querySelectorAll("[data-signal]").length, 1);
    cleanup();

    const { header: quiet } = mountNavigation(cleanHealth());
    const plain = quiet.querySelector("#rail-menu");
    assert.equal(plain?.getAttribute("aria-label"), "Open navigation");
    assert.ok(plain?.querySelector("[data-signal]") === null, "a badge over nothing");
  });

  test("the menu button: unknown only, and a failed poll", () => {
    const { header } = mountNavigation(healthWith(3, false));
    const badge = header.querySelector("#rail-menu [data-signal]");
    assert.equal(badge?.textContent, "● 3");
    assert.equal(badge?.getAttribute("class"), MENU_BADGE.neutral);
    assert.equal(header.querySelector("#rail-menu")?.getAttribute("aria-label"), "Open navigation, 3 couldn't be read");
    cleanup();

    const { header: failed } = mountNavigation(healthWith(3), true);
    const mark = failed.querySelector("#rail-menu [data-signal]");
    assert.equal(mark?.textContent, "●");
    assert.equal(mark?.getAttribute("class"), MENU_BADGE.neutral);
    assert.equal(failed.querySelector("#rail-menu")?.getAttribute("aria-label"), "Open navigation, health unavailable");
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

/*
 * DESIGN.md's rules for the rail, asserted by name. The frozen fixtures pin
 * them only for a health-free rail with nothing open; these hold them in the
 * states the fixtures cannot express, and say what each rule is, so a
 * deliberate redesign that replaces the fixtures keeps them.
 */
describe("the rail's design rules, in states the fixtures cannot hold", () => {
  const RING = FOCUS_RING.split(" ");

  function assertRules(root: Element, state: string): void {
    const links = root.querySelectorAll("a[href]");
    assert.ok(links.length > 0, `${state}: no links`);
    for (const el of Array.from(root.querySelectorAll("a[href], button"))) {
      const cls = (el.getAttribute("class") ?? "").split(/\s+/);
      for (const token of RING) {
        assert.ok(cls.includes(token), `${state}: ${el.outerHTML.slice(0, 80)} lacks ${token}`);
      }
    }
    const html = root.innerHTML;
    assert.ok(!html.includes(BUTTON_PRIMARY), `${state}: a primary button in the rail`);
    assert.doesNotMatch(html, /\bbg-rose-400\b/, `${state}: Ember in the rail`);
    assert.doesNotMatch(root.textContent ?? "", /Add site/, `${state}: Add site in the rail`);
    assert.ok(!root.querySelector('a[href="/sites/new"]'), `${state}: a link to /sites/new in the rail`);
    assert.doesNotMatch(html, /\bbg-rose-950\b/, `${state}: an Ember-tinted row`);
    assert.doesNotMatch(html, /\btruncate\b/, `${state}: a truncated row`);
    const current = root.querySelectorAll('a[aria-current="page"]');
    assert.equal(current.length, 1, `${state}: ${current.length} current rows`);
    const cls = current[0]?.getAttribute("class") ?? "";
    assert.ok(cls.includes("aria-[current=page]:bg-stone-700"), `${state}: the current row is not on Hairline`);
    assert.doesNotMatch(cls, /\bborder-l/, `${state}: the current row has a left rule`);
  }

  test("with health filled in, trouble on a site and a unit, a site current", () => {
    const { container } = render(
      <Rail rail={railData({ current: { site: "broken.lychee.land" } })} health={seedHealth()} healthError={false} />,
    );
    assert.ok(container.querySelector("[data-signal]"), "the state has no trouble");
    assertRules(container, "health");
  });

  test("with find open and showing results", () => {
    const { container } = render(
      <Rail
        rail={railData({ current: { page: "services" } })}
        health={seedHealth()}
        healthError={false}
        findInitial={{ query: "lychee", focused: true }}
      />,
    );
    assert.ok(container.querySelectorAll('[role="option"]').length > 0, "find shows no results");
    assertRules(container, "find open");
  });

  test("each rule fails when it is broken", () => {
    // A detached copy, never React's own DOM, which the breaks would corrupt.
    const clean = renderToStaticMarkup(
      <Rail rail={railData({ current: { site: "broken.lychee.land" } })} health={seedHealth()} healthError={false} />,
    );
    const container = document.createElement("div");
    container.innerHTML = clean;
    assertRules(container, "the unbroken copy");
    const broken: Array<[string, (root: Element) => void]> = [
      ["Add site", (root) => root.querySelector("ul")?.insertAdjacentHTML("beforeend", `<li>Add site</li>`)],
      ["/sites/new", (root) => root.querySelector("ul")?.insertAdjacentHTML("beforeend", `<li><a class="${FOCUS_RING}" href="/sites/new">x</a></li>`)],
      ["Ember", (root) => root.querySelector("ul")?.setAttribute("class", "bg-rose-400")],
      ["tinted row", (root) => root.querySelector("ul")?.setAttribute("class", "bg-rose-950")],
      ["primary button", (root) => root.querySelector("ul")?.insertAdjacentHTML("beforeend", `<li><span class="${BUTTON_PRIMARY}"></span></li>`)],
      ["no current row", (root) => root.querySelector('a[aria-current="page"]')?.removeAttribute("aria-current")],
      ["two current rows", (root) => root.querySelector('a[data-site="api.lychee.land"]')?.setAttribute("aria-current", "page")],
      ["a link without the focus ring", (root) => {
        const link = root.querySelector("a[data-site]");
        link?.setAttribute("class", (link.getAttribute("class") ?? "").replace("focus-visible:outline-rose-400", ""));
      }],
      ["a truncated row", (root) => root.querySelector("a[data-site] span")?.classList.add("truncate")],
      ["a current row off Hairline", (root) => {
        const row = root.querySelector('a[aria-current="page"]');
        row?.setAttribute("class", (row.getAttribute("class") ?? "").replace("aria-[current=page]:bg-stone-700", ""));
      }],
      ["a current row with a left rule", (root) => {
        const row = root.querySelector('a[aria-current="page"]');
        row?.setAttribute("class", `${row.getAttribute("class") ?? ""} aria-[current=page]:border-l-2 aria-[current=page]:border-l-rose-800`);
      }],
    ];
    for (const [name, breakIt] of broken) {
      container.innerHTML = clean;
      breakIt(container);
      assert.throws(() => assertRules(container, name), assert.AssertionError, `${name} was not caught`);
    }
  });

  test("inside the narrow drawer", () => {
    setViewport(390);
    mountNavigation();
    click(document.querySelector("#rail-menu"));
    const dialog = drawer();
    assert.ok(dialog?.open, "the drawer did not open");
    assertRules(dialog, "drawer");
  });
});
