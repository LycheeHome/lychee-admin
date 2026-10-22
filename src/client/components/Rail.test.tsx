import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderRail } from "../../views/rail";
import { RAIL_COUNT_BAD, RAIL_COUNT_ZERO, RAIL_DOT } from "../../views/railModel";
import type { RailData } from "../../views/shell";
import type { HealthPayload } from "../../shared/health";
import { testShell } from "../../dev/testHelpers";
import { canonical } from "../test/canonical";
import { seedHealth } from "../test/healthFixture";
import { Rail } from "./Rail";

afterEach(cleanup);

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
});
