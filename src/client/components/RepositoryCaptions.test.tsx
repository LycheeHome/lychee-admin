import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { seedSiteDetailPayload } from "../../dev/testHelpers";
import type { SiteDetailPayload } from "../../shared/siteDetail";
import { SiteDetail } from "./SiteDetail";
import { BOARD_ALERT } from "./BoardRows";

/*
 * The follow-ups to the mono-sentences change (spec 2026-10-26-mono-sentences,
 * deferred items): the repository card's two captions are sentences, so sans
 * with their facts in mono, as the Prune caption is; the card's error boxes
 * and the pages' refresh alert hold sentences, so sans, as the add page's
 * boxes are.
 */

afterEach(() => cleanup());

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/);

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;

async function page(hostname: string, tweak: (p: Detail) => Detail = (p) => p): Promise<HTMLElement> {
  const { payload } = await seedSiteDetailPayload(hostname);
  return render(<SiteDetail payload={tweak(payload)} />).container;
}

function caption(root: HTMLElement, startsWith: string): HTMLElement {
  const p = Array.from(root.querySelectorAll<HTMLElement>("p")).find((x) => x.textContent?.startsWith(startsWith));
  assert.ok(p, `no caption starting "${startsWith}"`);
  return p;
}

const facts = (el: HTMLElement) => Array.from(el.querySelectorAll("span")).map((s) => [s.textContent, s.getAttribute("class")]);

describe("the repository card's captions are sentences", () => {
  test("the attach caption: sans, its file and repository as mono facts", async () => {
    const p = caption(await page("legacy.lychee.land"), "Writes ");
    assert.equal(p.textContent, "Writes legacy-lychee-land.yml to lychee-resources, with no tag until the first deploy.");
    assert.ok(!classes(p).includes("font-mono"), "the caption is mono");
    assert.deepEqual(facts(p), [
      ["legacy-lychee-land.yml", "font-mono text-stone-50 [overflow-wrap:anywhere]"],
      ["lychee-resources", "font-mono text-stone-50 whitespace-nowrap"],
    ]);
  });

  test("the change-repository caption: sans, its file as a mono fact", async () => {
    const root = await page("preview.lychee.land", (pl) => ({ ...pl, resource: pl.resource && { ...pl.resource, available: undefined } }));
    const p = caption(root, "Rewrites ");
    assert.equal(p.textContent, "Rewrites the image line in preview-lychee-land.yml, only while it has no tag.");
    assert.ok(!classes(p).includes("font-mono"), "the caption is mono");
    assert.deepEqual(facts(p), [["preview-lychee-land.yml", "font-mono text-stone-50 [overflow-wrap:anywhere]"]]);
  });
});

describe("error boxes that hold sentences are sans", () => {
  test("the repository card's attach and change-repository errors", async () => {
    const root = await page("preview.lychee.land", (pl) => ({ ...pl, resource: pl.resource && { ...pl.resource, available: undefined } }));
    for (const id of ["change-repo-error"]) {
      const box = root.querySelector(`#${id}`);
      assert.ok(box, `no #${id}`);
      assert.ok(classes(box).includes("text-red-300"), `${id} lost its tone`);
      assert.ok(!classes(box).includes("font-mono"), `${id} is mono`);
    }
    cleanup();
    const legacy = await page("legacy.lychee.land");
    const attach = legacy.querySelector("#attach-error");
    assert.ok(attach, "no #attach-error");
    assert.ok(!classes(attach).includes("font-mono"), "attach-error is mono");
  });

  test("the pages' refresh alert", () => {
    assert.ok(BOARD_ALERT.split(" ").includes("text-red-300"));
    assert.ok(!BOARD_ALERT.split(" ").includes("font-mono"), "BOARD_ALERT is mono");
  });
});
