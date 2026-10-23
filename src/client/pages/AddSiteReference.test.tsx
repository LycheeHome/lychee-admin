import "../test/setup";
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import bcrypt from "bcrypt";
// Imported before anything loads config: it pins the settings an answer depends on.
import { ADD_SITE_REQUESTS, recordAddSiteAnswers, requestKey } from "../../dev/addSiteAnswers";
import { seedAddSitePayload } from "../../dev/testHelpers";
import type { AddSitePayload } from "../../shared/addSite";
import recorded from "../test/addSiteAnswers.json";
import {
  ADD_SITE_STEPS,
  candidateRun,
  evaluateAppJs,
  referenceRun,
  writeAddSiteReference,
  type Snapshot,
  type StubAnswers,
} from "../test/addSiteDualRun";

// The dev user's password, hashed cheaply: src/dev/env.ts only fills it in
// when unset, and the recorder signs in on every request.
process.env.ADMIN_PASSWORD_HASH = bcrypt.hashSync("dev", 4);

// The reference side of the add page's dual run, before any React exists:
// the harness must reach every branch the spec's steps name on the server's
// page with the real app.js, or the candidate's parity with it proves less
// than it claims.

const answers = recorded as StubAnswers;
let payload: AddSitePayload;
let snapshots: Snapshot[];

before(async () => {
  payload = await seedAddSitePayload();
  snapshots = await referenceRun(payload, answers);
});

function step(name: string): Snapshot {
  const index = ADD_SITE_STEPS.findIndex((s) => s.name === name);
  assert.ok(index !== -1, `no step named ${name}`);
  return snapshots[index];
}

/** A snapshot's `<main>`, parsed, to query. */
function main(snapshot: Snapshot): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = snapshot.main;
  return template.content;
}

function one(fragment: DocumentFragment | Element, selector: string): Element {
  const found = fragment.querySelector(selector);
  assert.ok(found, `no ${selector}`);
  return found;
}

/** A static preview's key, in the field order app.js sends. */
const preview = (hostname: string) =>
  requestKey({ url: "/sites/preview", fields: { hostname, type: "static", port: "", framework: "none", healthcheckPath: "" } });

describe("the add page's reference run (renderAddSite + public/app.js)", () => {
  test("snapshots once per step, the spec's eleven", () => {
    assert.equal(ADD_SITE_STEPS.length, 11);
    assert.equal(snapshots.length, 11);
  });

  test("1: at rest, the arrival preview leaves the server's at-rest panel", () => {
    const s = step("at-rest");
    assert.deepEqual(s.fetches, [preview("")]);
    const page = main(s);
    assert.equal(one(page, "#composed-hostname").textContent, "Add a site");
    assert.match(one(page, "#preview-body").textContent ?? "", /Name the site and the exact block and route appear here/);
    assert.ok(!one(page, "#add-site-submit").hasAttribute("aria-disabled"));
  });

  test("2: typing blog composes blog + .lychee.land, the suffix dimmed", () => {
    const heading = one(main(step("typing-blog")), "#composed-hostname");
    assert.equal(heading.childNodes[0].textContent, "blog");
    assert.equal(one(heading, "span.text-stone-500").textContent, ".lychee.land");
    assert.equal(heading.textContent, "blog.lychee.land");
  });

  test("3: a full hostname is not doubled, and its ready preview has all three sections", () => {
    const s = step("typing-a-full-hostname");
    assert.deepEqual(s.fetches, [preview("shop.lychee.land")]);
    const page = main(s);
    assert.equal(one(page, "#composed-hostname").textContent, "shop.lychee.land");
    assert.equal(page.querySelectorAll("#preview-body > div").length, 3);
    assert.ok(one(page, "#preview-error").classList.contains("hidden"));
  });

  test("4: reverse proxy shows the port block with inline display: flex", () => {
    const page = main(step("switching-to-reverse-proxy"));
    assert.equal(one(page, ".port-input").getAttribute("style"), "display: flex;");
    assert.ok(!one(page, "#port-field").hasAttribute("disabled"));
  });

  test("5: a claimed port shows the seed's owner sentence in #port-error", () => {
    const page = main(step("a-free-port-then-a-claimed-one"));
    const sentence = payload.portOwners["4000"];
    assert.ok(sentence, "the seed's api.lychee.land owns 4000");
    const portError = one(page, "#port-error");
    assert.ok(!portError.classList.contains("hidden"));
    assert.equal(portError.textContent, sentence);
  });

  test("6: Next.js shows the healthcheck field and points the proxy radio at its description", () => {
    const page = main(step("nextjs-then-a-healthcheck-path"));
    assert.equal(one(page, "#healthcheck-field-wrapper").getAttribute("style"), "display: flex;");
    assert.equal(one(page, PROXY_RADIO).getAttribute("aria-describedby"), "type-proxy-description-nextjs");
    assert.ok(one(page, "#type-proxy-description").classList.contains("hidden"));
    assert.ok(!one(page, "#type-proxy-description-nextjs").classList.contains("hidden"));
  });

  test("7: a preview error blocks submit, and the blocked submit sends nothing and focuses the reason", () => {
    const s = step("a-preview-error-then-a-blocked-submit");
    const submit = one(main(s), "#add-site-submit");
    assert.equal(submit.getAttribute("aria-disabled"), "true");
    assert.equal(submit.getAttribute("aria-describedby"), "preview-error");
    assert.equal(s.focus, "preview-error");
    assert.ok(!s.fetches.some((f) => f.startsWith("POST /sites ")));
    assert.equal(one(main(s), "#preview-error").textContent, "blog.lychee.land already exists in the Caddyfile");
  });

  test("8: an empty submit reads Enter a hostname.", () => {
    const s = step("an-empty-submit");
    const error = one(main(s), "#add-site-error");
    assert.ok(!error.classList.contains("hidden"));
    assert.equal(error.textContent, "Enter a hostname.");
    assert.ok(!s.fetches.some((f) => f.startsWith("POST /sites ")));
  });

  test("9: a failed submit marks the steps from the answer, hides the toast and shows the error", () => {
    const s = step("a-failed-submit-with-step-marks");
    const sent = s.fetches.filter((f) => f.startsWith("POST /sites "));
    assert.equal(sent.length, 1);
    const page = main(s);
    const marks = Array.from(page.querySelectorAll("#add-site-steps .step-mark")).map((m) => m.textContent);
    assert.deepEqual(marks, ["✓", "✓", "—", "✓", "✗", "·"]);
    assert.ok(one(page, '[data-step-id="caddy"] .step-mark').classList.contains("text-red-300"));
    assert.ok(main({ ...s, main: s.toast }).querySelector("#flash-banner.hidden"), "the toast is hidden");
    const failure = (answers[sent[0]].body as { error: string }).error;
    assert.equal(one(page, "#add-site-error").textContent, failure);
    assert.ok(!one(page, "#add-site-submit").hasAttribute("disabled"));
    // The failure re-runs the preview; its answer is the next step's.
    assert.equal(s.fetches.filter((f) => f.startsWith("POST /sites/preview ")).length, 1);
  });

  test("10: the stale answer does not overwrite the newer panel", () => {
    const body = one(main(step("a-stale-preview-answer")), "#preview-body").textContent ?? "";
    assert.match(body, /reverse_proxy localhost:3700/);
    assert.doesNotMatch(body, /3600/);
    const marks = Array.from(main(step("a-stale-preview-answer")).querySelectorAll("#add-site-steps .step-mark")).map(
      (m) => m.textContent,
    );
    assert.deepEqual(marks, ["", "", "—", "", "", ""]);
  });

  test("11: a persisted pageshow re-enables submit, hides the toast and re-runs the preview", () => {
    const s = step("the-pageshow-restore");
    const page = main(s);
    assert.ok(!one(page, "#add-site-submit").hasAttribute("disabled"));
    assert.ok(main({ ...s, main: s.toast }).querySelector("#flash-banner.hidden"), "the toast is hidden");
    assert.deepEqual(
      s.fetches.map((f) => f.split(" ").slice(0, 2).join(" ")),
      ["POST /sites", "POST /sites/preview"],
    );
  });

  test("every recorded answer is asked for by some step", () => {
    const asked = new Set(snapshots.flatMap((s) => s.fetches));
    for (const key of Object.keys(answers)) assert.ok(asked.has(key), `unused answer ${key}`);
  });
});

describe("the harness", () => {
  test("a candidate that renders the reference page is identical to it, step for step", async () => {
    const candidate = await candidateRun(() => {
      writeAddSiteReference(payload);
      return evaluateAppJs();
    }, answers);
    // A second run in the same document: equal only if the first left no
    // listener, timer or stub behind.
    assert.deepEqual(candidate, snapshots);
  });

  test("the recorded answers are what the seeded dev app answers now", async () => {
    assert.deepEqual(
      Object.keys(answers),
      ADD_SITE_REQUESTS.map(requestKey),
      "re-record: npx tsx src/dev/addSiteAnswers.ts > src/client/test/addSiteAnswers.json",
    );
    assert.deepEqual(
      await recordAddSiteAnswers(),
      answers,
      "re-record: npx tsx src/dev/addSiteAnswers.ts > src/client/test/addSiteAnswers.json",
    );
  });
});

const PROXY_RADIO = 'input[name="type"][value="reverse-proxy"]';
