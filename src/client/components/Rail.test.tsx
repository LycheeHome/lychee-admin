import "../test/setup";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { MENU_BADGE, RAIL_SIGNAL_COUNT, RAIL_SIGNAL_DOT } from "../../views/overviewModel";
import {
  RAIL_BADGE,
  RAIL_BADGE_COUNT,
  RAIL_BADGE_DOT,
  RAIL_CELL,
  RAIL_CELL_ICON,
  RAIL_DIVIDER,
  RAIL_ICON,
  RAIL_MONOGRAM,
  RAIL_PLACES,
  RAIL_STORAGE_KEY,
  RAIL_STRIP,
  RAIL_STRIP_DIVIDER,
  RAIL_TIP,
} from "../../views/railModel";
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
    // Its icon alone: no signal beside the word.
    assert.deepEqual(
      Array.from(links[1]?.children ?? []).map((c) => c.tagName.toLowerCase()),
      ["svg"],
      "the activity row carries a mark",
    );
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

// Spec 2026-10-29-collapsible-rail: every place row leads with an icon, a rule
// splits the app's places from the host boards, and a collapse button sits
// beside the wordmark on the wide rail.
describe("the expanded rail's icons, divider and toggle", () => {
  test("each place row leads with its icon", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    for (const { place, href } of RAIL_PLACES) {
      const link = container.querySelector(`nav a[href="${href}"]:not([aria-label])`);
      assert.ok(link, `no ${place} row`);
      const icon = link.firstElementChild;
      assert.equal(icon?.tagName.toLowerCase(), "svg", `${place} leads with ${icon?.tagName}`);
      assert.equal(icon?.getAttribute("aria-hidden"), "true", place);
      assert.equal(icon?.getAttribute("class"), RAIL_ICON, place);
      assert.equal(link.textContent, place);
      // justify-between would push the word away from its icon to the row's far edge.
      assert.ok(!link.classList.contains("justify-between"), `${place} spreads its icon from its word`);
    }
  });

  test("a divider separates the app's places from the host boards", () => {
    const { container } = render(<Rail rail={railData()} health={null} healthError={false} />);
    const sites = container.querySelector('nav[aria-label="Sites"]');
    const divider = sites?.nextElementSibling;
    // Compared by identity: a failing assert.equal would print the whole DOM node.
    assert.ok(divider?.nextElementSibling === container.querySelector('nav[aria-label="Host"]'), "the Host nav follows the divider");
    assert.equal(divider?.getAttribute("class"), RAIL_DIVIDER);
    assert.equal(divider?.getAttribute("aria-hidden"), "true");
  });

  test("the collapse button sits beside the wordmark, and not in the drawer", () => {
    const toggled: HTMLButtonElement[] = [];
    const { container } = render(
      <Rail rail={railData()} health={null} healthError={false} onToggle={(b) => toggled.push(b)} />,
    );
    const button = container.querySelector<HTMLButtonElement>("#rail-toggle");
    assert.ok(button, "no #rail-toggle");
    assert.equal(button.getAttribute("aria-label"), "Collapse sidebar");
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.equal(button.getAttribute("aria-controls"), "rail");
    assert.equal(button.previousElementSibling?.tagName.toLowerCase(), "h1");
    fireEvent.click(button);
    assert.equal(toggled.length, 1);
    assert.ok(toggled[0] === button, "onToggle gets the button");
    cleanup();
    const drawer = render(<Rail rail={railData()} health={null} healthError={false} inDrawer />);
    assert.equal(drawer.container.querySelector("#rail-toggle"), null);
  });
});

/** A router-backed ClientNav, so a click on a strip cell really moves the route. */
function RoutedNav({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ClientNavContext.Provider
      value={{ pathname: location.pathname, locationKey: location.key, navigate: (href) => void navigate(href), documentLoad: false }}
    >
      {children}
    </ClientNavContext.Provider>
  );
}

describe("the collapsed strip", () => {
  const strip = (overrides: Partial<RailData> = {}, health: HealthPayload | null = null, healthError = false) =>
    render(<Rail rail={railData(overrides)} health={health} healthError={healthError} collapsed />);

  /** The strip's six place cells, in rail order. */
  const cells = (root: ParentNode): HTMLAnchorElement[] =>
    RAIL_PLACES.map(({ place, href }) => {
      const cell = root.querySelector<HTMLAnchorElement>(`nav a[href="${href}"]`);
      assert.ok(cell, `no ${place} cell`);
      return cell;
    });

  test("renders inside the strip column", () => {
    const { container } = strip();
    assert.equal(container.firstElementChild?.getAttribute("class"), RAIL_STRIP);
    const h1 = container.querySelector("h1");
    const mono = h1?.querySelector("a");
    assert.equal(mono?.getAttribute("href"), "/");
    assert.equal(mono?.getAttribute("aria-label"), "lychee-admin");
    assert.equal(mono?.textContent, "l");
    assert.equal(mono?.getAttribute("class"), RAIL_MONOGRAM);
  });

  test("no site rows, no find box and no notes", () => {
    const { container } = strip({ sites: null, hostAvailable: false });
    // Compared by identity: a failing assert.equal would print the whole DOM node.
    assert.ok(container.querySelector("a[data-site]") === null, "a site row in the strip");
    assert.ok(container.querySelector("#find") === null, "a find box in the strip");
    assert.doesNotMatch(container.textContent ?? "", /Can't read the Caddyfile|Inventory unavailable/);
    const seeded = strip();
    assert.ok(seeded.container.querySelector("a[data-site]") === null, "a seeded site row in the strip");
  });

  test("each place cell keeps its word", () => {
    const { container } = strip({}, healthWith(3));
    for (const [i, cell] of cells(container).entries()) {
      const word = RAIL_PLACES[i]!.place;
      assert.equal(cell.getAttribute("class"), RAIL_CELL, word);
      const icon = cell.firstElementChild;
      assert.equal(icon?.tagName.toLowerCase(), "svg", word);
      assert.equal(icon?.getAttribute("class"), RAIL_CELL_ICON, word);
      assert.equal(cell.querySelector("span.sr-only")?.textContent, word);
      const tips = cell.querySelectorAll(`[aria-hidden="true"]:not(svg):not([data-signal])`);
      assert.equal(tips.length, 1, `${word}: ${tips.length} tooltips`);
      assert.equal(tips[0]?.textContent, word);
      // Not `capitalize`, which reads the tip as one word with the sr-only text before it.
      assert.equal(tips[0]?.getAttribute("class"), `${RAIL_TIP} first-letter:uppercase`);
    }
  });

  test("the badge carries the signal", () => {
    const overview = (root: ParentNode) => cells(root)[0]!;
    const bad = strip({}, healthWith(3));
    let badge = overview(bad.container).querySelector("[data-signal]");
    assert.ok(badge, "no badge");
    assert.equal(badge.getAttribute("class"), RAIL_BADGE);
    assert.equal(badge.getAttribute("aria-hidden"), "true");
    assert.equal(badge.textContent, "5");
    assert.ok(badge.querySelector(".bg-red-300"), "not the bad dot");
    assert.ok(badge.querySelector(".size-\\[5px\\]"), "not the 5px dot");
    assert.equal(badge.querySelector(".size-\\[5px\\]")?.getAttribute("class"), RAIL_BADGE_DOT.bad);
    assert.equal(badge.querySelector(".font-mono")?.getAttribute("class"), RAIL_BADGE_COUNT.bad);
    assert.match(accessibleName(overview(bad.container)), /^overview, 5 need attention/);
    bad.unmount();

    const neutral = strip({}, healthWith(3, false));
    badge = overview(neutral.container).querySelector("[data-signal]");
    assert.equal(badge?.textContent, "3");
    assert.ok(badge?.querySelector(".bg-stone-400"), "not the neutral dot");
    assert.equal(badge?.querySelector(".bg-stone-400")?.getAttribute("class"), RAIL_BADGE_DOT.neutral);
    assert.equal(badge?.querySelector(".font-mono")?.getAttribute("class"), RAIL_BADGE_COUNT.neutral);
    assert.ok(badge?.querySelector(".bg-red-300") === null, "a Scorch dot on unknowns");
    neutral.unmount();

    const failed = strip({}, healthWith(3), true);
    badge = overview(failed.container).querySelector("[data-signal]");
    assert.ok(badge?.querySelector(".bg-stone-400"), "a failed poll is not neutral");
    assert.doesNotMatch(badge?.textContent ?? "", /\d/);
    failed.unmount();

    const clean = strip({}, cleanHealth());
    assert.ok(clean.container.querySelector("[data-signal]") === null, "a badge with nothing to report");
  });

  test("the toggle expands and find opens the peek", () => {
    const opened: HTMLButtonElement[] = [];
    const toggled: HTMLButtonElement[] = [];
    const { container } = render(
      <Rail
        rail={railData()}
        health={null}
        healthError={false}
        collapsed
        onFindOpen={(b) => opened.push(b)}
        onToggle={(b) => toggled.push(b)}
      />,
    );
    const toggle = container.querySelector<HTMLButtonElement>("#rail-toggle");
    assert.equal(toggle?.getAttribute("aria-label"), "Expand sidebar");
    assert.equal(toggle?.getAttribute("aria-expanded"), "false");
    assert.equal(toggle?.getAttribute("aria-controls"), "rail");
    fireEvent.click(toggle!);
    assert.ok(toggled[0] === toggle, "onToggle gets the button");
    const find = container.querySelector<HTMLButtonElement>("#rail-find-open");
    assert.ok(find, "no #rail-find-open");
    assert.equal(find.getAttribute("type"), "button");
    assert.equal(find.getAttribute("aria-label"), "Find");
    assert.equal(find.getAttribute("class"), RAIL_CELL);
    assert.equal(find.querySelector(`[aria-hidden="true"]:not(svg)`)?.textContent, "Find");
    fireEvent.click(find);
    assert.equal(opened.length, 1);
    assert.ok(opened[0] === find, "onFindOpen gets the button");
  });

  test("the order: monogram, toggle, find, overview and sites navs, divider, host nav", () => {
    const { container } = strip();
    const kids = Array.from(container.firstElementChild?.children ?? []);
    const shape = kids.map((k) => k.id || k.getAttribute("aria-label") || k.tagName.toLowerCase());
    assert.deepEqual(shape, ["h1", "rail-toggle", "rail-find-open", "Overview", "Sites", "div", "Host"]);
    for (const label of ["Overview", "Sites", "Host"]) {
      const nav = container.querySelector(`nav[aria-label="${label}"]`);
      assert.equal(nav?.getAttribute("class"), "flex flex-col items-center gap-0.5", label);
    }
    assert.equal(container.querySelectorAll('nav[aria-label="Host"] a').length, 3);
  });

  test("the divider is in the strip too", () => {
    const { container } = strip();
    const divider = container.querySelector('nav[aria-label="Sites"]')?.nextElementSibling;
    assert.equal(divider?.getAttribute("class"), RAIL_STRIP_DIVIDER);
    assert.equal(divider?.getAttribute("aria-hidden"), "true");
    assert.ok(divider?.nextElementSibling === container.querySelector('nav[aria-label="Host"]'), "the Host nav follows the divider");
  });

  test("the current cell follows the route", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/reconciler"]}>
        <RoutedNav>
          <Rail rail={railData()} health={null} healthError={false} collapsed />
        </RoutedNav>
      </MemoryRouter>,
    );
    // The expanded rail has the same hrefs, so check it is the strip, and a strip cell, each time.
    const current = (when: string) => {
      assert.equal(container.firstElementChild?.getAttribute("class"), RAIL_STRIP, `${when}: not the strip`);
      assert.ok(container.querySelector("#find") === null, `${when}: a find box, so not the strip`);
      const rows = Array.from(container.querySelectorAll('a[aria-current="page"]'));
      for (const row of rows) assert.equal(row.getAttribute("class"), RAIL_CELL, `${when}: the current row is not a strip cell`);
      return rows.map((a) => a.getAttribute("href"));
    };
    assert.deepEqual(current("at /reconciler"), ["/reconciler"]);
    act(() => {
      fireEvent.click(container.querySelector('a[href="/activity"]')!, { button: 0 });
    });
    assert.deepEqual(current("after the move"), ["/activity"]);
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
 * The collapse state (spec 2026-10-29-collapsible-rail): Navigation owns it,
 * reads it from storage on its first render, writes every flip, and marks the
 * body so its grid narrows from 900px.
 */
describe("the rail's collapse state", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  const toggle = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("#rail-toggle");

  test("a stored collapse renders the strip on the first render", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    const { aside } = mountNavigation();
    assert.ok(aside.querySelector("#rail-find-open"), "no strip find button");
    assert.ok(aside.querySelector("#find") === null, "find in the strip");
    assert.equal(document.body.dataset.rail, "collapsed");
  });

  test("the toggle flips state, storage, the body and focus", () => {
    const { aside } = mountNavigation();
    assert.ok(aside.querySelector("#find"));
    assert.equal(document.body.dataset.rail, undefined);

    click(toggle());
    assert.equal(localStorage.getItem(RAIL_STORAGE_KEY), "collapsed");
    assert.equal(document.body.dataset.rail, "collapsed");
    const expand = toggle();
    assert.equal(expand?.getAttribute("aria-label"), "Expand sidebar");
    assert.ok(document.activeElement === expand, "focus did not follow to Expand sidebar");

    click(expand);
    assert.equal(localStorage.getItem(RAIL_STORAGE_KEY), "expanded");
    assert.equal(document.body.dataset.rail, undefined);
    const collapse = toggle();
    assert.equal(collapse?.getAttribute("aria-label"), "Collapse sidebar");
    assert.ok(document.activeElement === collapse, "focus did not follow to Collapse sidebar");
  });

  test("a store that throws renders expanded and toggles in memory", () => {
    const store = Object.getPrototypeOf(localStorage) as Storage;
    const getItem = store.getItem;
    const setItem = store.setItem;
    store.getItem = () => {
      throw new Error("blocked");
    };
    store.setItem = () => {
      throw new Error("blocked");
    };
    try {
      const { aside } = mountNavigation();
      assert.ok(aside.querySelector("#find"), "a throwing store did not render expanded");
      click(toggle());
      assert.ok(aside.querySelector("#rail-find-open"), "the toggle did not collapse");
      assert.equal(document.body.dataset.rail, "collapsed");
    } finally {
      store.getItem = getItem;
      store.setItem = setItem;
    }
  });

  test("unmount clears the body attribute", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    mountNavigation();
    assert.equal(document.body.dataset.rail, "collapsed");
    cleanup();
    assert.equal(document.body.dataset.rail, undefined);
  });

  test("the drawer is always expanded", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    setViewport(390);
    mountNavigation();
    click(document.querySelector("#rail-menu"));
    const dialog = drawer();
    assert.ok(dialog);
    assert.ok(dialog.querySelector("#find"), "no find in the drawer");
    assert.equal(dialog.querySelectorAll("[data-site]").length, 8);
    assert.ok(dialog.querySelector("#rail-toggle") === null, "a collapse button in the drawer");
    assert.equal(finds().length, 1);
  });

  test("⌘K while collapsed and narrow opens the drawer on find", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    setViewport(390);
    mountNavigation();
    const elsewhere = document.querySelector<HTMLTextAreaElement>("#elsewhere");
    assert.ok(elsewhere);
    act(() => elsewhere.focus());
    press(elsewhere, "k", { metaKey: true });
    const dialog = drawer();
    assert.ok(dialog?.open, "⌘K did not open the drawer");
    const input = finds()[0];
    assert.ok(input && dialog.contains(input));
    assert.ok(document.activeElement === input, "find is not focused");

    press(input, "Escape");
    press(input, "Escape");
    assert.equal(drawer(), null);
    assert.ok(document.activeElement === elsewhere, "focus did not go back");
  });

  test("keeps exactly one document keydown listener while collapsed", () => {
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    const live = new Set<EventListenerOrEventListenerObject>();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "keydown") live.add(fn);
      add(type, fn, opts as AddEventListenerOptions);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === "keydown") live.delete(fn);
      remove(type, fn, opts as EventListenerOptions);
    }) as typeof document.removeEventListener;
    try {
      setViewport(390);
      mountNavigation();
      assert.equal(live.size, 1);
      click(document.querySelector("#rail-menu"));
      assert.equal(live.size, 1);
      const dialog = drawer();
      assert.ok(dialog);
      press(dialog, "Escape");
      assert.equal(live.size, 1);
      click(toggle());
      assert.equal(live.size, 1, "the expanded rail's find and the collapsed listener both live");
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
  });

  test("the body class names the collapsed grid", () => {
    const html = readFileSync(path.join(__dirname, "..", "..", "..", "index.html"), "utf8");
    assert.ok(html.includes("min-[900px]:data-[rail=collapsed]:grid-cols-[56px_minmax(0,1fr)]"));
  });
});

/*
 * The peek (spec 2026-10-29-collapsible-rail): find while collapsed. The
 * expanded rail in a fixed overlay, find focused, the stored state untouched.
 */
describe("the find peek", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(RAIL_STORAGE_KEY, "collapsed");
    setViewport(1280);
  });
  afterEach(() => {
    localStorage.clear();
  });

  const peek = (): HTMLElement | null => document.querySelector<HTMLElement>("#rail-peek");
  const findOpen = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>("#rail-find-open");
  const stored = (): string | null => localStorage.getItem(RAIL_STORAGE_KEY);

  function assertOpen(when: string): HTMLInputElement {
    const root = peek();
    assert.ok(root, `${when}: no peek`);
    assert.equal(root.getAttribute("role"), "dialog");
    assert.equal(root.getAttribute("aria-modal"), "false");
    assert.equal(root.getAttribute("aria-label"), "Navigation");
    assert.equal(finds().length, 1, `${when}: not exactly one #find`);
    const input = finds()[0];
    assert.ok(input && root.contains(input), `${when}: find is not in the peek`);
    assert.ok(document.activeElement === input, `${when}: find is not focused`);
    assert.equal(stored(), "collapsed", `${when}: the stored state changed`);
    return input;
  }

  test("the find button opens the peek with find focused", () => {
    const { aside } = mountNavigation();
    click(findOpen());
    assertOpen("after the click");
    // The peek takes the strip's place in the aside, as the drawer takes the rail.
    assert.ok(aside.contains(peek()), "the peek is not in the aside");
    assert.ok(findOpen() === null, "the strip is still mounted under the peek");
    assert.equal(peek()?.querySelectorAll("[data-site]").length, 8);
    assert.ok(document.body.querySelectorAll("[inert]").length === 0, "the peek made the page inert");
  });

  test("while the peek is open there is one toggle, one heading and one set of navs", () => {
    const { aside } = mountNavigation();
    click(findOpen());
    assert.ok(peek());
    assert.equal(document.querySelectorAll("#rail-toggle").length, 1);
    assert.equal(aside.querySelectorAll("h1").length, 1);
    for (const label of ["Overview", "Sites", "Host"]) {
      assert.equal(document.querySelectorAll(`nav[aria-label="${label}"]`).length, 1, label);
    }
    const toggle = peek()?.querySelector("#rail-toggle");
    assert.equal(toggle?.getAttribute("aria-controls"), "rail-peek");
    assert.equal(toggle?.getAttribute("aria-expanded"), "true");
    assert.equal(toggle?.getAttribute("aria-label"), "Collapse sidebar");
  });

  test("⌘K while collapsed and wide opens the peek, not the drawer, and Escape closes it", () => {
    mountNavigation();
    const elsewhere = document.querySelector<HTMLTextAreaElement>("#elsewhere");
    assert.ok(elsewhere);
    act(() => elsewhere.focus());
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    act(() => {
      elsewhere.dispatchEvent(event);
    });
    assert.ok(event.defaultPrevented, "⌘K kept the browser's own shortcut");
    assert.ok(drawer() === null, "⌘K opened the drawer");
    const input = assertOpen("after ⌘K");

    press(input, "Escape");
    press(input, "Escape");
    assert.ok(peek() === null, "Escape left the peek open");
    assert.ok(document.activeElement === elsewhere, "focus did not go back to what had it before ⌘K");
    assert.equal(stored(), "collapsed");
  });

  test("Escape closes find's panel first, then the peek", () => {
    mountNavigation();
    click(findOpen());
    const input = assertOpen("open");
    act(() => {
      fireEvent.change(input, { target: { value: "api" } });
    });
    assert.equal(input.getAttribute("aria-expanded"), "true");

    press(input, "Escape");
    assert.ok(peek(), "the first Escape closed the peek");
    assert.equal(input.getAttribute("aria-expanded"), "false");

    press(input, "Escape");
    assert.ok(peek() === null, "the second Escape left the peek open");
    assert.ok(document.activeElement === findOpen(), "focus did not go back to the find button");
  });

  test("a rail link inside the peek closes it on the move", () => {
    render(
      <MemoryRouter initialEntries={["/sites"]}>
        <RoutedNav>
          <Navigation rail={railData()} health={seedHealth()} healthError={false} />
        </RoutedNav>
      </MemoryRouter>,
    );
    click(findOpen());
    const root = peek();
    assert.ok(root);
    click(root.querySelector('a[href="/services"]'), { button: 0 });
    assert.ok(peek() === null, "the move left the peek open");
    const cell = document.querySelector('aside#rail a[href="/services"]');
    assert.equal(cell?.getAttribute("aria-current"), "page");
    // A move returns focus nowhere: in the app the new page's heading takes it
    // (AppFrame), which this harness has none of, so focus is on the body.
    assert.ok(document.activeElement === document.body, "the peek's close moved focus after a move");
    assert.equal(stored(), "collapsed");
  });

  test("a pointer down outside closes it; one inside does not", () => {
    mountNavigation();
    click(findOpen());
    const root = peek();
    assert.ok(root);
    act(() => {
      root.querySelector("nav")?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    assert.ok(peek(), "a pointer down inside closed the peek");
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    assert.ok(peek() === null, "a pointer down outside left the peek open");
  });

  test("focus leaving it closes it; a window blur does not", () => {
    mountNavigation();
    click(findOpen());
    const input = assertOpen("open");
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
    });
    assert.ok(peek(), "a focusout to nowhere closed the peek");
    const elsewhere = document.querySelector<HTMLTextAreaElement>("#elsewhere");
    act(() => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: elsewhere }));
    });
    assert.ok(peek() === null, "focus leaving left the peek open");
  });

  test("the peek's collapse button closes it and keeps the stored state", () => {
    mountNavigation();
    click(findOpen());
    const toggle = peek()?.querySelector<HTMLButtonElement>("#rail-toggle");
    assert.equal(toggle?.getAttribute("aria-label"), "Collapse sidebar");
    click(toggle ?? null);
    assert.ok(peek() === null, "the collapse button left the peek open");
    assert.equal(stored(), "collapsed");
    assert.equal(document.body.dataset.rail, "collapsed");
    assert.ok(findOpen(), "the strip did not come back");
    assert.ok(document.activeElement === findOpen(), "focus did not go back to the strip's find button");
  });

  // happy-dom's MediaQueryList starts its change tracking at `false`, so a
  // wide-to-narrow resize never fires `change`: the query is stubbed instead.
  test("narrowing closes the peek", () => {
    const real = window.matchMedia;
    const listeners = new Set<() => void>();
    let matches = true;
    window.matchMedia = ((media: string) => ({
      media,
      get matches() {
        return matches;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })) as unknown as typeof window.matchMedia;
    try {
      mountNavigation();
      click(findOpen());
      assert.ok(peek());
      assert.ok(listeners.size > 0, "nothing listens for the width");
      matches = false;
      act(() => {
        for (const fn of Array.from(listeners)) fn();
      });
      assert.ok(peek() === null, "narrowing left the peek open");
      assert.equal(stored(), "collapsed");
    } finally {
      window.matchMedia = real;
    }
  });

  test("keeps exactly one document keydown listener through the peek", () => {
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
      click(findOpen());
      assert.equal(live.size, 1, "the peek's find and the collapsed listener both live");
      const input = finds()[0];
      assert.ok(input);
      press(input, "Escape");
      press(input, "Escape");
      assert.ok(peek() === null);
      assert.equal(live.size, 1, "the collapsed listener did not come back");
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

  /** `currentRows` is 1, or 0 where the current place is a site the state does not show (the strip). */
  function assertRules(root: Element, state: string, currentRows = 1): void {
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
    assert.equal(current.length, currentRows, `${state}: ${current.length} current rows`);
    const cls = current[0]?.getAttribute("class") ?? "";
    if (currentRows > 0) {
      assert.ok(cls.includes("aria-[current=page]:bg-stone-700"), `${state}: the current row is not on Hairline`);
    }
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

  test("the strip keeps the rail's rules", () => {
    const site = render(
      <Rail rail={railData({ current: { site: "broken.lychee.land" } })} health={seedHealth()} healthError={false} collapsed />,
    );
    assert.ok(site.container.querySelector("[data-signal]"), "the state has no trouble");
    // The current place is a site, and the strip shows no site rows.
    assertRules(site.container, "strip on a site", 0);
    site.unmount();
    const board = render(
      <Rail rail={railData({ current: { page: "services" } })} health={seedHealth()} healthError={false} collapsed />,
    );
    assertRules(board.container, "strip on a board");
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
