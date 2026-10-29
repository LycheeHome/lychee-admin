import "./test/setup";
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { useRef, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { seedSiteDetailPayload } from "../dev/testHelpers";
import { removeDeclaration, removeSteps } from "../views/siteDetailModel";
import { RemoveDialog, type RemoveDialogHandle } from "./components/RemoveDialog";
import { SiteDetail } from "./components/SiteDetail";

/*
 * The remove dialog and its chain, ported from public/app.js: the dialog
 * opened from a button, a stubbed fetch answering /delete, /detach and
 * /delete-files, and a stubbed `go` where the page would navigate.
 *
 * happy-dom's <dialog> has showModal and close (close dispatches "close"), so
 * no polyfill is installed. It does not turn Escape into "cancel" or lay the
 * dialog out, so Escape is a dispatched "cancel" and a backdrop click is a
 * click on the dialog itself outside its (zero-sized) rect.
 */

afterEach(cleanup);

const TIMEOUT = { timeout: 5000 };
const originalFetch = globalThis.fetch;

type Call = { url: string; body: string | null };
let calls: Call[] = [];
type Answer = Response | Promise<Response>;
let answers: Record<string, Array<() => Answer>> = {};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

/** Queues answers for an endpoint suffix ("delete", "detach", "delete-files"). */
function answer(suffix: string, ...responses: Array<() => Answer>) {
  answers[suffix] = [...(answers[suffix] ?? []), ...responses];
}

before(() => {
  document.body.innerHTML = `<div id="flash-banner" class="hidden" role="status">
    <span id="flash-banner-progress" class="hidden"></span><span id="flash-banner-message"></span>
    <button type="button" id="flash-banner-action" class="hidden"></button>
    <button type="button" id="flash-banner-close" class="hidden">x</button></div>`;
});

beforeEach(() => {
  calls = [];
  answers = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? String(init.body) : null });
    const suffix = url.split("/").pop()!;
    const next = answers[suffix]?.shift();
    assert.ok(next, `no answer queued for ${url}`);
    return next();
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
});

const urls = () => calls.map((c) => c.url);
const TOAST = () => document.getElementById("flash-banner-message")!.textContent;
const ACTION = () => document.getElementById("flash-banner-action") as HTMLButtonElement;

function label(el: Element | null | undefined): string {
  if (!el) return String(el);
  return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}> "${(el.textContent ?? "").trim().slice(0, 40)}"`;
}

function assertFocus(el: Element | null | undefined) {
  assert.ok(document.activeElement === el, `focus is on ${label(document.activeElement)}, not ${label(el)}`);
}

const ALL_OK = [
  { id: "caddyfile", status: "ok" },
  { id: "tunnel", status: "ok" },
  { id: "caddy", status: "ok" },
  { id: "cloudflared", status: "ok" },
];

type DialogProps = ComponentProps<typeof RemoveDialog>;

async function propsFor(hostname: string, override: Parameters<typeof seedSiteDetailPayload>[1] = {}) {
  const { site, payload } = await seedSiteDetailPayload(hostname, override);
  return {
    hostname,
    steps: removeSteps(site, payload),
    declaration: removeDeclaration(site, payload),
    filesPath: payload.filesPath,
    deletableFiles: Boolean(payload.filesPath && payload.filesExist),
    dockerWarning: Boolean(site.framework),
  } satisfies Partial<DialogProps>;
}

function Harness(props: Omit<DialogProps, "ref">) {
  const ref = useRef<RemoveDialogHandle>(null);
  return (
    <>
      <button type="button" id="open-remove" onClick={() => ref.current?.open()}>
        open
      </button>
      <RemoveDialog ref={ref} {...props} />
    </>
  );
}

type Opened = {
  dialog: HTMLDialogElement;
  submit: HTMLButtonElement;
  cancel: HTMLButtonElement;
  checkbox: HTMLInputElement | null;
  go: string[];
  openChanges: boolean[];
  outcome: () => string;
  outcomeIsError: () => boolean;
  mark: (id: string) => string;
  rerender: (props: Omit<DialogProps, "ref">) => void;
};

async function openDialog(props: Omit<DialogProps, "ref" | "go" | "onOpenChange">): Promise<Opened> {
  const go: string[] = [];
  const openChanges: boolean[] = [];
  const full = { ...props, go: (href: string) => go.push(href), onOpenChange: (open: boolean) => openChanges.push(open) };
  const view = render(<Harness {...full} />);
  // A click focuses the button it lands on; fireEvent does not, so focus it
  // here, or React's mount-time autoFocus on Cancel would pass for open()'s.
  const opener = view.container.querySelector<HTMLButtonElement>("#open-remove")!;
  opener.focus();
  fireEvent.click(opener);
  const dialog = view.container.querySelector<HTMLDialogElement>("#confirm-remove-dialog")!;
  await waitFor(() => assert.ok(dialog.open), TIMEOUT);
  return {
    dialog,
    submit: dialog.querySelector<HTMLButtonElement>("#confirm-remove-submit")!,
    cancel: dialog.querySelector<HTMLButtonElement>('[data-close-dialog="confirm-remove-dialog"]')!,
    checkbox: dialog.querySelector<HTMLInputElement>("#confirm-remove-delete-files"),
    go,
    openChanges,
    outcome: () => dialog.querySelector("#confirm-remove-outcome-text")!.textContent ?? "",
    outcomeIsError: () => dialog.querySelector("#confirm-remove-outcome")!.classList.contains("text-red-300"),
    mark: (id) => dialog.querySelector(`[data-step-id="${id}"] .step-mark`)!.textContent ?? "",
    rerender: (next) => view.rerender(<Harness {...next} go={full.go} onOpenChange={full.onOpenChange} />),
  };
}

const cancelEvent = () => new Event("cancel", { cancelable: true });

describe("the remove chain", () => {
  test("a failed /delete that was rolled back: the error and the restored-config sentence, Confirm usable again", async () => {
    answer("delete", () =>
      json(500, {
        ok: false,
        error: "caddy validate failed: boom",
        rolledBack: true,
        steps: [
          { id: "caddyfile", status: "ok" },
          { id: "tunnel", status: "ok" },
          { id: "caddy", status: "failed" },
          { id: "cloudflared", status: "not-run" },
        ],
      }),
    );
    const d = await openDialog(await propsFor("blog.lychee.land"));
    fireEvent.click(d.submit);
    await waitFor(
      () => assert.equal(d.outcome(), "caddy validate failed: boom\n\nThe original Caddyfile and tunnel config were restored."),
      TIMEOUT,
    );
    assert.ok(d.outcomeIsError());
    assert.equal(d.mark("caddyfile"), "✓");
    assert.equal(d.mark("caddy"), "✗");
    assert.equal(d.mark("cloudflared"), "·");
    await waitFor(() => assert.ok(!d.submit.disabled), TIMEOUT);
    assert.ok(!d.cancel.disabled);
    assert.equal(d.dialog.getAttribute("aria-busy"), "false");
    assert.deepEqual(urls(), ["/sites/blog.lychee.land/delete"]);
    assert.equal(calls[0].body, "deleteFiles=");
    assert.deepEqual(d.go, []);
  });

  test("a failed /delete after Caddy reloaded: settled, so Confirm stays disabled and Cancel works", async () => {
    answer("delete", () =>
      json(500, {
        ok: false,
        error: "restart failed",
        steps: [...ALL_OK.slice(0, 3), { id: "cloudflared", status: "failed" }],
      }),
    );
    const d = await openDialog(await propsFor("blog.lychee.land"));
    fireEvent.click(d.submit);
    await waitFor(
      () =>
        assert.equal(
          d.outcome(),
          "restart failed\n\nCaddy had already reloaded, so the edited config is live and was left in place.",
        ),
      TIMEOUT,
    );
    await waitFor(() => assert.ok(!d.cancel.disabled), TIMEOUT);
    assert.ok(d.submit.disabled);
    // A second click (were it to land) posts nothing: the removal is settled.
    fireEvent.click(d.submit);
    // Settled outlives the dialog: closing and reopening keeps Confirm disabled.
    fireEvent.click(d.cancel);
    await waitFor(() => assert.ok(!d.dialog.open), TIMEOUT);
    fireEvent.click(document.querySelector("#open-remove")!);
    await waitFor(() => assert.ok(d.dialog.open), TIMEOUT);
    assert.ok(d.submit.disabled);
    assert.deepEqual(urls(), ["/sites/blog.lychee.land/delete"]);
  });

  test("an attached site: /delete, then /detach, then the list, with the declaration step marked ok", async () => {
    const detach = deferred();
    answer("delete", () => json(200, { ok: true, removed: true, steps: ALL_OK, needsFileConfirm: false }));
    answer("detach", () => detach.promise);
    const d = await openDialog(await propsFor("app.lychee.land"));
    assert.equal(d.dialog.dataset.attached, "true");
    fireEvent.click(d.submit);
    await waitFor(() => assert.equal(d.outcome(), "Retiring app.lychee.land's container declaration…"), TIMEOUT);
    assert.ok(!d.outcomeIsError());
    assert.ok(!d.dialog.querySelector("#confirm-remove-progress")!.classList.contains("hidden"));
    assert.equal(d.dialog.getAttribute("aria-busy"), "true");
    assert.ok(d.submit.disabled && d.cancel.disabled);
    await act(async () => detach.resolve(json(200, { ok: true })));
    await waitFor(() => assert.deepEqual(d.go, ["/sites?removed=app.lychee.land"]), TIMEOUT);
    assert.equal(d.mark("declaration"), "✓");
    assert.deepEqual(urls(), ["/sites/app.lychee.land/delete", "/sites/app.lychee.land/detach"]);
  });

  test("an unattached site never posts /detach", async () => {
    answer("delete", () => json(200, { ok: true, removed: true, steps: ALL_OK, needsFileConfirm: false }));
    const d = await openDialog(await propsFor("legacy.lychee.land"));
    assert.ok(!d.dialog.hasAttribute("data-attached"));
    fireEvent.click(d.submit);
    await waitFor(() => assert.deepEqual(d.go, ["/sites?removed=legacy.lychee.land"]), TIMEOUT);
    assert.deepEqual(urls(), ["/sites/legacy.lychee.land/delete"]);
  });

  test("a failed /detach closes the dialog and offers Retry, which resumes the chain", async () => {
    answer("delete", () => json(200, { ok: true, removed: true, steps: ALL_OK, needsFileConfirm: true }));
    answer(
      "detach",
      () => json(502, { ok: false, reason: "Could not read the local lychee-resources clone" }),
      () => json(200, { ok: true }),
    );
    answer("delete-files", () => json(200, { ok: true }));
    const d = await openDialog(await propsFor("app.lychee.land", { filesExist: true }));
    assert.ok(d.checkbox);
    fireEvent.click(d.checkbox);
    fireEvent.click(d.submit);
    await waitFor(() => assert.ok(!d.dialog.open), TIMEOUT);
    assert.deepEqual(d.openChanges, [true, false]);
    assert.equal(d.mark("declaration"), "✗");
    assert.equal(
      TOAST(),
      "Site removed, but its container is still declared running: Could not read the local lychee-resources clone",
    );
    assert.equal(ACTION().textContent, "Retry");
    assert.ok(!ACTION().classList.contains("hidden"));
    assertFocus(ACTION());
    assert.deepEqual(d.go, []);
    assert.equal(calls[0].body, "deleteFiles=on");

    fireEvent.click(ACTION());
    await waitFor(() => assert.deepEqual(d.go, ["/sites?removed=app.lychee.land"]), TIMEOUT);
    assert.deepEqual(urls(), [
      "/sites/app.lychee.land/delete",
      "/sites/app.lychee.land/detach",
      "/sites/app.lychee.land/detach",
      "/sites/app.lychee.land/delete-files",
    ]);
  });

  test("a Retry that fails again offers Retry again, with the new reason", async () => {
    answer("delete", () => json(200, { ok: true, removed: true, steps: ALL_OK, needsFileConfirm: false }));
    answer(
      "detach",
      () => json(502, { ok: false, reason: "first" }),
      () => json(404, {}),
    );
    const d = await openDialog(await propsFor("app.lychee.land"));
    fireEvent.click(d.submit);
    await waitFor(() => assert.equal(TOAST(), "Site removed, but its container is still declared running: first"), TIMEOUT);
    fireEvent.click(ACTION());
    await waitFor(() => assert.equal(TOAST(), "Site removed, but its container is still declared running: HTTP 404"), TIMEOUT);
    assert.equal(ACTION().textContent, "Retry");
    assert.deepEqual(d.go, []);
  });

  test("a failed delete-files: filesFailureMessage in the outcome, and no navigation", async () => {
    answer("delete", () => json(200, { ok: true, removed: true, steps: ALL_OK, needsFileConfirm: true }));
    answer("delete-files", () => json(500, { ok: false, error: "rm: permission denied" }));
    const d = await openDialog(await propsFor("blog.lychee.land"));
    fireEvent.click(d.checkbox!);
    fireEvent.click(d.submit);
    await waitFor(
      () =>
        assert.equal(
          d.outcome(),
          "Removed blog.lychee.land from Caddy and the sites tunnel, but deleting its files failed:\nrm: permission denied\n\nThe site is no longer served. Its files are still on disk.",
        ),
      TIMEOUT,
    );
    assert.ok(d.outcomeIsError());
    assert.deepEqual(urls(), ["/sites/blog.lychee.land/delete", "/sites/blog.lychee.land/delete-files"]);
    assert.deepEqual(d.go, []);
  });

  test("a network failure on /delete shows the error", async () => {
    answer("delete", () => {
      throw new TypeError("Failed to fetch");
    });
    const d = await openDialog(await propsFor("blog.lychee.land"));
    fireEvent.click(d.submit);
    await waitFor(() => assert.equal(d.outcome(), "Failed to fetch"), TIMEOUT);
    assert.ok(d.outcomeIsError());
    await waitFor(() => assert.ok(!d.submit.disabled), TIMEOUT);
  });
});

describe("the remove dialog", () => {
  test("Escape and a backdrop click are ignored while busy, and close it when idle", async () => {
    const pending = deferred();
    answer("delete", () => pending.promise);
    const d = await openDialog(await propsFor("blog.lychee.land"));
    fireEvent.click(d.submit);
    await waitFor(() => assert.equal(d.outcome(), "Removing blog.lychee.land…"), TIMEOUT);

    const escape = cancelEvent();
    d.dialog.dispatchEvent(escape);
    assert.ok(escape.defaultPrevented);
    fireEvent.click(d.dialog, { clientX: 5000, clientY: 5000 });
    assert.ok(d.dialog.open);

    await act(async () => pending.resolve(json(500, { ok: false, error: "nope", rolledBack: true, steps: [] })));
    await waitFor(() => assert.ok(!d.cancel.disabled), TIMEOUT);

    // A click inside the dialog (on its own padding) never closes it.
    fireEvent.click(d.dialog, { clientX: 0, clientY: 0 });
    assert.ok(d.dialog.open);
    d.dialog.dispatchEvent(cancelEvent());
    await waitFor(() => assert.ok(!d.dialog.open), TIMEOUT);

    fireEvent.click(document.querySelector("#open-remove")!);
    await waitFor(() => assert.ok(d.dialog.open), TIMEOUT);
    fireEvent.click(d.dialog, { clientX: 5000, clientY: 5000 });
    await waitFor(() => assert.ok(!d.dialog.open), TIMEOUT);
    assert.deepEqual(d.openChanges, [true, false, true, false]);
  });

  test("Tab from the last focusable wraps to the first, and Shift+Tab from the first to the last", async () => {
    const d = await openDialog(await propsFor("blog.lychee.land"));
    d.submit.focus();
    fireEvent.keyDown(d.dialog, { key: "Tab" });
    assertFocus(d.checkbox);
    fireEvent.keyDown(d.dialog, { key: "Tab", shiftKey: true });
    assertFocus(d.submit);
  });

  test("Tab is refused while nothing in the dialog can hold focus", async () => {
    const pending = deferred();
    answer("delete", () => pending.promise);
    const d = await openDialog(await propsFor("api.lychee.land"));
    assert.ok(!d.checkbox);
    fireEvent.click(d.submit);
    await waitFor(() => assert.ok(d.submit.disabled && d.cancel.disabled), TIMEOUT);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    d.dialog.dispatchEvent(tab);
    assert.ok(tab.defaultPrevented);
    await act(async () => pending.resolve(json(500, { ok: false, error: "x", rolledBack: true, steps: [] })));
  });

  test("Cancel has focus when it opens, and onOpenChange follows open and close", async () => {
    const d = await openDialog(await propsFor("blog.lychee.land"));
    assertFocus(d.cancel);
    assert.deepEqual(d.openChanges, [true]);
    fireEvent.click(d.cancel);
    await waitFor(() => assert.ok(!d.dialog.open), TIMEOUT);
    assert.deepEqual(d.openChanges, [true, false]);
  });

  test("the delete-files checkbox shows only where there are files, with their path", async () => {
    const withFiles = await openDialog(await propsFor("blog.lychee.land"));
    assert.ok(withFiles.checkbox);
    assert.match(withFiles.checkbox.closest("label")!.textContent ?? "", /Also delete files at \/var\/www\/blog\.lychee\.land$/);
    assert.ok(!withFiles.dialog.textContent?.includes("docker compose down"));
    cleanup();
    const legacy = await openDialog(await propsFor("legacy.lychee.land"));
    assert.ok(legacy.checkbox);
    assert.ok(legacy.dialog.textContent?.includes("docker compose down"));
    cleanup();
    const without = await openDialog(await propsFor("app.lychee.land"));
    assert.ok(!without.checkbox);
  });

  test("its props are read when it opens and kept while it is open", async () => {
    const attached = await propsFor("app.lychee.land");
    const d = await openDialog(attached);
    assert.ok(d.dialog.querySelector('[data-step-id="declaration"]'));
    const changed = { ...attached, steps: attached.steps.slice(0, 4), declaration: null };
    d.rerender(changed);
    assert.ok(d.dialog.querySelector('[data-step-id="declaration"]'));
    assert.equal(d.dialog.dataset.attached, "true");
    fireEvent.click(d.cancel);
    await waitFor(() => assert.ok(!d.dialog.open), TIMEOUT);
    assert.ok(!d.dialog.querySelector('[data-step-id="declaration"]'));
  });
});

describe("SiteDetail's remove dialog", () => {
  test("Remove site opens it, with Cancel focused, and onRemoveDialogChange follows it", async () => {
    const { payload } = await seedSiteDetailPayload("blog.lychee.land");
    const changes: boolean[] = [];
    const view = render(<SiteDetail payload={payload} onRemoveDialogChange={(open) => changes.push(open)} />);
    const dialog = view.container.querySelector<HTMLDialogElement>("#confirm-remove-dialog")!;
    assert.ok(!dialog.open);
    const trigger = view.container.querySelector<HTMLButtonElement>('[data-open-dialog="confirm-remove-dialog"]')!;
    trigger.focus();
    assertFocus(trigger);
    fireEvent.click(trigger);
    await waitFor(() => assert.ok(dialog.open), TIMEOUT);
    assertFocus(dialog.querySelector('[data-close-dialog="confirm-remove-dialog"]'));
    assert.deepEqual(changes, [true]);
    fireEvent.click(dialog.querySelector('[data-close-dialog="confirm-remove-dialog"]')!);
    await waitFor(() => assert.ok(!dialog.open), TIMEOUT);
    assert.deepEqual(changes, [true, false]);
  });
});
