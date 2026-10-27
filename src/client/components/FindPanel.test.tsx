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

  // Critique 2026-10-26: three "No … match" lines pushed a single hit down.
  // When anything matches, groups with nothing are not shown.
  test("typing `sw` lists both swee services, and the groups with nothing are not shown", () => {
    const { input } = setup();
    focus(input);
    type(input, "sw");
    const services = document.querySelector('[data-find-group="service"]');
    assert.equal(services?.querySelectorAll('[role="option"]').length, 2);
    for (const empty of ["sites", "reconciler", "infrastructure"]) {
      assert.ok(!document.querySelector(`[data-find-group="${empty}"]`), `${empty} shows with nothing in it`);
    }
  });

  test("when nothing matches anywhere, each group still says so", () => {
    const { input } = setup();
    focus(input);
    type(input, "zzz");
    assert.match(document.querySelector('[data-find-group="sites"]')?.textContent ?? "", /No site matches “zzz”\./);
    assert.match(document.querySelector('[data-find-group="service"]')?.textContent ?? "", /No services match “zzz”\./);
  });

  test("Escape clears the query, so the next open starts fresh", () => {
    const { input } = setup();
    focus(input);
    type(input, "cad");
    key(input, "Escape");
    assert.equal(input.value, "");
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

  test("⌘K with an input that can't take focus (rail hidden) leaves the panel shut and the browser its shortcut", () => {
    const { input, getByTestId } = setup();
    input.focus = () => {};
    const textarea = getByTestId("elsewhere");
    focus(textarea);
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true, cancelable: true });
    act(() => {
      textarea.dispatchEvent(event);
    });
    assert.equal(event.defaultPrevented, false);
    assert.equal(input.getAttribute("aria-expanded"), "false");
    assert.equal(listbox(), null);
    assert.equal(document.activeElement, textarea);
  });

  test("every option sits in a group named by its heading", () => {
    const { input } = setup();
    focus(input);
    // `a` matches a row in all four groups.
    type(input, "a");
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    assert.ok(options.length > 0);
    const names = new Set<string>();
    for (const o of options) {
      const group = o.closest('[role="group"]');
      assert.ok(group, `${o.textContent} is in no group`);
      const labelId = group.getAttribute("aria-labelledby");
      assert.ok(labelId, "a group has no aria-labelledby");
      const label = document.getElementById(labelId);
      assert.ok(label, `aria-labelledby ${labelId} names nothing`);
      names.add(label.textContent ?? "");
    }
    assert.deepEqual([...names].sort(), ["infrastructure", "reconciler", "services", "sites"]);
    const ids = Array.from(document.querySelectorAll("[id]")).map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, "ids are not unique");
  });

  test("the highlight follows its row when a poll reorders the list", () => {
    const visits: string[] = [];
    const tree = (health: HealthPayload) => (
      <FindPanel health={health} railSites={railSites} navigate={(href) => visits.push(href)} />
    );
    const utils = render(tree(seedHealth()));
    const input = utils.container.querySelector<HTMLInputElement>("#find");
    assert.ok(input);
    focus(input);
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    const before = input.getAttribute("aria-activedescendant");
    assert.match(document.getElementById(before ?? "")?.textContent ?? "", /^swee/);

    const next = seedHealth();
    next.sites = next.sites.map((s) =>
      s.hostname === "gone.lychee.land" ? { ...s, tone: "bad", label: "failed", attention: true } : s,
    );
    act(() => {
      utils.rerender(tree(next));
    });
    assert.equal(optionTexts().length, 6, "the poll did not insert a row");
    assert.equal(input.getAttribute("aria-activedescendant"), before, "the highlight moved to another row");
    key(input, "Enter");
    assert.deepEqual(visits, ["/services#service-swee"]);
  });

  test("when the highlighted row disappears, the highlight falls back to the first option", () => {
    const visits: string[] = [];
    const tree = (health: HealthPayload) => (
      <FindPanel health={health} railSites={railSites} navigate={(href) => visits.push(href)} />
    );
    const utils = render(tree(seedHealth()));
    const input = utils.container.querySelector<HTMLInputElement>("#find");
    assert.ok(input);
    focus(input);
    key(input, "ArrowDown");
    key(input, "ArrowDown");
    const next = seedHealth();
    next.units = (next.units ?? []).map((u) => (u.name === "swee" ? { ...u, trouble: null, attention: false } : u));
    act(() => {
      utils.rerender(tree(next));
    });
    key(input, "Enter");
    assert.deepEqual(visits, ["/sites/api.lychee.land"]);
  });

  test("text typed before mount is kept, and focus with it", () => {
    const { input } = setup(seedHealth(), { initialQuery: "sw", initialFocused: true });
    assert.equal(input.value, "sw");
    assert.equal(document.activeElement, input);
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(document.querySelector('[data-find-group="service"]')?.querySelectorAll('[role="option"]').length, 2);
  });

  test("text typed before mount, without focus, stays closed", () => {
    const { input } = setup(seedHealth(), { initialQuery: "sw" });
    assert.equal(input.value, "sw");
    assert.equal(input.getAttribute("aria-expanded"), "false");
  });
});
