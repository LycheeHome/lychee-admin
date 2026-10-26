import "../test/setup";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, before, describe, mock, test } from "node:test";
import { createRef } from "react";
import { showToast } from "../toast";
import { createRoot } from "react-dom/client";
import { act, fireEvent } from "@testing-library/react";
// Imported before anything loads config: it pins the settings the recorded answers depend on.
import { requestKey } from "../../dev/addSiteAnswers";
import { seedAddSitePayload } from "../../dev/testHelpers";
import type { AddSitePayload } from "../../shared/addSite";
import { canonical } from "../test/canonical";
import { applyRedesigns } from "../test/redesigns";
import { STATIC_BODY_CLASS } from "../test/staticDocument";
import recorded from "../test/addSiteAnswers.json";
import { ADD_SITE_STEPS, candidateRun, type Snapshot, type StubAnswers } from "../test/addSiteDualRun";
import { AddSiteBody } from "./AddSitePage";

// The React add page held to the retired server add page with the retired
// public/app.js evaluated against it, step for step, through the dual-run
// harness (src/client/test/addSiteDualRun.ts): <main> under both canonical
// modes, and the toast, the submit button, the requests and the focus
// exactly. The reference side is frozen (see `frozen`).

const answers = recorded as StubAnswers;
let payload: AddSitePayload;
let reference: Snapshot[];
let candidate: Snapshot[];

// In src/dev, not src/client: outside the design detector's scope, and like
// all of src/dev, outside the build and the release tree.
const FIXTURES = path.join(__dirname, "../../dev/fixtures/add-site");
const read = new Set<string>();

/** A step's fixture name: its position, then its slug. */
const fixtureName = (i: number) => `${String(i + 1).padStart(2, "0")}-${ADD_SITE_STEPS[i].name}`;

/**
 * The reference run's snapshot for step `i`, frozen. `<NN-step>.html` is the
 * step's `main` exactly as the harness snapshotted it (#app-root unwrapped,
 * #port-owners-data dropped), and `meta.json` holds its `toast`, `submit`,
 * `fetches` and `focus` under the same name. They are the last output of
 * the retired renderAddSite with the retired public/app.js driven through
 * every step against the same recorded answers, generated from the live
 * reference run and asserted byte-equal to a second live run before either
 * was deleted. They are never regenerated: there is nothing left to
 * generate them from.
 */
function frozen(i: number, meta: Record<string, Omit<Snapshot, "main">>): Snapshot {
  const name = fixtureName(i);
  read.add(`${name}.html`);
  const facts = meta[name];
  assert.ok(facts, `meta.json has no ${name}`);
  return { main: applyRedesigns(readFileSync(path.join(FIXTURES, `${name}.html`), "utf8")), ...facts };
}

/** Whether a run matches the frozen reference by the per-step test's own comparisons, at every step. */
function matchesReference(run: Snapshot[]): boolean {
  if (run.length !== reference.length) return false;
  return run.every((c, i) => {
    const r = reference[i];
    return (
      canonical(c.main) === canonical(r.main) &&
      canonical(c.main, { inlineWhitespace: true }) === canonical(r.main, { inlineWhitespace: true }) &&
      c.toast === r.toast &&
      c.submit === r.submit &&
      JSON.stringify(c.fetches) === JSON.stringify(r.fetches) &&
      c.focus === r.focus
    );
  });
}

/**
 * Writes the shell around the add page into the document, as the reference
 * had it: the retired server shell's body for /sites/new, frozen in
 * src/dev/fixtures/shell/add-site.html (which AppFrameParity.test.tsx holds
 * AppFrame to), without its rail-data script, under the static document's
 * body classes. The page mounts into its #app-root.
 */
function writeShell(): HTMLElement {
  const shell = readFileSync(path.join(__dirname, "../../dev/fixtures/shell/add-site.html"), "utf8");
  document.body.className = STATIC_BODY_CLASS;
  document.body.innerHTML = shell.replace(/<script type="application\/json" id="rail-data">[\s\S]*?<\/script>/, "");
  const root = document.getElementById("app-root");
  if (!root) throw new Error("no #app-root in the shell fixture");
  return root;
}

/** The candidate: AddSiteBody mounted into the frozen shell's #app-root. Returns its teardown. */
function mountCandidate(p: AddSitePayload, go: (href: string) => void = () => {}): () => void {
  const root = createRoot(writeShell());
  act(() => root.render(<AddSiteBody payload={p} headingRef={createRef<HTMLHeadingElement>()} go={go} />));
  return () => act(() => root.unmount());
}

before(async () => {
  payload = await seedAddSitePayload();
  const meta = JSON.parse(readFileSync(path.join(FIXTURES, "meta.json"), "utf8")) as Record<string, Omit<Snapshot, "main">>;
  assert.deepEqual(Object.keys(meta), ADD_SITE_STEPS.map((_, i) => fixtureName(i)), "meta.json names every step, in order");
  reference = ADD_SITE_STEPS.map((_, i) => frozen(i, meta));
  candidate = await candidateRun(() => mountCandidate(payload), answers);
});

/** A frozen step's `<main>`, parsed, to query. */
function parsed(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function one(fragment: DocumentFragment | Element, selector: string): Element {
  const found = fragment.querySelector(selector);
  assert.ok(found, `no ${selector}`);
  return found;
}

const stepOf = (name: string): Snapshot => {
  const index = ADD_SITE_STEPS.findIndex((s) => s.name === name);
  assert.ok(index !== -1, `no step named ${name}`);
  return reference[index];
};

/** A static preview's key, in the field order the page sends. */
const previewKey = (hostname: string) =>
  requestKey({ url: "/sites/preview", fields: { hostname, type: "static", port: "", framework: "none", healthcheckPath: "" } });

const PROXY_RADIO = 'input[name="type"][value="reverse-proxy"]';

// What each step was written to reach, asserted on the frozen reference: a
// fixture that stopped reaching its branch would still compare equal to a
// candidate that never reaches it either. These were the retired reference
// test's assertions against the live run.
describe("the frozen reference reaches each step's branch", () => {
  test("one fixture per step, the spec's eleven", () => {
    assert.equal(ADD_SITE_STEPS.length, 11);
    assert.equal(reference.length, 11);
  });

  test("1: at rest, the arrival preview leaves the server's at-rest panel", () => {
    const s = stepOf("at-rest");
    assert.deepEqual(s.fetches, [previewKey("")]);
    const page = parsed(s.main);
    assert.equal(one(page, "#composed-hostname").textContent, "Add a site");
    assert.match(one(page, "#preview-body").textContent ?? "", /Name the site and the exact block and route appear here/);
    assert.ok(!one(page, "#add-site-submit").hasAttribute("aria-disabled"));
  });

  test("2: typing blog composes blog + .lychee.land, the suffix dimmed", () => {
    const heading = one(parsed(stepOf("typing-blog").main), "#composed-hostname");
    assert.equal(heading.childNodes[0].textContent, "blog");
    assert.equal(one(heading, "span.text-stone-500").textContent, ".lychee.land");
    assert.equal(heading.textContent, "blog.lychee.land");
  });

  test("3: a full hostname is not doubled, and its ready preview has all three sections", () => {
    const s = stepOf("typing-a-full-hostname");
    assert.deepEqual(s.fetches, [previewKey("shop.lychee.land")]);
    const page = parsed(s.main);
    assert.equal(one(page, "#composed-hostname").textContent, "shop.lychee.land");
    assert.equal(page.querySelectorAll("#preview-body > div").length, 3);
    assert.ok(one(page, "#preview-error").classList.contains("hidden"));
  });

  test("4: reverse proxy shows the port block with inline display: flex", () => {
    const page = parsed(stepOf("switching-to-reverse-proxy").main);
    assert.equal(one(page, ".port-input").getAttribute("style"), "display: flex;");
    assert.ok(!one(page, "#port-field").hasAttribute("disabled"));
  });

  test("5: a claimed port shows the seed's owner sentence in #port-error", () => {
    const page = parsed(stepOf("a-free-port-then-a-claimed-one").main);
    const sentence = payload.portOwners["4000"];
    assert.ok(sentence, "the seed's api.lychee.land owns 4000");
    const portError = one(page, "#port-error");
    assert.ok(!portError.classList.contains("hidden"));
    assert.equal(portError.textContent, sentence);
  });

  test("6: Next.js shows the healthcheck field and points the proxy radio at its description", () => {
    const page = parsed(stepOf("nextjs-then-a-healthcheck-path").main);
    assert.equal(one(page, "#healthcheck-field-wrapper").getAttribute("style"), "display: flex;");
    assert.equal(one(page, PROXY_RADIO).getAttribute("aria-describedby"), "type-proxy-description-nextjs");
    assert.ok(one(page, "#type-proxy-description").classList.contains("hidden"));
    assert.ok(!one(page, "#type-proxy-description-nextjs").classList.contains("hidden"));
  });

  test("7: a preview error blocks submit, and the blocked submit sends nothing and focuses the reason", () => {
    const s = stepOf("a-preview-error-then-a-blocked-submit");
    const submit = one(parsed(s.main), "#add-site-submit");
    assert.equal(submit.getAttribute("aria-disabled"), "true");
    assert.equal(submit.getAttribute("aria-describedby"), "preview-error");
    assert.equal(s.focus, "preview-error");
    assert.ok(!s.fetches.some((f) => f.startsWith("POST /sites ")));
    assert.equal(one(parsed(s.main), "#preview-error").textContent, "blog.lychee.land already exists in the Caddyfile");
  });

  test("8: an empty submit reads Enter a hostname.", () => {
    const s = stepOf("an-empty-submit");
    const error = one(parsed(s.main), "#add-site-error");
    assert.ok(!error.classList.contains("hidden"));
    assert.equal(error.textContent, "Enter a hostname.");
    assert.ok(!s.fetches.some((f) => f.startsWith("POST /sites ")));
  });

  test("9: a failed submit marks the steps from the answer, hides the toast and shows the error", () => {
    const s = stepOf("a-failed-submit-with-step-marks");
    const sent = s.fetches.filter((f) => f.startsWith("POST /sites "));
    assert.equal(sent.length, 1);
    const page = parsed(s.main);
    const marks = Array.from(page.querySelectorAll("#add-site-steps .step-mark")).map((m) => m.textContent);
    assert.deepEqual(marks, ["✓", "✓", "—", "✓", "✗", "·"]);
    assert.ok(one(page, '[data-step-id="caddy"] .step-mark').classList.contains("text-red-300"));
    assert.ok(parsed(s.toast).querySelector("#flash-banner.hidden"), "the toast is hidden");
    const failure = (answers[sent[0]].body as { error: string }).error;
    assert.equal(one(page, "#add-site-error").textContent, failure);
    assert.ok(!one(page, "#add-site-submit").hasAttribute("disabled"));
    // The failure re-runs the preview; its answer is the next step's.
    assert.equal(s.fetches.filter((f) => f.startsWith("POST /sites/preview ")).length, 1);
  });

  test("10: the stale answer does not overwrite the newer panel", () => {
    const page = parsed(stepOf("a-stale-preview-answer").main);
    const body = one(page, "#preview-body").textContent ?? "";
    assert.match(body, /reverse_proxy localhost:3700/);
    assert.doesNotMatch(body, /3600/);
    const marks = Array.from(page.querySelectorAll("#add-site-steps .step-mark")).map((m) => m.textContent);
    assert.deepEqual(marks, ["", "", "—", "", "", ""]);
  });

  test("11: a persisted pageshow re-enables submit, hides the toast and re-runs the preview", () => {
    const s = stepOf("the-pageshow-restore");
    assert.ok(!one(parsed(s.main), "#add-site-submit").hasAttribute("disabled"));
    assert.ok(parsed(s.toast).querySelector("#flash-banner.hidden"), "the toast is hidden");
    assert.deepEqual(
      s.fetches.map((f) => f.split(" ").slice(0, 2).join(" ")),
      ["POST /sites", "POST /sites/preview"],
    );
  });

  test("every recorded answer is asked for by some step", () => {
    const asked = new Set(reference.flatMap((s) => s.fetches));
    for (const key of Object.keys(answers)) assert.ok(asked.has(key), `unused answer ${key}`);
  });
});

describe("the React add page against the frozen reference", () => {
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

// Each control is judged by matchesReference, the per-step test's own
// comparisons, so a control passing means that comparison can fail.
describe("the harness can fail", () => {
  test("the candidate matches by the same comparison the controls use", () => {
    assert.ok(matchesReference(candidate));
  });

  test("a second candidate run in the same document matches too: the first left nothing behind", async () => {
    assert.ok(matchesReference(await candidateRun(() => mountCandidate(payload), answers)));
  });

  // Replaces "app.js evaluated twice", which needed the live app.js. That
  // control proved a leaked second set of listeners shows up as duplicate
  // requests; the same leak on the React side is a second copy of the page's
  // behaviour still running where nobody sees it. The second root renders
  // into a detached node, so <main> is untouched and only what it does (its
  // arrival preview, its pageshow listener) can tell the runs apart.
  test("a candidate with a second, unseen copy of the page running (a leaked listener) differs", async () => {
    const leaked = await candidateRun(() => {
      const teardown = mountCandidate(payload);
      const hidden = createRoot(document.createElement("div"));
      act(() => hidden.render(<AddSiteBody payload={payload} headingRef={createRef<HTMLHeadingElement>()} go={() => {}} />));
      return () => {
        act(() => hidden.unmount());
        teardown();
      };
    }, answers).then(matchesReference, () => false);
    // Today the leak's extra arrival preview sits first in the queue, so the
    // script's answers go to the wrong requests and the run stops at a
    // request it has no answer for; either way, the parity suite fails.
    assert.equal(leaked, false);
  });

  test("a candidate that adds one class after mount differs", async () => {
    const extra = await candidateRun(() => {
      const teardown = mountCandidate(payload);
      document.getElementById("add-site-columns")?.classList.add("extra");
      return teardown;
    }, answers);
    assert.ok(!matchesReference(extra));
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
  let mounted = true;
  let ended = false;
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
    /** Unmounts the page only: the shell, the stubs and the clock stay. Idempotent. */
    unmount() {
      if (mounted) teardown();
      mounted = false;
    },
    /** Unmounts and restores everything. Idempotent, so afterEach can always call it. */
    end() {
      if (ended) return;
      ended = true;
      this.unmount();
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
  // Per test, so a failure part-way through never leaves the clock or fetch stubbed for the next.
  afterEach(() => {
    s?.end();
    s = undefined;
  });

  for (const [status, body] of [
    [200, { ok: true, hostname: "shop.lychee.land" }],
    [500, { error: "boom", steps: [] }],
  ] as const) {
    test(`an add answered ${status} after the page has gone settles its own toast and does not navigate`, async () => {
      s = session();
      await s.answerRecorded(0);
      await s.type("#hostname-field", "shop");
      await s.submit();
      const add = s.held.findIndex((h) => h.key.startsWith("POST /sites "));
      assert.ok(add !== -1, "the add went out");
      assert.ok(!s.el("#flash-banner").classList.contains("hidden"), "the Adding… toast is up");
      s.unmount();
      await s.answer(add, status, body);
      assert.equal(s.go.mock.callCount(), 0);
      if (status === 200) {
        assert.ok(s.el("#flash-banner").classList.contains("hidden"), "the Adding… toast outlived a successful add");
      } else {
        assert.ok(!s.el("#flash-banner").classList.contains("hidden"), "the failure was not shown");
        assert.equal(s.el("#flash-banner-message").textContent, "boom");
        assert.ok(!s.el("#flash-banner-close").classList.contains("hidden"), "no close button");
      }
    });
  }

  test("an add that settles after another toast replaced its own leaves that toast alone", async () => {
    s = session();
    await s.answerRecorded(0);
    await s.type("#hostname-field", "shop");
    await s.submit();
    const add = s.held.findIndex((h) => h.key.startsWith("POST /sites "));
    s.unmount();
    act(() => showToast("Deploying blog…", "info"));
    await s.answer(add, 500, { error: "boom", steps: [] });
    assert.equal(s.el("#flash-banner-message").textContent, "Deploying blog…");
    assert.ok(!s.el("#flash-banner").classList.contains("hidden"));
  });

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

// Last in the file, so every test above has run: a frozen file no test reads
// is a step that has quietly stopped being compared.
describe("the frozen add-site fixtures", () => {
  test("every fixture file is read by the parity run", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".html"))
      .sort();
    assert.deepEqual(files, [...read].sort());
    assert.deepEqual(readdirSync(FIXTURES).filter((f) => !f.endsWith(".html")), ["meta.json"]);
  });
});
