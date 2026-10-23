import "../test/setup";
import assert from "node:assert/strict";
import { after, before, describe, mock, test } from "node:test";
import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { act, fireEvent } from "@testing-library/react";
// Imported before anything loads config: it pins the settings the recorded answers depend on.
import { requestKey } from "../../dev/addSiteAnswers";
import { seedAddSitePayload, testShell } from "../../dev/testHelpers";
import type { AddSitePayload } from "../../shared/addSite";
import { renderClientPage } from "../../views/clientShell";
import { canonical } from "../test/canonical";
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
import { AddSiteBody } from "./AddSitePage";

// The React add page held to the server's page with the real public/app.js,
// step for step, through the dual-run harness (src/client/test/addSiteDualRun.ts):
// <main> under both canonical modes, and the toast, the submit button, the
// requests and the focus exactly.

const answers = recorded as StubAnswers;
let payload: AddSitePayload;
let reference: Snapshot[];
let candidate: Snapshot[];

/**
 * Writes the real shell (layout() through renderClientPage, the seed's rail)
 * into the document, without its script tags, as the reference does.
 */
function writeShell(): HTMLElement {
  const page = renderClientPage("Add a site", "sites", testShell());
  const match = /<body class="([^"]*)">([\s\S]*)<\/body>/.exec(page);
  if (!match) throw new Error("renderClientPage's page has no <body> — the anchor is stale");
  document.body.className = match[1];
  document.body.innerHTML = match[2].replace(/<script src="[^"]*"><\/script>/g, "");
  const root = document.getElementById("app-root");
  if (!root) throw new Error("no #app-root in the shell");
  return root;
}

/** The candidate: AddSiteBody mounted into the real shell's #app-root. Returns its teardown. */
function mountCandidate(p: AddSitePayload, go: (href: string) => void = () => {}): () => void {
  const root = createRoot(writeShell());
  act(() => root.render(<AddSiteBody payload={p} headingRef={createRef<HTMLHeadingElement>()} go={go} />));
  return () => act(() => root.unmount());
}

before(async () => {
  payload = await seedAddSitePayload();
  reference = await referenceRun(payload, answers);
  candidate = await candidateRun(() => mountCandidate(payload), answers);
});

describe("the React add page against renderAddSite + public/app.js", () => {
  test("both runs snapshot every step", () => {
    assert.equal(reference.length, ADD_SITE_STEPS.length);
    assert.equal(candidate.length, ADD_SITE_STEPS.length);
  });

  ADD_SITE_STEPS.forEach((step, i) => {
    test(`${i + 1}: ${step.name}`, () => {
      const r = reference[i];
      const c = candidate[i];
      assert.equal(canonical(c.main), canonical(r.main), "<main>");
      assert.equal(canonical(c.main, { inlineWhitespace: true }), canonical(r.main, { inlineWhitespace: true }), "<main>, inline whitespace");
      assert.equal(c.toast, r.toast, "toast");
      assert.equal(c.submit, r.submit, "submit");
      assert.deepEqual(c.fetches, r.fetches, "fetches");
      assert.equal(c.focus, r.focus, "focus");
    });
  });
});

describe("the harness can fail", () => {
  test("a candidate that evaluates app.js twice (a leaked listener) differs", async () => {
    const twice = await candidateRun(() => {
      writeAddSiteReference(payload);
      const first = evaluateAppJs();
      const second = evaluateAppJs();
      return () => {
        first();
        second();
      };
    }, answers);
    assert.notDeepEqual(twice, reference);
  });

  test("a candidate that adds one class after mount differs", async () => {
    const extra = await candidateRun(() => {
      const teardown = mountCandidate(payload);
      document.getElementById("add-site-columns")?.classList.add("extra");
      return teardown;
    }, answers);
    assert.notDeepEqual(extra, reference);
  });
});

// --- Review focus: driven by hand, outside the eleven steps ---------------

type Held = { key: string; resolve: (r: Response) => void };

function response(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

/** A mounted candidate with a held fetch and a mocked clock, for one test. */
function session(p: AddSitePayload = payload) {
  const held: Held[] = [];
  const sent: string[] = [];
  const go = mock.fn<(href: string) => void>();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)} ${init?.body == null ? "" : String(init.body)}`;
    sent.push(key);
    return new Promise<Response>((resolve) => held.push({ key, resolve }));
  }) as typeof fetch;
  mock.timers.enable({ apis: ["setTimeout"] });
  const teardown = mountCandidate(p, go);
  const el = <T extends Element>(selector: string): T => {
    const found = document.querySelector<T>(selector);
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };
  return {
    held,
    sent,
    go,
    el,
    async answer(index: number, status: number, body: unknown) {
      const [h] = held.splice(index, 1);
      act(() => h.resolve(response(status, body)));
      await flush();
    },
    async answerRecorded(index: number) {
      const a = answers[held[index].key];
      if (!a) throw new Error(`no recorded answer for ${held[index].key}`);
      await this.answer(index, a.status, a.body);
    },
    async type(selector: string, text: string) {
      const field = el<HTMLInputElement>(selector);
      act(() => field.focus());
      fireEvent.input(field, { target: { value: text } });
      await flush();
    },
    async submit() {
      fireEvent.click(el<HTMLButtonElement>("#add-site-submit"));
      await flush();
    },
    async tick(ms: number) {
      act(() => mock.timers.tick(ms));
      await flush();
    },
    end() {
      teardown();
      mock.timers.reset();
      globalThis.fetch = savedFetch;
      document.body.className = "";
      document.body.innerHTML = "";
    },
  };
}

const addKey = (hostname: string) =>
  requestKey({ url: "/sites", fields: { hostname, type: "static", port: "", framework: "none", healthcheckPath: "" } });

describe("review focus", () => {
  let s: ReturnType<typeof session> | undefined;
  after(() => s?.end());

  test("RF1: a submit typed within 100 ms of a fix sends one POST /sites with the typed hostname, and a later preview leaves it unblocked", async () => {
    s = session();
    await s.answerRecorded(0); // the arrival preview
    await s.type("#hostname-field", "blog");
    await s.tick(250);
    await s.answerRecorded(0); // blog already exists: blocked
    assert.equal(s.el("#add-site-submit").getAttribute("aria-disabled"), "true");

    await s.type("#hostname-field", "shop");
    await s.tick(50);
    await s.submit();
    await s.submit(); // a second click while the first is in flight
    const posts = s.sent.filter((k) => k.startsWith("POST /sites "));
    assert.deepEqual(posts, [addKey("shop.lychee.land")]);

    // The debounce runs out after the submit; its (ready) answer must not block.
    await s.tick(250);
    const preview = s.held.findIndex((h) => h.key.startsWith("POST /sites/preview "));
    assert.ok(preview !== -1, "the debounced preview went out");
    await s.answerRecorded(preview);
    const submit = s.el("#add-site-submit");
    assert.ok(!submit.hasAttribute("aria-disabled"));
    assert.ok(!submit.hasAttribute("aria-describedby"));
    assert.equal(s.sent.filter((k) => k.startsWith("POST /sites ")).length, 1);
    s.end();
    s = undefined;
  });

  test("RF5: after a failed submit, a persisted pageshow enables the button, hides the toast and sends one preview", async () => {
    s = session();
    await s.answerRecorded(0);
    await s.type("#hostname-field", "shop");
    await s.submit();
    const add = s.held.findIndex((h) => h.key.startsWith("POST /sites "));
    await s.answer(add, 500, { error: "boom", steps: [] });
    assert.equal(s.el("#add-site-error").textContent, "boom");
    // A second submit puts the page back in flight, as a success would leave it.
    await s.submit();
    assert.ok(s.el("#add-site-submit").hasAttribute("disabled"));
    assert.ok(!s.el("#flash-banner").classList.contains("hidden"));

    const before = s.sent.length;
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(event);
    });
    await flush();
    assert.ok(!s.el("#add-site-submit").hasAttribute("disabled"));
    assert.ok(s.el("#flash-banner").classList.contains("hidden"));
    const after = s.sent.slice(before);
    assert.equal(after.length, 1);
    assert.ok(after[0].startsWith("POST /sites/preview "));
    s.end();
    s = undefined;
  });

  test("a success makes a full load of the new site's page", async () => {
    s = session();
    await s.answerRecorded(0);
    await s.type("#hostname-field", "blog2");
    await s.submit();
    const add = s.held.findIndex((h) => h.key.startsWith("POST /sites "));
    await s.answer(add, 200, { ok: true, hostname: "blog2.lychee.land" });
    assert.equal(s.go.mock.callCount(), 1);
    assert.deepEqual(s.go.mock.calls[0].arguments, ["/sites/blog2.lychee.land?created=1"]);
    s.end();
    s = undefined;
  });

  test("a pageshow listener is removed on unmount", async () => {
    s = session();
    await s.answerRecorded(0);
    s.end();
    s = undefined;
    const sent: string[] = [];
    const savedFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      sent.push(String(input));
      return new Promise<Response>(() => {});
    }) as typeof fetch;
    try {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
      assert.deepEqual(sent, []);
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test("an unreadable Caddyfile renders CaddyfileError instead of the form", () => {
    const teardown = mountCandidate({ ...payload, caddyfileError: "Command failed: cat\nno such file" });
    try {
      const root = document.getElementById("app-root");
      assert.ok(root);
      assert.ok(!root.querySelector("#add-site-form"));
      assert.equal(root.querySelector("p")?.textContent, "Command failed: cat\nno such file");
      assert.equal(root.querySelector("a")?.getAttribute("href"), "/");
    } finally {
      teardown();
      document.body.innerHTML = "";
    }
  });
});
