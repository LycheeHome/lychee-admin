import "./setup";
import { mock } from "node:test";
import { act, fireEvent } from "@testing-library/react";

/**
 * The add page's dual run (spec § Testing): one script of steps, driven
 * against the React page (the candidate), with a snapshot after each step.
 * The reference side was the server's page with the real `public/app.js`
 * driven by this same script; both are retired, and its snapshots are frozen
 * in `src/dev/fixtures/add-site/` (see AddSiteParity.test.tsx). What the
 * reference shared with the candidate still holds: the same stubbed `fetch`
 * answering from the same recorded answers (`addSiteAnswers.json`, recorded
 * by `src/dev/addSiteAnswers.ts`), the same mocked `setTimeout`, and the
 * same driver, which fires the events a browser would (`input` on a text
 * field, `change` on a select, a click on a radio or the submit button).
 *
 * Every `fetch` is held until a step answers it with `resolvePending`, which
 * is how a step decides the order answers land in: the stale-answer step
 * answers the newer request first.
 */

/** A recorded answer for each request, keyed `METHOD URL body` as `Snapshot.fetches` logs it. */
export type StubAnswers = Record<string, { status: number; body: unknown }>;

export type Snapshot = {
  /** `<main>`'s innerHTML, with `#app-root` unwrapped and the `#port-owners-data` script dropped (see `snapshot`). */
  main: string;
  /** `#flash-banner`'s outerHTML. */
  toast: string;
  /** `#add-site-submit`'s outerHTML. */
  submit: string;
  /** The requests this step made, each `METHOD URL body`, answered or not. */
  fetches: string[];
  /** The focused element's id, or its tag when it has none. */
  focus: string;
};

export type Driver = {
  /** Focuses the field and replaces its value, firing `input`. */
  type: (selector: string, text: string) => Promise<void>;
  /** Focuses the select and picks a value, firing `change`. */
  select: (selector: string, value: string) => Promise<void>;
  /** Focuses a radio or checkbox and clicks it. */
  check: (selector: string) => Promise<void>;
  /** Focuses `#add-site-submit` and clicks it, so native validation runs first, as in a browser. */
  submit: () => Promise<void>;
  /** Advances the mocked `setTimeout` clock. */
  tick: (ms: number) => Promise<void>;
  /** Dispatches `pageshow` on window with `persisted` set. */
  pageshow: (persisted: boolean) => Promise<void>;
  /** Answers the `index`th request still waiting (0 is the oldest) from the recorded answers. */
  resolvePending: (index: number) => Promise<void>;
};

export type Step = { name: string; act: (d: Driver) => Promise<void> };

const HOSTNAME = "#hostname-field";
const PORT = "#port-field";
const FRAMEWORK = "#framework-field";
const HEALTHCHECK = "#healthcheck-field";
const PROXY = 'input[name="type"][value="reverse-proxy"]';

/** The debounce runs out and the preview it sent is answered. */
async function settle(d: Driver): Promise<void> {
  await d.tick(250);
  await d.resolvePending(0);
}

/**
 * The spec's eleven steps, in order, as one continuous session: each starts
 * from the state the one before left. Where the spec's wording leaves a
 * choice, the choice is made so a branch is reached that would not be
 * otherwise; the report for Task 3 lists them. Names are slugs, so they can
 * name the frozen fixtures.
 */
export const ADD_SITE_STEPS: Step[] = [
  // The preview the page sends on arrival, for an empty form: neither ready
  // nor an error, so the panel keeps its at-rest content.
  { name: "at-rest", act: (d) => d.resolvePending(0) },
  // blog.lychee.land is in the seed, so the preview rejects it: the headline
  // splits label and suffix, and submit blocks.
  {
    name: "typing-blog",
    act: async (d) => {
      await d.type(HOSTNAME, "blog");
      await settle(d);
    },
  },
  // A full hostname is not doubled. A free one, so the static preview is
  // ready: three sections, the files one included.
  {
    name: "typing-a-full-hostname",
    act: async (d) => {
      await d.type(HOSTNAME, "shop.lychee.land");
      await settle(d);
    },
  },
  // The port block opens; with no port the preview rejects.
  {
    name: "switching-to-reverse-proxy",
    act: async (d) => {
      await d.check(PROXY);
      await settle(d);
    },
  },
  // Free first (a ready proxy preview), then claimed, so the step ends on the
  // owner sentence in #port-error and the same sentence from the preview.
  {
    name: "a-free-port-then-a-claimed-one",
    act: async (d) => {
      await d.type(PORT, "3500");
      await settle(d);
      await d.type(PORT, "4000");
      await settle(d);
    },
  },
  {
    name: "nextjs-then-a-healthcheck-path",
    act: async (d) => {
      await d.select(FRAMEWORK, "nextjs");
      await settle(d);
      await d.type(HEALTHCHECK, "/healthz");
      await settle(d);
    },
  },
  // The port is freed first: a field with a custom validity fails native
  // validation and the submit event never fires, so the blocked branch is
  // reachable only through a rejection the browser cannot see, here the
  // seed's blog.lychee.land.
  {
    name: "a-preview-error-then-a-blocked-submit",
    act: async (d) => {
      await d.type(PORT, "3500");
      await settle(d);
      await d.type(HOSTNAME, "blog");
      await settle(d);
      await d.submit();
    },
  },
  // A space passes native `required` and composes to nothing. The edit lifts
  // the block at once, so the submit reaches the page's own check.
  {
    name: "an-empty-submit",
    act: async (d) => {
      await d.type(HOSTNAME, " ");
      await d.submit();
      await settle(d);
    },
  },
  // Submitted before the debounce runs out. The recorded add fails at
  // `caddy validate` with real step marks. The preview the failure re-runs is
  // left in flight, because its answer would replace the marks.
  {
    name: "a-failed-submit-with-step-marks",
    act: async (d) => {
      await d.type(HOSTNAME, "shop");
      await d.submit();
      await d.resolvePending(0);
    },
  },
  // First the two previews step 9 left (the re-run, then the debounced one,
  // which supersedes it). Then 3600 and 3700 are both in flight, the newer
  // is answered first, and the older one's answer must not land.
  {
    name: "a-stale-preview-answer",
    act: async (d) => {
      await d.tick(250);
      await d.resolvePending(0);
      await d.resolvePending(0);
      await d.type(PORT, "3600");
      await d.tick(250);
      await d.type(PORT, "3700");
      await d.tick(250);
      await d.resolvePending(1);
      await d.resolvePending(0);
    },
  },
  // A submit left in flight stands in for the success that navigated away:
  // the page is left in the same state (in flight, button disabled, the
  // "Adding…" toast), and a real success would start a navigation. A
  // non-persisted pageshow changes nothing; a persisted one reopens the
  // form and re-runs the preview, which is answered.
  {
    name: "the-pageshow-restore",
    act: async (d) => {
      await d.pageshow(false);
      await d.submit();
      await d.pageshow(true);
      await d.resolvePending(1);
    },
  },
];

/** Enough of a Response for the page's readers: status, ok, json. */
function answerResponse(answer: { status: number; body: unknown }): Response {
  const text = JSON.stringify(answer.body);
  return {
    ok: answer.status >= 200 && answer.status < 300,
    status: answer.status,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: () => Promise.resolve(JSON.parse(text)),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  });
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`no ${selector} on the page`);
  return found;
}

/**
 * The page's state after a step. `<main>` is read from a copy with
 * `#app-root` replaced by its children, so React's content (rendered into
 * the mount point) compares as the same tree as the retired server page's,
 * which was written straight into `<main>`. The frozen reference was
 * snapshotted the same way, and also without the server's
 * `#port-owners-data` script, the retired app.js's data channel, which
 * rendered nothing; the React page reads the port owners from
 * `/api/sites/new` and never has one.
 */
function snapshot(fetches: string[]): Snapshot {
  const main = element<HTMLElement>("main").cloneNode(true) as HTMLElement;
  const root = main.querySelector("#app-root");
  if (root) root.replaceWith(...Array.from(root.childNodes));
  const active = document.activeElement;
  return {
    main: main.innerHTML,
    toast: document.getElementById("flash-banner")?.outerHTML ?? "",
    submit: document.getElementById("add-site-submit")?.outerHTML ?? "",
    fetches,
    focus: active ? active.id || active.tagName.toLowerCase() : "",
  };
}

/**
 * Prepares the environment, lets `mount` put a page on it, runs every step
 * and returns a snapshot per step, then undoes everything: the listeners
 * `mount`'s teardown removes, the stubs, the mocked clock and the body.
 */
async function run(mount: () => unknown, answers: StubAnswers): Promise<Snapshot[]> {
  const log: string[] = [];
  const pending: Array<{ key: string; resolve: (response: Response) => void }> = [];
  const savedFetch = globalThis.fetch;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  let teardown: unknown;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const key = `${init?.method ?? "GET"} ${url} ${init?.body == null ? "" : String(init.body)}`;
    log.push(key);
    return new Promise<Response>((resolve) => pending.push({ key, resolve }));
  }) as typeof fetch;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.resolve() },
  });
  mock.timers.enable({ apis: ["setTimeout"] });

  const driver: Driver = {
    type: async (selector, text) => {
      const field = element<HTMLInputElement>(selector);
      act(() => field.focus());
      fireEvent.input(field, { target: { value: text } });
      await flush();
    },
    select: async (selector, value) => {
      const field = element<HTMLSelectElement>(selector);
      act(() => field.focus());
      fireEvent.change(field, { target: { value } });
      await flush();
    },
    check: async (selector) => {
      const input = element<HTMLInputElement>(selector);
      act(() => input.focus());
      fireEvent.click(input);
      await flush();
    },
    submit: async () => {
      const button = element<HTMLButtonElement>("#add-site-submit");
      act(() => button.focus());
      fireEvent.click(button);
      await flush();
    },
    tick: async (ms) => {
      act(() => mock.timers.tick(ms));
      await flush();
    },
    pageshow: async (persisted) => {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: persisted });
      act(() => {
        window.dispatchEvent(event);
      });
      await flush();
    },
    resolvePending: async (index) => {
      const held = pending[index];
      if (!held) throw new Error(`no request waiting at ${index}; waiting: ${JSON.stringify(pending.map((p) => p.key))}`);
      const answer = answers[held.key];
      if (!answer) {
        throw new Error(
          `no recorded answer for "${held.key}": add it to ADD_SITE_REQUESTS in src/dev/addSiteAnswers.ts and re-record`,
        );
      }
      pending.splice(index, 1);
      act(() => held.resolve(answerResponse(answer)));
      await flush();
    },
  };

  try {
    document.body.className = "";
    document.body.innerHTML = "";
    teardown = mount();
    await flush();
    const snapshots: Snapshot[] = [];
    // From 0, not from after the mount: the preview a page sends on arrival
    // is the first step's.
    let before = 0;
    for (const step of ADD_SITE_STEPS) {
      try {
        await step.act(driver);
      } catch (error) {
        throw new Error(`step "${step.name}": ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      snapshots.push(snapshot(log.slice(before)));
      before = log.length;
    }
    return snapshots;
  } finally {
    if (typeof teardown === "function") teardown();
    mock.timers.reset();
    globalThis.fetch = savedFetch;
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else delete (navigator as { clipboard?: unknown }).clipboard;
    document.body.className = "";
    document.body.innerHTML = "";
  }
}

/**
 * Whatever `render` puts on the page, through every step. `render` writes
 * the document (the shell around `#app-root`) and mounts the page; if it
 * returns a function, that is called after the last step, before the body
 * is cleared, so a React root can be unmounted there.
 */
export function candidateRun(render: () => void, answers: StubAnswers): Promise<Snapshot[]> {
  return run(render, answers);
}
