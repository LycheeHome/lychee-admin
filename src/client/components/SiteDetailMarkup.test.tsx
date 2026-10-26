import "../test/setup";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import type { SiteDetailFacts } from "../../shared/siteDetail";
import { seedSiteDetailPayload } from "../../dev/testHelpers";
import { CaddyfileError, SiteDetail, SiteNotFound } from "./SiteDetail";

/*
 * The site page's phrases, rendered live. The parity tests compare markup
 * strings, where "Deploying " + "0.1.0" + " failed" + "." and "Deploying " +
 * "0.1.0" + " failed." read the same; the DOM does not. Every phrase the
 * server writes as one text node must be one text node in React, because
 * split nodes sit a fraction of a pixel off the server's one.
 */

/**
 * The element tree with every text node in place, its text normalised as
 * canonical() normalises it (whitespace collapsed, whitespace-only nodes
 * dropped, trimmed at a parent's edges), so the server's indentation does not
 * count but a phrase React split into two nodes shows up as two entries.
 */
function shape(node: Node): string {
  if (node.nodeType === 3) {
    let text = (node.nodeValue ?? "").replace(/\s+/g, " ");
    if (text === " ") return "";
    if (!node.previousSibling) text = text.trimStart();
    if (!node.nextSibling) text = text.trimEnd();
    return text ? `#text(${JSON.stringify(text)})` : "";
  }
  if (node.nodeType !== 1) return "";
  const el = node as Element;
  const children = Array.from(el.childNodes).map(shape).filter(Boolean);
  return `${el.tagName.toLowerCase()}[${children.join(",")}]`;
}

function serverHost(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** Renders `node` live with createRoot, hands the host to `check`, then unmounts. */
function live(node: ReactNode, check: (host: HTMLElement) => void): void {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(node));
  try {
    check(host);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Elements whose only non-blank content is one text node, in document order. */
function oneTextElements(host: HTMLElement): Element[] {
  return Array.from(host.querySelectorAll("*")).filter((el) => {
    const content = Array.from(el.childNodes).filter((n) => !(n.nodeType === 3 && /^\s*$/.test(n.nodeValue ?? "")));
    return content.length === 1 && content[0].nodeType === 3;
  });
}

/** Both checks: the whole shape, and each one-text element as one node. */
function assertOneTextNodes(server: HTMLElement, client: HTMLElement): void {
  assert.equal(shape(client), shape(server));
  const serverAll = Array.from(server.querySelectorAll("*"));
  const clientAll = Array.from(client.querySelectorAll("*"));
  assert.equal(clientAll.length, serverAll.length);
  const singles = oneTextElements(server);
  assert.ok(singles.length > 0, "no one-text element to check");
  for (const el of singles) {
    const twin = clientAll[serverAll.indexOf(el)];
    assert.equal(twin.childNodes.length, 1, `<${twin.tagName.toLowerCase()}> "${twin.textContent}" is split`);
  }
}

// The retired server renderer's output, frozen: see SiteDetailParity.test.tsx's
// serverRegion. Most cases share the parity file's fixtures; the text-* ones
// are this file's own.
const FIXTURES = path.join(__dirname, "../../dev/fixtures/detail");
const read = new Set<string>();

function serverRegion(name: string): string {
  read.add(`${name}.html`);
  return readFileSync(path.join(FIXTURES, `${name}.html`), "utf8");
}

async function detailCase(fixture: string, hostname: string, override: Partial<SiteDetailFacts> = {}) {
  const { payload } = await seedSiteDetailPayload(hostname, override);
  return { html: serverRegion(fixture), payload };
}

const BAD = { status: "exited", since: null } as const;
const RESTARTING = { status: "restarting", since: null } as const;

const CASES: Record<string, [fixture: string, hostname: string, override: Partial<SiteDetailFacts>]> = {
  "a static apex with its directory": ["apex-with-directory", "lychee.land", {}],
  "a plain proxy not responding, under a bad tunnel and Caddy": [
    "bad-tunnel-caddy-and-app",
    "api.lychee.land",
    {
      status: { kind: "tcp", responding: false },
      unitStates: { "cloudflared-sites.service": BAD, "caddy.service": RESTARTING },
    },
  ],
  "a plain proxy responding": ["proxy-responding", "api.lychee.land", { status: { kind: "tcp", responding: true } }],
  "a legacy Next.js site": ["legacy-runbook", "legacy.lychee.land", {}],
  "an attached site's dialog": ["app-installed", "app.lychee.land", {}],
  "an installed container in a bad state": ["container-bad-state", "app.lychee.land", { status: { kind: "container", state: "exited" } }],
  "a failed first deploy": ["broken-failed-first-deploy", "broken.lychee.land", {}],
  "an empty tunnelId": ["empty-tunnel-id", "blog.lychee.land", { tunnelId: "" }],
  "a first deploy on offer, steps folded": ["preview-awaiting-first-image", "preview.lychee.land", {}],
  "Change repository, no tag found": [
    "preview-no-tag-found",
    "preview.lychee.land",
    { resource: { name: "preview-lychee-land", repo: "preview-site", result: "awaiting-image" } },
  ],
  "an installed version with its tag requested": [
    "app-requested-line",
    "app.lychee.land",
    {
      resource: {
        name: "app-lychee-land",
        repo: "app-site",
        version: "0.2.0",
        target: "0.2.0",
        available: "0.3.0",
        result: "skipped",
        requestedTag: "0.3.0",
      },
    },
  ],
  "an inventory-only resource with nothing found": [
    "inventory-only-nothing-installed",
    "preview.lychee.land",
    { resource: { name: "preview-lychee-land", repo: null, result: "awaiting-image" } },
  ],
};

describe("SiteDetail: every one-line phrase is one text node", () => {
  for (const [name, [fixture, hostname, override]] of Object.entries(CASES)) {
    test(name, async () => {
      const { html, payload } = await detailCase(fixture, hostname, override);
      live(<SiteDetail payload={payload} />, (client) => assertOneTextNodes(serverHost(html), client));
    });
  }

  test("the not-found body", () => {
    const hostname = "nope.lychee.land";
    const html = serverRegion("text-not-found");
    live(<SiteNotFound hostname={hostname} />, (client) => assertOneTextNodes(serverHost(html), client));
  });

  test("the Caddyfile-error body", () => {
    const message = "caddy read failed: permission denied";
    const html = serverRegion("text-caddyfile-error");
    live(<CaddyfileError message={message} />, (client) => assertOneTextNodes(serverHost(html), client));
  });

  test("a phrase split into two text nodes is caught", async () => {
    const { html } = await detailCase("broken-failed-first-deploy", "broken.lychee.land");
    const whole = serverHost(html);
    const split = serverHost(html);
    const sentence = split.querySelector("[data-deploy-failed] > p");
    const text = sentence?.lastChild;
    assert.ok(text && text.nodeType === 3, "no failure sentence to split");
    // " failed at this step:" -> " failed", " at this step:": the same
    // characters in two nodes, as adjacent JSX expressions would write them.
    (text as Text).splitText(7);
    assert.equal(split.textContent, whole.textContent);
    assert.notEqual(shape(split), shape(whole));
  });
});

describe("SiteDetail's copy buttons keep their targets", () => {
  test("What to check and the DNS steps", async () => {
    const { payload } = await seedSiteDetailPayload("api.lychee.land", {
      status: { kind: "tcp", responding: false },
      unitStates: { "cloudflared-sites.service": BAD, "caddy.service": RESTARTING },
    });
    live(<SiteDetail payload={payload} />, (host) => {
      for (const id of ["site-hostname", "cmd-fix-tunnel", "cmd-fix-caddy", "cmd-fix-listen", "cmd-dns-target", "cmd-dns"]) {
        const button = host.querySelector(`[data-copy-target="${id}"]`);
        assert.ok(button, `no copy button for ${id}`);
        assert.ok(host.querySelector(`#${id}`), `no copy target #${id}`);
      }
    });
  });

  test("the heading takes headingRef", async () => {
    const { payload } = await seedSiteDetailPayload("lychee.land");
    let heading: HTMLHeadingElement | null = null;
    live(<SiteDetail payload={payload} headingRef={(el) => void (heading = el)} />, () => {
      assert.equal((heading as HTMLHeadingElement | null)?.id, "site-hostname");
    });
  });

  test("the card slot sits where cardOrder puts it", async () => {
    const attached = await seedSiteDetailPayload("app.lychee.land");
    live(<SiteDetail payload={attached.payload} card={<section id="slot" />} />, (host) => {
      const slot = host.querySelector("#slot");
      assert.ok(slot);
      assert.match(slot.previousElementSibling?.textContent ?? "", /^Request path/);
    });
    const unattached = await seedSiteDetailPayload("legacy.lychee.land");
    live(<SiteDetail payload={unattached.payload} card={<section id="slot" />} />, (host) => {
      const slot = host.querySelector("#slot");
      assert.ok(slot);
      assert.match(slot.previousElementSibling?.textContent ?? "", /^Manual steps/);
    });
    const plain = await seedSiteDetailPayload("lychee.land");
    live(<SiteDetail payload={plain.payload} card={<section id="slot" />} />, (host) => {
      assert.ok(!host.querySelector("#slot"));
    });
  });
});

// Last in the file, so every test above has run. This file owns the text-*
// fixtures (its own cases the parity file has no twin for); the others it
// shares are checked by SiteDetailParity.test.tsx.
describe("the frozen text-node fixtures", () => {
  test("every text-* fixture file is read by a test here", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".html") && f.startsWith("text-"))
      .sort();
    assert.deepEqual(files, [...read].filter((f) => f.startsWith("text-")).sort());
  });
});
