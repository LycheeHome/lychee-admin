import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { HealthPayload } from "../../shared/health";
import { SEEDED_RAIL_SITES } from "../../dev/testHelpers";
import { seedHealth } from "../test/healthFixture";
import { FindPanel } from "./FindPanel";

afterEach(cleanup);

const railSites = SEEDED_RAIL_SITES.map((s) => ({ ...s }));

const calm = (): HealthPayload => {
  const h = seedHealth();
  h.sites = h.sites.map((s) => ({ ...s, attention: false, tone: s.tone === "bad" ? "ok" : s.tone }));
  h.units = (h.units ?? []).map((u) => ({ ...u, attention: false, tone: "ok", trouble: null }));
  return h;
};

function setup(health: HealthPayload | null = seedHealth(), extra: Partial<Parameters<typeof FindPanel>[0]> = {}) {
  const visits: string[] = [];
  const utils = render(
    <div>
      <textarea data-testid="elsewhere" />
      <FindPanel health={health} railSites={railSites} navigate={(href) => visits.push(href)} {...extra} />
    </div>,
  );
  const input = utils.container.querySelector<HTMLInputElement>("#find");
  assert.ok(input, "no #find input");
  return { ...utils, input, visits };
}

const listbox = (): HTMLElement | null => document.querySelector('[role="listbox"]');
const optionTexts = (): string[] =>
  Array.from(document.querySelectorAll('[role="option"]')).map((o) => o.textContent ?? "");

function type(input: HTMLInputElement, value: string): void {
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
}

function key(target: Element, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    fireEvent.keyDown(target, { key: k, ...init });
  });
}

function focus(el: HTMLElement): void {
  act(() => el.focus());
}

describe("FindPanel", () => {
  test("closed, it is only the combobox input and its hint", () => {
    const { input } = setup();
    assert.equal(input.getAttribute("role"), "combobox");
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(input.getAttribute("aria-controls"), "find-list");
    assert.equal(input.getAttribute("aria-autocomplete"), "list");
    assert.equal(input.getAttribute("aria-activedescendant"), null);
    assert.equal(listbox(), null);
  });

  test("focusing the empty input lists what needs attention", () => {
    const { input } = setup();
    focus(input);
    assert.equal(input.getAttribute("aria-expanded"), "true");
    const texts = optionTexts();
    assert.equal(texts.length, 5);
    assert.match(texts[0] ?? "", /api\.lychee\.land/);
    assert.match(texts[0] ?? "", /not responding/);
    assert.match(texts[1] ?? "", /broken\.lychee\.land/);
    assert.match(texts[2] ?? "", /swee/);
    assert.match(texts[2] ?? "", /deploy blocked/);
    assert.match(texts[3] ?? "", /swee-staging/);
    assert.match(texts[4] ?? "", /palsave-api/);
    assert.doesNotMatch(listbox()?.textContent ?? "", /Nothing needs attention/);
  });

  test("with nothing needing attention it says so in one line", () => {
    const { input } = setup(calm());
    focus(input);
    assert.equal(optionTexts().length, 0);
    assert.equal(listbox()?.textContent, "Nothing needs attention.");
  });

  test("typing `sw` says no site matches, under sites, and lists both swee services", () => {
    const { input } = setup();
    focus(input);
    type(input, "sw");
    const sites = document.querySelector('[data-find-group="sites"]');
    assert.ok(sites, "no sites group");
    assert.match(sites.textContent ?? "", /No site matches “sw”\./);
    const services = document.querySelector('[data-find-group="service"]');
    assert.equal(services?.querySelectorAll('[role="option"]').length, 2);
    assert.match(document.querySelector('[data-find-group="reconciler"]')?.textContent ?? "", /No reconciler units match “sw”\./);
    assert.match(
      document.querySelector('[data-find-group="infrastructure"]')?.textContent ?? "",
      /No infrastructure units match “sw”\./,
    );
  });

  test("a unit group with no match says so", () => {
    const { input } = setup();
    focus(input);
    type(input, "blog");
    assert.match(document.querySelector('[data-find-group="service"]')?.textContent ?? "", /No services match “blog”\./);
  });

  test("ArrowDown crosses groups and Enter opens the highlighted row", () => {
    const { input, visits } = setup();
    focus(input);
    const active = () => document.getElementById(input.getAttribute("aria-activedescendant") ?? "")?.textContent ?? "";
    assert.match(active(), /api\.lychee\.land/);
    key(input, "ArrowDown");
    assert.match(active(), /broken\.lychee\.land/);
    key(input, "Enter");
    assert.deepEqual(visits, ["/sites/broken.lychee.land"]);
    key(input, "ArrowDown");
    assert.match(active(), /swee/);
    key(input, "Enter");
    assert.deepEqual(visits, ["/sites/broken.lychee.land", "/services#service-swee"]);
    key(input, "ArrowUp");
    assert.match(active(), /broken\.lychee\.land/);
  });

  test("the highlighted option is aria-selected", () => {
    const { input } = setup();
    focus(input);
    key(input, "ArrowDown");
    const selected = Array.from(document.querySelectorAll('[role="option"][aria-selected="true"]'));
    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.id, input.getAttribute("aria-activedescendant"));
  });

  test("hover moves the highlight and a click opens the row", () => {
    const { input, visits } = setup();
    focus(input);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    const swee = options[2];
    assert.ok(swee);
    act(() => {
      fireEvent.mouseEnter(swee);
    });
    assert.equal(input.getAttribute("aria-activedescendant"), swee.id);
    act(() => {
      fireEvent.click(swee);
    });
    assert.deepEqual(visits, ["/services#service-swee"]);
  });

  test("Meta+K from a textarea opens find, and Escape gives focus back to the textarea", () => {
    const { input, getByTestId } = setup();
    const textarea = getByTestId("elsewhere");
    focus(textarea);
    assert.equal(document.activeElement, textarea);
    key(textarea, "k", { metaKey: true });
    assert.equal(document.activeElement, input);
    assert.equal(input.getAttribute("aria-expanded"), "true");
    key(input, "Escape");
    assert.equal(document.activeElement, textarea);
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(listbox(), null);
  });

  test("Ctrl+K opens find too, and the shortcut's default is prevented", () => {
    const { input, getByTestId } = setup();
    const textarea = getByTestId("elsewhere");
    focus(textarea);
    let prevented = false;
    act(() => {
      prevented = !fireEvent.keyDown(textarea, { key: "k", ctrlKey: true });
    });
    assert.equal(prevented, true);
    assert.equal(document.activeElement, input);
  });

  test("a plain k typed elsewhere is left alone", () => {
    const { input, getByTestId } = setup();
    const textarea = getByTestId("elsewhere");
    focus(textarea);
    key(textarea, "k");
    assert.equal(document.activeElement, textarea);
    assert.equal(input.getAttribute("aria-expanded"), "false");
  });

  test("the combobox wiring: listbox, options, group labels", () => {
    const { input } = setup();
    focus(input);
    const list = listbox();
    assert.ok(list);
    assert.equal(list.id, "find-list");
    assert.equal(input.getAttribute("aria-controls"), list.id);
    const options = list.querySelectorAll('[role="option"]');
    assert.ok(options.length > 0);
    for (const o of Array.from(options)) assert.ok(o.id, "an option has no id");
    const headings = list.querySelectorAll("[data-find-heading]");
    assert.ok(headings.length >= 2);
    for (const h of Array.from(headings)) assert.equal(h.getAttribute("role"), "presentation");
  });

  test("no row is an action", () => {
    const { input } = setup();
    focus(input);
    for (const q of ["", "s", "a", "e"]) {
      type(input, q);
      const text = listbox()?.textContent ?? "";
      assert.doesNotMatch(text, /Remove|Deploy/);
      assert.equal(listbox()?.querySelectorAll("button, form").length, 0);
    }
  });

  test("without health, sites are matched from the rail's list without pills", () => {
    const { input } = setup(null);
    focus(input);
    type(input, "api");
    assert.deepEqual(optionTexts().length, 1);
    assert.match(optionTexts()[0] ?? "", /api\.lychee\.land/);
    assert.equal(document.querySelector('[data-find-group="service"]'), null);
  });

  test("text typed before mount is kept, and focus with it", () => {
    const { input } = setup(seedHealth(), { initialQuery: "sw", initialFocused: true });
    assert.equal(input.value, "sw");
    assert.equal(document.activeElement, input);
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.match(document.querySelector('[data-find-group="sites"]')?.textContent ?? "", /No site matches “sw”\./);
  });

  test("text typed before mount, without focus, stays closed", () => {
    const { input } = setup(seedHealth(), { initialQuery: "sw" });
    assert.equal(input.value, "sw");
    assert.equal(input.getAttribute("aria-expanded"), "false");
  });
});
