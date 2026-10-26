import "./test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { useRef } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { SiteDetailPayload } from "../shared/siteDetail";
import { seedSiteDetailPayload } from "../dev/testHelpers";
import { fetchSiteDetail, siteDetailQueryKey } from "./api";
import { SiteDetail } from "./components/SiteDetail";
import { useSiteWriteInFlight, useSiteWrites } from "./siteWrites";

/*
 * The site page's card writes, end to end below the page: the real
 * RepositoryCard wired to useSiteWrites, a site query under
 * siteDetailQueryKey (Task 7 builds the page's own on the same key), and a
 * stubbed fetch that answers the writes and the re-read.
 */

afterEach(cleanup);

type Detail = Extract<SiteDetailPayload, { caddyfileError: null }>;

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;
const originalFocus = HTMLElement.prototype.focus;
const TOAST = () => document.getElementById("flash-banner-message")!.textContent;
const TOAST_HIDDEN = () => document.getElementById("flash-banner")!.classList.contains("hidden");

type Call = { method: string; url: string; body: unknown };
let calls: Call[] = [];
let current: Detail;
let writeAnswer: () => Response | Promise<Response>;
/** What a successful write leaves the next read answering. */
let afterWrite: Detail | null;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

before(() => {
  document.body.innerHTML = `<div id="flash-banner" class="hidden" role="status">
    <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden">x</button></div>
    <button type="button" id="elsewhere">elsewhere</button>`;
  // The harness renders the whole page, remove dialog included. A browser
  // never focuses what a closed <dialog> holds; happy-dom does, so React's
  // mount-time autoFocus on its Cancel would take focus from the page. The
  // same emulation the site page's route tests use.
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (this.closest("dialog:not([open])")) return;
    originalFocus.call(this, options);
  };
});

beforeEach(() => {
  calls = [];
  afterWrite = null;
  writeAnswer = () => {
    if (afterWrite) current = afterWrite;
    return json(200, { ok: true });
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body });
    if (method === "GET" && url.startsWith("/api/sites/")) return json(200, { ok: true, ...current });
    if (method === "GET") return json(200, { ok: true });
    return writeAnswer();
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  HTMLElement.prototype.focus = originalFocus;
});

const posts = () => calls.filter((c) => c.method === "POST");
const siteReads = () => calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/sites/")).length;

let inFlightSeen: boolean[] = [];

function Page({ hostname }: { hostname: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const writes = useSiteWrites(hostname, headingRef);
  inFlightSeen.push(useSiteWriteInFlight(hostname));
  // The page's own read, so the cache holds what the page's holds.
  const { data } = useQuery({
    queryKey: siteDetailQueryKey(hostname),
    queryFn: () => fetchSiteDetail(hostname, false),
  });
  const payload = data?.found ? data.payload : null;
  // The whole page, not only the card: since the retired-state spec, Prune
  // sits in the page's retired notice above the card.
  return payload && payload.caddyfileError === null ? (
    <SiteDetail payload={payload} writes={writes} cardHeadingRef={headingRef} />
  ) : null;
}

function mount(hostname: string): QueryClient {
  inFlightSeen = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <Page hostname={hostname} />
    </QueryClientProvider>,
  );
  return client;
}

function finish(client: QueryClient) {
  cleanup();
  client.clear();
}

const heading = () => Array.from(document.querySelectorAll("h3")).find((h) => h.textContent === "From a repository");
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const label = (el: Element | null | undefined) =>
  el ? `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> "${(el.textContent ?? "").slice(0, 40)}"` : String(el);

/** Compares by identity with a short message: assert.equal on two DOM nodes inspects the whole document to print its diff. */
function assertFocus(el: Element | null | undefined) {
  assert.ok(document.activeElement === el, `focus is on ${label(document.activeElement)}, not ${label(el)}`);
}

const submitOf = (form: HTMLFormElement) => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

/** Records whether an alert region was visible, and what it said, at every DOM change to it. */
function watch(el: HTMLElement): { visible: boolean; text: string }[] {
  const seen: { visible: boolean; text: string }[] = [];
  const observer = new MutationObserver(() => seen.push({ visible: !el.classList.contains("hidden"), text: el.textContent ?? "" }));
  observer.observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  return seen;
}

/** The seed's preview site before Attach: no resource, nothing retired. */
async function unattached(): Promise<{ before: Detail; attached: Detail }> {
  const { payload } = await seedSiteDetailPayload("preview.lychee.land");
  return { before: { ...payload, resource: undefined, detached: false }, attached: payload };
}

/** The seed's preview site with no tag found yet: Change repository is offered. */
async function changeable(repo = "preview-site"): Promise<Detail> {
  const { payload } = await seedSiteDetailPayload("preview.lychee.land");
  assert.ok(payload.resource);
  return { ...payload, resource: { ...payload.resource, repo, available: undefined } };
}

type FormCase = {
  title: string;
  formSelector: string;
  inputId: string;
  errorId: string;
  path: string;
  setUp: () => Promise<{ before: Detail; after: Detail }>;
  info: (repo: string) => string;
  refused: (repo: string, status: number) => string;
  unreachable: (repo: string) => string;
};

const FORMS: FormCase[] = [
  {
    title: "Attach",
    formSelector: "form[data-attach]",
    inputId: "attach-repo",
    errorId: "attach-error",
    path: "/sites/preview.lychee.land/attach",
    setUp: async () => {
      const { before, attached } = await unattached();
      return { before, after: attached };
    },
    info: (repo) => `Attaching ${repo} to preview.lychee.land…`,
    refused: (repo, status) => `Could not attach ${repo} (HTTP ${status}).`,
    unreachable: (repo) => `Could not reach the server to attach ${repo}.`,
  },
  {
    title: "Change repository",
    formSelector: "form[data-change-repository]",
    inputId: "change-repo-repo",
    errorId: "change-repo-error",
    path: "/sites/preview.lychee.land/repository",
    setUp: async () => ({ before: await changeable(), after: await changeable("r") }),
    info: (repo) => `Changing preview.lychee.land's repository to ${repo}…`,
    refused: (repo, status) => `Could not change the repository to ${repo} (HTTP ${status}).`,
    unreachable: (repo) => `Could not reach the server to change the repository to ${repo}.`,
  },
];

for (const c of FORMS) {
  describe(c.title, () => {
    async function ready() {
      const { before, after } = await c.setUp();
      current = before;
      afterWrite = after;
      const client = mount("preview.lychee.land");
      const form = await waitFor(() => {
        const f = document.querySelector<HTMLFormElement>(c.formSelector);
        assert.ok(f);
        return f;
      }, TIMEOUT);
      const input = byId<HTMLInputElement>(c.inputId)!;
      return { client, form, input };
    }

    test("an empty name is refused in the form, focuses the field and sends nothing", async () => {
      const { client, form, input } = await ready();
      try {
        fireEvent.change(input, { target: { value: "   " } });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, "Enter the repository's name."), TIMEOUT);
        assert.ok(!byId(c.errorId)!.classList.contains("hidden"));
        assertFocus(input);
        assert.equal(posts().length, 0);
      } finally {
        finish(client);
      }
    });

    test("success: one POST of repo=r, the info toast, a re-read, and focus on the card heading", async () => {
      const { client, form, input } = await ready();
      try {
        const reads = siteReads();
        input.focus();
        fireEvent.change(input, { target: { value: " r " } });
        fireEvent.submit(form);
        assert.equal(TOAST(), c.info("r"));
        assert.ok(!TOAST_HIDDEN());
        await waitFor(() => assertFocus(heading()), TIMEOUT);
        assert.equal(posts().length, 1);
        assert.equal(posts()[0].url, c.path);
        assert.ok(posts()[0].body instanceof URLSearchParams);
        assert.equal(String(posts()[0].body), "repo=r");
        assert.ok(siteReads() > reads);
        assert.equal(heading()!.tabIndex, -1);
        // The re-read page is the feedback: the progress toast goes.
        assert.ok(TOAST_HIDDEN());
      } finally {
        finish(client);
      }
    });

    test("the form stays disabled until the re-read lands", async () => {
      const { client, form, input } = await ready();
      try {
        let release: (() => void) | undefined;
        const baseFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).startsWith("/api/sites/") && posts().length === 1 && !release) {
            await new Promise<void>((r) => (release = r));
          }
          return baseFetch(input, init);
        }) as typeof fetch;
        const submit = submitOf(form);
        fireEvent.change(input, { target: { value: "r" } });
        fireEvent.submit(form);
        await waitFor(() => assert.ok(release), TIMEOUT);
        assert.equal(submit.disabled, true);
        // useSiteWriteInFlight, which pauses the page's polling, holds through the re-read.
        assert.equal(inFlightSeen.at(-1), true);
        release!();
        await waitFor(() => assertFocus(heading()), TIMEOUT);
        await waitFor(() => assert.equal(inFlightSeen.at(-1), false), TIMEOUT);
      } finally {
        finish(client);
      }
    });

    test("a refusal shows the reason in the alert, visible before its text, hides the toast and re-enables", async () => {
      writeAnswer = () => json(409, { ok: false, reason: "already declared <x>" });
      const { client, form, input } = await ready();
      try {
        const region = byId(c.errorId)!;
        const seen = watch(region);
        fireEvent.change(input, { target: { value: "r" } });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, "already declared <x>"), TIMEOUT);
        const firstText = seen.findIndex((s) => s.text !== "");
        assert.ok(firstText > 0, "the text was written in the same change that revealed the region");
        assert.deepEqual(seen[firstText - 1], { visible: true, text: "" });
        assert.ok(TOAST_HIDDEN());
        await waitFor(() => assert.equal(submitOf(form).disabled, false), TIMEOUT);
        assert.equal(posts().length, 1);
      } finally {
        finish(client);
      }
    });

    test("a refusal without a reason names the HTTP status", async () => {
      writeAnswer = () => new Response("bad gateway", { status: 502 });
      const { client, form, input } = await ready();
      try {
        fireEvent.change(input, { target: { value: "r" } });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, c.refused("r", 502)), TIMEOUT);
      } finally {
        finish(client);
      }
    });

    test("a network failure says the server could not be reached", async () => {
      writeAnswer = () => {
        throw new TypeError("fetch failed");
      };
      const { client, form, input } = await ready();
      try {
        fireEvent.change(input, { target: { value: "r" } });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, c.unreachable("r")), TIMEOUT);
        assert.ok(TOAST_HIDDEN());
        await waitFor(() => assert.equal(submitOf(form).disabled, false), TIMEOUT);
      } finally {
        finish(client);
      }
    });

    test("a new attempt clears the last error, so an empty-name error cannot hide a refusal", async () => {
      writeAnswer = () => json(409, { ok: false, reason: "refused" });
      const { client, form, input } = await ready();
      try {
        fireEvent.change(input, { target: { value: "" } });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, "Enter the repository's name."), TIMEOUT);
        fireEvent.change(input, { target: { value: "r" } });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, "refused"), TIMEOUT);
        await waitFor(() => assert.equal(submitOf(form).disabled, false), TIMEOUT);
        // A second refusal: the region is cleared when the attempt starts, then written again.
        writeAnswer = () => json(409, { ok: false, reason: "refused again" });
        fireEvent.submit(form);
        await waitFor(() => assert.equal(byId(c.errorId)!.textContent, "refused again"), TIMEOUT);
      } finally {
        finish(client);
      }
    });

    test("two quick submits send one POST", async () => {
      let release!: () => void;
      writeAnswer = () => new Promise((r) => (release = () => r(json(409, { ok: false, reason: "no" }))));
      const { client, form, input } = await ready();
      try {
        fireEvent.change(input, { target: { value: "r" } });
        fireEvent.submit(form);
        fireEvent.submit(form);
        await waitFor(() => assert.ok(release), TIMEOUT);
        assert.equal(posts().length, 1);
        release();
        await waitFor(() => assert.equal(submitOf(form).disabled, false), TIMEOUT);
        assert.equal(posts().length, 1);
      } finally {
        finish(client);
      }
    });
  });
}

describe("focus moves only when the control that had it is gone", () => {
  test("a Copy button the operator focused during the re-read keeps focus", async () => {
    const { before, attached } = await unattached();
    assert.ok(attached.resource);
    // Attached but not yet looked at: steps 1 and 2 stay unfolded, so their Copy buttons survive the re-read.
    const unchecked: Detail = { ...attached, resource: { ...attached.resource, available: undefined, result: undefined } };
    current = before;
    afterWrite = unchecked;
    const client = mount("preview.lychee.land");
    try {
      const form = await waitFor(() => {
        const f = document.querySelector<HTMLFormElement>("form[data-attach]");
        assert.ok(f);
        return f;
      }, TIMEOUT);
      let release: (() => void) | undefined;
      const baseFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).startsWith("/api/sites/") && posts().length === 1 && !release) {
          await new Promise<void>((r) => (release = r));
        }
        return baseFetch(input, init);
      }) as typeof fetch;
      const input = byId<HTMLInputElement>("attach-repo")!;
      input.focus();
      fireEvent.change(input, { target: { value: "r" } });
      fireEvent.submit(form);
      await waitFor(() => assert.ok(release), TIMEOUT);
      const copy = document.querySelector<HTMLButtonElement>('[data-copy-target="scaffold-file-0"]')!;
      copy.focus();
      assertFocus(copy);
      release!();
      await waitFor(() => assert.ok(!document.querySelector("form[data-attach]")), TIMEOUT);
      await waitFor(() => assert.equal(client.isMutating(), 0), TIMEOUT);
      // Let any deferred focus decision run.
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(copy.isConnected, "the Copy button was replaced, so this case no longer tests a surviving control");
      assertFocus(copy);
    } finally {
      finish(client);
    }
  });
});

describe("Change repository: the field follows the declaration", () => {
  test("a re-read that changes the repository shows the new name in the field", async () => {
    current = await changeable();
    const client = mount("preview.lychee.land");
    try {
      await waitFor(() => assert.equal(byId<HTMLInputElement>("change-repo-repo")?.value, "preview-site"), TIMEOUT);
      current = await changeable("renamed");
      await act(() => client.invalidateQueries({ queryKey: siteDetailQueryKey("preview.lychee.land") }));
      await waitFor(() => assert.equal(byId<HTMLInputElement>("change-repo-repo")?.value, "renamed"), TIMEOUT);
    } finally {
      finish(client);
    }
  });
});

describe("Deploy", () => {
  test("success: the requested line replaces the offer and takes focus", async () => {
    const { payload } = await seedSiteDetailPayload("preview.lychee.land");
    assert.ok(payload.resource);
    current = payload;
    afterWrite = { ...payload, resource: { ...payload.resource, requestedTag: "0.1.0" } };
    const client = mount("preview.lychee.land");
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-deploy="preview-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      button.focus();
      fireEvent.click(button);
      assert.equal(TOAST(), "Requesting 0.1.0 for preview-lychee-land…");
      await waitFor(() => assertFocus(document.querySelector("[data-requested]")), TIMEOUT);
      assert.ok(!document.querySelector("[data-deploy]"));
      assert.equal(posts().length, 1);
      assert.equal(posts()[0].url, "/services/preview-lychee-land/deploy");
      assert.equal(posts()[0].body, undefined);
      assert.ok(TOAST_HIDDEN());
    } finally {
      finish(client);
    }
  });

  test("a pending Deploy counts as a page write in flight", async () => {
    const { payload } = await seedSiteDetailPayload("preview.lychee.land");
    current = payload;
    let release!: () => void;
    writeAnswer = () => new Promise((r) => (release = () => r(json(409, { ok: false, reason: "no" }))));
    const client = mount("preview.lychee.land");
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-deploy="preview-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      assert.equal(inFlightSeen.at(-1), false);
      fireEvent.click(button);
      await waitFor(() => assert.equal(inFlightSeen.at(-1), true), TIMEOUT);
      release();
      await waitFor(() => assert.equal(inFlightSeen.at(-1), false), TIMEOUT);
    } finally {
      finish(client);
    }
  });

  test("a refusal shows the error toast and re-enables the button", async () => {
    const { payload } = await seedSiteDetailPayload("preview.lychee.land");
    current = payload;
    writeAnswer = () => json(409, { ok: false, reason: "a deploy is already requested" });
    const client = mount("preview.lychee.land");
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-deploy="preview-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      fireEvent.click(button);
      await waitFor(() => assert.equal(TOAST(), "a deploy is already requested"), TIMEOUT);
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
      assert.equal(posts().length, 1);
    } finally {
      finish(client);
    }
  });
});

describe("Prune", () => {
  async function gone() {
    const { payload } = await seedSiteDetailPayload("gone.lychee.land");
    assert.equal(payload.detached, true);
    return payload;
  }

  test("success: the warning goes and focus moves to the card heading", async () => {
    current = await gone();
    afterWrite = { ...current, detached: false };
    const client = mount("gone.lychee.land");
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-prune="gone-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      button.focus();
      fireEvent.click(button);
      assert.equal(TOAST(), "Pruning gone-lychee-land.yml from lychee-resources…");
      await waitFor(() => assertFocus(heading()), TIMEOUT);
      assert.ok(!document.querySelector("[data-prune]"));
      assert.equal(posts()[0].url, "/resources/gone-lychee-land/prune");
      assert.equal(TOAST(), "Pruned gone-lychee-land.yml from lychee-resources.");
    } finally {
      finish(client);
    }
  });

  test("a 409 says the declaration was not pruned, with the reason", async () => {
    current = await gone();
    writeAnswer = () => json(409, { ok: false, reason: "the container hasn't been confirmed down yet" });
    const client = mount("gone.lychee.land");
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-prune="gone-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      fireEvent.click(button);
      await waitFor(
        () => assert.equal(TOAST(), "gone-lychee-land.yml was not pruned: the container hasn't been confirmed down yet"),
        TIMEOUT,
      );
      await waitFor(() => assert.equal(button.disabled, false), TIMEOUT);
      // Refused, so nothing changed: the notice and step 3's warning both stay.
      assert.ok(document.querySelector('section[aria-label="Retired declaration"]'));
      assert.ok(byId("attach-warning"));
    } finally {
      finish(client);
    }
  });

  test("a declaration pruned elsewhere: the next re-read drops the notice without a throw", async () => {
    current = await gone();
    const client = mount("gone.lychee.land");
    try {
      await waitFor(() => assert.ok(document.querySelector('section[aria-label="Retired declaration"]')), TIMEOUT);
      // Pruned by hand on GitHub: the site reads not deployed and is no longer detached.
      current = { ...current, detached: false, status: { kind: "container", state: "not-created" } };
      await act(async () => {
        await client.invalidateQueries({ queryKey: siteDetailQueryKey("gone.lychee.land") });
      });
      await waitFor(() => assert.ok(!document.querySelector('section[aria-label="Retired declaration"]')), TIMEOUT);
      assert.ok(!byId("attach-warning"));
      assert.ok(!document.querySelector("[data-prune]"));
    } finally {
      finish(client);
    }
  });

  test("focus the operator moved elsewhere stays there", async () => {
    current = await gone();
    afterWrite = { ...current, detached: false };
    let release!: () => void;
    writeAnswer = () =>
      new Promise((r) => {
        current = afterWrite!;
        release = () => r(json(200, { ok: true }));
      });
    const client = mount("gone.lychee.land");
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-prune="gone-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      button.focus();
      fireEvent.click(button);
      await waitFor(() => assert.ok(release), TIMEOUT);
      const elsewhere = byId<HTMLButtonElement>("elsewhere")!;
      elsewhere.focus();
      release();
      await waitFor(() => assert.equal(TOAST(), "Pruned gone-lychee-land.yml from lychee-resources."), TIMEOUT);
      assertFocus(elsewhere);
    } finally {
      finish(client);
    }
  });
});

describe("a write that settles after the page is gone (review focus 2)", () => {
  test("Attach: no throw, focus untouched, and the toast still settles", async () => {
    const { before, attached } = await unattached();
    current = before;
    let release!: () => void;
    writeAnswer = () =>
      new Promise((r) => {
        current = attached;
        release = () => r(json(200, { ok: true }));
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Page hostname="preview.lychee.land" />
      </QueryClientProvider>,
    );
    try {
      const form = await waitFor(() => {
        const f = document.querySelector<HTMLFormElement>("form[data-attach]");
        assert.ok(f);
        return f;
      }, TIMEOUT);
      fireEvent.change(byId<HTMLInputElement>("attach-repo")!, { target: { value: "r" } });
      fireEvent.submit(form);
      await waitFor(() => assert.ok(release), TIMEOUT);
      assert.equal(TOAST(), "Attaching r to preview.lychee.land…");
      view.unmount();
      const elsewhere = byId<HTMLButtonElement>("elsewhere")!;
      elsewhere.focus();
      release();
      // The write's own settle still runs: the progress toast is put away, as on a mounted page.
      await waitFor(() => assert.ok(TOAST_HIDDEN()), TIMEOUT);
      await waitFor(() => assert.equal(client.isMutating(), 0), TIMEOUT);
      assertFocus(elsewhere);
    } finally {
      finish(client);
    }
  });

  test("Prune: no throw, focus untouched, and the success toast is still shown", async () => {
    const { payload } = await seedSiteDetailPayload("gone.lychee.land");
    current = payload;
    let release!: () => void;
    writeAnswer = () =>
      new Promise((r) => {
        current = { ...payload, detached: false };
        release = () => r(json(200, { ok: true }));
      });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
    const view = render(
      <QueryClientProvider client={client}>
        <Page hostname="gone.lychee.land" />
      </QueryClientProvider>,
    );
    try {
      const button = await waitFor(() => {
        const b = document.querySelector<HTMLButtonElement>('[data-prune="gone-lychee-land"]');
        assert.ok(b);
        return b;
      }, TIMEOUT);
      fireEvent.click(button);
      await waitFor(() => assert.ok(release), TIMEOUT);
      view.unmount();
      const elsewhere = byId<HTMLButtonElement>("elsewhere")!;
      elsewhere.focus();
      release();
      await waitFor(() => assert.equal(TOAST(), "Pruned gone-lychee-land.yml from lychee-resources."), TIMEOUT);
      assertFocus(elsewhere);
    } finally {
      finish(client);
    }
  });
});
