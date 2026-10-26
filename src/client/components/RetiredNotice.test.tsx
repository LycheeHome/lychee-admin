import "../test/setup";
import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { cleanup, render } from "@testing-library/react";
import { seedSiteDetailPayload } from "../../dev/testHelpers";
import { BUTTON_PRIMARY_COMPACT, BUTTON_SECONDARY } from "../../views/shared";
import { SiteDetail } from "./SiteDetail";

/*
 * The retired-state spec (2026-10-26): a site re-added over a `state: absent`
 * declaration shows its notice and Prune directly under the header, where the
 * frozen gone-detached fixture (retired by this change) had them inside
 * runbook step 3, about 2,780px down.
 */

afterEach(() => cleanup());

async function page(hostname: string): Promise<HTMLElement> {
  const { payload } = await seedSiteDetailPayload(hostname);
  return render(<SiteDetail payload={payload} />).container;
}

const NOTICE = "gone-lychee-land.yml is retired (state: absent). Attaching a repository is refused until it is pruned.";
const WARNING = "Attaching is refused while gone-lychee-land.yml is retired. Prune it above; pressing Attach checks again.";

const notice = (root: HTMLElement) => root.querySelector<HTMLElement>('section[aria-label="Retired declaration"]');

describe("the retired notice", () => {
  test("sits between the header and the request path", async () => {
    const root = await page("gone.lychee.land");
    const card = notice(root);
    assert.ok(card, "no retired notice");
    const heading = root.querySelector("h2");
    const path = Array.from(root.querySelectorAll("section")).find((s) => s.textContent?.startsWith("Request path"));
    assert.ok(heading && path);
    assert.ok(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING, "the notice is above the header");
    assert.ok(card.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING, "the notice is below the request path");
  });

  test("says what is retired, with the machine facts in mono", async () => {
    const card = notice(await page("gone.lychee.land"))!;
    const sentence = card.querySelector("p");
    assert.equal(sentence?.textContent, NOTICE);
    const mono = Array.from(sentence!.querySelectorAll("span")).map((s) => s.textContent);
    assert.deepEqual(mono, ["gone-lychee-land.yml", "state: absent"]);
  });

  // At 390px the mono fact class's break-all split it as "abse / nt"; a short
  // fact keeps together, while the file name may still break if it must.
  test("state: absent never breaks inside itself", async () => {
    const spans = notice(await page("gone.lychee.land"))!.querySelectorAll("p span");
    const state = Array.from(spans).find((s) => s.textContent === "state: absent")!;
    const cls = state.getAttribute("class") ?? "";
    assert.match(cls, /\bwhitespace-nowrap\b/);
    assert.doesNotMatch(cls, /\bbreak-all\b/);
  });

  test("holds the page's one Prune, as the compact primary, with Visit secondary", async () => {
    const root = await page("gone.lychee.land");
    const prunes = root.querySelectorAll("[data-prune]");
    assert.equal(prunes.length, 1);
    assert.ok(notice(root)!.contains(prunes[0]!));
    assert.equal(prunes[0]!.getAttribute("class"), BUTTON_PRIMARY_COMPACT);
    const visit = Array.from(root.querySelectorAll("a")).find((a) => a.textContent?.startsWith("Visit"));
    assert.ok(visit?.getAttribute("class")?.startsWith(BUTTON_SECONDARY));
  });

  test("step 3 keeps a shortened warning for Attach, and no Prune of its own", async () => {
    const root = await page("gone.lychee.land");
    const warning = root.querySelector("#attach-warning");
    assert.equal(warning?.textContent, WARNING);
    const attach = root.querySelector<HTMLButtonElement>("form[data-attach] button[type=submit]");
    assert.match(attach?.getAttribute("aria-describedby") ?? "", /\battach-warning\b/);
    assert.ok(!root.querySelector("form[data-attach] [data-prune]"));
  });

  test("is absent on a site that is not retired", async () => {
    for (const host of ["legacy.lychee.land", "app.lychee.land", "lychee.land"]) {
      assert.ok(!notice(await page(host)), `${host} shows a retired notice`);
      cleanup();
    }
  });
});
